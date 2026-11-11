// Fixed synthetic worker. No runtime import or intentional blocking fault is
// permitted until the independent watchdog releases the private gate.
import {fileURLToPath} from 'node:url';
const [idText,scenario,...extra]=process.argv.slice(2),id=Number(idText);
const scenarios=['normal','init_block','sync_block','crash_intent','crash_response','crash_ack','crash_seal','seal_block','late_headers','sustained','sustained_crash_response'];
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||!process.connected||extra.length||!Number.isSafeInteger(id)||id<1||!scenarios.includes(scenario))throw Error('synthetic_worker_bootstrap_required');
process.umask(0o077);let parentGone=false;process.once('disconnect',()=>{parentGone=true;});
const {readPrivatePipe}=await import('./acceptance-private-pipe.mjs');
if(await readPrivatePipe(5)!=='SYNTHETIC_PRICE_WATCHDOG_READY'||parentGone||!process.connected)throw Error('synthetic_watchdog_gate_required');
const send=value=>{if(process.connected)process.send?.(value,()=>{});};
if(scenario==='init_block'){send({type:'synthetic_fault_ready',point:'init_block'});for(;;){}}
const {register}=await import('../node_modules/tsx/dist/esm/api/index.mjs');register();
const {SyntheticProcessDirectory}=await import('../src/server/production-model-process-storage.ts');
const {processManifest,openSyntheticProcessState}=await import('../src/server/production-model-process-state.ts');
const {createSyntheticPriceRuntimeSegment}=await import('../src/server/production-model-price-runtime.ts');
const {createMemoryProductionHttp}=await import('../src/server/production-model-http.ts');
const {syntheticRecordHash:hash}=await import('../src/server/production-model-price-evidence.ts');
const {PRODUCTION_MODEL_CANDIDATE:P}=await import('../src/server/production-model-policy.ts');
const {rehearsalSnapshot,checkSyntheticRehearsal}=await import('../src/server/production-model-process-rehearsal.ts');
const {syntheticFailureDiagnostic}=await import('../src/server/production-model-process-diagnostics.ts');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),directory=SyntheticProcessDirectory.inherit(4);
const sustained=scenario==='sustained'||scenario==='sustained_crash_response';
let state,bridge,finished=false,poll,report,receipt,manifest,unsubscribe,stage='worker_initialize',diagnosticCount=0;
// Supplemental diagnostics are not a successful rehearsal or recovery evidence.
const diagnose=(error,status,reason)=>{try{
 status??=bridge?.status();
 const diagnostic=syntheticFailureDiagnostic({stage,error,reason,receipt,status,report});
 send({type:'synthetic_worker_diagnostic',diagnostic});
 try{directory.writeJson(`worker-failure-${id}-${++diagnosticCount}.json`,diagnostic);}catch{}
}catch{}};
const finish=()=>{if(finished)return;finished=true;clearInterval(poll);let status;
 try{stage='worker_close';status=bridge?.close();if(!status?.sealed||status.failure){process.exitCode=1;diagnose(undefined,status,'runtime_not_clean');}
  if(sustained&&status?.sealed&&!status.failure){
   stage='worker_rehearsal';
   report.after=rehearsalSnapshot(state.store.loadForRuntime());report.finishedAtMs=Date.now();report.finishedMonotonicNs=process.hrtime.bigint().toString();report.stopReason=status.control?.reason??null;
   checkSyntheticRehearsal(report,receipt,{runId:manifest.contract.runId,sourceFingerprint:manifest.contract.sourceFingerprint,
    originalDeadlineAtMs:manifest.contract.deadlineAtMs,attempts:status.session.attempts,completed:status.session.completed,after:report.after});
   stage='worker_report_write';directory.writeJson(`rehearsal-${id}.json`,report);
  }
  send({type:'synthetic_worker_finished',id,sealed:status?.sealed===true,failure:status?.failure??null});}
 catch(error){process.exitCode=1;diagnose(error,status);}finally{unsubscribe?.();try{state?.close();}finally{directory.close();process.off('SIGINT',finish);process.off('SIGTERM',finish);process.off('disconnect',finish);if(process.connected)process.disconnect();}}};
try{
 manifest=processManifest(directory,root);receipt=directory.readJson(`launch-${id}.json`);
 if(receipt.id!==id||receipt.contractHash!==hash(manifest.contract)||receipt.bootId!==manifest.bootId||Date.now()<receipt.startedAtMs||Date.now()>=receipt.deadlineAtMs
  ||process.hrtime.bigint()>=BigInt(receipt.deadlineMonotonicNs)||parentGone||!process.connected)throw Error('synthetic_launch_expired');
 state=openSyntheticProcessState(directory,manifest,receipt);const s=state.session.status();
 if(s.segments!==id-1||s.epochs!==id||s.attempts!==receipt.attempts||s.completed!==receipt.completed||s.evidenceHash!==receipt.evidenceHash||s.evidence?.validUntilMs!==receipt.deadlineAtMs)throw Error('synthetic_launch_state_mismatch');
 const before=rehearsalSnapshot(state.store.loadForRuntime()),memory=createMemoryProductionHttp();bridge=createSyntheticPriceRuntimeSegment({store:state.store,journal:state.journal,session:state.session,transport:memory.transport,endGameMinute:before.minute+60});
 if(sustained){
  report={schema:1,kind:'synthetic-nine-continuity-segment',id,receiptHash:hash(receipt),runId:manifest.contract.runId,sourceFingerprint:manifest.contract.sourceFingerprint,
   originalDeadlineAtMs:manifest.contract.deadlineAtMs,evidenceHash:receipt.evidenceHash,before,ready:rehearsalSnapshot(state.store.loadForRuntime()),after:null,
   startedAtMs:Date.now(),finishedAtMs:null,startedMonotonicNs:process.hrtime.bigint().toString(),finishedMonotonicNs:null,ticks:[],requests:[],stopReason:null,
   realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};
  let completed=receipt.completed,minute=before.minute;
  unsubscribe=bridge.runtime.subscribe(()=>{
   const world=bridge.runtime.world,ss=state.session.status();
   if(world.minute>minute){report.ticks.push({atMs:Date.now(),monotonicNs:process.hrtime.bigint().toString(),minute:world.minute,revision:world.revision});minute=world.minute;}
   if(ss.completed>completed){
    const request=report.requests.at(-1);
    if(ss.completed!==completed+1||request?.id!==ss.completed||request.acknowledgedAtMs!==null||state.journal.status().completed!==ss.completed)throw Error('synthetic_observation_unmatched');
    Object.assign(request,{acknowledgedAtMs:Date.now(),acknowledgedMonotonicNs:process.hrtime.bigint().toString(),worldFingerprint:ss.worldFingerprint,revision:world.revision,minute:world.minute});completed=ss.completed;
   }
  });
 }
 const after=(object,name,point,block=false)=>{const original=object[name].bind(object);object[name]=(...args)=>{const result=original(...args);send({type:'synthetic_fault_ready',point});if(block)for(;;){}process.exit(73);return result;};};
 if(scenario==='crash_intent')after(state.session,'beginRequest','intent');
 if(scenario==='crash_response')after(state.journal,'response','response');
 if(scenario==='crash_ack')after(state.journal,'acknowledgeWorldCommit','ack');
 if(scenario==='crash_seal')after(state.session,'finishSegment','sealed');
 if(scenario==='seal_block')after(state.session,'finishSegment','sealed',true);
 if(scenario==='sustained_crash_response'){
  const original=state.journal.response.bind(state.journal);state.journal.response=(...args)=>{const result=original(...args);
   if(state.journal.status().completed>=receipt.completed+9){send({type:'synthetic_fault_ready',point:'sustained_response',id:args[0]});process.exit(73);}return result;};
 }
 process.on('SIGINT',finish);process.on('SIGTERM',finish);process.on('disconnect',finish);
 send({type:'synthetic_worker_ready',id});
 if(scenario==='sync_block'){send({type:'synthetic_fault_ready',point:'sync_block'});for(;;){}}
 let responded=0;
 const respond=()=>{if(responded>=memory.requests().length||scenario==='late_headers')return;
  const index=responded++,request=memory.requests()[index],messages=JSON.parse(request.body).messages,choice=messages.map(m=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];
  if(!choice)throw Error('synthetic_choice_missing');
  const content=JSON.stringify({choice,minutes:15}),usage={prompt_tokens:1,completion_tokens:1};
  if(sustained){const ss=state.session.status(),js=state.journal.status(),actorId=bridge.runtime.world.metrics.inFlight[0];
   if(!ss.pending||ss.pending.id!==request.id||js.pending?.id!==request.id||ss.pending.requestHash!==hash(request.body)||bridge.runtime.world.metrics.inFlight.length!==1)throw Error('synthetic_request_observation_unmatched');
   // First observation is a conservative upper bound on actual memory invoke,
   // not an instrumented invocation timestamp. This fixed profile fails closed
   // if its observation arrives at/after cutoff; the core drain rule is unchanged.
   report.requests.push({id:request.id,actorId,requestBody:request.body,reply:{content,finish:'stop',usage},requestHash:hash(request.body),responseHash:hash({content,finish:'stop',usage}),observedAtMs:Date.now(),observedMonotonicNs:process.hrtime.bigint().toString(),
    acknowledgedAtMs:null,acknowledgedMonotonicNs:null,worldFingerprint:null,revision:null,minute:null});
  }
  memory.headers(index);memory.chunk(index,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content},finish_reason:'stop'}],usage})));memory.end(index);
 };
 bridge.runtime.start();if(!sustained)bridge.drain();respond();
 stage='worker_observe';
 poll=setInterval(()=>{try{if(sustained)respond();if(bridge.status().control?.phase==='stopped')finish();}catch(error){process.exitCode=1;diagnose(error);finish();}},20);
}catch(error){process.exitCode=1;diagnose(error);finish();}

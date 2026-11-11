// Explicit OFFLINE-only synthetic rehearsal. Never imported by formal main.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {SyntheticProcessDirectory} from '../src/server/production-model-process-storage.ts';
import {createSyntheticProcessState,processManifest,openSyntheticProcessState,monotonicStamp} from '../src/server/production-model-process-state.ts';
import {SyntheticLaunchLedger} from '../src/server/production-model-process-ledger.ts';
import {createSyntheticPriceEvidence,syntheticRecordHash as hash} from '../src/server/production-model-price-evidence.ts';
import {rehearsalSnapshot,checkSyntheticRehearsal} from '../src/server/production-model-process-rehearsal.ts';
import {syntheticFailureDiagnostic,sanitizeSyntheticDiagnostic} from '../src/server/production-model-process-diagnostics.ts';
const [flag,mode,output,scenario='normal',...extra]=process.argv.slice(2),root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const scenarios=['normal','init_block','sync_block','crash_intent','crash_response','crash_ack','crash_seal','seal_block','late_headers','crash_reserved','watchdog_missing','sustained','sustained_crash_response'];
const emit=value=>{try{process.stdout.write(JSON.stringify(value)+'\n');}catch{}};process.stdout.on('error',()=>{});
let directory,db,ledger,state,watchdog,workerIdentity,finished=false,receipt,stage='guardian_prepare';
let observation=null,watchdogExit=null,watchdogError=false,outerTimedOut=false;
const workerDiagnostics=[];
const signalOwnedWorker=signal=>{if(!workerIdentity)return 'unknown';try{const raw=readFileSync(`/proc/${workerIdentity.pid}/stat`,'utf8'),start=raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
 if(start!==workerIdentity.startTicks)return 'unknown';process.kill(-workerIdentity.pid,signal);return 'sent';}catch(e){return e.code==='ESRCH'?'not_found':'unknown';}};
const cleanupKnownWorker=async()=>{
 if(!workerIdentity)return;
 const absent=()=>{try{process.kill(-workerIdentity.pid,0);return false;}catch(e){return e.code==='ESRCH';}};
 if(absent())return;signalOwnedWorker('SIGTERM');await new Promise(resolve=>setTimeout(resolve,1500));
 if(absent())return;signalOwnedWorker('SIGKILL');const until=performance.now()+1500;
 while(!absent()&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,25));
};
try{
 if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||flag!=='--offline'||!['new','resume'].includes(mode)||!scenarios.includes(scenario)||extra.length)throw Error('explicit_synthetic_launch_required');
 process.umask(0o077);directory=SyntheticProcessDirectory.open(root,output,mode==='new');
 const manifest=mode==='new'?createSyntheticProcessState(directory,root):processManifest(directory,root);
 db=new DatabaseSync(directory.database('launch.sqlite',mode==='new'));
 ledger=new SyntheticLaunchLedger(db,manifest.contract,manifest.bootId,{create:mode==='new',worldFingerprint:manifest.initialWorldFingerprint,
  sessionHash:manifest.initialSessionHash,journalHash:manifest.initialJournalHash,nowMs:Date.now(),monotonicNs:monotonicStamp()});
 const previous=ledger.status();if(previous.failure||previous.pending)throw Error('synthetic_launch_blocked');
 // Preserve all bound evidence, not merely the newest completion. The launch
 // constructor already validated these rows and their chain before this read.
 for(const row of db.prepare('SELECT body FROM synthetic_launch_audit ORDER BY sequence').iterate()){
  const event=JSON.parse(row.body);if(event.type!=='finished')continue;
  const prior=directory.readJson(`process-${event.id}.json`);
  if(hash(prior)!==event.reportHash||prior.rehearsalHash&&hash(directory.readJson(`rehearsal-${event.id}.json`))!==prior.rehearsalHash)throw Error('synthetic_process_report_mismatch');
 }
 state=openSyntheticProcessState(directory,manifest,previous);let before=state.session.status();
 if(before.segments!==previous.finished||before.epochs!==previous.finished||before.attempts!==previous.attempts||before.completed!==previous.completed||before.reservedWallMs!==previous.finished*30000)throw Error('synthetic_launch_count_mismatch');
 const startedAtMs=Date.now(),startedMonotonicNs=monotonicStamp(),deadlineAtMs=startedAtMs+30000;
 if(deadlineAtMs>manifest.contract.deadlineAtMs)throw Error('synthetic_launch_time_exhausted');
 state.session.installPrice(createSyntheticPriceEvidence({scopeHash:state.session.contractHash,sequence:before.epochs+1,previousEvidenceHash:before.evidenceHash,
  fixtureId:'fixed-offline-process-price',observedAtMs:startedAtMs,validUntilMs:deadlineAtMs}),startedAtMs);
 before=state.session.status();
 receipt=ledger.reserve({worldFingerprint:previous.worldFingerprint,attempts:before.attempts,completed:before.completed,previousSessionHash:previous.sessionHash,
  sessionHash:before.auditHash,journalHash:state.journal.status().auditHash,evidenceHash:before.evidenceHash,startedAtMs,deadlineAtMs,startedMonotonicNs,
  deadlineMonotonicNs:(BigInt(startedMonotonicNs)+30_000_000_000n).toString()});
 directory.writeJson(`launch-${receipt.id}.json`,receipt);state.close();state=undefined;
 emit({type:'synthetic_launch_reserved',id:receipt.id,reservedWallMs:ledger.status().reservedWallMs,attempts:receipt.attempts,deadlineAtMs,realModelExecuted:false});
 if(scenario==='crash_reserved')process.exit(73);
 let outerTimer,killTimer;stage='guardian_supervise';
 const script=scenario==='watchdog_missing'?'production-model-process-missing.mjs':'production-model-process-watchdog.mjs';
 watchdog=spawn(process.execPath,['--import',root+'/scripts/acceptance-offline-guard.mjs','--import',root+'/node_modules/tsx/dist/loader.mjs',root+'/scripts/'+script,String(receipt.id),scenario],
  {cwd:'/',env:{},shell:false,detached:true,stdio:['pipe','ignore','ignore','ipc',directory.descriptor()]});
 watchdog.stdin.on('error',()=>{});
 const stop=()=>{watchdog.stdin.end();try{watchdog.kill('SIGTERM');}catch{}};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 watchdog.on('message',message=>{
  if(message?.type==='synthetic_worker_identity'&&Number.isSafeInteger(message.pid)&&message.pid>1&&/^\d+$/.test(message.startTicks)){
   workerIdentity={pid:message.pid,startTicks:message.startTicks};emit(message);
  }else if(message?.type==='synthetic_watchdog_result')observation=message;
  else if(message?.type==='synthetic_worker_diagnostic'&&workerDiagnostics.length<3){const diagnostic=sanitizeSyntheticDiagnostic(message.diagnostic);workerDiagnostics.push(diagnostic);emit({type:'synthetic_worker_diagnostic',diagnostic});}
  else if(['synthetic_worker_ready','synthetic_fault_ready','synthetic_worker_finished'].includes(message?.type))emit(message);
 });
 emit({type:'synthetic_watchdog_started',pid:watchdog.pid,id:receipt.id});
 await new Promise(resolve=>{
  watchdog.once('error',()=>{watchdogError=true;resolve();});watchdog.once('exit',(code,signal)=>{watchdogExit={code,signal};resolve();});
  // This is an outer failure bound, never a fresh worker execution allowance.
  const remaining=Math.max(0,Number((BigInt(receipt.deadlineMonotonicNs)-process.hrtime.bigint())/1_000_000n));
  outerTimer=setTimeout(()=>{outerTimedOut=true;stop();signalOwnedWorker('SIGTERM');killTimer=setTimeout(()=>{
   signalOwnedWorker('SIGKILL');try{watchdog.kill('SIGKILL');}catch{}resolve();},1500);},remaining+4000);
 });
 clearTimeout(outerTimer);clearTimeout(killTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);watchdog.stdin.destroy();
 const processReport=observation?.process;
 if(watchdogError||outerTimedOut||watchdogExit?.code!==0||watchdogExit.signal!==null||!processReport?.exit?.observed||processReport.exit.code!==0
  ||processReport.exit.signal!==null||processReport.trigger!=='child_exit'||processReport.cleanupComplete!==true||processReport.groupState!=='absent'
  ||processReport.issues.length||observation.id!==receipt.id||hash(directory.readJson(`watchdog-${receipt.id}.json`))!==hash(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='type'))))throw Error('synthetic_process_not_clean');
 if(!workerIdentity||observation.identity?.pid!==workerIdentity.pid||observation.identity?.startTicks!==workerIdentity.startTicks)throw Error('synthetic_worker_identity_unknown');
 try{process.kill(-workerIdentity.pid,0);throw Error('synthetic_worker_group_present');}catch(e){if(e.code!=='ESRCH')throw e;}
 stage='guardian_reconcile';processManifest(directory,root);state=openSyntheticProcessState(directory,manifest);const ss=state.session.status(),js=state.journal.status();
 if(ss.segments!==receipt.id||ss.epochs!==receipt.id||ss.reservedWallMs!==receipt.id*30000||ss.evidenceHash!==receipt.evidenceHash||ss.attempts<receipt.attempts||ss.attempts!==ss.completed)throw Error('synthetic_process_seal_mismatch');
 let rehearsalHash;
 if(scenario==='sustained'||scenario==='sustained_crash_response'){
  const rehearsal=directory.readJson(`rehearsal-${receipt.id}.json`);
  checkSyntheticRehearsal(rehearsal,receipt,{runId:manifest.contract.runId,sourceFingerprint:manifest.contract.sourceFingerprint,
   originalDeadlineAtMs:manifest.contract.deadlineAtMs,attempts:ss.attempts,completed:ss.completed,after:rehearsalSnapshot(state.store.loadForRuntime())});
  rehearsalHash=hash(rehearsal);
 }
 const result={schema:1,kind:'synthetic-price-supervised-result',id:receipt.id,receiptHash:hash(receipt),observation:directory.readJson(`watchdog-${receipt.id}.json`),
  watchdogExit,sessionHash:ss.auditHash,journalHash:js.auditHash,worldFingerprint:ss.worldFingerprint,attempts:ss.attempts,completed:ss.completed,
  originalDeadlineAtMs:manifest.contract.deadlineAtMs,reservedWallMs:ledger.status().reservedWallMs,...(rehearsalHash?{rehearsalHash}:{}),realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};
 stage='guardian_report_write';directory.writeJson(`process-${receipt.id}.json`,result);
 ledger.finish({id:receipt.id,worldFingerprint:ss.worldFingerprint,attempts:ss.attempts,completed:ss.completed,sessionHash:ss.auditHash,journalHash:js.auditHash,
  reportHash:hash(result),at:Date.now(),monotonicNs:monotonicStamp()});finished=true;
 emit({type:'synthetic_process_finished',...ledger.status()});
}catch(error){
 try{ledger?.fail('supervised_launch_failed');}catch{}
 await cleanupKnownWorker();
 process.exitCode=1;
 let diagnostic;try{diagnostic=syntheticFailureDiagnostic({stage,error,receipt,observation,watchdogExit,watchdogError,outerTimedOut});}catch{diagnostic=sanitizeSyntheticDiagnostic({stage});}
 try{if(receipt)directory?.writeJson(`guardian-failure-${receipt.id}.json`,diagnostic);}catch{}
 emit({type:'synthetic_process_blocked',status:ledger?.status()??null,diagnostic,workerDiagnostics,realModelExecuted:false,acceptancePassed:null});
}finally{
 if(!finished&&watchdog&&watchdog.exitCode===null&&watchdog.signalCode===null){try{watchdog.stdin.end();watchdog.kill('SIGTERM');}catch{}}
 try{state?.close();}finally{db?.close();directory?.close();}
}

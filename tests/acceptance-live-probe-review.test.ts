/** Independent synthetic-only review. Run with the offline guard preloaded. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SiliconFlowLive,SILICONFLOW_LIVE as P,SILICONFLOW_PRICE_SOURCES,type LiveEvidence} from '../src/server/acceptance-siliconflow-live.js';
import {AcceptanceStopControl,type AcceptanceClock} from '../src/server/acceptance-stop-control.js';
import {GLM_MODEL,type ModelName} from '../src/server/model-completion.js';
import {LIVE_PROBE_PROTOCOL} from '../src/server/acceptance-live-protocol.js';
test('review: synthetic timing does not relax the live probe limits',()=>{
 assert.deepEqual(LIVE_PROBE_PROTOCOL.supervisor,{maxWallMs:195_000,termGraceMs:1500,killWaitMs:1500});
 assert.equal(LIVE_PROBE_PROTOCOL.maxWallMs,180_000);assert.equal(LIVE_PROBE_PROTOCOL.maxRequests,9);
});
class Clock implements AcceptanceClock {
 value=100; next=0; timers=new Map<number,()=>void>(); clearHook?:()=>void;
 now=()=>this.value;
 setTimer=(fn:()=>void,_ms:number)=>{this.timers.set(++this.next,fn);return this.next;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);this.clearHook?.();};
}
const messages=[{role:'user' as const,content:'synthetic fictional state'}];
function result(body?:ReadableStream<Uint8Array>){
 const response=new Response(body??JSON.stringify({id:'synthetic-1',object:'chat.completion',model:P.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'synthetic decision'}}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}),{headers:{'content-type':'application/json'}});
 Object.defineProperty(response,'url',{value:P.endpoint});return response;
}
function fixture(answer:()=>Promise<Response>=async()=>result()){
 const clock=new Clock(),events:LiveEvidence[]=[];let calls=0;
 const live=new SiliconFlowLive({enabled:true,key:'SYNTHETIC_NOT_A_REAL_KEY',dataApproved:true,clock,wallNow:()=>clock.value,
 priceEvidence:{model:P.model,inputPricePerMillion:0,outputPricePerMillion:0,observedAtMs:0,expiresAtMs:900000,sourceUrls:SILICONFLOW_PRICE_SOURCES},
 persist:e=>{events.push(e);return true;},fetch:(async(url,init)=>{calls++;assert.equal(url,P.endpoint);assert.equal(init?.redirect,'error');return answer();}) as typeof fetch});
 return {live,clock,events,calls:()=>calls};
}
test('review: stop reentered during successful timer cleanup cannot release a decision',async()=>{
 const f=fixture();f.live.start();let entered=false;
 f.clock.clearHook=()=>{if(!entered){entered=true;f.live.stop('signal');}};
 assert.equal(await f.live.complete(messages),null);assert.equal(f.live.status().completedResponses,0);assert.equal(f.live.status().phase,'stopped');
});
test('review: replayed wall callback cannot orphan an owned timer',()=>{
 const f=fixture();f.live.start();const original=f.clock.timers.get(1)!;
 f.clock.timers.delete(1);original();original();f.live.stop();assert.equal(f.clock.timers.size,0);
});
test('review: ninth synthetic request is last, with no fallback or retry',async()=>{
 const f=fixture();assert.equal(f.live.start(),true);
 for(let i=0;i<9;i++)assert.ok(await f.live.complete(messages));
 assert.equal(await f.live.complete(messages),null);assert.equal(f.calls(),9);assert.equal(f.live.status().reason,'request_limit');
 assert.equal(f.live.status().realProviderCostUsd,null);assert.equal(f.live.status().perRequestReceipt,false);
 assert.equal(JSON.stringify(f.events).includes('SYNTHETIC_NOT_A_REAL_KEY'),false);
});
test('review: a body without Content-Length is still bounded cumulatively',async()=>{
 let cancelled=false;
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(32001));c.enqueue(new Uint8Array(32000));},cancel(){cancelled=true;}});
 const f=fixture(async()=>result(body));f.live.start();assert.equal(await f.live.complete(messages),null);
 assert.equal(f.live.status().reason,'body_invalid');assert.equal(f.calls(),1);assert.equal(cancelled,true);
});
test('review: late response after stop is cancelled and cannot produce completion evidence',async()=>{
 let resolve!:(r:Response)=>void,cancelled=false;
 const f=fixture(()=>new Promise(r=>{resolve=r;}));f.live.start();const pending=f.live.complete(messages);f.live.stop();assert.equal(await pending,null);
 resolve(result(new ReadableStream({cancel(){cancelled=true;}})));await new Promise(r=>setImmediate(r));
 assert.equal(cancelled,true);assert.equal(f.events.some(e=>e.type==='completion'),false);assert.equal(f.clock.timers.size,0);
});
function stopOptions(clock:Clock){return {endGameMinute:540,maxRequests:9,maxWallMs:180000,allowedModels:[P.model],clock,
 assessPrice:(model:ModelName)=>({model,currency:'USD' as const,inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:999999})};}
test('review: explicit unreceipted policy does not invent cost or complete control',()=>{
 const clock=new Clock(),control=new AcceptanceStopControl({...stopOptions(clock),unreceiptedFreePolicy:'siliconflow-deepseek-published-zero'},()=>{});
 control.start(480);const token=control.reserve(P.model,480)!;assert.ok(control.dispatch(token,480));assert.equal(control.settle(token,480,undefined),true);
 assert.equal(control.status().unknownCostRequests,1);assert.equal(control.status().confirmedCostUsd,null);assert.equal(control.status().controlComplete,false);control.stop('manual_stop');
});
test('review: opt-in absent preserves fail-closed missing bill behavior',()=>{
 const control=new AcceptanceStopControl(stopOptions(new Clock()),()=>{});control.start(480);const token=control.reserve(P.model,480)!;
 control.dispatch(token,480);assert.equal(control.settle(token,480,undefined),false);assert.equal(control.status().reason,'cost_unknown');
});
test('review: unreceipted policy cannot include a second candidate',()=>{
 assert.throws(()=>new AcceptanceStopControl({...stopOptions(new Clock()),allowedModels:[P.model,GLM_MODEL],unreceiptedFreePolicy:'siliconflow-deepseek-published-zero'},()=>{}),/invalid_official_free_policy/);
});
// Importing the launcher does not execute its main block or read its key file.
// @ts-expect-error Fixed internal JavaScript entry has no declaration file.
import {liveProbeLaunch} from '../scripts/run-nine-siliconflow-live.mjs';
test('review: old explicit launcher selection is now retired before credentials or launch',()=>{
 const run=spawnSync(process.execPath,['--import',join(project,'scripts/acceptance-offline-guard.mjs'),'--input-type=module','-e',
  `import {liveProbeLaunch} from ${JSON.stringify(new URL('../scripts/run-nine-siliconflow-live.mjs',import.meta.url).href)}; try{liveProbeLaunch(['--live-probe','--approved-fictional-data','--price-observed-at',String(Date.now()),'--output','/tmp/synthetic-not-created']);throw new Error('unexpected_launch');}catch(error){console.log(error.message);}`],{env:{},cwd:'/',encoding:'utf8',timeout:5000});
 assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),'legacy_live_probe_disabled_pending_reconciliation');
});
test('review: absent, stale, future and malformed launch gates reject before key reader',()=>{
 for(const args of [[],['--live-probe'],['--live-probe','--approved-fictional-data','--price-observed-at',String(Date.now()-13*60000),'--output','/tmp/synthetic-not-created'],
 ['--live-probe','--approved-fictional-data','--price-observed-at',String(Date.now()+60000),'--output','/tmp/synthetic-not-created'],
 ['--live-probe','--approved-fictional-data','--price-observed-at',String(Date.now()),'--output','relative']])assert.throws(()=>liveProbeLaunch(args));
});
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('..',import.meta.url));
async function syntheticGuardian(scenario:string,disconnect=false){
 assert.ok(['synthetic','stall_headers','init_block','sync_block','http_failure'].includes(scenario));
 const base=mkdtempSync(join(testTmpdir(),'valley-live-review-')),output=join(base,'probe');
 const child=spawn(process.execPath,['--import',join(project,'scripts/acceptance-offline-guard.mjs'),'--import',join(project,'node_modules/tsx/dist/loader.mjs'),join(project,'scripts/acceptance-live-guardian.mjs'),output,String(Date.now()),scenario],{env:{},cwd:'/',stdio:['pipe','pipe','pipe','pipe']});
 child.stdin.on('error',()=>{});const keyPipe=child.stdio[3] as import('node:stream').Writable;keyPipe.on('error',()=>{});keyPipe.end('SYNTHETIC_PIPE_KEY_NOT_REAL');
 let stdout='',stderr='',expired=false;
 child.stdout!.on('data',chunk=>{stdout+=chunk.toString();if(disconnect&&stdout.includes('live_probe_ready'))child.stdin.end();});
 child.stderr!.on('data',chunk=>{stderr+=chunk.toString();});
 // Independent of the guardian's 30s synthetic budget plus bounded cleanup.
 const timeout=setTimeout(()=>{expired=true;child.kill('SIGTERM');},45000);
 try{
 const exit=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(expired,false,'guardian exceeded independent synthetic watchdog');
 assert.equal(stderr.includes('SYNTHETIC_PIPE_KEY_NOT_REAL'),false);assert.equal(stdout.includes('SYNTHETIC_PIPE_KEY_NOT_REAL'),false);
 const report=JSON.parse(readFileSync(join(output,'live-result.json'),'utf8'));
 assert.equal(report.realModelExecuted,false);assert.equal(report.actualProviderCostUsd,null);assert.equal(report.acceptancePassed,null);
 const diagnostic=JSON.stringify({scenario,exit,process:report.process,recoveryIssue:report.recoveryIssue,workerFailure:report.workerClose?.failure??null});
 assert.equal(report.process.cleanupComplete,true,diagnostic);
 // A wall timeout before runtime readiness does not exercise stalled HTTP or a
 // synchronous runtime block. Initialization blocking must never claim ready.
 assert.equal(stdout.includes('live_probe_ready'),scenario!=='init_block',diagnostic);
 assert.equal(report.process.maxWallMs,30_000);assert.equal(report.process.termGraceMs,1500);assert.equal(report.process.killWaitMs,1500);
 return {report,exit,diagnostic};
 }finally{clearTimeout(timeout);child.stdin.destroy();rmSync(base,{recursive:true,force:true});}
}
test('review: real child lifecycle stays synthetic and fresh for successful probe',async()=>{
 const {report,exit,diagnostic}=await syntheticGuardian('synthetic');assert.equal(exit,0,diagnostic);assert.equal(report.probeMechanicsVerified,true,diagnostic);
 assert.equal(report.process.trigger,'child_exit',diagnostic);assert.equal(report.process.deadlineObserved,false,diagnostic);
 assert.deepEqual(report.process.exit,{observed:true,code:0,signal:null},diagnostic);
 assert.equal(report.process.outcome,'exited_zero',diagnostic);assert.equal(report.process.parentSignal,null,diagnostic);
 assert.equal(report.process.groupState,'absent',diagnostic);assert.deepEqual(report.process.issues,[],diagnostic);
 // Cold tsx imports can leave an unref'ed esbuild helper in the owned group
 // after the leader exits. Cleanup TERM is correct; helper exit may also race
 // the signal (not_found). Neither is a worker timeout or a signaled worker.
 assert.ok(['not_attempted','sent','not_found'].includes(report.process.signals.term),diagnostic);
 assert.equal(report.process.signals.kill,'not_attempted',diagnostic);
 assert.equal(report.recoveryIssue,null,diagnostic);assert.equal(report.workerClose.failure,null,diagnostic);
 assert.equal(report.workerClose.transport.transportInvocations,9);assert.equal(report.workerClose.acceptedDecisions,9);
 assert.equal(report.workerClose.control.confirmedCostUsd,null);assert.equal(report.workerClose.control.controlComplete,false);
});
test('review: HTTP failure stays unknown-cost and fails probe without retries',async()=>{
 const {report,exit,diagnostic}=await syntheticGuardian('http_failure');assert.notEqual(exit,0);assert.equal(report.probeMechanicsVerified,false);
 assert.equal(report.process.trigger,'child_exit',diagnostic);assert.ok(report.workerClose,diagnostic);
 assert.equal(report.workerClose.transport.transportInvocations,1);assert.equal(report.workerClose.transport.reason,'rate_limited');
});
for(const scenario of ['stall_headers','init_block','sync_block'])test(`review: independent guardian bounds ${scenario}`,async()=>{
 const {report,exit,diagnostic}=await syntheticGuardian(scenario);assert.notEqual(exit,0);assert.equal(report.probeMechanicsVerified,false);
 assert.equal(report.process.trigger,'wall_limit',diagnostic);assert.equal(report.process.deadlineObserved,true,diagnostic);
 assert.equal(report.process.signals.term,'sent',diagnostic);
 if(scenario==='sync_block'){assert.equal(report.process.signals.kill,'sent',diagnostic);assert.equal(report.process.exit.signal,'SIGKILL',diagnostic);}
 else{assert.equal(report.process.signals.kill,'not_attempted',diagnostic);
  if(scenario==='init_block')assert.equal(report.process.exit.signal,'SIGTERM',diagnostic);
  else assert.ok(report.workerClose,diagnostic);}
});
test('review: parent EOF stops pending synthetic request and observes cleanup',async()=>{
 const {report,exit,diagnostic}=await syntheticGuardian('stall_headers',true);assert.notEqual(exit,0);assert.equal(report.probeMechanicsVerified,false);
 assert.equal(report.process.trigger,'parent_disconnect',diagnostic);
});

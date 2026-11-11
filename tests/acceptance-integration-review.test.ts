import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,fsyncSync,closeSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence,type EvidenceWriterIo} from '../src/server/acceptance-evidence-writer.js';
import {type AcceptanceClock,type AcceptanceStopOptions} from '../src/server/acceptance-stop-control.js';
import {DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {ModelResult} from '../src/server/decisions.js';

class Clock implements AcceptanceClock {
 value=100;callback:(()=>void)|undefined;
 now=()=>this.value;
 setTimer=(callback:()=>void)=>{this.callback=callback;return 1;};
 clearTimer=()=>{this.callback=undefined;};
}
const reply:ModelResult & {acceptanceCostUsd:number}={decision:{intention:'Synthetic offline wait',actions:[{type:'wait',minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1,acceptanceCostUsd:0};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(t:TestContext,settings:{ready?:boolean;stop?:Partial<AcceptanceStopOptions>;io?:Partial<EvidenceWriterIo>}={}){
 t.mock.timers.enable({apis:['setInterval']});
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Forbidden network');});
 let wall=100000;t.mock.method(Date,'now',()=>wall);
 const root=mkdtempSync(join(testTmpdir(),'acceptance-integration-review-')),directory=join(root,'run');
 const store=new WorldStore(':memory:'),world=createFrontierWorld(),clock=new Clock();
 for(const resident of world.residents){resident.lastDecisionAt=world.minute;if(!settings.ready)resident.decisionDue=world.minute+10000;}
 store.commit(world,null);
 const writer=new AcceptanceEvidenceWriter({directory,worldId:world.id,fromMinute:world.minute,sourceFingerprint:'a'.repeat(64),io:settings.io});
 const pending:Array<{resolve:(result:typeof reply)=>void;reject:(error:Error)=>void;signal:AbortSignal}>=[];
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'SYNTHETIC_ONLY'}],(_key,_c,_f,_m,_p,execution)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal:execution!.signal})),{
  modelSlots:1,acceptanceStop:{endGameMinute:481,maxWallMs:10000,maxRequests:20,allowedModels:[DEEPSEEK_MODEL],clock,
   assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:100000}),...settings.stop},
  acceptanceEvidence:{writer,sourceFingerprintAfter:()=> 'a'.repeat(64)},
 });
 t.after(()=>{runtime.stop();writer.abort();store.close();rmSync(root,{recursive:true,force:true});});
 return {runtime,store,writer,pending,clock,directory,read:()=>readAcceptanceEvidence(directory),bytes:()=>readFileSync(join(directory,'evidence.jsonl')),
  tick(){wall+=1000;clock.value+=1000;runtime.tick(wall);}};
}

test('independent integration: stop storage failure records shutdown issue before leaving an unsealed prefix',async t=>{
 const f=fixture(t,{ready:true});f.runtime.start();assert.equal(f.pending.length,1);
 t.mock.method(f.store,'commit',()=>{throw new Error('SYNTHETIC_PRIVATE_STORAGE');});f.runtime.stop();
 const report=f.read();assert.equal(report.complete,false);assert.equal(existsSync(join(f.directory,'run-close.json')),false);
 assert.ok(report.acceptanceControl.finalStatus?.issues.includes('shutdown_failed'));
 assert.equal(report.acceptanceControl.interruptedRequests,null);assert.equal(report.directEating.totals,null);
 assert.equal(report.acceptanceControl.finalStatus?.unfinishedRequests[0].dispatched,true);assert.equal(f.pending[0].signal.aborted,true);
 const bytes=f.bytes(),revision=f.runtime.world.revision;f.pending[0].resolve(reply);await flush();
 assert.deepEqual(f.bytes(),bytes);assert.equal(f.runtime.world.revision,revision);assert.equal(bytes.toString().includes('PRIVATE'),false);
});

for(const phase of ['step','close'] as const)test(`independent integration: ${phase} fsync failure revokes work and cannot verify control`,async t=>{
 let armed=false;const f=fixture(t,{ready:phase==='close',io:{fsyncSync(fd){if(armed)throw new Error('SYNTHETIC_PRIVATE_SYNC');fsyncSync(fd);}}});
 f.runtime.start();armed=true;if(phase==='step')f.tick();else f.runtime.stop();
 assert.equal(f.writer.status().phase,'failed');assert.equal(f.runtime.acceptanceStopStatus()!.phase,'stopped');
 const report=f.read();assert.equal(report.complete,false);assert.equal(report.acceptanceControl.verified,false);assert.equal(report.directEating.totals,null);
 assert.ok(f.runtime.acceptanceStopStatus()!.issues.includes('evidence_persistence_failed'));
 const bytes=f.bytes();if(f.pending[0]){assert.equal(f.pending[0].signal.aborted,true);f.pending[0].reject(new Error('Late synthetic rejection'));await flush();}
 assert.deepEqual(f.bytes(),bytes);
});

for(const mode of ['throw','async'] as const)test(`independent integration: ${mode} endpoint observer preserves raw endpoint without a successful seal`,async t=>{
 const observeEndpoint=mode==='throw'?()=>{throw new Error('SYNTHETIC_PRIVATE_ENDPOINT');}:async()=>{throw new Error('SYNTHETIC_PRIVATE_ENDPOINT');};
 const f=fixture(t,{stop:{observeEndpoint}});f.runtime.start();f.tick();await flush();
 const report=f.read();assert.equal(f.store.loadForRuntime()!.minute,481);assert.equal(report.acceptanceControl.finalStatus?.endpoint?.gameMinute,481);
 assert.equal(report.acceptanceControl.finalStatus?.reason,'endpoint_observer_failed');assert.equal(report.complete,false);
 assert.equal(report.acceptanceControl.gameScopeComplete,false);assert.equal(existsSync(join(f.directory,'run-close.json')),false);
 assert.equal(f.bytes().toString().includes('PRIVATE'),false);
});

test('independent integration: subscriber reentry cancels a reservation before transport with zero dispatches',t=>{
 const f=fixture(t,{ready:true});let fired=false;
 f.runtime.subscribe(()=>{if(!fired&&f.runtime.world.metrics.requests){fired=true;f.runtime.stopAcceptance('signal');}});
 f.runtime.start();assert.equal(fired,true);assert.equal(f.pending.length,0);
 const report=f.read();assert.equal(report.complete,true);assert.equal(report.reason,'signal');
 assert.equal(report.acceptanceControl.finalStatus?.requestReservations,1);assert.equal(report.acceptanceControl.finalStatus?.dispatchedRequests,0);
 assert.deepEqual(report.acceptanceControl.finalStatus?.unfinishedRequests,[{id:1,model:DEEPSEEK_MODEL,dispatched:false}]);
 assert.equal(report.acceptanceControl.unknownCostRequests,0);assert.equal(report.acceptanceControl.controlComplete,false);
});

test('independent integration: start exactly at endpoint records zero-duration scope without transport',t=>{
 const f=fixture(t,{stop:{endGameMinute:480}});f.runtime.start();
 const report=f.read();assert.equal(report.complete,true);assert.equal(report.reason,'game_endpoint');
 assert.equal(report.directEating.observedGameMinutes,0);assert.equal(report.acceptanceControl.controlComplete,true);
 assert.equal(report.acceptancePassed,null);assert.equal(report.realModelExecuted,null);assert.equal(f.pending.length,0);
 assert.equal(f.clock.callback,undefined);assert.throws(()=>f.runtime.start(),/single_use/);
});

test('independent integration: pre-aborted signal closes both channels without model or timer admission',t=>{
 const signal=new AbortController();signal.abort();const f=fixture(t,{ready:true,stop:{signal:signal.signal}});f.runtime.start();
 const report=f.read();assert.equal(report.complete,true);assert.equal(report.reason,'signal');
 assert.equal(report.acceptanceControl.finalStatus?.dispatchedRequests,0);assert.equal(report.acceptanceControl.controlComplete,false);
 assert.equal(f.pending.length,0);assert.equal(f.clock.callback,undefined);
});

test('independent integration: read-only crash prefix keeps final cancellation and billing unknown',t=>{
 const f=fixture(t,{ready:true});f.runtime.start();const before=f.bytes(),report=f.read();
 assert.equal(report.acceptanceControl.lastObservedStatus?.phase,'running');assert.equal(report.acceptanceControl.finalStatus,null);
 assert.equal(report.acceptanceControl.unknownCostRequests,null);assert.equal(report.acceptanceControl.confirmedCostUsd,null);
 assert.equal(report.acceptanceControl.remoteCancellationConfirmed,false);assert.equal(report.complete,false);
 assert.deepEqual(f.bytes(),before);assert.equal(f.pending[0].signal.aborted,false);
 // Abort the synthetic capture to emulate an unsealed journal, without killing a process.
 f.writer.abort();f.runtime.stop();assert.equal(f.read().complete,false);
});

test('independent integration: truncating a sealed control record invalidates every derived completion flag',t=>{
 const f=fixture(t);f.runtime.start();f.tick();assert.equal(f.read().complete,true);
 const file=join(f.directory,'evidence.jsonl'),rows=f.bytes().toString().split('\n');
 let controlRow=-1;for(let index=0;index<rows.length;index++)if(rows[index].includes('"kind":"acceptance_control"'))controlRow=index;
 writeFileSync(file,rows.slice(0,controlRow).join('\n')+'\n'+rows[controlRow].slice(0,40));
 const before=f.bytes(),report=f.read();assert.equal(report.complete,false);assert.equal(report.acceptanceControl.verified,false);
 assert.equal(report.acceptanceControl.controlComplete,false);assert.equal(report.acceptanceControl.confirmedCostUsd,null);
 assert.equal(report.directEating.totals,null);assert.deepEqual(f.bytes(),before);
});

test('independent integration: journal close fault after final control cannot retroactively produce a complete run',t=>{
 let armed=false;const f=fixture(t,{io:{closeSync(fd){if(armed)throw new Error('SYNTHETIC_PRIVATE_CLOSE');closeSync(fd);}}});
 f.runtime.start();armed=true;f.tick();
 assert.equal(f.runtime.acceptanceStopStatus()!.controlComplete,false);assert.ok(f.runtime.acceptanceStopStatus()!.issues.includes('evidence_persistence_failed'));
 const report=f.read();assert.equal(report.acceptanceControl.finalStatus?.reason,'game_endpoint');
 assert.equal(report.complete,false);assert.equal(report.acceptanceControl.verified,false);assert.equal(report.acceptanceControl.controlComplete,false);
});

test('independent integration: failed world step followed by successful shutdown cannot seal the earlier failure',t=>{
 const f=fixture(t);f.runtime.start();const original=f.store.commit.bind(f.store);let first=true;
 t.mock.method(f.store,'commit',(...args:Parameters<WorldStore['commit']>)=>{if(first){first=false;throw new Error('Synthetic step failure');}return original(...args);});
 f.tick();const report=f.read();assert.equal(f.runtime.world.minute,480);assert.equal(f.store.loadForRuntime()!.minute,480);
 assert.equal(report.acceptanceControl.finalStatus?.reason,'runtime_failed');assert.equal(report.complete,false);
 assert.equal(report.directEating.totals,null);assert.equal(existsSync(join(f.directory,'run-close.json')),false);
});

test('independent integration: committed endpoint with throwing subscriber cannot be mistaken for a sampled endpoint',t=>{
 const f=fixture(t);f.runtime.start();f.runtime.subscribe(()=>{if(f.runtime.world.minute===481)throw new Error('Synthetic subscriber failure');});f.tick();
 const report=f.read();assert.equal(f.store.loadForRuntime()!.minute,481);assert.equal(report.acceptanceControl.finalStatus?.reason,'runtime_failed');
 assert.ok(report.acceptanceControl.finalStatus?.issues.includes('shutdown_failed'));
 assert.equal(report.acceptanceControl.finalStatus?.endpoint,null);assert.equal(report.complete,false);assert.equal(report.acceptanceControl.controlComplete,false);
});

test('independent integration: signal from post-commit subscriber records the durable minute before endpoint sampling',t=>{
 const f=fixture(t);f.runtime.start();let stopped=false;
 f.runtime.subscribe(()=>{if(!stopped&&f.runtime.world.minute>480){stopped=true;f.runtime.stopAcceptance('signal');}});
 f.tick();const report=f.read();
 assert.equal(stopped,true);assert.equal(f.store.loadForRuntime()!.minute,481);
 assert.equal(report.acceptanceControl.finalStatus?.throughMinute,481,'terminal control must describe the already committed world');
 assert.equal(report.acceptanceControl.finalStatus?.endpoint,null,'subscriber stop precedes endpoint sampling');
 assert.equal(report.reason,'signal');assert.equal(report.complete,true,report.issues.join(','));
 assert.equal(report.toMinute,481);assert.equal(report.acceptanceControl.verified,true);assert.equal(report.acceptanceControl.controlComplete,false);
});

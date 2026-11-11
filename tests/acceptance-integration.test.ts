import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,existsSync,fsyncSync,writeSync,closeSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence,type EvidenceWriterOptions} from '../src/server/acceptance-evidence-writer.js';
import {bindAcceptanceTermination,type AcceptanceClock,type AcceptanceStopOptions} from '../src/server/acceptance-stop-control.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {ModelResult} from '../src/server/decisions.js';
const fingerprint='c'.repeat(64),flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const reply:ModelResult & {acceptanceCostUsd?:number}={decision:{intention:'PRIVATE_SYNTHETIC_REPLY',actions:[{type:'wait',minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1,acceptanceCostUsd:0};
class Clock implements AcceptanceClock {
 value=100;next=0;timers=new Map<number,{at:number;callback:()=>void}>();now=()=>this.value;
 setTimer=(callback:()=>void,ms:number)=>{const id=++this.next;this.timers.set(id,{at:this.value+ms,callback});return id;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
 advance(ms:number,fire=false){this.value+=ms;if(fire)for(const [id,timer] of [...this.timers])if(timer.at<=this.value){this.timers.delete(id);timer.callback();}}
}
function fixture(t:TestContext,settings:{ready?:boolean;control?:Partial<AcceptanceStopOptions>;io?:EvidenceWriterOptions['io'];sourceAfter?:()=>string}={}){
 t.mock.timers.enable({apis:['setInterval']});let wall=1_700_000_000_000;const clock=new Clock();
 t.mock.method(Date,'now',()=>wall);t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network forbidden');});
 const root=mkdtempSync(join(testTmpdir(),'valley-integrated-')),directory=join(root,'run'),store=new WorldStore(':memory:'),world=createFrontierWorld();
 for(const resident of world.residents){resident.lastDecisionAt=world.minute;if(settings.ready===false)resident.decisionDue=world.minute+10000;}
 store.commit(world,null);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:world.id,fromMinute:world.minute,io:settings.io});
 const pending:Array<{resolve:(value:typeof reply)=>void;reject:(reason:unknown)=>void;signal:AbortSignal}>=[];
 const control:AcceptanceStopOptions={endGameMinute:482.5,maxWallMs:100_000,maxRequests:100,allowedModels:[DEEPSEEK_MODEL],clock,
  assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:1_000_000}),...settings.control};
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'PRIVATE_SYNTHETIC_KEY'}],(_key,_context,_feedback,_model,_prepared,execution)=>
  new Promise((resolve,reject)=>pending.push({resolve,reject,signal:execution!.signal})),{modelSlots:2,acceptanceStop:control,
   acceptanceEvidence:{writer,sourceFingerprintAfter:settings.sourceAfter??(()=>fingerprint)}});
 t.after(()=>{runtime.stop();writer.abort();store.close();rmSync(root,{recursive:true,force:true});});
 return {root,directory,store,writer,runtime,pending,clock,advance(ms:number,fire=false){wall+=ms;clock.advance(ms,fire);},tick(){runtime.tick(wall);}};
}
const contents=(directory:string)=>readdirSync(directory).sort().map(name=>[name,readFileSync(join(directory,name),'utf8')]);

test('integrated endpoint seals after both channels and exact nine-resident control, without real model claims',t=>{
 const f=fixture(t,{ready:false});f.runtime.start();f.advance(2000);f.tick();f.advance(1000);f.tick();
 const report=readAcceptanceEvidence(f.directory),control=report.acceptanceControl.finalStatus!;
 assert.equal(f.writer.status().phase,'closed');assert.equal(report.complete,true);assert.equal(report.reason,'game_endpoint');
 assert.equal(control.endpoint?.gameMinute,482.5);assert.equal(control.endpoint?.residents.length,9);assert.equal(control.throughMinute,482.5);
 assert.equal(report.acceptanceControl.verified,true);assert.equal(report.acceptanceControl.controlComplete,true);assert.equal(report.acceptanceControl.freeModelAvailabilityVerified,false);
 assert.equal(report.realModelExecuted,null);assert.equal(report.acceptancePassed,null);assert.equal(report.foodConsumption,null);assert.equal(report.grossHealthDamage,null);
 const rows=readFileSync(join(f.directory,'evidence.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(rows.at(-2).kind,'acceptance_control');assert.equal(rows.at(-2).payload.phase,'stopped');assert.equal(rows.at(-1).kind,'close_status');
 assert.ok(rows.findIndex(row=>row.payload.type==='food_session_stopped')<rows.length-2);
 assert.equal(JSON.stringify(contents(f.directory)).includes('PRIVATE_SYNTHETIC'),false);
 assert.equal(f.store.loadForRuntime()!.minute,482.5);assert.equal(f.pending.length,0);
});

test('wall stop is a sealed interrupted segment with unknown cost, not endpoint success; late replies cannot append',async t=>{
 const f=fixture(t,{control:{maxWallMs:1000}});f.runtime.start();assert.equal(f.pending.length,2);f.advance(1000,true);
 const report=readAcceptanceEvidence(f.directory),before=contents(f.directory),revision=f.runtime.world.revision;
 assert.equal(report.complete,true);assert.equal(report.reason,'wall_limit');assert.equal(report.acceptanceControl.controlComplete,false);
 assert.equal(report.acceptanceControl.finalStatus!.endpoint,null);assert.equal(report.acceptanceControl.interruptedRequests,2);
 assert.equal(report.acceptanceControl.finalStatus!.unfinishedRequests.length,2);assert.equal(report.acceptanceControl.unknownCostRequests,2);
 assert.equal(report.acceptanceControl.confirmedCostUsd,null);assert.equal(report.acceptanceControl.remoteCancellationConfirmed,false);
 assert.ok(f.pending.every(request=>request.signal.aborted));f.pending[0].resolve(reply);f.pending[1].reject(new Error('late private failure'));await flush();
 assert.equal(f.runtime.world.revision,revision);assert.deepEqual(contents(f.directory),before);
});

test('request ceiling persists actual dispatch and reservation counts without admitting a refill',async t=>{
 const f=fixture(t,{control:{maxRequests:2}});f.runtime.start();f.pending[0].resolve(reply);await flush();
 const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,true);assert.equal(report.reason,'request_limit');
 assert.equal(report.acceptanceControl.finalStatus!.requestReservations,2);assert.equal(report.acceptanceControl.finalStatus!.dispatchedRequests,2);
 assert.equal(report.acceptanceControl.finalStatus!.settledResponses,1);assert.equal(report.acceptanceControl.interruptedRequests,1);
 assert.equal(f.pending.length,2);assert.equal(f.runtime.world.metrics.successes,1);
});

for(const cost of [undefined,.03])test(`billing ${cost===undefined?'unknown':'nonzero'} remains terminal evidence and never becomes an accepted plan`,async t=>{
 const f=fixture(t);f.runtime.start();f.pending[0].resolve({...reply,acceptanceCostUsd:cost});await flush();const report=readAcceptanceEvidence(f.directory);
 assert.equal(report.complete,true);assert.equal(report.reason,cost===undefined?'cost_unknown':'nonzero_cost');assert.equal(report.acceptanceControl.controlComplete,false);
 assert.equal(report.acceptanceControl.confirmedCostUsd,null);assert.equal(f.runtime.world.metrics.successes,0);assert.equal(f.pending.length,2);
});

test('SIGTERM source closes once, unbinds explicitly, and leaves remote cancellation unknown',t=>{
 const f=fixture(t),source=new EventEmitter();f.runtime.start();const unbind=bindAcceptanceTermination(source,()=>f.runtime.stopAcceptance('signal'));
 source.emit('SIGTERM');const before=contents(f.directory);source.emit('SIGINT');unbind();
 assert.equal(readAcceptanceEvidence(f.directory).reason,'signal');assert.deepEqual(contents(f.directory),before);assert.equal(source.listenerCount('SIGTERM'),0);
});

test('failed game commit remains unsealed even when a later shutdown commit succeeds',t=>{
 const f=fixture(t,{ready:false});f.runtime.start();const commit=f.store.commit.bind(f.store);let failed=false;
 t.mock.method(f.store,'commit',(...args:Parameters<WorldStore['commit']>)=>{if(!failed){failed=true;throw new Error('PRIVATE_DISK_FAILURE');}return commit(...args);});
 f.advance(1000);f.tick();const report=readAcceptanceEvidence(f.directory);
 assert.equal(f.runtime.acceptanceStopStatus()!.reason,'runtime_failed');assert.equal(f.writer.status().phase,'failed');assert.equal(existsSync(join(f.directory,'run-close.json')),false);
 assert.equal(report.complete,false);assert.equal(report.acceptanceControl.finalStatus?.reason,'runtime_failed');assert.equal(report.acceptanceControl.verified,false);
 assert.equal(report.directEating.totals,null);assert.equal(report.acceptanceControl.unknownCostRequests,null);assert.equal(report.toMinute,null);
 assert.equal(f.store.loadForRuntime()!.minute,480);assert.equal(JSON.stringify(contents(f.directory)).includes('PRIVATE_DISK'),false);
});

for(const operation of ['write','sync'] as const)test(`terminal control ${operation} failure cannot publish a successful seal`,t=>{
 let fail=false;const io:EvidenceWriterOptions['io']=operation==='sync'?{fsyncSync:fd=>{if(fail)throw new Error('PRIVATE_SYNC');fsyncSync(fd);}}
  :{writeSync:((...args:Parameters<typeof writeSync>)=>{if(fail)throw new Error('PRIVATE_WRITE');return (writeSync as any)(...args);}) as typeof writeSync};
 const f=fixture(t,{ready:false,io});f.runtime.start();fail=true;f.runtime.stop();
 const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.equal(existsSync(join(f.directory,'run-close.json')),false);
 assert.ok(f.runtime.acceptanceStopStatus()!.issues.includes('evidence_persistence_failed'));assert.equal(report.acceptanceControl.verified,false);assert.equal(report.decisionWaiting.counts,null);
});

for(const value of ['different','throws'] as const)test(`source recheck ${value} leaves an unsealed segment rather than substituting the starting fingerprint`,t=>{
 const f=fixture(t,{ready:false,sourceAfter:()=>{if(value==='throws')throw new Error('PRIVATE_SOURCE_ERROR');return 'd'.repeat(64);}});
 f.runtime.start();f.runtime.stop();assert.equal(existsSync(join(f.directory,'run-close.json')),false);
 assert.equal(readAcceptanceEvidence(f.directory).complete,false);assert.ok(f.runtime.acceptanceStopStatus()!.issues.includes('evidence_persistence_failed'));
});

test('defaults stay disconnected and conflicting evidence observers are rejected before any world read',t=>{
 const f=fixture(t,{ready:false});const store=new WorldStore(':memory:');let reads=0;t.mock.method(store,'loadForRuntime',()=>{reads++;throw new Error('must not read');});
 try{
  assert.throws(()=>new ValleyRuntime(store,null,undefined,{acceptanceEvidence:{writer:f.writer,sourceFingerprintAfter:()=>fingerprint}}),/exclusive_controlled_channels/);
  assert.equal(reads,0);
 }finally{store.close();}
});

test('exclusive run directory rejects reuse and read-only recovery never edits a failed segment',t=>{
 const f=fixture(t,{ready:false});f.runtime.start();f.writer.abort();f.advance(1000);f.tick();
 const before=contents(f.directory),report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.deepEqual(contents(f.directory),before);
 assert.throws(()=>new AcceptanceEvidenceWriter({directory:f.directory,sourceFingerprint:fingerprint,worldId:'anything',fromMinute:480}),/new_directory_required/);
 assert.deepEqual(contents(f.directory),before);assert.equal(report.acceptanceControl.confirmedCostUsd,null);
});

for(const signal of ['SIGTERM','SIGKILL'] as const)test(`synthetic child ${signal} distinguishes graceful sealing from crash recovery`,async t=>{
 const {spawnSync}=await import('node:child_process');
 const parent=mkdtempSync(join(testTmpdir(),'valley-process-integration-')),directory=join(parent,'child');t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const code=`import {WorldStore} from './src/server/store.ts';
 import {ValleyRuntime} from './src/server/runtime.ts';
 import {createFrontierWorld} from './src/world/formal-seed.ts';
 import {AcceptanceEvidenceWriter} from './src/server/acceptance-evidence-writer.ts';
 import {bindAcceptanceTermination} from './src/server/acceptance-stop-control.ts';
 import {DEEPSEEK_MODEL} from './src/server/model-completion.ts';
 globalThis.fetch=async()=>{throw new Error('Network forbidden');};Date.now=()=>1700000000000;
 const world=createFrontierWorld(),store=new WorldStore(':memory:');store.commit(world,null);
 const writer=new AcceptanceEvidenceWriter({directory:${JSON.stringify(directory)},sourceFingerprint:'${fingerprint}',worldId:world.id,fromMinute:480});
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'SYNTHETIC'}],async()=>new Promise(()=>{}),{
  modelSlots:1,acceptanceStop:{endGameMinute:22080,maxWallMs:1000,maxRequests:10,allowedModels:[DEEPSEEK_MODEL],
   clock:{now:()=>100,setTimer:()=>1,clearTimer:()=>{}},
   assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:10000})},
  acceptanceEvidence:{writer,sourceFingerprintAfter:()=>'${fingerprint}'}});
 const unbind=bindAcceptanceTermination(process,()=>{runtime.stopAcceptance('signal');unbind();store.close();});
 runtime.start();process.kill(process.pid,'${signal}');`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8',timeout:15000});
 if(signal==='SIGTERM')assert.equal(result.status,0,result.stderr);else assert.equal(result.signal,'SIGKILL',result.stderr);
 const before=contents(directory),report=readAcceptanceEvidence(directory);assert.deepEqual(contents(directory),before);
 assert.equal(report.complete,signal==='SIGTERM');assert.equal(report.acceptanceControl.controlComplete,false);
 if(signal==='SIGTERM'){assert.equal(report.reason,'signal');assert.equal(report.acceptanceControl.interruptedRequests,1);assert.equal(report.acceptanceControl.unknownCostRequests,1);}
 else {assert.equal(report.acceptanceControl.finalStatus,null);assert.equal(report.acceptanceControl.interruptedRequests,null);assert.equal(existsSync(join(directory,'run-close.json')),false);}
 assert.equal(report.acceptanceControl.confirmedCostUsd,null);assert.equal(report.downtimeMs,null);
 assert.throws(()=>new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'new',fromMinute:480}),/new_directory_required/);
 const next=new AcceptanceEvidenceWriter({directory:join(parent,'next-segment'),sourceFingerprint:fingerprint,worldId:'new-synthetic',fromMinute:480,previousRunId:report.runId!});
 assert.equal(readAcceptanceEvidence(join(parent,'next-segment')).previousRunId,report.runId);next.abort();assert.deepEqual(contents(directory),before);
});

for(const boundary of ['seal_sync','seal_close'] as const)test(`${boundary} failure after seal bytes exist is explicitly invalid on readback`,t=>{
 let sealFd=-1;
 const io:EvidenceWriterOptions['io']={writeSync:((fd:number,buffer:Buffer,offset:number,length:number,position:number|null)=>{
  if(buffer.toString('utf8').includes('"type":"acceptance_evidence_close"'))sealFd=fd;
  return writeSync(fd,buffer,offset,length,position);
 }) as typeof writeSync};
 if(boundary==='seal_sync')io.fsyncSync=fd=>{if(fd===sealFd)throw new Error('PRIVATE_SEAL_SYNC');fsyncSync(fd);};
 else {io.closeSync=fd=>{if(fd===sealFd)throw new Error('PRIVATE_SEAL_CLOSE');closeSync(fd);};}
 const f=fixture(t,{ready:false,io});f.runtime.start();f.runtime.stop();
 assert.equal(existsSync(join(f.directory,'run-close.json')),true,'physical seal bytes are not successful completion');
 const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.ok(report.issues.includes('writer_failure'));
 assert.equal(report.acceptanceControl.verified,false);assert.equal(report.acceptanceControl.controlComplete,false);
 assert.ok(f.runtime.acceptanceStopStatus()!.issues.includes('evidence_persistence_failed'));
});

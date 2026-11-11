import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AcceptanceStopControl,bindAcceptanceTermination,type AcceptanceClock,type AcceptanceStopOptions} from '../src/server/acceptance-stop-control.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DEEPSEEK_MODEL,GLM_MODEL,QWEN_MODEL,completeModel,type ModelName} from '../src/server/model-completion.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {ModelResult} from '../src/server/decisions.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const reply:ModelResult & {acceptanceCostUsd:number}={decision:{intention:'Synthetic wait',actions:[{type:'wait',minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1,acceptanceCostUsd:0};
class Clock implements AcceptanceClock {
 value=100;next=0;timers=new Map<number,{at:number;callback:()=>void}>();
 now=()=>this.value;
 setTimer=(callback:()=>void,ms:number)=>{const id=++this.next;this.timers.set(id,{at:this.value+ms,callback});return id;};
 clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
 advance(ms:number,fire=true){this.value+=ms;if(fire)for(const [id,timer] of [...this.timers])if(timer.at<=this.value){this.timers.delete(id);timer.callback();}}
}
function options(clock:Clock,overrides:Partial<AcceptanceStopOptions>={}):AcceptanceStopOptions{return {
 endGameMinute:22080,maxWallMs:100_000,maxRequests:100,allowedModels:[DEEPSEEK_MODEL],clock,
 assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:1_000_000}),...overrides,
};}
function fixture(t:TestContext,overrides:Partial<AcceptanceStopOptions>={},ready=true){
 t.mock.timers.enable({apis:['setInterval']});
 const clock=new Clock();let wall=1_700_000_000_000;
 t.mock.method(Date,'now',()=>wall);t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network forbidden');});
 const store=new WorldStore(':memory:'),world=createFrontierWorld();
 for(const r of world.residents){r.lastDecisionAt=world.minute;if(!ready)r.decisionDue=world.minute+10000;}
 store.commit(world,null);
 const pending:Array<{resolve:(result:ModelResult & {acceptanceCostUsd?:number})=>void;reject:(error:unknown)=>void;signal:AbortSignal}>=[];
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'SYNTHETIC_KEY'}],(_key,_context,_feedback,_model,_prepared,execution)=>
  new Promise((resolve,reject)=>pending.push({resolve,reject,signal:execution!.signal})),{modelSlots:2,acceptanceStop:options(clock,overrides)});
 t.after(()=>{runtime.stop();store.close();});
 return {runtime,store,pending,clock,advance(ms:number,fire=false){wall+=ms;clock.advance(ms,fire);},tick(){runtime.tick(wall);}};
}

test('fractional final step samples the exact committed nine-resident endpoint and cannot advance again',t=>{
 let sample:unknown;const f=fixture(t,{endGameMinute:482.5,observeEndpoint:value=>{sample=value;}},false);
 f.runtime.start();f.advance(2000);f.tick();assert.ok(Math.abs(f.runtime.world.minute-482.4)<1e-8);
 f.advance(1000);f.tick();const status=f.runtime.acceptanceStopStatus()!;
 assert.equal(f.runtime.world.minute,482.5);assert.equal(f.store.loadForRuntime()!.minute,482.5);
 assert.equal(status.reason,'game_endpoint');assert.equal(status.endpoint?.gameMinute,482.5);
 assert.equal(status.endpoint?.residents.length,9);assert.equal(status.endpoint,sample);assert.equal(Object.isFrozen(status.endpoint),true);
 assert.equal(status.controlComplete,true);assert.equal(status.acceptancePassed,null);assert.equal(status.remoteCancellationConfirmed,false);
 assert.equal(f.pending.length,0);f.advance(5000);f.tick();assert.equal(f.runtime.world.minute,482.5);
 assert.throws(()=>f.runtime.start(),/single_use/);assert.equal(f.clock.timers.size,0);
});

test('independent wall timer stops a paused or unresolved model and ignores all late settlements',async t=>{
 const f=fixture(t,{maxWallMs:1000});f.runtime.start();assert.equal(f.pending.length,2);
 f.advance(1000,true);const stopped=f.runtime.world.revision,status=f.runtime.acceptanceStopStatus()!;
 assert.equal(status.reason,'wall_limit');assert.equal(status.interruptedRequests,2);assert.equal(status.unknownCostRequests,2);
 assert.equal(status.confirmedCostUsd,null);assert.equal(status.endpoint,null);assert.equal(status.controlComplete,false);
 assert.ok(f.pending.every(p=>p.signal.aborted));f.pending[0].resolve(reply);f.pending[1].reject(new Error('late rejection'));await flush();
 assert.equal(f.runtime.world.revision,stopped);assert.equal(f.pending.length,2);assert.deepEqual(f.runtime.acceptanceStopStatus(),status);
});

test('request reservation cap covers refill admissions with no overshoot',async t=>{
 const f=fixture(t,{maxRequests:2});f.runtime.start();assert.equal(f.pending.length,2);
 f.pending[0].resolve(reply);await flush();const status=f.runtime.acceptanceStopStatus()!;
 assert.equal(status.reason,'request_limit');assert.equal(status.requestReservations,2);assert.equal(status.dispatchedRequests,2);
 assert.equal(status.settledResponses,1);assert.equal(status.interruptedRequests,1);assert.equal(f.pending.length,2);
 f.pending[1].resolve(reply);await flush();assert.equal(f.runtime.world.metrics.successes,1);
});

test('unknown billing is a terminal cost gap, not a successful plan or fallback retry',async t=>{
 const f=fixture(t);f.runtime.start();const {acceptanceCostUsd:_cost,...unmetered}=reply;f.pending[0].resolve(unmetered);await flush();
 assert.equal(f.runtime.acceptanceStopStatus()!.reason,'cost_unknown');assert.equal(f.runtime.world.metrics.successes,0);
 assert.equal(f.runtime.acceptanceStopStatus()!.unknownCostRequests,2);assert.equal(f.pending.length,2);
});

test('nonzero response charge is recorded and stops before plan application',async t=>{
 const f=fixture(t);f.runtime.start();f.pending[0].resolve({...reply,acceptanceCostUsd:.01});await flush();
 assert.equal(f.runtime.acceptanceStopStatus()!.reason,'nonzero_cost');assert.equal(f.runtime.world.metrics.successes,0);
 assert.equal(f.runtime.acceptanceStopStatus()!.confirmedCostUsd,null,'other interrupted request remains unknown');
});

test('failed request without a billing receipt stops, never tries another provider',async t=>{
 const f=fixture(t);f.runtime.start();f.pending[0].reject(new Error('model_http_429'));await flush();
 assert.equal(f.runtime.acceptanceStopStatus()!.reason,'cost_unknown');assert.equal(f.pending.length,2);assert.equal(f.runtime.world.metrics.successes,0);
});

test('invalid, unknown, paid and expired price assessments fail before any dispatch',()=>{
 for(const alter of [()=>null,(p:any)=>({...p,inputPerMillion:NaN}),(p:any)=>({...p,otherFees:-1}),
  (p:any)=>({...p,outputPerMillion:.01}),(p:any)=>({...p,validUntilMonotonicMs:100}),(p:any)=>({...p,model:GLM_MODEL})]){
  const clock=new Clock(),base=options(clock),control=new AcceptanceStopControl({...base,assessPrice:model=>alter(base.assessPrice(model))},()=>{});
  control.start(480);assert.equal(control.reserve(DEEPSEEK_MODEL,480),null);assert.equal(control.status().dispatchedRequests,0);assert.equal(control.status().controlComplete,false);
 }
});

test('allowlist excludes paid route names and is copied rather than dynamically expanded',()=>{
 const clock=new Clock();assert.throws(()=>new AcceptanceStopControl(options(clock,{allowedModels:[QWEN_MODEL]}),()=>{}),/invalid_acceptance/);
 const allowed:ModelName[]=[DEEPSEEK_MODEL];const control=new AcceptanceStopControl(options(clock,{allowedModels:allowed}),()=>{});
 allowed.push(GLM_MODEL as typeof DEEPSEEK_MODEL);control.start(480);assert.equal(control.reserve(GLM_MODEL,480),null);
 assert.equal(control.status().reason,'model_not_allowed');
});

test('price refresh and wall check happen immediately before dispatch after bookkeeping',t=>{
 const f=fixture(t,{maxWallMs:1000});let once=false;
 f.runtime.subscribe(()=>{if(!once&&f.runtime.world.metrics.requests){once=true;f.clock.advance(1000,false);}});
 f.runtime.start();assert.equal(f.pending.length,0);assert.equal(f.runtime.acceptanceStopStatus()!.reason,'wall_limit');
 assert.equal(f.runtime.acceptanceStopStatus()!.dispatchedRequests,0);assert.equal(f.runtime.acceptanceStopStatus()!.unknownCostRequests,0);
});

test('pre-aborted signal and signal during bookkeeping suppress the cached scheduling wave',t=>{
 const controller=new AbortController(),f=fixture(t,{signal:controller.signal});let once=false;
 f.runtime.subscribe(()=>{if(!once&&f.runtime.world.metrics.requests){once=true;controller.abort();}});
 f.runtime.start();assert.equal(f.pending.length,0);assert.equal(f.runtime.acceptanceStopStatus()!.reason,'signal');
 const clock=new Clock(),pre=new AbortController();pre.abort();const control=new AcceptanceStopControl(options(clock,{signal:pre.signal}),()=>{});
 control.start(480);assert.equal(control.status().reason,'signal');assert.equal(clock.timers.size,0);
});

test('rollback or unavailable monotonic clock leaves duration unknown and stops safely',()=>{
 for(const now of [()=>99,()=>NaN,()=>{throw new Error('no clock');}]){
  const clock=new Clock(),control=new AcceptanceStopControl(options(clock),()=>{});control.start(480);clock.now=now;
  assert.equal(control.check(480),false);assert.equal(control.status().reason,'clock_invalid');assert.equal(control.status().elapsedMs,null);
 }
});

test('explicit SIGINT/SIGTERM binding is removable and does not exit the process',()=>{
 const source=new EventEmitter(),clock=new Clock();let stops=0;
 const control=new AcceptanceStopControl(options(clock),()=>{stops++;});control.start(480);
 const unbind=bindAcceptanceTermination(source,()=>control.stop('signal'));
 source.emit('SIGTERM');source.emit('SIGINT');assert.equal(stops,1);assert.equal(control.status().reason,'signal');
 unbind();assert.equal(source.listenerCount('SIGINT'),0);assert.equal(source.listenerCount('SIGTERM'),0);
});

test('endpoint observer failure preserves exact local sample but never reports complete control',async t=>{
 const f=fixture(t,{endGameMinute:481,observeEndpoint:async()=>{throw new Error('private sink failure');}},false);
 f.runtime.start();f.advance(1000);f.tick();await flush();const status=f.runtime.acceptanceStopStatus()!;
 assert.equal(status.reason,'endpoint_observer_failed');assert.equal(status.endpoint?.gameMinute,481);assert.equal(status.controlComplete,false);
 assert.equal(JSON.stringify(status).includes('private'),false);
});

test('failed stop storage cannot keep requests alive or admit late replies',async t=>{
 const f=fixture(t,{maxWallMs:1000});f.runtime.start();t.mock.method(f.store,'commit',()=>{throw new Error('synthetic disk fault');});
 f.advance(1000,true);assert.ok(f.pending.every(p=>p.signal.aborted));assert.deepEqual(f.runtime.acceptanceStopStatus()!.issues,['shutdown_failed']);
 const revision=f.runtime.world.revision;f.pending[0].resolve(reply);f.pending[1].reject(new Error('late'));await flush();
 assert.equal(f.runtime.world.revision,revision);assert.equal(f.pending.length,2);
});

test('control cannot accidentally opt into the production model implementation',()=>{
 const clock=new Clock(),store=new WorldStore(':memory:');
 try{assert.throws(()=>new ValleyRuntime(store,null,undefined,{acceptanceStop:options(clock)}),/requires_injected_model/);assert.equal(store.loadForRuntime(),null);}finally{store.close();}
});

test('caller cancellation reaches mocked production fetch without issuing a real request',async t=>{
 const controller=new AbortController();let signal:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{signal=init?.signal as AbortSignal;return new Promise<Response>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));});
 const pending=completeModel('SYNTHETIC',DEEPSEEK_MODEL,[{role:'user',content:'synthetic'}],.25,controller.signal);
 assert.equal(signal?.aborted,false);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(signal?.aborted,true);
});

test('ordinary runtime restart discards old success and finally without deleting a new same-actor request',async t=>{
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network forbidden');});
 const store=new WorldStore(':memory:');const pending:Array<{resolve:(result:ModelResult)=>void;signal:AbortSignal}>=[];
 const runtime=new ValleyRuntime(store,'SYNTHETIC',(_key,_c,_f,_m,_p,execution)=>new Promise(resolve=>pending.push({resolve,signal:execution!.signal})),{modelSlots:1});
 try{runtime.start();runtime.stop();assert.equal(pending[0].signal.aborted,true);runtime.start();assert.equal(pending.length,2);
  pending[0].resolve(reply);await flush();assert.equal(runtime.world.metrics.successes,0);runtime.tick();assert.equal(pending.length,2);
  pending[1].resolve(reply);await flush();assert.equal(runtime.world.metrics.successes,1);assert.equal(pending.length,3);
 }finally{runtime.stop();store.close();}
});

for(const kind of ['unavailable','deadline'] as const)test(`final stop clock ${kind} cannot report successful control`,()=>{
 const clock=new Clock();let reads=0;
 clock.now=()=>{if(++reads===4){if(kind==='unavailable')throw new Error('Clock unavailable');return 1100;}return 100;};
 const control=new AcceptanceStopControl(options(clock,{endGameMinute:480,maxWallMs:1000}),()=>{});
 control.start(480);control.committed(createFrontierWorld());
 assert.equal(control.status().reason,kind==='unavailable'?'clock_invalid':'wall_limit');
 assert.equal(control.status().controlComplete,false);assert.equal(control.status().endpoint?.gameMinute,480);
});

import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {AcceptanceStopControl,type AcceptanceClock,type AcceptanceStopOptions} from '../src/server/acceptance-stop-control.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DEEPSEEK_MODEL,GLM_MODEL,type ModelName} from '../src/server/model-completion.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {ModelResult} from '../src/server/decisions.js';
import type {DecisionWaitEvent} from '../src/server/decision-wait-evidence.js';
class Clock implements AcceptanceClock {
 value=100; callback:(()=>void)|undefined; delay=0;
 now=()=>this.value;
 setTimer=(callback:()=>void,ms:number)=>{this.callback=callback;this.delay=ms;return 1;};
 clearTimer=()=>{this.callback=undefined;};
}
const price=(model:ModelName)=>({model,currency:'USD' as const,inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:100000});
const opts=(clock:Clock,extra:Partial<AcceptanceStopOptions>={}):AcceptanceStopOptions=>({endGameMinute:500,maxWallMs:1000,maxRequests:10,allowedModels:[DEEPSEEK_MODEL],clock,assessPrice:price,...extra});
const reply:ModelResult & {acceptanceCostUsd:number}={decision:{intention:'Offline wait',actions:[{type:'wait',minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1,acceptanceCostUsd:0};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function runtimeFixture(t:TestContext,observe:(event:DecisionWaitEvent)=>void,signal?:AbortSignal){
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(globalThis,'fetch',async()=>{throw new Error('Forbidden network');});
 const clock=new Clock(),store=new WorldStore(':memory:');store.commit(createFrontierWorld(),null);
 let resolve!:(result:typeof reply)=>void;
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'OFFLINE_ONLY'}],()=>new Promise(r=>{resolve=r;}),{modelSlots:1,acceptanceStop:opts(clock,{signal}),decisionWaitEvidence:{observe}});
 t.after(()=>{runtime.stop();store.close();});return {runtime,clock,resolve:()=>resolve(reply)};
}
for(const mode of ['throw','abort'] as const)test(`reply evidence ${mode} stops before applying a resident plan`,async t=>{
 const abort=new AbortController();let fired=false;
 const f=runtimeFixture(t,event=>{if(event.type==='request_finished'&&event.outcome==='reply'){fired=true;if(mode==='throw')throw new Error('Synthetic sink failure');abort.abort();}},abort.signal);
 f.runtime.start();f.resolve();await flush();assert.equal(fired,true);
 assert.equal(f.runtime.world.metrics.successes,0,'reply callback cannot permit post-stop plan application');
 assert.equal(f.runtime.acceptanceStopStatus()!.reason,mode==='throw'?'evidence_failed':'signal');
});

test('early timer firing rearms the remaining monotonic duration and paused work stops at equality',()=>{
 const clock=new Clock(),control=new AcceptanceStopControl(opts(clock),()=>{});control.start(480);
 clock.value=400;const early=clock.callback!;clock.callback=undefined;early();assert.equal(clock.delay,700);assert.equal(control.status().phase,'running');
 clock.value=1100;const final=clock.callback!;clock.callback=undefined;final();assert.equal(control.status().reason,'wall_limit');assert.equal(clock.callback,undefined);
});

test('expired price during assessment cannot admit even one request',()=>{
 const clock=new Clock(),control=new AcceptanceStopControl(opts(clock,{assessPrice:model=>{const result={...price(model),validUntilMonotonicMs:101};clock.value=101;return result;}}),()=>{});
 control.start(480);assert.equal(control.reserve(DEEPSEEK_MODEL,480),null);assert.equal(control.status().reason,'cost_unknown');assert.equal(control.status().dispatchedRequests,0);
});

test('all configured routes are checked, including an unused backup with unknown fees',()=>{
 const clock=new Clock(),control=new AcceptanceStopControl(opts(clock,{allowedModels:[DEEPSEEK_MODEL,GLM_MODEL],assessPrice:model=>model===GLM_MODEL?null:price(model)}),()=>{});
 control.start(480);assert.equal(control.validateModels([DEEPSEEK_MODEL,GLM_MODEL]),false);assert.equal(control.status().reason,'cost_unknown');assert.equal(control.status().dispatchedRequests,0);
});

test('reentrant price assessment cannot exceed the reservation ceiling',()=>{
 const clock=new Clock();let nested=false;let control:AcceptanceStopControl;
 control=new AcceptanceStopControl(opts(clock,{maxRequests:1,assessPrice:model=>{if(!nested){nested=true;control.reserve(model,480);}return price(model);}}),()=>{});
 control.start(480);control.reserve(DEEPSEEK_MODEL,480);assert.ok(control.status().requestReservations<=1);
});

test('duplicate dispatch and forged tokens never count a second request',()=>{
 const clock=new Clock(),control=new AcceptanceStopControl(opts(clock),()=>{});control.start(480);
 const token=control.reserve(DEEPSEEK_MODEL,480)!;assert.equal(control.dispatch({...token},480),false);assert.equal(control.dispatch(token,480),true);assert.equal(control.dispatch(token,480),false);
 assert.equal(control.status().dispatchedRequests,1);control.stop();assert.equal(token.signal.aborted,true);assert.equal(control.settle(token,480,0),false);
});

test('shutdown and timer cleanup faults remain explicit rather than completing the run',()=>{
 const clock=new Clock();clock.clearTimer=()=>{throw new Error('Synthetic clear fault');};
 const control=new AcceptanceStopControl(opts(clock),()=>{throw new Error('Synthetic shutdown fault');});control.start(480);control.stop();
 assert.deepEqual(control.status().issues,['timer_failed','shutdown_failed']);assert.equal(control.status().controlComplete,false);
});

test('throwing final subscriber leaves exact committed minute but explicitly missing endpoint evidence',t=>{
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(globalThis,'fetch',async()=>{throw new Error('Forbidden network');});
 let wall=100000;t.mock.method(Date,'now',()=>wall);
 const clock=new Clock(),store=new WorldStore(':memory:'),world=createFrontierWorld();
 for(const person of world.residents){person.lastDecisionAt=world.minute;person.decisionDue=world.minute+1000;}
 store.commit(world,null);let calls=0;
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'OFFLINE_ONLY'}],async()=>{calls++;return reply;},{acceptanceStop:opts(clock,{endGameMinute:481,maxWallMs:10000})});
 t.after(()=>{runtime.stop();store.close();});runtime.start();
 runtime.subscribe(()=>{if(runtime.world.minute===481)throw new Error('Synthetic final subscriber fault');});
 wall+=1000;runtime.tick(wall);
 assert.equal(store.loadForRuntime()!.minute,481);assert.equal(runtime.world.minute,481);assert.equal(calls,0);
 const status=runtime.acceptanceStopStatus()!;assert.equal(status.reason,'runtime_failed');assert.equal(status.endpoint,null);assert.equal(status.controlComplete,false);assert.ok(status.issues.includes('shutdown_failed'));
});

test('manual stop captures evidence-close failure without leaking or restarting requests',t=>{
 const f=runtimeFixture(t,event=>{if(event.type==='session_stopped')throw new Error('Synthetic close fault');});f.runtime.start();f.runtime.stop();
 const status=f.runtime.acceptanceStopStatus()!;assert.equal(status.reason,'manual_stop');assert.equal(status.phase,'stopped');assert.ok(status.issues.includes('shutdown_failed'));assert.equal(status.controlComplete,false);
});

test('reentrant price assessment cannot dispatch the same token twice',()=>{
 const clock=new Clock();let token:ReturnType<AcceptanceStopControl['reserve']>=null,nested=false;let control:AcceptanceStopControl;
 control=new AcceptanceStopControl(opts(clock,{assessPrice:model=>{if(token&&!nested){nested=true;control.dispatch(token,480);}return price(model);}}),()=>{});
 control.start(480);token=control.reserve(DEEPSEEK_MODEL,480)!;control.dispatch(token,480);
 assert.equal(control.status().dispatchedRequests,1);control.stop();assert.equal(control.status().interruptedRequests,1);
});

test('acceptance stop persistence failure leaves both evidence channels open and totals unknown',async t=>{
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(globalThis,'fetch',async()=>{throw new Error('Forbidden network');});
 const clock=new Clock(),store=new WorldStore(':memory:');store.commit(createFrontierWorld(),null);
 const waits:DecisionWaitEvent[]=[],foods:import('../src/server/runtime-food-evidence.js').RuntimeFoodEvent[]=[];
 let resolve!:(result:typeof reply)=>void,signal:AbortSignal|undefined;
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'OFFLINE_ONLY'}],(_k,_c,_f,_m,_p,execution)=>new Promise(r=>{resolve=r;signal=execution!.signal;}),{
  modelSlots:1,acceptanceStop:opts(clock),decisionWaitEvidence:{observe:event=>{waits.push(event);}},directEatingEvidence:{observe:event=>{foods.push(event);}},
 });
 t.after(()=>{runtime.stop();store.close();});runtime.start();
 t.mock.method(store,'commit',()=>{throw new Error('Synthetic stop persistence failure');});runtime.stop();
 assert.equal(signal?.aborted,true);assert.equal(runtime.acceptanceStopStatus()!.phase,'stopped');assert.ok(runtime.acceptanceStopStatus()!.issues.includes('shutdown_failed'));
 assert.equal(runtime.decisionWaitEvidenceStatus()!.phase,'observing');assert.equal(runtime.directEatingEvidenceStatus()!.phase,'observing');
 assert.equal(waits.some(row=>row.type==='session_stopped'),false);assert.equal(foods.some(row=>row.type==='food_session_stopped'),false);
 const {auditDecisionWaitEvidence,auditRuntimeFoodEvidence}=await import('../src/server/nine-resident-acceptance.js');
 assert.equal(auditDecisionWaitEvidence(waits,runtime.decisionWaitEvidenceStatus()).counts,null);
 assert.equal(auditRuntimeFoodEvidence(foods,runtime.directEatingEvidenceStatus()).totals,null);
 const revision=runtime.world.revision,waitCount=waits.length,foodCount=foods.length;resolve(reply);await flush();
 assert.equal(runtime.world.revision,revision);assert.equal(waits.length,waitCount);assert.equal(foods.length,foodCount);
});

test('stop from initial evidence callback cannot arm or restart acceptance control',t=>{
 let runtime:ValleyRuntime|undefined;
 const f=runtimeFixture(t,event=>{if(event.type==='session_started')runtime!.stop();});runtime=f.runtime;
 assert.doesNotThrow(()=>runtime!.start());assert.equal(runtime.acceptanceStopStatus()!.reason,'manual_stop');assert.equal(runtime.acceptanceStopStatus()!.dispatchedRequests,0);assert.equal(f.clock.callback,undefined);
 assert.throws(()=>runtime!.start(),/single_use/);
});

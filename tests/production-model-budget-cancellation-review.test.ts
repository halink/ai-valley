import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {ModelBudget} from '../src/server/model-budget.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';

function fixture(t:TestContext,kind:'dispatch_drain'|'concurrent'|'stop'|'throw_admission'|'model_throw'|'stale_rejection'){
 const now=1_000_000;
 t.mock.method(Date,'now',()=>now);t.mock.method(performance,'now',()=>now);
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 t.mock.method(globalThis,'setTimeout',(()=>0) as unknown as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',(()=>{}) as typeof clearTimeout);
 const store=new WorldStore(':memory:');store.commit(createFrontierWorld(5401),null);
 let runtime:ValleyRuntime,budget:ModelBudget|undefined,calls=0,assessments=0,events=0,visible=0;
 let rejectModel:((error:Error)=>void)|undefined;
 const reserve=ModelBudget.prototype.reserve;
 t.mock.method(ModelBudget.prototype,'reserve',function(this:ModelBudget,...args:Parameters<ModelBudget['reserve']>){
  budget=this;
  // Deliberately equal small synthetic estimates allow two overlapping slots.
  return kind==='concurrent'?reserve.call(this,args[0],100,100):reserve.apply(this,args);
 });
 runtime=new ValleyRuntime(store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async()=>{
  calls++;if(kind==='model_throw')throw new Error('synthetic_model_failed');return new Promise<never>((_resolve,reject)=>{rejectModel=reject;});
 },{mode:'formal',modelSlots:kind==='concurrent'?2:1,
  acceptanceAdmission:()=>{if(kind==='throw_admission'&&runtime.world.metrics.requests)throw new Error('synthetic_admission_failed');return true;},
  decisionAdmissionCancelled:()=>{events++;},
  acceptanceStop:{endGameMinute:store.loadForRuntime()!.minute+60,maxWallMs:30000,maxRequests:20,allowedModels:[P.model],assessPrice:model=>{
   if(++assessments===3&&kind==='dispatch_drain')runtime.drainAcceptance();
   return {model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:now+30000};
  }}});
 runtime.subscribe(()=>{
  const w=runtime.world;
  if(w.metrics.admissionCancellation){
   visible++;assert.deepEqual(w.metrics.usageWindow?.[P.model],store.loadForRuntime()!.metrics.usageWindow?.[P.model]);
   assert.deepEqual(budget?.snapshot(),w.metrics.usageWindow?.[P.model],'subscriber sees durable and in-memory refund together');
  }
  if(kind==='stop'&&w.metrics.requests===1&&runtime.acceptanceStopStatus()?.phase==='running')runtime.stop();
  if(kind==='concurrent'&&w.metrics.requests===2&&!w.metrics.admissionCancellation)runtime.drainAcceptance();
 });
 t.after(()=>{runtime.stop();store.close();});
 return {runtime,store,rejectModel:()=>rejectModel!(new Error('synthetic_stale_rejection')),get budget(){return budget!;},get calls(){return calls;},get assessments(){return assessments;},get events(){return events;},get visible(){return visible;}};
}

test('budget review: drain during acceptance dispatch refunds before subscribers, without model invocation',t=>{
 const f=fixture(t,'dispatch_drain');f.runtime.start();
 assert.equal(f.assessments,3);assert.equal(f.calls,0);assert.equal(f.events,1);assert.ok(f.visible>0);
 assert.deepEqual(f.budget.snapshot(),[]);assert.deepEqual(f.store.loadForRuntime()!.metrics.usageWindow?.[P.model],[]);
 assert.equal(f.runtime.world.metrics.requests,1);assert.equal(f.runtime.world.metrics.admissionCancellation?.count,1);
});

test('budget review: cancellation removes only its own reservation while identical dispatched reservation stays',t=>{
 const f=fixture(t,'concurrent');f.runtime.start();
 assert.equal(f.calls,1);assert.equal(f.events,1);assert.equal(f.runtime.world.metrics.requests,2);assert.ok(f.visible>0);
 const expected=[{startedAt:1_000_000,input:100,output:100}];
 assert.deepEqual(f.budget.snapshot(),expected);assert.deepEqual(f.store.loadForRuntime()!.metrics.usageWindow?.[P.model],expected);
 f.runtime.stop();assert.deepEqual(f.budget.snapshot(),expected,'stopping other dispatched request cannot refund it');
});

for(const kind of ['stop','throw_admission','model_throw'] as const)test(`budget review: ${kind} is not proof of an unsent cancellation`,async t=>{
 const f=fixture(t,kind);f.runtime.start();await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(f.calls,kind==='model_throw'?1:0);assert.equal(f.events,0);assert.equal(f.runtime.world.metrics.admissionCancellation,undefined);
 const charges=f.store.loadForRuntime()!.metrics.usageWindow?.[P.model];assert.equal(charges?.length,1);assert.ok(charges![0].input>1000);
 assert.deepEqual(f.budget.snapshot(),charges);assert.equal(f.runtime.acceptanceStopStatus()?.reason,kind==='stop'?'manual_stop':kind==='model_throw'?'cost_unknown':'runtime_failed');
});


test('budget review: late rejection after generation revocation keeps unknown usage charged',async t=>{
 const f=fixture(t,'stale_rejection');f.runtime.start();assert.equal(f.calls,1);
 const charges=structuredClone(f.store.loadForRuntime()!.metrics.usageWindow?.[P.model]);
 f.runtime.stop();f.rejectModel();await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(f.events,0);assert.equal(f.runtime.world.metrics.admissionCancellation,undefined);
 assert.deepEqual(f.budget.snapshot(),charges);assert.deepEqual(f.store.loadForRuntime()!.metrics.usageWindow?.[P.model],charges);
});

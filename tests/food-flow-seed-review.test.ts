import test from 'node:test';
import assert from 'node:assert/strict';
import {seedFlowFixture,queueSeedFlow,finishSeedFlow,seedReceipts,reloadSeed} from './helpers/food-flow-seed.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE,type FoodFlowReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {initializeFood} from '../src/world/food.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {DAY} from '../src/world/time.js';

type Seed=Extract<FoodFlowReceipt,{action:'saveSeed'}>;
function receipt(at=DAY):Seed{return {type:'processed',action:'saveSeed',at,residentId:'review-person',eventId:'review-event',planId:'review-plan',container:'person:review-person',definition:'production/base@1',inputs:[{item:'turnip',quantity:1,nutrition:null,lots:null}],outputs:[{item:'seed',quantity:2,nutrition:0,lots:[]}]};}
function observation(f:Seed):DirectEatingObservation{return {worldId:'review-world',fromMinute:f.at-1,toMinute:f.at,receipts:[],foodFlows:[f],foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function eating(f:Seed){return {at:f.at,residentId:f.residentId,eventId:f.eventId,planId:f.planId,container:f.container,item:'turnip' as const,quantity:1,nutrition:20,hungerRelief:20};}

test('independent seed review: quarter-minute completion has one event and no early conversion',()=>{
 const {w,r}=seedFlowFixture();queueSeedFlow(w,r);stepWorld(w,.25);assert.ok(r.activity);
 const remaining=r.activity.remaining,begin=w.minute,flows:Seed[]=[];assert.equal(remaining,14.75);
 for(let n=0;n<100&&r.activity;n++){
  const before=r.activity.remaining,o=stepWorldWithFoodEvidence(w,.25),found=seedReceipts([o]);
  if(before>.25){assert.equal(found.length,0);assert.equal(r.inventory.turnip,1);}
  flows.push(...found);
 }
 assert.equal(flows.length,1);assert.equal(flows[0].at,begin+remaining);
 assert.equal(r.inventory.turnip,0);assert.equal(r.inventory.seed,5);assert.deepEqual(checkedFoodFlow(flows[0]),flows[0]);
 assert.deepEqual(seedReceipts([stepWorldWithFoodEvidence(w,.25)]),[]);
});

test('independent seed review: prediction, nested capture rejection and thrown capture leave no lingering observer',()=>{
 const {w,r}=seedFlowFixture();queueSeedFlow(w,r);const before=structuredClone(w),copy=copyForSimulation(w);
 assert.throws(()=>captureDirectEating(w,()=>{finishSeedFlow(copy,copy.residents[0]);throw Error('review-abort');}),/review-abort/);
 assert.deepEqual(w,before);
 const seen=captureDirectEating(w,()=>{
  assert.throws(()=>captureDirectEating(w,()=>{}),/nested/);
  while(r.plan||r.activity)stepWorld(w,.5);
 });
 assert.equal(seedReceipts([seen]).length,1);assert.deepEqual(seen.receipts,[]);
 const off=structuredClone(before);while(off.residents[0].plan||off.residents[0].activity)stepWorld(off,.5);
 assert.deepEqual(w,off);
});

test('independent seed review: same-step repaired metadata is unknown, prior repaired metadata has no persisted provenance',()=>{
 for(const historical of [false,true]){
  let {w,r}=seedFlowFixture();queueSeedFlow(w,r);while(r.activity?.remaining!==1)stepWorld(w,1);
  delete w.food!.lots['person:'+r.id].turnip;
  if(historical){initializeFood(w);w=reloadSeed(w);r=w.residents.find(a=>a.id===r.id)!;}
  const before=structuredClone(w),f=seedReceipts(finishSeedFlow(w,r))[0];
  if(historical){assert.ok(f.inputs[0].lots?.length);assert.equal(f.inputs[0].nutrition,20);}
  else{assert.equal(f.inputs[0].lots,null);assert.equal(f.inputs[0].nutrition,null);}
  while(before.residents[0].plan||before.residents[0].activity)stepWorld(before,1);
  assert.deepEqual(w,before);assert.deepEqual(f.outputs,[{item:'seed',quantity:2,nutrition:0,lots:[]}]);
 }
});

test('independent seed review: corrupted original nutrition remains unknown across reload, receipt is detached',()=>{
 const fixture=seedFlowFixture();queueSeedFlow(fixture.w,fixture.r);stepWorld(fixture.w,3);
 const key='food/review-unknown@1';fixture.w.food!.lots['person:'+fixture.r.id].turnip![0].definition=key;
 const w=reloadSeed(fixture.w),r=w.residents.find(a=>a.id===fixture.r.id)!,f=seedReceipts(finishSeedFlow(w,r))[0],saved=structuredClone(f);
 assert.equal(f.inputs[0].nutrition,null);assert.equal(f.inputs[0].lots![0].nutrition,null);assert.equal(f.inputs[0].lots![0].definition,key);
 w.definitions[key]={id:'food/review-unknown',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:999}}};r.inventory.seed=900;
 assert.deepEqual(f,saved);assert.deepEqual(checkedFoodFlow(f),f);
});

test('independent seed review: nested accessors, symbols and nonfinite lot data are rejected without reads',()=>{
 let calls=0;
 const bad:Array<(f:Seed)=>void>=[
  f=>Object.defineProperty(f.outputs,'0',{get(){calls++;return {};}}),
  f=>Object.defineProperty(f.outputs[0],'lots',{get(){calls++;return [];}}),
  f=>Object.defineProperty(f.inputs[0],Symbol('hidden'),{value:'secret'}),
  f=>{f.inputs[0].lots=[{quantity:1,producedAt:0,expiresAt:Infinity,definition:'food/base@1',nutrition:null}];},
  f=>{f.inputs[0].nutrition=0;},
  f=>{f.outputs[0].lots=null;},
 ];
 for(const mutate of bad){const f=receipt();mutate(f);assert.throws(()=>checkedFoodFlow(f));}
 assert.equal(calls,0);
});

for(const ordering of ['same-step','seed-first','intake-first'] as const)test(`independent seed review: runtime rejects cross-slice event reuse (${ordering})`,()=>{
 const f=receipt(),o=observation(f),next=observation({...f,at:f.at+1});
 if(ordering==='same-step')o.receipts=[eating(f)];
 else if(ordering==='seed-first'){next.foodFlows=[];next.receipts=[eating({...f,at:f.at+1})];}
 else{o.foodFlows=[];o.receipts=[eating(f)];}
 const observations=ordering==='same-step'?[o]:[o,next];
 const events:RuntimeFoodEvent[]=[],runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 runtime.start(o.worldId,o.fromMinute);for(const [index,step] of observations.entries())runtime.committed(step,index+1);runtime.stop(o.worldId,observations.at(-1)!.toMinute);
 const report=auditRuntimeFoodEvidence(events,runtime.status());
 assert.equal(report.foodFlows.complete,false,'one completion event cannot certify both processing and intake');
 assert.equal(report.foodFlows.totals,null);assert.ok(report.foodFlows.issues.includes('duplicate_flow_receipt'));
 assert.ok(!report.foodFlows.issues.includes('incomplete_session'),'duplicate evidence, not invalid session chronology, must cause rejection');
});

test('independent seed review: daily collector rejects a seed event replayed later as direct intake',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w),f=receipt();w.minute=DAY;
 daily.sample(w,{...observation(f),worldId:w.id});w.minute++;
 const o={...observation({...f,at:w.minute}),worldId:w.id,foodFlows:[],receipts:[eating({...f,at:w.minute})]};
 assert.throws(()=>daily.sample(w,o),/Duplicate/);
 assert.equal(daily.sample(w,{...o,receipts:[]}),null,'rejected sample must not advance the cursor');
});


test('independent seed review: same plan distinct completion events survive audit, legacy coverage never becomes observed zero',()=>{
 for(const legacy of [false,true]){
  const first=receipt(),second={...receipt(DAY+1),eventId:'review-event-2'};
  const events:RuntimeFoodEvent[]=[],runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
  runtime.start('review-world',DAY-1);
  for(const [index,f] of [first,second].entries()){const o=observation(f);if(legacy)o.foodFlowCoverage='gather_harvest_cook_fish_hunt_v1';runtime.committed(o,index+1);}
  runtime.stop('review-world',DAY+1);
  const report=auditRuntimeFoodEvidence(events,runtime.status());
  assert.equal(report.foodFlows.observedReceipts.length,2);assert.equal(report.foodFlows.complete,!legacy,report.foodFlows.issues.join(', '));
  if(legacy)assert.equal(report.foodFlows.totals,null);
  else{assert.equal(report.foodFlows.totals!.processingInputs.units.turnip,2);assert.equal(report.foodFlows.totals!.processingInputs.nutrition,null);assert.equal(report.foodFlows.totals!.processingOutputs.units.seed,4);assert.equal(report.foodFlows.totals!.processingOutputs.nutrition,0);assert.deepEqual(report.foodFlows.totals!.sourceAdded.units,{});}
  assert.equal(report.foodConsumption,null);assert.equal(report.foodProduction,null);
 }
});

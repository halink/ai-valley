import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedFoodFlow,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence,observedFoodFlowsByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {DAY} from '../src/world/time.js';
import {FOOD_FLOW_COVERAGE,type FoodFlowReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
type Employment=Extract<FoodFlowReceipt,{action:'employment_processing'}>;
function flow():Employment{return {type:'processed',action:'employment_processing',at:481,residentId:'resident-1',eventId:'event-1',planId:'plan-1',
 container:'business:business-1',inputContainer:'employment:contract-1',contractId:'contract-1',businessId:'business-1',employerId:'employer-1',day:0,batchNumber:1,buildingId:'building-1',definition:'recipe/industry/milled@1',
 recipe:{id:'milled',input:{grain:2,water:1},output:{bread:1},minutes:30,station:'mill',skill:'farming',minimum:1},
 inputs:[{item:'grain',quantity:2,nutrition:6,lots:[{quantity:2,producedAt:400,expiresAt:900,definition:'food/base@1',nutrition:6}]},
 {item:'water',quantity:1,nutrition:0,lots:[]}],
 outputs:[{item:'bread',quantity:1,nutrition:4,lots:[{quantity:1,producedAt:481,expiresAt:900,definition:'food/base@1',nutrition:4}]}]};}
function observation(flows:FoodFlowReceipt[]=[flow()]):DirectEatingObservation{return {worldId:'fixture',fromMinute:480,toMinute:481,receipts:[],foodFlows:flows,foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function session(input=observation()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('fixture',480);food.committed(input,1);food.stop('fixture',481);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
test('employment strict snapshot roundtrip and gross business processing totals',()=>{
 const f=flow();assert.deepEqual(checkedFoodFlow(f),f);
 const s=session(observation([f]));assert.equal(s.report.foodFlows.complete,true,s.report.foodFlows.issues.join(','));
 assert.equal(s.report.foodFlows.totals!.processingInputs.units.grain,2);
 assert.equal(s.report.foodFlows.totals!.processingOutputs.units.bread,1);
 assert.deepEqual(s.report.foodFlows.totals!.sourceAdded.units,{});
 assert.ok(s.report.foodFlows.coveredActions.includes('employment_processing'));
 assert.equal(s.report.foodProduction,null);assert.equal(s.report.foodConsumption,null);
 assert.deepEqual(checkedFoodEvent(s.events[1]),s.events[1]);
 assert.deepEqual(observedFoodFlowsByDay(s.events)[0].receipts,[f]);
});
test('employment retains unknown original batches and food-to-nonfood conversion',()=>{
 const f=flow();f.inputs[0].lots=null;f.inputs[0].nutrition=null;
 f.recipe.output={seed:2};f.outputs=[{item:'seed',quantity:2,nutrition:0,lots:[]}];
 assert.deepEqual(checkedFoodFlow(f),f);
 const report=session(observation([f])).report.foodFlows;
 assert.equal(report.complete,true);assert.equal(report.totals!.processingInputs.nutrition,null);
 const same=flow();same.recipe.output={grain:1};same.outputs=[{item:'grain',quantity:1,nutrition:null,lots:null}];
 assert.deepEqual(checkedFoodFlow(same),same);
});
test('employment schema rejects contradictory economics, identities, amounts and original lots',()=>{
 const mutations:Array<(f:any)=>void>=[
 f=>f.container='person:other',f=>f.inputContainer='craft:other',f=>f.contractId='other',f=>f.businessId='other',f=>f.employerId=f.residentId,f=>f.day=1,f=>f.day=.5,f=>f.batchNumber=0,f=>f.batchNumber=.5,
 f=>f.recipe.input={},f=>f.recipe.output={},f=>f.recipe.input.grain=-1,f=>f.recipe.input.grain=.5,f=>f.recipe.input.grain=100001,
 f=>f.recipe.minutes=0,f=>f.recipe.minutes=10081,f=>f.recipe.minutes=.5,f=>f.recipe.station='kitchen',f=>f.recipe.skill='cooking',f=>f.recipe.minimum=101,
 f=>f.inputs=[],f=>f.outputs=[],f=>{f.inputs[0].quantity=3;f.inputs[0].lots=null;f.inputs[0].nutrition=null;},f=>f.inputs.push({item:'wood',quantity:1,nutrition:0,lots:[]}),f=>f.recipe.input.wood=0,f=>f.inputs[0].quantity=1,f=>f.outputs[0].quantity=2,f=>f.outputs[0].item='berry',
 f=>f.inputs.push(structuredClone(f.inputs[0])),f=>f.outputs.push(structuredClone(f.outputs[0])),
 f=>f.inputs[0].lots[0].producedAt=482,f=>f.inputs[0].lots[0].expiresAt=481,f=>f.outputs[0].lots[0].producedAt=480,
 f=>f.outputs[0].lots[0].expiresAt=481,f=>f.inputs[0].lots[0].quantity=1,f=>f.inputs[0].lots[0].nutrition=7,
 f=>f.inputs[0].nutrition=null,f=>f.inputs[0].lots=null,f=>f.inputs[0].lots=[],f=>f.inputs[1].nutrition=1,
 f=>f.inputs[1].lots=[structuredClone(f.inputs[0].lots[0])],
 f=>{f.recipe.input={wood:1};f.recipe.output={plank:1};f.inputs=[{item:'wood',quantity:1,nutrition:0,lots:[]}];f.outputs=[{item:'plank',quantity:1,nutrition:0,lots:[]}];}
 ];
 for(const [index,mutate] of mutations.entries()){const f=flow();mutate(f);assert.throws(()=>checkedFoodFlow(f),`mutation ${index}`);}
});
test('employment boundary rejects secrets, names, prototypes and accessors without invoking them',()=>{
 let calls=0;
 for(const path of [[],['recipe'],['recipe','input'],['inputs',0],['outputs',0,'lots',0]] as Array<Array<string|number>>){
  for(const accessor of [false,true]){
   const f:any=flow();let target=f;for(const key of path)target=target[key];
   if(accessor)Object.defineProperty(target,'secret',{enumerable:true,get(){calls++;return 'private';}});else target.secret='private';
   assert.throws(()=>checkedFoodFlow(f));
  }
 }
 for(const key of ['action','recipe','contractId','batchNumber','inputs']){const f=flow();Object.defineProperty(f,key,{get(){calls++;return 'private';}});assert.throws(()=>checkedFoodFlow(f));}
 const named:any=flow();named.recipe.name='private';assert.throws(()=>checkedFoodFlow(named));
 const inherited=flow();Object.setPrototypeOf(inherited.recipe.input,{secret:'private'});assert.throws(()=>checkedFoodFlow(inherited));
 const getter=flow();Object.defineProperty(getter.recipe.input,'grain',{get(){calls++;return 2;}});assert.throws(()=>checkedFoodFlow(getter));
 assert.equal(calls,0);
});
test('employment audit rejects duplicate batch completions even with distinct event ids',()=>{
 const a=flow(),b=flow();b.eventId='event-2';
 const report=session(observation([a,b])).report.foodFlows;
 assert.equal(report.totals,null);assert.ok(report.issues.includes('duplicate_employment_batch'));
 b.batchNumber=2;b.eventId=a.eventId;
 assert.ok(session(observation([a,b])).report.foodFlows.issues.includes('duplicate_flow_receipt'));
});
test('employment writer roundtrip preserves receipt, coverage and immutable nested snapshots',t=>{
 const root=mkdtempSync(join(testTmpdir(),'employment-flow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fp='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fp,worldId:'fixture',fromMinute:480});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(480);food.start('fixture',480);food.committed(observation(),1);wait.stop(481);food.stop('fixture',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fp});
 assert.equal(result.foodFlows.complete,true);assert.deepEqual(readAcceptanceEvidence(directory),result);
 const event=session().events[1];if(event.type!=='food_step_committed')throw Error();
 const f=event.foodFlows![0];if(f.action!=='employment_processing')throw Error();assert.ok(Object.isFrozen(f.recipe.input));
});
test('all legacy coverage versions retain receipts but cannot prove employment or daily totals',()=>{
 for(const marker of ['gather_harvest_cook_fish_hunt_v1','gather_harvest_cook_fish_hunt_growth_v1','gather_harvest_cook_fish_hunt_growth_craft_v1'] as const){
  const o=observation();o.foodFlowCoverage=marker;const s=session(o);
  assert.equal(s.report.foodFlows.totals,null);assert.equal(s.report.foodFlows.observedReceipts.length,1);
  assert.deepEqual(checkedFoodEvent(s.events[1]),s.events[1]);
  const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w),f=flow();f.at=DAY;f.day=1;for(const a of [...f.inputs,...f.outputs])for(const l of a.lots??[])l.expiresAt=DAY+100;f.outputs[0].lots![0].producedAt=DAY;w.minute=DAY;
  const row=daily.sample(w,{...o,worldId:w.id,fromMinute:DAY-1,toMinute:DAY,foodFlows:[f]})!;
  assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.unobservedMinutes,1);assert.deepEqual(row.foodFlows.receipts,[f]);
  assert.match(row.foodFlows.scope,/employment_processing/);assert.equal(row.foodProduction.value,null);
 }
});

test('only explicit current coverage with observed empty array proves zero processing',()=>{
 const current=session(observation([]));assert.equal(current.report.foodFlows.complete,true);
 assert.deepEqual(current.report.foodFlows.totals!.processingInputs.units,{});
 for(const omit of ['foodFlowCoverage','foodFlows'] as const){
  const o=observation([]);delete o[omit];
  assert.equal(session(o).report.foodFlows.totals,null);
 }
});
test('employment daily current coverage keeps gross legs separate and resets after unknown day',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);
 w.minute=DAY;const missing=daily.sample(w,{worldId:w.id,fromMinute:DAY-1,toMinute:DAY,receipts:[]})!;
 assert.equal(missing.foodFlows.totals,null);
 for(let at=DAY+1;at<=2*DAY;at++){
  const f=flow();f.at=at;f.day=Math.floor(at/DAY);f.inputs[0].lots=null;f.inputs[0].nutrition=null;
  f.outputs[0].lots=null;f.outputs[0].nutrition=null;
  w.minute=at;const row=daily.sample(w,{worldId:w.id,fromMinute:at-1,toMinute:at,receipts:[],foodFlowCoverage:FOOD_FLOW_COVERAGE,foodFlows:at===DAY+1?[f]:[]});
  if(row){assert.equal(row.foodFlows.unobservedMinutes,0);assert.equal(row.foodFlows.totals!.processingInputs.units.grain,2);assert.equal(row.foodFlows.totals!.processingOutputs.units.bread,1);assert.deepEqual(row.foodFlows.totals!.sourceAdded.units,{});assert.equal(row.foodProduction.value,null);}
 }
});

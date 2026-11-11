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
type Craft=Extract<FoodFlowReceipt,{action:'industry_craft'}>;
function flow():Craft{return {type:'processed',action:'industry_craft',at:481,residentId:'resident-1',eventId:'event-1',planId:'plan-1',
 container:'person:resident-1',inputContainer:'craft:batch-1',batchId:'batch-1',buildingId:'building-1',definition:'recipe/industry/milled@1',
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
test('craft strict snapshot roundtrip retains surplus and unknown original nutrition',()=>{
 const f=flow();assert.deepEqual(checkedFoodFlow(f),f);
 f.inputs[0].quantity=3;f.inputs[0].lots=null;f.inputs[0].nutrition=null;
 assert.deepEqual(checkedFoodFlow(f),f);
 const s=session(observation([f]));assert.equal(s.report.foodFlows.complete,true,s.report.foodFlows.issues.join(','));
 assert.equal(s.report.foodFlows.totals!.processingInputs.units.grain,3);
 assert.equal(s.report.foodFlows.totals!.processingInputs.nutrition,null);
 assert.ok(s.report.foodFlows.coveredActions.includes('industry_craft'));
 assert.match(s.report.foodFlows.scope,/employment/);
 assert.equal(s.report.foodProduction,null);assert.equal(s.report.foodConsumption,null);
 assert.deepEqual(checkedFoodEvent(s.events[1]),s.events[1]);
 assert.deepEqual(observedFoodFlowsByDay(s.events)[0].receipts,[f]);
});
test('craft accepts raw hunted meat, nonfood conversion legs and unknown output metadata',()=>{
 const f=flow();f.recipe.input={gameMeat:2,water:1};f.inputs[0].item='gameMeat';
 f.recipe.output={herb:1};f.outputs=[{item:'herb',quantity:1,nutrition:0,lots:[]}];
 f.inputs.push({item:'wood',quantity:2,nutrition:0,lots:[]});
 assert.deepEqual(checkedFoodFlow(f),f,'entire actual batch input, including surplus items, is consumed');
 const same=flow();same.recipe.output={grain:1};same.outputs=[{item:'grain',quantity:1,nutrition:null,lots:null}];
 assert.deepEqual(checkedFoodFlow(same),same,'same-item processing cannot manufacture fresh output lots');
});
test('craft schema rejects contradictory economics, identities, amounts and original lots',()=>{
 const mutations:Array<(f:any)=>void>=[
 f=>f.container='person:other',f=>f.inputContainer='craft:other',f=>f.batchId='other',f=>f.residentId='other',
 f=>f.recipe.input={},f=>f.recipe.output={},f=>f.recipe.input.grain=-1,f=>f.recipe.input.grain=.5,f=>f.recipe.input.grain=100001,
 f=>f.recipe.minutes=0,f=>f.recipe.minutes=10081,f=>f.recipe.minutes=.5,f=>f.recipe.station='kitchen',f=>f.recipe.skill='cooking',f=>f.recipe.minimum=101,
 f=>f.inputs=[],f=>f.outputs=[],f=>f.inputs[0].quantity=1,f=>f.outputs[0].quantity=2,f=>f.outputs[0].item='berry',
 f=>f.inputs.push(structuredClone(f.inputs[0])),f=>f.outputs.push(structuredClone(f.outputs[0])),
 f=>f.inputs[0].lots[0].producedAt=482,f=>f.inputs[0].lots[0].expiresAt=481,f=>f.outputs[0].lots[0].producedAt=480,
 f=>f.outputs[0].lots[0].expiresAt=481,f=>f.inputs[0].lots[0].quantity=1,f=>f.inputs[0].lots[0].nutrition=7,
 f=>f.inputs[0].nutrition=null,f=>f.inputs[0].lots=null,f=>f.inputs[0].lots=[],f=>f.inputs[1].nutrition=1,
 f=>f.inputs[1].lots=[structuredClone(f.inputs[0].lots[0])],
 f=>{f.recipe.input={wood:1};f.recipe.output={plank:1};f.inputs=[{item:'wood',quantity:1,nutrition:0,lots:[]}];f.outputs=[{item:'plank',quantity:1,nutrition:0,lots:[]}];}
 ];
 for(const [index,mutate] of mutations.entries()){const f=flow();mutate(f);assert.throws(()=>checkedFoodFlow(f),`mutation ${index}`);}
});
test('craft boundary rejects secrets, names, prototypes and accessors without invoking them',()=>{
 let calls=0;
 for(const path of [[],['recipe'],['recipe','input'],['inputs',0],['outputs',0,'lots',0]] as Array<Array<string|number>>){
  for(const accessor of [false,true]){
   const f:any=flow();let target=f;for(const key of path)target=target[key];
   if(accessor)Object.defineProperty(target,'secret',{enumerable:true,get(){calls++;return 'private';}});else target.secret='private';
   assert.throws(()=>checkedFoodFlow(f));
  }
 }
 for(const key of ['action','recipe','batchId','inputs']){const f=flow();Object.defineProperty(f,key,{get(){calls++;return 'private';}});assert.throws(()=>checkedFoodFlow(f));}
 const named:any=flow();named.recipe.name='private';assert.throws(()=>checkedFoodFlow(named));
 const inherited=flow();Object.setPrototypeOf(inherited.recipe.input,{secret:'private'});assert.throws(()=>checkedFoodFlow(inherited));
 const getter=flow();Object.defineProperty(getter.recipe.input,'grain',{get(){calls++;return 2;}});assert.throws(()=>checkedFoodFlow(getter));
 assert.equal(calls,0);
});
test('craft audit rejects duplicate batch completions even with distinct event ids',()=>{
 const a=flow(),b=flow();b.eventId='event-2';
 const report=session(observation([a,b])).report.foodFlows;
 assert.equal(report.totals,null);assert.ok(report.issues.includes('duplicate_craft_batch'));
 b.batchId='batch-2';b.inputContainer='craft:batch-2';b.eventId=a.eventId;
 assert.ok(session(observation([a,b])).report.foodFlows.issues.includes('duplicate_flow_receipt'));
});
test('craft writer roundtrip preserves receipt, coverage and immutable nested snapshots',t=>{
 const root=mkdtempSync(join(testTmpdir(),'craft-flow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fp='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fp,worldId:'fixture',fromMinute:480});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(480);food.start('fixture',480);food.committed(observation(),1);wait.stop(481);food.stop('fixture',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fp});
 assert.equal(result.foodFlows.complete,true);assert.deepEqual(readAcceptanceEvidence(directory),result);
 const event=session().events[1];if(event.type!=='food_step_committed')throw Error();
 const f=event.foodFlows![0];if(f.action!=='industry_craft')throw Error();assert.ok(Object.isFrozen(f.recipe.input));
});
test('both legacy coverage versions retain receipts but cannot prove craft or daily totals',()=>{
 for(const marker of ['gather_harvest_cook_fish_hunt_v1','gather_harvest_cook_fish_hunt_growth_v1'] as const){
  const o=observation();o.foodFlowCoverage=marker;const s=session(o);
  assert.equal(s.report.foodFlows.totals,null);assert.equal(s.report.foodFlows.observedReceipts.length,1);
  assert.deepEqual(checkedFoodEvent(s.events[1]),s.events[1]);
  const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w),f=flow();f.at=DAY;w.minute=DAY;
  const row=daily.sample(w,{...o,worldId:w.id,fromMinute:DAY-1,toMinute:DAY,foodFlows:[f]})!;
  assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.unobservedMinutes,1);assert.deepEqual(row.foodFlows.receipts,[f]);
  assert.match(row.foodFlows.scope,/industry_craft/);assert.equal(row.foodProduction.value,null);
 }
});

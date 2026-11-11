import test from 'node:test';
import assert from 'node:assert/strict';
import {growthFlowFixture} from './helpers/food-flow-growth.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {advanceIndustry} from '../src/world/industry.js';
import {captureDirectEating,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {initializeFood} from '../src/world/food.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';

function audit(observation:DirectEatingObservation){
 const events:RuntimeFoodEvent[]=[],runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 runtime.start(observation.worldId,observation.fromMinute);runtime.committed(observation,1);
 runtime.stop(observation.worldId,observation.toMinute);
 return {events,runtime,report:auditRuntimeFoodEvidence(events,runtime.status())};
}

test('independent review: same-item milk additions retain distinct owners and source lots',()=>{
 const {w,animals}=growthFlowFixture(),goat=animals.find(a=>a.kind==='goat')!;
 const second={...structuredClone(goat),id:'review-second-goat',ownerId:w.residents[1].id,product:2};
 w.industry!.animals.push(second);initializeFood(w);
 const old=structuredClone(w.food!.lots['animal-stock:'+second.id].milk!);
 const observation=stepWorldWithFoodEvidence(w,1),milk=observation.foodFlows!.filter(f=>f.outputs[0].item==='milk');
 assert.equal(milk.length,3);assert.equal(new Set(milk.map(f=>f.container)).size,3);
 const receipt=milk.find(f=>f.type==='source_added'&&f.sourceId===second.id)!;
 assert.ok('ownerId' in receipt);assert.equal(receipt.ownerId,second.ownerId);
 assert.equal(receipt.outputs[0].quantity,1);assert.equal(receipt.outputs[0].lots!.length,1);
 assert.deepEqual(w.food!.lots[receipt.container].milk![0],old[0]);
 const report=audit(observation).report;
 assert.equal(report.foodFlows.complete,true,report.foodFlows.issues.join(','));
 assert.equal(report.foodFlows.totals!.sourceAdded.units.milk,3);
});

test('independent review: evidence and saved lots cannot mutate one another',()=>{
 const {w}=growthFlowFixture(),observation=stepWorldWithFoodEvidence(w,1);
 const receipt=observation.foodFlows![0],lot=receipt.outputs[0].lots![0],before=structuredClone(w);
 const frozen=audit(observation).events.find(e=>e.type==='food_step_committed')!;
 lot.quantity=999;receipt.outputs[0].quantity=999;
 assert.deepEqual(w,before);
 if(frozen.type!=='food_step_committed')throw Error('missing step');
 assert.equal(frozen.foodFlows![0].outputs[0].lots![0].quantity,1);
 w.food!.lots[receipt.container].fruit![0].definition='changed-local-fixture';
 assert.notEqual(lot.definition,'changed-local-fixture');
 assert.ok(Object.isFrozen(frozen.foodFlows![0].outputs[0].lots![0]));
});

test('independent review: exception after real generation releases collector and pending lots',()=>{
 const {w}=growthFlowFixture();
 assert.throws(()=>captureDirectEating(w,()=>{
  w.minute++;advanceIndustry(w);throw new Error('after-growth failure');
 }),/after-growth failure/);
 assert.equal(w.industry!.trees[0].fruit,1,'capture is observation, not a simulation rollback');
 assert.deepEqual(captureDirectEating(w,()=>advanceIndustry(w)).foodFlows,[]);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
 const fresh=growthFlowFixture();assert.equal(stepWorldWithFoodEvidence(fresh.w,1).foodFlows!.length,5);
});

test('independent review: unknown and accessor capability cannot manufacture covered totals',()=>{
 for(const marker of ['gather_harvest_cook_fish_hunt_growth_v2','all_food',true,null]){
  const {w}=growthFlowFixture(),observation=stepWorldWithFoodEvidence(w,1);
  Object.defineProperty(observation,'foodFlowCoverage',{value:marker,enumerable:true});
  const result=audit(observation);
  assert.equal(result.runtime.status().phase,'failed');
  assert.equal(result.report.foodFlows.totals,null);
  assert.equal(result.events.filter(e=>e.type==='food_step_committed').length,0);
 }
 const {w}=growthFlowFixture(),observation=stepWorldWithFoodEvidence(w,1);let calls=0;
 Object.defineProperty(observation,'foodFlowCoverage',{get(){calls++;throw Error('getter invoked');},enumerable:true});
 assert.equal(audit(observation).runtime.status().phase,'failed');assert.equal(calls,0);
});

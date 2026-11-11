import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedFoodFlow,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence,observedFoodFlowsByDay} from '../src/server/nine-resident-acceptance.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {DAY} from '../src/world/time.js';
import {FOOD_FLOW_COVERAGE,type FoodFlowReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
type Seed=Extract<FoodFlowReceipt,{action:'saveSeed'}>;
function seed(at=DAY):Seed{return {type:'processed',action:'saveSeed',at,residentId:'resident-1',eventId:'event-1',planId:'plan-1',container:'person:resident-1',definition:'production/base@1',inputs:[{item:'turnip',quantity:1,nutrition:3,lots:[{quantity:1,producedAt:0,expiresAt:at+100,definition:'food/base@1',nutrition:3}]}],outputs:[{item:'seed',quantity:2,nutrition:0,lots:[]}]};}
function observation(flows:FoodFlowReceipt[],at=DAY):DirectEatingObservation{return {worldId:'fixture',fromMinute:at-1,toMinute:at,receipts:[],foodFlows:flows,foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function session(o:DirectEatingObservation){const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);return {events,report:auditRuntimeFoodEvidence(events,food.status())};}
test('seed conversion is strictly processing, with zero-nutrition nonfood outputs and conservative unknown input',()=>{
 for(const unknown of [false,true]){
  const f=seed();if(unknown){f.inputs[0].nutrition=null;f.inputs[0].lots=null;}
  assert.deepEqual(checkedFoodFlow(f),f);const {events,report}=session(observation([f]));
  assert.deepEqual(checkedFoodEvent(events[1]),events[1]);assert.equal(report.foodFlows.complete,true);
  assert.deepEqual(report.foodFlows.totals!.sourceAdded.units,{});assert.equal(report.foodFlows.totals!.processingInputs.units.turnip,1);
  assert.equal(report.foodFlows.totals!.processingInputs.nutrition,unknown?null:3);assert.equal(report.foodFlows.totals!.processingOutputs.units.seed,2);
  assert.equal(report.foodFlows.totals!.processingOutputs.nutrition,0);assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);
  assert.equal(observedFoodFlowsByDay(events)[0].calendarDay,0);
 }
});
test('seed schema rejects wrong legs, invented identities, mismatched lots and unsafe plain-data fields without invoking getters',()=>{
 const mutations:Array<(f:any)=>void>=[f=>f.container='person:other',f=>f.residentId=null,f=>f.eventId=null,f=>f.planId=null,f=>f.definition='',f=>f.batchId='invented',f=>f.extra='private',f=>f.inputs=[],f=>f.outputs=[],f=>f.inputs.push(structuredClone(f.inputs[0])),f=>f.outputs.push(structuredClone(f.outputs[0])),f=>f.inputs[0].item='meal',f=>f.inputs[0].quantity=2,f=>f.outputs[0].item='turnip',f=>f.outputs[0].quantity=1,f=>f.outputs[0].nutrition=null,f=>f.outputs[0].nutrition=1,f=>f.outputs[0].lots=null,f=>f.outputs[0].lots=structuredClone(f.inputs[0].lots),f=>f.inputs[0].lots=null,f=>f.inputs[0].lots=[],f=>f.inputs[0].lots[0].quantity=2,f=>f.inputs[0].lots[0].nutrition=4,f=>f.inputs[0].nutrition=null,f=>f.inputs[0].lots[0].producedAt=f.at+1,f=>f.inputs[0].lots[0].expiresAt=f.at,f=>f.inputs[0].quantity=NaN,f=>f.outputs[0].quantity=Infinity,f=>f.inputs[0].lots[0].extra='secret',f=>Object.setPrototypeOf(f,{private:'secret'}),f=>f[Symbol('private')]='secret',f=>f.inputs.extra='secret',f=>delete f.inputs[0]];
 for(const mutate of mutations){const f=seed();mutate(f);assert.throws(()=>checkedFoodFlow(f));}
 let calls=0;for(const key of ['action','eventId','inputs']){const f=seed();Object.defineProperty(f,key,{get(){calls++;throw Error('private');}});assert.throws(()=>checkedFoodFlow(f));}assert.equal(calls,0);
 const f=seed();Object.defineProperty(f.inputs[0],'nutrition',{get(){calls++;return 3;}});assert.throws(()=>checkedFoodFlow(f));assert.equal(calls,0);
});
test('prior house/custody coverage remains readable but cannot prove seed coverage',()=>{
 const o=observation([seed()]);o.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1';
 const {events,report}=session(o);assert.deepEqual(checkedFoodEvent(events[1]),events[1]);assert.equal(report.foodFlows.totals,null);
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);w.minute=DAY;const row=daily.sample(w,{...o,worldId:w.id})!;assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.receipts.length,1);
});
test('daily processing rejects seed replay and invalid input atomically, including across day boundary',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);w.minute=DAY;
 const f=seed(),bad=seed();bad.outputs[0].nutrition=1;assert.throws(()=>daily.sample(w,{...observation([bad]),worldId:w.id}));
 const row=daily.sample(w,{...observation([f]),worldId:w.id})!;assert.deepEqual(row.foodFlows.totals!.sourceAdded.units,{});assert.equal(row.foodFlows.totals!.processingOutputs.units.seed,2);assert.equal(row.foodFlows.totals!.processingOutputs.nutrition,0);assert.equal(row.directEating.totals!.completedActions,0);
 w.minute++;assert.throws(()=>daily.sample(w,{...observation([seed(w.minute)],w.minute),worldId:w.id}),/Duplicate seed/);
 const next=seed(w.minute);next.eventId='event-2';assert.equal(daily.sample(w,{...observation([next],w.minute),worldId:w.id}),null);
 assert.equal(session(observation([f,structuredClone(f)])).report.foodFlows.complete,false);
});
test('fixed-nine counts seed conversion by actor stock, never intake; rejects malformed and replayed receipts atomically',()=>{
 for(const external of [false,true]){
  const w=createFrontierWorld(5401),ids=w.residents.map(r=>r.id),before=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute);
  const f=seed(w.minute+1);f.residentId=external?'external':ids[0];f.container='person:'+f.residentId;
  if(external){const c=structuredClone(before.containers[0]);Object.assign(c,{id:f.container,aliases:[f.container],ownerId:f.residentId,scope:'external'});before.containers.push(c);}
  w.minute++;const after=snapshotNineFood(w,ids);if(external)after.containers.push(structuredClone(before.containers.at(-1)!));
  const bad=structuredClone(f);bad.outputs[0].lots=null;assert.throws(()=>collector.sample(before,after,{...observation([bad],w.minute),worldId:w.id}));
  collector.sample(before,after,{...observation([f],w.minute),worldId:w.id});const report=collector.finish();assert.deepEqual(report.foodFlows.scopes,[external?'external':'nine-and-public']);
  assert.equal(report.foodFlows.scopedTotals!.inputs.units.turnip,external?0:1);assert.equal(report.foodFlows.scopedTotals!.outputs.units.seed,external?0:2);assert.equal(report.foodFlows.scopedTotals!.outputs.nutrition,0);assert.equal(report.foodFlows.scopedTotals!.sourceAdded.units.turnip,0);assert.equal(report.foodFlows.nineIntakeTotals,null);assert.equal(report.completeFoodLedger,false);assert.equal(report.foodConsumption,null);
  const nextBefore=snapshotNineFood(w,ids);w.minute++;const replay=seed(w.minute);replay.residentId=f.residentId;replay.container=f.container;
  assert.throws(()=>collector.sample(nextBefore,snapshotNineFood(w,ids),{...observation([replay],w.minute),worldId:w.id}),/Duplicate/);
  collector.sample(nextBefore,snapshotNineFood(w,ids),{...observation([],w.minute),worldId:w.id});
 }
});
test('fixed-nine old coverage preserves seed receipts without totals; daily rejects seed getters before evaluation',()=>{
 const w=createFrontierWorld(5401),ids=w.residents.map(r=>r.id),before=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute);
 const f=seed(w.minute+1);f.residentId=ids[0];f.container='person:'+f.residentId;w.minute++;
 const o={...observation([f],w.minute),worldId:w.id};o.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1';
 collector.sample(before,snapshotNineFood(w,ids),o);assert.equal(collector.finish().foodFlows.scopedTotals,null);assert.equal(collector.finish().foodFlows.receipts.length,1);
 const world=createWorld();world.minute=DAY-1;const daily=createIsolationEvidence(world);world.minute=DAY;let calls=0;
 const bad=seed();Object.defineProperty(bad,'at',{get(){calls++;return DAY;}});
 assert.throws(()=>daily.sample(world,{...observation([bad]),worldId:world.id}));assert.equal(calls,0);
 const row=daily.sample(world,{...observation([seed()]),worldId:world.id})!;assert.equal(row.foodFlows.receipts.length,1);
});

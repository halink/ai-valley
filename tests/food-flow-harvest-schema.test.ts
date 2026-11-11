import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedFoodFlow,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence,observedFoodFlowsByDay} from '../src/server/nine-resident-acceptance.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {DAY} from '../src/world/time.js';
import {FOOD_FLOW_COVERAGE,type FoodFlowReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
type House=Extract<FoodFlowReceipt,{action:'harvest_house'}>;
type Custody=Extract<FoodFlowReceipt,{action:'custody_harvest'}>;
function house(at=DAY):House{return {type:'source_added',action:'harvest_house',at,residentId:'resident-1',eventId:'event-1',planId:'plan-1',
 container:'person:resident-1',sourceId:'bed-1',buildingId:'building-1',bed:0,ownerId:'resident-1',definition:'crop/turnip@1',
 outputs:[{item:'turnip',quantity:2,nutrition:6,lots:[{quantity:2,producedAt:at,expiresAt:at+100,definition:'food/base@1',nutrition:6}]}]};}
function custody(at=DAY):Custody{const {buildingId,bed,ownerId,...common}=house(at);return {...common,action:'custody_harvest',sourceId:'plot-1',custodyId:'custody-1',estateOwnerId:'estate-owner',beneficiaryId:'child-1',shareId:'share-1',workSerial:0,container:'custody-stock:custody-1:0'};}
function observation(flows:FoodFlowReceipt[],at=DAY):DirectEatingObservation{return {worldId:'fixture',fromMinute:at-1,toMinute:at,receipts:[],foodFlows:flows,foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function session(o:DirectEatingObservation){const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);return {events,report:auditRuntimeFoodEvidence(events,food.status())};}
test('house and custody harvest strict snapshots preserve unknown nutrition and source additions',()=>{
 for(const f of [house(),custody()]){
  assert.deepEqual(checkedFoodFlow(f),f);
  f.outputs[0].lots=null;f.outputs[0].nutrition=null;
  assert.deepEqual(checkedFoodFlow(f),f);
  const {events,report}=session(observation([f]));
  assert.equal(report.foodFlows.complete,true,report.foodFlows.issues.join(','));
  assert.equal(report.foodFlows.totals!.sourceAdded.units.turnip,2);
  assert.equal(report.foodFlows.totals!.sourceAdded.nutrition,null);
  assert.deepEqual(report.foodFlows.totals!.processingInputs.units,{});
  assert.deepEqual(checkedFoodEvent(events[1]),events[1]);
  assert.equal(observedFoodFlowsByDay(events)[0].calendarDay,0);
 }
});
test('harvest schemas reject malformed metadata, nonfood, mismatched lots and accessors',()=>{
 const common:Array<(f:any)=>void>=[f=>f.sourceId='',f=>f.definition='',f=>f.at=-1,f=>f.eventId=null,f=>f.residentId=null,f=>f.outputs=[],
 f=>f.outputs.push(structuredClone(f.outputs[0])),f=>f.outputs[0].item='water',f=>f.outputs[0].quantity=0,
 f=>f.outputs[0].lots[0].producedAt--,f=>f.outputs[0].lots[0].expiresAt=f.at,
 f=>f.outputs[0].lots[0].quantity=1,f=>f.outputs[0].lots[0].nutrition=7,f=>f.outputs[0].nutrition=null,
 f=>f.outputs[0].lots=null,f=>f.outputs[0].lots=[],f=>f.extra='private'];
 for(const make of [house,custody])for(const mutate of common){const f=make();mutate(f);assert.throws(()=>checkedFoodFlow(f));}
 for(const mutate of [(f:any)=>f.ownerId='other',(f:any)=>f.container='person:other',(f:any)=>f.bed=-1,(f:any)=>f.bed=.5,(f:any)=>f.buildingId='']){
  const f=house();mutate(f);assert.throws(()=>checkedFoodFlow(f));
 }
 for(const mutate of [(f:any)=>f.custodyId='other',(f:any)=>f.workSerial=-1,(f:any)=>f.workSerial=.5,(f:any)=>f.estateOwnerId='',(f:any)=>f.beneficiaryId='',(f:any)=>f.shareId='']){
  const f=custody();mutate(f);assert.throws(()=>checkedFoodFlow(f));
 }
 let calls=0;const f=house();Object.defineProperty(f,'ownerId',{get(){calls++;return 'resident-1';}});assert.throws(()=>checkedFoodFlow(f));assert.equal(calls,0);
});
test('custody completion identity is independent of event ID; house bed may yield later cycles',()=>{
 const a=custody(),b=custody();b.eventId='event-2';
 assert.ok(session(observation([a,b])).report.foodFlows.issues.includes('duplicate_custody_work'));
 const h=house(),again=house();again.eventId='event-2';assert.equal(session(observation([h,again])).report.foodFlows.complete,true);
});
test('former employment coverage is readable but does not prove current harvest totals',()=>{
 const o=observation([house()]);o.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_craft_employment_v1';
 const {events,report}=session(o);assert.deepEqual(checkedFoodEvent(events[1]),events[1]);assert.equal(report.foodFlows.totals,null);
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);w.minute=DAY;
 const row=daily.sample(w,{...o,worldId:w.id})!;assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.receipts.length,1);
});
test('daily exact boundary records source legs, preserves unknowns and rejects repeat custody work atomically',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w),f=custody();f.outputs[0].nutrition=null;f.outputs[0].lots=null;w.minute=DAY;
 const row=daily.sample(w,{...observation([f]),worldId:w.id})!;
 assert.equal(row.foodFlows.totals!.sourceAdded.units.turnip,2);assert.equal(row.foodFlows.totals!.sourceAdded.nutrition,null);
 const duplicate=custody(DAY+1);duplicate.eventId='new-event';w.minute++;
 assert.throws(()=>daily.sample(w,{...observation([duplicate],w.minute),worldId:w.id}),/Duplicate custody/);
 assert.equal(daily.sample(w,{...observation([],w.minute),worldId:w.id}),null);
});
test('fixed-nine scopes custody to physical estate owner rather than worker or beneficiary',()=>{
 for(const owner of ['founder','commons','external']){
  const w=createFrontierWorld(5401),ids=w.residents.map(r=>r.id),before=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute);
  const f=custody(w.minute+1);f.residentId=ids[0];f.beneficiaryId=ids[1];f.estateOwnerId=owner==='founder'?ids[2]:owner;
  w.minute++;collector.sample(before,snapshotNineFood(w,ids),{...observation([f],w.minute),worldId:w.id});
  const report=collector.finish();assert.deepEqual(report.foodFlows.scopes,[owner==='external'?'external':'nine-and-public']);
  assert.equal(report.foodFlows.scopedTotals!.sourceAdded.units.turnip,owner==='external'?0:2);
  const nextBefore=snapshotNineFood(w,ids);w.minute++;const duplicate=custody(w.minute);duplicate.eventId='changed';duplicate.estateOwnerId=f.estateOwnerId;
  assert.throws(()=>collector.sample(nextBefore,snapshotNineFood(w,ids),{...observation([duplicate],w.minute),worldId:w.id}),/Duplicate custody/);
  collector.sample(nextBefore,snapshotNineFood(w,ids),{...observation([],w.minute),worldId:w.id});
 }
});
test('fixed-nine contradictory endpoint owner makes scope unknown; invalid receipts do not consume sample',()=>{
 const w=createFrontierWorld(5401),ids=w.residents.map(r=>r.id),before=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute);
 const f=custody(w.minute+1);f.estateOwnerId=ids[0];w.minute++;const after=snapshotNineFood(w,ids);
 const container=structuredClone(after.containers[0]);container.id=f.container;container.aliases=[f.container];container.ownerId='external';container.scope='external';after.containers.push(container);
 const invalid=structuredClone(f);invalid.container='wrong';
 assert.throws(()=>collector.sample(before,after,{...observation([invalid],w.minute),worldId:w.id}));
 collector.sample(before,after,{...observation([f],w.minute),worldId:w.id});
 assert.deepEqual(collector.finish().foodFlows.scopes,['unknown']);assert.equal(collector.finish().foodFlows.scopedTotals,null);
});

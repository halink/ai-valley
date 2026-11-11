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
type Trial=Extract<FoodFlowReceipt,{action:'prototype_trial'}>;
function trial(phase:Trial['phase']='started',at=DAY):Trial{return {type:'processed',action:'prototype_trial',phase,at,residentId:'resident-1',eventId:'event-'+phase,planId:'plan-1',container:'person:resident-1',definition:'invention/air-drying@1',trialId:'trial-1',prototypeId:'prototype-1',designId:'design-1',buildingId:'building-1',startedAt:phase==='started'?at:at-1,inputItem:'fish',inputQuantity:5,failureReason:phase==='failed'?'rain':phase==='abandoned'?'abandoned':null,inputs:phase==='started'?[{item:'fish',quantity:5,nutrition:15,lots:[{quantity:5,producedAt:at-2,expiresAt:at+100,definition:'food/base@1',nutrition:15}]}]:[],outputs:phase==='succeeded'?[{item:'driedFish',quantity:2,nutrition:12,lots:[{quantity:2,producedAt:at,expiresAt:at+100,definition:'food/base@1',nutrition:12}]}]:[]};}
function observation(flows:Trial[],at=DAY):DirectEatingObservation{return {worldId:'fixture',fromMinute:at-1,toMinute:at,receipts:[],foodFlows:flows,foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function session(observations:DirectEatingObservation[]){const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(observations[0].worldId,observations[0].fromMinute);for(const [index,o]of observations.entries())food.committed(o,index+1);food.stop(observations[0].worldId,observations.at(-1)!.toMinute);return {events,report:auditRuntimeFoodEvidence(events,food.status())};}
test('prototype schema accepts exact four phases, terminal-only capture and conservative start metadata',()=>{
 for(const phase of ['started','succeeded','failed','abandoned'] as const){const f=trial(phase);assert.deepEqual(checkedFoodFlow(f),f);const {events,report}=session([observation([f])]);assert.deepEqual(checkedFoodEvent(events[1]),events[1]);assert.equal(report.foodFlows.complete,true);assert.deepEqual(report.foodFlows.totals!.sourceAdded.units,{});assert.equal(report.foodFlows.totals!.processingInputs.units.fish,phase==='started'?5:undefined);assert.equal(report.foodFlows.totals!.processingOutputs.units.driedFish,phase==='succeeded'?2:undefined);assert.equal(report.foodConsumption,null);}
 const f=trial();f.inputs[0].lots=null;f.inputs[0].nutrition=null;assert.deepEqual(checkedFoodFlow(f),f);
});
test('prototype strict schema rejects invented fields, phases, identities, timing, quantities, dispositions and false fresh output proof',()=>{
 const mutations:Array<(f:any)=>void>=[f=>f.extra='private',f=>f.phase='working',f=>f.container='person:other',f=>f.residentId=null,f=>f.eventId=null,f=>f.planId=null,f=>f.definition='invention/air-drying@2',f=>f.trialId='',f=>f.inputItem='turnip',f=>f.inputQuantity=1,f=>f.inputQuantity=7,f=>f.inputQuantity=2.5,f=>f.startedAt=f.at+1,f=>f.inputs[0].item='carp',f=>f.inputs[0].quantity=4,f=>f.inputs=[],f=>f.failureReason='rain',f=>f.outputs=structuredClone(f.inputs),f=>f.inputs[0].lots[0].expiresAt=f.at,f=>f.inputs[0].lots[0].quantity=4,f=>f.inputs[0].lots[0].nutrition=1,f=>f.inputs[0].quantity=Infinity,f=>delete f.inputs[0],f=>f[Symbol('x')]='secret'];
 for(const mutate of mutations){const f=trial();mutate(f);assert.throws(()=>checkedFoodFlow(f));}
 for(const mutate of [(f:any)=>f.startedAt=f.at,(f:any)=>f.outputs[0].quantity=3,(f:any)=>f.outputs[0].lots=null,(f:any)=>f.outputs[0].lots=[],(f:any)=>f.outputs[0].lots[0].producedAt=f.at-1,(f:any)=>f.failureReason='rain',(f:any)=>f.inputs=trial().inputs]){const f=trial('succeeded');mutate(f);assert.throws(()=>checkedFoodFlow(f));}
 for(const phase of ['failed','abandoned'] as const){const f=trial(phase);f.failureReason=null;assert.throws(()=>checkedFoodFlow(f));}
 let calls=0;for(const key of ['action','at','inputs']){const f=trial();Object.defineProperty(f,key,{get(){calls++;return null;}});assert.throws(()=>checkedFoodFlow(f));}assert.equal(calls,0);
});
test('runtime and daily readers reject trial phase replay even with new events and mismatched identity',()=>{
 const start=trial(),end=trial('succeeded',DAY+1);const ok=session([observation([start]),observation([end],DAY+1)]);assert.equal(ok.report.foodFlows.complete,true);assert.equal(ok.report.foodFlows.totals!.processingInputs.units.fish,5);assert.equal(ok.report.foodFlows.totals!.processingOutputs.units.driedFish,2);assert.deepEqual(observedFoodFlowsByDay(ok.events).map(d=>d.calendarDay),[0,1]);
 for(const phase of ['started','succeeded','failed','abandoned'] as const){const repeat=trial(phase,DAY+2);repeat.eventId='new-event';const {events,report}=session([observation([start]),observation([end],DAY+1),observation([repeat],DAY+2)]);assert.equal(report.foodFlows.totals,null);assert.throws(()=>observedFoodFlowsByDay(events));}
 const changed=trial('succeeded',DAY+1);changed.inputQuantity=4;assert.equal(session([observation([start]),observation([changed],DAY+1)]).report.foodFlows.totals,null);
 const cross=observation([start]);cross.receipts=[{at:DAY,residentId:'resident-1',eventId:start.eventId,planId:'p',container:start.container,item:'fish',quantity:1,nutrition:1,hungerRelief:1}];assert.equal(session([cross]).report.foodFlows.totals,null);
});
test('isolation phases aggregate across midnight, atomically reject replay and preserve legacy unknown coverage',()=>{
 const w=createWorld();w.minute=DAY-1;const collector=createIsolationEvidence(w);w.minute=DAY;
 const bad=trial();bad.inputQuantity=6;assert.throws(()=>collector.sample(w,{...observation([bad]),worldId:w.id}));
 const row=collector.sample(w,{...observation([trial()]),worldId:w.id})!;assert.equal(row.foodFlows.totals!.processingInputs.units.fish,5);
 w.minute++;const end=trial('succeeded',DAY+1);collector.sample(w,{...observation([end],w.minute),worldId:w.id});w.minute++;
 const replay=trial('failed',w.minute);replay.eventId='different';assert.throws(()=>collector.sample(w,{...observation([replay],w.minute),worldId:w.id}));collector.sample(w,{...observation([],w.minute),worldId:w.id});const final=collector.finish(w)!;assert.equal(final.foodFlows.totals!.processingOutputs.units.driedFish,2);assert.equal(final.foodFlows.totals!.processingInputs.units.fish,undefined);
 const old=observation([trial()]);old.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1';const legacy=session([old]);assert.deepEqual(checkedFoodEvent(legacy.events[1]),legacy.events[1]);assert.equal(legacy.report.foodFlows.totals,null);
});
test('fixed nine uses actual person owner, debits once, never intake; malformed terminal cannot advance cursor',()=>{
 for(const external of [false,true]){
  const w=createFrontierWorld(5401),ids=w.residents.map(r=>r.id);if(external){const r=structuredClone(w.residents[0]);r.id='external';w.residents.push(r);}
  const collector=createNineFoodEvidence(w.id,w.minute),owner=external?'external':ids[0],startedAt=w.minute+1;
  const tick=(f:Trial)=>{const before=snapshotNineFood(w,ids);const after=structuredClone(before);after.at++;f.residentId=owner;f.container='person:'+owner;collector.sample(before,after,{...observation([f],after.at),worldId:w.id});w.minute++;};
  tick(trial('started',startedAt));const bad=trial('succeeded',w.minute+1);bad.inputQuantity=4;assert.throws(()=>tick(bad));tick(trial('succeeded',w.minute+1));
  const r=collector.finish();assert.deepEqual(r.foodFlows.scopes,[external?'external':'nine-and-public',external?'external':'nine-and-public']);assert.equal(r.foodFlows.scopedTotals!.inputs.units.fish,external?0:5);assert.equal(r.foodFlows.scopedTotals!.outputs.units.driedFish,external?0:2);assert.equal(r.foodFlows.nineIntakeTotals,null);assert.equal(r.foodProduction,null);assert.equal(r.foodConsumption,null);
  const repeat=trial('abandoned',w.minute+1);repeat.eventId='different';assert.throws(()=>tick(repeat));
 }
});
test('prototype daily and fixed-nine reject cross-slice IDs atomically and retain old coverage as unknown',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);w.minute=DAY;
 const f=trial(),o={...observation([f]),worldId:w.id};o.receipts=[{at:DAY,residentId:f.residentId,eventId:f.eventId,planId:f.planId,container:f.container,item:'fish',quantity:1,nutrition:1,hungerRelief:1}];assert.throws(()=>daily.sample(w,o));assert.throws(()=>observedFoodFlowsByDay(session([o]).events));
 const old={...observation([f]),worldId:w.id,foodFlowCoverage:'gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1' as const};const row=daily.sample(w,old)!;assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.receipts.length,1);
 for(const unknownOwner of [false,true]){
  const world=createFrontierWorld(5401),ids=world.residents.map(r=>r.id),before=snapshotNineFood(world,ids),collector=createNineFoodEvidence(world.id,world.minute);world.minute++;
  const end=trial('succeeded',world.minute);end.residentId=ids[0];end.container='person:'+ids[0];const after=snapshotNineFood(world,ids);
  if(unknownOwner){before.containers.find(c=>c.id===end.container)!.ownerId='other';after.containers.find(c=>c.id===end.container)!.ownerId='other';}
  const observationNow={...observation([end],world.minute),worldId:world.id};const duplicate={...observationNow,receipts:[{at:world.minute,residentId:end.residentId,eventId:end.eventId,planId:end.planId,container:end.container,item:'fish' as const,quantity:1,nutrition:1,hungerRelief:1}]};assert.throws(()=>collector.sample(before,after,duplicate));
  if(!unknownOwner)observationNow.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1';collector.sample(before,after,observationNow);const report=collector.finish();assert.equal(report.foodFlows.scopedTotals,null);assert.equal(report.foodFlows.receipts.length,1);assert.equal(report.foodFlows.scopes[0],unknownOwner?'unknown':'nine-and-public');
 }
});

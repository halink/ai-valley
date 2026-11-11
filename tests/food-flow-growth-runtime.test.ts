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
import {FOOD_FLOW_COVERAGE,type NaturalFoodFlowReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function flow(species?:'chicken'|'duck'|'goat'|'cow',id='source-1'):NaturalFoodFlowReceipt{
 const item=species===undefined?'fruit':species==='chicken'?'egg':species==='duck'?'duckEgg':'milk';
 return {type:'source_added',...(species?{action:'animal_product',species}:{action:'fruit_growth'}),at:481,
 residentId:null,eventId:null,planId:null,ownerId:'owner-1',sourceId:id,container:`${species?'animal':'orchard'}-stock:${id}`,definition:'ecology/growth@1',
 outputs:[{item,quantity:.5,nutrition:4,lots:[{quantity:.5,producedAt:481,expiresAt:700,definition:'food/life@1',nutrition:4}]}]} as NaturalFoodFlowReceipt;
}
function observation(flows=[flow()]):DirectEatingObservation{return {worldId:'fixture',fromMinute:480,toMinute:481,receipts:[],foodFlows:flows,foodFlowCoverage:FOOD_FLOW_COVERAGE};}
function session(input=observation()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('fixture',480);food.committed(input,1);food.stop('fixture',481);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
test('growth boundary preserves exact source, owner, null actors and fractional original lots',()=>{
 for(const species of [undefined,'chicken','duck','goat','cow'] as const)assert.deepEqual(checkedFoodFlow(flow(species)),flow(species));
 const s=session(observation([flow(),flow('chicken'),flow('duck','source-2'),flow('goat','source-3'),flow('cow','source-4')]));
 assert.equal(s.report.foodFlows.complete,true);
 assert.deepEqual(s.report.foodFlows.totals!.sourceAdded,{units:{fruit:.5,egg:.5,duckEgg:.5,milk:1},nutrition:20});
 assert.equal(s.report.foodProduction,null);assert.equal(s.report.foodConsumption,null);
 const event=s.events[1];assert.deepEqual(checkedFoodEvent(event),event);
 if(event.type!=='food_step_committed')throw Error();
 assert.ok(Object.isFrozen(event.foodFlows![0].outputs[0].lots![0]));
});
test('growth boundary rejects unsupported species, fake actors, mismatched stock and extra/accessor fields',()=>{
 for(const mutate of [(f:any)=>f.species='sheep',(f:any)=>f.outputs[0].item='wool',(f:any)=>f.outputs[0].quantity=0,
  (f:any)=>f.outputs[0].quantity=Infinity,(f:any)=>f.ownerId=null,(f:any)=>f.residentId='owner-1',(f:any)=>f.planId='plan',
  (f:any)=>f.eventId='invented',(f:any)=>f.container='animal-stock:other',(f:any)=>f.sourceId='other',
  (f:any)=>f.secret='private',(f:any)=>f.outputs.push(f.outputs[0])]){
  const f=flow('chicken');mutate(f);assert.throws(()=>checkedFoodFlow(f));
 }
 let calls=0;
 for(const key of ['action','ownerId','sourceId','species','outputs','secret']){
  const f=flow('chicken');Object.defineProperty(f,key,{get(){calls++;return 'private';}});assert.throws(()=>checkedFoodFlow(f));
 }
 assert.equal(calls,0);
 const fruit=flow() as any;fruit.species='chicken';assert.throws(()=>checkedFoodFlow(fruit));
});
test('natural dedup keys and lot semantic checks preserve unknown totals',()=>{
 assert.ok(session(observation([flow(),flow('chicken'),flow(undefined,'source-2')])).report.foodFlows.complete);
 assert.ok(session(observation([flow(),flow()])).report.foodFlows.issues.includes('duplicate_flow_receipt'));
 for(const mutate of [(f:NaturalFoodFlowReceipt)=>f.outputs[0].lots![0].producedAt=480,
  (f:NaturalFoodFlowReceipt)=>f.outputs[0].lots![0].expiresAt=481,
  (f:NaturalFoodFlowReceipt)=>f.outputs[0].lots![0].quantity=1,
  (f:NaturalFoodFlowReceipt)=>f.outputs[0].lots![0].nutrition=3]){
  const f=flow();mutate(f);assert.equal(session(observation([f])).report.foodFlows.totals,null);
 }
 const legacy=observation();legacy.foodFlowCoverage='gather_harvest_cook_fish_hunt_v1';
 const old=session(legacy);assert.equal(old.report.foodFlows.totals,null);assert.equal(old.report.foodFlows.observedReceipts.length,1);
 assert.deepEqual(checkedFoodEvent(old.events[1]),old.events[1]);
});
test('writer roundtrip preserves natural receipts and current coverage',t=>{
 const root=mkdtempSync(join(testTmpdir(),'growth-flow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fp='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fp,worldId:'fixture',fromMinute:480});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(480);food.start('fixture',480);food.committed(observation([flow(),flow('cow')]),1);wait.stop(481);food.stop('fixture',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fp});
 assert.equal(result.foodFlows.complete,true);assert.deepEqual(readAcceptanceEvidence(directory),result);
});
test('growth daily receipts cross midnight and legacy capability never proves current totals',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);
 const f=flow();f.at=DAY;w.minute=DAY;
 const row=daily.sample(w,{worldId:w.id,fromMinute:DAY-1,toMinute:DAY,receipts:[],foodFlows:[f],foodFlowCoverage:'gather_harvest_cook_fish_hunt_v1'})!;
 assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.unobservedMinutes,1);assert.equal(row.foodFlows.receipts.length,1);
 w.minute++;daily.sample(w,{worldId:w.id,fromMinute:DAY,toMinute:DAY+1,receipts:[],foodFlows:[],foodFlowCoverage:FOOD_FLOW_COVERAGE});
 assert.deepEqual(daily.finish(w)!.foodFlows.totals!.sourceAdded.units,{});
 const event=session().events[1];if(event.type!=='food_step_committed')throw Error();
 const g=flow('cow');g.at=DAY+.5;
 assert.deepEqual(observedFoodFlowsByDay([{...event,foodFlows:[f,g]}]).map(d=>[d.calendarDay,d.receipts[0].action]),[[0,'fruit_growth'],[1,'animal_product']]);
});

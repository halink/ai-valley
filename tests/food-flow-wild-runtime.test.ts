import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedFoodEvent,checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence,observedFoodFlowsByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {DAY} from '../src/world/time.js';
import type {FoodFlowReceipt,DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
const marker=FOOD_FLOW_COVERAGE;
function flow(hunt=false):FoodFlowReceipt{return {type:'source_added',action:hunt?'hunt':'fish',species:hunt?'deer':'perch',sourceId:hunt?'beast-1':'shoal:0,6',at:481,residentId:'r',eventId:hunt?'hunt':'fish',planId:'plan',container:'person:r',definition:'action/routine@1',outputs:[{item:hunt?'gameMeat':'perch',quantity:hunt?6:1,nutrition:null,lots:null}]} as FoodFlowReceipt;}
function observation(flows=[flow(),flow(true)]):DirectEatingObservation{return {worldId:'fixture',fromMinute:480,toMinute:481,receipts:[],foodFlows:flows,foodFlowCoverage:marker};}
function session(input=observation()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('fixture',480);food.committed(input,1);food.stop('fixture',481);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
test('wild source legs remain separate and legacy empty arrays cannot prove coverage',()=>{
 const f=session();assert.equal(f.report.foodFlows.complete,true);
 assert.deepEqual(f.report.foodFlows.totals!.sourceAdded,{units:{perch:1,gameMeat:6},nutrition:null});
 assert.deepEqual(f.report.foodFlows.totals!.processingOutputs.units,{});
 assert.equal(f.report.foodProduction,null);assert.equal(f.report.foodConsumption,null);
 const legacy=observation([]);delete legacy.foodFlowCoverage;
 assert.equal(session(legacy).report.foodFlows.totals,null);const old=session(legacy).events[1];assert.deepEqual(checkedFoodEvent(old),old);
});
test('wild schema rejects species/output/source mismatches, amounts, extras and accessors',()=>{
 for(const mutate of [(f:any)=>f.species='salmon',(f:any)=>f.outputs[0].item='carp',(f:any)=>f.sourceId='shoal:0,6/secret',(f:any)=>f.outputs[0].quantity=0,(f:any)=>f.outputs[0].quantity=-1,(f:any)=>f.outputs[0].quantity=2,(f:any)=>f.prompt='private',(f:any)=>f.outputs.push(f.outputs[0])]){
  const f=flow();mutate(f);assert.throws(()=>checkedFoodFlow(f));
 }
 let calls=0;
 for(const key of ['species','action','outputs']){const f=flow();Object.defineProperty(f,key,{get(){calls++;return 'perch';}});assert.throws(()=>checkedFoodFlow(f));}
 for(const key of ['foodFlows','foodFlowCoverage']){const o=observation();Object.defineProperty(o,key,{get(){calls++;return [];}});assert.equal(session(o).food.status().phase,'failed');}
 assert.equal(calls,0);
 const bad=observation() as any;bad.foodFlowCoverage='legacy';assert.equal(session(bad).food.status().phase,'failed');
 const invalidHunt=flow(true) as any;invalidHunt.species='bear';assert.throws(()=>checkedFoodFlow(invalidHunt));
});
test('audit rejects duplicate receipts, malformed lot metadata, and missing sequence',()=>{
 assert.equal(session(observation([flow(),flow()])).report.foodFlows.totals,null);
 const f=flow();f.outputs[0].lots=[{quantity:1,producedAt:482,expiresAt:600,definition:'food/life@1',nutrition:8}];f.outputs[0].nutrition=8;
 assert.equal(session(observation([f])).report.foodFlows.totals,null);
 const s=session();assert.equal(auditRuntimeFoodEvidence(s.events.slice(1),s.food.status()).foodFlows.totals,null);
});
test('writer reload preserves wild coverage and corruption invalidates totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'wild-flow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'run'),fp='a'.repeat(64);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fp,worldId:'fixture',fromMinute:480});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(480);food.start('fixture',480);food.committed(observation(),1);wait.stop(481);food.stop('fixture',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fp});
 assert.equal(result.foodFlows.complete,true);assert.deepEqual(readAcceptanceEvidence(directory),result);
 const path=join(directory,'evidence.jsonl');writeFileSync(path,readFileSync(path,'utf8').replace('shoal:0,6','shoal:0,7'));
 assert.equal(readAcceptanceEvidence(directory).foodFlows.totals,null);
});
test('daily marker, gap, midnight and legacy coverage remain explicit',()=>{
 const w=createWorld();w.minute=DAY-1;const daily=createIsolationEvidence(w);
 const sample=(marked:boolean)=>{const from=w.minute;w.minute++;return daily.sample(w,{worldId:w.id,fromMinute:from,toMinute:w.minute,receipts:[],foodFlows:[],...(marked?{foodFlowCoverage:marker}:{})});};
 const row=sample(false)!;assert.equal(row.foodFlows.totals,null);assert.equal(row.foodFlows.unobservedMinutes,1);
 sample(true);assert.notEqual(daily.finish(w)!.foodFlows.totals,null);
 w.minute+=2;assert.throws(()=>daily.sample(w),/consecutive/);
 const s=session(),event=s.events[1];if(event.type!=='food_step_committed')throw Error();
 const f=flow();f.at=DAY;const g=flow(true);g.at=DAY+.5;
 assert.deepEqual(observedFoodFlowsByDay([{...event,fromMinute:DAY-1,toMinute:DAY+1,foodFlows:[f,g]}]).map(d=>d.calendarDay),[0,1]);
});

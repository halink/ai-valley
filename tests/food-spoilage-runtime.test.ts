import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedFoodLoss,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence,observedFoodLossesByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {DAY} from '../src/world/time.js';
import {FOOD_LOSS_COVERAGE,type FoodLossReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function loss():FoodLossReceipt{return {type:'loss',cause:'spoilage',occurrence:1,at:DAY,containerType:'person',container:'person:resident',
 amount:{item:'fruit',quantity:.5,nutrition:4,lots:[{quantity:.5,producedAt:480,expiresAt:DAY,definition:'food/original@1',nutrition:4}]}};}
function observation(losses=[loss()]):DirectEatingObservation{return {worldId:'fixture',fromMinute:DAY-1,toMinute:DAY+.5,receipts:[],foodLosses:losses,foodLossCoverage:FOOD_LOSS_COVERAGE};}
function session(input=observation()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('fixture',input.fromMinute);food.committed(input,1);food.stop('fixture',input.toMinute);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
test('spoilage boundary copies and freezes fractional original lots without invented actors',()=>{
 const parcel={...loss(),containerType:'estate-stock' as const,container:'legacy-parcel'};assert.deepEqual(checkedFoodLoss(parcel),parcel);
 const input=observation(),s=session(input),event=s.events[1];
 assert.equal(s.report.foodLosses.complete,true);assert.deepEqual(s.report.foodLosses.totals,{units:{fruit:.5},nutrition:4});
 assert.deepEqual(checkedFoodEvent(event),event);
 if(event.type!=='food_step_committed')throw Error();
 assert.ok(Object.isFrozen(event.foodLosses));assert.ok(Object.isFrozen(event.foodLosses![0].amount.lots![0]));
 input.foodLosses![0].amount.lots![0].nutrition=99;
 assert.equal(event.foodLosses![0].amount.lots![0].nutrition,4);
 assert.equal(s.report.foodProduction,null);assert.equal(s.report.foodConsumption,null);
});
test('strict spoilage boundary rejects nonfood, malformed originals, extra fields and getters without executing them',()=>{
 for(const mutate of [(f:any)=>f.amount.item='wood',(f:any)=>f.container='estate:other',(f:any)=>f.container='person:',
  (f:any)=>f.containerType='unknown',(f:any)=>f.amount.quantity=0,(f:any)=>f.amount.quantity=Infinity,
  (f:any)=>f.amount.lots[0].expiresAt=DAY+1,(f:any)=>f.amount.lots[0].producedAt=DAY+1,
  (f:any)=>f.amount.lots[0].quantity=1,(f:any)=>f.amount.lots[0].nutrition=5,(f:any)=>f.amount.lots=[],
  (f:any)=>f.amount.lots=null,(f:any)=>f.residentId='invented',(f:any)=>f.definition='invented',
  (f:any)=>f.occurrence=0,(f:any)=>f.occurrence=.5]){
  const f=loss();mutate(f);assert.throws(()=>checkedFoodLoss(f));
 }
 let calls=0;
 for(const key of ['type','at','container','amount','occurrence','secret']){
  const f=loss();Object.defineProperty(f,key,{get(){calls++;return 'private';}});assert.throws(()=>checkedFoodLoss(f));
 }
 const o=observation();Object.defineProperty(o,'foodLosses',{get(){calls++;return [];}});
 assert.equal(session(o).food.status().phase,'failed');assert.equal(calls,0);
 const covered=session().events[1] as any;const missing={...covered};delete missing.foodLosses;
 assert.throws(()=>checkedFoodEvent(missing));
});
test('legacy records and sessions, duplicate occurrences, gaps, invalid times and corruption never prove zero',()=>{
 const old=observation();delete old.foodLosses;delete old.foodLossCoverage;
 assert.equal(session(old).report.foodLosses.totals,null);
 const unmarked=observation();delete unmarked.foodLossCoverage;
 assert.equal(session(unmarked).report.foodLosses.totals,null);
 const zero=session(observation([]));assert.deepEqual(zero.report.foodLosses.totals,{units:{},nutrition:0});
 const base=session();const event=base.events[1];if(event.type!=='food_step_committed')throw Error();
 for(const receipts of [[loss(),loss()],[{...loss(),occurrence:2}],[{...loss(),at:DAY-1}],
  [{...loss(),amount:{...loss().amount,nutrition:20}}]]){
  const events:RuntimeFoodEvent[]=[base.events[0],{...event,foodLosses:receipts},base.events[2]];
  assert.equal(auditRuntimeFoodEvidence(events,base.food.status()).foodLosses.totals,null);
 }
 const second={...loss(),occurrence:2};assert.equal(session(observation([loss(),second])).report.foodLosses.complete,true);
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('fixture',0);food.stop('fixture',0);assert.equal(auditRuntimeFoodEvidence(events,food.status()).foodLosses.totals,null);
 assert.equal(auditRuntimeFoodEvidence([base.events[0],base.events[2]],base.food.status()).foodLosses.totals,null);
});
test('unknown batch or original nutrition stays null while physical quantities remain known',()=>{
 const f=loss();f.amount.lots=null;f.amount.nutrition=null;
 assert.deepEqual(session(observation([f])).report.foodLosses.totals,{units:{fruit:.5},nutrition:null});
 const g=loss();g.amount.lots![0].nutrition=null;g.amount.nutrition=null;
 assert.equal(session(observation([g])).report.foodLosses.totals!.nutrition,null);
});
test('fractional midnight receipt grouping uses (from,to] and preserves occurrences',()=>{
 const a=loss(),b={...loss(),occurrence:2,at:DAY+.5};
 assert.deepEqual(observedFoodLossesByDay(session(observation([a,b])).events).map(d=>[d.calendarDay,d.receipts[0].occurrence]),[[0,1],[1,2]]);
});
test('writer roundtrip strictly preserves spoilage and separate totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'spoilage-evidence-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fp='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fp,worldId:'fixture',fromMinute:DAY-1});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(DAY-1);food.start('fixture',DAY-1);food.committed(observation(),1);wait.stop(DAY+.5);food.stop('fixture',DAY+.5);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fp});
 assert.equal(result.foodLosses.complete,true);assert.deepEqual(result.foodLosses.totals,{units:{fruit:.5},nutrition:4});
 assert.deepEqual(readAcceptanceEvidence(directory),result);
});

test('writer rejects extra spoilage fields without executing accessors or sealing known totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'spoilage-reject-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:'fixture',fromMinute:DAY-1});t.after(()=>writer.abort());
 const event=structuredClone(session().events[1]);if(event.type!=='food_step_committed')throw Error();
 let calls=0;Object.defineProperty(event.foodLosses![0],'secret',{get(){calls++;return 'private';}});
 assert.throws(()=>writer.observeDirectEating(event));assert.equal(calls,0);
 const recovered=readAcceptanceEvidence(directory);assert.equal(recovered.complete,false);assert.equal(recovered.foodLosses.totals,null);
});

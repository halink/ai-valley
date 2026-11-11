import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedJourneyMeal,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditJourneyMeals,observedJourneyMealsByDay} from '../src/server/journey-meal-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import type {JourneyMealReceipt,DirectEatingObservation} from '../src/world/food-consumption-evidence.js';

function meal():JourneyMealReceipt{return {action:'visitorJourney',operation:'eat',at:500,providerId:'visitor',beneficiaryId:'visitor',
 eventId:'event-1',journeyId:'journey-1',container:'person:visitor',inputs:[{item:'meal',quantity:1,nutrition:25,
 lots:[{quantity:.25,producedAt:480,expiresAt:2000,definition:'food@1',nutrition:5},{quantity:.75,producedAt:490,expiresAt:2100,definition:'food@2',nutrition:20}]}],
 hungerBefore:4,hungerAfter:0,hungerRelief:4};}
function observation(journeyMeals:JourneyMealReceipt[]|undefined=[meal()]):DirectEatingObservation{
 return {worldId:'journey-world',fromMinute:480,toMinute:510,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[],longCareMeals:[],...(journeyMeals===undefined?{}:{journeyMeals})};
}
function session(rows:JourneyMealReceipt[]|undefined=[meal()]){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}}),o=observation(rows);
 if(rows===undefined)delete o.journeyMeals;
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);
 return {events:structuredClone(events),status:food.status(),report:auditRuntimeFoodEvidence(events,food.status())};
}
test('journey schema accepts both completions, original split lots and separate saturated relief',()=>{
 const r=meal();assert.deepEqual(checkedJourneyMeal(r),r);r.action='visitorAid';r.operation='eatMail';assert.deepEqual(checkedJourneyMeal(r),r);
 const result=session();assert.equal(result.report.journeyMeals.complete,true);assert.deepEqual(result.report.journeyMeals.totals,{units:{meal:1},nutrition:25,hungerRelief:4,completedActions:1});
});
for(const [name,change] of Object.entries<(r:any)=>void>({
 operation:r=>r.operation='eatMail',family:r=>r.action='familyRelocation',other:r=>r.beneficiaryId='other',container:r=>r.container='estate-stock',
 plan:r=>r.planId='invented',definition:r=>r.definition='invented@1',empty:r=>r.inputs=[],water:r=>r.inputs[0].item='water',
 surplus:r=>r.inputs[0].quantity=2,fraction:r=>r.inputs[0].quantity=.5,negative:r=>r.hungerAfter=-1,increase:r=>r.hungerAfter=5,
 excessive:r=>r.hungerBefore=101,relief:r=>r.hungerRelief=3,expired:r=>r.inputs[0].lots[0].expiresAt=r.at,
 future:r=>r.inputs[0].lots[0].producedAt=r.at+1,quantity:r=>r.inputs[0].lots[0].quantity=.5,
 nutrition:r=>r.inputs[0].nutrition=30,unknown:r=>r.inputs[0].lots[0].nutrition=null,missingLots:r=>r.inputs[0].lots=null,
 nonfinite:r=>r.inputs[0].lots[0].nutrition=Infinity,extra:r=>r.secret='private',
})){test(`journey schema rejects ${name}`,()=>{const r=meal();change(r);assert.throws(()=>checkedJourneyMeal(r),/invalid_evidence_schema/);});}

test('journey schema never reconstructs original-lot nutrition or absent lots from relief',()=>{
 for(const missing of [false,true]){const r=meal();r.inputs[0].nutrition=null;
  if(missing)r.inputs[0].lots=null;else r.inputs[0].lots![0].nutrition=null;
  assert.deepEqual(checkedJourneyMeal(r),r);const report=session([r]).report.journeyMeals;
  assert.equal(report.complete,true);assert.equal(report.totals!.nutrition,null);assert.equal(report.totals!.hungerRelief,4);
 }
});
test('journey strict boundary rejects getters, symbols, custom and sparse arrays without execution',()=>{
 for(const target of ['receipt','inputs','lots','journeyMeals'] as const)for(const kind of ['getter','symbol','extra','sparse','prototype'] as const){
  const r=meal(),o=observation([r]),event={schema:1,sessionId:'session',sequence:2,type:'food_step_committed',revision:1,...o};
  let calls=0;const value:any=target==='receipt'?r:target==='inputs'?r.inputs:target==='lots'?r.inputs[0].lots:o.journeyMeals;
  if(kind==='getter')Object.defineProperty(value,Array.isArray(value)?'0':'providerId',{get(){calls++;throw new Error('getter invoked');}});
  if(kind==='symbol')value[Symbol('private')]=1;if(kind==='extra')value.secret=1;
  if(kind==='sparse')delete value[Array.isArray(value)?'0':'providerId'];if(kind==='prototype')Object.setPrototypeOf(value,{});
  assert.throws(()=>checkedFoodEvent(event),/invalid_evidence_schema/);assert.equal(calls,0);
 }
});
test('journey old omission remains unknown while explicit empty is observed zero',()=>{
 const old=session();for(const e of old.events)if(e.type==='food_step_committed')delete (e as any).journeyMeals;
 assert.equal(auditRuntimeFoodEvidence(old.events,old.status).journeyMeals.totals,null);
 assert.deepEqual(observedJourneyMealsByDay(old.events),[]);
 assert.deepEqual(session([]).report.journeyMeals.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
});
test('journey missing boundaries, missing step, close failure and gaps invalidate totals',()=>{
 const {events,status}=session();
 for(const altered of [events.slice(1),events.slice(0,-1),[events[0],events[2]],[]]){
  assert.equal(auditJourneyMeals(altered,true).totals,null);assert.equal(auditRuntimeFoodEvidence(altered,status).journeyMeals.totals,null);
 }
 assert.equal(auditJourneyMeals(events,false).totals,null);
 const gap=structuredClone(events);(gap[1] as any).fromMinute=481;assert.equal(auditJourneyMeals(gap,true).totals,null);
 assert.equal(auditRuntimeFoodEvidence(events,{...status,phase:'failed',failure:'observer_threw'}).journeyMeals.totals,null);
});
test('journey duplicate IDs inside and across consumption slices invalidate totals',()=>{
 assert.equal(session([meal(),meal()]).report.journeyMeals.totals,null);
 for(const slice of ['receipts','careMeals','childCareMeals','longCareMeals','foodFlows'] as const){
  const {events}=session(),step=events[1] as any,r=meal();
  if(slice==='receipts')step.receipts=[{at:r.at,residentId:r.providerId,eventId:r.eventId,planId:'plan',container:r.container,item:'meal',quantity:1,nutrition:25,hungerRelief:4}];
  else if(slice==='foodFlows')step.foodFlows=[{type:'source_added',action:'gather_berry',at:r.at,residentId:r.providerId,eventId:r.eventId,planId:'plan',container:r.container,definition:'gather@1',sourceId:'source',outputs:r.inputs}];
  else {const {journeyId,operation,...base}=r;step[slice]=[{...base,action:slice==='careMeals'?'care':slice==='childCareMeals'?'tendChild':'longCare',planId:'plan',definition:'care@1',
   ...(slice==='careMeals'?{proposalId:null,authority:'consent'}:slice==='childCareMeals'?{authority:'guardian'}:{operation:'visit',agreementId:'agreement',slotKey:'slot',healthBefore:30,healthAfter:31,healthGain:1})}];}
  const result=auditJourneyMeals(events,true);assert.equal(result.totals,null,slice);assert.ok(result.issues.includes('duplicate_journey_receipt'),slice);
 }
});
test('journey receipt times and exact midnight use observed facts without fabricated days',()=>{
 const {events}=session(),step=events[1] as any;step.fromMinute=1439;step.toMinute=1441;
 step.journeyMeals=[{...meal(),at:1440},{...meal(),at:1440.25,eventId:'event-2'}];
 assert.deepEqual(observedJourneyMealsByDay([step]).map(d=>[d.calendarDay,d.receipts.length]),[[0,1],[1,1]]);
 assert.deepEqual(observedJourneyMealsByDay([]),[]);
 const bad=session();(bad.events[1] as any).journeyMeals[0].at=480;assert.equal(auditJourneyMeals(bad.events,true).totals,null);
});

test('journey writer roundtrip preserves unknowns and invalidates both totals on missing seal',t=>{
 const root=mkdtempSync(join(testTmpdir(),'journey-schema-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const legacy of [false,true]){
  const directory=join(root,String(legacy)),fingerprint='a'.repeat(64),o=observation();if(legacy)delete o.journeyMeals;
  const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:o.worldId,fromMinute:o.fromMinute});t.after(()=>writer.abort());
  const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
  wait.start(o.fromMinute);food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);wait.stop(o.toMinute);
  const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
  assert.equal(report.complete,true);assert.equal(report.journeyMeals.complete,!legacy);assert.deepEqual(readAcceptanceEvidence(directory),report);
  if(legacy)assert.equal(report.journeyMeals.totals,null);else assert.equal(report.journeyMeals.totals!.nutrition,25);
  unlinkSync(join(directory,'run-close.json'));const broken=readAcceptanceEvidence(directory);
  assert.equal(broken.complete,false);assert.equal(broken.journeyMeals.totals,null);assert.equal(broken.directEating.journeyMeals.totals,null);
 }
});

test('journey daily observations retain missing coverage, midnight attribution and unknown nutrition',async()=>{
 const {createWorld}=await import('../src/world/seed.js');
 const {createIsolationEvidence}=await import('../src/world/isolation-evidence.js');
 const w=createWorld(415);w.minute=1439;const observer=createIsolationEvidence(w),r=meal();
 r.at=1440;r.inputs[0].nutrition=null;r.inputs[0].lots=null;
 const sample=(rows:JourneyMealReceipt[]|undefined)=>{const from=w.minute;w.minute++;
  const o:DirectEatingObservation={worldId:w.id,fromMinute:from,toMinute:w.minute,receipts:[],...(rows===undefined?{}:{journeyMeals:rows})};
  return observer.sample(w,o);
 };
 const row=sample([r])!;assert.equal(row.calendarDay,0);assert.equal(row.journeyMeals.observedMinutes,1);
 assert.deepEqual(row.journeyMeals.totals,{units:{meal:1},nutrition:null,hungerRelief:4,completedActions:1});
 assert.equal(row.foodConsumption.value,null);sample([]);
 assert.equal(observer.finish(w)!.journeyMeals.totals!.completedActions,0);
 sample(undefined);sample([]);const unknown=observer.finish(w)!;
 assert.equal(unknown.calendarDay,1);assert.equal(unknown.journeyMeals.unobservedMinutes,1);assert.equal(unknown.journeyMeals.observedMinutes,2);assert.equal(unknown.journeyMeals.totals,null);
 const from=w.minute;w.minute++;assert.throws(()=>observer.sample(w,{worldId:w.id,fromMinute:from,toMinute:w.minute,receipts:[],journeyMeals:[{...r,at:w.minute+1}]}),/does not cover/);
});


test('journey collisions invalidate all three care slices symmetrically, not unrelated valid care',()=>{
 for(const [slice,duplicate] of [['careMeals','duplicate_care_receipt'],['childCareMeals','duplicate_child_care_receipt'],['longCareMeals','duplicate_long_care_receipt']] as const){
  const {events,status}=session(),step=events[1] as any;
  const {journeyId,operation,...base}=meal();
  const hungerRelief=slice==='childCareMeals'?48:22;
  const care={...base,eventId:'care-event',beneficiaryId:'other-person',hungerBefore:80,hungerAfter:80-hungerRelief,hungerRelief,
   inputs:[...base.inputs,{item:'water',quantity:1,nutrition:0,lots:[]}],
   action:slice==='careMeals'?'care':slice==='childCareMeals'?'tendChild':'longCare',planId:'plan',definition:'care@1',
   ...(slice==='careMeals'?{proposalId:'proposal',authority:'consent'}:slice==='childCareMeals'?{authority:'guardian'}:
    {operation:'visit',agreementId:'agreement',slotKey:'slot',healthBefore:30,healthAfter:31,healthGain:1})};
  step[slice]=[care];
  const valid=auditRuntimeFoodEvidence(events,status);assert.equal(valid[slice].complete,true,slice);assert.equal(valid.journeyMeals.complete,true,slice);
  care.eventId=step.journeyMeals[0].eventId;
  const collision=auditRuntimeFoodEvidence(events,status);
  assert.deepEqual(collision[slice].issues,[duplicate],slice);assert.equal(collision[slice].totals,null,slice);
  assert.deepEqual(collision.journeyMeals.issues,['duplicate_journey_receipt'],slice);assert.equal(collision.journeyMeals.totals,null,slice);
 }
});


test('journey known original nutrition must agree with immediate relief, retaining saturation and unknown fallback',()=>{
 for(const action of ['visitorJourney','visitorAid'] as const){
  const r=meal();r.action=action;r.operation=action==='visitorJourney'?'eat':'eatMail';
  assert.deepEqual(checkedJourneyMeal(r),r); // Four hunger saturates at zero, despite 25 original nutrition.
  r.hungerBefore=80;r.hungerAfter=79;r.hungerRelief=1;
  assert.throws(()=>checkedJourneyMeal(r),/invalid_evidence_schema/);
  r.hungerAfter=55;r.hungerRelief=25;assert.deepEqual(checkedJourneyMeal(r),r);
  r.hungerAfter=79;r.hungerRelief=1;r.inputs[0].nutrition=null;r.inputs[0].lots![0].nutrition=null;
  assert.deepEqual(checkedJourneyMeal(r),r); // Missing definition permits actual fallback without reconstructing nutrition.
  const result=session([r]).report.journeyMeals;assert.equal(result.complete,true);assert.equal(result.totals!.nutrition,null);assert.equal(result.totals!.hungerRelief,1);
 }
});

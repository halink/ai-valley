import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,appendFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedFamilyJourneyMeal,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditFamilyJourneyMeals,observedFamilyJourneyMealsByDay} from '../src/server/family-journey-meal-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import type {FamilyJourneyMealReceipt,DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function meal(memberIndex=0):FamilyJourneyMealReceipt{return {action:'familyRelocation',operation:'ration',trigger:'depart',at:500,
 relocationId:'relocation-1',definition:'familyRelocation@1',rationNumber:1,memberIndex,memberCount:2,providerPortion:memberIndex,
 providerId:'parent',beneficiaryId:memberIndex?'child':'parent',container:'person:parent',
 inputs:[{item:'meal',quantity:1,nutrition:25,lots:[{quantity:.25,producedAt:480,expiresAt:2000,definition:'food@1',nutrition:5},
 {quantity:.75,producedAt:490,expiresAt:2100,definition:'food@2',nutrition:20}]},{item:'water',quantity:1,nutrition:0,lots:[]}],
 hungerBefore:4,hungerAfter:0,hungerRelief:4};}
const rows=()=>[meal(),meal(1)];
function observation(familyJourneyMeals:FamilyJourneyMealReceipt[]=[]):DirectEatingObservation{return {worldId:'family-world',fromMinute:480,toMinute:510,receipts:[],familyJourneyMeals};}
function session(r=rows()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}}),o=observation(r);
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);
 return {events:structuredClone(events),status:food.status(),report:auditRuntimeFoodEvidence(events,food.status())};
}
test('family ration schema retains exact split lots, water and clamped hunger',()=>{
 for(const trigger of ['depart','resume','travel'] as const){const r=meal();r.trigger=trigger;r.rationNumber=trigger==='depart'?1:2;assert.deepEqual(checkedFamilyJourneyMeal(r),r);}
 const r=session().report.familyJourneyMeals;assert.equal(r.complete,true);assert.deepEqual(r.totals,{units:{meal:2,water:2},nutrition:50,hungerRelief:8,completedActions:2});
});
for(const [name,change] of Object.entries<(r:any)=>void>({action:r=>r.action='visitorJourney',operation:r=>r.operation='eat',trigger:r=>r.trigger='arrival',
 first:r=>r.rationNumber=0,depart:r=>r.rationNumber=2,resume:r=>r.trigger='resume',fraction:r=>r.rationNumber=1.5,
 member:r=>r.memberIndex=2,negative:r=>r.memberIndex=-1,count:r=>r.memberCount=9,small:r=>r.memberCount=1,portion:r=>r.providerPortion=2,
 event:r=>r.eventId='fake',plan:r=>r.planId='fake',identity:r=>r.providerId='bad space',container:r=>r.container='person:other',
 empty:r=>r.inputs=[],duplicate:r=>r.inputs[1]=r.inputs[0],food:r=>r.inputs[0].item='berry',quantity:r=>r.inputs[0].quantity=2,
 waterLots:r=>r.inputs[1].lots=null,waterNutrition:r=>r.inputs[1].nutrition=1,negativeHunger:r=>r.hungerAfter=-1,
 hunger:r=>r.hungerBefore=101,relief:r=>r.hungerRelief=3,clamp:r=>{r.hungerBefore=80;r.hungerAfter=76;},
 expired:r=>r.inputs[0].lots[0].expiresAt=r.at,future:r=>r.inputs[0].lots[0].producedAt=r.at+1,
 sum:r=>r.inputs[0].lots[0].quantity=.5,nutrition:r=>r.inputs[0].nutrition=30,unknown:r=>r.inputs[0].lots[0].nutrition=null,
 missing:r=>r.inputs[0].lots=null,infinite:r=>r.at=Infinity,extra:r=>r.secret='private',
})){test(`family ration rejects ${name}`,()=>{const r=meal();change(r);assert.throws(()=>checkedFamilyJourneyMeal(r),/invalid_evidence_schema/);});}
test('family unknown original lots and nutrition remain unknown, never inferred from relief',()=>{
 for(const missing of [false,true]){const r=rows();r[0].inputs[0].nutrition=null;if(missing)r[0].inputs[0].lots=null;else r[0].inputs[0].lots![0].nutrition=null;
  assert.equal(session(r).report.familyJourneyMeals.totals!.nutrition,null);assert.equal(session(r).report.familyJourneyMeals.totals!.hungerRelief,8);}
});
test('family schema rejects getters, symbols, sparse arrays and custom prototypes without execution',()=>{
 for(const target of ['receipt','inputs','lots','familyJourneyMeals'] as const)for(const kind of ['getter','symbol','extra','sparse','prototype'] as const){
  const {events}=session(),e=events[1] as any,r=e.familyJourneyMeals[0];let calls=0;
  const v:any=target==='receipt'?r:target==='inputs'?r.inputs:target==='lots'?r.inputs[0].lots:e.familyJourneyMeals;
  if(kind==='getter')Object.defineProperty(v,Array.isArray(v)?'0':'providerId',{get(){calls++;throw new Error('invoked');}});
  if(kind==='symbol')v[Symbol('x')]=1;if(kind==='extra')v.secret=1;if(kind==='sparse')delete v[Array.isArray(v)?'0':'providerId'];if(kind==='prototype')Object.setPrototypeOf(v,{});
  assert.throws(()=>checkedFoodEvent(e),/invalid_evidence_schema/);assert.equal(calls,0);
 }
});
test('family audit rejects duplicate, incomplete, reordered and contradictory transactions',()=>{
 const mutations:((r:FamilyJourneyMealReceipt[])=>void)[]=[r=>r.push(meal()),r=>r.pop(),r=>r.reverse(),r=>r[1].beneficiaryId=r[0].beneficiaryId,
 r=>r[1].providerPortion=0,r=>r[1].at++,r=>r[1].definition='familyRelocation@2',r=>r[1].memberCount=3,
 r=>{for(const a of r){a.trigger='resume';a.rationNumber=2;}r[1].trigger='travel';}];
 for(const mutate of mutations){const r=rows();mutate(r);assert.equal(session(r).report.familyJourneyMeals.totals,null);}
 const r=rows();r[1].providerId='child';r[1].container='person:child';r[1].providerPortion=0;assert.equal(session(r).report.familyJourneyMeals.complete,true);
 const {events}=session(),later=structuredClone(events[1]) as any;later.sequence=3;later.revision=2;later.fromMinute=510;later.toMinute=520;later.familyJourneyMeals.forEach((r:any)=>r.at=515);
 const stop={...events[2],sequence:4,toMinute:520} as RuntimeFoodEvent;
 assert.ok(auditFamilyJourneyMeals([events[0],events[1],later,stop],true).issues.includes('duplicate_family_journey_receipt'));
});
test('family missing, null and invalid coverage differ from explicit observed zero',()=>{
 const {events,status}=session();delete (events[1] as any).familyJourneyMeals;assert.equal(auditRuntimeFoodEvidence(events,status).familyJourneyMeals.totals,null);
 assert.deepEqual(observedFamilyJourneyMealsByDay(events),[]);
 (events[1] as any).familyJourneyMeals=null;assert.equal(auditFamilyJourneyMeals(events,true).totals,null);assert.throws(()=>observedFamilyJourneyMealsByDay(events));
 assert.deepEqual(session([]).report.familyJourneyMeals.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 for(const change of [(e:any[])=>e.shift(),(e:any[])=>e.pop(),(e:any[])=>e.splice(1,1),(e:any[])=>e[1].fromMinute++,
 (e:any[])=>e[1].sessionId='other',(e:any[])=>e[1].worldId='other',(e:any[])=>e[1].sequence++,
 (e:any[])=>e[1].familyJourneyMeals.forEach((r:any)=>r.at=480)]){const e=session().events;change(e);assert.equal(auditFamilyJourneyMeals(e,true).totals,null);}
 assert.equal(auditFamilyJourneyMeals([],true).totals,null);assert.equal(auditFamilyJourneyMeals(session().events,false).totals,null);
});
test('family daily helper attributes midnight, preserves unknowns and invents no days',()=>{
 const {events}=session(),e=events[1] as any;e.fromMinute=1439;e.toMinute=1441;e.familyJourneyMeals[0].at=1440;e.familyJourneyMeals[1].at=1440.25;
 e.familyJourneyMeals[0].inputs[0].nutrition=null;e.familyJourneyMeals[0].inputs[0].lots=null;
 const days=observedFamilyJourneyMealsByDay([e]);assert.deepEqual(days.map(d=>[d.calendarDay,d.receipts.length]),[[0,1],[1,1]]);
 assert.equal(days[0].receipts[0].inputs[0].nutrition,null);assert.deepEqual(observedFamilyJourneyMealsByDay([]),[]);
});
test('family writer roundtrip and read corruption never promote missing coverage to zero',t=>{
 const root=mkdtempSync(join(testTmpdir(),'family-schema-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const variant of ['valid','legacy','unsealed','corrupt']){
  const directory=join(root,variant),fingerprint='a'.repeat(64),o=observation(rows());if(variant==='legacy')delete o.familyJourneyMeals;
  const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:o.worldId,fromMinute:o.fromMinute});t.after(()=>writer.abort());
  const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
  wait.start(o.fromMinute);food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);wait.stop(o.toMinute);
  const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
  assert.equal(report.complete,true);assert.equal(report.familyJourneyMeals.complete,variant!=='legacy');assert.deepEqual(readAcceptanceEvidence(directory),report);
  if(variant==='unsealed')unlinkSync(join(directory,'run-close.json'));
  if(variant==='corrupt')appendFileSync(join(directory,'evidence.jsonl'),'bad row\n');
  if(variant==='unsealed'||variant==='corrupt'){const broken=readAcceptanceEvidence(directory);assert.equal(broken.complete,false);assert.equal(broken.familyJourneyMeals.totals,null);assert.equal(broken.directEating.familyJourneyMeals.totals,null);}
 }
});

test('family zero-length observed step is zero, while nonincreasing revisions remain unknown',()=>{
 const {events}=session([]);(events[1] as any).toMinute=480;(events[2] as any).toMinute=480;
 assert.equal(auditFamilyJourneyMeals(events,true).complete,true);
 const later={...events[1],sequence:3} as RuntimeFoodEvent;
 const end={...events[2],sequence:4} as RuntimeFoodEvent;
 const result=auditFamilyJourneyMeals([events[0],events[1],later,end],true);
 assert.equal(result.totals,null);assert.ok(result.issues.includes('revision_not_increasing'));
});
test('family known nutrition follows exact hunger clamp; unknown nutrition permits actual fallback',()=>{
 const r=meal();r.hungerBefore=80;r.hungerAfter=55;r.hungerRelief=25;assert.deepEqual(checkedFamilyJourneyMeal(r),r);
 r.hungerAfter=79;r.hungerRelief=1;assert.throws(()=>checkedFamilyJourneyMeal(r),/invalid_evidence_schema/);
 r.inputs[0].nutrition=null;r.inputs[0].lots=null;assert.deepEqual(checkedFamilyJourneyMeal(r),r);
});
test('family aggregate overflow stays unknown despite individually finite original nutrition',()=>{
 const r=rows();for(const a of r){a.inputs[0].lots=[{quantity:1,producedAt:480,expiresAt:2000,definition:'food@1',nutrition:Number.MAX_VALUE}];a.inputs[0].nutrition=Number.MAX_VALUE;}
 const result=session(r).report.familyJourneyMeals;
 assert.equal(result.totals,null);assert.ok(result.issues.includes('non_finite_family_journey_aggregate'));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,readFileSync,writeFileSync,fsyncSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedPublicDutyMeal,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditPublicDutyMeals,observedPublicDutyMealsByDay} from '../src/server/public-duty-meal-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import type {PublicDutyMealReceipt,DirectEatingObservation} from '../src/world/food-consumption-evidence.js';

function receipt(role:'care'|'kitchen'='kitchen',funded=false):PublicDutyMealReceipt{
 return {action:'publicDuty',operation:'receive',at:500,providerId:'provider',beneficiaryId:'beneficiary',eventId:'service-1',planId:'plan-1',
  definition:'public/duty@1',shiftId:'shift-1',buildingId:'building-1',role,serviceNumber:1,source:funded?'public':'personal',container:funded?'public:building-1':'person:provider',
  inputs:[{item:role==='care'?'meal':'turnip',quantity:role==='care'?1:2,nutrition:70,lots:[{quantity:role==='care'?1:2,producedAt:480,expiresAt:2000,definition:'food@90',nutrition:70}]},
   {item:'water',quantity:1,nutrition:0,lots:[]}],hungerBefore:80,hungerAfter:role==='care'?60:38,hungerRelief:role==='care'?20:42,
  healthBefore:40,healthAfter:role==='care'?48:40,healthGain:role==='care'?8:0,
  funding:funded?{budgetId:'budget-1',account:'escrow:shift-1:wages',wagePerService:3,providerCoinsBefore:10,providerCoinsAfter:13,accountBalanceBefore:9,accountBalanceAfter:6,paidBefore:0,paidAfter:3}:null};
}
function observation(rows:PublicDutyMealReceipt[]|undefined=[receipt()]):DirectEatingObservation{
 return {worldId:'public-runtime',fromMinute:480,toMinute:510,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[],longCareMeals:[],journeyMeals:[],familyJourneyMeals:[],...(rows===undefined?{}:{publicDutyMeals:rows})};
}
function event(rows:PublicDutyMealReceipt[]|undefined=[receipt()]):RuntimeFoodEvent{
 return {schema:1,sessionId:'session-1',sequence:2,type:'food_step_committed',revision:1,...observation(rows)};
}

test('public meal schema: exact role/source contracts preserve independent original nutrition and wage deltas',()=>{
 for(const role of ['kitchen','care'] as const)for(const funded of [false,true]){
  const r=receipt(role,funded);assert.deepEqual(checkedPublicDutyMeal(r),r);
  const audit=auditPublicDutyMeals([event([r])],true);assert.equal(audit.complete,true);assert.equal(audit.totals!.nutrition,70);
  assert.equal(audit.totals!.wages,funded?3:0);assert.equal(audit.totals!.completedActions,1);
  assert.deepEqual(audit.totals!.units,role==='care'?{meal:1,water:1}:{turnip:2,water:1});
  assert.equal(audit.totals!.sources[funded?'public':'personal'].completedActions,1);
 }
});
test('public meal schema: clamped fixed effects never determine nutrition; missing originals stay unknown',()=>{
 const r=receipt('care');r.hungerBefore=2;r.hungerAfter=0;r.hungerRelief=2;r.healthBefore=99;r.healthAfter=100;r.healthGain=1;
 assert.equal(checkedPublicDutyMeal(r).inputs[0].nutrition,70);
 r.inputs[0].nutrition=null;r.inputs[0].lots=null;
 const report=auditPublicDutyMeals([event([r])],true);assert.equal(report.complete,true);assert.equal(report.totals!.nutrition,null);assert.equal(report.totals!.hungerRelief,2);
 assert.equal(report.totals!.sources.personal.nutrition,null);assert.equal(report.totals!.sources.public.nutrition,0);
});
test('public meal schema: malformed identity, source, fixed effects, recipe and wages are rejected',()=>{
 const mutations:Array<(r:any)=>void>=[r=>r.serviceNumber=0,r=>r.serviceNumber=1.5,r=>r.serviceNumber=Number.MAX_SAFE_INTEGER+1,
  r=>r.providerId=r.beneficiaryId,r=>r.operation='work',r=>r.role='repair',r=>r.source='personal',r=>r.container='public-reserve:budget-1',
  r=>r.funding=null,r=>r.funding.account='escrow:other:wages',r=>r.funding.providerCoinsAfter++,r=>r.funding.accountBalanceAfter++,r=>r.funding.paidAfter++,
  r=>r.funding.wagePerService=0,r=>r.inputs[0].quantity=1,r=>r.inputs.push(r.inputs[1]),r=>r.hungerAfter++,r=>r.healthGain=1,
  r=>r.inputs[0].nutrition=71,r=>r.inputs[0].lots[0].expiresAt=r.at,r=>r.inputs[0].lots[0].producedAt=r.at+1,
  r=>r.inputs[1].nutrition=1,r=>r.inputs[1].lots=null];
 for(const mutate of mutations){const r=receipt('kitchen',true);mutate(r);assert.throws(()=>checkedPublicDutyMeal(r),/invalid_evidence_schema/);}
});
test('public meal schema: accessors, symbols, sparse arrays, extras and nonfinite numbers never pass boundary',()=>{
 const targets=(r:any)=>[r,r.funding,r.inputs[0],r.inputs[0].lots[0]];
 for(let target=0;target<4;target++)for(const kind of ['extra','symbol','getter'] as const){
  const r=receipt('kitchen',true),obj=targets(r)[target];let reads=0;
  if(kind==='extra')obj.private='SECRET';if(kind==='symbol')obj[Symbol('private')]=1;
  if(kind==='getter')Object.defineProperty(obj,Object.keys(obj)[0],{get(){reads++;throw Error('getter');}});
  assert.throws(()=>checkedPublicDutyMeal(r),/invalid_evidence_schema/);assert.equal(reads,0);
 }
 for(const value of [NaN,Infinity,-Infinity]){const r=receipt('kitchen',true);r.funding!.paidAfter=value;assert.throws(()=>checkedPublicDutyMeal(r));}
 for(const kind of ['sparse','extra','getter'] as const){const e=event() as any;let reads=0;
  if(kind==='sparse')delete e.publicDutyMeals[0];if(kind==='extra')e.publicDutyMeals.private='SECRET';
  if(kind==='getter')Object.defineProperty(e.publicDutyMeals,'0',{get(){reads++;return receipt();}});
  assert.throws(()=>checkedFoodEvent(e));assert.equal(reads,0);
 }
});
test('public meal audit: legacy omission and incomplete session are unknown, explicit empty is zero',()=>{
 const current=event();if(current.type!=='food_step_committed')return;const {publicDutyMeals:omitted,...legacy}=current;
 assert.equal(auditPublicDutyMeals([legacy],true).totals,null);assert.equal(auditPublicDutyMeals([],true).totals,null);
 assert.equal(auditPublicDutyMeals([event([])],true).totals!.completedActions,0);
 assert.equal(auditPublicDutyMeals([event()],false).totals,null);
});
test('public meal audit: duplicate event or shift/service across steps cannot double-count',()=>{
 const r=receipt(),next={...r,eventId:'service-2',at:511};
 const later={...event([next]),fromMinute:510,toMinute:512} as RuntimeFoodEvent;
 assert.equal(auditPublicDutyMeals([event([r]),later],true).totals,null);
 next.serviceNumber=2;assert.equal(auditPublicDutyMeals([event([r]),later],true).totals!.completedActions,2);
 next.eventId=r.eventId;assert.equal(auditPublicDutyMeals([event([r]),later],true).totals,null);
 r.at=480;assert.equal(auditPublicDutyMeals([event([r])],true).totals,null);
});
test('public meal audit: collisions with every event-bearing meal slice and physical flows are rejected',()=>{
 for(const key of ['receipts','careMeals','childCareMeals','longCareMeals','journeyMeals','foodFlows']){
  const e=event() as any;e[key]=[{eventId:'service-1'}];assert.equal(auditPublicDutyMeals([e],true).totals,null);
 }
});
test('public meal audit: exact midnight is ending day, and observed days never fabricate empty history',()=>{
 const r=receipt();r.at=1440;const n={...r,at:1440.25,eventId:'next',serviceNumber:2};
 assert.deepEqual(observedPublicDutyMealsByDay([event([r,n])]).map(d=>d.calendarDay),[0,1]);
 assert.deepEqual(observedPublicDutyMealsByDay([]),[]);
});
function persist(directory:string,o:DirectEatingObservation){
 const fingerprint='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:o.worldId,fromMinute:o.fromMinute});
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(o.fromMinute);food.start(o.worldId,o.fromMinute);food.committed(o,1);wait.stop(o.toMinute);food.stop(o.worldId,o.toMinute);
 return {writer,report:writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint})};
}
test('public meal writer: sealed personal/public evidence and legacy omission roundtrip',t=>{
 const root=mkdtempSync(join(testTmpdir(),'public-meal-schema-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const a=receipt(),b=receipt('care',true);b.eventId='funded';b.shiftId='shift-2';b.funding!.account='escrow:shift-2:wages';
 const {writer,report}=persist(join(root,'valid'),observation([a,b]));t.after(()=>writer.abort());
 assert.equal(report.complete,true);assert.equal(report.publicDutyMeals.complete,true);assert.equal(report.publicDutyMeals.totals!.wages,3);
 assert.equal(report.directEating.totals!.completedActions,0);assert.equal(report.foodConsumption,null);
 assert.deepEqual(readAcceptanceEvidence(join(root,'valid')),report);
 const old=observation();delete old.publicDutyMeals;const legacy=persist(join(root,'legacy'),old);t.after(()=>legacy.writer.abort());
 assert.equal(legacy.report.complete,true);assert.equal(legacy.report.publicDutyMeals.totals,null);assert.equal(legacy.report.directEating.publicDutyMeals.totals,null);
});
test('public meal writer: corruption and missing seal clear both exposed public meal totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'public-meal-broken-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const mode of ['missing','corrupt']){const dir=join(root,mode),{writer}=persist(dir,observation());t.after(()=>writer.abort());
  if(mode==='missing')unlinkSync(join(dir,'run-close.json'));else{const p=join(dir,'evidence.jsonl');writeFileSync(p,readFileSync(p,'utf8').replace('"hungerRelief":42','"hungerRelief":41'));}
  const report=readAcceptanceEvidence(dir);assert.equal(report.complete,false);assert.equal(report.publicDutyMeals.totals,null);assert.equal(report.directEating.publicDutyMeals.totals,null);
 }
});
test('public meal audit: overflow cannot be hidden by a later unknown nutrition receipt',()=>{
 const a=receipt(),b=receipt(),c=receipt();
 for(const [i,r] of [a,b,c].entries()){r.eventId='service-'+i;r.serviceNumber=i+1;r.inputs[0].nutrition=1e308;r.inputs[0].lots![0].nutrition=1e308;}
 c.inputs[0].nutrition=null;c.inputs[0].lots=null;
 const report=auditPublicDutyMeals([event([a,b,c])],true);assert.equal(report.totals,null);assert.ok(report.issues.includes('non_finite_public_duty_aggregate'));
});

test('public meal writer: fsync failure during public receipt publication clears both totals without changing input or readback bytes',t=>{
 const root=mkdtempSync(join(testTmpdir(),'public-meal-sync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),o=observation([receipt('care',true)]),before=structuredClone(o);let fail=false;
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:o.worldId,fromMinute:o.fromMinute,
  io:{fsyncSync(fd){if(fail)throw new Error('Offline public meal sync failure');fsyncSync(fd);}}});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});food.start(o.worldId,o.fromMinute);
 fail=true;food.committed(o,1);
 assert.equal(food.status().phase,'failed');assert.equal(writer.status().failure,'sync_failed');assert.deepEqual(o,before);
 const path=join(directory,'evidence.jsonl'),bytes=readFileSync(path);
 assert.ok(bytes.toString('utf8').includes('"publicDutyMeals"'));
 const report=readAcceptanceEvidence(directory);
 assert.equal(report.complete,false);assert.equal(report.publicDutyMeals.complete,false);assert.equal(report.directEating.publicDutyMeals.complete,false);
 assert.equal(report.publicDutyMeals.totals,null);assert.equal(report.directEating.publicDutyMeals.totals,null);
 assert.deepEqual(readFileSync(path),bytes);
});
test('public meal writer: source fingerprint drift invalidates both totals while preserving observed receipt and persisted evidence',t=>{
 const root=mkdtempSync(join(testTmpdir(),'public-meal-drift-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),o=observation([receipt('care',true)]),before=structuredClone(o);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:o.worldId,fromMinute:o.fromMinute});t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(o.fromMinute);food.start(o.worldId,o.fromMinute);food.committed(o,1);wait.stop(o.toMinute);food.stop(o.worldId,o.toMinute);
 const path=join(directory,'evidence.jsonl'),prefix=readFileSync(path);
 const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:'b'.repeat(64)});
 assert.equal(writer.status().phase,'closed');assert.equal(report.complete,false);assert.ok(report.issues.includes('source_changed'));
 assert.equal(report.publicDutyMeals.complete,false);assert.equal(report.directEating.publicDutyMeals.complete,false);
 assert.equal(report.publicDutyMeals.totals,null);assert.equal(report.directEating.publicDutyMeals.totals,null);
 assert.deepEqual(report.publicDutyMeals.observedReceipts,o.publicDutyMeals);assert.deepEqual(o,before);
 const bytes=readFileSync(path),sealPath=join(directory,'run-close.json'),seal=readFileSync(sealPath);
 assert.deepEqual(bytes.subarray(0,prefix.length),prefix);
 assert.deepEqual(readAcceptanceEvidence(directory),report);assert.deepEqual(readFileSync(path),bytes);assert.deepEqual(readFileSync(sealPath),seal);
});

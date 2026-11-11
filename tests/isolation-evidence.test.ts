import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeFood} from '../src/world/food.js';
import {createIsolationEvidence,isolationSnapshot} from '../src/world/isolation-evidence.js';
import {settlementFoodCoverage} from '../src/world/food-coverage.js';
import {DAY} from '../src/world/time.js';
import type {DecisionProtection} from '../src/shared/decision-protection.js';
function setup(){const w=createWorld();w.mode='formal';initializeFood(w);return w;}
function protection(at:number):DecisionProtection{return {startedAt:at,expiresAt:at+180,endedAt:null,reason:null,recoveredAt:null,localDecisionsAtStart:0,before:{health:1,hunger:100,energy:0},prevented:{hunger:0,exhaustion:0},losses:{hunger:0,exhaustion:0,illnessOrInjury:0,hazard:0}};}

test('evidence is read-only and reuses distinct collective stock and personal usable coverage',()=>{
 const w=setup(),r=w.residents[0];r.inventory={meal:100};initializeFood(w);
 for(const lot of w.food!.lots['person:'+r.id].meal??[])lot.expiresAt=w.minute+60;
 const before=structuredClone(w),expected=settlementFoodCoverage(w),snapshot=isolationSnapshot(w);
 assert.equal(snapshot.food.collectiveStockDays,expected.stockDays);
 assert.equal(snapshot.food.personal[0].usableDays,expected.residents[0].days);
 assert.equal(snapshot.food.personal[0].accessBlocked,expected.residents[0].accessBlocked??null);
 assert.equal(snapshot.food.personal[0].usableNutrition,expected.residents[0].usableNutrition);
 assert.equal(snapshot.food.personal[0].dailyNeed,expected.residents[0].dailyNeed);
 assert.equal(snapshot.food.personal[0].sourceLabel,expected.residents[0].sourceLabel);
 assert.ok(snapshot.food.collectiveStockDays>snapshot.food.personal[0].usableDays);
 const observer=createIsolationEvidence(w);w.minute++;const stepped=structuredClone(w);observer.sample(w);observer.finish(w);assert.deepEqual(w,stepped);
 w.minute--;assert.deepEqual(w,before);
});

test('completed action dedup survives reload and inventory changes are not consumption or production',()=>{
 let w=setup();const observer=createIsolationEvidence(w);w.minute++;const r=w.residents[0];r.recentActions=[{type:'eat',at:w.minute}];r.inventory={};
 observer.sample(w);observer.sample(w);w=structuredClone(w);w.minute++;observer.sample(w);
 const report=observer.finish(w)!;assert.equal(report.completedActions.eat,1);assert.equal(report.foodConsumption.value,null);assert.equal(report.foodProduction.value,null);
 report.completedActions.eat=99;assert.equal(observer.finish(w)!.completedActions.eat,1);
});

test('chosen wait, idle due and active protection are distinct end-of-minute samples',()=>{
 const w=setup();for(const r of w.residents)r.canDecide=false;
 const [r,other]=w.residents;r.canDecide=r.canExpress=true;r.decisionDue=w.minute;
 other.activity={planId:'wait',action:{type:'wait',minutes:10},startedAt:w.minute,remaining:10,path:[],target:other.at,definition:'action/routine@1'};
 r.decisionProtection=protection(w.minute);const observer=createIsolationEvidence(w);w.minute++;observer.sample(w);
 const report=observer.finish(w)!;assert.deepEqual(report.observedSamples,{chosenWait:1,idleDecisionDue:1,activeProtection:1});assert.equal(report.technicalOrModelWaitMinutes.value,null);
});

test('boundaries emit closing day once, carry exact endpoint forward and reject gaps',()=>{
 const w=setup();w.minute=DAY-1;const observer=createIsolationEvidence(w);w.minute++;const first=observer.sample(w)!;
 assert.equal(first.calendarDay,0);assert.equal(first.sampledMinutes,1);assert.equal(first.toMinute,DAY);assert.equal(observer.sample(w),null);assert.equal(observer.finish(w),null);
 w.residents[0].health=12;w.minute++;observer.sample(w);const second=observer.finish(w)!;
 assert.equal(second.calendarDay,1);assert.deepEqual(second.start,first.end);assert.equal(second.sampledMinutes,1);assert.equal(second.fromMinute,DAY);
 w.minute+=2;assert.throws(()=>observer.sample(w),/consecutive/);
});

test('only incremental recorded protection losses are counted, never net health damage',()=>{
 const w=setup(),r=w.residents[0];r.decisionProtection=protection(w.minute);r.decisionProtection.losses.hunger=2;
 const observer=createIsolationEvidence(w);w.minute++;r.health-=10;r.decisionProtection.losses.hunger=3;r.decisionProtection.prevented.hunger=4;
 const e={id:'ended',at:w.minute,kind:'system' as const,actors:[r.id],place:r.at,text:'fact',witnesses:[],decisionProtection:{phase:'ended' as const,state:structuredClone(r.decisionProtection),after:{health:r.health,hunger:r.hunger,energy:r.energy}}};w.events.push(e);
 observer.sample(w);w.minute++;observer.sample(w);const report=observer.finish(w)!;
 assert.equal(report.protectionRecorded.losses.hunger,1);assert.equal(report.protectionRecorded.prevented.hunger,4);assert.equal(report.protectionRecorded.losses.hazard,0);assert.equal(report.grossHealthDamage.value,null);
});

test('spoilage uses counter increments, including nonfood perishables, not disappearing inventory',()=>{
 const w=setup();w.food!.spoiled.berry=4;const observer=createIsolationEvidence(w);w.minute++;w.food!.spoiled.berry=6;w.residents[0].inventory={};observer.sample(w);
 assert.deepEqual(observer.finish(w)!.spoiledUnits,{berry:2});w.minute++;w.food!.spoiled.berry=1;assert.throws(()=>observer.sample(w),/counter reset/);
});

test('removing a previously nonzero spoilage counter is a reset, not zero spoilage',()=>{
 const w=setup();w.food!.spoiled.berry=4;const observer=createIsolationEvidence(w);w.minute++;delete w.food!.spoiled.berry;assert.throws(()=>observer.sample(w),/counter reset/);
});

test('endpoint evidence explicitly identifies medical transport blocked food access',()=>{
 const w=setup(),[r,other]=w.residents;initializeHealth(w);r.inventory={meal:4};initializeFood(w);
 w.health!.transports.push({id:'transport',carrierId:other.id,patientId:r.id,buildingId:'lodge',bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
 const before=structuredClone(w),person=isolationSnapshot(w).food.personal.find(p=>p.residentId===r.id)!;
 assert.equal(person.accessBlocked,'medicalTransport');assert.equal(person.usableNutrition,0);assert.equal(person.lowFood,true);assert.deepEqual(w,before);
});

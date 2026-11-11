import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditRuntimeFoodEvidence,observedCareMealsByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import type {CareMealReceipt} from '../src/world/food-consumption-evidence.js';
import {careFixture,acceptedCare,originalCareLots,queueOrdinaryCare} from './helpers/care-meal-evidence.js';

function actual(){const f=careFixture();acceptedCare(f);originalCareLots(f);queueOrdinaryCare(f);return {f,observation:stepWorldWithFoodEvidence(f.w,30)};}
function session(receipts:CareMealReceipt[]|null){
 const {observation}=actual(),events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start(observation.worldId,observation.fromMinute);
 const input={...observation,...(receipts===null?{}:{careMeals:receipts})};if(receipts===null)delete input.careMeals;
 food.committed(input,1);food.stop(observation.worldId,observation.toMinute);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}

test('care meals runtime: real operation emits deeply immutable independent evidence, not direct eat or production',()=>{
 const {observation}=actual(),source=observation.careMeals![0],f=session([source]);source.inputs[0].quantity=99;
 const step=f.events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 assert.ok(Object.isFrozen(step.careMeals));assert.ok(Object.isFrozen(step.careMeals![0].inputs[0].lots![0]));
 assert.equal(step.careMeals![0].inputs[0].quantity,1);assert.equal(f.report.careMeals.complete,true);
 assert.deepEqual(f.report.careMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:22,completedActions:1});
 assert.equal(f.report.totals!.completedActions,0);assert.equal(f.report.foodConsumption,null);assert.equal(f.report.foodProduction,null);
});

test('care meals runtime: old rows are accepted without treating missing coverage, open sessions or no steps as zero',()=>{
 const f=session([]);assert.equal(f.report.careMeals.complete,true);assert.equal(f.report.careMeals.totals!.completedActions,0);
 const legacy=session(null);assert.equal(legacy.report.complete,true);assert.equal(legacy.report.careMeals.totals,null);
 assert.deepEqual(checkedFoodEvent(legacy.events[1]),legacy.events[1]);
 assert.equal(auditRuntimeFoodEvidence(f.events.slice(0,-1),f.food.status()).careMeals.totals,null);
 assert.equal(auditRuntimeFoodEvidence(f.events.slice(1),f.food.status()).careMeals.totals,null);
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start('fixture',480);food.stop('fixture',480);
 assert.equal(auditRuntimeFoodEvidence(events,food.status()).careMeals.totals,null);
 const old={...legacy.events[1]} as any;delete old.foodFlows;delete old.foodFlowCoverage;assert.deepEqual(checkedFoodEvent(old),old);
});

test('care meals runtime: strict schema rejects every extra nesting field, getters, sparse arrays and invalid scalar types',()=>{
 const f=session(actual().observation.careMeals!);const valid=f.events[1];assert.deepEqual(checkedFoodEvent(valid),valid);
 for(const path of ['receipt','amount','lot'] as const){const bad=structuredClone(valid) as any;
  const target=path==='receipt'?bad.careMeals[0]:path==='amount'?bad.careMeals[0].inputs[0]:bad.careMeals[0].inputs[0].lots[0];
  target.prompt='PRIVATE';assert.throws(()=>checkedFoodEvent(bad),/invalid_evidence_schema/);
 }
 for(const value of [Infinity,NaN,-1,'1',null]){const bad=structuredClone(valid) as any;bad.careMeals[0].inputs[0].quantity=value;assert.throws(()=>checkedFoodEvent(bad));}
 for(const path of ['receipt','amount','lot'] as const){let calls=0;const bad=structuredClone(valid) as any;
  const target=path==='receipt'?bad.careMeals:path==='amount'?bad.careMeals[0].inputs:bad.careMeals[0].inputs[0].lots;
  Object.defineProperty(target,'0',{get(){calls++;return {};}});assert.throws(()=>checkedFoodEvent(bad));assert.equal(calls,0);
 }
 const sparse=structuredClone(valid) as any;delete sparse.careMeals[0].inputs[0];assert.throws(()=>checkedFoodEvent(sparse));
});

test('care meals runtime: missing original nutrition is null while forged amounts, metadata and identities are rejected',()=>{
 const receipt=actual().observation.careMeals![0];
 const unknown=structuredClone(receipt);unknown.inputs[0].nutrition=null;unknown.inputs[0].lots![0].nutrition=null;
 assert.equal(session([unknown]).report.careMeals.totals!.nutrition,null);
 for(const mutate of [
  (r:CareMealReceipt)=>{r.inputs[0].lots=null;},(r:CareMealReceipt)=>{r.inputs[0].lots=[];},
  (r:CareMealReceipt)=>{r.inputs[0].lots![0].quantity=10;},(r:CareMealReceipt)=>{r.inputs[0].lots![0].nutrition=20;},
  (r:CareMealReceipt)=>{r.inputs[0].lots![0].producedAt=r.at+1;},(r:CareMealReceipt)=>{r.inputs[0].lots![0].expiresAt=r.at;},
  (r:CareMealReceipt)=>{r.inputs[0].quantity=0;},(r:CareMealReceipt)=>{r.beneficiaryId=r.providerId;},
  (r:CareMealReceipt)=>{r.container='person:wrong';},(r:CareMealReceipt)=>{r.proposalId=null;},
  (r:CareMealReceipt)=>{r.hungerAfter=0;r.hungerRelief=r.hungerBefore;},(r:CareMealReceipt)=>{r.inputs[1].nutrition=7;},
 ]){const bad=structuredClone(receipt);mutate(bad);assert.equal(session([bad]).report.careMeals.totals,null);}
 assert.equal(session([receipt,receipt]).report.careMeals.totals,null);
 const bad=structuredClone(receipt);bad.inputs[0].quantity=NaN;assert.equal(session([bad]).food.status().phase,'failed');
});

test('care meals runtime: exact midnight belongs to ending day, fractional crossing does not fill unobserved days',()=>{
 const first=actual().observation.careMeals![0],second=structuredClone(first);first.at=1440;second.at=1440.25;second.eventId='later';
 const event={...session([]).events[1],fromMinute:1439.75,toMinute:1440.5,careMeals:[first,second]} as RuntimeFoodEvent;
 assert.deepEqual(observedCareMealsByDay([event]).map(d=>[d.calendarDay,d.receipts.map(r=>r.at)]),[[0,[1440]],[1,[1440.25]]]);
 assert.deepEqual(observedCareMealsByDay([]),[]);assert.deepEqual(observedCareMealsByDay(session(null).events),[]);
});

test('care meals writer: strict persisted roundtrip, corruption and failure keep unavailable totals null',t=>{
 const root=mkdtempSync(join(testTmpdir(),'valley-care-meals-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fingerprint='a'.repeat(64),{observation}=actual();
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:observation.worldId,fromMinute:observation.fromMinute});t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(observation.fromMinute);food.start(observation.worldId,observation.fromMinute);food.committed(observation,1);wait.stop(observation.toMinute);food.stop(observation.worldId,observation.toMinute);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
 assert.equal(result.complete,true);assert.equal(result.careMeals.totals!.nutrition,25);assert.deepEqual(readAcceptanceEvidence(directory),result);
 const path=join(directory,'evidence.jsonl');writeFileSync(path,readFileSync(path,'utf8').replace('"hungerRelief":22','"hungerRelief":21'));
 const corrupt=readAcceptanceEvidence(directory);assert.equal(corrupt.complete,false);assert.equal(corrupt.careMeals.totals,null);assert.equal(corrupt.directEating.careMeals.totals,null);
 assert.throws(()=>new AcceptanceEvidenceWriter({directory:join(root,'failure'),sourceFingerprint:fingerprint,worldId:observation.worldId,fromMinute:observation.fromMinute,io:{writeSync:()=>{throw new Error('Synthetic writer failure');}}}),/write_failed/);
 const failed=readAcceptanceEvidence(join(root,'failure'));assert.equal(failed.complete,false);assert.equal(failed.careMeals.totals,null);assert.equal(failed.directEating.careMeals.totals,null);
});

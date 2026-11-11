import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditFamilyJourneyMeals} from '../src/server/family-journey-meal-evidence.js';
import {checkedFamilyJourneyMeal} from '../src/server/acceptance-evidence-schema.js';
import {familyJourneyMealFixture,acceptFamilyJourney,chooseFamilyJourney,finishFamilyJourneyChoice} from './helpers/family-journey-meal-evidence.js';
import type {FamilyJourneyMealReceipt} from '../src/world/food-consumption-evidence.js';

function actual(){const f=familyJourneyMealFixture(true);acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');return {f,rows:finishFamilyJourneyChoice(f.w,f.parent)};}
function audit(rows:FamilyJourneyMealReceipt[]){const events:RuntimeFoodEvent[]=[];const food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});const at=rows[0].at;food.start('synthetic',at-1);food.committed({worldId:'synthetic',fromMinute:at-1,toMinute:at+1,receipts:[],familyJourneyMeals:rows},1);food.stop('synthetic',at+1);return auditFamilyJourneyMeals(events,true);}

test('independent family review: unsorted three-lot split uses provider offset, not member index',()=>{
 const f=familyJourneyMealFixture(true);acceptFamilyJourney(f);
 for(const [v,n] of [[80,8],[81,16],[82,32]])f.w.definitions['food/life@'+v]={...f.w.definitions['food/life@1'],version:v,data:{...f.w.definitions['food/life@1'].data,nutrition:{meal:n}}};
 const lot=(quantity:number,age:number,expiry:number,v:number)=>({quantity,producedAt:f.w.minute-age,expiresAt:f.w.minute+expiry,definition:'food/life@'+v});
 f.w.food!.lots['person:'+f.parent.id].meal=[lot(38.5,5,1000,82),lot(.375,20,600,80),lot(1.125,10,800,81)];
 chooseFamilyJourney(f.w,f.parent,'depart');const rows=finishFamilyJourneyChoice(f.w,f.parent);
 assert.deepEqual(rows.map(r=>r.providerPortion),[0,0,1]);
 assert.equal(rows[0].inputs[0].nutrition,13);assert.equal(rows[2].inputs[0].nutrition,24);
 assert.deepEqual(rows[2].inputs[0].lots!.map(l=>[l.quantity,l.nutrition]),[[.5,8],[.5,16]]);
 for(const r of rows)assert.deepEqual(checkedFamilyJourneyMeal(r),r);
 assert.equal(audit(rows).complete,true);
});

test('independent family review: source observation and published receipt mutations cannot change each other',()=>{
 const {rows}=actual(),events:RuntimeFoodEvent[]=[];const food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});const at=rows[0].at;
 food.start('synthetic',at-1);food.committed({worldId:'synthetic',fromMinute:at-1,toMinute:at+1,receipts:[],familyJourneyMeals:rows},1);
 const step=events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 const before=structuredClone(step.familyJourneyMeals);rows[0].inputs[0].lots![0].definition='food/life@999';rows.reverse();
 assert.deepEqual(step.familyJourneyMeals,before);assert.throws(()=>{step.familyJourneyMeals![0].inputs[0].lots!.push({quantity:1,producedAt:0,expiresAt:1,definition:'x',nutrition:1});},TypeError);
});

test('independent family review: runtime top-level family accessor is never executed',()=>{
 const {rows}=actual();let calls=0;const events:RuntimeFoodEvent[]=[];const food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});const at=rows[0].at;
 const observation={worldId:'synthetic',fromMinute:at-1,toMinute:at+1,receipts:[]};Object.defineProperty(observation,'familyJourneyMeals',{get(){calls++;return rows;}});
 food.start('synthetic',at-1);food.committed(observation,1);assert.equal(calls,0);assert.equal(food.status().phase,'failed');assert.equal(events.length,1);
});

test('independent family review: separate providers cannot hide repeated beneficiary or incomplete group',()=>{
 const {rows}=actual();const repeated=structuredClone(rows);repeated[2].beneficiaryId=repeated[1].beneficiaryId;
 assert.equal(audit(repeated).totals,null);assert.equal(audit(rows.slice(0,2)).totals,null);
 const badOffset=structuredClone(rows);badOffset[2].providerPortion=2;assert.equal(audit(badOffset).totals,null);
});

test('independent family review: departure receipts do not enter legacy journey slice or persistent world',()=>{
 const f=familyJourneyMealFixture();acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');
 const observed=stepWorldWithFoodEvidence(f.w,1);assert.equal(observed.familyJourneyMeals!.length,2);assert.deepEqual(observed.journeyMeals,[]);
 assert.equal(JSON.stringify(f.w).includes('familyJourneyMeals'),false);
});

test('independent family review: unknown legacy original nutrition is not replaced by current definition',()=>{
 const f=familyJourneyMealFixture();acceptFamilyJourney(f);for(const l of f.w.food!.lots['person:'+f.parent.id].meal!)l.definition='unknown/legacy@1';
 chooseFamilyJourney(f.w,f.parent,'depart');const rows=finishFamilyJourneyChoice(f.w,f.parent);
 for(const r of rows){assert.equal(r.inputs[0].nutrition,null);assert.equal(r.inputs[0].lots![0].definition,'unknown/legacy@1');assert.ok(r.hungerRelief>0);}
 assert.equal(audit(rows).totals!.nutrition,null);
});

test('independent family review: source mutation at seal suppresses both nested and top-level family totals',async t=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{testTmpdir}=await import('../scripts/repository-temporary.mjs'),{join}=await import('node:path');
 const {AcceptanceEvidenceWriter,readAcceptanceEvidence}=await import('../src/server/acceptance-evidence-writer.js');
 const {DecisionWaitEvidence}=await import('../src/server/decision-wait-evidence.js');
 const {rows}=actual(),at=rows[0].at,directory=mkdtempSync(join(testTmpdir(),'family-independent-review-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const writer=new AcceptanceEvidenceWriter({directory:join(directory,'evidence'),sourceFingerprint:'a'.repeat(64),worldId:'synthetic',fromMinute:at-1});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(at-1);food.start('synthetic',at-1);food.committed({worldId:'synthetic',fromMinute:at-1,toMinute:at+1,receipts:[],familyJourneyMeals:rows},1);food.stop('synthetic',at+1);wait.stop(at+1);
 const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:'b'.repeat(64)});
 assert.equal(report.complete,false);assert.equal(report.familyJourneyMeals.totals,null);assert.equal(report.directEating.familyJourneyMeals.totals,null);
 const recovered=readAcceptanceEvidence(join(directory,'evidence'));assert.equal(recovered.familyJourneyMeals.totals,null);assert.equal(recovered.directEating.familyJourneyMeals.totals,null);
});

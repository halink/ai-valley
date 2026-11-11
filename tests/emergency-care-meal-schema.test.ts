import {test} from 'node:test';
import {DAY} from '../src/world/time.js';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync,fsyncSync,readFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import type {EmergencyCareMealReceipt} from '../src/world/food-consumption-evidence.js';
import {checkedEmergencyCareMeal,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditEmergencyCareMeals,observedEmergencyCareMealsByDay} from '../src/server/emergency-care-meal-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';

function receipt():EmergencyCareMealReceipt{return {action:'emergencyCare',operation:'feed',at:481,providerId:'provider',beneficiaryId:'child',eventId:'feeding',planId:'plan',container:'person:provider',definition:'action/routine@1',agreementId:'agreement',mealNumber:1,inputs:[{item:'meal',quantity:1,nutrition:25,lots:[{quantity:.25,producedAt:400,expiresAt:900,definition:'food/life@90',nutrition:2.5},{quantity:.75,producedAt:420,expiresAt:1000,definition:'food/life@91',nutrition:22.5}]},{item:'water',quantity:1,nutrition:0,lots:[]}],hungerBefore:70,hungerAfter:45,hungerRelief:25};}
function observation(rows:EmergencyCareMealReceipt[]|undefined){return {worldId:'emergency-review',fromMinute:480,toMinute:481,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[],longCareMeals:[],...(rows===undefined?{}:{emergencyCareMeals:rows})};}
function session(rows:EmergencyCareMealReceipt[]|undefined){const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start('emergency-review',480);food.committed(observation(rows),1);food.stop('emergency-review',481);return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};}

test('emergency schema: exact operation-specific authority fields, physical recipe and identity',()=>{
 assert.deepEqual(checkedEmergencyCareMeal(receipt()),receipt());
 const rescue={...receipt(),operation:'rescueMeal' as const,agreementId:null,mealNumber:null};assert.deepEqual(checkedEmergencyCareMeal(rescue),rescue);
 const edits:Array<(r:any)=>void>=[r=>r.operation='offer',r=>r.agreementId=null,r=>r.mealNumber=null,r=>r.mealNumber=0,r=>r.mealNumber=5,r=>r.mealNumber=1.5,r=>r.operation='rescueMeal',r=>r.container='public:provider',r=>r.beneficiaryId=r.providerId,r=>r.inputs[0].item='berry',r=>r.inputs[0].quantity=2,r=>r.inputs[1].quantity=.5,r=>r.inputs[1].nutrition=1,r=>r.inputs[1].lots=null,r=>r.inputs.push(structuredClone(r.inputs[0])),r=>r.inputs[1]=structuredClone(r.inputs[0])];
 for(const edit of edits){const r=receipt();edit(r);assert.throws(()=>checkedEmergencyCareMeal(r),/invalid_evidence_schema/);}
 for(const field of ['agreementId','mealNumber']){const r:any=structuredClone(rescue);r[field]=field==='agreementId'?'agreement':1;assert.throws(()=>checkedEmergencyCareMeal(r));}
});

test('emergency schema: known original nutrition drives capped relief while unknown nutrition stays unknown',()=>{
 for(const hunger of [12,24.5,25,70,100]){const r=receipt();r.hungerBefore=hunger;r.hungerAfter=Math.max(0,hunger-25);r.hungerRelief=hunger-r.hungerAfter;assert.doesNotThrow(()=>checkedEmergencyCareMeal(r));}
 for(const edit of [(r:any)=>{r.hungerBefore=11;r.hungerAfter=0;r.hungerRelief=11;},(r:any)=>{r.hungerBefore=101;r.hungerAfter=76;},(r:any)=>{r.hungerAfter=22;r.hungerRelief=48;},(r:any)=>r.hungerRelief=24,(r:any)=>r.inputs[0].lots[0].quantity=.5,(r:any)=>r.inputs[0].lots[0].expiresAt=r.at,(r:any)=>r.inputs[0].lots[0].producedAt=r.at+1,(r:any)=>r.inputs[0].lots[0].nutrition=null,(r:any)=>r.inputs[0].lots=null]){const r=receipt();edit(r);assert.throws(()=>checkedEmergencyCareMeal(r));}
 for(const missingLots of [false,true]){const r=receipt();r.inputs[0].nutrition=null;if(missingLots)r.inputs[0].lots=null;else r.inputs[0].lots![0].nutrition=null;r.hungerAfter=30;r.hungerRelief=40;assert.doesNotThrow(()=>checkedEmergencyCareMeal(r));const result=session([r]).report.emergencyCareMeals;assert.equal(result.complete,true);assert.equal(result.totals!.nutrition,null);assert.equal(result.totals!.hungerRelief,40);}
});

test('emergency schema: all nesting levels reject secrets, accessors, symbols, holes and non-finite numbers',()=>{
 const base=session([receipt()]).events[1];let calls=0;
 for(const level of ['event','rows','receipt','inputs','amount','lots','lot'])for(const mutation of ['extra','getter','symbol']){const e:any=structuredClone(base),r=e.emergencyCareMeals[0],target=level==='event'?e:level==='rows'?e.emergencyCareMeals:level==='receipt'?r:level==='inputs'?r.inputs:level==='amount'?r.inputs[0]:level==='lots'?r.inputs[0].lots:r.inputs[0].lots[0];
  if(mutation==='extra')target.privateText='SYNTHETIC_PRIVATE';if(mutation==='symbol')target[Symbol('hidden')]='SYNTHETIC_PRIVATE';if(mutation==='getter')Object.defineProperty(target,Object.keys(target)[0],{get(){calls++;return 'SYNTHETIC_PRIVATE';}});assert.throws(()=>checkedFoodEvent(e),/invalid_evidence_schema/);
 }
 for(const edit of [(e:any)=>delete e.emergencyCareMeals[0],(e:any)=>delete e.emergencyCareMeals[0].inputs[0],(e:any)=>e.emergencyCareMeals[0].hungerRelief=Infinity,(e:any)=>e.emergencyCareMeals[0].inputs[0].nutrition=NaN]){const e=structuredClone(base);edit(e);assert.throws(()=>checkedFoodEvent(e));}assert.equal(calls,0);
});

test('emergency audit: legacy omission is unknown, explicit empty is observed zero, incomplete session fails closed',()=>{
 const old=session(undefined);assert.deepEqual(checkedFoodEvent(old.events[1]),old.events[1]);assert.equal(old.report.complete,true);assert.equal(old.report.emergencyCareMeals.totals,null);
 const zero=session([]);assert.deepEqual(zero.report.emergencyCareMeals.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 for(const events of [zero.events.slice(1),zero.events.slice(0,-1)])assert.equal(auditRuntimeFoodEvidence(events,zero.food.status()).emergencyCareMeals.totals,null);
 assert.deepEqual(observedEmergencyCareMealsByDay(zero.events),[]);
});

test('emergency audit: agreement meal identity spans steps without requiring observation from meal one',()=>{
 const base=session([receipt()]).events;const first=structuredClone(base[1]) as any;
 const audit=(steps:any[])=>auditEmergencyCareMeals([base[0],...steps,{...base.at(-1)!,sequence:steps.length+2,toMinute:steps.at(-1).toMinute} as RuntimeFoodEvent],true);
 const second=structuredClone(first);second.fromMinute=481;second.toMinute=482;second.sequence++;second.revision++;second.emergencyCareMeals[0].at=482;second.emergencyCareMeals[0].eventId='second';
 assert.equal(audit([first,second]).totals,null);
 second.emergencyCareMeals[0].mealNumber=2;assert.equal(audit([first,second]).totals!.completedActions,2);
 second.emergencyCareMeals[0].mealNumber=1;second.emergencyCareMeals[0].agreementId='different';assert.equal(audit([first,second]).totals!.completedActions,2);
 first.emergencyCareMeals[0].mealNumber=4;assert.equal(audit([first]).complete,true);
 for(const at of [480,482]){const e=structuredClone(first);e.emergencyCareMeals[0].at=at;assert.equal(audit([e]).totals,null);}
});

test('emergency audit: cross-slice identities invalidate emergency and corresponding care slices',()=>{
 for(const kind of ['careMeals','childCareMeals','longCareMeals','receipts','foodFlows']){const s=session([receipt()]),events:any=structuredClone(s.events),step=events[1],r=receipt();
  if(kind==='careMeals')step[kind]=[{...r,action:'care',proposalId:null,authority:'consent'}];
  if(kind==='childCareMeals')step[kind]=[{...r,action:'tendChild',authority:'guardian',hungerAfter:22,hungerRelief:48}];
  if(kind==='longCareMeals')step[kind]=[{...r,action:'longCare',operation:'visit',slotKey:'slot',healthBefore:80,healthAfter:90,healthGain:10}];
  if(['careMeals','childCareMeals','longCareMeals'].includes(kind)){delete step[kind][0].mealNumber;if(kind!=='longCareMeals')delete step[kind][0].agreementId;if(kind!=='longCareMeals')delete step[kind][0].operation;}
  if(kind==='receipts')step[kind]=[{at:481,residentId:'provider',eventId:r.eventId,planId:'eat-plan',container:'person:provider',item:'meal',quantity:1,nutrition:25,hungerRelief:25}];
  if(kind==='foodFlows')step[kind]=[{type:'processed',action:'cook',at:481,residentId:'provider',eventId:r.eventId,planId:'cook-plan',container:'person:provider',definition:'action/routine@1',inputs:[],outputs:[]}];
  const result=auditRuntimeFoodEvidence(events,s.food.status());assert.equal(result.emergencyCareMeals.totals,null,kind);if(['careMeals','childCareMeals','longCareMeals'].includes(kind))assert.equal((result as any)[kind].totals,null,kind);
 }
});

test('emergency writer: sealed roundtrip and removed close seal invalidate both exposed totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'emergency-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'sealed'),fingerprint='a'.repeat(64);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'emergency-review',fromMinute:480});t.after(()=>writer.abort());const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(480);food.start('emergency-review',480);food.committed(observation([receipt()]),1);wait.stop(481);food.stop('emergency-review',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});assert.equal(result.complete,true);assert.equal(result.emergencyCareMeals.totals!.nutrition,25);assert.deepEqual(readAcceptanceEvidence(directory),result);
 unlinkSync(join(directory,'run-close.json'));const broken=readAcceptanceEvidence(directory);assert.equal(broken.emergencyCareMeals.totals,null);assert.equal(broken.directEating.emergencyCareMeals.totals,null);
});

test('emergency writer: failed sync leaves unknown evidence without leaking error payloads',t=>{
 const root=mkdtempSync(join(testTmpdir(),'emergency-sync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'failure');let fail=false;
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:'emergency-review',fromMinute:480,io:{fsyncSync:fd=>{if(fail)throw new Error('SYNTHETIC_PRIVATE');fsyncSync(fd);}}});t.after(()=>writer.abort());const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});food.start('emergency-review',480);fail=true;food.committed(observation([receipt()]),1);
 assert.equal(food.status().phase,'failed');assert.equal(writer.status().failure,'sync_failed');const report=readAcceptanceEvidence(directory);assert.equal(report.emergencyCareMeals.totals,null);assert.equal(report.directEating.emergencyCareMeals.totals,null);assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE'),false);
});


test('emergency writer: malformed nested records fail before serialization and never invoke accessors',t=>{
 const root=mkdtempSync(join(testTmpdir(),'emergency-reject-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const base=session([receipt()]).events;let calls=0,index=0;
 for(const level of ['event','rows','receipt','inputs','amount','lots','lot'])for(const mutation of ['extra','getter','symbol','nonfinite']){
  const e:any=structuredClone(base[1]),r=e.emergencyCareMeals[0],target=level==='event'?e:level==='rows'?e.emergencyCareMeals:level==='receipt'?r:level==='inputs'?r.inputs:level==='amount'?r.inputs[0]:level==='lots'?r.inputs[0].lots:r.inputs[0].lots[0];
  if(mutation==='extra')target.privateText='SYNTHETIC_PRIVATE';if(mutation==='symbol')target[Symbol('hidden')]='SYNTHETIC_PRIVATE';if(mutation==='getter')Object.defineProperty(target,Object.keys(target)[0],{get(){calls++;return 'SYNTHETIC_PRIVATE';}});
  if(mutation==='nonfinite'){if(Array.isArray(target))delete target[0];else target[level==='event'?'revision':level==='receipt'?'at':'quantity']=Infinity;}
  const directory=join(root,String(index++)),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:'emergency-review',fromMinute:480});t.after(()=>writer.abort());writer.observeDirectEating(base[0]);
  assert.throws(()=>writer.observeDirectEating(e));assert.equal(writer.status().failure,'invalid_input');const text=readFileSync(join(directory,'evidence.jsonl'),'utf8');assert.equal(text.includes('SYNTHETIC_PRIVATE'),false);assert.equal(text.includes('food_step_committed'),false);assert.equal(readAcceptanceEvidence(directory).emergencyCareMeals.totals,null);
 }
 assert.equal(calls,0);
});

test('emergency runtime: malicious slice accessor and sparse arrays fail without publishing a step',()=>{
 let calls=0;for(const mutate of [(o:any)=>Object.defineProperty(o,'emergencyCareMeals',{get(){calls++;return [];}}),(o:any)=>delete o.emergencyCareMeals[0],(o:any)=>Object.defineProperty(o.emergencyCareMeals,'0',{get(){calls++;return receipt();}})]){
  const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start('emergency-review',480);const o=observation([receipt()]);mutate(o);food.committed(o,1);assert.equal(food.status().phase,'failed');assert.equal(events.length,1);
 }assert.equal(calls,0);
});

test('emergency audit: one fixed 24-hour agreement cannot contain feed receipts a day apart',()=>{
 const base=session([receipt()]).events,first=structuredClone(base[1]) as any,second=structuredClone(first);
 second.sequence=3;second.revision=2;second.fromMinute=481;second.toMinute=481+DAY;
 const r=second.emergencyCareMeals[0];r.at=481+DAY;r.eventId='late-feeding';r.mealNumber=2;for(const lot of r.inputs[0].lots)lot.expiresAt=3000;
 const events=[base[0],first,second,{...base[2],sequence:4,toMinute:481+DAY} as RuntimeFoodEvent];
 assert.equal(auditEmergencyCareMeals(events,true).totals,null);
});


test('emergency audit: counters cannot skip, reverse event time, or change parties under the same agreement',()=>{
 const base=session([receipt()]).events;
 for(const reason of ['skip','provider','beneficiary','backwards']){
  const step:any=structuredClone(base[1]);step.toMinute=483;const r=structuredClone(step.emergencyCareMeals[0]);r.eventId='second-feeding';r.at=482;r.mealNumber=2;
  if(reason==='skip')r.mealNumber=3;if(reason==='provider'){r.providerId='replacement';r.container='person:replacement';}if(reason==='beneficiary')r.beneficiaryId='different-child';if(reason==='backwards'){step.emergencyCareMeals[0].at=482;r.at=481;}
  step.emergencyCareMeals.push(r);assert.equal(auditEmergencyCareMeals([base[0],step,{...base[2],toMinute:483} as RuntimeFoodEvent],true).totals,null,reason);
 }
});

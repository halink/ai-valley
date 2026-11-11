import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedJourneyMeal,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditJourneyMeals,observedJourneyMealsByDay} from '../src/server/journey-meal-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {captureDirectEating,type JourneyMealReceipt} from '../src/world/food-consumption-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {foodTransaction} from '../src/world/food.js';
import {stepWorld} from '../src/world/engine.js';
import {completeFamilyRelocation} from '../src/world/family-relocation.js';
import {mkdtempSync,rmSync,fsyncSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {YEAR} from '../src/world/time.js';

function meal():JourneyMealReceipt{return {action:'visitorJourney',operation:'eat',at:481,providerId:'traveller',beneficiaryId:'traveller',eventId:'completion',journeyId:'journey:1',container:'person:traveller',inputs:[{item:'meal',quantity:1,nutrition:20,lots:[{quantity:1,producedAt:400,expiresAt:900,definition:'food/life@1',nutrition:20}]}],hungerBefore:80,hungerAfter:60,hungerRelief:20};}
function session(rows:JourneyMealReceipt[]|undefined=[meal()]){const events:RuntimeFoodEvent[]=[];const sink=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});sink.start('review',480);sink.committed({worldId:'review',fromMinute:480,toMinute:481,receipts:[],...(rows===undefined?{}:{journeyMeals:rows})},1);sink.stop('review',481);return events;}

test('journey review: reject accessors, symbols, sparse arrays and unexpected data at every boundary',()=>{
 let calls=0;
 for(const level of ['event','rows','meal','inputs','amount','lots','lot'])for(const edit of ['symbol','extra','getter']){
  const e:any=structuredClone(session()[1]);const target=({event:e,rows:e.journeyMeals,meal:e.journeyMeals[0],inputs:e.journeyMeals[0].inputs,amount:e.journeyMeals[0].inputs[0],lots:e.journeyMeals[0].inputs[0].lots,lot:e.journeyMeals[0].inputs[0].lots[0]} as any)[level];
  if(edit==='symbol')target[Symbol('private')]='PRIVATE_TEST';
  if(edit==='extra')target.privateData='PRIVATE_TEST';
  if(edit==='getter')Object.defineProperty(target,Object.keys(target)[0],{get(){calls++;return 'PRIVATE_TEST';}});
  assert.throws(()=>checkedFoodEvent(e),/invalid_evidence_schema/);
 }
 for(const field of ['journeyMeals','inputs','lots']){const e:any=structuredClone(session()[1]);const a=field==='journeyMeals'?e.journeyMeals:field==='inputs'?e.journeyMeals[0].inputs:e.journeyMeals[0].inputs[0].lots;delete a[0];assert.throws(()=>checkedFoodEvent(e));}
 assert.equal(calls,0);
});

test('journey review: forged actions, identity, timing, food and original nutrition fail closed',()=>{
 const mutations:Array<(r:any)=>void>=[r=>r.action='familyRelocation',r=>r.operation='eatMail',r=>r.beneficiaryId='other',r=>r.container='person:other',r=>r.inputs[0].item='water',r=>r.inputs[0].quantity=2,r=>r.inputs.push(structuredClone(r.inputs[0])),r=>r.hungerAfter=81,r=>r.hungerBefore=101,r=>r.hungerRelief=19,r=>r.inputs[0].lots[0].expiresAt=481,r=>r.inputs[0].lots[0].producedAt=482,r=>r.inputs[0].lots[0].quantity=.5,r=>r.inputs[0].nutrition=19,r=>r.inputs[0].lots=null,r=>r.inputs[0].lots[0].nutrition=null,r=>r.inputs[0].nutrition=Infinity];
 for(const edit of mutations){const r=meal();edit(r);assert.throws(()=>checkedJourneyMeal(r));}
 const unknown=meal();unknown.inputs[0].nutrition=null;unknown.inputs[0].lots=null;
 assert.equal(auditJourneyMeals(session([unknown]),true).totals!.nutrition,null);
 assert.equal(auditJourneyMeals(session([unknown]),true).totals!.hungerRelief,20);
});

test('journey review: unknown old coverage, missing boundaries, gaps and forged session identity never become zero',()=>{
 const old=structuredClone(session());delete (old[1] as any).journeyMeals;
 assert.equal(auditJourneyMeals(old,true).totals,null);
 assert.deepEqual(auditJourneyMeals(session([]),true).totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 for(const edit of [(e:any[])=>e.shift(),(e:any[])=>e.pop(),(e:any[])=>{e[1].sessionId='foreign';},(e:any[])=>{e[1].worldId='foreign';},(e:any[])=>{e[1].sequence=9;},(e:any[])=>{e[1].fromMinute=479;},(e:any[])=>{e[2].toMinute=482;},(e:any[])=>{e[1].journeyMeals[0].at=480;}]){const e=structuredClone(session());edit(e);assert.equal(auditJourneyMeals(e,true).totals,null);}
 assert.equal(auditJourneyMeals(session(),false).totals,null);
});

test('journey review: duplicate and cross-action event identities cannot double count',()=>{
 assert.equal(auditJourneyMeals(session([meal(),meal()]),true).totals,null);
 const e:any[]=structuredClone(session());e[1].receipts=[{at:481,residentId:'traveller',eventId:'completion',planId:'plan',container:'person:traveller',item:'meal',quantity:1,nutrition:20,hungerRelief:20}];
 assert.ok(auditJourneyMeals(e,true).issues.includes('duplicate_journey_receipt'));
 const two:any[]=structuredClone(session());two.splice(2,0,{...structuredClone(two[1]),fromMinute:481,toMinute:482,revision:2,sequence:3,journeyMeals:[{...meal(),at:482}]});two[3].sequence=4;two[3].toMinute=482;
 assert.ok(auditJourneyMeals(two,true).issues.includes('duplicate_journey_receipt'));
});

test('journey review: midnight belongs to the completed preceding day, absent rows invent no days',()=>{
 const e:any[]=structuredClone(session());e[0].fromMinute=1439;e[1].fromMinute=1439;e[1].toMinute=1441;e[2].toMinute=1441;e[1].journeyMeals=[{...meal(),at:1440,inputs:[{item:'meal',quantity:1,nutrition:null,lots:null}]},{...meal(),at:1441,eventId:'next',inputs:[{item:'meal',quantity:1,nutrition:null,lots:null}]}];
 assert.deepEqual(observedJourneyMealsByDay(e).map(d=>[d.calendarDay,d.receipts.length]),[[0,1],[1,1]]);
 assert.deepEqual(observedJourneyMealsByDay(session([])),[]);
});

test('journey review: family relocation really consumes two rations but remains explicitly excluded',()=>{
 const w=createWorld();w.mode='formal';w.clock.paused=false;const [parent,owner,child]=w.residents;
 w.map={width:24,height:18,name:'Independent relocation review',entrance:{x:2,y:15},tiles:Array(432).fill('grass')};
 const old={...w.buildings[0],at:{x:2,y:3},door:{x:5,y:8},capacity:4,residents:[parent.id,child.id]},home={...w.buildings[1],at:{x:14,y:3},door:{x:17,y:8},capacity:4,residents:[owner.id]};w.buildings=[old,home];w.resources=[];w.plots=[];w.graves=[];
 for(const p of w.residents)Object.assign(p,{at:{x:4,y:9},inside:null,roomAt:null,bornAt:w.minute-30*YEAR,homeId:p===owner?home.id:old.id,inventory:{meal:20,water:20},hunger:70,energy:100,health:100,canDecide:true,canExpress:true,knownBuildings:w.buildings.map(b=>b.id),knownPeople:w.residents.map(r=>r.id),plan:null,activity:null});
 Object.assign(child,{bornAt:w.minute-9*YEAR,parents:[parent.id],guardianIds:[parent.id],inventory:{}});stepWorld(w,1);
 const proposal=captureDirectEating(w,()=>{assert.equal(completeFamilyRelocation(w,parent,{type:'familyRelocation',operation:'propose',memberIds:[parent.id,child.id],buildingId:home.id,departAfter:w.minute+5,departBefore:w.minute+240}),null);});
 assert.deepEqual(proposal.journeyMeals,[]);const c=w.familyRelocation!.agreements.at(-1)!;
 for(const id of c.requiredSignerIds.filter(id=>id!==parent.id))assert.equal(completeFamilyRelocation(w,w.residents.find(p=>p.id===id)!,{type:'familyRelocation',operation:'accept',relocationId:c.id}),null);
 stepWorld(w,5);const mealBefore=parent.inventory.meal!,waterBefore=parent.inventory.water!,hungerBefore=child.hunger;
 const result=captureDirectEating(w,()=>{assert.equal(completeFamilyRelocation(w,parent,{type:'familyRelocation',operation:'depart',relocationId:c.id}),null);});
 assert.equal(c.status,'travelling');assert.equal(parent.inventory.meal,mealBefore-2);assert.equal(parent.inventory.water,waterBefore-2);assert.ok(child.hunger<hungerBefore);assert.deepEqual(result.journeyMeals,[]);assert.deepEqual(result.receipts,[]);
 const transferred=captureDirectEating(w,()=>{foodTransaction(w,()=>{parent.inventory.meal!--;owner.inventory.meal!++;});});assert.deepEqual(transferred.journeyMeals,[]);
});


test('journey review: failed journal fsync after meal append invalidates nested and outer totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'journey-review-fsync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let fail=false;
 const directory=join(root,'evidence'),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:'review',fromMinute:480,io:{fsyncSync:fd=>{if(fail)throw new Error('PRIVATE_TEST');fsyncSync(fd);}}});t.after(()=>writer.abort());
 const sink=new RuntimeFoodEvidence({observe:writer.observeDirectEating});sink.start('review',480);fail=true;
 sink.committed({worldId:'review',fromMinute:480,toMinute:481,receipts:[],journeyMeals:[meal()]},1);
 assert.equal(sink.status().phase,'failed');assert.equal(writer.status().failure,'sync_failed');
 const recovered=readAcceptanceEvidence(directory);assert.equal(recovered.complete,false);assert.equal(recovered.journeyMeals.totals,null);assert.equal(recovered.directEating.journeyMeals.totals,null);assert.equal(JSON.stringify(recovered).includes('PRIVATE_TEST'),false);
});

test('journey review: known original nutrition constrains physical relief without inferring unknown nutrition',()=>{
 for(const action of ['visitorJourney','visitorAid'] as const){
  const base=meal();if(action==='visitorAid')Object.assign(base,{action,operation:'eatMail'});
  const forged=structuredClone(base);forged.hungerAfter=79;forged.hungerRelief=1;
  assert.throws(()=>checkedJourneyMeal(forged),'known nutrition cannot coexist with a physically impossible but internally consistent hunger delta');
  for(const before of [0,1,19,20,21,100]){
   const saturated=structuredClone(base);saturated.hungerBefore=before;saturated.hungerAfter=Math.max(0,before-20);saturated.hungerRelief=before-saturated.hungerAfter;
   assert.deepEqual(checkedJourneyMeal(saturated),saturated);
   const result=auditJourneyMeals(session([saturated]),true);assert.equal(result.totals!.nutrition,20);assert.equal(result.totals!.hungerRelief,Math.min(before,20));
  }
  // An absent original definition may still have identifiable dates/quantities.
  // Neither that case nor entirely absent lots permits reconstructing nutrition.
  for(const keepLots of [true,false]){
   const unknown=structuredClone(forged);unknown.inputs[0].nutrition=null;
   if(keepLots)unknown.inputs[0].lots![0].nutrition=null;else unknown.inputs[0].lots=null;
   assert.deepEqual(checkedJourneyMeal(unknown),unknown);
   const result=auditJourneyMeals(session([unknown]),true);assert.equal(result.totals!.nutrition,null);assert.equal(result.totals!.hungerRelief,1);
  }
 }
});

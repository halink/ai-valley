import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {hasTimelyVisitorJourneyRescue} from '../src/world/visitor-journey.js';
import {hasTimelyVisitorAidRescue} from '../src/world/visitor-aid.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {applyOutsideDecision} from '../src/world/migration.js';
import {WorldStore} from '../src/server/store.js';
import {journeyMealFixture,chooseJourneyMeal,originalJourneyLots,journeyPerson} from './helpers/journey-meal-evidence.js';

for(const mail of [false,true]){
 const source=mail?'mail':'ordinary';
 test(`journey meals ${source}: actual final menu, spent pause and original multi-lot nutrition`,()=>{
  const {w,r,j}=journeyMealFixture(mail);originalJourneyLots(w,r);const decision=chooseJourneyMeal(w,r,mail),revision=r.revision;
  const choiceEvent=j.eventIds.at(-1);assert.deepEqual(stepWorldWithFoodEvidence(w,4).journeyMeals,[]);assert.equal(r.inventory.meal,3);
  const hunger=r.hunger,observation=stepWorldWithFoodEvidence(w,1),rows=observation.journeyMeals!;assert.equal(rows.length,1);const receipt=rows[0];
  assert.equal(receipt.action,mail?'visitorAid':'visitorJourney');assert.equal(receipt.operation,mail?'eatMail':'eat');
  assert.equal(receipt.providerId,r.id);assert.equal(receipt.beneficiaryId,r.id);assert.equal(receipt.journeyId,j.id);assert.equal(receipt.container,'person:'+r.id);
  assert.equal('planId' in receipt,false);assert.equal('definition' in receipt,false);assert.equal(receipt.at,w.minute);
  assert.notEqual(receipt.eventId,choiceEvent);assert.ok(j.eventIds.includes(receipt.eventId));assert.equal(w.events.find(e=>e.id===receipt.eventId)!.at,receipt.at);
  assert.equal(receipt.inputs.length,1);assert.equal(receipt.inputs[0].quantity,1);assert.equal(receipt.inputs[0].nutrition,25);
  assert.deepEqual(receipt.inputs[0].lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.25,'food/life@90',2.5],[.75,'food/life@91',22.5]]);
  assert.equal(receipt.hungerBefore,hunger);assert.equal(receipt.hungerBefore-receipt.hungerAfter,receipt.hungerRelief);assert.ok(r.hunger>receipt.hungerAfter,'same-step metabolism is not meal relief');assert.equal(r.inventory.meal,2);
  assert.deepEqual(observation.receipts,[]);assert.deepEqual(observation.careMeals,[]);assert.deepEqual(stepWorldWithFoodEvidence(w,5).journeyMeals,[]);
  assert.equal(applyOutsideDecision(w,r.id,revision,decision).ok,false);assert.equal(r.inventory.meal,2);
 });
 for(const change of ['expired','lost','incapable','dead','aborted'] as const)test(`journey meals ${source}: ${change} pause cannot publish consumption`,()=>{
  const {w,r,j}=journeyMealFixture(mail);chooseJourneyMeal(w,r,mail);stepWorld(w,4);const stock=r.inventory.meal!;
  if(change==='expired')for(const lot of w.food!.lots['person:'+r.id].meal!)lot.expiresAt=w.minute+1;
  if(change==='lost')r.inventory.meal=0;
  if(change==='incapable')r.canDecide=false;
  if(change==='dead')r.status='dead';
  if(change==='aborted')delete j.pause;
  assert.deepEqual(stepWorldWithFoodEvidence(w,1).journeyMeals,[]);
  if(change==='incapable'||change==='aborted')assert.equal(r.inventory.meal,stock);
 });
 test(`journey meals ${source}: default disabled and forecast collection preserve full world equality`,()=>{
  const f=journeyMealFixture(mail);chooseJourneyMeal(f.w,f.r,mail);const plain=structuredClone(f.w),observed=structuredClone(f.w);
  stepWorld(plain,5);assert.equal(stepWorldWithFoodEvidence(observed,5).journeyMeals!.length,1);assert.deepEqual(observed,plain);
  const before=structuredClone(f.w),result=captureDirectEating(f.w,()=>{stepWorld(copyForSimulation(f.w),5);});assert.deepEqual(result.journeyMeals,[]);assert.deepEqual(f.w,before);
 });
 test(`journey meals ${source}: midpause SQLite reload and paused clock do not duplicate receipt`,()=>{
  const f=journeyMealFixture(mail);chooseJourneyMeal(f.w,f.r,mail);stepWorld(f.w,2);const store=new WorldStore(':memory:');
  try{store.commit(f.w,null);const w=store.load(true)!,r=journeyPerson(w,f.r.id),stock=r.inventory.meal!;
   w.clock.paused=true;const before=structuredClone(w);assert.deepEqual(stepWorldWithFoodEvidence(w,30).journeyMeals,[]);assert.deepEqual(w,before);
   w.clock.paused=false;assert.equal(stepWorldWithFoodEvidence(w,3).journeyMeals!.length,1);assert.equal(r.inventory.meal,stock-1);assert.deepEqual(stepWorldWithFoodEvidence(w,5).journeyMeals,[]);
  }finally{store.close();}
 });
 test(`journey meals ${source}: unknown nutrition stays unknown despite physical hunger relief`,()=>{
  const {w,r}=journeyMealFixture(mail);for(const lot of w.food!.lots['person:'+r.id].meal!)lot.definition='missing/food@1';chooseJourneyMeal(w,r,mail);
  const receipt=stepWorldWithFoodEvidence(w,5).journeyMeals![0];assert.equal(receipt.inputs[0].nutrition,null);assert.ok(receipt.inputs[0].lots!.every(l=>l.nutrition===null));assert.ok(receipt.hungerRelief>0);
 });
}
test('journey meals: returning identity stays a single resident record',()=>{
 const {w,r}=journeyMealFixture(false,true);chooseJourneyMeal(w,r,false);const rows=stepWorldWithFoodEvidence(w,5).journeyMeals!;
 assert.equal(rows.length,1);assert.equal(rows[0].providerId,r.id);assert.equal(w.residents.filter(p=>p.id===r.id).length,1);
});
test('journey meals: mail legacy missing lots retain unknown original evidence after physical repair',()=>{
 const {w,r}=journeyMealFixture(true);chooseJourneyMeal(w,r,true);delete w.food!.lots['person:'+r.id].meal;
 const rows=stepWorldWithFoodEvidence(w,5).journeyMeals!;assert.equal(rows.length,1);assert.equal(rows[0].inputs[0].nutrition,null);assert.equal(rows[0].inputs[0].lots,null);
});
for(const mail of [false,true])for(const mismatch of ['overfull','deficit'] as const)test(`journey meals ${mail?'mail':'ordinary'}: ${mismatch} original ledger repair cannot invent batch evidence`,()=>{
 const {w,r}=journeyMealFixture(mail);originalJourneyLots(w,r);chooseJourneyMeal(w,r,mail);
 const container='person:'+r.id;
 if(mismatch==='overfull'){
  r.inventory.meal=1;w.food!.lots[container].meal![0].quantity=1;w.food!.lots[container].meal![1].quantity=1;
 }else{r.inventory.meal=3;w.food!.lots[container].meal![0].quantity=.1;w.food!.lots[container].meal!.splice(1);}
 const stock=r.inventory.meal!,plain=structuredClone(w);stepWorld(plain,5);
 const rows=stepWorldWithFoodEvidence(w,5).journeyMeals!;
 assert.equal(rows.length,1);assert.equal(r.inventory.meal,stock-1);assert.deepEqual(w,plain);
 assert.equal(rows[0].inputs[0].lots,null);assert.equal(rows[0].inputs[0].nutrition,null);
});
for(const mail of [false,true])test(`journey meals ${mail?'mail':'ordinary'}: near-sated consumption retains original nutrition and exact lot dates`,()=>{
 const {w,r}=journeyMealFixture(mail);originalJourneyLots(w,r);r.hunger=0;const original=structuredClone(w.food!.lots['person:'+r.id].meal!);chooseJourneyMeal(w,r,mail);
 const rows=stepWorldWithFoodEvidence(w,5).journeyMeals!,receipt=rows[0];assert.equal(rows.length,1);
 assert.equal(receipt.hungerAfter,0);assert.equal(receipt.hungerRelief,receipt.hungerBefore);assert.ok(receipt.hungerRelief<25);assert.equal(receipt.inputs[0].nutrition,25);
 assert.deepEqual(receipt.inputs[0].lots!.map(l=>[l.producedAt,l.expiresAt]),original.map(l=>[l.producedAt,l.expiresAt]));
});
for(const mail of [false,true])test(`journey meals ${mail?'mail':'ordinary'}: production rescue forecast consumes hypothetical food without observing or mutating originals`,()=>{
 const {w,r,j}=journeyMealFixture(mail);
 if(mail){assert.equal(applyOutsideDecision(w,r.id,r.revision,{intention:'Offline explicit rest before self-rescue forecast',actions:[{type:'outsideAid',operation:'restMail',journeyId:j.id}]}).ok,true);stepWorld(w,30);}
 Object.assign(r,{hunger:98,energy:80,health:1});const before=structuredClone(w);
 const forecast=mail?hasTimelyVisitorAidRescue:hasTimelyVisitorJourneyRescue;
 const observation=captureDirectEating(w,()=>{assert.equal(forecast(w,r),true,'successful hunger rescue requires hypothetical meal completion');});
 assert.deepEqual(observation.journeyMeals,[]);assert.deepEqual(observation.receipts,[]);assert.deepEqual(w,before);
 const noFood=structuredClone(w),hungry=journeyPerson(noFood,r.id);hungry.inventory={};assert.equal(forecast(noFood,hungry),false,'rest alone cannot rescue this hunger');
});
for(const mail of [false,true])test(`journey meals ${mail?'mail':'ordinary'}: thrown observation releases capture hooks without leaking completed receipts`,()=>{
 const {w,r}=journeyMealFixture(mail);chooseJourneyMeal(w,r,mail);const independent=structuredClone(w);
 assert.throws(()=>captureDirectEating(w,()=>{stepWorld(w,5);throw new Error('Synthetic after-completion failure');}),/after-completion failure/);
 assert.deepEqual(captureDirectEating(w,()=>{}).journeyMeals,[],'same world capture is released after throw');
 assert.equal(stepWorldWithFoodEvidence(independent,5).journeyMeals!.length,1,'independent retry captures only its own completion');
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).journeyMeals,[],'already completed physical action does not replay');
});

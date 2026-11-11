import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {captureDirectEating,foodFlowInputs} from '../src/world/food-consumption-evidence.js';
import {executeSocialAction} from '../src/world/social.js';
import {WorldStore} from '../src/server/store.js';
import {decisionContext} from '../src/server/decisions.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {DAY,YEAR} from '../src/world/time.js';
import {careFixture,acceptedCare,originalCareLots,queueOrdinaryCare,careChoice,carePlan,finishCareAction} from './helpers/care-meal-evidence.js';

test('care meals: real final-menu proposal, acceptance and care record provider, beneficiary, actual debit and original lots',()=>{
 const f=careFixture(),proposal=acceptedCare(f);originalCareLots(f);
 const before=structuredClone(f.provider.inventory),original=structuredClone(f.w.food!.lots['person:'+f.provider.id].meal!);
 const plan=queueOrdinaryCare(f),receipts=finishCareAction(f.w,f.provider);assert.equal(receipts.length,1);const r=receipts[0];
 assert.equal(r.action,'care');assert.equal(r.planId,plan.id);assert.equal(r.providerId,f.provider.id);assert.equal(r.beneficiaryId,f.beneficiary.id);
 assert.equal(r.proposalId,proposal.id);assert.equal(r.authority,'consent');assert.equal(r.container,'person:'+f.provider.id);
 assert.equal(r.definition,'action/routine@1');assert.equal(f.provider.inventory.meal,before.meal!-1);assert.equal(f.provider.inventory.water,before.water!-1);
 assert.equal(r.hungerBefore-r.hungerAfter,r.hungerRelief);assert.equal(r.hungerRelief,22);assert.ok(Math.abs(r.hungerAfter-f.beneficiary.hunger)<.02,'receipt records the action itself, before later same-tick metabolism');
 assert.deepEqual(r.inputs,[{item:'meal',quantity:1,nutrition:25,lots:[{...original[0],nutrition:2.5},{...original[1],quantity:.75,nutrition:22.5}]},
  {item:'water',quantity:1,nutrition:0,lots:[]}]);
 assert.equal(proposal.status,'expired');assert.equal(f.w.events.find(e=>e.id===r.eventId)!.at,r.at);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).receipts,[]);assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).careMeals,[]);
 assert.equal(executeSocialAction(f.w,f.provider,plan.actions[0]).ok,false);
});

test('care meals: capped actual hunger relief is independent of known or missing original nutrition',()=>{
 for(const known of [true,false]){
  const f=careFixture();acceptedCare(f);originalCareLots(f);f.beneficiary.hunger=1;f.beneficiary.health=80;
  if(!known)for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.definition='missing/food@1';
  queueOrdinaryCare(f);const r=finishCareAction(f.w,f.provider)[0];
  assert.equal(r.hungerAfter,0);assert.equal(r.hungerRelief,r.hungerBefore);assert.ok(r.hungerRelief<22);
  assert.equal(r.inputs[0].nutrition,known?25:null);assert.notEqual(r.inputs[0].nutrition,r.hungerRelief);
  if(!known)assert.ok(r.inputs[0].lots!.every(l=>l.definition==='missing/food@1'&&l.nutrition===null));
 }
});

test('care meals: withdrawal, original consent expiry, spoiled meal and exhausted water publish no success',()=>{
 for(const failure of ['withdrawal','consent_expiry','spoilage','water'] as const)for(const reverse of [false,true]){
  const f=careFixture(),p=acceptedCare(f);queueOrdinaryCare(f);stepWorld(f.w,29.75);
  if(reverse)f.w.residents.reverse();const before={...f.provider.inventory};
  if(failure==='withdrawal')assert.equal(submitPlan(f.w,carePlan(f.w,f.beneficiary,[careChoice(f.w,f.beneficiary,a=>a.type==='respond'&&a.proposalId===p.id&&!a.accept)])).ok,true);
  if(failure==='consent_expiry')p.expiresAt=f.w.minute+.25;
  if(failure==='spoilage')for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.expiresAt=f.w.minute+.25;
  if(failure==='water')f.provider.inventory.water=0;
  const observation=stepWorldWithFoodEvidence(f.w,.25);assert.deepEqual(observation.careMeals,[]);assert.deepEqual(observation.receipts,[]);
  assert.ok(f.provider.lastFailure);assert.equal(f.provider.inventory.meal,failure==='spoilage'?0:before.meal);
  assert.equal(f.provider.inventory.water,failure==='water'?0:before.water);
 }
});

test('care meals: competing providers recheck current need, so only the completed winner is attributed',()=>{
 for(const reverse of [false,true]){
  const f=careFixture();f.other.at={...f.provider.at};acceptedCare(f);acceptedCare(f,f.other);
  f.beneficiary.hunger=30;f.beneficiary.health=90;queueOrdinaryCare(f);queueOrdinaryCare(f,f.other);
  if(reverse)f.w.residents.reverse();const before=[f.provider.inventory.meal!,f.other.inventory.meal!];
  const observation=stepWorldWithFoodEvidence(f.w,30);assert.equal(observation.careMeals!.length,1);
  const r=observation.careMeals![0],winner=reverse?f.other:f.provider,loser=reverse?f.provider:f.other;
  assert.equal(r.providerId,winner.id);assert.equal(r.beneficiaryId,f.beneficiary.id);assert.ok(loser.lastFailure);
  assert.equal(before[0]+before[1]-f.provider.inventory.meal!-f.other.inventory.meal!,1);
 }
});

test('care meals: in-memory reload continues the original action and lots once, without backfilling completed care',()=>{
 const f=careFixture(),proposal=acceptedCare(f);originalCareLots(f);const plan=queueOrdinaryCare(f);stepWorld(f.w,29.75);
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.load(true)!,provider=w.residents.find(r=>r.id===f.provider.id)!;
  const receipts=finishCareAction(w,provider);assert.equal(receipts.length,1);assert.equal(receipts[0].inputs[0].nutrition,25);
  assert.equal(receipts[0].planId,plan.id);assert.equal(receipts[0].proposalId,proposal.id);
  store.commit(w,f.w.revision);const loaded=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(loaded,1).careMeals,[]);
  assert.equal(JSON.stringify(loaded).includes('careMeals'),false);
 }finally{store.close();}
});

test('care meals: optional observation, forecasts and failed captures cannot alter world, decisions or serialize hooks',()=>{
 const f=careFixture();acceptedCare(f);originalCareLots(f);queueOrdinaryCare(f);const plain=structuredClone(f.w);
 const observation=stepWorldWithFoodEvidence(f.w,30);stepWorld(plain,30);assert.equal(observation.careMeals!.length,1);assert.deepEqual(f.w,plain);
 assert.deepEqual(decisionContext(f.w,f.provider),decisionContext(plain,plain.residents.find(r=>r.id===f.provider.id)!));
 const before=structuredClone(f.w);const forecast=captureDirectEating(f.w,()=>{hasTimelySelfRescue(f.w,f.provider,[{type:'eat',item:'meal'}]);});
 assert.deepEqual(forecast.careMeals,[]);assert.deepEqual(f.w,before);
 const next=careFixture();acceptedCare(next);queueOrdinaryCare(next);
 assert.throws(()=>captureDirectEating(next.w,()=>{stepWorld(next.w,30);throw new Error('Offline capture failed');}));
 assert.deepEqual(stepWorldWithFoodEvidence(next.w,1).careMeals,[]);
 delete next.w.food;const absent=structuredClone(next.w);captureDirectEating(next.w,()=>foodFlowInputs(next.w,'person:'+next.provider.id,{meal:1},1));assert.deepEqual(next.w,absent);
});

test('care meals: daily coverage distinguishes missing observations from observed zero and resets at midnight',()=>{
 const f=careFixture();acceptedCare(f);f.w.minute=DAY-30;queueOrdinaryCare(f);const accumulator=createIsolationEvidence(f.w);
 let last;for(let i=0;i<30;i++)last=accumulator.sample(f.w,stepWorldWithFoodEvidence(f.w,1));
 assert.equal(last!.careMeals.observedMinutes,30);assert.equal(last!.careMeals.receipts.length,1);assert.equal(last!.careMeals.receipts[0].at,DAY);
 assert.equal(last!.careMeals.totals!.units.meal,1);assert.equal(last!.foodConsumption.value,null);
 accumulator.sample(f.w,stepWorldWithFoodEvidence(f.w,1));assert.equal(accumulator.finish(f.w)!.careMeals.totals!.completedActions,0);
 const legacy=stepWorldWithFoodEvidence(f.w,1);delete legacy.careMeals;accumulator.sample(f.w,legacy);
 accumulator.sample(f.w,stepWorldWithFoodEvidence(f.w,1));assert.equal(accumulator.finish(f.w)!.careMeals.totals,null);
 assert.equal(accumulator.finish(f.w)!.careMeals.unobservedMinutes,1);assert.notEqual(accumulator.finish(f.w)!.directEating.totals,null);
 stepWorld(f.w,1);accumulator.sample(f.w);assert.equal(accumulator.finish(f.w)!.careMeals.unobservedMinutes,2);
});

test('care meals: guardian and emergency authority stay ordinary care, with explicit beneficiary and no fabricated consent',()=>{
 for(const basis of ['guardian','emergency'] as const){
  const f=careFixture();
  if(basis==='guardian'){f.beneficiary.bornAt=f.w.minute-4*YEAR;f.beneficiary.guardianIds=[f.provider.id];}
  else{f.beneficiary.health=18;f.beneficiary.canDecide=f.beneficiary.canExpress=false;}
  queueOrdinaryCare(f);const receipts=finishCareAction(f.w,f.provider);assert.equal(receipts.length,1);
  assert.equal(receipts[0].authority,basis);assert.equal(receipts[0].proposalId,null);assert.equal(receipts[0].beneficiaryId,f.beneficiary.id);
  assert.equal(receipts[0].inputs[0].quantity,1);
 }
});

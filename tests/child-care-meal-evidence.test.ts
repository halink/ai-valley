import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating,foodFlowInputs} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {childCareFixture,queueChildCare,finishChildCare,originalChildLots} from './helpers/child-care-meal-evidence.js';

for(const food of ['meal','turnip'] as const)test(`child care meals: actual final numbered menu completes ${food} with original split lots and distinct water`,()=>{
 const f=childCareFixture(food);originalChildLots(f,food);const before={...f.provider.inventory};
 const original=structuredClone(f.w.food!.lots['person:'+f.provider.id][food]!);const plan=queueChildCare(f);
 const rows=finishChildCare(f.w,f.provider);assert.equal(rows.length,1);const r=rows[0];
 assert.equal(r.action,'tendChild');assert.equal(r.planId,plan.id);assert.equal(r.providerId,f.provider.id);assert.equal(r.beneficiaryId,f.beneficiary.id);
 assert.equal(r.container,'person:'+f.provider.id);assert.equal(r.authority,'guardian');assert.equal(Object.hasOwn(r,'proposalId'),false);
 assert.equal(f.provider.inventory[food],before[food]!-1);assert.equal(f.provider.inventory.water,before.water!-1);
 assert.equal(r.hungerBefore-r.hungerAfter,48);assert.equal(r.hungerRelief,48);assert.equal(r.hungerAfter,Math.max(0,r.hungerBefore-48));
 assert.deepEqual(r.inputs,[{item:food,quantity:1,nutrition:25,lots:[{...original[0],nutrition:2.5},{...original[1],quantity:.75,nutrition:22.5}]},{item:'water',quantity:1,nutrition:0,lots:[]}]);
 const event=f.w.events.find(e=>e.id===r.eventId)!;assert.equal(event.at,r.at);assert.deepEqual(event.audit!.resources,{[food]:1,water:1});
 const next=stepWorldWithFoodEvidence(f.w,1);assert.deepEqual(next.childCareMeals,[]);assert.deepEqual(next.careMeals,[]);assert.deepEqual(next.receipts,[]);
});

test('child care meals: meal preference is resolved at completion, with real turnip fallback rather than the queued menu label',()=>{
 const f=childCareFixture();f.provider.inventory.turnip=3;queueChildCare(f);stepWorld(f.w,19.75);
 f.provider.inventory.meal=0;const rows=finishChildCare(f.w,f.provider);assert.equal(rows.length,1);assert.equal(rows[0].inputs[0].item,'turnip');assert.equal(f.provider.inventory.turnip,2);
});

test('child care meals: capped relief is not nutrition and missing original definitions stay unknown',()=>{
 for(const known of [true,false]){
  const f=childCareFixture();originalChildLots(f);f.beneficiary.hunger=12;
  if(!known)for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.definition='missing/food@1';
  queueChildCare(f);const r=finishChildCare(f.w,f.provider)[0];assert.equal(r.hungerAfter,0);assert.equal(r.hungerRelief,r.hungerBefore);assert.ok(r.hungerRelief<48);
  assert.equal(r.inputs[0].nutrition,known?25:null);assert.notEqual(r.inputs[0].nutrition,r.hungerRelief);
  if(!known)assert.ok(r.inputs[0].lots!.every(l=>l.nutrition===null));
 }
});

test('child care meals: evidence-only batch reads do not initialize or invent missing batch quantity',()=>{
 const f=childCareFixture();f.w.food!.lots['person:'+f.provider.id].meal![0].quantity=.25;const before=structuredClone(f.w);
 let inputs;captureDirectEating(f.w,()=>{inputs=foodFlowInputs(f.w,'person:'+f.provider.id,{meal:1,water:1},1);});
 assert.deepEqual(inputs,[{item:'meal',quantity:1,nutrition:null,lots:null},{item:'water',quantity:1,nutrition:0,lots:[]}]);assert.deepEqual(f.w,before);
});

for(const change of ['guardian','refusal','age','position','incapacity','sated','spoilage','water'] as const)test(`child care meals: ${change} immediately before completion never publishes a successful debit`,()=>{
 for(const reverse of [false,true]){
  const f=childCareFixture();queueChildCare(f);stepWorld(f.w,19.75);assert.ok(f.provider.activity);
  if(reverse)f.w.residents.reverse();const stock={...f.provider.inventory};
  if(change==='guardian')f.beneficiary.guardianIds=[];
  if(change==='refusal')f.beneficiary.refusesCare=true;
  if(change==='age')f.beneficiary.bornAt=f.w.minute-6*YEAR;
  if(change==='position')f.beneficiary.at={x:20,y:16};
  if(change==='incapacity')f.provider.canDecide=false;
  if(change==='sated')f.beneficiary.hunger=0;
  if(change==='spoilage')for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.expiresAt=f.w.minute+.25;
  if(change==='water')f.provider.inventory.water=0;
  const result=stepWorldWithFoodEvidence(f.w,.25);assert.deepEqual(result.childCareMeals,[]);assert.deepEqual(result.careMeals,[]);
  assert.equal(f.provider.inventory.meal,change==='spoilage'?0:stock.meal);assert.equal(f.provider.inventory.water,change==='water'?0:stock.water);
 }
});

test('child care meals: safe bucket water is not personal inventory water and cannot satisfy feeding',()=>{
 const f=childCareFixture();queueChildCare(f);stepWorld(f.w,19.75);f.provider.inventory.water=0;
 const vessel={id:'offline-bucket',ownerId:f.provider.id,buildingId:null,capacity:6 as const,amount:6,quality:'safe' as const,createdAt:f.w.minute};
 f.w.waterSupply!.vessels.push(vessel);const meal=f.provider.inventory.meal;
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).childCareMeals,[]);assert.equal(vessel.amount,6);assert.equal(f.provider.inventory.meal,meal);
 assert.equal(decisionChoices(decisionContext(f.w,f.provider)).some(c=>c.action.type==='tendChild'),false);
});

test('child care meals: a health emergency does not invent emergency authority or change the existing guardian recipe',()=>{
 const f=childCareFixture();queueChildCare(f);stepWorld(f.w,19.75);f.beneficiary.health=18;
 const r=finishChildCare(f.w,f.provider)[0];assert.equal(r.authority,'guardian');assert.equal(r.action,'tendChild');assert.equal(r.hungerRelief,48);assert.equal(r.inputs[0].quantity,1);
});

test('child care meals: two guardians compete on current need, only the actual winner has a receipt',()=>{
 for(const reverse of [false,true]){
  const f=childCareFixture();f.other.at={...f.provider.at};f.beneficiary.guardianIds.push(f.other.id);f.beneficiary.hunger=30;
  queueChildCare(f);queueChildCare(f,f.other);if(reverse)f.w.residents.reverse();
  const result=stepWorldWithFoodEvidence(f.w,20);assert.equal(result.childCareMeals!.length,1);assert.equal(result.childCareMeals![0].providerId,(reverse?f.other:f.provider).id);
  assert.equal(f.provider.inventory.meal!+f.other.inventory.meal!,19);
 }
});

test('child care meals: SQLite in-memory reload resumes the same original lots and plan once, without backfill',()=>{
 const f=childCareFixture();originalChildLots(f);const plan=queueChildCare(f);stepWorld(f.w,19.75);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const loaded=store.load(true)!,provider=loaded.residents.find(r=>r.id===f.provider.id)!;
  const rows=finishChildCare(loaded,provider);assert.equal(rows.length,1);assert.equal(rows[0].planId,plan.id);assert.equal(rows[0].inputs[0].nutrition,25);
  store.commit(loaded,f.w.revision);const again=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(again,1).childCareMeals,[]);assert.equal(JSON.stringify(again).includes('childCareMeals'),false);
 }finally{store.close();}
});

test('child care meals: observation is world-equivalent, does not enter decision context, and cannot capture a speculative copy',()=>{
 const f=childCareFixture();originalChildLots(f);queueChildCare(f);const plain=structuredClone(f.w),before=structuredClone(f.w);
 const predicted=captureDirectEating(f.w,()=>stepWorld(copyForSimulation(f.w),20));assert.deepEqual(predicted.childCareMeals,[]);assert.deepEqual(f.w,before);
 const actual=stepWorldWithFoodEvidence(f.w,20);stepWorld(plain,20);assert.equal(actual.childCareMeals!.length,1);assert.deepEqual(f.w,plain);
 assert.deepEqual(decisionContext(f.w,f.provider),decisionContext(plain,plain.residents.find(r=>r.id===f.provider.id)!));assert.equal(JSON.stringify(f.w).includes('childCareMeals'),false);
});

test('child care meals: thrown capture discards success evidence and unbinds hooks without claiming rollback',()=>{
 const f=childCareFixture();queueChildCare(f);
 assert.throws(()=>captureDirectEating(f.w,()=>{stepWorld(f.w,20);throw new Error('Synthetic capture failure');}),/Synthetic capture failure/);
 assert.equal(f.provider.inventory.meal,9);assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).childCareMeals,[]);
});


test('child care meals: daily observed zero, missing legacy coverage and midnight attribution remain separate',()=>{
 const f=childCareFixture();f.w.minute=DAY-20;queueChildCare(f);const observer=createIsolationEvidence(f.w);
 let row;for(let i=0;i<20;i++)row=observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));
 assert.equal(row!.childCareMeals.observedMinutes,20);assert.equal(row!.childCareMeals.unobservedMinutes,0);
 assert.equal(row!.childCareMeals.receipts.length,1);assert.equal(row!.childCareMeals.receipts[0].at,DAY);
 assert.equal(row!.childCareMeals.totals!.units.meal,1);assert.equal(row!.childCareMeals.totals!.units.water,1);
 assert.equal(row!.careMeals.totals!.completedActions,0);assert.equal(row!.foodConsumption.value,null);
 observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));assert.equal(observer.finish(f.w)!.childCareMeals.totals!.completedActions,0);
 const legacy=stepWorldWithFoodEvidence(f.w,1);delete legacy.childCareMeals;observer.sample(f.w,legacy);
 observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));const after=observer.finish(f.w)!;
 assert.equal(after.childCareMeals.totals,null);assert.equal(after.childCareMeals.unobservedMinutes,1);assert.equal(after.childCareMeals.observedMinutes,2);
 assert.equal(after.careMeals.totals!.completedActions,0);assert.equal(after.directEating.totals!.completedActions,0);
 stepWorld(f.w,1);observer.sample(f.w);assert.equal(observer.finish(f.w)!.childCareMeals.unobservedMinutes,2);
});

test('child care meals: persisted pending work still rechecks revoked guardianship and refusal after reload',()=>{
 for(const reason of ['guardian','refusal'] as const){
  const f=childCareFixture();queueChildCare(f);stepWorld(f.w,19.75);
  if(reason==='guardian')f.beneficiary.guardianIds=[];else f.beneficiary.refusesCare=true;
  const store=new WorldStore(':memory:');try{store.commit(f.w,null);const loaded=store.load(true)!;
   const provider=loaded.residents.find(r=>r.id===f.provider.id)!,before={...provider.inventory};
   assert.deepEqual(finishChildCare(loaded,provider),[]);assert.deepEqual(provider.inventory,before);
  }finally{store.close();}
 }
});

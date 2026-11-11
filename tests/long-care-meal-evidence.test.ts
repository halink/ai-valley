import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {captureDirectEating,foodFlowInputs} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {careWindows} from '../src/world/long-care.js';
import {DAY} from '../src/world/time.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {longCareFixture,queueLongCare,finishLongCare,longCareChoice} from './helpers/long-care-meal-evidence.js';
import {careChoice,queueCareAction,originalCareLots} from './helpers/care-meal-evidence.js';

for(const age of [3,8,30])test(`long care meals: actual numbered signing and ${age}-year-old beneficiary visit debit original lots with separate effects`,()=>{
 const f=longCareFixture(age),before={...f.provider.inventory},coins=totalCoins(f.w),plan=queueLongCare(f);
 const rows=finishLongCare(f.w,f.provider);assert.equal(rows.length,1);const r=rows[0];
 assert.equal(r.action,'longCare');assert.equal(r.operation,'visit');assert.equal(r.providerId,f.provider.id);assert.equal(r.beneficiaryId,f.beneficiary.id);
 assert.equal(r.planId,plan.id);assert.equal(r.agreementId,f.c.id);assert.equal(r.slotKey,'1:0');assert.equal(r.definition,f.c.definition);
 assert.equal(r.container,'person:'+f.provider.id);assert.equal(r.inputs[0].nutrition,25);assert.equal(r.inputs[0].quantity,1);
 assert.deepEqual(r.inputs[0].lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.25,'food/life@90',2.5],[.75,'food/life@91',22.5]]);
 assert.deepEqual(r.inputs[1],{item:'water',quantity:1,nutrition:0,lots:[]});
 assert.equal(f.provider.inventory.meal,before.meal!-1);assert.equal(f.provider.inventory.water,before.water!-1);
 assert.equal(r.hungerBefore-r.hungerAfter,r.hungerRelief);assert.equal(r.hungerRelief,25);assert.equal(r.healthAfter-r.healthBefore,3);assert.equal(r.healthGain,3);
 assert.equal(f.c.paid,3);assert.equal(f.c.visits.length,1);assert.equal(f.c.visits[0].key,r.slotKey);assert.equal(accountBalance(f.w,f.c.account),9);assert.equal(totalCoins(f.w),coins);
 const event=f.w.events.find(e=>e.id===r.eventId)!;assert.deepEqual(event.actors,[f.provider.id,f.beneficiary.id]);assert.equal(event.at,r.at);
 const next=stepWorldWithFoodEvidence(f.w,1);assert.deepEqual(next.longCareMeals,[]);assert.deepEqual(next.childCareMeals,[]);assert.deepEqual(next.careMeals,[]);assert.deepEqual(next.receipts,[]);
});

test('long care meals: signed historical recipe survives active definition change, including quantities and health gain',()=>{
 const f=longCareFixture(30,{meal:2,turnip:1,water:2});f.w.activeDefinitions['care/long']='care/long@1';
 const before={...f.provider.inventory};queueLongCare(f);const r=finishLongCare(f.w,f.provider)[0];
 assert.equal(r.definition,'care/long@90');assert.deepEqual(r.inputs.map(a=>[a.item,a.quantity]),[['meal',2],['turnip',1],['water',2]]);
 assert.equal(r.inputs[0].nutrition,55);assert.equal(r.inputs[1].nutrition,20);assert.equal(r.hungerRelief,75);assert.equal(r.healthGain,7);
 assert.equal(f.provider.inventory.meal,before.meal!-2);assert.equal(f.provider.inventory.turnip,before.turnip!-1);assert.equal(f.provider.inventory.water,before.water!-2);
 assert.deepEqual(f.c.rules!.materials,{meal:2,turnip:1,water:2});
});

test('long care meals: saturation and unknown definitions do not back-calculate nutrition from hunger or health',()=>{
 for(const known of [true,false]){
  const f=longCareFixture();f.beneficiary.hunger=4;f.beneficiary.health=99;
  if(!known)for(const l of f.w.food!.lots['person:'+f.provider.id].meal!)l.definition='missing/food@1';
  queueLongCare(f);const r=finishLongCare(f.w,f.provider)[0];assert.equal(r.hungerAfter,0);assert.equal(r.hungerRelief,r.hungerBefore);assert.ok(r.hungerRelief<25);
  assert.equal(r.healthAfter,100);assert.equal(r.healthGain,1);assert.equal(r.inputs[0].nutrition,known?25:null);
  if(!known)assert.ok(r.inputs[0].lots!.every(l=>l.nutrition===null));
 }
});

test('long care meals: read-only evidence cannot initialize missing original lot quantities',()=>{
 const f=longCareFixture();f.w.food!.lots['person:'+f.provider.id].meal![0].quantity=.1;f.w.food!.lots['person:'+f.provider.id].meal!.splice(1);
 const before=structuredClone(f.w);let inputs;
 captureDirectEating(f.w,()=>{inputs=foodFlowInputs(f.w,'person:'+f.provider.id,{meal:1,water:1},1);});
 assert.deepEqual(inputs,[{item:'meal',quantity:1,nutrition:null,lots:null},{item:'water',quantity:1,nutrition:0,lots:[]}]);assert.deepEqual(f.w,before);
});

for(const change of ['refusal','position','incapacity','spoilage','water','meal','guardian'] as const)test(`long care meals: final quarter-minute ${change} prevents receipt and service payment`,()=>{
 for(const reverse of [false,true]){
  const f=longCareFixture(change==='guardian'?3:30);queueLongCare(f);stepWorld(f.w,19.75);assert.ok(f.provider.activity);if(reverse)f.w.residents.reverse();
  if(change==='refusal')f.beneficiary.refusesCare=true;
  if(change==='position')f.beneficiary.at={x:23,y:17};
  if(change==='incapacity')f.provider.canExpress=false;
  if(change==='water')f.provider.inventory.water=0;
  if(change==='meal')f.provider.inventory.meal=0;
  if(change==='guardian')f.beneficiary.guardianIds=[];
  if(change==='spoilage')for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.expiresAt=f.w.minute+.25;
  const before={...f.provider.inventory},result=stepWorldWithFoodEvidence(f.w,.25);
  assert.deepEqual(result.longCareMeals,[]);assert.deepEqual(result.careMeals,[]);assert.deepEqual(result.childCareMeals,[]);assert.equal(f.c.paid,0);assert.equal(f.c.visits.length,0);
  assert.equal(f.provider.inventory.meal,change==='spoilage'?0:before.meal);assert.equal(f.provider.inventory.water,before.water);
 }
});

test('long care meals: real immediate beneficiary withdrawal beats final step in either resident order without full decision capacity',()=>{
 for(const reverse of [false,true]){
  const f=longCareFixture();queueLongCare(f);stepWorld(f.w,19.75);if(reverse)f.w.residents.reverse();
  f.beneficiary.canDecide=false;const stock={...f.provider.inventory},money=totalCoins(f.w);
  queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='longCare'&&a.operation==='cancel'&&a.agreementId===f.c.id));
  assert.equal(f.c.status,'cancelled');assert.equal(f.c.refunded,12);assert.equal(f.beneficiary.canDecide,false);
  assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).longCareMeals,[]);assert.deepEqual(f.provider.inventory,stock);assert.equal(f.c.paid,0);assert.equal(totalCoins(f.w),money);
 }
});

test('long care meals: safe vessel water cannot replace the signed personal water debit',()=>{
 const f=longCareFixture();queueLongCare(f);stepWorld(f.w,19.75);f.provider.inventory.water=0;
 const vessel={id:'offline-long-bucket',ownerId:f.provider.id,buildingId:null,capacity:6 as const,amount:6,quality:'safe' as const,createdAt:f.w.minute};f.w.waterSupply!.vessels.push(vessel);
 const meal=f.provider.inventory.meal;assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).longCareMeals,[]);assert.equal(vessel.amount,6);assert.equal(f.provider.inventory.meal,meal);
});

test('long care meals: two genuine provider agreements record both actual visits even after hunger reaches zero, and never share event IDs',()=>{
 for(const reverse of [false,true]){
  const f=longCareFixture();f.other.at={...f.provider.at};f.beneficiary.hunger=4;
  queueCareAction(f.w,f.other,longCareChoice(f.w,f.other,a=>a.type==='longCare'&&a.operation==='offer'&&a.targetId===f.beneficiary.id&&a.condition==='daily',
   {fee:3,days:1,startsIn:60,startMinute:480,windowMinutes:120,visitsPerDay:1}));finishLongCare(f.w,f.other);
  const second=f.w.longCare!.agreements.at(-1)!;
  queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='longCare'&&a.operation==='accept'&&a.agreementId===second.id));finishLongCare(f.w,f.beneficiary);
  f.w.minute=careWindows(second,second.startDay)[0].start+1;originalCareLots(f);f.beneficiary.hunger=4;
  queueLongCare(f);queueCareAction(f.w,f.other,careChoice(f.w,f.other,a=>a.type==='longCare'&&a.operation==='visit'&&a.agreementId===second.id));
  if(reverse)f.w.residents.reverse();const result=stepWorldWithFoodEvidence(f.w,20),rows=result.longCareMeals!;
  assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.eventId)).size,2);assert.equal(new Set(rows.map(r=>r.agreementId)).size,2);
  assert.equal(rows[0].providerId,(reverse?f.other:f.provider).id);assert.ok(rows[0].hungerRelief<25);assert.ok(rows[1].hungerRelief<1);
  assert.equal(f.provider.inventory.meal,9);assert.equal(f.other.inventory.meal,9);assert.equal(f.c.paid+second.paid,6);
 }
});

test('long care meals: consumed slot, duplicate plan and newly submitted stale visit cannot produce a second debit',()=>{
 const f=longCareFixture(),plan=queueLongCare(f);assert.equal(finishLongCare(f.w,f.provider).length,1);const stock={...f.provider.inventory};
 assert.deepEqual(submitPlan(f.w,plan),{ok:true});assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).longCareMeals,[]);
 const stale={...plan,id:plan.id+':stale',actorRevision:f.provider.revision,createdAt:f.w.minute};assert.equal(submitPlan(f.w,stale).ok,true);assert.deepEqual(finishLongCare(f.w,f.provider),[]);assert.ok(f.provider.lastFailure);assert.deepEqual(f.provider.inventory,stock);assert.equal(f.c.visits.length,1);
});

test('long care meals: SQLite reload resumes original plan, contract and original lots once without backfilling prior visits',()=>{
 const f=longCareFixture();const plan=queueLongCare(f);stepWorld(f.w,19.75);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const loaded=store.load(true)!,provider=loaded.residents.find(r=>r.id===f.provider.id)!;
  const rows=finishLongCare(loaded,provider);assert.equal(rows.length,1);assert.equal(rows[0].planId,plan.id);assert.equal(rows[0].inputs[0].nutrition,25);assert.equal(rows[0].agreementId,f.c.id);
  store.commit(loaded,f.w.revision);const again=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(again,1).longCareMeals,[]);assert.equal(JSON.stringify(again).includes('longCareMeals'),false);
 }finally{store.close();}
});

test('long care meals: persisted cancellation and missing material are rechecked after reload',()=>{
 for(const cancel of [false,true]){
  const f=longCareFixture();queueLongCare(f);stepWorld(f.w,19.75);
  if(cancel)queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='longCare'&&a.operation==='cancel'&&a.agreementId===f.c.id));else f.provider.inventory.water=0;
  const store=new WorldStore(':memory:');try{store.commit(f.w,null);const loaded=store.load(true)!,provider=loaded.residents.find(r=>r.id===f.provider.id)!,stock={...provider.inventory};
   assert.deepEqual(finishLongCare(loaded,provider),[]);assert.deepEqual(provider.inventory,stock);assert.equal(loaded.longCare!.agreements[0].paid,0);
  }finally{store.close();}
 }
});

test('long care meals: enabled observation leaves actual world and decision context identical and ignores prediction copies',()=>{
 const f=longCareFixture();queueLongCare(f);const plain=structuredClone(f.w),before=structuredClone(f.w);
 assert.deepEqual(captureDirectEating(f.w,()=>stepWorld(copyForSimulation(f.w),20)).longCareMeals,[]);assert.deepEqual(f.w,before);
 assert.equal(stepWorldWithFoodEvidence(f.w,20).longCareMeals!.length,1);stepWorld(plain,20);assert.deepEqual(f.w,plain);
 assert.deepEqual(decisionContext(f.w,f.provider),decisionContext(plain,plain.residents.find(r=>r.id===f.provider.id)!));assert.equal(JSON.stringify(f.w).includes('longCareMeals'),false);
});

test('long care meals: thrown capture returns no success observation and releases hooks without claiming rollback',()=>{
 const f=longCareFixture();queueLongCare(f);assert.throws(()=>captureDirectEating(f.w,()=>{stepWorld(f.w,20);throw new Error('Offline capture failure');}),/Offline capture failure/);
 assert.equal(f.provider.inventory.meal,9);assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).longCareMeals,[]);
});

test('long care meals: daily observed zero and missing legacy coverage stay separate, never becoming a complete ledger',()=>{
 const f=longCareFixture();queueLongCare(f);const observer=createIsolationEvidence(f.w);
 for(let i=0;i<20;i++)observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));
 const row=observer.finish(f.w)!;assert.equal(row.longCareMeals.receipts.length,1);assert.equal(row.longCareMeals.observedMinutes,20);assert.equal(row.longCareMeals.unobservedMinutes,0);
 assert.deepEqual(row.longCareMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:25,healthGain:3,completedActions:1});assert.equal(row.foodConsumption.value,null);assert.equal(row.grossHealthDamage.value,null);
 const legacy=stepWorldWithFoodEvidence(f.w,1);delete legacy.longCareMeals;observer.sample(f.w,legacy);observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));
 const after=observer.finish(f.w)!;assert.equal(after.longCareMeals.totals,null);assert.equal(after.longCareMeals.observedMinutes,21);assert.equal(after.longCareMeals.unobservedMinutes,1);
 assert.equal(after.childCareMeals.totals!.completedActions,0);assert.equal(after.careMeals.totals!.completedActions,0);assert.equal(after.directEating.totals!.completedActions,0);
 stepWorld(f.w,1);observer.sample(f.w);assert.equal(observer.finish(f.w)!.longCareMeals.unobservedMinutes,2);
});

test('long care meals: zero-activity midnight attribution and receipt time validation do not fabricate covered days',()=>{
 const f=longCareFixture();f.w.minute=2*DAY-1;const observer=createIsolationEvidence(f.w),row=observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1))!;
 assert.equal(row.calendarDay,1);assert.equal(row.longCareMeals.observedMinutes,1);assert.equal(row.longCareMeals.totals!.completedActions,0);
 observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));assert.equal(observer.finish(f.w)!.calendarDay,2);
 const invalid=stepWorldWithFoodEvidence(f.w,1);invalid.longCareMeals=[{at:f.w.minute+1} as any];assert.throws(()=>observer.sample(f.w,invalid),/does not cover/);
});

test('long care meals: actual unfunded visit transaction throws before success evidence and clears capture hooks',()=>{
 const f=longCareFixture();queueLongCare(f);stepWorld(f.w,19.75);
 f.w.economy!.escrows[f.c.account.slice('escrow:'.length)]=0;
 assert.throws(()=>stepWorldWithFoodEvidence(f.w,.25),/long_care_unfunded/);
 assert.equal(f.c.visits.length,0);assert.equal(f.c.paid,0);
 // Direct engine calls are not rollback transactions. Do not replay a mutated failed world.
 assert.deepEqual(captureDirectEating(f.w,()=>{}).longCareMeals,[]);
});

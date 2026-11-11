import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {accountBalance,totalCoins,moveCoins} from '../src/world/economy.js';
import {completeDuty,dutyReason} from '../src/world/public-duties.js';
import {publicMealFixture,queuePublicMeal,finishPublicMeal,runPublicAction} from './helpers/public-duty-meal-evidence.js';

for(const role of ['kitchen','care'] as const)for(const funded of [false,true])test(`public meals: actual numbered ${funded?'voted funded':'personal'} ${role} request records physical lots, effects and payment exactly once`,()=>{
 const f=publicMealFixture(role,funded),stock={...f.inventory},personal={...f.provider.inventory},coins=totalCoins(f.w),providerCoins=f.provider.coins;
 const balance=f.shift.funding?accountBalance(f.w,f.shift.funding.wageAccount):null,plan=queuePublicMeal(f),rows=finishPublicMeal(f.w,f.beneficiary);
 assert.equal(rows.length,1);const r=rows[0],quantity=role==='care'?1:2;
 assert.equal(r.action,'publicDuty');assert.equal(r.operation,'receive');assert.equal(r.planId,plan.id);assert.equal(r.providerId,f.provider.id);assert.equal(r.beneficiaryId,f.beneficiary.id);
 assert.equal(r.shiftId,f.shift.id);assert.equal(r.buildingId,f.building.id);assert.equal(r.role,role);assert.equal(r.serviceNumber,1);assert.equal(r.container,f.container);assert.equal(r.source,funded?'public':'personal');
 assert.deepEqual(r.inputs.map(i=>[i.item,i.quantity]),[[f.item,quantity],['water',1]]);
 assert.deepEqual(r.inputs[0].lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.25,'food/life@90',2.5],[quantity-.25,'food/life@91',(quantity-.25)*30]]);
 assert.equal(r.inputs[0].nutrition,role==='care'?25:55);assert.deepEqual(r.inputs[1],{item:'water',quantity:1,nutrition:0,lots:[]});
 assert.equal(r.hungerRelief,role==='care'?20:42);assert.equal(r.hungerBefore-r.hungerAfter,r.hungerRelief);assert.equal(r.healthGain,role==='care'?8:0);assert.equal(r.healthAfter-r.healthBefore,r.healthGain);
 assert.equal(f.inventory[f.item],stock[f.item]!-quantity);assert.equal(f.inventory.water,stock.water!-1);assert.equal(totalCoins(f.w),coins);
 if(funded){assert.deepEqual(f.provider.inventory,personal);assert.equal(f.provider.coins,providerCoins!+3);assert.equal(accountBalance(f.w,f.shift.funding!.wageAccount),balance!-3);
  assert.deepEqual(r.funding,{budgetId:f.shift.funding!.budgetId,account:f.shift.funding!.wageAccount,wagePerService:3,providerCoinsBefore:providerCoins,providerCoinsAfter:providerCoins!+3,accountBalanceBefore:balance,accountBalanceAfter:balance!-3,paidBefore:0,paidAfter:3});
  assert.equal(f.w.economy!.treasuryStock[f.item],f.inventory[f.item]);assert.equal(f.w.economy!.treasuryStock.water,f.inventory.water);
 }else{assert.equal(r.funding,null);assert.equal(f.provider.coins,providerCoins);}
 assert.equal(f.shift.served,1);const event=f.w.events.find(e=>e.id===r.eventId)!;assert.deepEqual(event.actors,[f.provider.id,f.beneficiary.id]);assert.equal(event.at,r.at);
 const after=stepWorldWithFoodEvidence(f.w,1);for(const field of ['publicDutyMeals','receipts','foodFlows','careMeals','childCareMeals','longCareMeals'] as const)assert.deepEqual(after[field],[]);
 const saved={...f.inventory};assert.ok(completeDuty(f.w,f.beneficiary,{type:'publicDuty',operation:'receive',shiftId:f.shift.id}));assert.deepEqual(f.inventory,saved);
 assert.deepEqual(submitPlan(f.w,plan),{ok:true});assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).publicDutyMeals,[]);
});

for(const funded of [false,true])for(const change of ['spoilage','water','absent','withdraw','termination','window'] as const)test(`public meals: ${funded?'funded':'personal'} final-step ${change} produces no successful receipt`,()=>{
 const f=publicMealFixture('care',funded);queuePublicMeal(f);stepWorld(f.w,change==='withdraw'?28:29.75);assert.ok(f.beneficiary.activity);
 if(change==='spoilage')for(const lot of f.w.food!.lots[f.container].meal!)lot.expiresAt=f.w.minute+.25;
 if(change==='water')f.inventory.water=0;
 if(change==='absent'){f.provider.inside=null;f.provider.roomAt=null;}
 if(change==='withdraw')runPublicAction(f.w,f.provider,a=>a.type==='publicDuty'&&a.operation==='withdraw'&&a.shiftId===f.shift.id);
 if(change==='termination')f.provider.residency='outside';
 if(change==='window')f.w.minute=f.shift.end;
 const water=f.inventory.water,coins=f.provider.coins,result=stepWorldWithFoodEvidence(f.w,.25);
 assert.deepEqual(result.publicDutyMeals,[]);assert.equal(f.shift.served,0);assert.equal(f.provider.coins,coins);assert.equal(f.shift.funding?.paid??0,0);assert.equal(f.inventory.water,water);
});

test('public meals: two own requests compete for the last public stock in either resident order',()=>{
 for(const reverse of [false,true]){
  const f=publicMealFixture('kitchen',true);f.inventory.turnip=2;f.inventory.water=1;f.w.food!.lots[f.container].turnip![1].quantity=1.75;
  queuePublicMeal(f);queuePublicMeal(f,f.other);if(reverse)f.w.residents.reverse();const result=stepWorldWithFoodEvidence(f.w,21);
  assert.equal(result.publicDutyMeals!.length,1);assert.equal(result.publicDutyMeals![0].beneficiaryId,(reverse?f.other:f.beneficiary).id);assert.equal(f.shift.served,1);assert.equal(f.shift.funding!.paid,3);assert.equal(f.inventory.turnip,0);assert.equal(f.inventory.water,0);
 }
});

test('public meals: saturation and unknown original definition never infer nutrition from fixed hunger relief',()=>{
 for(const known of [true,false]){
  const f=publicMealFixture('care');f.beneficiary.hunger=2;f.beneficiary.health=99;
  if(!known)for(const lot of f.w.food!.lots[f.container].meal!)lot.definition='missing/food@1';
  queuePublicMeal(f);const r=finishPublicMeal(f.w,f.beneficiary)[0];assert.equal(r.inputs[0].nutrition,known?25:null);assert.equal(r.hungerAfter,0);assert.ok(r.hungerRelief<20);assert.equal(r.healthAfter,100);assert.equal(r.healthGain,1);
 }
});

for(const funded of [false,true])test(`public meals: ${funded?'funded':'personal'} SQLite reload resumes once, original batches survive and receipts stay out of save`,()=>{
 const f=publicMealFixture('care',funded),plan=queuePublicMeal(f);stepWorld(f.w,29.75);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const loaded=store.load(true)!,client=loaded.residents.find(r=>r.id===f.beneficiary.id)!;
  const rows=finishPublicMeal(loaded,client);assert.equal(rows.length,1);assert.equal(rows[0].planId,plan.id);assert.equal(rows[0].inputs[0].nutrition,25);
  store.commit(loaded,f.w.revision);const again=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(again,1).publicDutyMeals,[]);assert.equal(again.duties!.shifts.find(s=>s.id===f.shift.id)!.served,1);assert.equal(JSON.stringify(again).includes('publicDutyMeals'),false);
 }finally{store.close();}
});

test('public meals: observation preserves world, save and final menus, and never captures prediction-copy consumption',()=>{
 for(const funded of [false,true]){
  const f=publicMealFixture('kitchen',funded);queuePublicMeal(f);const plain=structuredClone(f.w),before=structuredClone(f.w);
  assert.deepEqual(captureDirectEating(f.w,()=>stepWorld(copyForSimulation(f.w),20)).publicDutyMeals,[]);assert.deepEqual(f.w,before);
  assert.equal(stepWorldWithFoodEvidence(f.w,20).publicDutyMeals!.length,1);stepWorld(plain,20);assert.deepEqual(f.w,plain);
  assert.deepEqual(decisionChoices(decisionContext(f.w,f.beneficiary)),decisionChoices(decisionContext(plain,plain.residents.find(r=>r.id===f.beneficiary.id)!)));
  const a=new WorldStore(':memory:'),b=new WorldStore(':memory:');try{a.commit(f.w,null);b.commit(plain,null);assert.deepEqual(a.load(true),b.load(true));}finally{a.close();b.close();}
 }
});

test('public meals: no self-request or refused care is offered or completed',()=>{
 const f=publicMealFixture('care',true),action={type:'publicDuty' as const,operation:'receive' as const,shiftId:f.shift.id};
 assert.ok(dutyReason(f.w,f.provider,action));assert.equal(decisionChoices(decisionContext(f.w,f.provider)).some(c=>c.action.type==='publicDuty'&&c.action.operation==='receive'&&c.action.shiftId===f.shift.id),false);
 f.beneficiary.refusesCare=true;assert.ok(dutyReason(f.w,f.beneficiary,action));assert.equal(decisionChoices(decisionContext(f.w,f.beneficiary)).some(c=>c.action.type==='publicDuty'&&c.action.operation==='receive'&&c.action.shiftId===f.shift.id),false);
 assert.deepEqual(captureDirectEating(f.w,()=>{assert.ok(completeDuty(f.w,f.beneficiary,action));}).publicDutyMeals,[]);assert.equal(f.shift.served,0);assert.equal(f.shift.funding!.paid,0);
});

test('public meals: last-step missing escrow and conflicting wage reference cannot claim a successful payment or meal',()=>{
 for(const conflict of [false,true]){
  const f=publicMealFixture('care',true);queuePublicMeal(f);stepWorld(f.w,29.75);const funding=f.shift.funding!;
  if(conflict)assert.equal(moveCoins(f.w,`resident:${f.other.id}`,`resident:${f.provider.id}`,1,'Synthetic conflicting reference',`${f.shift.id}:service:1`),true);
  else assert.equal(moveCoins(f.w,funding.wageAccount,'treasury',accountBalance(f.w,funding.wageAccount),'Synthetic exhausted escrow','public-meal-empty-escrow'),true);
  const stock={...f.inventory},coins=f.provider.coins,balance=accountBalance(f.w,funding.wageAccount);
  assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).publicDutyMeals,[]);assert.deepEqual(f.inventory,stock);assert.equal(f.provider.coins,coins);assert.equal(accountBalance(f.w,funding.wageAccount),balance);assert.equal(f.shift.served,0);assert.equal(funding.paid,0);
 }
});

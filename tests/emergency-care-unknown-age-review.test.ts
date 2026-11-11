import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,World,Resident} from '../src/shared/types.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {advanceEmergencyCare,completeEmergencyCare,emergencyCareSelfWithdrawal} from '../src/world/emergency-care.js';
import {totalCoins} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';
import {carePlan} from './helpers/care-meal-evidence.js';
import {activeEmergencyCare,emergencyCareFixture,finishEmergencyCare,queueEmergencyCare} from './helpers/emergency-care-meal-evidence.js';

const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const assets=(w:World)=>structuredClone({money:totalCoins(w),people:w.residents.map(r=>({id:r.id,stock:r.inventory,coins:r.coins,guardians:r.guardianIds,parents:r.parents,home:r.homeId})),buildings:w.buildings,plots:w.plots});
const malformed=(r:Resident,date:unknown)=>{r.bornAt=date as number;};

for(const last of [.25,1.2])for(const reload of [false,true])test(`independent emergency age review: sixth birthday final ${last}, SQLite ${reload}`,()=>{
 const f=activeEmergencyCare(3);let {w,provider,beneficiary,c}=f;
 // The stored fractional birth date defines the birthday, not reverse division.
 beneficiary.bornAt=w.minute+.001+20-6*YEAR;const birthday=beneficiary.bornAt+6*YEAR;
 w.minute=birthday-20;queueEmergencyCare(f);stepWorld(w,20-last);
 assert.ok(provider.activity);assert.ok(Math.abs(provider.activity.remaining-last)<1e-8);
 const before=assets(w),expiry=c.expiresAt,store=new WorldStore(':memory:');
 try{
  if(reload){store.commit(w,null);w=store.loadForRuntime()!;provider=w.residents.find(p=>p.id===provider.id)!;beneficiary=w.residents.find(p=>p.id===beneficiary.id)!;c=w.emergencyCare!.agreements[0];}
  const rows=stepWorldWithFoodEvidence(w,last).emergencyCareMeals!;
  assert.equal(w.minute,birthday);assert.deepEqual(rows,[]);assert.equal(c.status,'invalid');assert.equal(c.acceptedAt,null);assert.equal(c.meals,0);assert.deepEqual(c.receipts,[]);assert.equal(c.expiresAt,expiry);assert.deepEqual(assets(w),before);
 }finally{store.close();}
});

for(const date of ['future','null'] as const)test(`independent emergency age review: SQLite ${date} cannot revive authority when date becomes valid`,()=>{
 const f=activeEmergencyCare(3),expiry=f.c.expiresAt;queueEmergencyCare(f);stepWorld(f.w,19.75);
 malformed(f.beneficiary,date==='future'?f.w.minute+1:null);const before=assets(f.w),store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,provider=w.residents.find(p=>p.id===f.provider.id)!,child=w.residents.find(p=>p.id===f.beneficiary.id)!,c=w.emergencyCare!.agreements[0];
  assert.deepEqual(finishEmergencyCare(w,provider),[]);assert.equal(c.status,'invalid');assert.equal(c.expiresAt,expiry);assert.deepEqual(assets(w),before);
  if(date==='future')w.minute=child.bornAt;else child.bornAt=w.minute-3*YEAR;
  advanceEmergencyCare(w);
  assert.ok(completeEmergencyCare(w,provider,{type:'emergencyCare',operation:'feed',agreementId:c.id,step:0}));
  assert.equal(c.status,'invalid');assert.equal(c.acceptedAt,null);assert.equal(c.meals,0);assert.equal(c.expiresAt,expiry);assert.deepEqual(assets(w),before);
 }finally{store.close();}
});

test('independent emergency age review: known older incapacitated child still receives exactly one severe rescue meal',()=>{
 const f=emergencyCareFixture(10,true),before=assets(f.w);queueEmergencyCare(f,'rescueMeal');const rows=finishEmergencyCare(f.w,f.provider);
 assert.equal(rows.length,1);assert.equal(rows[0].operation,'rescueMeal');assert.equal(f.provider.inventory.meal,before.people[0].stock.meal!-1);assert.equal(f.provider.inventory.water,before.people[0].stock.water!-1);assert.equal(totalCoins(f.w),before.money);assert.deepEqual(f.w.emergencyCare!.agreements,[]);assert.deepEqual(f.beneficiary.guardianIds,[]);
});

test('independent emergency age review: completed old agreement can be acknowledged once, never reopened or renewed',()=>{
 const f=activeEmergencyCare(10),{w,beneficiary,c}=f;
 for(let i=0;i<4;i++){beneficiary.hunger=80;queueEmergencyCare(f);assert.equal(finishEmergencyCare(w,f.provider).length,1);}
 assert.equal(c.status,'completed');assert.equal(c.receipts.length,4);
 malformed(beneficiary,null);beneficiary.canDecide=false;const expiry=c.expiresAt,ended=c.endedAt,before=assets(w);
 const choices=menu(w,beneficiary),row=choices.find(x=>x.action.type==='emergencyCare'&&x.action.operation==='withdraw'&&x.action.agreementId===c.id);assert.ok(row);
 const action=parseChoice(JSON.stringify({choice:row.id}),choices).actions[0],plan=carePlan(w,beneficiary,[action]);assert.equal(submitPlan(w,plan).ok,true);
 assert.equal(c.status,'completed');assert.equal(c.endedAt,ended);assert.equal(c.expiresAt,expiry);assert.equal(c.meals,4);assert.deepEqual(assets(w),before);assert.ok(c.endKnownBy.includes(beneficiary.id));
 const serialized=JSON.stringify(w);assert.equal(submitPlan(w,plan).ok,true);assert.equal(JSON.stringify(w),serialized);assert.equal(emergencyCareSelfWithdrawal(w,beneficiary,action),null);
});

test('independent emergency age review: remote expression-only stop preserves unrelated pending plan and cannot expand its scope',()=>{
 const f=activeEmergencyCare(10),{w,beneficiary,provider,c}=f;
 assert.equal(submitPlan(w,carePlan(w,beneficiary,[{type:'wait',minutes:15}])).ok,true);const pending=structuredClone(beneficiary.plan);
 beneficiary.at={x:2,y:16};malformed(beneficiary,null);beneficiary.canDecide=false;beneficiary.canExpress=true;
 const stop:Action={type:'emergencyCare',operation:'withdraw',agreementId:c.id};
 for(const extra of [{childId:beneficiary.id},{reviewerId:provider.id},{step:0},{noticeId:'other'},{observedTarget:{id:provider.id}}]){
  assert.equal(submitPlan(w,carePlan(w,beneficiary,[{...stop,...extra} as Action])).ok,false);assert.equal(c.status,'active');
 }
 for(const action of [{type:'emergencyCare',operation:'accept',agreementId:c.id},{type:'emergencyCare',operation:'review',agreementId:c.id},{type:'emergencyCare',operation:'feed',agreementId:c.id,step:0},{type:'wait',minutes:16}] as Action[])assert.equal(submitPlan(w,carePlan(w,beneficiary,[action])).ok,false);
 const before=assets(w),at=w.minute;assert.equal(submitPlan(w,carePlan(w,beneficiary,[stop])).ok,true);
 assert.equal(w.minute,at);assert.equal(c.status,'withdrawn');assert.equal(c.endedAt,at);assert.deepEqual(beneficiary.plan,pending);assert.deepEqual(assets(w),before);assert.equal(c.meals,0);
});

test('independent emergency age review: exact expiry removes expression-only stop without editing the historical agreement',()=>{
 const f=activeEmergencyCare(3),{w,beneficiary,c}=f;malformed(beneficiary,null);beneficiary.canDecide=false;beneficiary.canExpress=true;
 w.minute=c.expiresAt;const before=JSON.stringify(c),a:Action={type:'emergencyCare',operation:'withdraw',agreementId:c.id};
 assert.equal(emergencyCareSelfWithdrawal(w,beneficiary,a),null);assert.equal(menu(w,beneficiary).some(x=>x.action.type==='emergencyCare'&&x.action.operation==='withdraw'),false);assert.equal(submitPlan(w,carePlan(w,beneficiary,[a])).ok,false);assert.equal(JSON.stringify(c),before);
 advanceEmergencyCare(w);assert.equal(c.status,'expired');assert.equal(c.endedAt,w.minute);assert.equal(c.acceptedAt,null);assert.equal(c.meals,0);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {EmergencyCareAction} from '../src/shared/emergency-care.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {completeEmergencyCare,emergencyCareReason,advanceEmergencyCare} from '../src/world/emergency-care.js';
import {totalCoins} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';
import {careChoice,carePlan,queueCareAction} from './helpers/care-meal-evidence.js';
import {activeEmergencyCare,emergencyCareFixture,offerEmergencyCare,queueEmergencyCare,finishEmergencyCare} from './helpers/emergency-care-meal-evidence.js';

const born=(r:Resident,value:unknown)=>{r.bornAt=value as number;};
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const has=(w:World,r:Resident,operation:EmergencyCareAction['operation'])=>menu(w,r).some(c=>c.action.type==='emergencyCare'&&c.action.operation===operation);
const preserved=(w:World)=>structuredClone({people:w.residents.map(r=>({id:r.id,inventory:r.inventory,coins:r.coins,parents:r.parents,adoptiveParents:r.adoptiveParents,guardians:r.guardianIds,home:r.homeId})),buildings:w.buildings,plots:w.plots,money:totalCoins(w)});
const malformed:[string,(w:World)=>unknown][]=[['null',()=>null],['missing',()=>undefined],['string',()=>'-100'],['NaN',()=>NaN],['Infinity',()=>Infinity],['negative Infinity',()=>-Infinity],['future',w=>w.minute+1000],['unsafe',()=>-Number.MAX_VALUE]];

for(const [name,value] of malformed)test(`unknown emergency care: ${name} never confers childhood offer or rescue authority`,()=>{
 const f=emergencyCareFixture(3),{w,provider,beneficiary,other}=f;born(beneficiary,value(w));beneficiary.health=19;
 const before=preserved(w),hunger=beneficiary.hunger;
 for(const operation of ['offer','rescueMeal'] as const){
  assert.equal(has(w,provider,operation),false);
  const a:EmergencyCareAction={type:'emergencyCare',operation,childId:beneficiary.id,...(operation==='offer'?{reviewerId:other.id,step:w.emergencyCare!.nextSerial}:{})};
  assert.ok(emergencyCareReason(w,provider,a));assert.ok(completeEmergencyCare(w,provider,a));
 }
 assert.deepEqual(preserved(w),before);assert.equal(beneficiary.hunger,hunger);assert.deepEqual(w.emergencyCare!.agreements,[]);
});

for(const value of [null,NaN,'missing'] as unknown[])test(`unknown emergency care: queued independent review cannot activate a corrupt date (${String(value)})`,()=>{
 const f=emergencyCareFixture(3),c=offerEmergencyCare(f),before=preserved(f.w),expiry=c.expiresAt;
 queueCareAction(f.w,f.other,careChoice(f.w,f.other,a=>a.type==='emergencyCare'&&a.operation==='review'&&a.agreementId===c.id));stepWorld(f.w,1.75);assert.ok(f.other.activity);
 born(f.beneficiary,value);assert.deepEqual(finishEmergencyCare(f.w,f.other),[]);
 assert.equal(c.status,'invalid');assert.equal(c.reviewedAt,null);assert.equal(c.acceptedAt,null);assert.equal(c.expiresAt,expiry);assert.equal(c.meals,0);assert.deepEqual(preserved(f.w),before);assert.equal(has(f.w,f.provider,'feed'),false);
});

for(const age of [3,10])for(const change of ['null','future','missing','reviewer','provider','refusal','capacity'] as const)test(`unknown emergency care: ${age}-year original meal rechecks ${change} in final quarter minute`,()=>{
 const f=activeEmergencyCare(age),{w,provider,beneficiary,c}=f;queueEmergencyCare(f);stepWorld(w,19.75);assert.ok(provider.activity);
 const before=preserved(w),expiry=c.expiresAt,accepted=c.acceptedAt;
 if(change==='null')born(beneficiary,null);if(change==='future')born(beneficiary,w.minute+1000);if(change==='missing')born(beneficiary,undefined);
 if(change==='reviewer')born(f.other,null);if(change==='provider')born(provider,null);
 if(change==='refusal')beneficiary.refusesCare=true;
 if(change==='capacity'){beneficiary.canDecide=false;if(age<6)born(beneficiary,null);}
 assert.deepEqual(finishEmergencyCare(w,provider),[]);assert.ok(provider.lastFailure);assert.equal(c.meals,0);assert.deepEqual(c.receipts,[]);assert.equal(c.expiresAt,expiry);assert.equal(c.acceptedAt,accepted);assert.deepEqual(preserved(w),before);
});

test('unknown emergency care: SQLite preserves corrupted old active record without consent, stock or deadline repair',()=>{
 for(const date of [null,NaN,undefined]){
  const f=activeEmergencyCare(3);queueEmergencyCare(f);stepWorld(f.w,19.75);born(f.beneficiary,date);const before=preserved(f.w),expiry=f.c.expiresAt,store=new WorldStore(':memory:');
  try{store.commit(f.w,null);const w=store.load(true)!,provider=w.residents.find(r=>r.id===f.provider.id)!,beneficiary=w.residents.find(r=>r.id===f.beneficiary.id)!,c=w.emergencyCare!.agreements[0];
   assert.ok(beneficiary.bornAt===null||beneficiary.bornAt===undefined);assert.equal(c.acceptedAt,null);assert.equal(c.expiresAt,expiry);assert.deepEqual(finishEmergencyCare(w,provider),[]);assert.equal(c.status,'invalid');assert.equal(c.meals,0);assert.deepEqual(preserved(w),before);
   born(beneficiary,w.minute-3*YEAR);assert.ok(completeEmergencyCare(w,provider,{type:'emergencyCare',operation:'feed',agreementId:c.id,step:0}));assert.equal(c.status,'invalid');assert.equal(c.acceptedAt,null);assert.equal(c.expiresAt,expiry);
  }finally{store.close();}
 }
});

for(const canDecide of [true,false])test(`unknown emergency care: expressive beneficiary retains actual immediate stop with canDecide=${canDecide}`,()=>{
 const f=activeEmergencyCare(10),{w,provider,beneficiary,c}=f;queueEmergencyCare(f);stepWorld(w,19.75);born(beneficiary,null);beneficiary.canDecide=canDecide;beneficiary.canExpress=true;
 const before=preserved(w),expiry=c.expiresAt,rows=menu(w,beneficiary),stop=rows.find(x=>x.action.type==='emergencyCare'&&x.action.operation==='withdraw'&&x.action.agreementId===c.id);assert.ok(stop);
 if(!canDecide)assert.ok(rows.every(x=>x.action.type==='wait'||x.action.type==='emergencyCare'&&x.action.operation==='withdraw'));
 const a=parseChoice(JSON.stringify({choice:stop.id}),rows).actions[0];assert.equal(submitPlan(w,carePlan(w,beneficiary,[a])).ok,true);assert.equal(c.status,'withdrawn');assert.equal(c.endedAt,w.minute);assert.ok(c.endKnownBy.includes(beneficiary.id));assert.equal(c.expiresAt,expiry);
 assert.deepEqual(finishEmergencyCare(w,provider),[]);assert.deepEqual(preserved(w),before);assert.equal(c.meals,0);assert.equal(c.receipts.length,0);
});

test('unknown emergency care: expression-only stop is exact self agreement, never consent or work',()=>{
 const f=activeEmergencyCare(10),{w,beneficiary,c}=f;born(beneficiary,null);beneficiary.canDecide=false;beneficiary.canExpress=true;
 const stop:Action={type:'emergencyCare',operation:'withdraw',agreementId:c.id};
 for(const a of [{...stop,agreementId:'invented'},{...stop,childId:f.other.id},{...stop,operation:'accept'},{...stop,operation:'feed',step:0}] as Action[]){assert.equal(submitPlan(w,carePlan(w,beneficiary,[a])).ok,false);assert.equal(c.status,'active');}
 assert.equal(submitPlan(w,carePlan(w,beneficiary,[stop,{type:'wait',minutes:1}])).ok,false);assert.equal(c.status,'active');
 f.other.canDecide=false;assert.equal(submitPlan(w,carePlan(w,f.other,[stop])).ok,false);
 beneficiary.canExpress=false;assert.equal(submitPlan(w,carePlan(w,beneficiary,[stop])).ok,false);
});

test('known emergency care: infant exemption and independent sixth-year assent remain distinct',()=>{
 for(const age of [3,6,10]){
  const f=emergencyCareFixture(age),c=offerEmergencyCare(f),before=preserved(f.w);
  queueCareAction(f.w,f.other,careChoice(f.w,f.other,a=>a.type==='emergencyCare'&&a.operation==='review'&&a.agreementId===c.id));finishEmergencyCare(f.w,f.other);
  assert.equal(c.status,age<6?'active':'offered');assert.equal(c.acceptedAt,null);
  if(age>=6){assert.equal(has(f.w,f.provider,'feed'),false);queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='emergencyCare'&&a.operation==='accept'&&a.agreementId===c.id));finishEmergencyCare(f.w,f.beneficiary);assert.notEqual(c.acceptedAt,null);}
  queueEmergencyCare(f);assert.equal(finishEmergencyCare(f.w,f.provider).length,1);assert.equal(f.provider.inventory.meal,before.people[0].inventory.meal!-1);assert.equal(f.provider.inventory.water,before.people[0].inventory.water!-1);assert.equal(totalCoins(f.w),before.money);assert.equal(c.meals,1);
 }
});

test('unknown emergency care: invalidation preserves finite expiry and explicit refusal, never revives at date repair',()=>{
 const f=activeEmergencyCare(10),expiry=f.c.expiresAt;born(f.beneficiary,null);f.beneficiary.refusesCare=true;advanceEmergencyCare(f.w);
 assert.equal(f.c.status,'invalid');assert.equal(f.beneficiary.refusesCare,true);assert.equal(f.c.expiresAt,expiry);
 born(f.beneficiary,f.w.minute-10*YEAR);advanceEmergencyCare(f.w);assert.equal(f.c.status,'invalid');assert.ok(completeEmergencyCare(f.w,f.provider,{type:'emergencyCare',operation:'feed',agreementId:f.c.id,step:0}));assert.equal(f.c.meals,0);
});

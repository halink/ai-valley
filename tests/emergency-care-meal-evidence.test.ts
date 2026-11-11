import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import {careChoice,queueCareAction} from './helpers/care-meal-evidence.js';
import {activeEmergencyCare,emergencyCareFixture,offerEmergencyCare,queueEmergencyCare,finishEmergencyCare} from './helpers/emergency-care-meal-evidence.js';

for(const operation of ['feed','rescueMeal'] as const)test(`emergency meals: real final menu ${operation} debits original split lots and separate personal water`,()=>{
 const f=operation==='feed'?activeEmergencyCare():emergencyCareFixture(10,true),before={...f.provider.inventory};
 const plan=queueEmergencyCare(f,operation),rows=finishEmergencyCare(f.w,f.provider);assert.equal(rows.length,1);const r=rows[0];
 assert.equal(r.action,'emergencyCare');assert.equal(r.operation,operation);assert.equal(r.planId,plan.id);assert.equal(r.providerId,f.provider.id);assert.equal(r.beneficiaryId,f.beneficiary.id);
 assert.equal(r.container,'person:'+f.provider.id);assert.equal(r.agreementId,operation==='feed'?f.w.emergencyCare!.agreements.at(-1)!.id:null);assert.equal(r.mealNumber,operation==='feed'?1:null);
 assert.equal(f.provider.inventory.meal,before.meal!-1);assert.equal(f.provider.inventory.water,before.water!-1);
 assert.equal(r.inputs[0].nutrition,25);assert.equal(r.inputs[0].lots!.length,2);assert.deepEqual(r.inputs[1],{item:'water',quantity:1,nutrition:0,lots:[]});
 assert.equal(r.hungerRelief,r.hungerBefore-r.hungerAfter);assert.equal(r.hungerRelief,25);
 const event=f.w.events.find(e=>e.id===r.eventId)!;assert.equal(event.at,r.at);assert.deepEqual(event.audit!.resources,{meal:1,water:1});
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).emergencyCareMeals,[]);
 if(operation==='rescueMeal')assert.equal(f.w.emergencyCare!.agreements.length,0);
});

test('emergency meals: older child independently accepts, reviewer cannot substitute, toddler needs no invented assent',()=>{
 const f=emergencyCareFixture(),c=offerEmergencyCare(f);
 const choices=(r:typeof f.provider)=>decisionChoices(decisionContext(f.w,r));
 assert.equal(choices(f.provider).some(x=>x.action.type==='emergencyCare'&&x.action.operation==='accept'),false);
 assert.equal(choices(f.other).some(x=>x.action.type==='emergencyCare'&&x.action.operation==='accept'),false);
 assert.equal(choices(f.beneficiary).some(x=>x.action.type==='emergencyCare'&&x.action.operation==='accept'),true);assert.equal(c.status,'offered');
 const toddler=activeEmergencyCare(3);assert.equal(toddler.c.acceptedAt,null);queueEmergencyCare(toddler);assert.equal(finishEmergencyCare(toddler.w,toddler.provider).length,1);
});

test('emergency meals: real turnip fallback and capped hunger relief use completion-time stocks',()=>{
 const f=activeEmergencyCare();f.provider.inventory.turnip=3;queueEmergencyCare(f);stepWorld(f.w,19.75);f.provider.inventory.meal=0;f.beneficiary.hunger=12;
 const r=finishEmergencyCare(f.w,f.provider)[0];assert.equal(r.inputs[0].item,'turnip');assert.equal(r.hungerAfter,0);assert.equal(r.hungerRelief,r.hungerBefore);
});

for(const change of ['withdraw','refusal','guardian','reviewer','adult','expiry','spoilage','water','incapacity','sated'] as const)test(`emergency meals: completion rechecks ${change} without a successful receipt`,()=>{
 const f=activeEmergencyCare();queueEmergencyCare(f);stepWorld(f.w,19.75);const before={...f.provider.inventory};
 if(change==='withdraw'){queueCareAction(f.w,f.other,careChoice(f.w,f.other,a=>a.type==='emergencyCare'&&a.operation==='withdraw'&&a.agreementId===f.c.id));f.provider.activity!.remaining=3;finishEmergencyCare(f.w,f.other);}
 if(change==='refusal')f.beneficiary.refusesCare=true;
 if(change==='guardian')f.beneficiary.guardianIds=[f.other.id];
 if(change==='reviewer')f.other.canDecide=false;
 if(change==='adult')f.beneficiary.bornAt=f.w.minute-18*YEAR;
 if(change==='expiry'){f.w.minute=f.c.expiresAt;for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.expiresAt=f.w.minute+100;}
 if(change==='spoilage')for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.expiresAt=f.w.minute+.25;
 if(change==='water')f.provider.inventory.water=0;
 if(change==='incapacity')f.provider.canDecide=false;
 if(change==='sated')f.beneficiary.hunger=0;
 assert.deepEqual(finishEmergencyCare(f.w,f.provider),[]);assert.equal(f.provider.inventory.meal,change==='spoilage'?0:before.meal);assert.equal(f.provider.inventory.water,change==='water'?0:before.water);
});

test('emergency meals: four actual numbered meals exhaust the limited agreement',()=>{
 const f=activeEmergencyCare();for(let i=1;i<=4;i++){f.beneficiary.hunger=80;queueEmergencyCare(f);const r=finishEmergencyCare(f.w,f.provider)[0];assert.equal(r.mealNumber,i);assert.equal(f.c.meals,i);}
 assert.equal(f.c.status,'completed');assert.equal(decisionChoices(decisionContext(f.w,f.provider)).some(c=>c.action.type==='emergencyCare'&&c.action.operation==='feed'),false);
});

test('emergency meals: competing rescuers only record the actual winner when need is exhausted',()=>{
 for(const reverse of [false,true]){const f=emergencyCareFixture(3,true);f.beneficiary.hunger=12;queueEmergencyCare(f,'rescueMeal');queueEmergencyCare(f,'rescueMeal',f.other);if(reverse)f.w.residents.reverse();
 const result=stepWorldWithFoodEvidence(f.w,20);assert.equal(result.emergencyCareMeals!.length,1);assert.equal(result.emergencyCareMeals![0].providerId,(reverse?f.other:f.provider).id);}
});

test('emergency meals: SQLite reload resumes original plan once and rechecks refusal',()=>{
 for(const refuse of [false,true]){const f=activeEmergencyCare(),plan=queueEmergencyCare(f);stepWorld(f.w,19.75);if(refuse)f.beneficiary.refusesCare=true;const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const loaded=store.load(true)!,p=loaded.residents.find(r=>r.id===f.provider.id)!;const rows=finishEmergencyCare(loaded,p);assert.equal(rows.length,refuse?0:1);if(!refuse){assert.equal(rows[0].planId,plan.id);assert.equal(rows[0].inputs[0].nutrition,25);}assert.deepEqual(stepWorldWithFoodEvidence(loaded,1).emergencyCareMeals,[]);assert.equal(JSON.stringify(loaded).includes('emergencyCareMeals'),false);}finally{store.close();}}
});

test('emergency meals: prediction cannot publish and observation remains world-equivalent',()=>{
 const f=activeEmergencyCare();queueEmergencyCare(f);const plain=structuredClone(f.w),before=structuredClone(f.w);
 assert.deepEqual(captureDirectEating(f.w,()=>stepWorld(copyForSimulation(f.w),20)).emergencyCareMeals,[]);assert.deepEqual(f.w,before);
 const observed=stepWorldWithFoodEvidence(f.w,20);stepWorld(plain,20);assert.equal(observed.emergencyCareMeals!.length,1);assert.deepEqual(f.w,plain);
 assert.deepEqual(decisionContext(f.w,f.provider),decisionContext(plain,plain.residents.find(r=>r.id===f.provider.id)!));
});

test('emergency meals: missing original lot provenance stays unknown rather than backfilled into evidence',()=>{
 for(const missing of ['definition','lots'] as const){const f=activeEmergencyCare();queueEmergencyCare(f);stepWorld(f.w,19.75);
 if(missing==='definition')for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.definition='missing/food@1';
 else delete f.w.food!.lots['person:'+f.provider.id].meal;
 const r=finishEmergencyCare(f.w,f.provider)[0];assert.equal(r.inputs[0].nutrition,null);if(missing==='lots')assert.equal(r.inputs[0].lots,null);assert.equal(r.hungerRelief,r.hungerBefore-r.hungerAfter);
 }
});

test('emergency meals: establishing an agreement never schedules or pays for an automatic feeding',()=>{
 const f=activeEmergencyCare();const stocks=f.w.residents.map(r=>({...r.inventory}));
 assert.equal(f.c.meals,0);assert.deepEqual(f.c.receipts,[]);assert.equal(f.provider.plan,null);assert.equal(f.provider.activity,null);
 const observation=stepWorldWithFoodEvidence(f.w,30);
 assert.deepEqual(observation.emergencyCareMeals,[]);assert.equal(f.c.status,'active');assert.equal(f.c.meals,0);assert.deepEqual(f.c.receipts,[]);
 assert.deepEqual(f.w.residents.map(r=>r.inventory),stocks);assert.equal(f.provider.inventory.meal,10);assert.equal(f.provider.inventory.water,9);
});

for(const change of ['capacity','guardian','health'] as const)test(`emergency meals: one-off rescue rechecks restored ${change} at completion`,()=>{
 const f=emergencyCareFixture(10,true);queueEmergencyCare(f,'rescueMeal');stepWorld(f.w,19.75);assert.ok(f.provider.activity);
 const before={...f.provider.inventory};
 if(change==='capacity')f.beneficiary.canDecide=true;
 if(change==='guardian'){f.beneficiary.guardianIds=[f.other.id];f.other.at={...f.beneficiary.at};}
 if(change==='health')f.beneficiary.health=40;
 assert.deepEqual(finishEmergencyCare(f.w,f.provider),[]);assert.deepEqual(f.provider.inventory,before);assert.equal(f.w.emergencyCare!.agreements.length,0);
});

test('emergency meals: safe vessel water cannot replace the providers personal water',()=>{
 for(const operation of ['feed','rescueMeal'] as const){const f=operation==='feed'?activeEmergencyCare():emergencyCareFixture(10,true);
 queueEmergencyCare(f,operation);stepWorld(f.w,19.75);f.provider.inventory.water=0;
 const vessel={id:'offline-emergency-bucket',ownerId:f.provider.id,buildingId:null,capacity:6 as const,amount:6,quality:'safe' as const,createdAt:f.w.minute};
 f.w.waterSupply!.vessels.push(vessel);const meal=f.provider.inventory.meal;
 assert.deepEqual(finishEmergencyCare(f.w,f.provider),[]);assert.equal(f.provider.inventory.meal,meal);assert.equal(f.provider.inventory.water,0);assert.equal(vessel.amount,6);
 }
});

test('emergency meals: actual rescue preserves unknown provenance after same-capture initialization or quantity repair',async()=>{
 const {foodTransaction}=await import('../src/world/food.js');
 for(const missing of ['definition','food','lots','short','excess'] as const){const f=emergencyCareFixture(10,true);queueEmergencyCare(f,'rescueMeal');stepWorld(f.w,19.75);
 const key='person:'+f.provider.id;
 if(missing==='definition')for(const lot of f.w.food!.lots[key].meal!)lot.definition='missing/food@1';
 if(missing==='food')delete f.w.food;
 if(missing==='lots')delete f.w.food!.lots[key].meal;
 if(missing==='short')f.w.food!.lots[key].meal![1].quantity=.25;
 if(missing==='excess')f.w.food!.lots[key].meal![1].quantity=19.75;
 const before={...f.provider.inventory},observation=captureDirectEating(f.w,()=>{foodTransaction(f.w,()=>{});stepWorld(f.w,.25);});
 assert.equal(observation.emergencyCareMeals!.length,1);const r=observation.emergencyCareMeals![0];assert.equal(r.operation,'rescueMeal');assert.equal(r.agreementId,null);assert.equal(r.mealNumber,null);
 assert.equal(r.inputs[0].nutrition,null);if(missing==='definition')assert.ok(r.inputs[0].lots!.every(l=>l.nutrition===null));else assert.equal(r.inputs[0].lots,null);
 assert.ok(r.hungerRelief>0);assert.equal(r.hungerRelief,r.hungerBefore-r.hungerAfter);assert.notEqual(r.inputs[0].nutrition,r.hungerRelief);
 assert.equal(f.provider.inventory.meal,before.meal!-1);assert.equal(f.provider.inventory.water,before.water!-1);
 }
});

test('emergency meals: reload preserves second meal numbering and rechecks expiry before finishing it',()=>{
 for(const expired of [false,true]){const f=activeEmergencyCare();queueEmergencyCare(f);assert.equal(finishEmergencyCare(f.w,f.provider)[0].mealNumber,1);
 f.beneficiary.hunger=80;const plan=queueEmergencyCare(f);stepWorld(f.w,19.75);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const loaded=store.load(true)!,provider=loaded.residents.find(r=>r.id===f.provider.id)!,agreement=loaded.emergencyCare!.agreements.find(c=>c.id===f.c.id)!;
 assert.equal(agreement.meals,1);if(expired){loaded.minute=agreement.expiresAt;for(const lot of loaded.food!.lots['person:'+provider.id].meal!)lot.expiresAt=loaded.minute+100;}
 const before={...provider.inventory},rows=finishEmergencyCare(loaded,provider);
 if(expired){assert.deepEqual(rows,[]);assert.equal(agreement.status,'expired');assert.equal(agreement.meals,1);assert.deepEqual(provider.inventory,before);}
 else{assert.equal(rows.length,1);assert.equal(rows[0].agreementId,agreement.id);assert.equal(rows[0].mealNumber,2);assert.equal(rows[0].planId,plan.id);assert.equal(agreement.meals,2);assert.equal(provider.inventory.meal,before.meal!-1);}
 }finally{store.close();}}
});

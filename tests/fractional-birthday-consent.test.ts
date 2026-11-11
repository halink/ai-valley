import assert from 'node:assert/strict';
import {test} from 'node:test';
import {careFixture,careChoice,queueCareAction,finishCareAction} from './helpers/care-meal-evidence.js';
import {longCareChoice,finishLongCare} from './helpers/long-care-meal-evidence.js';
import {runTransport,selectTransport} from './helpers/child-medical-transport-age-consent.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {initializeHealth,addHealthCase} from '../src/world/health.js';
import {longCareReason} from '../src/world/long-care.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

// The child's fractional timestamp is produced by the real birth lifecycle, never rewritten.
function bornFixture(){
 const {w,provider,other:guardian}=careFixture();
 w.residents=[provider,guardian];guardian.at={...provider.at};
 w.minute=121439.751;
 guardian.pregnancy={otherParentId:'synthetic-absent-parent',conceivedAt:w.minute-1000,dueAt:121440.001,definition:w.activeDefinitions['life/family']};
 stepWorld(w,.25);
 const child=w.residents.find(r=>r.parents.includes(guardian.id))!;
 assert.ok(child);assert.equal(child.bornAt,121440.001);assert.equal(guardian.pregnancy,null);
 for(const r of w.residents){r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);r.coins=100;r.health=100;r.hunger=0;}
 const birthday=child.bornAt+6*YEAR;
 w.minute=birthday-DAY;
 stepWorld(w,.25);
 return {w,provider,guardian,child,birthday};
}

for(const finalStep of [.25,1.2])for(const reload of [false,true])test(`fractional real birth: guardian signature ending exactly at six needs personal assent (SQLite ${reload}, step ${finalStep})`,()=>{
 const f=bornFixture();let {w,provider,guardian,child}=f;
 queueCareAction(w,provider,careChoice(w,provider,a=>a.type==='fosterChild'&&a.targetId===child.id));finishCareAction(w,provider);
 assert.ok(child.guardianOffer);
 w.minute=f.birthday-5;
 queueCareAction(w,guardian,careChoice(w,guardian,a=>a.type==='familyConsent'&&a.targetId===child.id&&a.accept));
 stepWorld(w,5-finalStep);assert.equal(w.minute,f.birthday-finalStep);assert.ok(Math.abs(guardian.activity!.remaining-finalStep)<1e-8);
 const store=new WorldStore(':memory:');
 try{
  if(reload){store.commit(w,null);w=store.loadForRuntime()!;provider=w.residents.find(r=>r.id===provider.id)!;guardian=w.residents.find(r=>r.id===guardian.id)!;child=w.residents.find(r=>r.id===child.id)!;}
  stepWorld(w,finalStep);assert.equal(w.minute,f.birthday);assert.equal(child.bornAt,121440.001);
  assert.deepEqual(child.guardianIds,[guardian.id],'birthday completion must not add the volunteer without personal consent');
  assert.ok(child.guardianOffer);assert.equal(child.guardianOffer.childApproved,false);assert.equal(child.canDecide,true);assert.equal(child.canExpress,true);
  // A 1.2 step may leave an IEEE-754 work remainder; completing it must still require the child.
  if(guardian.activity)stepWorld(w,.25);
  assert.deepEqual(child.guardianIds,[guardian.id]);
 }finally{store.close();}
});

for(const finalStep of [.25,1.2])test(`fractional real birth: long-care final ${finalStep} cannot feed or pay on sixth birthday`,()=>{
 const {w,provider,guardian,child,birthday}=bornFixture();
 queueCareAction(w,provider,longCareChoice(w,provider,a=>a.type==='longCare'&&a.operation==='offer'&&a.targetId===child.id&&a.condition==='daily',
  {fee:3,days:2,startsIn:60,startMinute:420,windowMinutes:120,visitsPerDay:1}));finishLongCare(w,provider);
 const c=w.longCare!.agreements.at(-1)!;
 queueCareAction(w,guardian,careChoice(w,guardian,a=>a.type==='longCare'&&a.operation==='accept'&&a.agreementId===c.id));finishLongCare(w,guardian);
 assert.equal(c.status,'active');
 w.minute=birthday-20;child.hunger=80;provider.inventory={meal:10,water:10};
 w.food!.lots['person:'+provider.id]={meal:[{quantity:10,producedAt:w.minute,expiresAt:w.minute+500,definition:'food/life@1'}]};
 assert.equal(longCareReason(w,provider,{type:'longCare',operation:'visit',agreementId:c.id}),null);
 queueCareAction(w,provider,careChoice(w,provider,a=>a.type==='longCare'&&a.operation==='visit'&&a.agreementId===c.id));
 stepWorld(w,20-finalStep);assert.equal(w.minute,birthday-finalStep);assert.ok(Math.abs(provider.activity!.remaining-finalStep)<1e-8);
 const inventory={...provider.inventory},coins=provider.coins;
 const receipts=stepWorldWithFoodEvidence(w,finalStep);
 assert.equal(w.minute,birthday);assert.equal(receipts.longCareMeals!.length,0,'birthday completion must not feed under expired infant authority');
 assert.equal(c.visits.length,0);assert.equal(c.paid,0);assert.deepEqual(provider.inventory,inventory);assert.equal(provider.coins,coins);assert.equal(c.status,'awaitingChild');
});

for(const finalStep of [.25,1.2])test(`fractional real birth: medical pickup final ${finalStep} cannot use infant proxy at six`,()=>{
 const {w,provider,guardian,child,birthday}=bornFixture();
 const clinic={id:'fractional-clinic',kind:'lodge' as const,name:'Synthetic clinic',at:{x:18,y:5},width:4,height:3,door:{x:19,y:8},ownerId:'commons',condition:100,residents:[],capacity:4,definition:'building/lodge@1'};
 w.buildings=[clinic];for(const r of w.residents)r.knownBuildings=[clinic.id];
 provider.inventory={cloth:8,medicine:8,water:30,meal:30};child.health=60;
 initializeHealth(w);addHealthCase(w,child,'injury',30,'Synthetic fractional birthday injury');
 runTransport(w,provider,selectTransport(w,provider,'rescueOffer',child.id));runTransport(w,guardian,selectTransport(w,guardian,'acceptRescue'));
 const offer=w.health!.transportOffers.at(-1)!;assert.equal(offer.status,'accepted');
 w.minute=birthday-15;queueCareAction(w,provider,selectTransport(w,provider,'rescue',child.id));
 stepWorld(w,15-finalStep);assert.equal(w.minute,birthday-finalStep);assert.ok(Math.abs(provider.activity!.remaining-finalStep)<1e-8);
 const stock={...provider.inventory},at={...child.at};
 stepWorld(w,finalStep);assert.equal(w.minute,birthday);
 assert.equal(w.health!.transports.length,0,'birthday pickup must require the child rather than infant proxy');
 assert.deepEqual(provider.inventory,stock);assert.deepEqual(child.at,at);assert.equal(offer.status,'awaitingPatient');assert.equal(offer.personalAcceptedAt,null);
});

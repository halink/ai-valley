import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Plan,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,addHealthCase,healthReason,completeHealth} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {rescueAuthority,passenger,syncMedicalTransport} from '../src/world/medical-transport.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(age=30){
 const w=createWorld(824);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={name:'成年后历史监护医疗转运隔离世界',width:32,height:18,tiles:Array<Tile>(576).fill('grass'),entrance:{x:1,y:8},settlement:{x:8,y:8}};
 const clinic={...w.buildings.find(b=>b.kind==='lodge')!,at:{x:18,y:5},width:4,height:3,door:{x:19,y:8},ownerId:'commons',condition:100,residents:[],capacity:4};w.buildings=[clinic];w.residents=w.residents.slice(0,3);
 const [helper,patient,former]=w.residents;
 for(const r of w.residents)Object.assign(r,{bornAt:w.minute-30*YEAR,lifeStage:'adult',status:'alive',residency:'resident',canDecide:true,canExpress:true,refusesCare:false,at:{x:10,y:8},inside:null,roomAt:null,homeId:null,health:100,energy:100,hunger:0,coins:100,inventory:{cloth:8,medicine:8,water:30,meal:30},knownBuildings:[clinic.id],knownPeople:w.residents.map(p=>p.id),guardianIds:[],plan:null,activity:null,lastFailure:null});
 helper.skills.care=former.skills.care=2;patient.bornAt=w.minute-age*YEAR;patient.lifeStage=age<6?'infant':age<18?'child':'adult';patient.guardianIds=[former.id];patient.canDecide=patient.canExpress=false;patient.health=19;
 initializeHealth(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];assert.equal(w.frontierHazards!.weather!.enabled,false);addHealthCase(w,patient,'injury',30,'隔离历史监护审计伤情');
 return {w,helper,patient,former,clinic};
}
let serial=0;
const plan=(w:World,r:Resident,a:Action):Plan=>({id:'adult-medical:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择有限救助或具体护送',actions:[a]});
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const action=(f:ReturnType<typeof fixture>,operation:HealthAction['operation']='rescue'):HealthAction=>({type:'health',operation,targetId:f.patient.id,...(operation==='stabilize'?{}:{buildingId:f.clinic.id})});
function selected(w:World,r:Resident,operation:HealthAction['operation'],targetId?:string){const choices=menu(w,r),row=choices.find(c=>c.action.type==='health'&&c.action.operation===operation&&(!targetId||c.action.targetId===targetId));assert.ok(row,`${operation} appears through final menu`);return parseChoice(JSON.stringify({choice:row.id}),choices).actions[0] as HealthAction;}
function queue(w:World,r:Resident,a:Action){const result=submitPlan(w,plan(w,r,a));assert.equal(result.ok,true,result.error);}
function finish(w:World,r:Resident){let guard=300;while(r.plan||r.activity){assert.ok(guard--,'actual work progresses');stepWorld(w,1);}}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);assert.equal(r.lastFailure,null);}
function pickup(f:ReturnType<typeof fixture>){queue(f.w,f.helper,selected(f.w,f.helper,'rescue',f.patient.id));let guard=100;while(!passenger(f.w,f.patient.id)&&(f.helper.plan||f.helper.activity)){assert.ok(guard--);stepWorld(f.w,1);}assert.equal(f.helper.lastFailure,null);assert.ok(passenger(f.w,f.patient.id));return passenger(f.w,f.patient.id)!;}
function acceptOwn(f:ReturnType<typeof fixture>){f.patient.canDecide=f.patient.canExpress=true;f.patient.health=60;run(f.w,f.helper,selected(f.w,f.helper,'rescueOffer',f.patient.id));run(f.w,f.patient,selected(f.w,f.patient,'acceptRescue'));return f.w.health!.transportOffers[0];}

test('historical adult guardian does not suppress real rescue or stabilization menus',()=>{
 const f=fixture();for(const actor of [f.helper,f.former])for(const op of ['rescue','stabilize'] as const){assert.equal(healthReason(f.w,actor,action(f,op)),null);selected(f.w,actor,op,f.patient.id);}
 assert.equal(rescueAuthority(f.w,f.helper,f.patient,f.clinic.id)?.basis,'emergency');assert.deepEqual(f.patient.guardianIds,[f.former.id]);
});

test('adult emergency rescue completes actual route and bed delivery with historical guardian present',()=>{
 const f=fixture(),before={...f.helper.inventory},t=pickup(f);assert.equal(t.basis,'emergency');assert.equal(t.offerId,null);assert.equal(f.helper.inventory.cloth,before.cloth!-1);assert.equal(f.helper.inventory.water,before.water!-1);assert.notEqual(f.patient.inside,f.clinic.id);
 finish(f.w,f.helper);assert.equal(t.phase,'delivered',t.reason??'');assert.equal(f.patient.inside,f.clinic.id);assert.equal(f.w.health!.transportOffers.length,0);assert.deepEqual(f.patient.guardianIds,[f.former.id]);assert.equal(f.w.frontierHazards!.weather!.enabled,false);assert.equal(f.w.health!.totals.treated,0);
 const fact=f.w.events.find(e=>e.audit?.rule==='health/transport@1')!;assert.equal(fact.audit?.authority,'emergency');assert.deepEqual(fact.audit?.scope,['transport-to:'+f.clinic.id]);
});

test('adult emergency stabilization consumes only real helper supplies and does not authorize continuing care',()=>{
 const f=fixture(),at={...f.patient.at},inventory={...f.helper.inventory};run(f.w,f.helper,selected(f.w,f.helper,'stabilize',f.patient.id));assert.equal(f.helper.inventory.medicine,inventory.medicine!-1);assert.equal(f.helper.inventory.water,inventory.water!-1);assert.equal(f.helper.inventory.cloth,inventory.cloth);assert.deepEqual(f.patient.at,at);assert.equal(f.w.health!.transports.length,0);assert.equal(f.w.health!.appointments.length,0);assert.equal(f.patient.coins,100);
 const facts=f.w.events.filter(e=>e.audit?.scope.includes('basic-stabilization'));assert.equal(facts.length,1);assert.equal(facts[0].audit?.authority,'emergency');assert.ok(healthReason(f.w,f.helper,action(f,'stabilize')));
});

test('noncritical incapacitated adult cannot receive proxy rescue offers from historical guardians',()=>{
 const f=fixture();f.patient.health=60;for(const actor of [f.helper,f.former]){assert.ok(healthReason(f.w,actor,action(f,'rescueOffer')));assert.ok(completeHealth(f.w,actor,action(f,'rescueOffer')));assert.ok(healthReason(f.w,actor,action(f)));assert.ok(healthReason(f.w,actor,action(f,'stabilize')));}
 assert.equal(menu(f.w,f.helper).some(c=>c.action.type==='health'&&['rescueOffer','rescue','stabilize'].includes(c.action.operation)&&c.action.targetId===f.patient.id),false);assert.equal(f.w.health!.transportOffers.length,0);
});

for(const age of [5,17,18,65])test(`real age ${age} sets the current guardian emergency boundary`,()=>{
 const f=fixture(age);assert.equal(rescueAuthority(f.w,f.helper,f.patient,f.clinic.id)?.basis,age<18?undefined:'emergency');assert.equal(rescueAuthority(f.w,f.former,f.patient,f.clinic.id)?.basis,age<6?'guardian':age<18?undefined:'emergency');
 if(age<18){f.former.at={x:1,y:16};assert.equal(rescueAuthority(f.w,f.helper,f.patient,f.clinic.id)?.basis,'emergency');}
});

for(const reason of ['capable','refused','noncritical','unskilled','no-water','no-medicine','absent'] as const)test(`historical guardian does not bypass ${reason} stabilization boundary`,()=>{
 const f=fixture();if(reason==='capable')f.patient.canDecide=f.patient.canExpress=true;if(reason==='refused')f.patient.refusesCare=true;if(reason==='noncritical')f.patient.health=21;if(reason==='unskilled')f.helper.skills.care=0;if(reason==='no-water')f.helper.inventory.water=0;if(reason==='no-medicine')f.helper.inventory.medicine=0;if(reason==='absent')f.helper.at={x:1,y:17};
 const before={...f.helper.inventory},a=action(f,'stabilize');assert.ok(healthReason(f.w,f.helper,a));assert.ok(completeHealth(f.w,f.helper,a));assert.deepEqual(f.helper.inventory,before);
});

test('adult own offer is accepted only by the adult and does not permit historical guardian cancellation',()=>{
 const f=fixture(),offer=acceptOwn(f);assert.equal(offer.respondentId,f.patient.id);assert.ok(healthReason(f.w,f.former,{type:'health',operation:'acceptRescue',offerId:offer.id}));const t=pickup(f),at={...f.patient.at};assert.equal(t.basis,'consent');assert.equal(t.offerId,offer.id);
 const cancel:HealthAction={type:'health',operation:'cancelRescue',transportId:t.id};assert.ok(healthReason(f.w,f.former,cancel));assert.ok(planStartError(f.w,plan(f.w,f.former,cancel)));assert.ok(completeHealth(f.w,f.former,cancel));assert.equal(t.phase,'carrying');assert.deepEqual(f.patient.at,at);
 run(f.w,f.patient,selected(f.w,f.patient,'cancelRescue'));assert.equal(t.phase,'interrupted');assert.equal(offer.status,'cancelled');assert.equal(passenger(f.w,f.patient.id),undefined);
});

test('minor guardian proxy remains usable but offered or accepted proxy consent expires as authority at adulthood',()=>{
 for(const accepted of [false,true]){const f=fixture(17);f.patient.health=60;run(f.w,f.helper,selected(f.w,f.helper,'rescueOffer',f.patient.id));const offer=f.w.health!.transportOffers[0];assert.equal(offer.respondentId,f.former.id);if(accepted)run(f.w,f.former,selected(f.w,f.former,'acceptRescue'));
  f.patient.bornAt=f.w.minute-18*YEAR;f.patient.lifeStage='adult';assert.deepEqual(f.patient.guardianIds,[f.former.id]);if(!accepted){assert.ok(healthReason(f.w,f.former,{type:'health',operation:'acceptRescue',offerId:offer.id}));assert.ok(completeHealth(f.w,f.former,{type:'health',operation:'acceptRescue',offerId:offer.id}));}
  assert.equal(rescueAuthority(f.w,f.helper,f.patient,f.clinic.id),null);assert.ok(healthReason(f.w,f.helper,action(f)));assert.equal(menu(f.w,f.helper).some(c=>c.action.type==='health'&&c.action.operation==='rescue'&&c.action.targetId===f.patient.id),false);
  f.patient.health=19;assert.equal(rescueAuthority(f.w,f.helper,f.patient,f.clinic.id)?.basis,'emergency');
 }
});

test('proxy-authorized transport cannot keep moving when the noncritical patient becomes an adult',()=>{
 const f=fixture(17);f.patient.health=60;run(f.w,f.helper,selected(f.w,f.helper,'rescueOffer',f.patient.id));run(f.w,f.former,selected(f.w,f.former,'acceptRescue'));const t=pickup(f),at={...f.patient.at};f.patient.bornAt=f.w.minute-18*YEAR;f.patient.lifeStage='adult';syncMedicalTransport(f.w);assert.equal(t.phase,'interrupted');assert.deepEqual(f.patient.at,at);assert.equal(f.helper.activity,null);
});

for(const change of ['refusal','recovery','noncritical','guardian-arrival'] as const)test(`actual emergency transport rechecks ${change} before another step`,()=>{
 const f=fixture();f.patient.guardianIds=[];const t=pickup(f),at={...f.patient.at};f.patient.guardianIds=[f.former.id];f.former.at={...f.patient.at};
 if(change==='refusal')f.patient.refusesCare=true;if(change==='recovery')f.patient.canDecide=f.patient.canExpress=true;if(change==='noncritical'){f.patient.health=21;f.w.health!.cases[0].stage='acute';}syncMedicalTransport(f.w);assert.equal(t.phase,change==='guardian-arrival'?'carrying':'interrupted');assert.deepEqual(f.patient.at,at);
});

test('memory-only reload preserves historical guardian evidence without restoring proxy consent',()=>{
 const f=fixture(),t=pickup(f),store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,helper=w.residents.find(p=>p.id===f.helper.id)!,patient=w.residents.find(p=>p.id===f.patient.id)!;assert.deepEqual(patient.guardianIds,[f.former.id]);finish(w,helper);assert.equal(w.health!.transports.find(x=>x.id===t.id)!.phase,'delivered');assert.equal(w.health!.transportOffers.length,0);assert.equal(w.frontierHazards!.weather!.enabled,false);}finally{store.close();}
});

test('final menu parsing cannot inject consent, target or guardian authority',()=>{
 const f=fixture(),choices=menu(f.w,f.helper),row=choices.find(c=>c.action.type==='health'&&c.action.operation==='rescue'&&c.action.targetId===f.patient.id);assert.ok(row);for(const extra of [{basis:'guardian'},{respondentId:f.former.id},{offerId:'invented'},{targetId:f.helper.id},{guardianIds:[f.helper.id]}])assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,...extra}),choices));
});

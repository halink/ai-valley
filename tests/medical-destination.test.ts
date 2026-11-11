import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,addHealthCase,healthReason,completeHealth,advanceHealth} from '../src/world/health.js';
import {passenger} from '../src/world/medical-transport.js';
import {initializeFrontierHazards,usableFrontierShelter} from '../src/world/frontier-hazards.js';
import {stepWorld,submitPlan,planStartError} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {HealthAction} from '../src/shared/health.js';
import type {FrontierDisaster} from '../src/shared/frontier-hazards.js';
import type {Building,Resident,Tile,World} from '../src/shared/types.js';

function fixture(remote=false){
 const w=createWorld();w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={width:48,height:20,tiles:Array<Tile>(960).fill('grass'),name:'医疗目的地隔离回归',entrance:{x:1,y:8},settlement:{x:24,y:10}};
 const clinic:Building={...w.buildings.find(b=>b.kind==='lodge')!,kind:'lodge' as const,at:{x:remote?34:12,y:4},width:4,height:3,door:{x:remote?35:13,y:7},ownerId:'commons',condition:100,residents:[],capacity:4};w.buildings=[clinic];w.residents=w.residents.slice(0,3);
 const [doctor,patient,other]=w.residents;
 for(const r of w.residents){r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.canDecide=r.canExpress=true;r.at={x:10,y:7};r.inside=null;r.roomAt=null;r.homeId=null;r.health=r.energy=100;r.hunger=0;r.coins=100;r.inventory={cloth:8,meal:30,water:30,medicine:8};r.knownBuildings=[clinic.id];r.knownPeople=w.residents.map(p=>p.id);r.skills.care=2;r.guardianIds=[];r.plan=null;r.activity=null;}
 other.at={x:1,y:18};patient.bornAt=w.minute-2*YEAR;patient.guardianIds=[doctor.id];patient.canDecide=patient.canExpress=false;patient.health=44;
 initializeHealth(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];addHealthCase(w,patient,'injury',25,'隔离照护审计损伤');
 return {w,doctor,patient,clinic,other};
}
function hazard(f:ReturnType<typeof fixture>,overrides:Partial<FrontierDisaster>={}){
 const d:FrontierDisaster={id:'medical-risk:'+f.w.frontierHazards!.disasters.length,kind:'flashFlood',at:{...f.clinic.door},radius:8,phase:'active',warningAt:f.w.minute-10,startsAt:f.w.minute-5,endsAt:f.w.minute+1000,intensity:4,warned:f.w.residents.map(r=>r.id),exposure:{},...overrides};f.w.frontierHazards!.disasters.push(d);return d;
}
function action(f:ReturnType<typeof fixture>,operation:HealthAction['operation']='rescue'):HealthAction{return {type:'health',operation,targetId:f.patient.id,buildingId:f.clinic.id};}
function plan(w:World,r:Resident,a:HealthAction){return {id:`medical-safe:${w.revision}:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择具体医疗安排',actions:[a]};}
function queue(w:World,r:Resident,a:HealthAction){const result=submitPlan(w,plan(w,r,a));assert.equal(result.ok,true,result.error);}
function chosen(f:ReturnType<typeof fixture>,operation:HealthAction['operation']='rescue'){
 const menu=decisionChoices(decisionContext(f.w,f.doctor));const c=menu.find(c=>c.action.type==='health'&&c.action.operation===operation&&c.action.buildingId===f.clinic.id);assert.ok(c,operation+' appears through normal final menu');return parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction;
}
function until(w:World,predicate:()=>boolean){let guard=300;while(!predicate()){assert.ok(guard--,'actual action must make progress');stepWorld(w,1);}}
function pickup(f:ReturnType<typeof fixture>){queue(f.w,f.doctor,chosen(f));until(f.w,()=>!!passenger(f.w,f.patient.id)||!!f.doctor.lastFailure);assert.equal(f.doctor.lastFailure,null);return passenger(f.w,f.patient.id)!;}

// This is the original audit failure: real rescue used to deliver into a place
// that the existing shelter rule rejects, while the child accumulated flood harm.
test('normal rescue menu and start reject the same active flooded hall as shelter',()=>{
 const f=fixture(),d=hazard(f);assert.equal(usableFrontierShelter(f.w,f.doctor,f.clinic,d.id),false);
 assert.equal(healthOpportunities(f.w,f.doctor).some(c=>c.action.type==='health'&&c.action.operation==='rescue'&&c.action.buildingId===f.clinic.id),false);
 assert.ok(planStartError(f.w,plan(f.w,f.doctor,action(f))));const supplies={...f.doctor.inventory};queue(f.w,f.doctor,action(f));stepWorld(f.w,70);
 assert.equal(f.w.health!.transports.length,0);assert.deepEqual(f.doctor.inventory,supplies);assert.equal(f.patient.inside,null);assert.equal(f.w.frontierHazards!.weather!.enabled,false);
});

test('stale normal rescue selection is rechecked before pickup and never spends supplies',()=>{
 const f=fixture(),a=chosen(f);hazard(f,{phase:'warning',startsAt:f.w.minute+100});const at={...f.patient.at},supplies={...f.doctor.inventory};queue(f.w,f.doctor,a);stepWorld(f.w,1);
 assert.ok(f.doctor.lastFailure);assert.deepEqual(f.patient.at,at);assert.deepEqual(f.doctor.inventory,supplies);assert.equal(f.w.health!.transports.length,0);
});

test('dynamic flood during real transport interrupts before another step, including after SQLite reload',()=>{
 const f=fixture(true),t=pickup(f);until(f.w,()=>f.clinic.door.x-f.doctor.at.x<=8);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,doctor=w.residents.find(r=>r.id===f.doctor.id)!,patient=w.residents.find(r=>r.id===f.patient.id)!,clinic=w.buildings[0],loaded={...f,w,doctor,patient,clinic};
  const before={...patient.at},inventory={...doctor.inventory};hazard(loaded,{footprint:[{...clinic.door}]});stepWorld(w,1);
  assert.equal(w.health!.transports.find(x=>x.id===t.id)!.phase,'interrupted');assert.deepEqual(patient.at,before);assert.deepEqual(doctor.at,before);assert.deepEqual(doctor.inventory,inventory);assert.equal(passenger(w,patient.id),undefined);assert.equal(patient.inside,null);
 }finally{store.close();}
});

test('unobserved distant flood does not act as a menu oracle or disclose its hazard record',()=>{
 const f=fixture(true),before=healthOpportunities(f.w,f.doctor);assert.ok(before.some(c=>c.action.type==='health'&&c.action.operation==='rescue'));
 hazard(f,{radius:2});assert.deepEqual(healthOpportunities(f.w,f.doctor),before);
 assert.equal(f.doctor.knownBuildings.length,1);assert.equal(f.doctor.memories.some(m=>m.text?.includes('medical-risk:')),false);
});

test('an unknown distant risk is discovered on approach, never delivered or silently rerouted',()=>{
 const f=fixture(true),a=chosen(f);hazard(f,{radius:2});queue(f.w,f.doctor,a);until(f.w,()=>!!f.doctor.lastFailure||f.w.health!.transports.some(t=>t.phase!=='carrying'));
 const t=f.w.health!.transports[0];assert.ok(t,'remote knowledge must not block the initial authorized pickup');assert.equal(t.phase,'interrupted');assert.equal(f.patient.inside,null);assert.deepEqual(f.patient.at,f.doctor.at);assert.notDeepEqual(f.patient.at,f.clinic.door);assert.equal(f.w.events.some(e=>e.text.includes('送入')&&e.actors.includes(f.patient.id)),false);
});

test('safe destination still completes actual rescue and preserves clear-weather condition compatibility',()=>{
 for(const condition of [100,34,1]){const f=fixture();f.clinic.condition=condition;const t=pickup(f);until(f.w,()=>t.phase!=='carrying');assert.equal(t.phase,'delivered',t.reason??'');assert.equal(f.patient.inside,f.clinic.id);assert.equal(f.doctor.inventory.cloth,7);}
});

test('footprint, legacy flood core, overlapping warning and wind protection use actual geometry',()=>{
 const f=fixture();const d=hazard(f,{footprint:[{...f.clinic.door}],at:{x:25,y:7},radius:30});assert.ok(healthReason(f.w,f.doctor,action(f)));
 d.footprint=[{x:14,y:7}];assert.equal(healthReason(f.w,f.doctor,action(f)),null,'dry door inside broad radius remains safe');
 d.phase='ended';hazard(f,{phase:'warning',startsAt:f.w.minute+100,footprint:[{...f.clinic.door}]});assert.ok(healthReason(f.w,f.doctor,action(f)));
 f.w.frontierHazards!.disasters=[];hazard(f,{kind:'windstorm'});f.clinic.condition=34;assert.ok(healthReason(f.w,f.doctor,action(f)));f.clinic.condition=35;assert.equal(healthReason(f.w,f.doctor,action(f)),null);
});

test('appointment proposals, acceptance and attendance cannot designate a known unsafe clinic',()=>{
 const f=fixture();f.patient.bornAt=f.w.minute-30*YEAR;f.patient.canDecide=f.patient.canExpress=true;
 const a:HealthAction={...action(f,'offer'),startsIn:60,fee:5};assert.equal(completeHealth(f.w,f.doctor,a),null);const c=f.w.health!.appointments[0];hazard(f);
 assert.ok(healthReason(f.w,f.doctor,a));assert.ok(healthReason(f.w,f.patient,{type:'health',operation:'accept',appointmentId:c.id}));
 f.w.frontierHazards!.disasters=[];assert.equal(completeHealth(f.w,f.patient,{type:'health',operation:'accept',appointmentId:c.id}),null);hazard(f);
 assert.ok(healthReason(f.w,f.doctor,{type:'health',operation:'treat',appointmentId:c.id,minutes:30}));assert.ok(healthReason(f.w,f.patient,{type:'health',operation:'receive',appointmentId:c.id,minutes:30}));advanceHealth(f.w,1);assert.equal(c.status,'cancelled');assert.equal(c.worked,0);assert.equal(c.paid,0);assert.equal(c.refunded,5);
});

test('seeing a flood origin does not reveal hidden changes to a distant destination footprint',()=>{
 const f=fixture(true),d=hazard(f,{at:{...f.doctor.at},radius:40,footprint:[{...f.doctor.at}]});const before=healthOpportunities(f.w,f.doctor);
 assert.ok(before.some(c=>c.action.type==='health'&&c.action.operation==='rescue'));
 d.footprint!.push({...f.clinic.door});assert.deepEqual(healthOpportunities(f.w,f.doctor),before);
 d.kind='windstorm';d.footprint=undefined;f.clinic.condition=34;assert.deepEqual(healthOpportunities(f.w,f.doctor),before,'unseen roof damage is not a live storm oracle');
});

test('flood revealed by the first road step stops before the second step in one tick',()=>{
 const f=fixture(true),t=pickup(f);until(f.w,()=>f.clinic.door.x-f.doctor.at.x===9);assert.equal(f.doctor.at.y,f.clinic.door.y);
 hazard(f,{radius:2});const before={...f.doctor.at};for(let x=before.x+1;x<=before.x+2;x++)f.w.map.tiles[before.y*f.w.map.width+x]='road';f.doctor.activity!.travelProgress=.9;
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.doctor.at,{x:before.x+1,y:before.y});assert.deepEqual(f.patient.at,f.doctor.at);
});

test('actual bed arrival is not early completion, and a new flood cannot become delivered',()=>{
 const f=fixture(),t=pickup(f);until(f.w,()=>f.doctor.inside===f.clinic.id&&!f.doctor.activity?.room?.path.length);assert.ok(f.doctor.activity!.remaining>0);
 const a=f.doctor.activity!.action as HealthAction;assert.ok(completeHealth(f.w,f.doctor,a));assert.equal(t.phase,'carrying');
 hazard(f,{footprint:[{...f.clinic.door}]});f.doctor.activity!.remaining=0;
 assert.ok(completeHealth(f.w,f.doctor,a));assert.equal(t.phase,'carrying');const at={...f.patient.at},room={...f.patient.roomAt!};stepWorld(f.w,1);
 assert.equal(t.phase,'interrupted');assert.deepEqual(f.patient.at,at);assert.deepEqual(f.patient.roomAt,room);assert.equal(f.w.events.some(e=>e.text.includes('送入')&&e.actors.includes(f.patient.id)),false);
});

test('a changed unsafe rescue offer can be declined but never accepted as transport permission',()=>{
 const f=fixture();f.patient.bornAt=f.w.minute-30*YEAR;f.patient.canDecide=f.patient.canExpress=true;
 assert.equal(completeHealth(f.w,f.doctor,action(f,'rescueOffer')),null);const offer=f.w.health!.transportOffers[0];hazard(f);
 const accept:HealthAction={type:'health',operation:'acceptRescue',offerId:offer.id};assert.ok(healthReason(f.w,f.patient,accept));assert.ok(completeHealth(f.w,f.patient,accept));assert.equal(offer.status,'offered');
 assert.equal(completeHealth(f.w,f.patient,{type:'health',operation:'declineRescue',offerId:offer.id}),null);assert.equal(offer.status,'declined');assert.equal(f.w.health!.transports.length,0);
});

test('ending the actual flood restores a normal rescue without enabling weather or fabricating care',()=>{
 const f=fixture(),d=hazard(f);assert.ok(healthReason(f.w,f.doctor,action(f)));d.phase='ended';const health=f.patient.health,t=pickup(f);until(f.w,()=>t.phase!=='carrying');
 assert.equal(t.phase,'delivered');assert.equal(f.patient.health,health);assert.equal(f.w.health!.totals.treated,0);assert.equal(f.w.frontierHazards!.weather!.enabled,false);
});

test('appointment travel stops at the true position before entering a newly unsafe clinic',()=>{
 const f=fixture(true);f.patient.bornAt=f.w.minute-30*YEAR;f.patient.canDecide=f.patient.canExpress=true;
 assert.equal(completeHealth(f.w,f.doctor,{...action(f,'offer'),startsIn:60,fee:5}),null);const c=f.w.health!.appointments[0];assert.equal(completeHealth(f.w,f.patient,{type:'health',operation:'accept',appointmentId:c.id}),null);
 queue(f.w,f.doctor,{type:'health',operation:'treat',appointmentId:c.id,minutes:30});until(f.w,()=>f.clinic.door.x-f.doctor.at.x===8);const at={...f.doctor.at};hazard(f,{footprint:[{...f.clinic.door}]});stepWorld(f.w,1);
 assert.deepEqual(f.doctor.at,at);assert.equal(f.doctor.inside,null);assert.ok(f.doctor.lastFailure);assert.equal(c.status,'cancelled');assert.equal(c.worked,0);assert.equal(c.paid,0);assert.equal(c.refunded,5);assert.equal(f.doctor.inventory.medicine,8);assert.equal(f.doctor.inventory.water,30);
 advanceHealth(f.w,1);assert.equal(c.refunded,5);assert.equal(f.doctor.inventory.medicine,8);
});

test('doctor-owned clinic grants only the agreed medical visit and never another provider title',()=>{
 const f=fixture();f.clinic.ownerId=f.doctor.id;f.patient.bornAt=f.w.minute-30*YEAR;f.patient.canDecide=f.patient.canExpress=true;f.patient.knownBuildings=[];
 const proposal={...action(f,'offer'),startsIn:60,fee:0};assert.equal(completeHealth(f.w,f.doctor,proposal),null);const c=f.w.health!.appointments[0];assert.equal(completeHealth(f.w,f.patient,{type:'health',operation:'accept',appointmentId:c.id}),null);
 assert.ok(f.patient.knownBuildings.includes(f.clinic.id));assert.equal(healthReason(f.w,f.patient,{type:'health',operation:'receive',appointmentId:c.id,minutes:30}),null);
 f.clinic.ownerId=f.other.id;assert.ok(healthReason(f.w,f.doctor,{type:'health',operation:'treat',appointmentId:c.id,minutes:30}));assert.ok(healthReason(f.w,f.patient,{type:'health',operation:'receive',appointmentId:c.id,minutes:30}));advanceHealth(f.w,1);assert.equal(c.status,'cancelled');
});

test('early land pickup cannot skip actual preparation time or spend supplies twice',()=>{
 const f=fixture();queue(f.w,f.doctor,chosen(f));stepWorld(f.w,1);const a=f.doctor.activity!.action as HealthAction,supplies={...f.doctor.inventory};assert.ok(f.doctor.activity!.remaining>0);
 assert.ok(completeHealth(f.w,f.doctor,a));assert.deepEqual(f.doctor.inventory,supplies);assert.equal(f.w.health!.transports.length,0);
 until(f.w,()=>!!passenger(f.w,f.patient.id));const t=passenger(f.w,f.patient.id)!;until(f.w,()=>t.phase!=='carrying');assert.equal(t.phase,'delivered');assert.equal(f.doctor.inventory.cloth,7);assert.equal(f.doctor.inventory.water,29);assert.ok(completeHealth(f.w,f.doctor,a));assert.equal(f.doctor.inventory.cloth,7);
});

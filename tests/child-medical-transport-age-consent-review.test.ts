import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeInfrastructure} from '../src/world/infrastructure.js';
import {initializeFerries,aboardFerry} from '../src/world/ferry.js';
import {totalCoins} from '../src/world/economy.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason,addHealthCase} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {rescueAuthority,passenger,syncMedicalTransport,completeTransport} from '../src/world/medical-transport.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {World,Resident,Action,Tile} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';

// Independent synthetic world; no saved fixtures, runtime files or model calls.
function scene(age=30){
 const w=createWorld(9217);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={name:'Independent medical review',width:28,height:14,tiles:Array<Tile>(392).fill('grass'),entrance:{x:1,y:9},settlement:{x:8,y:6}};
 const ward={...w.buildings.find(b=>b.kind==='lodge')!,at:{x:17,y:3},door:{x:18,y:6},width:4,height:3,ownerId:'commons',condition:100,residents:[],capacity:4};w.buildings=[ward];w.residents=w.residents.slice(0,3);
 const [rescuer,patient,relative]=w.residents;
 for(const r of w.residents)Object.assign(r,{bornAt:w.minute-35*YEAR,lifeStage:'adult',status:'alive',residency:'resident',canDecide:true,canExpress:true,refusesCare:false,at:{x:9,y:6},inside:null,roomAt:null,homeId:null,health:100,energy:100,hunger:0,coins:50,inventory:{cloth:6,water:30,medicine:6,meal:30},knownBuildings:[ward.id],knownPeople:w.residents.map(p=>p.id),guardianIds:[],plan:null,activity:null,lastFailure:null});
 rescuer.skills.care=2;patient.bornAt=w.minute-age*YEAR;patient.guardianIds=[relative.id];patient.health=19;patient.canDecide=patient.canExpress=false;
 initializeHealth(w);addHealthCase(w,patient,'injury',30,'Independent review injury');initializeFrontierHazards(w);w.frontierHazards!.beasts=[];assert.equal(w.frontierHazards!.weather!.enabled,false);
 return {w,rescuer,patient,relative,ward};
}
function choices(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
function choose(w:World,r:Resident,op:HealthAction['operation']){const menu=choices(w,r),row=menu.find(c=>c.action.type==='health'&&c.action.operation===op);assert.ok(row,op);return parseChoice(JSON.stringify({choice:row.id}),menu).actions[0];}
function queue(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`review:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Independent finite medical review',actions:[a]});assert.ok(result.ok,result.error);}
function finish(w:World,r:Resident){let n=250;while(r.plan||r.activity){assert.ok(n--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);}
function start(f:ReturnType<typeof scene>){queue(f.w,f.rescuer,choose(f.w,f.rescuer,'rescue'));let n=100;while(!passenger(f.w,f.patient.id)){assert.ok(n--,f.rescuer.lastFailure??'pickup');stepWorld(f.w,1);}return passenger(f.w,f.patient.id)!;}
function rescue(f:ReturnType<typeof scene>):HealthAction{return {type:'health',operation:'rescue',targetId:f.patient.id,buildingId:f.ward.id};}


function birthdayScene(){
 const f=scene(5);f.patient.health=75;f.patient.lifeStage='infant';
 f.patient.bornAt=f.w.minute+100-6*YEAR;
 run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));
 const o=f.w.health!.transportOffers[0];run(f.w,f.relative,choose(f.w,f.relative,'acceptRescue'));
 return {...f,o,birthday:f.patient.bornAt+6*YEAR};
}
function birthday(f:ReturnType<typeof birthdayScene>){f.w.minute=f.birthday;f.patient.canDecide=f.patient.canExpress=true;f.patient.lifeStage='child';}

test('child transport review: direct completion before normalization rejects birthday proxy without spending',()=>{
 const f=birthdayScene();birthday(f);const stock={...f.rescuer.inventory},at={...f.patient.at};
 assert.equal(f.o.status,'accepted');assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);
 assert.ok(completeTransport(f.w,f.rescuer,rescue(f)));assert.deepEqual(f.rescuer.inventory,stock);assert.deepEqual(f.patient.at,at);assert.equal(f.w.health!.transports.length,0);
 const before=JSON.stringify(f.o);choose(f.w,f.patient,'acceptRescue');choose(f.w,f.patient,'declineRescue');assert.equal(JSON.stringify(f.o),before,'menu is read-only');
});

test('child transport review: original offer is independently accepted once without extending deadline',()=>{
 const f=birthdayScene(),original={id:f.o.id,createdAt:f.o.createdAt,expiresAt:f.o.expiresAt,respondentId:f.o.respondentId};birthday(f);syncMedicalTransport(f.w);
 assert.equal(f.o.status,'awaitingPatient');assert.ok(healthReason(f.w,f.relative,{type:'health',operation:'acceptRescue',offerId:f.o.id}));
 run(f.w,f.patient,choose(f.w,f.patient,'acceptRescue'));assert.equal(f.o.personalAcceptedAt,f.w.minute);assert.equal(f.o.status,'accepted');
 assert.deepEqual({id:f.o.id,createdAt:f.o.createdAt,expiresAt:f.o.expiresAt,respondentId:f.o.respondentId},original);
 const t=start(f);finish(f.w,f.rescuer);assert.equal(t.phase,'delivered');assert.equal(f.w.health!.transportOffers.length,1);
});

test('child transport review: own refusal cannot be overwritten by guardian or subsequent incapacity',()=>{
 const f=birthdayScene();birthday(f);queue(f.w,f.patient,choose(f.w,f.patient,'declineRescue'));assert.equal(f.o.status,'declined');
 f.patient.canDecide=f.patient.canExpress=false;syncMedicalTransport(f.w);
 assert.ok(completeTransport(f.w,f.relative,{type:'health',operation:'acceptRescue',offerId:f.o.id}));assert.equal(f.o.status,'declined');assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);
});

test('child transport review: birthday while already carried interrupts before next position change',()=>{
 const f=birthdayScene(),t=start(f),stock={...f.rescuer.inventory};birthday(f);const at={...f.patient.at};stepWorld(f.w,1);
 assert.equal(t.phase,'interrupted');assert.deepEqual(f.patient.at,at);assert.deepEqual(f.rescuer.inventory,stock);assert.equal(f.rescuer.activity,null);assert.equal(f.o.status,'awaitingPatient');
});

test('child transport review: final bed work cannot complete on the birthday',()=>{
 const f=birthdayScene(),t=start(f);let guard=150;
 while(!(f.rescuer.inside===f.ward.id&&f.rescuer.activity?.path.length===0&&!f.rescuer.activity?.room?.path.length&&f.rescuer.activity.remaining<=1)){assert.ok(guard--);stepWorld(f.w,.25);assert.equal(t.phase,'carrying');}
 birthday(f);const pos=structuredClone({at:f.patient.at,inside:f.patient.inside,roomAt:f.patient.roomAt}),stock={...f.rescuer.inventory};stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted');assert.deepEqual({at:f.patient.at,inside:f.patient.inside,roomAt:f.patient.roomAt},pos);assert.deepEqual(f.rescuer.inventory,stock);assert.equal(t.arrivalEventId,undefined);
});

test('child transport review: express-only patient can stop immediately but cannot accept or move',()=>{
 const f=birthdayScene(),t=start(f);f.patient.canDecide=false;f.patient.canExpress=true;const at={...f.patient.at},minute=f.w.minute;
 const menu=choices(f.w,f.patient);assert.equal(menu.some(c=>c.action.type==='health'&&c.action.operation==='acceptRescue'),false);
 queue(f.w,f.patient,choose(f.w,f.patient,'cancelRescue'));assert.equal(t.phase,'interrupted');assert.equal(f.w.minute,minute);assert.deepEqual(f.patient.at,at);assert.equal(f.rescuer.activity,null);
});

for(const corruption of ['missingRespondent','missingCreated','invalidPersonal','underSixPersonal','futurePersonal'] as const)test(`child transport review: two SQLite reloads cannot manufacture consent (${corruption})`,()=>{
 const f=birthdayScene();birthday(f);
 if(corruption==='missingRespondent')Reflect.deleteProperty(f.o,'respondentId');
 if(corruption==='missingCreated')Reflect.deleteProperty(f.o,'createdAt');
 if(corruption==='invalidPersonal')f.o.personalAcceptedAt=null;
 if(corruption==='underSixPersonal')f.o.personalAcceptedAt=f.birthday-1;
 if(corruption==='futurePersonal')f.o.personalAcceptedAt=f.w.minute+1;
 const store=new WorldStore(':memory:');try{let w=f.w;for(let i=0;i<2;i++){store.commit(w,i===0?null:w.revision);w=store.load()!;const p=w.residents.find(r=>r.id===f.patient.id)!,r=w.residents.find(r=>r.id===f.rescuer.id)!;assert.equal(rescueAuthority(w,r,p,f.ward.id),null);syncMedicalTransport(w);assert.notEqual(w.health!.transportOffers[0].status,'accepted');assert.equal(w.health!.transports.length,0);}}finally{store.close();}
});

test('child transport review: incapacity does not renew infant proxy, emergency criteria stay independent',()=>{
 const f=birthdayScene();f.w.minute=f.birthday;syncMedicalTransport(f.w);assert.equal(f.o.status,'awaitingPatient');assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);
 f.patient.health=19;assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null,'timely guardian blocks emergency');f.relative.at={x:1,y:12};assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id)?.basis,'emergency');
 f.patient.refusesCare=true;assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);
});

test('child transport review: unchanged expiry closes awaiting offer without new work or supplies',()=>{
 const f=birthdayScene();birthday(f);syncMedicalTransport(f.w);const stock={...f.rescuer.inventory};f.w.minute=f.o.expiresAt;syncMedicalTransport(f.w);assert.equal(f.o.status,'expired');assert.ok(completeTransport(f.w,f.patient,{type:'health',operation:'acceptRescue',offerId:f.o.id}));assert.deepEqual(f.rescuer.inventory,stock);assert.equal(f.w.health!.transports.length,0);
});
function dockScene(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={width:32,height:16,tiles:Array<Tile>(512).fill('grass'),name:'隔离靠泊救援',entrance:{x:1,y:6}};
 for(let y=5;y<=7;y++)for(let x=7;x<=21;x++)w.map.tiles[y*32+x]='water';
 const clinic={...w.buildings.find(b=>b.kind==='lodge')!,kind:'clinic' as const,at:{x:1,y:1},width:4,height:3,door:{x:3,y:4},ownerId:'commons',condition:100,residents:[]};w.buildings=[clinic];
 initializeInfrastructure(w);initializeFerries(w);initializeHealth(w);
 const docks=[6,22].map((x,i)=>({id:'rescue-dock-'+i,name:i?'东码头':'西码头',projectId:'fixture-'+i,kind:'dock' as const,definition:'infrastructure/dock@1',at:{x,y:6},width:1,height:1,access:{x:x+(i?1:-1),y:6},anchors:[{x:x+(i?1:-1),y:6}],tiles:[{at:{x,y:6},before:'water' as const,after:'bridge' as const}],graveIds:[],condition:100,lastDay:0,createdAt:w.minute,retiredAt:null,cost:{wood:6,stone:2},minutes:90}));
 for(const d of docks){w.map.tiles[d.at.y*32+d.at.x]='bridge';w.infrastructure!.assets.push(d);}
 const [captain,patient,doctor]=w.residents;
 for(const r of w.residents){r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.canDecide=r.canExpress=true;r.at={...docks[0].at};r.inside=null;r.roomAt=null;r.health=r.energy=100;r.hunger=0;r.coins=100;r.inventory={wood:8,plank:12,cloth:8,bar:2,meal:30,water:30,medicine:8};r.knownDocks=docks.map(d=>d.id);r.knownBuildings=[clinic.id];r.knownPeople=w.residents.map(p=>p.id);r.skills.care=2;r.guardianIds=[];r.plan=null;r.activity=null;}
 run(w,captain,{type:'ferry',operation:'build',dockId:docks[0].id,minutes:120});run(w,captain,{type:'ferry',operation:'build',dockId:docks[0].id,minutes:60});
 const boat=w.ferries!.boats[0];run(w,captain,{type:'ferry',operation:'post',boatId:boat.id,destinationId:docks[1].id,fare:7,departIn:120});const trip=w.ferries!.trips[0];
 run(w,patient,{type:'ferry',operation:'reserve',tripId:trip.id});run(w,patient,{type:'ferry',operation:'board',tripId:trip.id});
 doctor.at={x:4,y:6};return {w,captain,patient,doctor,clinic,docks,boat,trip};
}

for(const change of ['birthday','departed'] as const)test(`child transport review: real dock pickup final minute rechecks ${change}`,()=>{
 const f=dockScene(),{w,patient,doctor,captain,clinic,trip}=f;
 patient.bornAt=w.minute+100-6*YEAR;patient.lifeStage='infant';patient.canDecide=false;patient.canExpress=true;patient.guardianIds=[captain.id];patient.health=75;addHealthCase(w,patient,'injury',30,'Synthetic dock birthday review');
 run(w,doctor,choose(w,doctor,'rescueOffer'));run(w,captain,choose(w,captain,'acceptRescue'));const o=w.health!.transportOffers.at(-1)!;
 queue(w,doctor,choose(w,doctor,'rescue'));let guard=100;while(!doctor.activity||doctor.activity.path.length||doctor.activity.remaining>1){assert.ok(guard--);stepWorld(w,.25);assert.equal(w.health!.transports.length,0);}
 const before=structuredClone({at:patient.at,stock:doctor.inventory,money:totalCoins(w),seats:trip.seats});
 if(change==='birthday'){w.minute=patient.bornAt+6*YEAR;patient.canDecide=patient.canExpress=true;patient.lifeStage='child';}else trip.phase='sailing';
 stepWorld(w,1);assert.equal(w.health!.transports.length,0);assert.deepEqual(doctor.inventory,before.stock);assert.deepEqual(patient.at,before.at);assert.deepEqual(trip.seats,before.seats);assert.equal(totalCoins(w),before.money);assert.equal(aboardFerry(w,patient.id)?.id,trip.id);assert.ok(doctor.lastFailure);
 if(change==='birthday'){
  assert.equal(o.status,'awaitingPatient');const position={...patient.at};run(w,patient,choose(w,patient,'acceptRescue'));assert.deepEqual(patient.at,position);assert.equal(o.status,'accepted');
  queue(w,doctor,choose(w,doctor,'rescue'));let n=100;while(!passenger(w,patient.id)){assert.ok(n--);stepWorld(w,1);}finish(w,doctor);assert.equal(w.health!.transports[0].phase,'delivered');assert.equal(patient.inside,clinic.id);
 }
});

test('child transport review: proven legacy personal acceptance survives reload without invented timestamp',()=>{
 const f=scene(12);f.patient.canDecide=f.patient.canExpress=true;f.patient.health=75;
 run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));run(f.w,f.patient,choose(f.w,f.patient,'acceptRescue'));const o=f.w.health!.transportOffers[0];delete o.personalAcceptedAt;delete o.proxyAcceptedAt;
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,r=w.residents.find(x=>x.id===f.rescuer.id)!,p=w.residents.find(x=>x.id===f.patient.id)!;assert.equal(rescueAuthority(w,r,p,f.ward.id)?.basis,'consent');syncMedicalTransport(w);assert.equal(w.health!.transportOffers[0].personalAcceptedAt,undefined);assert.equal(w.health!.transportOffers[0].status,'accepted');}finally{store.close();}
});

test('child transport review: direct guardian movement stays under six and does not become birthday authority',()=>{
 const f=scene(5);f.patient.health=75;f.patient.guardianIds=[f.rescuer.id];f.patient.bornAt=f.w.minute+1-6*YEAR;
 assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id)?.basis,'guardian');f.w.minute++;f.patient.canDecide=f.patient.canExpress=true;
 assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);assert.ok(completeTransport(f.w,f.rescuer,rescue(f)));assert.equal(f.w.health!.transportOffers.length,0);
});

test('child transport review: saturated agenda keeps one complete response and all legal withdrawals',()=>{
 const f=birthdayScene();birthday(f);const c=decisionContext(f.w,f.patient);assert.ok(c.formal);
 // Saturate only the presentation layer. These synthetic rows are never executed.
 c.formal.opportunities.unshift(...Array.from({length:160},(_,i)=>({id:`review-saturation-${i}`,label:'Synthetic competing control',action:{type:'longCare' as const,operation:'decline' as const,agreementId:`review-${i}`}})));
 const rows=decisionChoices(c);for(const op of ['acceptRescue','declineRescue','cancelRescue'])assert.ok(rows.some(x=>x.action.type==='health'&&x.action.operation===op&&x.action.offerId===f.o.id),op);
 assert.equal(f.o.personalAcceptedAt,null);assert.equal(f.o.status,'accepted');
});

test('child transport review: final withdrawal restoration respects family and busy capability filters',()=>{
 const f=birthdayScene();birthday(f);const c=decisionContext(f.w,f.patient);assert.ok(c.formal);assert.ok(c.formal.opportunities.some(x=>x.action.type==='health'&&x.action.operation==='declineRescue'));
 c.formal.familyTravelling=true;assert.equal(decisionChoices(c).some(x=>x.action.type==='health'),false,'restoration cannot reintroduce family-filtered medical choices');
 queue(f.w,f.patient,{type:'wait',minutes:15});stepWorld(f.w,.25);f.patient.canDecide=false;
 const busy=choices(f.w,f.patient);assert.ok(busy.some(x=>x.action.type==='health'&&x.action.operation==='declineRescue'));
 assert.ok(busy.every(x=>x.action.type==='wait'||x.action.type==='health'&&['cancelRescue','declineRescue'].includes(x.action.operation)));
 f.patient.canExpress=false;assert.equal(choices(f.w,f.patient).some(x=>x.action.type==='health'&&['acceptRescue','declineRescue','cancelRescue'].includes(x.action.operation)),false);
});

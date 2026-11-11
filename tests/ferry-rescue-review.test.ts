import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeInfrastructure} from '../src/world/infrastructure.js';
import {initializeFerries,aboardFerry,completeFerry} from '../src/world/ferry.js';
import {initializeHealth,addHealthCase,healthReason,healthTarget,completeHealth} from '../src/world/health.js';
import {passenger} from '../src/world/medical-transport.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {totalCoins,accountBalance} from '../src/world/economy.js';
import {roomLayout} from '../src/shared/rooms.js';
import {occupiedFerryCapacity} from '../src/world/ferry-cargo.js';
import {YEAR} from '../src/world/time.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';

function queue(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`dock-rescue:${w.revision}:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离真实靠泊救援选择',actions:[a]});assert.equal(result.ok,true,result.error);}
function finish(w:World,r:Resident){let guard=1000;while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function run(w:World,r:Resident,a:Action){queue(w,r,a);finish(w,r);}
function choice(w:World,r:Resident,operation:HealthAction['operation'],targetId?:string){const menu=decisionChoices(decisionContext(w,r));const c=menu.find(c=>c.action.type==='health'&&c.action.operation===operation&&(!targetId||c.action.targetId===targetId));assert.ok(c,`${operation} must appear in normal menu`);return parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction;}
function setup(){
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
function injure(f:ReturnType<typeof setup>){addHealthCase(f.w,f.patient,'injury',90,'真实登船后发生的隔离重伤');stepWorld(f.w,1);assert.equal(f.patient.canDecide,false);assert.equal(f.patient.canExpress,false);}
function beginPickup(f:ReturnType<typeof setup>,a=choice(f.w,f.doctor,'rescue',f.patient.id)){queue(f.w,f.doctor,a);let guard=100;while(!passenger(f.w,f.patient.id)&&(f.doctor.plan||f.doctor.activity)){assert.ok(guard--);stepWorld(f.w,1);}assert.ok(passenger(f.w,f.patient.id),f.doctor.lastFailure??'patient was not picked up');return passenger(f.w,f.patient.id)!;}

test('review: onboard rescue decisions never walk to injected targets',()=>{
 const f=setup(),{w,doctor,patient,boat}=f;addHealthCase(w,patient,'injury',50,'review');
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));
 const a=choice(w,patient,'acceptRescue');a.targetId=doctor.id;
 const at={...patient.at};queue(w,patient,a);stepWorld(w,3);
 assert.deepEqual(patient.at,at);assert.deepEqual(patient.at,boat.at);
});

test('review: occupied freight survives removal of last docked human',()=>{
 const f=setup(),{w,captain,patient,doctor,trip,boat,docks}=f;
 stepWorld(w,trip.departAt-w.minute);run(w,captain,{type:'ferry',operation:'depart',tripId:trip.id});stepWorld(w,90);
 run(w,captain,{type:'ferry',operation:'disembark',tripId:trip.id});
 trip.cargo=[{id:'review-freight',status:'aboard'} as any];
 doctor.at={...docks[1].access};injure(f);beginPickup(f);
 assert.equal(trip.aboard.length,0);assert.equal(trip.phase,'docked');assert.equal(boat.tripId,trip.id);assert.equal(trip.cargo[0].status,'aboard');
});

test('review: cancel cannot mix an authorized offer with an unrelated transport',()=>{
 const f=setup(),{w,doctor,patient,captain,clinic}=f;addHealthCase(w,patient,'injury',50,'review');
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));
 const other={...structuredClone(captain),id:'review-other'};w.residents.push(other);
 const unrelated={id:'review-unrelated',carrierId:captain.id,patientId:other.id,buildingId:clinic.id,bed:0,basis:'emergency' as const,offerId:null,phase:'carrying' as const,startedAt:w.minute,endedAt:null,reason:null};
 w.health!.transports.push(unrelated);
 const a:HealthAction={type:'health',operation:'cancelRescue',offerId:w.health!.transportOffers[0].id,transportId:unrelated.id};
 completeHealth(w,patient,a);
 assert.equal(unrelated.phase,'carrying');
});

test('review: explicit patient cancellation cannot be overwritten by imminent pickup',()=>{
 const f=setup(),{w,doctor,patient}=f;addHealthCase(w,patient,'injury',50,'review');
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));run(w,patient,choice(w,patient,'acceptRescue'));
 queue(w,doctor,choice(w,doctor,'rescue',patient.id));
 let guard=50;while(!doctor.activity||doctor.activity.remaining>1){assert.ok(guard--);stepWorld(w,1);}
 const stock=structuredClone(doctor.inventory);queue(w,patient,choice(w,patient,'cancelRescue'));assert.equal(w.health!.transportOffers[0].status,'cancelled');assert.deepEqual(doctor.inventory,stock);stepWorld(w,3);assert.deepEqual(doctor.inventory,stock);
 assert.equal(passenger(w,patient.id),undefined);assert.ok(aboardFerry(w,patient.id));assert.equal(w.health!.transportOffers[0].status,'cancelled');
});

test('review: withdrawal during unrelated wait is immediate and cannot bundle further actions',()=>{
 const f=setup(),{w,doctor,patient,boat}=f;addHealthCase(w,patient,'injury',50,'review');
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));run(w,patient,choice(w,patient,'acceptRescue'));
 queue(w,patient,{type:'wait',minutes:30});stepWorld(w,1);const activity=patient.activity,remaining=activity!.remaining;
 const a=choice(w,patient,'cancelRescue'),at={...patient.at};
 const bundled=submitPlan(w,{id:'review-bundled',actorId:patient.id,actorRevision:patient.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'review',actions:[a,{type:'wait',minutes:5}]});
 assert.equal(bundled.ok,false);assert.equal(w.health!.transportOffers[0].status,'accepted');
 queue(w,patient,a);assert.equal(w.health!.transportOffers[0].status,'cancelled');assert.equal(patient.activity,activity);assert.equal(activity!.remaining,remaining);assert.deepEqual(patient.at,at);assert.deepEqual(patient.at,boat.at);
});

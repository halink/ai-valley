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
 const docks=[6,22].map((x,i)=>({id:'rescue-dock-'+i,name:i?'东码头':'西码头',projectId:'fixture-'+i,kind:'dock' as const,definition:'infrastructure/dock@1',at:{x,y:6},width:1,height:1,access:{x:x+(i?1:-1),y:6},anchors:[{x:x+(i?1:-1),y:6}],tiles:[{at:{x,y:6},before:'water' as const,after:'bridge' as const}],graveIds:[],condition:100,lastDay:0,createdAt:w.minute,retiredAt:null as number|null,cost:{wood:6,stone:2},minutes:90}));
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

test('real boarding then incapacity exposes a reachable shore rescue, timed adjacent pickup and actual clinic delivery',()=>{
 const f=setup(),{w,doctor,patient,boat,trip,docks,clinic}=f;injure(f);const money=totalCoins(w),cloth=doctor.inventory.cloth!,water=doctor.inventory.water!,at={...boat.at};
 const a=choice(w,doctor,'rescue',patient.id);assert.deepEqual(healthTarget(w,doctor,a).target,docks[0].at);
 queue(w,doctor,a);stepWorld(w,4);assert.deepEqual(patient.at,at);assert.equal(aboardFerry(w,patient.id)?.id,trip.id);assert.equal(doctor.inventory.cloth,cloth);assert.equal(doctor.inside,null);assert.deepEqual(doctor.at,docks[0].at);
 let guard=60;while(!passenger(w,patient.id)&&doctor.activity){assert.ok(guard--);stepWorld(w,1);}const t=passenger(w,patient.id)!;assert.ok(t,doctor.lastFailure??'no pickup');assert.deepEqual(patient.at,docks[0].at);assert.equal(aboardFerry(w,patient.id),undefined);assert.equal(trip.seats[0].status,'withdrawn');assert.equal(trip.seats[0].refunded,7);assert.equal(accountBalance(w,trip.seats[0].account),0);assert.equal(occupiedFerryCapacity(trip),0);assert.equal(doctor.inventory.cloth,cloth-1);assert.equal(doctor.inventory.water,water-1);
 while(t.phase==='carrying'){assert.ok(guard--);const before={...doctor.at};stepWorld(w,1);assert.ok(Math.abs(doctor.at.x-before.x)+Math.abs(doctor.at.y-before.y)<=1);assert.deepEqual(patient.at,doctor.at);}
 assert.equal(t.phase,'delivered',t.reason??'');assert.equal(patient.inside,clinic.id);assert.deepEqual(patient.roomAt,roomLayout(w,clinic).slots.find(s=>s.key==='bed:'+t.bed)!.at);assert.equal(totalCoins(w),money);assert.deepEqual(boat.at,at);
});

test('shore stabilization requires actual berth work and consumes supplies once without moving or charging the patient',()=>{
 const f=setup(),{w,doctor,patient,boat,trip,docks}=f;injure(f);const a=choice(w,doctor,'stabilize',patient.id),medicine=doctor.inventory.medicine!,water=doctor.inventory.water!,money=totalCoins(w);
 assert.deepEqual(healthTarget(w,doctor,a).target,docks[0].at);queue(w,doctor,a);stepWorld(w,5);assert.equal(doctor.inventory.medicine,medicine);assert.deepEqual(patient.at,boat.at);finish(w,doctor);
 assert.equal(doctor.inventory.medicine,medicine-1);assert.equal(doctor.inventory.water,water-1);assert.deepEqual(patient.at,boat.at);assert.equal(aboardFerry(w,patient.id)?.id,trip.id);assert.equal(totalCoins(w),money);assert.equal(w.events.filter(e=>e.audit?.scope.includes('basic-stabilization')).length,1);
});

test('a capable boarded patient separately accepts, declines and withdraws without leaving the hull; consent is not invented',()=>{
 const f=setup(),{w,doctor,patient,clinic,trip,boat}=f;addHealthCase(w,patient,'injury',50,'有决定能力的伤者');
 const rescue:HealthAction={type:'health',operation:'rescue',targetId:patient.id,buildingId:clinic.id};assert.ok(healthReason(w,doctor,rescue));
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));const o=w.health!.transportOffers[0];assert.equal(o.status,'offered');assert.ok(healthReason(w,doctor,rescue));
 run(w,patient,choice(w,patient,'declineRescue'));assert.equal(o.status,'declined');assert.deepEqual(patient.at,boat.at);
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));const accepted=w.health!.transportOffers.at(-1)!;run(w,patient,choice(w,patient,'acceptRescue'));assert.equal(accepted.status,'accepted');assert.equal(healthReason(w,doctor,rescue),null);assert.equal(aboardFerry(w,patient.id)?.id,trip.id);
 run(w,patient,choice(w,patient,'cancelRescue'));assert.equal(accepted.status,'cancelled');assert.ok(healthReason(w,doctor,rescue));assert.deepEqual(patient.at,boat.at);
 assert.equal(submitPlan(w,{id:'no-onboard-work',actorId:patient.id,actorRevision:patient.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'不能从船上工作',actions:[{type:'health',operation:'selfTreat'}]}).ok,false);
 run(w,doctor,choice(w,doctor,'rescueOffer',patient.id));run(w,patient,choice(w,patient,'acceptRescue'));const t=beginPickup(f);assert.equal(t.basis,'consent');finish(w,doctor);assert.equal(t.phase,'delivered');
});

test('stale menu berth, membership and vessel identity are refused before any movement or supply use',()=>{
 const base=setup();injure(base);
 const mutations:Array<[string,(f:ReturnType<typeof setup>)=>void]>=[
  ['boat no longer owns trip',f=>{f.boat.tripId='other';}],
  ['trip replaced hull',f=>{f.trip.boatId='missing';}],
  ['duplicate boat identity',f=>{f.w.ferries!.boats.push(structuredClone(f.boat));}],
  ['duplicate trip identity',f=>{f.w.ferries!.trips.push({...structuredClone(f.trip),aboard:[]});}],
  ['duplicate occupancy',f=>{f.trip.aboard.push(f.patient.id);}],
  ['missing occupancy',f=>{f.trip.aboard=[];}],
  ['seat no longer aboard',f=>{f.trip.seats[0].status='reserved';}],
  ['patient stale shore coordinate',f=>{f.patient.at={...f.docks[0].at};}],
  ['patient indoors',f=>{f.patient.inside=f.clinic.id;}],
  ['damaged dock',f=>{f.docks[0].condition=0;}],
  ['retired dock',f=>{f.docks[0].retiredAt=f.w.minute;}],
  ['blocked actual pier tile',f=>{f.w.map.tiles[6*32+6]='cliff';}],
  ['held is not docked',f=>{f.trip.phase='held';}],
  ['different physical berth',f=>{f.boat.at={x:6,y:7};f.patient.at={...f.boat.at};f.w.map.tiles[7*32+6]='water';}],
 ];
 for(const [label,change] of mutations){const f=structuredClone(base),a=choice(f.w,f.doctor,'rescue',f.patient.id);change(f);const inventory=structuredClone(f.doctor.inventory),at={...f.patient.at},doctorAt={...f.doctor.at},money=totalCoins(f.w);queue(f.w,f.doctor,a);stepWorld(f.w,1);assert.ok(f.doctor.lastFailure,label);assert.deepEqual(f.doctor.at,doctorAt,label);assert.deepEqual(f.patient.at,at,label);assert.deepEqual(f.doctor.inventory,inventory,label);assert.equal(totalCoins(f.w),money,label);assert.equal(f.w.health!.transports.length,0,label);}
});

test('mid-work refusal, capacity recovery, current minor guardian arrival, berth change and bed loss stop without boarding or consumption',()=>{
 const base=setup();injure(base);
 const changes:Array<[string,(f:ReturnType<typeof setup>)=>void]>=[
  ['patient refusal',f=>{f.patient.refusesCare=true;}],
  ['capacity recovery',f=>{f.patient.canDecide=f.patient.canExpress=true;f.w.health!.cases[0].severity=40;f.w.health!.cases[0].capacity=null;}],
  ['current minor guardian',f=>{f.patient.guardianIds=[f.captain.id];f.captain.at={...f.docks[0].at};}],
  ['dock movement',f=>{f.boat.at={x:8,y:6};f.patient.at={...f.boat.at};}],
  ['clinic unavailable',f=>{f.clinic.condition=0;}],
 ];
 for(const operation of ['rescue','stabilize'] as const)for(const [label,change] of changes){if(operation==='stabilize'&&label==='clinic unavailable')continue;const f=structuredClone(base);if(label==='current minor guardian'){f.patient.bornAt=f.w.minute-13*YEAR;f.patient.lifeStage='child';}const a=choice(f.w,f.doctor,operation,f.patient.id);queue(f.w,f.doctor,a);stepWorld(f.w,5);const supplies=structuredClone(f.doctor.inventory);change(f);const at={...f.patient.at};stepWorld(f.w,1);assert.ok(f.doctor.lastFailure,label);assert.deepEqual(f.doctor.inventory,supplies,label);assert.deepEqual(f.patient.at,at,label);assert.equal(f.trip.aboard.includes(f.patient.id),true,label);assert.equal(f.w.health!.transports.length,0,label);}
});

for(const operation of ['rescue','stabilize'] as const)test(`adult historical guardian arriving at the real berth does not interrupt emergency ${operation}`,()=>{
 const f=setup();injure(f);const a=choice(f.w,f.doctor,operation,f.patient.id);queue(f.w,f.doctor,a);stepWorld(f.w,5);const supplies={...f.doctor.inventory};f.patient.guardianIds=[f.captain.id];f.captain.at={...f.docks[0].at};finish(f.w,f.doctor);
 assert.equal(f.doctor.inventory.water,supplies.water!-1);assert.deepEqual(f.patient.guardianIds,[f.captain.id]);assert.equal(f.w.health!.transportOffers.length,0);
 if(operation==='rescue'){assert.equal(f.doctor.inventory.cloth,supplies.cloth!-1);assert.equal(f.w.health!.transports[0].basis,'emergency');assert.equal(f.w.health!.transports[0].phase,'delivered');assert.equal(aboardFerry(f.w,f.patient.id),undefined);}
 else{assert.equal(f.doctor.inventory.medicine,supplies.medicine!-1);assert.equal(aboardFerry(f.w,f.patient.id)?.id,f.trip.id);assert.equal(f.w.health!.transports.length,0);}
});

test('direct and early completion cannot bypass actual dock work, and another pier tile never counts as contact',()=>{
 const f=setup(),{w,doctor,patient,docks}=f;injure(f);const a=choice(w,doctor,'rescue',patient.id),stock=structuredClone(doctor.inventory);assert.ok(completeHealth(w,doctor,a));queue(w,doctor,a);stepWorld(w,3);assert.ok(doctor.activity);assert.ok(completeHealth(w,doctor,doctor.activity!.action as HealthAction));assert.deepEqual(doctor.inventory,stock);
 docks[0].tiles.push({at:{x:6,y:8},before:'water',after:'bridge'});w.map.tiles[8*32+6]='bridge';doctor.at={x:6,y:8};stepWorld(w,1);assert.ok(doctor.lastFailure);assert.deepEqual(doctor.inventory,stock);assert.ok(aboardFerry(w,patient.id));
});

test('a real completed voyage retains its earned fare, rescues a seatless pilot and completes only when the hull is empty',()=>{
 const f=setup(),{w,captain,patient,doctor,trip,boat,docks}=f;stepWorld(w,trip.departAt-w.minute);run(w,captain,{type:'ferry',operation:'depart',tripId:trip.id});stepWorld(w,90);assert.equal(trip.phase,'docked');assert.equal(trip.seats[0].paid,7);
 doctor.at={...docks[1].access};injure(f);const money=totalCoins(w);const t=beginPickup(f);assert.equal(trip.seats[0].status,'landed');assert.equal(trip.seats[0].paid,7);assert.equal(trip.seats[0].refunded,0);assert.equal(trip.phase,'docked');assert.equal(boat.tripId,trip.id);finish(w,doctor);assert.equal(t.phase,'delivered');
 doctor.at={...docks[1].access};doctor.inside=null;doctor.roomAt=null;addHealthCase(w,captain,'injury',90,'靠泊后操船者失能');stepWorld(w,1);queue(w,doctor,choice(w,doctor,'rescue',captain.id));let guard=60;while(!passenger(w,captain.id)&&doctor.activity||doctor.plan&&!passenger(w,captain.id)){assert.ok(guard--);stepWorld(w,1);}assert.ok(passenger(w,captain.id),doctor.lastFailure??'');assert.equal(trip.phase,'completed');assert.equal(boat.tripId,null);assert.equal(trip.pilotId,null);assert.equal(totalCoins(w),money);
});

test('full passenger capacity does not require a phantom rescuer seat and a competing pickup cannot consume twice',()=>{
 const f=setup(),{w,captain,patient,doctor,trip}=f;trip.capacity=1;assert.equal(occupiedFerryCapacity(trip),1);injure(f);captain.inventory.cloth=8;captain.inventory.water=30;captain.skills.care=2;const a=choice(w,doctor,'rescue',patient.id),b=choice(w,captain,'rescue',patient.id),stock=captain.inventory.cloth!;queue(w,doctor,a);queue(w,captain,b);stepWorld(w,30);assert.equal(w.health!.transports.length,1);assert.equal(occupiedFerryCapacity(trip),0);assert.equal(aboardFerry(w,patient.id),undefined);assert.equal((doctor.inventory.cloth??0)+(captain.inventory.cloth??0),8+stock-1);assert.ok(doctor.lastFailure||captain.lastFailure);
});

test('dock contact and paid work survive in-memory restart, while bed occupation during land transport stops at the true location',()=>{
 const f=setup();injure(f);queue(f.w,f.doctor,choice(f.w,f.doctor,'rescue',f.patient.id));stepWorld(f.w,7);const before=f.doctor.activity!.remaining;
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,doctor=w.residents.find(r=>r.id===f.doctor.id)!,patient=w.residents.find(r=>r.id===f.patient.id)!,captain=w.residents.find(r=>r.id===f.captain.id)!;assert.equal(doctor.activity!.remaining,before);assert.ok((doctor.activity!.action as HealthAction).ferryContact);let guard=60;while(!passenger(w,patient.id)&&doctor.activity){assert.ok(guard--);stepWorld(w,1);}const t=passenger(w,patient.id)!;assert.ok(t);stepWorld(w,1);const at={...patient.at};captain.inside=t.buildingId;captain.at={...f.clinic.door};captain.roomAt={...roomLayout(w,f.clinic).slots.find(s=>s.key==='bed:'+t.bed)!.at};stepWorld(w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(patient.at,at);assert.equal(passenger(w,patient.id),undefined);assert.equal(aboardFerry(w,patient.id),undefined);assert.equal(w.ferries!.trips[0].seats[0].refunded,7);}finally{store.close();}
});

test('actual departure while shore pickup is in progress cancels rescue without freezing or teleporting the vessel',()=>{
 const f=setup(),{w,captain,doctor,patient,trip,boat}=f;stepWorld(w,trip.departAt-w.minute);injure(f);queue(w,doctor,choice(w,doctor,'rescue',patient.id));stepWorld(w,4);const stock=structuredClone(doctor.inventory);queue(w,captain,{type:'ferry',operation:'depart',tripId:trip.id});stepWorld(w,8);assert.equal(trip.phase,'sailing');assert.ok(doctor.lastFailure);assert.deepEqual(doctor.inventory,stock);assert.equal(w.health!.transports.length,0);assert.deepEqual(patient.at,boat.at);assert.equal(trip.aboard.includes(patient.id),true);assert.equal(trip.seats[0].refunded,0);const menu=decisionChoices(decisionContext(w,doctor));assert.equal(menu.some(c=>c.action.type==='health'&&['rescue','stabilize'].includes(c.action.operation)&&c.action.targetId===patient.id),false);
});

test('an occupied clinic blocks pickup, and recovering capacity after pickup stops before another physical step',()=>{
 const f=setup(),{w,doctor,patient,captain,clinic}=f;injure(f);captain.inside=clinic.id;captain.at={...clinic.door};captain.roomAt={...roomLayout(w,clinic).slots.find(s=>s.key==='bed:0')!.at};
 // Every real bed is reserved by an active transport, independent of the first physical occupant.
 for(const s of roomLayout(w,clinic).slots.filter(s=>s.kind==='bed'))w.health!.transports.push({id:'occupied-'+s.key,carrierId:'other',patientId:'occupied-'+s.key,buildingId:clinic.id,bed:Number(s.key.slice(4)),basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
 assert.ok(healthReason(w,doctor,{type:'health',operation:'rescue',targetId:patient.id,buildingId:clinic.id}));w.health!.transports=[];captain.inside=null;captain.roomAt=null;captain.at={x:1,y:8};const t=beginPickup(f),at={...patient.at};patient.canDecide=patient.canExpress=true;w.health!.cases[0].severity=40;w.health!.cases[0].capacity=null;stepWorld(w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(patient.at,at);assert.deepEqual(doctor.at,at);assert.equal(aboardFerry(w,patient.id),undefined);
});


test('a damaged but still docked hull does not require repair before adjacent medical extraction',()=>{
 const f=setup();injure(f);f.boat.condition=0;const t=beginPickup(f);assert.equal(t.phase,'carrying');assert.equal(aboardFerry(f.w,f.patient.id),undefined);assert.deepEqual(f.patient.at,f.docks[0].at);assert.equal(f.boat.condition,0);
});

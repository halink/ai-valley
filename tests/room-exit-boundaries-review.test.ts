import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {bodyPickup,reserveBody} from '../src/world/bodies.js';
import {initializeHealth,addHealthCase,completeHealth,healthReason} from '../src/world/health.js';
import {initializeIndustry,completeIndustry,industryTarget} from '../src/world/industry.js';
import type {Livestock} from '../src/shared/industry.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeFamilyRelocation,completeFamilyRelocation,familyRelocationReason} from '../src/world/family-relocation.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Building,Resident,World} from '../src/shared/types.js';

function fixture(){
 const w=createWorld(824);w.mode='formal';w.resources=[];w.plots=[];w.graves=[];
 w.map={name:'isolated exit atomicity review',width:40,height:24,tiles:Array(960).fill('grass'),entrance:{x:1,y:20}};
 const source:Building={...w.buildings.find(b=>b.kind==='lodge')!,id:'review-source',at:{x:3,y:3},width:4,height:3,door:{x:4,y:6},ownerId:'commons',condition:100,residents:[],capacity:4};
 const destination={...source,id:'review-destination',at:{x:23,y:3},door:{x:24,y:6}};
 w.buildings=[source,destination];w.residents=w.residents.slice(0,3);
 for(const r of w.residents)Object.assign(r,{bornAt:w.minute-30*YEAR,status:'alive',residency:'resident',canDecide:true,canExpress:true,refusesCare:false,at:{...source.door},inside:source.id,roomAt:{x:8,y:9},homeId:null,health:100,energy:100,hunger:0,inventory:{cloth:8,water:30,medicine:8},knownBuildings:[source.id,destination.id],knownPeople:w.residents.map(p=>p.id),guardianIds:[],plan:null,activity:null});
 initializeRooms(w);const [actor,subject,blocker]=w.residents;actor.skills.care=2;
 return {w,actor,subject,blocker,source,destination};
}
function activity(w:World,r:Resident,action:Action){r.activity={planId:'review-action',action,startedAt:w.minute,remaining:0,path:[],target:{...r.at},definition:w.activeDefinitions['action/routine'],travelProgress:0};return r.activity;}
function blockExit(f:ReturnType<typeof fixture>){Object.assign(f.blocker,{status:'dead',roomAt:{...roomLayout(f.w,f.source).entry},body:{reservedBy:null,carriedBy:null,storedAt:f.source.id}});}
function bodyFixture(){
 const f=fixture();f.subject.status='dead';f.subject.body={reservedBy:null,carriedBy:null,storedAt:f.source.id};
 f.w.graves=[{id:'review-grave',at:{x:30,y:18},personId:null,reservedBy:null,buriedAt:null}];
 const a=activity(f.w,f.actor,{type:'bury',targetId:f.subject.id});a.cargo={bodyId:f.subject.id,graveId:'review-grave',pickedUp:false,pickupRemaining:0};
 assert.equal(reserveBody(f.w,f.actor,a),null);return {...f,a};
}

test('blocked shared exit rejects body pickup before carried state, storage or location changes',()=>{
 const f=bodyFixture();blockExit(f);const subject=structuredClone(f.subject),events=f.w.events.length;
 const error=bodyPickup(f.w,f.actor,0);
 assert.ok(error,'an unrelated stored body blocks the only exit');assert.deepEqual(f.subject,subject);assert.equal(f.a.cargo!.pickedUp,false);assert.equal(f.actor.inside,f.source.id);assert.equal(f.w.events.length,events);
});

test('legitimately picking up the exit-blocking body removes only that body from exit obstacles',()=>{
 const f=bodyFixture(),entry=roomLayout(f.w,f.source).entry;f.subject.roomAt={...entry};f.actor.roomAt={x:entry.x,y:entry.y-1};
 assert.equal(bodyPickup(f.w,f.actor,0),null);assert.equal(f.a.cargo!.pickedUp,true);assert.equal(f.subject.body!.carriedBy,f.actor.id);assert.equal(f.subject.body!.storedAt,null);assert.equal(f.actor.inside,f.source.id);assert.equal(f.a.room?.mode,'exit');assert.deepEqual(f.a.room?.path,[entry]);
});

test('blocked initial medical pickup does not spend supplies, cancel patient plans or create transport',()=>{
 const f=fixture();f.subject.canDecide=f.subject.canExpress=false;f.subject.health=19;initializeHealth(f.w);addHealthCase(f.w,f.subject,'injury',30,'isolated emergency');
 const action:Action={type:'health',operation:'rescue',targetId:f.subject.id,buildingId:f.destination.id};activity(f.w,f.actor,action);
 f.subject.plan={id:'patient-existing-plan',actorId:f.subject.id,actorRevision:f.subject.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'preserve pending decision',actions:[{type:'wait',minutes:1}]};
 assert.equal(healthReason(f.w,f.actor,action),null,'ordinary rescue prerequisites remain valid');blockExit(f);
 const patient=structuredClone(f.subject),inventory={...f.actor.inventory},serial=f.w.health!.nextSerial,events=f.w.events.length;
 const error=completeHealth(f.w,f.actor,action);
 assert.ok(error,'source room exit is physically blocked');assert.deepEqual(f.actor.inventory,inventory);assert.deepEqual(f.subject,patient);assert.equal(f.w.health!.transports.length,0);assert.equal(f.w.health!.nextSerial,serial);assert.equal(f.w.events.length,events);assert.equal(action.phase,undefined);assert.equal(f.actor.inside,f.source.id);
});


test('blocked animal pickup preserves animal location, pasture and carrier state',()=>{
 const f=fixture();f.source.kind='barn';f.destination.kind='barn';f.destination.ownerId=f.actor.id;initializeIndustry(f.w);
 const animal:Livestock={id:'review-goat',ownerId:f.actor.id,kind:'goat',sex:'female',bornAt:f.w.minute-YEAR,barnId:f.source.id,at:{...f.actor.at},inside:f.source.id,roomAt:{...f.actor.roomAt!},pastureId:'retained-origin',hunger:0,thirst:0,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:f.w.minute};f.w.industry!.animals.push(animal);
 const action:Action={type:'industry',operation:'moveAnimal',animalId:animal.id,buildingId:f.destination.id};activity(f.w,f.actor,action);assert.equal(industryTarget(f.w,f.actor,action).error,undefined);blockExit(f);
 const before=structuredClone(animal),events=f.w.events.length;assert.ok(completeIndustry(f.w,f.actor,action));assert.deepEqual(animal,before);assert.equal(action.phase,undefined);assert.equal(f.actor.inside,f.source.id);assert.equal(f.w.events.length,events);
});


test('blocked safe-ground pickup preserves supplies and the original patient state',()=>{
 const f=fixture();f.w.scenario='frontier';f.w.map.settlement={x:6,y:8};f.w.buildings=[f.source];f.source.capacity=0;f.subject.bornAt=f.w.minute-2*YEAR;f.subject.guardianIds=[f.actor.id];f.subject.canDecide=f.subject.canExpress=false;
 initializeHealth(f.w);initializeFrontierHazards(f.w);f.w.frontierHazards!.beasts=[];
 f.w.frontierHazards!.disasters=[{id:'review-flood',kind:'flashFlood',at:{...f.source.door},radius:2,phase:'active',warningAt:f.w.minute-60,startsAt:f.w.minute-1,endsAt:f.w.minute+1000,intensity:1,warned:f.w.residents.map(r=>r.id),exposure:{},footprint:[{...f.source.door}]}];
 const action:Action={type:'health',operation:'rescue',targetId:f.subject.id,evacuationDestination:'safe-ground',evacuationDangerId:'review-flood',evacuationExitId:f.source.id};activity(f.w,f.actor,action);
 assert.equal(healthReason(f.w,f.actor,action),null);blockExit(f);
 const patient=structuredClone(f.subject),inventory={...f.actor.inventory},serial=f.w.health!.nextSerial,events=f.w.events.length;
 assert.ok(completeHealth(f.w,f.actor,action));assert.deepEqual(f.subject,patient);assert.deepEqual(f.actor.inventory,inventory);assert.equal(f.w.health!.transports.length,0);assert.equal(f.w.health!.nextSerial,serial);assert.equal(f.w.events.length,events);assert.equal(action.phase,undefined);
});

test('blocked family escort preserves the signed arrangement and child location',()=>{
 const f=fixture();f.source.ownerId=f.actor.id;f.source.residents=[f.actor.id,f.subject.id];f.destination.ownerId=f.actor.id;f.actor.homeId=f.subject.homeId=f.source.id;
 f.subject.bornAt=f.w.minute-2*YEAR;f.subject.guardianIds=[f.actor.id];f.subject.canDecide=f.subject.canExpress=false;initializeFamilyRelocation(f.w);
 assert.equal(completeFamilyRelocation(f.w,f.actor,{type:'familyRelocation',operation:'propose',buildingId:f.destination.id,memberIds:[f.actor.id,f.subject.id],departAfter:f.w.minute+5,departBefore:f.w.minute+240}),null);
 const c=f.w.familyRelocation!.agreements[0];assert.equal(c.status,'accepted');
 const action:Action={type:'familyRelocation',operation:'escort',relocationId:c.id,personId:f.subject.id};activity(f.w,f.actor,action);assert.equal(familyRelocationReason(f.w,f.actor,action),null);blockExit(f);
 const child=structuredClone(f.subject),agreement=structuredClone(c),events=f.w.events.length;
 assert.ok(completeFamilyRelocation(f.w,f.actor,action));assert.deepEqual(c,agreement);assert.deepEqual(f.subject,child);assert.equal(action.phase,undefined);assert.equal(f.w.events.length,events);assert.equal(f.actor.inside,f.source.id);
});

test('same-room medical delivery still starts when the exterior exit is blocked',()=>{
 const f=fixture();f.subject.canDecide=f.subject.canExpress=false;f.subject.health=19;initializeHealth(f.w);addHealthCase(f.w,f.subject,'injury',30,'isolated emergency');
 const action:Action={type:'health',operation:'rescue',targetId:f.subject.id,buildingId:f.source.id};activity(f.w,f.actor,action);blockExit(f);
 const cloth=f.actor.inventory.cloth!,water=f.actor.inventory.water!;assert.equal(completeHealth(f.w,f.actor,action),null);assert.equal(action.phase,'delivery');assert.equal(f.actor.inside,f.source.id);assert.equal(f.actor.activity!.room,undefined);assert.equal(f.actor.inventory.cloth,cloth-1);assert.equal(f.actor.inventory.water,water-1);assert.equal(f.w.health!.transports.length,1);
});

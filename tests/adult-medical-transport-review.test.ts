import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason,addHealthCase} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {rescueAuthority,passenger,syncMedicalTransport} from '../src/world/medical-transport.js';
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

for(const age of [18-1/YEAR,18,18+1/YEAR])test(`review: minute-precise adulthood boundary ${age}`,()=>{
 const f=scene(age);assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id)?.basis,age<18?undefined:'emergency');
 // Intentionally stale adult lifeStage must not override the real birth date.
 assert.equal(f.patient.lifeStage,'adult');
});

test('review: infant guardian pickup and explicit guardian stop remain available',()=>{
 const f=scene(5);f.patient.guardianIds=[f.rescuer.id,f.relative.id];f.patient.health=80;
 const t=start(f);assert.equal(t.basis,'guardian');
 const stop:HealthAction={type:'health',operation:'cancelRescue',transportId:t.id};assert.equal(healthReason(f.w,f.relative,stop),null);
 run(f.w,f.relative,stop);assert.equal(t.phase,'interrupted');
});

test('review: capable child uses own final-menu acceptance rather than guardian response',()=>{
 const f=scene(12);f.patient.canDecide=f.patient.canExpress=true;f.patient.health=75;
 run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));const offer=f.w.health!.transportOffers[0];assert.equal(offer.respondentId,f.patient.id);
 assert.ok(healthReason(f.w,f.relative,{type:'health',operation:'acceptRescue',offerId:offer.id}));
 run(f.w,f.patient,choose(f.w,f.patient,'acceptRescue'));const t=start(f);assert.equal(t.basis,'consent');finish(f.w,f.rescuer);assert.equal(t.phase,'delivered');
});

test('review: adult final-menu refusal is not converted into consent by historical guardian',()=>{
 const f=scene();f.patient.canDecide=f.patient.canExpress=true;f.patient.health=75;
 run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));run(f.w,f.patient,choose(f.w,f.patient,'declineRescue'));
 assert.equal(f.w.health!.transportOffers[0].status,'declined');assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);
 assert.ok(healthReason(f.w,f.rescuer,rescue(f)));assert.equal(f.w.health!.transports.length,0);
});

for(const capability of [[true,false],[false,true],[true,true]] as const)test(`review: existing medical incapacity semantics ${capability}`,()=>{
 const f=scene();[f.patient.canDecide,f.patient.canExpress]=capability;
 assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id)?.basis,capability.every(Boolean)?undefined:'emergency');
 f.patient.refusesCare=true;assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);
});

for(const invalid of ['destroyed','foreign-owner','nonmedical','unknown'] as const)test(`review: adult historical guardian does not bypass ${invalid} destination`,()=>{
 const f=scene();if(invalid==='destroyed')f.ward.condition=0;if(invalid==='foreign-owner')f.ward.ownerId=f.relative.id;if(invalid==='nonmedical')f.ward.kind='home';if(invalid==='unknown')f.rescuer.knownBuildings=[];
 assert.ok(healthReason(f.w,f.rescuer,rescue(f)));assert.equal(f.w.health!.transports.length,0);
});

test('review: accepted childhood proxy reload cannot authorize noncritical adult, even without respondentId',()=>{
 for(const missing of [false,true]){const f=scene(17);f.patient.health=70;run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));run(f.w,f.relative,choose(f.w,f.relative,'acceptRescue'));
 f.patient.bornAt=f.w.minute-18*YEAR;f.patient.lifeStage='adult';if(missing)Reflect.deleteProperty(f.w.health!.transportOffers[0],'respondentId');
 const db=new WorldStore(':memory:');try{db.commit(f.w,null);const w=db.load()!,r=w.residents.find(x=>x.id===f.rescuer.id)!,p=w.residents.find(x=>x.id===f.patient.id)!;
 assert.equal(rescueAuthority(w,r,p,f.ward.id),null);assert.ok(healthReason(w,r,rescue(f)));assert.equal(w.frontierHazards!.weather!.enabled,false);
 }finally{db.close();}}
});

test('review: guardian arrival and stale proxy cancellation cannot stop an adult emergency in progress',()=>{
 const f=scene(17);f.patient.health=70;run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));run(f.w,f.relative,choose(f.w,f.relative,'acceptRescue'));
 const offer=f.w.health!.transportOffers[0];f.patient.bornAt=f.w.minute-18*YEAR;f.patient.lifeStage='adult';f.patient.health=19;const t=start(f);assert.equal(t.basis,'emergency');assert.equal(t.offerId,null);
 run(f.w,f.relative,choose(f.w,f.relative,'cancelRescue'));assert.equal(offer.status,'cancelled');syncMedicalTransport(f.w);assert.equal(t.phase,'carrying');finish(f.w,f.rescuer);assert.equal(t.phase,'delivered');
 assert.equal(f.w.health!.appointments.length,0);assert.equal(f.w.health!.totals.treated,0);assert.deepEqual(f.patient.guardianIds,[f.relative.id]);
});

test('review: adult rescuer retains own right to end emergency carriage',()=>{
 const f=scene(),t=start(f);const stop:HealthAction={type:'health',operation:'cancelRescue',transportId:t.id};
 assert.equal(healthReason(f.w,f.rescuer,stop),null);
 // Direct completion is separately allowed for an explicit stop; no pickup bypass.
 queue(f.w,f.rescuer,stop);finish(f.w,f.rescuer);assert.equal(t.phase,'interrupted');
});

test('review: ongoing proxy carriage at adulthood requires independent current emergency authority',()=>{
 const f=scene(17);f.patient.health=70;run(f.w,f.rescuer,choose(f.w,f.rescuer,'rescueOffer'));run(f.w,f.relative,choose(f.w,f.relative,'acceptRescue'));const t=start(f);assert.equal(t.basis,'consent');
 f.patient.bornAt=f.w.minute-18*YEAR;f.patient.lifeStage='adult';f.patient.health=19;
 assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id)?.basis,'emergency');syncMedicalTransport(f.w);assert.equal(t.phase,'carrying');
 // basis records the original pickup; it is not the authority used by delivery rechecks.
 assert.equal(t.basis,'consent');f.patient.health=21;assert.equal(rescueAuthority(f.w,f.rescuer,f.patient,f.ward.id),null);const at={...f.patient.at};syncMedicalTransport(f.w);assert.equal(t.phase,'interrupted');assert.deepEqual(f.patient.at,at);
});

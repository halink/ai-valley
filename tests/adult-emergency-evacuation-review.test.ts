import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import {passenger,syncMedicalTransport} from '../src/world/medical-transport.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(indoor=false){
 const w=createWorld(71);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'无接收床干地护送隔离世界',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 const source:Building={...structuredClone(w.buildings.find(b=>b.kind==='lodge')!),id:'source',at:{x:9,y:4},width:4,height:4,door:{x:11,y:8},capacity:0,condition:100,ownerId:'commons',residents:[]};
 w.buildings=indoor?[source]:[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 for(const r of w.residents){r.at={...source.door};r.inside=indoor?source.id:null;r.roomAt=indoor?{x:4,y:9}:null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=indoor?[source.id]:[];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;r.lastFailure=null;}
 const [g,p,other]=w.residents;p.bornAt=w.minute-30*YEAR;p.guardianIds=[];p.canDecide=p.canExpress=false;if(indoor)p.roomAt={x:5,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d={id:'source-flood',kind:'flashFlood' as const,at:{...source.door},radius:2,phase:'active' as const,warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:[{...source.door}]};w.frontierHazards!.disasters=[d];
 return {w,g,p,other,source,d};
}
const ground=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&(a as HealthAction).evacuationDestination==='safe-ground';
function selected(f:ReturnType<typeof fixture>){const menu=decisionChoices(decisionContext(f.w,f.g)),c=menu.find(c=>ground(c.action));assert.ok(c,'real final menu must offer a limited adult dry-ground evacuation without a bed');return {c,a:parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction};}
function queue(w:World,r:Resident,a:Action){const s=submitPlan(w,{id:`dry-ground:${w.minute}:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择将眼前失能成人临时撤到附近干地，不安排医疗或长期住处',actions:[a]});assert.equal(s.ok,true,s.error);}
function until(w:World,done:()=>boolean){let n=1500;while(!done()){assert.ok(n-->0,'bounded actual movement');stepWorld(w,.25);}}
function finish(w:World,r:Resident){until(w,()=>!r.activity&&!r.plan);}
function pickup(f:ReturnType<typeof fixture>){queue(f.w,f.g,selected(f).a);until(f.w,()=>!!passenger(f.w,f.p.id)||!!f.g.lastFailure);assert.equal(f.g.lastFailure,null);return passenger(f.w,f.p.id)!;}

// Independent adversarial review: no live world, network, or external model.
for(const [label,change] of [
 ['expression-only incapacity',(f:ReturnType<typeof fixture>)=>{f.p.canDecide=true;f.p.canExpress=false;}],
 ['minor',(f:ReturnType<typeof fixture>)=>{f.p.bornAt=f.w.minute-17*YEAR;}],
 ['refusal',(f:ReturnType<typeof fixture>)=>{f.p.refusesCare=true;}],
 ['warning-only',(f:ReturnType<typeof fixture>)=>{f.d.phase='warning' as never;}],
 ['ended',(f:ReturnType<typeof fixture>)=>{f.d.phase='ended' as never;}],
 ['outside',(f:ReturnType<typeof fixture>)=>{f.p.residency='outside';}],
 ['uncovered',(f:ReturnType<typeof fixture>)=>{f.d.footprint=[];}],
] as const)test(`adult review: ${label} supplies no ground authority`,()=>{
 const f=fixture(),a=selected(f).a;change(f);
 assert.equal(healthOpportunities(f.w,f.g).some(c=>ground(c.action)),false);
 assert.ok(healthReason(f.w,f.g,a));assert.equal(f.w.health!.transports.length,0);assert.equal(f.g.inventory.cloth,3);
});

for(const indoor of [false,true])for(const express of [false,true])test(`adult review: recovered decision capacity stops before any movement (indoor=${indoor}, expression=${express})`,()=>{
 const f=fixture(indoor),t=pickup(f),where=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt});
 f.p.canDecide=true;f.p.canExpress=express;stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted');assert.deepEqual({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt},where);assert.equal(f.g.activity,null);
});

test('adult review: no added medical, residential or property rights',()=>{
 const f=fixture(),before=structuredClone({home:f.p.homeId,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory}),a=selected(f).a;
 assert.ok(healthReason(f.w,f.g,{type:'health',operation:'stabilize',targetId:f.p.id}));
 for(const extra of [{buildingId:'source'},{offerId:'invented'},{operation:'stabilize'},{evacuationDestination:'known-address'}])assert.ok(healthReason(f.w,f.g,{...a,...extra} as HealthAction));
 const t=pickup(f);finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.equal(t.bed,null);assert.equal(t.buildingId,null);assert.equal(t.offerId,null);
 assert.deepEqual({home:f.p.homeId,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory},before);
 assert.equal(f.w.health!.appointments.length,0);assert.equal(f.w.health!.cases.length,0);assert.equal(f.g.inventory.medicine,2);assert.equal(f.w.frontierHazards!.weather!.enabled,false);
});

test('adult review: expression grants only own bounded wait or stop',()=>{
 const f=fixture(true),t=pickup(f),room={...f.p.roomAt!};f.p.canExpress=true;
 const menu=decisionChoices(decisionContext(f.w,f.p));assert.equal(menu.length,2);
 assert.ok(menu.every(c=>c.action.type==='wait'||c.action.type==='health'&&c.action.operation==='cancelRescue'));
 const attempt=(actions:Action[])=>submitPlan(f.w,{id:`adult-expression:${f.w.revision}`,actorId:f.p.id,actorRevision:f.p.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'只验证当前有限表达权限',actions});
 const stop:HealthAction={type:'health',operation:'cancelRescue',transportId:t.id};
 for(const actions of [[{type:'wait',minutes:16}],[{type:'wait',minutes:1},stop],[{...stop,targetId:f.other.id}],[{...stop,transportId:'not-own'}],[{type:'health',operation:'selfTreat'}]] as Action[][])assert.equal(attempt(actions).ok,false);
 queue(f.w,f.p,stop);assert.equal(t.phase,'interrupted');assert.equal(f.p.canDecide,false);assert.deepEqual(f.p.roomAt,room);
});

test('adult review: indoor exterior facts stay unknown until physical exit',()=>{
 const clear=fixture(true),blocked=fixture(true);for(let y=0;y<blocked.w.map.height;y++)for(let x=0;x<blocked.w.map.width;x++)blocked.d.footprint.push({x,y});
 assert.deepEqual(selected(clear).a,selected(blocked).a);const t=pickup(blocked);assert.equal(t.evacuationGround,undefined);
 finish(blocked.w,blocked.g);assert.equal(t.phase,'interrupted');assert.deepEqual(blocked.p.at,blocked.source.door);assert.equal(blocked.p.inside,null);
});

test('adult review: persisted forged nonadjacent route interrupts instead of teleporting',()=>{
 const f=fixture();f.d.footprint=[{x:11,y:8},{x:12,y:8},{x:10,y:8},{x:11,y:9},{x:11,y:7}];const t=pickup(f),at={...f.p.at};
 assert.ok(f.g.activity!.path.length>=2);f.g.activity!.path=[{...t.evacuationGround!}];
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);
});

test('adult review: reload preserves cumulative budget and single material charge',()=>{
 const f=fixture();f.d.footprint=[{x:11,y:8},{x:12,y:8},{x:10,y:8},{x:11,y:9},{x:11,y:7}];const t=pickup(f);until(f.w,()=>t.evacuationSteps===1);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!,loaded=passenger(w,p.id)!;
 assert.equal(loaded.evacuationSteps,1);finish(w,g);assert.equal(loaded.phase,'delivered');assert.ok(loaded.evacuationSteps!<=8);assert.equal(g.inventory.cloth,2);assert.equal(g.inventory.water,8);assert.deepEqual(p.at,loaded.evacuationGround);
 }finally{store.close();}
});

test('adult review: stopping survives reload and cannot be bypassed by a different carrier',()=>{
 const f=fixture(),t=pickup(f);f.p.canExpress=true;queue(f.w,f.p,{type:'health',operation:'cancelRescue',transportId:t.id});
 assert.equal(t.phase,'interrupted');assert.equal(f.p.canDecide,false);assert.equal(f.w.health!.evacuationRefusals?.some(x=>x.patientId===f.p.id&&x.dangerId===f.d.id),true);f.p.canExpress=false;f.other.at={...f.p.at};
 for(const actor of [f.g,f.other])assert.equal(healthOpportunities(f.w,actor).some(c=>ground(c.action)),false);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!;
 assert.equal(healthOpportunities(w,g).some(c=>ground(c.action)),false);assert.equal(w.health!.transports.length,1);
 }finally{store.close();}
});

for(const change of ['ended','zero-intensity','future-start'] as const)test(`adult review: ${change} removes ongoing danger authority before next edge`,()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at};
 if(change==='ended')f.d.phase='ended' as never;else if(change==='zero-intensity')f.d.intensity=0;else f.d.startsAt=f.w.minute+100;
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);
});

test('adult review: deterioration to critical stops ground movement without administering medicine',()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at};f.p.health=20;
 stepWorld(f.w,.25);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.equal(f.g.inventory.medicine,2);
});

test('adult review: missing or changed authority tag on delivery cannot inherit emergency medical powers',()=>{
 for(const edit of ['action','record','bed'] as const){const f=fixture(),t=pickup(f),at={...f.p.at};
  if(edit==='action')delete (f.g.activity!.action as HealthAction).evacuationAuthority;else if(edit==='record')delete t.evacuationAuthority;else t.bed=0;
  syncMedicalTransport(f.w);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);
 }
});

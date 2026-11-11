import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeFrontierHazards,frontierShelterOccupants} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import {passenger,medicalBed} from '../src/world/medical-transport.js';
import {canInspectBuilding} from '../src/world/building-knowledge.js';
import {roomLayout} from '../src/shared/rooms.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(71);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'Independent indoor evacuation fixture',width:32,height:18,tiles:Array<Tile>(576).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 const template=w.buildings.find(b=>b.kind==='lodge')!;
 const b:Building={...structuredClone(template),id:'destination',at:{x:3,y:4},width:4,height:4,door:{x:5,y:8},capacity:1,condition:100,ownerId:'commons',residents:[]};
 const source:Building={...structuredClone(b),id:'source',at:{x:20,y:4},door:{x:22,y:8}};
 w.buildings=[source,b];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 for(const r of w.residents){r.at={...source.door};r.inside=source.id;r.roomAt={x:4,y:9};r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=[source.id,b.id];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;r.lastFailure=null;}
 const [g,p,other]=w.residents;p.bornAt=w.minute-2*YEAR;p.guardianIds=[g.id];p.canDecide=p.canExpress=false;p.roomAt={x:5,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 w.frontierHazards!.disasters=[{id:'source-flood',kind:'flashFlood',at:{x:23,y:8},radius:1,phase:'active',warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:[{...source.door}]}];
 return {w,g,p,other,b,source};
}
const evacuation=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&!!a.evacuationDangerId;
function options(f:ReturnType<typeof fixture>){return healthOpportunities(f.w,f.g).filter(c=>evacuation(c.action)&&c.action.buildingId===f.b.id);}
function selected(f:ReturnType<typeof fixture>){const menu=decisionChoices(decisionContext(f.w,f.g));const c=menu.find(c=>evacuation(c.action)&&c.action.buildingId===f.b.id);assert.ok(c,'final menu includes known uninspected address');return parseChoice(JSON.stringify({choice:c.id}),menu).actions[0];}
function submit(w:World,r:Resident,a:Action){const s=submitPlan(w,{id:`review:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Current guardian chooses an actual evacuation',actions:[a]});assert.ok(s.ok,s.error);}
function until(w:World,done:()=>boolean){let n=1000;while(!done()){assert.ok(n-->0,'bounded real movement');stepWorld(w,.25);}}
function pickup(f:ReturnType<typeof fixture>){submit(f.w,f.g,selected(f));until(f.w,()=>!!passenger(f.w,f.p.id)||!!f.g.lastFailure);assert.equal(f.g.lastFailure,null);return passenger(f.w,f.p.id)!;}
function finish(w:World,r:Resident){until(w,()=>!r.activity&&!r.plan);}

test('independent indoor review: hidden bed, condition and flood facts do not alter the menu or pickup',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.b.condition=0;},f=>{f.b.capacity=0;},f=>{f.b.residents=[f.other.id];f.other.homeId=f.b.id;},f=>{f.w.frontierHazards!.disasters.push({...structuredClone(f.w.frontierHazards!.disasters[0]),id:'hidden-destination-flood',at:{...f.b.door},footprint:[{...f.b.door}]});}] as Array<(f:ReturnType<typeof fixture>)=>void>){
  const baseline=fixture(),f=fixture();change(f);assert.equal(canInspectBuilding(f.w,f.g,f.b),false);assert.deepEqual(options(f),options(baseline));
  const t=pickup(f);assert.equal(t.phase,'carrying');assert.equal(f.g.inside,f.source.id);assert.equal(f.p.inside,f.source.id);assert.equal(t.bed,null,'no remotely selected bed');
 }
});

test('independent indoor review: actual room exit and walking precede bed reservation and physical delivery',()=>{
 const f=fixture(),t=pickup(f),at={...f.g.at},room={...f.g.roomAt!};assert.equal(t.bed,null);assert.equal(medicalBed(f.w,f.b.id,f.other.id),0,'unverified trip does not reserve bed');
 stepWorld(f.w,.25);assert.deepEqual(f.g.at,at);assert.deepEqual(f.p.roomAt,f.g.roomAt);assert.equal(f.g.inside,f.source.id);
 until(f.w,()=>f.g.inside===null);assert.notDeepEqual(room,roomLayout(f.w,f.source).entry);assert.deepEqual(f.g.at,at);
 while(f.g.activity||f.g.plan){if(f.g.at.x!==f.b.door.x||f.g.at.y!==f.b.door.y)assert.equal(t.bed,null,'even nearby inspection must not remotely reserve');stepWorld(f.w,.25);assert.deepEqual(f.p.at,f.g.at);}
 assert.equal(t.phase,'delivered',t.reason??'');assert.equal(t.bed,0);assert.equal(f.p.inside,f.b.id);assert.deepEqual(f.p.roomAt,roomLayout(f.w,f.b).slots.find(s=>s.key==='bed:0')!.at);
});

test('independent indoor review: full registered bed is discovered locally without eviction or teleport',()=>{
 const f=fixture();f.b.residents=[f.other.id];f.other.homeId=f.b.id;const t=pickup(f);finish(f.w,f.g);
 assert.equal(t.phase,'interrupted');assert.equal(f.p.inside,null);assert.ok(canInspectBuilding(f.w,f.g,f.b));assert.deepEqual(f.p.at,f.g.at);assert.notDeepEqual(f.p.at,f.source.door);assert.equal(f.other.homeId,f.b.id);assert.deepEqual(f.b.residents,[f.other.id]);
});

test('independent indoor review: refusal and guardian withdrawal interrupt room exit at the real room point',()=>{
 for(const revoke of [(f:ReturnType<typeof fixture>)=>{f.p.refusesCare=true;},(f:ReturnType<typeof fixture>)=>{f.p.guardianIds=[];}]){
  const f=fixture(),t=pickup(f),at={...f.p.at},room={...f.p.roomAt!},stock={...f.g.inventory};revoke(f);stepWorld(f.w,.25);
  assert.equal(t.phase,'interrupted');assert.equal(f.p.inside,f.source.id);assert.deepEqual(f.p.at,at);assert.deepEqual(f.p.roomAt,room);assert.deepEqual(f.g.inventory,stock);
 }
});

test('independent indoor review: no private, unknown, adult or six-year-old unverified evacuation',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.b.ownerId=f.other.id;},f=>{f.g.knownBuildings=[f.source.id];},f=>{f.p.bornAt=f.w.minute-6*YEAR;},f=>{f.p.bornAt=f.w.minute-30*YEAR;},f=>{f.p.guardianIds=[];}] as Array<(f:ReturnType<typeof fixture>)=>void>){const f=fixture();change(f);assert.equal(options(f).length,0);}
});

test('independent indoor review: memory SQLite preserves unverified carrying and room exit',()=>{
 const f=fixture();pickup(f);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!,t=passenger(w,p.id)!;assert.equal(t.bed,null);assert.equal(g.activity!.room!.mode,'exit');finish(w,g);assert.equal(t.phase,'delivered');assert.equal(p.inside,f.b.id);}finally{store.close();}
});

test('independent indoor review: a remote bed claim after pickup does not interrupt before local observation',()=>{
 const f=fixture(),t=pickup(f);f.b.residents=[f.other.id];f.other.homeId=f.b.id;
 stepWorld(f.w,.25);assert.equal(t.phase,'carrying');assert.equal(f.g.inside,f.source.id);assert.equal(t.bed,null);
 until(f.w,()=>f.g.inside===null);assert.equal(t.phase,'carrying');assert.equal(canInspectBuilding(f.w,f.g,f.b),false);finish(f.w,f.g);assert.equal(t.phase,'interrupted');
});

test('independent indoor review: unknown address mode does not bypass lost ownership or missing source threat',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.b.ownerId=f.other.id;},(f:ReturnType<typeof fixture>)=>{f.w.frontierHazards!.disasters[0].phase='ended';}]){
  const f=fixture(),a=selected(f),stock={...f.g.inventory},room={...f.p.roomAt!};change(f);submit(f.w,f.g,a);finish(f.w,f.g);assert.ok(f.g.lastFailure);assert.equal(f.w.health!.transports.length,0);assert.deepEqual(f.g.inventory,stock);assert.deepEqual(f.p.roomAt,room);
 }
});

test('independent indoor review: two unknown-address trips cannot reserve the single bed remotely or double deliver',()=>{
 const f=fixture(),g2=structuredClone(f.g),p2=structuredClone(f.p);g2.id='guardian-two';g2.name='Second guardian';p2.id='child-two';p2.name='Second child';p2.guardianIds=[g2.id];g2.roomAt={x:10,y:9};p2.roomAt={x:11,y:9};f.w.residents.push(g2,p2);f.w.frontierHazards!.disasters[0].warned.push(g2.id,p2.id);
 const second={...f,g:g2,p:p2};submit(f.w,f.g,selected(f));submit(f.w,g2,selected(second));until(f.w,()=>f.w.health!.transports.length===2||!!f.g.lastFailure||!!g2.lastFailure);
 assert.equal(f.g.lastFailure,null);assert.equal(g2.lastFailure,null);assert.equal(f.w.health!.transports.length,2);assert.ok(f.w.health!.transports.every(t=>t.bed===null));
 until(f.w,()=>!f.g.activity&&!f.g.plan&&!g2.activity&&!g2.plan);assert.equal(f.w.health!.transports.filter(t=>t.phase==='delivered').length,1);assert.equal(f.w.health!.transports.filter(t=>t.phase==='interrupted').length,1);
});

test('independent indoor review: a child can stop carrying before any bed is reserved',()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at},room={...f.p.roomAt!};f.p.canDecide=f.p.canExpress=true;
 const menu=decisionChoices(decisionContext(f.w,f.p)),stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'&&c.action.transportId===t.id);assert.ok(stop);
 submit(f.w,f.p,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.deepEqual(f.p.roomAt,room);assert.equal(f.p.inside,f.source.id);assert.equal(t.bed,null);
});


test('independent indoor review: pending transport counts toward shelter capacity only after real arrival',()=>{
 const f=fixture(),t=pickup(f);assert.equal(frontierShelterOccupants(f.w,f.b).has(f.p.id),false);
 until(f.w,()=>t.bed!==null);assert.deepEqual(f.g.at,f.b.door);assert.equal(frontierShelterOccupants(f.w,f.b).has(f.p.id),true);
});

test('independent indoor review: newly blocked interior delivery route stops at its actual last room point',()=>{
 const f=fixture(),t=pickup(f);until(f.w,()=>f.g.inside===f.b.id&&!!f.g.activity?.room?.path.length);
 const next=f.g.activity!.room!.path[0],at=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt});
 f.other.status='dead';f.other.body={storedAt:f.b.id,carriedBy:null} as NonNullable<Resident['body']>;f.other.roomAt={...next};
 until(f.w,()=>t.phase!=='carrying');assert.equal(t.phase,'interrupted');assert.deepEqual({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt},at);
});

test('independent indoor review: hidden active destination flood allows pickup but never unsafe entry',()=>{
 const f=fixture();f.w.frontierHazards!.disasters.push({...structuredClone(f.w.frontierHazards!.disasters[0]),id:'hidden-destination',at:{...f.b.door},footprint:[{...f.b.door}]});
 const t=pickup(f);finish(f.w,f.g);assert.equal(t.phase,'interrupted');assert.equal(t.bed,null);assert.equal(f.p.inside,null);assert.notDeepEqual(f.p.at,f.b.door);assert.notDeepEqual(f.p.at,f.source.door);assert.deepEqual(f.p.at,f.g.at);
});

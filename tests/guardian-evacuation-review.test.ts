import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';
import {disasterContains,type FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,activeCases,healthReason} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {floodFootprint} from '../src/world/weather-hazards.js';
import {passenger} from '../src/world/medical-transport.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout,residentBed} from '../src/shared/rooms.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(71);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'健康幼儿有限灾害护送隔离验收',width:24,height:16,tiles:Array<Tile>(384).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 for(let y=0;y<w.map.height;y++)w.map.tiles[y*w.map.width+12]='water';
 const b:Building={...w.buildings.find(b=>b.kind==='lodge')!,at:{x:4,y:4},width:4,height:4,door:{x:5,y:8},capacity:1,condition:100,ownerId:'commons',residents:[]};
 w.buildings=[b];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);w.residents.push({...structuredClone(w.residents[1]),id:'second-child',name:'另一位幼儿'});
 for(const r of w.residents){r.at={x:11,y:8};r.inside=null;r.roomAt=null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=[b.id];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;}
 const [guardian,child,other,secondChild]=w.residents;child.bornAt=w.minute-2*YEAR;child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;secondChild.at=other.at={x:1,y:14};
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d:FrontierDisaster={id:'observed-bank-flood',kind:'flashFlood',at:{x:12,y:8},radius:7,phase:'active',warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:floodFootprint(w,{x:12,y:8})};w.frontierHazards!.disasters=[d];
 return {w,guardian,child,other,secondChild,b,d};
}
const evacuation=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&a.evacuationDangerId!==undefined&&a.evacuationDestination!=='safe-ground';
function offered(w:World,r:Resident){return healthOpportunities(w,r).filter(c=>evacuation(c.action));}
function chosen(w:World,r:Resident){const menu=decisionChoices(decisionContext(w,r)),c=menu.find(c=>evacuation(c.action));assert.ok(c,'the real final menu offers the guardian a healthy-child evacuation');return parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction;}
function submit(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`guardian-evacuation:${w.revision}:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定是否护送眼前受灾幼儿',actions:[a]});assert.equal(result.ok,true,result.error);}
function until(w:World,predicate:()=>boolean){let guard=300;while(!predicate()){assert.ok(guard-->0,'actual evacuation progresses');stepWorld(w,1);}}
function finish(w:World,r:Resident){until(w,()=>!r.activity&&!r.plan);}
function pickup(f:ReturnType<typeof fixture>){submit(f.w,f.guardian,chosen(f.w,f.guardian));until(f.w,()=>!!passenger(f.w,f.child.id)||!!f.guardian.lastFailure);assert.equal(f.guardian.lastFailure,null);return passenger(f.w,f.child.id)!;}

test('review: selected evacuation does not enter another visible flood warning on its route',()=>{
 const f=fixture();
 f.w.frontierHazards!.disasters.push({...structuredClone(f.d),id:'second-visible-flood',phase:'warning',at:{x:8,y:8},startsAt:f.w.minute+900,endsAt:f.w.minute+1800,footprint:[{x:8,y:8}]});
 const a=chosen(f.w,f.guardian);submit(f.w,f.guardian,a);
 let guard=400;
 while(f.guardian.activity||f.guardian.plan){assert.ok(guard-->0);stepWorld(f.w,.25);assert.notDeepEqual(f.child.at,{x:8,y:8},'child must not enter another witnessed danger');}
 assert.equal(f.w.health!.transports[0]?.phase,'delivered');
});

test('review: a new visible warning appearing after pickup is checked on each edge',()=>{
 const f=fixture();pickup(f);
 f.w.frontierHazards!.disasters.push({...structuredClone(f.d),id:'new-visible-flood',phase:'warning',at:{x:8,y:8},startsAt:f.w.minute+900,endsAt:f.w.minute+1800,footprint:[{x:8,y:8}]});
 let guard=400;
 while(f.guardian.activity||f.guardian.plan){assert.ok(guard-->0);stepWorld(f.w,.25);assert.notDeepEqual(f.child.at,{x:8,y:8},'child must stop before a newly witnessed danger');}
});

test('review: safe alternative route avoids an observed active windstorm',()=>{
 const f=fixture();
 f.w.frontierHazards!.disasters.push({...structuredClone(f.d),id:'second-visible-storm',kind:'windstorm',at:{x:8,y:8},radius:0,footprint:[{x:8,y:8}]});
 const a=chosen(f.w,f.guardian);submit(f.w,f.guardian,a);
 let guard=400;
 while(f.guardian.activity||f.guardian.plan){assert.ok(guard-->0);stepWorld(f.w,.25);assert.notDeepEqual(f.child.at,{x:8,y:8},'child must not enter another observed active storm');}
 assert.equal(f.w.health!.transports[0]?.phase,'delivered');
});

test('review: an absent resident still owns their registered bed',()=>{
 const f=fixture();f.b.residents=[f.other.id];f.other.homeId=f.b.id;
 assert.equal(residentBed(f.w,f.other,f.b),0,'fixture has a real registered residential bed');
 const menu=decisionChoices(decisionContext(f.w,f.guardian));
 assert.equal(menu.some(c=>evacuation(c.action)),false,'an empty but allocated bed is not an available evacuation bed');
});

test('review: a registered bed cannot be occupied through a selected evacuation',()=>{
 const f=fixture();f.b.residents=[f.other.id];f.other.homeId=f.b.id;
 const menu=decisionChoices(decisionContext(f.w,f.guardian)),c=menu.find(c=>evacuation(c.action));
 if(!c)return;
 submit(f.w,f.guardian,parseChoice(JSON.stringify({choice:c.id}),menu).actions[0]);finish(f.w,f.guardian);
 assert.notEqual(f.w.health!.transports[0]?.phase,'delivered','registered bed must not be displaced by evacuation');
});

test('review: a new registered bed claim is revalidated during transport',()=>{
 const f=fixture(),t=pickup(f);f.b.residents=[f.other.id];f.other.homeId=f.b.id;
 stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted','a newly allocated destination bed is no longer available');
});

test('review: accepted appointment competition is revalidated before the next carrying step',()=>{
 const f=fixture(),t=pickup(f),at={...f.child.at},inventory={...f.guardian.inventory};
 f.w.health!.appointments.push({id:'competing-care',doctorId:f.other.id,patientId:f.secondChild.id,buildingId:f.b.id,createdAt:f.w.minute,start:f.w.minute+60,end:f.w.minute+180,minutes:60,fee:0,account:'review-care',stock:{},status:'accepted',acceptedAt:f.w.minute,worked:0,paid:0,refunded:0,materialsUsed:false,lastAt:f.w.minute,reason:null});
 stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted');assert.deepEqual(f.child.at,at);assert.deepEqual(f.guardian.inventory,inventory);
});

test('review: registered rights exclude only the allocated bed and preserve the child own bed',()=>{
 for(const owns of [false,true]){
  const f=fixture();f.b.capacity=owns?1:2;
  const holder=owns?f.child:f.other;f.b.residents=[holder.id];holder.homeId=f.b.id;
  const t=pickup(f);assert.equal(t.bed,owns?0:1);finish(f.w,f.guardian);assert.equal(t.phase,'delivered');
 }
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {FrontierDisaster} from '../src/shared/frontier-hazards.js';
import type {HealthAction} from '../src/shared/health.js';
import {healthDefaults} from '../src/shared/process-definitions.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason,addHealthCase,activeCases} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import {passenger} from '../src/world/medical-transport.js';
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
 const [g,p,other]=w.residents;p.bornAt=w.minute-2*YEAR;p.guardianIds=[g.id];p.canDecide=p.canExpress=false;if(indoor)p.roomAt={x:5,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d:FrontierDisaster={id:'source-flood',kind:'flashFlood' as const,at:{...source.door},radius:2,phase:'active' as const,warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:[{...source.door}]};w.frontierHazards!.disasters=[d];
 return {w,g,p,other,source,d};
}
const ground=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&(a as HealthAction).evacuationDestination==='safe-ground';
function selected(f:ReturnType<typeof fixture>){const menu=decisionChoices(decisionContext(f.w,f.g)),c=menu.find(c=>ground(c.action));assert.ok(c,'real final menu must offer a limited guardian dry-ground evacuation without a bed');return {c,a:parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction};}
function queue(w:World,r:Resident,a:Action){const s=submitPlan(w,{id:`dry-ground:${w.minute}:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择将眼前幼儿临时撤到附近干地，不安排医疗或长期住处',actions:[a]});assert.equal(s.ok,true,s.error);}
function until(w:World,done:()=>boolean){let n=1500;while(!done()){assert.ok(n-->0,'bounded actual movement');stepWorld(w,.25);}}
function finish(w:World,r:Resident){until(w,()=>!r.activity&&!r.plan);}
function pickup(f:ReturnType<typeof fixture>){queue(f.w,f.g,selected(f).a);until(f.w,()=>!!passenger(f.w,f.p.id)||!!f.g.lastFailure);assert.equal(f.g.lastFailure,null);return passenger(f.w,f.p.id)!;}

function secondFlood(f:ReturnType<typeof fixture>){
 const first=pickup(f);finish(f.w,f.g);assert.equal(first.phase,'delivered');assert.equal(activeCases(f.w,f.p.id).length,0);
 f.d.phase='ended';const landing={...f.p.at};
 const second:FrontierDisaster={...structuredClone(f.d),id:'second-flood',phase:'active',at:landing,footprint:[landing],startsAt:f.w.minute,endsAt:f.w.minute+1000,exposure:{},lastSteppedAt:f.w.minute};
 f.w.frontierHazards!.disasters.push(second);stepWorld(f.w,24);
 const injury=activeCases(f.w,f.p.id)[0];assert.ok(injury);assert.equal(injury.severity,2.15);assert.equal(f.p.health,99);assert.deepEqual(f.p.at,landing);
 return {first,second,landing,injury};
}

test('injured child: two real floods lead through a fresh final-menu choice to a second actual dry-ground delivery',()=>{
 const f=fixture(),rights=structuredClone({home:f.p.homeId,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory}),{first,second,landing,injury}=secondFlood(f);
 assert.equal(f.w.frontierHazards!.weather!.enabled,false);assert.equal(f.w.buildings.length,0);
 decisionContext(f.w,f.g);const before=structuredClone(f.w),{a,c}=selected(f);assert.deepEqual(f.w,before);assert.equal(a.evacuationDangerId,second.id);assert.match(c.label,/医疗/);
 assert.equal(healthOpportunities(f.w,f.g).some(c=>c.action.type==='health'&&c.action.targetId===f.p.id&&c.action.operation==='stabilize'),false);
 assert.equal(healthReason(f.w,f.g,{...a,operation:'stabilize'} as HealthAction)!==null,true);
 queue(f.w,f.g,a);until(f.w,()=>!!passenger(f.w,f.p.id));const t=passenger(f.w,f.p.id)!;assert.equal(t.phase,'carrying');assert.equal(t.bed,null);assert.equal(t.buildingId,null);assert.notEqual(t.id,first.id);
 finish(f.w,f.g);assert.equal(t.phase,'delivered',t.reason??'');assert.notDeepEqual(f.p.at,landing);assert.deepEqual(f.p.at,t.evacuationGround);assert.equal(f.g.inventory.cloth,1);assert.equal(f.g.inventory.water,7);assert.equal(f.g.inventory.medicine,2);
 assert.equal(injury.treatment,0);assert.equal(injury.stage,'acute');assert.equal(f.w.health!.appointments.length,0);assert.equal(f.w.health!.transportOffers.length,0);
 assert.deepEqual({home:f.p.homeId,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory},rights);
 assert.equal(f.w.events.filter(e=>e.hazardFact?.phase==='retreat'&&e.hazardFact.targetId===f.p.id).length,2);
});

for(const kind of ['injury','illness'] as const)for(const severity of [.1,19.99,20,49])test(`injured child: ${kind} severity ${severity} is eligible for bounded ground evacuation, without treatment`,()=>{
 const f=fixture(),c=addHealthCase(f.w,f.p,kind,severity,'isolated clinical state')!,t=pickup(f);finish(f.w,f.g);
 assert.equal(t.phase,'delivered');assert.equal(c.treatment,0);assert.equal(f.g.inventory.medicine,2);assert.equal(f.w.health!.appointments.length,0);
});

for(const phase of ['injury-after-first-delivery','second-pickup','second-carrying','second-delivered'] as const)test(`injured child: ${phase} survives in-memory SQLite with original harm, rights and one-time costs`,()=>{
 const f=fixture(),{second}=secondFlood(f);if(phase!=='injury-after-first-delivery')queue(f.w,f.g,selected(f).a);
 if(phase==='second-pickup')stepWorld(f.w,.25);
 if(['second-carrying','second-delivered'].includes(phase))until(f.w,()=>!!passenger(f.w,f.p.id));
 if(phase==='second-delivered')finish(f.w,f.g);
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!;
  assert.deepEqual(activeCases(w,p.id),activeCases(f.w,f.p.id));assert.equal(w.frontierHazards!.weather!.enabled,false);
  if(phase==='injury-after-first-delivery'){const menu=decisionChoices(decisionContext(w,g)),choice=menu.find(c=>ground(c.action));assert.ok(choice);queue(w,g,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);}
  finish(w,g);assert.equal(w.health!.transports.length,2);const t=w.health!.transports[1];assert.equal(t.phase,'delivered',t.reason??'');assert.equal(t.evacuationDangerId,second.id);assert.deepEqual(p.at,t.evacuationGround);assert.equal(g.inventory.cloth,1);assert.equal(g.inventory.water,7);assert.equal(activeCases(w,p.id)[0].treatment,0);
  stepWorld(w,1);assert.equal(w.health!.transports.length,2);assert.equal(g.inventory.cloth,1);
 }finally{store.close();}
});

for(const state of ['severe','critical-stage','critical-threshold','severe-threshold','low-health','critical-health','mixed-cases'] as const)test(`injured child: ${state} never assumes a safe no-bed carry from menu or a stale selected action`,()=>{
 const f=fixture(),a=selected(f).a,c=addHealthCase(f.w,f.p,'injury',2.15,'isolated change')!;
 if(state==='severe')c.severity=50;if(state==='critical-stage')c.stage='critical';
 if(state==='critical-threshold')c.rules={...healthDefaults,criticalSeverity:2};
 if(state==='severe-threshold')c.rules={...healthDefaults,severeSeverity:2};
 if(state==='low-health')f.p.health=44.99;if(state==='critical-health')c.rules={...healthDefaults,criticalHealth:100};
 if(state==='mixed-cases')addHealthCase(f.w,f.p,'illness',70,'second unsafe condition');
 assert.equal(healthOpportunities(f.w,f.g).some(c=>ground(c.action)),false);assert.ok(healthReason(f.w,f.g,a));
 queue(f.w,f.g,a);finish(f.w,f.g);assert.equal(f.w.health!.transports.length,0);assert.equal(f.g.inventory.cloth,3);assert.equal(f.g.inventory.water,9);
});

test('injured child: severity becoming unsafe during pickup or carrying stops before further movement and never manufactures treatment',()=>{
 for(const phase of ['pickup','carrying']){const f=fixture(),c=addHealthCase(f.w,f.p,'injury',2.15,'isolated change')!;queue(f.w,f.g,selected(f).a);
  if(phase==='pickup')stepWorld(f.w,.25);else until(f.w,()=>!!passenger(f.w,f.p.id));
  const at={...f.p.at},stock={...f.g.inventory},t=passenger(f.w,f.p.id);c.severity=60;stepWorld(f.w,.25);finish(f.w,f.g);
  assert.deepEqual(f.p.at,at);assert.deepEqual(f.g.inventory,stock);assert.equal(c.treatment,0);if(t)assert.equal(t.phase,'interrupted');else assert.equal(f.w.health!.transports.length,0);
 }
});

test('injured child: renewed danger never overrides current guardianship, refusal, visibility or blocked ground',()=>{
 for(const change of [(f:ReturnType<typeof fixture>)=>{f.p.refusesCare=true;},f=>{f.p.guardianIds=[];},f=>{f.g.canDecide=false;},f=>{f.g.canExpress=false;},f=>{f.d.footprint=[];},f=>{f.d.phase='ended';},f=>{for(const at of [{x:10,y:8},{x:12,y:8},{x:11,y:7},{x:11,y:9}])f.w.map.tiles[at.y*f.w.map.width+at.x]='cliff';}] as Array<(f:ReturnType<typeof fixture>)=>void>){const f=fixture();addHealthCase(f.w,f.p,'injury',2.15,'isolated state');change(f);assert.equal(healthOpportunities(f.w,f.g).some(c=>ground(c.action)),false);}
});

test('injured child: new danger at bound landing interrupts carrying and a new menu decision is required',()=>{
 const f=fixture();addHealthCase(f.w,f.p,'injury',2.15,'isolated state');const t=pickup(f),at={...f.p.at},target={...t.evacuationGround!};
 f.w.frontierHazards!.disasters.push({...structuredClone(f.d),id:'new-landing-flood',at:target,footprint:[target],phase:'warning',startsAt:f.w.minute+100});
 stepWorld(f.w,.25);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.deepEqual(t.evacuationGround,target);assert.equal(f.g.activity,null);assert.equal(f.w.health!.transports.length,1);
});

test('injured child: expressive nondeciding passenger can stop second evacuation immediately using only its own menu',()=>{
 const f=fixture();secondFlood(f);const t=pickup(f),at={...f.p.at};f.p.canExpress=true;assert.equal(f.p.canDecide,false);
 const menu=decisionChoices(decisionContext(f.w,f.p)),stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'&&c.action.transportId===t.id);assert.ok(stop);
 queue(f.w,f.p,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);assert.equal(t.phase,'interrupted');assert.equal(f.p.canDecide,false);stepWorld(f.w,.25);assert.deepEqual(f.p.at,at);assert.equal(f.g.activity,null);
});

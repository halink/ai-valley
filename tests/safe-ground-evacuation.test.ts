import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {healthPanel} from '../src/client/health.js';
import {residentActivity} from '../src/client/resident-status.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {HealthAction} from '../src/shared/health.js';
import {createWorld} from '../src/world/seed.js';
import {guardianGroundRoute} from '../src/world/guardian-evacuation.js';
import {initializeHealth,healthReason} from '../src/world/health.js';
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

test('safe ground: no-bed choice is read-only and waiting never moves a child',()=>{
 const f=fixture();decisionContext(f.w,f.g);const before=structuredClone(f.w),{c}=selected(f);assert.match(c.label,/干地/);assert.deepEqual(f.w,before);
 assert.equal(healthOpportunities(f.w,f.g).some(c=>c.action.type==='health'&&c.action.operation==='stabilize'),false);
 queue(f.w,f.g,{type:'wait',minutes:1});finish(f.w,f.g);assert.deepEqual(f.p.at,f.source.door);assert.equal(f.w.health!.transports.length,0);
});
test('safe ground: actual pickup and carrying use one cloth and water, finish outdoors without new rights',()=>{
 const f=fixture(),rights=structuredClone({home:f.p.homeId,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory}),t=pickup(f),start={...f.p.at};
 assert.equal(t.buildingId,null);assert.equal(t.bed,null);assert.equal(f.g.inventory.cloth,2);assert.equal(f.g.inventory.water,8);assert.deepEqual(f.p.at,start);
 finish(f.w,f.g);assert.equal(t.phase,'delivered',t.reason??'');assert.equal(f.p.inside,null);assert.equal(f.p.roomAt,null);assert.notDeepEqual(f.p.at,start);assert.deepEqual(f.p.at,f.g.at);
 assert.deepEqual({home:f.p.homeId,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory},rights);assert.equal(f.w.health!.cases.length,0);assert.equal(f.w.health!.appointments.length,0);
});
test('safe ground: indoors defers unknown exterior choice until actual room exit',()=>{
 const f=fixture(true),{a,c}=selected(f);assert.match(c.label,/出门|门外/);assert.equal(a.evacuationGround,undefined);assert.equal(a.evacuationExitId,f.source.id);
 const t=pickup(f),start={...f.p.roomAt!};assert.equal(t.evacuationGround,undefined);assert.equal(f.p.inside,f.source.id);assert.ok(f.g.activity!.room?.path.length);
 stepWorld(f.w,1);assert.equal(f.p.inside,f.source.id);assert.deepEqual(f.p.roomAt,f.g.roomAt);assert.notDeepEqual(f.p.roomAt,start);
 until(f.w,()=>f.g.inside===null);assert.deepEqual(f.p.at,f.source.door);assert.ok(t.evacuationGround);finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.equal(f.p.inside,null);
});

test('safe ground: unrelated, older, absent, refusing, protected or unwitnessed children get no entrance',()=>{
 const changes:Array<(f:ReturnType<typeof fixture>)=>void>=[f=>{f.p.guardianIds=[];},f=>{f.p.bornAt=f.w.minute-6*YEAR;},f=>{f.p.bornAt=f.w.minute-30*YEAR;f.p.canDecide=false;},f=>{f.p.refusesCare=true;},f=>{f.g.canExpress=false;},f=>{f.g.canDecide=false;},f=>{f.g.energy=9;},f=>{f.g.inventory.cloth=0;},f=>{f.g.inventory.water=0;},f=>{f.p.at={x:1,y:1};},f=>{f.d.footprint=[];},f=>{f.d.phase='ended';},f=>{f.p.residency='outside';},f=>{f.p.health=40;}];
 for(const change of changes){const f=fixture();change(f);assert.equal(healthOpportunities(f.w,f.g).some(c=>ground(c.action)&&c.action.evacuationAuthority!=='incapacitated-adult'),false,'guardian authority never extends to adults; separate adult emergency rules have their own tests');}
 const f=fixture(true);f.d.kind='windstorm';assert.equal(healthOpportunities(f.w,f.g).some(c=>ground(c.action)),false,'a sound room already shelters the child from wind');
});
test('safe ground: pickup revalidates source danger, refusal, current guardian and exit without spending',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.d.phase='ended';},f=>{f.p.refusesCare=true;},f=>{f.p.guardianIds=[];},f=>{f.p.roomAt=null;},f=>{f.source.ownerId=f.other.id;}] as Array<(f:ReturnType<typeof fixture>)=>void>){
  const f=fixture(true),a=selected(f).a,stock={...f.g.inventory},at=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt});queue(f.w,f.g,a);stepWorld(f.w,.25);mutate(f);const after=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt});finish(f.w,f.g);assert.ok(f.g.lastFailure);assert.equal(f.w.health!.transports.length,0);assert.deepEqual(f.g.inventory,stock);assert.deepEqual({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt},after);assert.deepEqual(f.p.at,at.at);
 }
});
test('safe ground: ending the source hazard after pickup does not strand the child',()=>{
 for(const indoor of [false,true]){const f=fixture(indoor),t=pickup(f),stock={...f.g.inventory};f.d.phase='ended';finish(f.w,f.g);assert.equal(t.phase,'delivered',t.reason??'');assert.deepEqual(f.g.inventory,stock);assert.deepEqual(f.p.at,f.g.at);assert.equal(f.p.inside,null);}
});
test('safe ground: current guardian loss, refusal, carrier incapacity or death stops at the actual point',()=>{
 for(const indoor of [false,true])for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.p.guardianIds=[];},f=>{f.p.refusesCare=true;},f=>{f.g.canDecide=false;},f=>{f.g.status='dead';}] as Array<(f:ReturnType<typeof fixture>)=>void>){
  const f=fixture(indoor),t=pickup(f),at=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt}),stock={...f.g.inventory};mutate(f);stepWorld(f.w,.25);assert.equal(t.phase,'interrupted');assert.deepEqual({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt},at);assert.deepEqual(f.g.inventory,stock);assert.equal(passenger(f.w,f.p.id),undefined);
 }
});
test('safe ground: capable child stops from actual menu immediately, before another carrying step',()=>{
 for(const indoor of [false,true]){const f=fixture(indoor),t=pickup(f);f.p.canDecide=f.p.canExpress=true;const at=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt}),menu=decisionChoices(decisionContext(f.w,f.p)),stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'&&c.action.transportId===t.id);assert.ok(stop);queue(f.w,f.p,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);assert.equal(t.phase,'interrupted');stepWorld(f.w,.25);assert.deepEqual({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt},at);assert.equal(f.g.activity,null);}
});
test('safe ground: current guardian can stop from menu without refunding spent pickup materials',()=>{
 const f=fixture(true),t=pickup(f),stock={...f.g.inventory},room={...f.p.roomAt!};const menu=decisionChoices(decisionContext(f.w,f.g)),stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'&&c.action.transportId===t.id);assert.ok(stop);queue(f.w,f.g,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.roomAt,room);assert.deepEqual(f.g.inventory,stock);
});
test('safe ground: an indoor blocked exterior is not inspected until actual exit, then stops at the door',()=>{
 const f=fixture(true),before=healthOpportunities(f.w,f.g).filter(c=>ground(c.action));for(const at of [{x:10,y:8},{x:12,y:8},{x:11,y:9}])f.w.map.tiles[at.y*f.w.map.width+at.x]='cliff';
 assert.deepEqual(healthOpportunities(f.w,f.g).filter(c=>ground(c.action)),before);const t=pickup(f);assert.equal(t.phase,'carrying');assert.equal(f.g.inside,f.source.id);finish(f.w,f.g);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,f.source.door);assert.equal(f.p.inside,null);assert.equal(t.evacuationGround,undefined);assert.match(t.reason!,/实际出门/);
});
test('safe ground: pickup, room exit, outdoor route and completion survive SQLite without duplicate charge',()=>{
 for(const phase of ['pickup','room','door','route','complete'] as const){
  const f=fixture(phase!=='route');let t;
  if(phase==='pickup'){queue(f.w,f.g,selected(f).a);stepWorld(f.w,1);}else{t=pickup(f);if(phase==='door')until(f.w,()=>f.g.inside===null);if(phase==='route'){f.d.phase='ended';stepWorld(f.w,.5);}if(phase==='complete')finish(f.w,f.g);}
  const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!;assert.deepEqual({at:p.at,inside:p.inside,roomAt:p.roomAt},{at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt});finish(w,g);const loaded=w.health!.transports[0];assert.equal(loaded.phase,'delivered',loaded.reason??g.lastFailure??'');assert.equal(loaded.buildingId,null);assert.equal(loaded.bed,null);assert.equal(g.inventory.cloth,2);assert.equal(g.inventory.water,8);assert.equal(p.inside,null);assert.deepEqual(p.at,g.at);const completion=()=>w.events.filter(e=>e.hazardFact?.targetId===p.id&&e.hazardFact?.phase==='retreat').length;assert.equal(completion(),1);stepWorld(w,1);assert.equal(completion(),1);assert.equal(w.frontierHazards!.weather!.enabled,false);}finally{store.close();}
 }
});
test('safe ground: stale pending pickup reload still needs original threat and never spends twice',()=>{
 const f=fixture(true);queue(f.w,f.g,selected(f).a);stepWorld(f.w,1);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!;w.frontierHazards!.disasters[0].phase='ended';finish(w,g);assert.equal(w.health!.transports.length,0);assert.equal(g.inventory.cloth,3);assert.equal(g.inventory.water,9);}finally{store.close();}
});
test('safe ground: building, ferry, offer and non-rescue mixtures cannot expand evacuation authority',()=>{
 const f=fixture(),a=selected(f).a;
 for(const bad of [{...a,buildingId:'any'},{...a,offerId:'any'},{...a,operation:'stabilize'},{...a,operation:'rescueOffer'},{...a,evacuationDestination:undefined},{...a,evacuationDangerId:undefined},{...a,evacuationGround:{x:NaN,y:8}},{...a,evacuationGround:{x:100,y:100}},{...a,evacuationExitId:'fake'}])assert.ok(healthReason(f.w,f.g,bad as HealthAction));
});
test('safe ground: ground-only modes never acquire a later available bed or silently reroute',()=>{
 const f=fixture(),t=pickup(f);f.w.buildings.push({...f.source,id:'new-bed',at:{x:2,y:2},door:{x:4,y:6},capacity:4});f.g.knownBuildings.push('new-bed');finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.equal(t.bed,null);assert.equal(t.buildingId,null);assert.equal(f.p.inside,null);assert.equal(f.p.homeId,null);
});

test('safe ground: expression alone permits only silence or stopping own carry, never general decisions',()=>{
 for(const indoor of [false,true]){
  const f=fixture(indoor),t=pickup(f);f.p.canExpress=true;f.p.canDecide=false;const menu=decisionChoices(decisionContext(f.w,f.p));assert.equal(menu.length,2);assert.ok(menu.every(c=>c.action.type==='wait'||c.action.type==='health'&&c.action.operation==='cancelRescue'));
  const wait=menu.find(c=>c.action.type==='wait')!;queue(f.w,f.p,parseChoice(JSON.stringify({choice:wait.id}),menu).actions[0]);assert.equal(f.p.plan,null);assert.equal(f.p.activity,null);assert.equal(t.phase,'carrying');assert.equal(f.p.canDecide,false);
  const plan=(a:Action)=>({id:`invalid:${f.w.revision}`,actorId:f.p.id,actorRevision:f.p.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'不能扩大权限',actions:[a]});
  for(const a of [{type:'move',to:{x:1,y:1}},{type:'wait',minutes:16},{type:'health',operation:'selfTreat'},{type:'health',operation:'cancelRescue',transportId:'someone-else'}] as Action[])assert.equal(submitPlan(f.w,plan(a)).ok,false);
  const stop=menu.find(c=>c.action.type==='health')!;queue(f.w,f.p,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);assert.equal(t.phase,'interrupted');assert.equal(f.p.canDecide,false);assert.equal(submitPlan(f.w,plan({type:'wait',minutes:1})).ok,false,'exception ends with that transport');
 }
});
test('safe ground: offline runtime gives expressive child the bounded refusal choice',async()=>{
 const f=fixture(true),t=pickup(f);f.p.canExpress=true;f.p.canDecide=false;f.p.decisionDue=f.w.minute;f.other.decisionDue=f.w.minute+1000;
 const store=new WorldStore(':memory:');store.commit(f.w,null);const requested:string[]=[];
 const runtime=new ValleyRuntime(store,'synthetic-test-credential',async(_key,context)=>{requested.push(context.actor.id);const choices=decisionChoices(context),stop=choices.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue');if(context.actor.id===f.p.id)assert.ok(stop);return {decision:stop?parseChoice(JSON.stringify({choice:stop.id}),choices):{intention:'停止护送后稍等',actions:[{type:'wait' as const,minutes:10}]},inputTokens:1,outputTokens:1,latencyMs:1};});
 try{runtime.start();await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(requested[0],f.p.id);assert.equal(requested.filter(id=>id===f.p.id).length,1);assert.equal(runtime.world.health!.transports.find(x=>x.id===t.id)!.phase,'interrupted');assert.equal(runtime.world.residents.find(r=>r.id===f.p.id)!.canDecide,false);}finally{runtime.stop();store.close();}
});
test('safe ground: public observation describes temporary ground instead of phantom receiving beds',()=>{
 const f=fixture(),t=pickup(f);assert.match(healthPanel(f.w),/只临时撤险/);assert.doesNotMatch(healthPanel(f.w),/接收床位已保留/);assert.match(residentActivity(f.w,f.p).detail,/干地/);finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.match(healthPanel(f.w),/已临时落脚在干地/);assert.doesNotMatch(healthPanel(f.w),/已送入实际床位/);
});


test('safe ground: actual eight-edge boundary is inclusive and nine-edge detour is not a visible shortcut',()=>{
 const f=fixture();f.w.map={name:'bounded ground route',width:12,height:12,tiles:Array<Tile>(144).fill('cliff'),entrance:{x:2,y:2},settlement:{x:2,y:2}};
 const corridor=[{x:2,y:2},{x:2,y:3},{x:2,y:4},{x:2,y:5},{x:2,y:6},{x:3,y:6},{x:4,y:6},{x:4,y:5},{x:4,y:4},{x:4,y:3}];
 for(const at of corridor)f.w.map.tiles[at.y*f.w.map.width+at.x]='grass';f.g.at={...corridor[0]};f.p.at={...f.g.at};f.d.at={...f.g.at};f.d.footprint=corridor.slice(0,8);
 assert.equal(guardianGroundRoute(f.w,f.g,f.g.at,corridor[8])?.path.length,8);assert.equal(guardianGroundRoute(f.w,f.g,f.g.at,corridor[9]),null);
});

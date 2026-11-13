import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason,addHealthCase} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import {passenger} from '../src/world/medical-transport.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';

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

test('adult ground: local final menu is read-only, bounded and never automatic',()=>{
 const f=fixture();decisionContext(f.w,f.g);const before=structuredClone(f.w),{c,a}=selected(f);assert.match(c.label,/成人|成年/);assert.deepEqual(f.w,before);assert.equal(a.evacuationAuthority,'incapacitated-adult');
 queue(f.w,f.g,{type:'wait',minutes:1});finish(f.w,f.g);assert.equal(f.w.health!.transports.length,0);assert.deepEqual(f.p.at,f.source.door);
 for(const key of ['evacuationAuthority','evacuationGround','evacuationDangerId','targetId'])assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,[key]:'forged'}),[c]));
});
for(const indoor of [false,true])test(`adult ground: actual no-bed evacuation completes with no new rights (indoor=${indoor})`,()=>{
 const f=fixture(indoor),rights=structuredClone({home:f.p.homeId,parents:f.p.parents,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory}),t=pickup(f);
 assert.equal(t.basis,'emergency');assert.equal(t.evacuationAuthority,'incapacitated-adult');assert.equal(t.buildingId,null);assert.equal(t.bed,null);assert.equal(t.offerId,null);
 finish(f.w,f.g);assert.equal(t.phase,'delivered',t.reason??f.g.lastFailure??'');assert.equal(f.p.inside,null);assert.deepEqual(f.p.at,t.evacuationGround);assert.ok(t.evacuationSteps!<=8);assert.equal(f.g.inventory.cloth,2);assert.equal(f.g.inventory.water,8);assert.equal(f.g.inventory.medicine,2);
 assert.deepEqual({home:f.p.homeId,parents:f.p.parents,guardians:f.p.guardianIds,coins:f.p.coins,inventory:f.p.inventory},rights);assert.equal(f.p.canDecide,false);assert.equal(f.p.canExpress,false);assert.equal(f.w.frontierHazards!.weather!.enabled,false);

});
for(const phase of ['pickup','room','door','route','complete'] as const)test(`adult ground: SQLite ${phase} preserves mode, position and once-only expenditure`,()=>{
 const f=fixture(phase!=='route');if(phase==='pickup'){queue(f.w,f.g,selected(f).a);stepWorld(f.w,1);}else{pickup(f);if(phase==='door')until(f.w,()=>f.g.inside===null);if(phase==='route')stepWorld(f.w,.25);if(phase==='complete')finish(f.w,f.g);}
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!;
 assert.deepEqual({at:p.at,inside:p.inside,room:p.roomAt},{at:f.p.at,inside:f.p.inside,room:f.p.roomAt});finish(w,g);const t=w.health!.transports[0];assert.equal(t.phase,'delivered',t.reason??g.lastFailure??'');assert.equal(t.evacuationAuthority,'incapacitated-adult');assert.equal(t.basis,'emergency');assert.equal(g.inventory.cloth,2);assert.equal(g.inventory.water,8);assert.equal(w.health!.transports.length,1);
 const completions=()=>w.events.filter(e=>e.hazardFact?.targetId===p.id&&e.hazardFact?.phase==='retreat').length;assert.equal(completions(),1);stepWorld(w,1);assert.equal(completions(),1);
 }finally{store.close();}
});
test('adult ground: pending pickup rechecks incapacity, actual hazard, refusal and lawful contact without spending',()=>{
 const changes:Array<(f:ReturnType<typeof fixture>)=>void>=[f=>{f.p.canDecide=true;},f=>{f.p.refusesCare=true;},f=>{f.d.phase='ended' as never;},f=>{f.d.footprint=[];},f=>{f.p.roomAt=null;},f=>{f.source.ownerId=f.other.id;},f=>{f.g.energy=9;}];
 for(const change of changes){const f=fixture(true);queue(f.w,f.g,selected(f).a);stepWorld(f.w,.25);change(f);const at=structuredClone({at:f.p.at,inside:f.p.inside,room:f.p.roomAt});finish(f.w,f.g);assert.ok(f.g.lastFailure);assert.equal(f.w.health!.transports.length,0);assert.equal(f.g.inventory.cloth,3);assert.equal(f.g.inventory.water,9);assert.deepEqual({at:f.p.at,inside:f.p.inside,room:f.p.roomAt},at);}
});
test('adult ground: noncritical recovering health case preserves independent medical boundaries',()=>{
 const f=fixture(),c=addHealthCase(f.w,f.p,'injury',70,'synthetic recovery')!;c.stage='recovering';c.treatment=1;c.capacity={decide:true,express:true};
 const t=pickup(f);assert.equal(t.basis,'emergency');finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.equal(f.g.inventory.medicine,2);assert.equal(f.p.canDecide,false);assert.equal(c.capacity?.decide,true);
 assert.ok(healthReason(f.w,f.g,{type:'health',operation:'stabilize',targetId:f.p.id}));assert.equal(f.w.health!.appointments.length,0);
});
test('adult ground: actual health recovery restores own decisions, never silently resumes old carry',()=>{
 const f=fixture(),c=addHealthCase(f.w,f.p,'injury',70,'synthetic recovery')!;c.stage='recovering';c.treatment=1;c.capacity={decide:true,express:true};const t=pickup(f),at={...f.p.at};
 c.severity=50;stepWorld(f.w,.25);stepWorld(f.w,.25);assert.equal(f.p.canDecide,true);assert.equal(f.p.canExpress,true);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.equal(f.g.activity,null);assert.equal(passenger(f.w,f.p.id),undefined);
 const menu=decisionChoices(decisionContext(f.w,f.p));assert.ok(menu.some(c=>c.action.type==='move'||c.action.type==='eat'));queue(f.w,f.p,{type:'wait',minutes:1});finish(f.w,f.p);assert.equal(t.phase,'interrupted');
});
test('adult ground: health deterioration stops this mode and does not silently upgrade to medical rescue',()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at};f.p.health=20;stepWorld(f.w,.25);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.equal(t.bed,null);assert.equal(f.g.inventory.medicine,2);
});
test('adult ground: refusal, carrier incapacity, new ground danger and road obstruction stop before movement',()=>{
 for(const change of ['refusal','carrier','ground','blocked','binding'] as const){const f=fixture(),t=pickup(f),at={...f.p.at};
  if(change==='refusal')f.p.refusesCare=true;else if(change==='carrier')f.g.canDecide=false;else if(change==='ground')f.w.frontierHazards!.disasters.push({...f.d,id:'new-danger',at:{...t.evacuationGround!},footprint:[{...t.evacuationGround!}]});else if(change==='blocked')f.w.resources.push({id:'fallen-tree',kind:'tree',at:{...f.g.activity!.path[0]},amount:1,max:1,regrowthDays:0,lastHarvest:f.w.minute});else delete (f.g.activity!.action as HealthAction).evacuationAuthority;
  stepWorld(f.w,.25);assert.equal(t.phase,'interrupted',change);assert.deepEqual(f.p.at,at,change);assert.equal(f.g.inventory.cloth,2);assert.equal(f.g.inventory.water,8);
 }
});
test('adult ground: crowded final menu rotates two bounded evacuation choices without removing personal choices',()=>{
 const f=fixture();for(let n=0;n<4;n++)f.w.residents.push({...structuredClone(f.p),id:'dependent-'+n,name:'失能成人'+n});const seen=new Set<string>();
 for(let n=0;n<8;n++){const context=decisionContext(f.w,f.g);context.minute+=30*n;context.actor.agency={focus:'construction',goals:[],routines:[],nextSerial:1};const menu=decisionChoices(context),choices=menu.filter(c=>ground(c.action));assert.equal(choices.length,2);assert.ok(menu.length<=56);assert.ok(menu.some(c=>c.action.type==='wait'));assert.ok(menu.some(c=>c.action.type==='eat'));for(const c of choices)seen.add((c.action as HealthAction).targetId!);}
 assert.equal(seen.size,5);assert.equal(f.w.health!.transports.length,0);
});
test('adult ground: offline runtime dispatches expression-only adult stop without granting general capacity',async()=>{
 const f=fixture(true),t=pickup(f);f.p.canExpress=true;f.p.decisionDue=f.w.minute;f.other.decisionDue=f.w.minute+1000;
 const store=new WorldStore(':memory:');store.commit(f.w,null);const ids:string[]=[];
 const runtime=new ValleyRuntime(store,'synthetic-offline-credential',async(_key,context)=>{ids.push(context.actor.id);const menu=decisionChoices(context),stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue');return {decision:stop?parseChoice(JSON.stringify({choice:stop.id}),menu):{intention:'稍等',actions:[{type:'wait' as const,minutes:10}]},inputTokens:1,outputTokens:1,latencyMs:1};});
 try{runtime.start();await new Promise<void>(r=>setImmediate(r));await new Promise<void>(r=>setImmediate(r));assert.equal(ids[0],f.p.id);assert.equal(runtime.world.health!.transports.find(x=>x.id===t.id)!.phase,'interrupted');assert.equal(runtime.world.residents.find(p=>p.id===f.p.id)!.canDecide,false);assert.equal(runtime.world.health!.evacuationRefusals![0].patientId,f.p.id);}finally{runtime.stop();store.close();}
});
test('adult ground: prior childhood guardian list grants no new adult proxy power',()=>{
 const f=fixture(),t=pickup(f);f.p.guardianIds=[f.other.id];
 assert.ok(healthReason(f.w,f.other,{type:'health',operation:'cancelRescue',transportId:t.id}));
 assert.equal(healthReason(f.w,f.g,{type:'health',operation:'cancelRescue',transportId:t.id}),null);finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.deepEqual(f.p.guardianIds,[f.other.id]);
});

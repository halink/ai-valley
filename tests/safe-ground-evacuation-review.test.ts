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
 const [g,p,other]=w.residents;p.bornAt=w.minute-2*YEAR;p.guardianIds=[g.id];p.canDecide=p.canExpress=false;if(indoor)p.roomAt={x:5,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d={id:'source-flood',kind:'flashFlood' as const,at:{...source.door},radius:2,phase:'active' as const,warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:[{...source.door}]};w.frontierHazards!.disasters=[d];
 return {w,g,p,other,source,d};
}
const ground=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&(a as HealthAction).evacuationDestination==='safe-ground';
function selected(f:ReturnType<typeof fixture>){const menu=decisionChoices(decisionContext(f.w,f.g)),c=menu.find(c=>ground(c.action));assert.ok(c,'real final menu must offer a limited guardian dry-ground evacuation without a bed');return {c,a:parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction};}
function queue(w:World,r:Resident,a:Action){const s=submitPlan(w,{id:`dry-ground:${w.minute}:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择将眼前幼儿临时撤到附近干地，不安排医疗或长期住处',actions:[a]});assert.equal(s.ok,true,s.error);}
function until(w:World,done:()=>boolean){let n=1500;while(!done()){assert.ok(n-->0,'bounded actual movement');stepWorld(w,.25);}}
function finish(w:World,r:Resident){until(w,()=>!r.activity&&!r.plan);}
function pickup(f:ReturnType<typeof fixture>){queue(f.w,f.g,selected(f).a);until(f.w,()=>!!passenger(f.w,f.p.id)||!!f.g.lastFailure);assert.equal(f.g.lastFailure,null);return passenger(f.w,f.p.id)!;}

// Independent adversarial checks; all worlds and SQLite databases are isolated.
test('ground review: indoor menu and pickup do not query unseen exterior safety',()=>{
 const clear=fixture(true),blocked=fixture(true);
 for(let y=0;y<blocked.w.map.height;y++)for(let x=0;x<blocked.w.map.width;x++)if(x!==11||y!==8)blocked.d.footprint.push({x,y});
 const left=selected(clear),right=selected(blocked);
 assert.deepEqual(right.a,left.a);assert.equal(right.c.label,left.c.label);
 const lt=pickup(clear),rt=pickup(blocked);
 assert.equal(lt.evacuationGround,undefined);assert.equal(rt.evacuationGround,undefined);
 assert.deepEqual(clear.p.roomAt,blocked.p.roomAt);assert.equal(clear.g.inventory.cloth,blocked.g.inventory.cloth);
 until(blocked.w,()=>!blocked.g.inside);finish(blocked.w,blocked.g);
 assert.equal(rt.phase,'interrupted');assert.deepEqual(blocked.p.at,blocked.source.door);
 assert.equal(blocked.p.inside,null);assert.equal(rt.evacuationGround,undefined);
});

test('ground review: original danger ending after pickup does not abandon carried child',()=>{
 const f=fixture(),t=pickup(f);f.d.phase='ended' as never;
 finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.deepEqual(f.p.at,t.evacuationGround);
});

test('ground review: new target warning stops before movement, without alternate destination',()=>{
 const f=fixture(),t=pickup(f),before={...f.p.at},target={...t.evacuationGround!};
 f.w.frontierHazards!.disasters.push({...structuredClone(f.d),id:'new-warning',phase:'warning',at:target,footprint:[target],startsAt:f.w.minute+100});
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,before);assert.deepEqual(t.evacuationGround,target);assert.equal(f.g.activity,null);
 assert.equal(f.g.inventory.cloth,2);assert.equal(f.g.inventory.water,8);
});

test('ground review: dynamic obstacle on next actual edge stops at last physical position',()=>{
 const f=fixture(),t=pickup(f),before={...f.p.at},next=f.g.activity!.path[0];
 f.w.map.tiles[next.y*f.w.map.width+next.x]='cliff';
 stepWorld(f.w,1);assert.notEqual(t.phase,'delivered');assert.deepEqual(f.p.at,before);assert.equal(f.g.activity,null);
});

for(const revoke of ['refusal','guardian','fitness'] as const)test(`ground review: ${revoke} stops an indoor carry at the exact room position`,()=>{
 const f=fixture(true),t=pickup(f);stepWorld(f.w,.25);const at={...f.p.at},room={...f.p.roomAt!};
 if(revoke==='refusal')f.p.refusesCare=true;else if(revoke==='guardian')f.p.guardianIds=[];else f.g.energy=0;
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.deepEqual(f.p.roomAt,room);assert.equal(f.p.inside,f.source.id);assert.equal(f.g.activity,null);
});

test('ground review: mixed ground and medical payloads fail before resources or transport',()=>{
 for(const extra of [{buildingId:'source'},{offerId:'invented'},{evacuationExitId:'other'},{operation:'stabilize'},{evacuationGround:{x:100,y:8}}]){
  const f=fixture(),a={...selected(f).a,...extra} as HealthAction;
  assert.ok(healthReason(f.w,f.g,a));assert.equal(f.w.health!.transports.length,0);assert.equal(f.g.inventory.cloth,3);
 }
});

for(const corrupt of ['bed','building','basis','target'] as const)test(`ground review: malformed persisted ${corrupt} stops without new rights`,()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at};
 if(corrupt==='bed')t.bed=0;else if(corrupt==='building')t.buildingId='source';else if(corrupt==='basis')t.basis='emergency';else t.evacuationGround={x:1,y:1};
 syncMedicalTransport(f.w);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);assert.equal(f.p.homeId,null);assert.equal(f.g.activity,null);
});

test('ground review: reload while exiting preserves contact, one resource charge and terminal position',()=>{
 const f=fixture(true),t=pickup(f);stepWorld(f.w,.5);
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!,loaded=passenger(w,p.id)!;
  assert.deepEqual(g.activity!.room,f.g.activity!.room);assert.deepEqual(p.roomAt,f.p.roomAt);assert.equal(loaded.id,t.id);
  finish(w,g);assert.equal(loaded.phase,'delivered');assert.equal(g.inventory.cloth,2);assert.equal(g.inventory.water,8);assert.equal(p.inside,null);assert.deepEqual(p.at,loaded.evacuationGround);assert.equal(w.health!.transports.length,1);
 }finally{store.close();}
});

test('ground review: forged serialized path cannot teleport to its valid bound target',()=>{
 const f=fixture();f.d.footprint=[{x:11,y:8},{x:12,y:8},{x:10,y:8},{x:11,y:9},{x:11,y:7}];
 const t=pickup(f),at={...f.p.at};assert.ok(f.g.activity!.path.length>=2);
 f.g.activity!.path=[{...t.evacuationGround!}];stepWorld(f.w,1);
 assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);
});

test('ground review: forged serialized detour cannot turn eight steps into arbitrary walking',()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at},target={...t.evacuationGround!};
 f.g.activity!.path=[{x:11,y:9},{x:12,y:9},{x:13,y:9},{x:14,y:9},{x:14,y:10},{x:13,y:10},{x:12,y:10},{x:12,y:9},target];
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);
});

test('ground review: truncated saved room route cannot manufacture a doorway exit',()=>{
 const f=fixture(true),t=pickup(f),room={...f.p.roomAt!};
 assert.ok(f.g.activity!.room!.path.length);f.g.activity!.room!.path=[];
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.equal(f.p.inside,f.source.id);assert.deepEqual(f.p.roomAt,room);
});

test('ground review: newly obstructed room step interrupts without entering the obstruction',()=>{
 const f=fixture(true),t=pickup(f),room={...f.p.roomAt!},next={...f.g.activity!.room!.path[0]};
 f.other.status='dead';f.other.body={storedAt:f.source.id,carriedBy:null} as NonNullable<Resident['body']>;f.other.roomAt=next;
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.equal(f.p.inside,f.source.id);assert.deepEqual(f.p.roomAt,room);
});

test('ground review: actual child stop choice interrupts before carrier can move',()=>{
 const f=fixture(true),t=pickup(f),room={...f.p.roomAt!};f.p.canDecide=f.p.canExpress=true;
 const menu=decisionChoices(decisionContext(f.w,f.p)),c=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'&&c.action.transportId===t.id);assert.ok(c);
 queue(f.w,f.p,parseChoice(JSON.stringify({choice:c.id}),menu).actions[0]);stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted');assert.equal(f.p.inside,f.source.id);assert.deepEqual(f.p.roomAt,room);assert.equal(f.g.activity,null);
});

test('ground review: malformed null action point fails closed instead of throwing during synchronization',()=>{
 const f=fixture(),t=pickup(f),at={...f.p.at};
 (f.g.activity!.action as HealthAction).evacuationGround=null as never;
 assert.doesNotThrow(()=>syncMedicalTransport(f.w));assert.equal(t.phase,'interrupted');assert.deepEqual(f.p.at,at);
});

test('ground review: reload after one outdoor edge preserves cumulative movement budget',()=>{
 const f=fixture();f.d.footprint=[{x:11,y:8},{x:12,y:8},{x:10,y:8},{x:11,y:9},{x:11,y:7}];
 const t=pickup(f);until(f.w,()=>t.evacuationSteps===1);const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!,loaded=passenger(w,p.id)!;
  assert.equal(loaded.evacuationSteps,1);assert.deepEqual(g.activity!.path,f.g.activity!.path);finish(w,g);
  assert.equal(loaded.phase,'delivered');assert.ok(loaded.evacuationSteps!<=8);assert.deepEqual(p.at,loaded.evacuationGround);assert.equal(g.inventory.cloth,2);
 }finally{store.close();}
});

test('ground review: expressive nondeciding child can stop only own current ground transport',()=>{
 const f=fixture(true),t=pickup(f),room={...f.p.roomAt!};f.p.canExpress=true;assert.equal(f.p.canDecide,false);
 const menu=decisionChoices(decisionContext(f.w,f.p));assert.equal(menu.length,2);
 const stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue');assert.ok(stop);
 const action=parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0];
 queue(f.w,f.p,action);assert.equal(t.phase,'interrupted');assert.equal(f.p.canDecide,false);assert.deepEqual(f.p.roomAt,room);assert.equal(f.g.activity,null);
});

test('ground review: expression exception rejects mixed plans, attached movement and stale scope',()=>{
 const f=fixture(true),t=pickup(f);f.p.canExpress=true;
 const attempt=(actions:Action[])=>submitPlan(f.w,{id:`expression-review:${f.w.revision}`,actorId:f.p.id,actorRevision:f.p.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'验证有限表达不产生一般决定权限',actions});
 const stop:HealthAction={type:'health',operation:'cancelRescue',transportId:t.id};
 for(const actions of [[{type:'wait',minutes:1},stop],[{...stop,targetId:f.other.id}],[{...stop,buildingId:f.source.id}],[{...stop,offerId:'invented'}],[{...stop,evacuationGround:{x:1,y:1}}],[{type:'wait',minutes:Infinity}],[{type:'wait',minutes:0}],[{type:'wait',minutes:-1}]] as Action[][])assert.equal(attempt(actions).ok,false);
 assert.equal(t.phase,'carrying');assert.equal(f.p.canDecide,false);assert.equal(f.p.plan,null);
 f.p.canExpress=false;assert.equal(attempt([stop]).ok,false);f.p.canExpress=true;
 t.evacuationDestination='known-address';assert.equal(attempt([stop]).ok,false);t.evacuationDestination='safe-ground';
 t.phase='interrupted';assert.equal(attempt([stop]).ok,false);
});

// Personal refusal is independent of the infant authority needed to continue carrying.
// The old six-year rejection contradicted the later age-independent stop contract.
for(const age of [6,18,null])test(`ground review: personal stop at age ${age??'unknown'} grants no movement or positive consent`,()=>{
 const f=fixture(true),t=pickup(f);f.p.canExpress=true;f.p.bornAt=(age===null?null:f.w.minute-age*YEAR) as number;
 const before=structuredClone({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt,inventory:f.g.inventory,guardians:f.p.guardianIds,home:f.p.homeId});
 const choices=decisionChoices(decisionContext(f.w,f.p));assert.equal(choices.length,2);assert.ok(choices.every(c=>c.action.type==='wait'||c.action.type==='health'&&c.action.operation==='cancelRescue'));
 const stop=choices.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue')!,action=parseChoice(JSON.stringify({choice:stop.id}),choices).actions[0];
 const attempt=(actions:Action[])=>submitPlan(f.w,{id:`limited-stop:${f.w.revision}`,actorId:f.p.id,actorRevision:f.p.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'Only the person may stop their own current carry',actions});
 for(const actions of [[{type:'move',to:{x:1,y:1}}],[{type:'health',operation:'acceptRescue',offerId:'invented'}],[{type:'care',targetId:f.other.id}],[action,{type:'wait',minutes:1}]] as Action[][])assert.equal(attempt(actions).ok,false);
 assert.equal(t.phase,'carrying');queue(f.w,f.p,action);assert.equal(t.phase,'interrupted');assert.equal(f.p.canDecide,false);assert.equal(f.p.plan,null);assert.equal(f.g.activity,null);
 assert.deepEqual({at:f.p.at,inside:f.p.inside,roomAt:f.p.roomAt,inventory:f.g.inventory,guardians:f.p.guardianIds,home:f.p.homeId},before);
});

test('ground review: expression silence neither moves nor revives decision capacity and survives reload',()=>{
 const f=fixture(true),t=pickup(f),room={...f.p.roomAt!};f.p.canExpress=true;
 const menu=decisionChoices(decisionContext(f.w,f.p)),wait=menu.find(c=>c.action.type==='wait')!;
 queue(f.w,f.p,parseChoice(JSON.stringify({choice:wait.id}),menu).actions[0]);
 assert.equal(t.phase,'carrying');assert.equal(f.p.decisionDue,f.w.minute+15);assert.equal(f.p.plan,null);assert.equal(f.p.activity,null);assert.deepEqual(f.p.roomAt,room);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,p=w.residents.find(r=>r.id===f.p.id)!;assert.equal(p.canDecide,false);assert.equal(p.canExpress,true);assert.equal(p.decisionDue,f.p.decisionDue);const choices=decisionChoices(decisionContext(w,p));assert.equal(choices.length,2);assert.ok(choices.some(c=>c.action.type==='health'&&c.action.operation==='cancelRescue'));}finally{store.close();}
});

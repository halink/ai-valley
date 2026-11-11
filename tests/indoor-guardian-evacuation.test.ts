import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason,completeHealth} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {passenger} from '../src/world/medical-transport.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';

function fixture(){
 const w=createWorld(71);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';w.resources=[];w.plots=[];w.graves=[];
 w.map={name:'室内幼儿按已知地址护送隔离验收',width:44,height:18,tiles:Array<Tile>(792).fill('grass'),entrance:{x:1,y:10},settlement:{x:10,y:10}};
 const seed=w.buildings.find(b=>b.kind==='lodge')!;
 const source:Building={...structuredClone(seed),id:'source-home',kind:'home',name:'受灾住处',at:{x:9,y:6},width:4,height:4,door:{x:10,y:10},capacity:3,condition:100,ownerId:'commons',residents:[]};
 const destination:Building={...structuredClone(seed),id:'known-hall',name:'已知共屋',at:{x:29,y:6},width:4,height:4,door:{x:30,y:10},capacity:1,condition:100,ownerId:'commons',residents:[]};
 w.buildings=[source,destination];w.residents=w.residents.slice(0,3);
 for(const r of w.residents){r.at={...source.door};r.inside=source.id;r.roomAt={x:4,y:9};r.homeId=source.id;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=[source.id,destination.id];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;}
 const [guardian,child,other]=w.residents;child.bornAt=w.minute-2*YEAR;child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;child.roomAt={x:3,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;other.homeId=null;source.residents=[guardian.id,child.id];
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d={id:'source-flood',kind:'flashFlood' as const,at:{...source.door},radius:2,phase:'active' as const,warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:[guardian.id],exposure:{},footprint:[{...source.door}]};w.frontierHazards!.disasters=[d];
 return {w,guardian,child,other,source,destination,d};
}
const evacuation=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&a.evacuationDangerId!==undefined;
function choice(f:ReturnType<typeof fixture>){const menu=decisionChoices(decisionContext(f.w,f.guardian)),c=menu.find(c=>evacuation(c.action)&&c.action.buildingId===f.destination.id);assert.ok(c,'real final menu offers indoor guardian known-address evacuation');return {c,a:parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction};}
function queue(w:World,r:Resident,a:Action){const res=submitPlan(w,{id:`indoor-evacuation:${w.revision}:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定按已知地址尝试护送幼儿，到场验床',actions:[a]});assert.equal(res.ok,true,res.error);}
function until(w:World,predicate:()=>boolean){let limit=300;while(!predicate()){assert.ok(limit-->0,'finite actual movement');stepWorld(w,1);}}
function pickup(f:ReturnType<typeof fixture>){queue(f.w,f.guardian,choice(f).a);until(f.w,()=>!!passenger(f.w,f.child.id)||!!f.guardian.lastFailure);assert.equal(f.guardian.lastFailure,null);return passenger(f.w,f.child.id)!;}
function finish(f:ReturnType<typeof fixture>){until(f.w,()=>!f.guardian.activity&&!f.guardian.plan);}

test('indoor real menu offers an uncertain known address without moving anyone or promising a bed',()=>{
 const f=fixture();decisionContext(f.w,f.guardian);const before=structuredClone(f.w),{c,a}=choice(f);assert.match(c.label,/到场/);assert.match(c.label,/不保证|尚未确认/);assert.equal(a.evacuationDestination,'known-address');assert.deepEqual(f.w,before);
 assert.equal(healthOpportunities(f.w,f.guardian).some(c=>c.action.type==='health'&&['stabilize','rescueOffer'].includes(c.action.operation)),false);
 queue(f.w,f.guardian,{type:'wait',minutes:1});finish(f);assert.deepEqual(f.child.roomAt,{x:3,y:9});assert.equal(f.w.health!.transports.length,0);
});

test('pickup spends once, leaves the room by actual steps, reserves at the door and physically reaches the bed',()=>{
 const f=fixture(),t=pickup(f);assert.equal(t.bed,null);assert.equal(t.evacuationDestination,'known-address');assert.equal(f.child.inside,f.source.id);assert.ok(f.guardian.activity!.room?.path.length);assert.equal(f.guardian.inventory.cloth,2);
 const start={...f.child.roomAt!};stepWorld(f.w,1);assert.equal(f.child.inside,f.source.id);assert.notDeepEqual(f.child.roomAt,start);assert.deepEqual(f.child.roomAt,f.guardian.roomAt);assert.equal(t.bed,null);
 until(f.w,()=>f.guardian.inside===null);assert.deepEqual(f.child.at,f.source.door);assert.equal(t.bed,null);
 until(f.w,()=>f.guardian.at.x===f.destination.door.x-1);assert.equal(t.bed,null);stepWorld(f.w,1);assert.deepEqual(f.guardian.at,f.destination.door);assert.equal(f.guardian.inside,null);assert.equal(t.bed,0);
 finish(f);assert.equal(t.phase,'delivered',t.reason??f.guardian.lastFailure??'');assert.equal(f.child.inside,f.destination.id);assert.deepEqual(f.child.roomAt,roomLayout(f.w,f.destination).slots.find(s=>s.key==='bed:0')!.at);assert.equal(f.guardian.inventory.water,8);assert.equal(f.guardian.inventory.cloth,2);assert.equal(f.w.frontierHazards!.weather!.enabled,false);
});

test('remote bed occupancy, damage and warning do not change the offered known-address choice',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.destination.capacity=0;},(f:ReturnType<typeof fixture>)=>{f.destination.condition=0;},(f:ReturnType<typeof fixture>)=>{f.destination.residents=[f.other.id];f.other.homeId=f.destination.id;},(f:ReturnType<typeof fixture>)=>{f.w.frontierHazards!.disasters.push({...f.d,id:'hidden-warning',at:{...f.destination.door},phase:'warning',footprint:[{...f.destination.door}]});}]){
  const f=fixture(),before=choice(f).c;mutate(f);assert.deepEqual(choice(f).c,before);
 }
});

test('a full destination is discovered at the actual door without stealing an absent residents bed',()=>{
 const f=fixture();f.destination.residents=[f.other.id];f.other.homeId=f.destination.id;const t=pickup(f);assert.equal(t.bed,null);finish(f);
 assert.equal(t.phase,'interrupted');assert.deepEqual(f.guardian.at,f.destination.door);assert.deepEqual(f.child.at,f.destination.door);assert.equal(f.child.inside,null);assert.equal(f.guardian.inside,null);assert.equal(t.bed,null);assert.deepEqual(f.destination.residents,[f.other.id]);assert.equal(f.guardian.inventory.cloth,2);assert.equal(f.w.events.some(e=>e.text.includes('沿实际路线把')&&e.actors.includes(f.child.id)),false);
});

test('pickup still requires real current danger, same-room lawful contact, known address and child assent',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.guardian.knownBuildings=[f.source.id];},(f:ReturnType<typeof fixture>)=>{f.destination.ownerId=f.other.id;},(f:ReturnType<typeof fixture>)=>{f.child.refusesCare=true;},(f:ReturnType<typeof fixture>)=>{f.child.guardianIds=[];},(f:ReturnType<typeof fixture>)=>{f.child.bornAt=f.w.minute-30*YEAR;},(f:ReturnType<typeof fixture>)=>{f.d.footprint=[];},(f:ReturnType<typeof fixture>)=>{f.source.ownerId=f.other.id;f.source.residents=[f.child.id];},(f:ReturnType<typeof fixture>)=>{f.child.roomAt=null;}]){const f=fixture();mutate(f);assert.equal(healthOpportunities(f.w,f.guardian).some(c=>evacuation(c.action)&&c.action.evacuationDestination!=='safe-ground'),false);}
 const f=fixture(),a=choice(f).a,stock={...f.guardian.inventory};f.child.refusesCare=true;queue(f.w,f.guardian,a);finish(f);assert.deepEqual(f.guardian.inventory,stock);assert.equal(f.w.health!.transports.length,0);assert.deepEqual(f.child.roomAt,{x:3,y:9});
});

test('SQLite reload preserves unreserved route and room progress without spending or pickup twice',()=>{
 const f=fixture(),t=pickup(f);stepWorld(f.w,1);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,guardian=w.residents.find(r=>r.id===f.guardian.id)!,child=w.residents.find(r=>r.id===f.child.id)!,loaded=w.health!.transports.find(x=>x.id===t.id)!;assert.equal(loaded.bed,null);assert.equal(loaded.evacuationDestination,'known-address');assert.deepEqual(child.roomAt,f.child.roomAt);assert.deepEqual(guardian.activity!.room,f.guardian.activity!.room);const inventory={...guardian.inventory};w.frontierHazards!.disasters[0].phase='ended';until(w,()=>!guardian.activity&&!guardian.plan);assert.equal(loaded.phase,'delivered',loaded.reason??'');assert.deepEqual(guardian.inventory,inventory);assert.equal(w.health!.transports.length,1);assert.equal(w.events.filter(e=>e.text.includes('沿实际路线把')&&e.actors.includes(child.id)).length,1);assert.equal(w.frontierHazards!.weather!.enabled,false);}finally{store.close();}
});

test('a new actual room obstacle stops carrying at the last real indoor point',()=>{
 const f=fixture(),t=pickup(f);stepWorld(f.w,1);const at=structuredClone({at:f.child.at,inside:f.child.inside,roomAt:f.child.roomAt}),next=f.guardian.activity!.room!.path[0];
 f.other.status='dead';f.other.body={storedAt:f.source.id,carriedBy:null} as NonNullable<Resident['body']>;f.other.roomAt={...next};
 stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual({at:f.child.at,inside:f.child.inside,roomAt:f.child.roomAt},at);assert.equal(t.bed,null);assert.equal(f.guardian.inventory.cloth,2);
});

test('late remote damage and hazards do not interrupt indoors but are discovered before entry',()=>{
 for(const kind of ['damage','flood','storm'] as const){
  const f=fixture(),t=pickup(f);if(kind==='damage')f.destination.condition=0;else f.w.frontierHazards!.disasters.push({...f.d,id:'late-risk',at:{...f.destination.door},kind:kind==='storm'?'windstorm':'flashFlood',footprint:kind==='storm'?undefined:[{...f.destination.door}]});
  if(kind==='storm')f.destination.condition=34;
  stepWorld(f.w,1);assert.equal(t.phase,'carrying');assert.equal(f.child.inside,f.source.id);assert.equal(t.bed,null);finish(f);assert.equal(t.phase,'interrupted');assert.equal(f.child.inside,null);assert.deepEqual(f.child.at,f.guardian.at);assert.notDeepEqual(f.child.at,f.source.door);assert.notDeepEqual(f.child.at,f.destination.door);assert.equal(t.bed,null);
 }
});

test('pending pickup reload rechecks threat without spending supplies or moving the child',()=>{
 const f=fixture();queue(f.w,f.guardian,choice(f).a);stepWorld(f.w,1);assert.equal(f.w.health!.transports.length,0);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.guardian.id)!,p=w.residents.find(r=>r.id===f.child.id)!,stock={...g.inventory},at=structuredClone({at:p.at,inside:p.inside,roomAt:p.roomAt});assert.equal((g.activity!.action as HealthAction).evacuationDestination,'known-address');w.frontierHazards!.disasters[0].phase='ended';until(w,()=>!g.activity&&!g.plan);assert.ok(g.lastFailure);assert.deepEqual(g.inventory,stock);assert.equal(w.health!.transports.length,0);assert.deepEqual({at:p.at,inside:p.inside,roomAt:p.roomAt},at);}finally{store.close();}
});

test('door reservation reload keeps one real bed and still rechecks a newly acquired right',()=>{
 for(const competing of [false,true]){const f=fixture(),t=pickup(f);until(f.w,()=>t.bed!==null);assert.equal(f.guardian.inside,null);const store=new WorldStore(':memory:');
  try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.guardian.id)!,p=w.residents.find(r=>r.id===f.child.id)!,other=w.residents.find(r=>r.id===f.other.id)!,b=w.buildings.find(b=>b.id===f.destination.id)!,loaded=w.health!.transports.find(x=>x.id===t.id)!;const stock={...g.inventory};assert.equal(loaded.bed,0);if(competing){b.residents=[other.id];other.homeId=b.id;}until(w,()=>!g.activity&&!g.plan);assert.equal(loaded.phase,competing?'interrupted':'delivered');assert.equal(p.inside,competing?null:b.id);assert.deepEqual(g.inventory,stock);assert.equal(w.health!.transports.length,1);}finally{store.close();}
 }
});

test('unknown-address mode cannot be forged into other operations or silently removed during carrying',()=>{
 const f=fixture(),{a}=choice(f),menu=decisionChoices(decisionContext(f.w,f.guardian)),c=menu.find(c=>evacuation(c.action))!;assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,evacuationDestination:'known-address'}),menu));
 for(const forged of [{...a,evacuationDangerId:undefined},{...a,operation:'stabilize' as const},{...a,evacuationDestination:'invented' as 'known-address'}])assert.ok(healthReason(f.w,f.guardian,forged));
 queue(f.w,f.guardian,a);stepWorld(f.w,1);assert.ok(completeHealth(f.w,f.guardian,f.guardian.activity!.action as HealthAction));assert.equal(f.w.health!.transports.length,0);
 until(f.w,()=>!!passenger(f.w,f.child.id));const t=passenger(f.w,f.child.id)!,at=structuredClone({at:f.child.at,inside:f.child.inside,roomAt:f.child.roomAt});delete (f.guardian.activity!.action as HealthAction).evacuationDestination;stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual({at:f.child.at,inside:f.child.inside,roomAt:f.child.roomAt},at);assert.equal(f.w.health!.transports.length,1);
});

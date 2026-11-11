import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction} from '../src/shared/health.js';
import {disasterContains,type FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,activeCases,healthReason} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {floodFootprint} from '../src/world/weather-hazards.js';
import {passenger} from '../src/world/medical-transport.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
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
 const b={...w.buildings.find(b=>b.kind==='lodge')!,at:{x:4,y:4},width:4,height:4,door:{x:5,y:8},capacity:1,condition:100,ownerId:'commons',residents:[]};
 w.buildings=[b];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);w.residents.push({...structuredClone(w.residents[1]),id:'second-child',name:'另一位幼儿'});
 for(const r of w.residents){r.at={x:11,y:8};r.inside=null;r.roomAt=null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:3,medicine:2,meal:10};r.knownBuildings=[b.id];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;}
 const [guardian,child,other,secondChild]=w.residents;child.bornAt=w.minute-2*YEAR;child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;secondChild.at=other.at={x:1,y:14};
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 const d:FrontierDisaster={id:'observed-bank-flood',kind:'flashFlood',at:{x:12,y:8},radius:7,phase:'active',warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:floodFootprint(w,{x:12,y:8})};w.frontierHazards!.disasters=[d];
 return {w,guardian,child,other,secondChild,b,d};
}
const evacuation=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&a.evacuationDangerId!==undefined&&a.evacuationAuthority!=='incapacitated-adult';
function offered(w:World,r:Resident){return healthOpportunities(w,r).filter(c=>evacuation(c.action));}
function chosen(w:World,r:Resident){const menu=decisionChoices(decisionContext(w,r)),c=menu.find(c=>evacuation(c.action));assert.ok(c,'the real final menu offers the guardian a healthy-child evacuation');return parseChoice(JSON.stringify({choice:c.id}),menu).actions[0] as HealthAction;}
function submit(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`guardian-evacuation:${w.revision}:${w.minute}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人决定是否护送眼前受灾幼儿',actions:[a]});assert.equal(result.ok,true,result.error);}
function until(w:World,predicate:()=>boolean){let guard=300;while(!predicate()){assert.ok(guard-->0,'actual evacuation progresses');stepWorld(w,1);}}
function finish(w:World,r:Resident){until(w,()=>!r.activity&&!r.plan);}
function pickup(f:ReturnType<typeof fixture>){submit(f.w,f.guardian,chosen(f.w,f.guardian));until(f.w,()=>!!passenger(f.w,f.child.id)||!!f.guardian.lastFailure);assert.equal(f.guardian.lastFailure,null);return passenger(f.w,f.child.id)!;}

test('healthy young child has a bounded real-menu rescue without fabricated injury, stabilize or automatic movement',()=>{
 const {w,guardian,child,b,d}=fixture(),start={...child.at};assert.equal(activeCases(w,child.id).length,0);assert.equal(child.health,100);
 decisionContext(w,guardian);const before=structuredClone(w),a=chosen(w,guardian);assert.equal(a.evacuationDangerId,d.id);assert.equal(a.buildingId,b.id);assert.deepEqual(w,before);
 assert.equal(healthOpportunities(w,guardian).some(c=>c.action.type==='health'&&c.action.targetId===child.id&&['stabilize','rescueOffer','offer'].includes(c.action.operation)),false);
 assert.deepEqual(child.at,start);submit(w,guardian,a);stepWorld(w,.25);assert.deepEqual(child.at,start);assert.equal(passenger(w,child.id),undefined);
 until(w,()=>!!passenger(w,child.id));assert.equal(guardian.inventory.cloth,2);assert.equal(guardian.inventory.water,8);const t=passenger(w,child.id)!;assert.equal(t.basis,'guardian');assert.equal(t.evacuationDangerId,d.id);assert.equal(t.phase,'carrying');
 finish(w,guardian);assert.equal(t.phase,'delivered',t.reason??guardian.lastFailure??'');assert.equal(child.inside,b.id);assert.deepEqual(child.roomAt,roomLayout(w,b).slots.find(s=>s.key==='bed:0')!.at);assert.equal(activeCases(w,child.id).length,0);assert.equal(w.frontierHazards!.weather!.enabled,false);
});

test('healthy-child entrance requires a present guardian, actual unsheltered threat and the child not refusing',()=>{
 const changes:Array<(f:ReturnType<typeof fixture>)=>void>=[f=>{f.child.guardianIds=[];},f=>{f.child.refusesCare=true;},f=>{f.child.bornAt=f.w.minute-6*YEAR;},f=>{f.child.bornAt=f.w.minute-30*YEAR;f.child.canDecide=false;},f=>{f.d.phase='ended';},f=>{f.d.footprint=[{x:12,y:8}];},f=>{f.guardian.at={x:1,y:1};},f=>{f.guardian.inside=f.b.id;},f=>{f.guardian.canDecide=false;},f=>{f.guardian.canExpress=false;}];
 for(const change of changes){const f=fixture();change(f);assert.deepEqual(offered(f.w,f.guardian),[]);}
 const f=fixture();f.d.kind='windstorm';delete f.d.footprint;f.d.at={...f.b.door};for(const r of [f.guardian,f.child]){r.at={...f.b.door};r.inside=f.b.id;r.roomAt={...roomLayout(f.w,f.b).entry};}assert.deepEqual(offered(f.w,f.guardian),[],'a sound room already protects the child from wind');
});

test('only an actually available, accessible local safe bed and personal cloth and water make a choice',()=>{
 const changes:Array<(f:ReturnType<typeof fixture>)=>void>=[f=>{f.guardian.inventory.cloth=0;},f=>{f.guardian.inventory.water=0;},f=>{f.b.ownerId=f.other.id;},f=>{f.b.capacity=0;},f=>{f.b.condition=0;},f=>{f.guardian.knownBuildings=[];},f=>{f.d.footprint!.push({...f.b.door});},f=>{f.other.at={...f.b.door};f.other.inside=f.b.id;f.other.roomAt={...roomLayout(f.w,f.b).slots.find(s=>s.key==='bed:0')!.at};},f=>{for(let y=0;y<f.w.map.height;y++)f.w.map.tiles[y*f.w.map.width+9]='cliff';}];
 for(const change of changes){const f=fixture();change(f);assert.deepEqual(offered(f.w,f.guardian).filter(c=>(c.action as HealthAction).evacuationDestination!=='safe-ground'),[]);}
});

test('the guardian can instead choose to wait without moving or treating the child',()=>{
 const {w,guardian,child}=fixture();chosen(w,guardian);const at={...child.at},inventory={...guardian.inventory};submit(w,guardian,{type:'wait',minutes:1});finish(w,guardian);assert.deepEqual(child.at,at);assert.deepEqual(guardian.inventory,inventory);assert.equal(w.health!.transports.length,0);assert.equal(activeCases(w,child.id).length,0);
});

test('danger ending or actual threat moving away invalidates a stale selected evacuation before pickup',()=>{
 for(const change of ['ended','moved'] as const){const f=fixture(),a=chosen(f.w,f.guardian),before={...f.guardian.inventory},at={...f.child.at};if(change==='ended')f.d.phase='ended';else f.d.footprint=[{x:12,y:8}];submit(f.w,f.guardian,a);finish(f.w,f.guardian);assert.ok(f.guardian.lastFailure);assert.deepEqual(f.guardian.inventory,before);assert.deepEqual(f.child.at,at);assert.equal(f.w.health!.transports.length,0);}
});

test('two real guardians competing for one bed cannot double reserve or spend the losing supplies',()=>{
 const f=fixture(),{w,guardian,child,other,secondChild}=f;other.at={...guardian.at};secondChild.at={...child.at};secondChild.bornAt=child.bornAt;secondChild.guardianIds=[other.id];secondChild.canDecide=secondChild.canExpress=false;
 const first=chosen(w,guardian),second=chosen(w,other),stock={...other.inventory};submit(w,guardian,first);submit(w,other,second);until(w,()=>w.health!.transports.length>0&&!!other.lastFailure);assert.equal(w.health!.transports.length,1);assert.equal(w.health!.transports[0].patientId,child.id);assert.deepEqual(other.inventory,stock);assert.equal(passenger(w,secondChild.id),undefined);assert.deepEqual(secondChild.at,{x:11,y:8});
});

test('valid child and bed beyond earlier irrelevant entries remain discoverable',()=>{
 const f=fixture(),{w,guardian,child,b}=f;
 for(let i=0;i<4;i++){w.residents.unshift({...structuredClone(f.other),id:'unrelated:'+i,health:44});w.buildings.unshift({...structuredClone(b),id:'unavailable:'+i,capacity:0});guardian.knownBuildings.push('unavailable:'+i);}
 const a=chosen(w,guardian);assert.equal(a.targetId,child.id);assert.equal(a.buildingId,b.id);
});

test('crowded final menus reserve only two rotating guardian options beside waiting, eating and unrelated focus',()=>{
 const f=fixture(),{w,guardian,child,b}=f;b.capacity=6;
 for(let i=0;i<4;i++)w.residents.push({...structuredClone(child),id:'ward:'+i,name:'受灾幼儿'+i});
 assert.equal(offered(w,guardian).length,10);const seen=new Set<string>();
 for(let i=0;i<10;i++){
  const context=decisionContext(w,guardian);context.minute+=i*30;context.actor.agency={focus:'construction',goals:[],routines:[],nextSerial:1} as NonNullable<Resident['agency']>;
  context.formal!.opportunities.unshift(...Array.from({length:100},(_,n)=>({id:'busy:'+n,label:'已有课程',action:{type:'education' as const,operation:'teach' as const,lessonId:'lesson:'+n,minutes:30}})),...Array.from({length:80},(_,n)=>({id:'reply:'+n,label:'另行答复',action:{type:'respond' as const,proposalId:'proposal:'+n,accept:n%2===0}})));
  const menu=decisionChoices(context),choices=menu.filter(c=>evacuation(c.action));assert.equal(choices.length,2);assert.ok(menu.length<=56);assert.ok(menu.some(c=>c.action.type==='wait'));assert.ok(menu.some(c=>c.action.type==='eat'));for(const c of choices)seen.add((c.action as HealthAction).targetId!);
 }
 assert.equal(seen.size,5);assert.equal(guardian.plan,null);assert.equal(w.health!.transports.length,0);
});

test('pickup work is rechecked when its danger, guardian relationship or child refusal changes',()=>{
 for(const change of ['ended','guardian','refusal'] as const){const f=fixture(),a=chosen(f.w,f.guardian),before={...f.guardian.inventory},at={...f.child.at};submit(f.w,f.guardian,a);stepWorld(f.w,.25);assert.ok(f.guardian.activity);
  if(change==='ended')f.d.phase='ended';else if(change==='guardian')f.child.guardianIds=[f.other.id];else f.child.refusesCare=true;
  finish(f.w,f.guardian);assert.ok(f.guardian.lastFailure);assert.deepEqual(f.guardian.inventory,before);assert.deepEqual(f.child.at,at);assert.equal(f.w.health!.transports.length,0);
 }
});

test('SQLite reload retains pending danger binding and invalidated pickup never spends supplies',()=>{
 const f=fixture();submit(f.w,f.guardian,chosen(f.w,f.guardian));stepWorld(f.w,1);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(p=>p.id===f.guardian.id)!,p=w.residents.find(p=>p.id===f.child.id)!;assert.equal((g.activity!.action as HealthAction).evacuationDangerId,f.d.id);const stock={...g.inventory};w.frontierHazards!.disasters[0].phase='ended';finish(w,g);assert.ok(g.lastFailure);assert.deepEqual(g.inventory,stock);assert.equal(w.health!.transports.length,0);assert.deepEqual(p.at,f.child.at);}finally{store.close();}
});

test('SQLite reload retains carrying binding and finishing after danger ends never doubles supplies or delivery',()=>{
 const f=fixture(),t=pickup(f);stepWorld(f.w,1);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(p=>p.id===f.guardian.id)!,p=w.residents.find(p=>p.id===f.child.id)!,loaded=w.health!.transports.find(x=>x.id===t.id)!;assert.equal(loaded.evacuationDangerId,f.d.id);assert.equal((g.activity!.action as HealthAction).evacuationDangerId,f.d.id);const stock={...g.inventory};w.frontierHazards!.disasters[0].phase='ended';finish(w,g);assert.equal(loaded.phase,'delivered',loaded.reason??g.lastFailure??'');assert.equal(p.inside,f.b.id);assert.deepEqual(g.inventory,stock);const delivered=()=>w.events.filter(e=>e.actors.includes(p.id)&&e.text.includes('沿实际路线把')).length;assert.equal(delivered(),1);stepWorld(w,1);assert.equal(delivered(),1);assert.equal(w.frontierHazards!.weather!.enabled,false);}finally{store.close();}
});

test('current guardian loss, refusal and guardian incapacity interrupt carrying at the real position without consuming again',()=>{
 for(const change of ['guardian','refusal','incapacity'] as const){const f=fixture(),t=pickup(f);stepWorld(f.w,1);const at={...f.child.at},stock={...f.guardian.inventory};
  if(change==='guardian')f.child.guardianIds=[f.other.id];else if(change==='refusal')f.child.refusesCare=true;else f.guardian.canDecide=false;
  stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.child.at,at);assert.deepEqual(f.guardian.at,at);assert.deepEqual(f.guardian.inventory,stock);assert.equal(f.child.inside,null);assert.equal(passenger(f.w,f.child.id),undefined);
 }
});

test('the child may express an independent stop through the real passenger menu',()=>{
 const f=fixture();f.child.canDecide=f.child.canExpress=true;const t=pickup(f),at={...f.child.at};const menu=decisionChoices(decisionContext(f.w,f.child)),c=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue');assert.ok(c);const a=parseChoice(JSON.stringify({choice:c.id}),menu).actions[0];submit(f.w,f.child,a);assert.equal(t.phase,'interrupted');assert.deepEqual(f.child.at,at);assert.equal(f.guardian.activity,null);
});

test('new destination risk, new physical obstacle or removal of the bound danger cannot turn carrying into a second pickup',()=>{
 for(const change of ['destination','obstacle','binding'] as const){const f=fixture(),t=pickup(f),at={...f.child.at},stock={...f.guardian.inventory};
  if(change==='destination')f.w.frontierHazards!.disasters.push({...f.d,id:'new-warning',phase:'warning',startsAt:f.w.minute+120,at:{...f.b.door},footprint:[{...f.b.door}],warned:[],exposure:{}});
  else if(change==='obstacle')f.w.resources.push({id:'fallen-tree',kind:'tree',at:{...f.guardian.activity!.path[0]},amount:1,max:1,regrowthDays:0,lastHarvest:f.w.minute});
  else delete (f.guardian.activity!.action as HealthAction).evacuationDangerId;
  stepWorld(f.w,1);assert.equal(t.phase,'interrupted');assert.deepEqual(f.child.at,at);assert.deepEqual(f.guardian.inventory,stock);assert.equal(f.child.inside,null);assert.equal(f.w.health!.transports.length,1);
 }
});

test('disaster binding is not editable through a model choice and cannot authorize another operation',()=>{
 const f=fixture(),menu=decisionChoices(decisionContext(f.w,f.guardian)),c=menu.find(c=>evacuation(c.action))!;assert.ok(c);assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,evacuationDangerId:'invented'}),menu));
 for(const operation of ['stabilize','rescueOffer','cancelRescue'] as const)assert.ok(healthReason(f.w,f.guardian,{...c.action as HealthAction,operation}));
 assert.ok(healthReason(f.w,f.guardian,{...c.action as HealthAction,evacuationDangerId:'invented'}));
});

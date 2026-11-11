import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Building,Resident,Tile,World} from '../src/shared/types.js';
import type {HealthAction,HealthCase} from '../src/shared/health.js';
import {createWorld} from '../src/world/seed.js';
import {activeCases,addHealthCase,healthReason,initializeHealth} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import {passenger,syncMedicalTransport} from '../src/world/medical-transport.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {healthOpportunities} from '../src/server/health-opportunities.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';

// Independent tests: generated worlds, disabled weather, and memory-only SQLite.
function fixture(indoor=false){
 const w=createWorld(73);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'有伤幼儿再撤险独立审查',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 const source:Building={...structuredClone(w.buildings.find(b=>b.kind==='lodge')!),id:'review-source',at:{x:9,y:4},width:4,height:4,door:{x:11,y:8},capacity:0,condition:100,ownerId:'commons',residents:[]};
 w.buildings=indoor?[source]:[];w.resources=[];w.plots=[];w.graves=[];w.residents=w.residents.slice(0,3);
 for(const r of w.residents){r.at={...source.door};r.inside=indoor?source.id:null;r.roomAt=indoor?{x:4,y:9}:null;r.homeId=null;r.bornAt=w.minute-30*YEAR;r.status='alive';r.residency='resident';r.health=r.energy=100;r.hunger=0;r.canDecide=r.canExpress=true;r.refusesCare=false;r.inventory={water:9,cloth:4,medicine:2,meal:10};r.knownBuildings=indoor?[source.id]:[];r.knownResources=[];r.knownPeople=w.residents.map(p=>p.id);r.guardianIds=[];r.skills.care=2;r.plan=null;r.activity=null;r.lastFailure=null;}
 const [g,p,other]=w.residents;p.bornAt=w.minute-2*YEAR;p.guardianIds=[g.id];p.canDecide=p.canExpress=false;if(indoor)p.roomAt={x:5,y:9};other.at={x:1,y:16};other.inside=null;other.roomAt=null;
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];w.frontierHazards!.weather!.enabled=false;
 const d={id:'review-flood',kind:'flashFlood' as const,at:{...source.door},radius:2,phase:'active' as const,warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(r=>r.id),exposure:{},footprint:[{...source.door}]};w.frontierHazards!.disasters=[d];
 return {w,g,p,other,source,d};
}
type Fixture=ReturnType<typeof fixture>;
const ground=(a:Action):a is HealthAction=>a.type==='health'&&a.operation==='rescue'&&a.evacuationDestination==='safe-ground'&&a.evacuationAuthority!=='incapacitated-adult';
const groundChoices=(f:Fixture)=>healthOpportunities(f.w,f.g).filter(c=>ground(c.action));
function selected(f:Fixture){const choices=decisionChoices(decisionContext(f.w,f.g)),choice=choices.find(c=>ground(c.action));assert.ok(choice,'actual final menu must retain the bounded guardian dry-ground choice');return parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as HealthAction;}
function queue(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`injured-review:${w.minute}:${r.id}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人仅选择有限临时撤险，不授权治疗或床位',actions:[a]});assert.equal(result.ok,true,result.error);}
function until(w:World,done:()=>boolean){let n=1500;while(!done()){assert.ok(n-->0,'bounded physical evacuation');stepWorld(w,.25);}}
function finish(w:World,r:Resident){until(w,()=>!r.plan&&!r.activity);}
function pickup(f:Fixture){queue(f.w,f.g,selected(f));until(f.w,()=>!!passenger(f.w,f.p.id)||!!f.g.lastFailure);assert.equal(f.g.lastFailure,null);return passenger(f.w,f.p.id)!;}
function injury(f:Fixture,severity=2.15,kind:HealthCase['kind']='injury'){return addHealthCase(f.w,f.p,kind,severity,'isolated review fixture')!;}
function position(p:Resident){return structuredClone({at:p.at,inside:p.inside,roomAt:p.roomAt});}

for(const kind of ['injury','illness'] as const)for(const severity of [2.15,19.999,20,49.999])test(`injured child review: ${kind} ${severity} retains only bounded evacuation eligibility`,()=>{
 const f=fixture();injury(f,severity,kind);f.p.health=99;
 assert.equal(groundChoices(f).length,1);assert.equal(healthReason(f.w,f.g,selected(f)),null);
 assert.equal(f.w.health!.transports.length,0);assert.equal(f.g.inventory.cloth,4);assert.equal(f.p.canDecide,false);
});

for(const health of [45,45.001,99])test(`injured child review: health ${health} is inside the inclusive health boundary`,()=>{
 const f=fixture();injury(f);f.p.health=health;assert.equal(groundChoices(f).length,1);assert.equal(healthReason(f.w,f.g,selected(f)),null);
});

const exclusions:Array<[string,(f:Fixture,c:HealthCase)=>void]>=[
 ['health below 45',f=>{f.p.health=44.999;}],['severe boundary',(_f,c)=>{c.severity=50;}],['critical boundary',(_f,c)=>{c.severity=85;}],
 ['critical stage with low severity',(_f,c)=>{c.stage='critical';}],['another severe illness',(f)=>{injury(f,50,'illness');}],
 ['case severe threshold',(_f,c)=>{c.rules={...c.rules!,severeSeverity:10};c.severity=10;}],
 ['case critical threshold',(_f,c)=>{c.rules={...c.rules!,criticalSeverity:9};c.severity=9;}],
 ['case critical health',(f,c)=>{c.rules={...c.rules!,criticalHealth:60};f.p.health=60;}],
 ['nonfinite health',f=>{f.p.health=NaN;}],['nonfinite severity',(_f,c)=>{c.severity=NaN;}],
];
for(const [label,mutate] of exclusions)test(`injured child review: ${label} rejects menu and a previously valid raw action`,()=>{
 const f=fixture(),c=injury(f),a=selected(f);mutate(f,c);const before=position(f.p),stock={...f.g.inventory};
 assert.equal(groundChoices(f).length,0);assert.ok(healthReason(f.w,f.g,a));assert.deepEqual(position(f.p),before);assert.deepEqual(f.g.inventory,stock);assert.equal(f.w.health!.transports.length,0);
});

test('injured child review: resolved severe history does not block a separate mild active case',()=>{
 const f=fixture(),past=injury(f,90);past.stage='resolved';past.resolvedAt=f.w.minute;injury(f,2.15,'illness');assert.equal(groundChoices(f).length,1);
});

test('injured child review: legacy case without rules uses its bound definition, not the active default',()=>{
 const f=fixture(),c=injury(f,11);f.w.definitions['health/rules@review']={...structuredClone(f.w.definitions['health/rules@1']),version:7,data:{...c.rules!,slowSeverity:5,severeSeverity:10}};
 c.definition='health/rules@review';delete c.rules;assert.equal(groundChoices(f).length,0);
 const action:HealthAction={type:'health',operation:'rescue',targetId:f.p.id,evacuationDestination:'safe-ground',evacuationDangerId:f.d.id,evacuationGround:{x:12,y:8}};assert.ok(healthReason(f.w,f.g,action));
});

test('injured child review: generating choices does not treat, reserve, consume, or mutate the world',()=>{
 const f=fixture();injury(f);decisionContext(f.w,f.g);const before=structuredClone(f.w);selected(f);assert.deepEqual(f.w,before);
});

test('injured child review: a real second flood injury after delivery still permits a second independent evacuation',()=>{
 const f=fixture(),first=pickup(f);finish(f.w,f.g);assert.equal(first.phase,'delivered');const landing={...f.p.at};
 f.d.phase='ended' as never;const second={...structuredClone(f.d),id:'review-second-flood',phase:'active' as const,at:landing,footprint:[landing],startsAt:f.w.minute-1,endsAt:f.w.minute+1000,exposure:{},lastSteppedAt:f.w.minute};f.w.frontierHazards!.disasters.push(second);
 stepWorld(f.w,24);const c=activeCases(f.w,f.p.id)[0];assert.ok(c&&c.severity>2&&c.severity<=2.15);assert.equal(f.p.health,99);assert.deepEqual(f.p.at,landing);assert.equal(f.w.health!.transports.length,1);
 const a=selected(f);assert.equal(a.evacuationDangerId,second.id);queue(f.w,f.g,a);finish(f.w,f.g);
 assert.equal(f.w.health!.transports.length,2);const last=f.w.health!.transports[1];assert.equal(last.phase,'delivered',last.reason??f.g.lastFailure??'');assert.notEqual(last.id,first.id);assert.notDeepEqual(f.p.at,landing);assert.deepEqual(f.p.at,last.evacuationGround);assert.equal(last.buildingId,null);assert.equal(last.bed,null);assert.equal(f.g.inventory.cloth,2);assert.equal(f.g.inventory.water,7);assert.equal(f.g.inventory.medicine,2);assert.equal(c.treatment,0);assert.equal(f.w.health!.appointments.length,0);assert.equal(f.p.homeId,null);assert.equal(f.p.canDecide,false);
});

for(const indoor of [false,true])test(`injured child review: ${indoor?'indoor':'outdoor'} pickup rechecks injury before charging or moving`,()=>{
 const f=fixture(indoor),c=injury(f);queue(f.w,f.g,selected(f));stepWorld(f.w,.25);c.severity=50;const at=position(f.p),stock={...f.g.inventory};finish(f.w,f.g);
 assert.equal(f.w.health!.transports.length,0);assert.deepEqual(position(f.p),at);assert.deepEqual(f.g.inventory,stock);assert.ok(f.g.lastFailure);
});

for(const [label,mutate] of exclusions.filter(([label])=>!label.startsWith('nonfinite')))test(`injured child review: carrying stops immediately when ${label}`,()=>{
 const f=fixture(true),c=injury(f),t=pickup(f),at=position(f.p),stock={...f.g.inventory};mutate(f,c);syncMedicalTransport(f.w);
 assert.equal(t.phase,'interrupted');assert.deepEqual(position(f.p),at);assert.deepEqual(f.g.inventory,stock);assert.equal(f.g.activity,null);assert.equal(f.w.health!.appointments.length,0);assert.equal(f.p.homeId,null);
});

for(const [label,mutate] of [
 ['refusal',(f:Fixture)=>{f.p.refusesCare=true;}],['guardian loss',(f:Fixture)=>{f.p.guardianIds=[];}],['carrier decision loss',(f:Fixture)=>{f.g.canDecide=false;}],['carrier expression loss',(f:Fixture)=>{f.g.canExpress=false;}],['carrier low energy',(f:Fixture)=>{f.g.energy=9;}],
] as const)test(`injured child review: ${label} still stops at the current room position`,()=>{
 const f=fixture(true);injury(f);const t=pickup(f),at=position(f.p);mutate(f);stepWorld(f.w,.25);assert.equal(t.phase,'interrupted');assert.deepEqual(position(f.p),at);assert.equal(f.g.inventory.cloth,3);
});

test('injured child review: mild injury does not enlarge ordinary medical or known-address menus',()=>{
 for(const severity of [2.15,25]){
  const f=fixture(true);injury(f,severity);const clinic:Building={...structuredClone(f.source),id:'review-clinic',kind:'clinic',at:{x:2,y:2},door:{x:4,y:6},capacity:4};f.w.buildings.push(clinic);f.g.knownBuildings.push(clinic.id);
  const before=healthOpportunities(f.w,f.g).filter(c=>!ground(c.action));assert.equal(before.some(c=>c.id.startsWith('health.guardianEvacuation.')),false);
  assert.equal(before.some(c=>c.action.type==='health'&&c.action.operation==='stabilize'),severity>=20);
  f.d.phase='ended' as never;const after=healthOpportunities(f.w,f.g).filter(c=>!ground(c.action));assert.deepEqual(after,before);
 }
});

test('injured child review: an expressive nondeciding injured child can stop from the real limited menu',()=>{
 const f=fixture(true);injury(f);const t=pickup(f),at=position(f.p);f.p.canExpress=true;
 const menu=decisionChoices(decisionContext(f.w,f.p)),stop=menu.find(c=>c.action.type==='health'&&c.action.operation==='cancelRescue');assert.ok(stop);assert.equal(menu.length,2);
 queue(f.w,f.p,parseChoice(JSON.stringify({choice:stop.id}),menu).actions[0]);assert.equal(t.phase,'interrupted');assert.deepEqual(position(f.p),at);assert.equal(f.p.canDecide,false);assert.equal(f.p.activity,null);
});

test('injured child review: changing destination danger stops without silently choosing new ground',()=>{
 const f=fixture();injury(f);const t=pickup(f),at=position(f.p),target={...t.evacuationGround!};f.w.frontierHazards!.disasters.push({...structuredClone(f.d),id:'review-new-target-danger',at:target,footprint:[target]});stepWorld(f.w,.25);
 assert.equal(t.phase,'interrupted');assert.deepEqual(position(f.p),at);assert.deepEqual(t.evacuationGround,target);assert.equal(f.g.inventory.cloth,3);
});

test('injured child review: source hazard ending after pickup preserves the bounded child delivery contract',()=>{
 const f=fixture(true);injury(f);const t=pickup(f);f.d.phase='ended' as never;finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.equal(f.p.inside,null);assert.deepEqual(f.p.at,t.evacuationGround);
});

for(const phase of ['pickup','room','outdoor-edge'] as const)test(`injured child review: ${phase} reload preserves injury, physical movement, and one charge`,()=>{
 const f=fixture(phase!=='outdoor-edge');injury(f,25);if(phase==='outdoor-edge')f.d.footprint=[{x:11,y:8},{x:12,y:8},{x:10,y:8},{x:11,y:7},{x:11,y:9}];
 if(phase==='pickup'){queue(f.w,f.g,selected(f));stepWorld(f.w,1);}else{const t=pickup(f);if(phase==='outdoor-edge')until(f.w,()=>t.evacuationSteps===1);else stepWorld(f.w,.5);}
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!;assert.deepEqual(position(p),position(f.p));assert.deepEqual(activeCases(w,p.id),activeCases(f.w,f.p.id));finish(w,g);
  const t=w.health!.transports[0];assert.equal(t.phase,'delivered',t.reason??g.lastFailure??'');assert.deepEqual(p.at,t.evacuationGround);assert.equal(p.inside,null);assert.equal(g.inventory.cloth,3);assert.equal(g.inventory.water,8);assert.equal(g.inventory.medicine,2);assert.equal(activeCases(w,p.id)[0].treatment,0);assert.equal(w.health!.transports.length,1);assert.equal(w.frontierHazards!.weather!.enabled,false);
 }finally{store.close();}
});

test('injured child review: reloaded pending pickup rejects new severe illness without spending',()=>{
 const f=fixture(true);injury(f);queue(f.w,f.g,selected(f));stepWorld(f.w,1);const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,g=w.residents.find(r=>r.id===f.g.id)!,p=w.residents.find(r=>r.id===f.p.id)!;addHealthCase(w,p,'illness',50,'isolated post-load illness');const at=position(p);finish(w,g);assert.equal(w.health!.transports.length,0);assert.equal(g.inventory.cloth,4);assert.equal(g.inventory.water,9);assert.deepEqual(position(p),at);}finally{store.close();}
});

test('injured child review: mixed medical fields and forged adult authority do not bypass ground limits',()=>{
 const f=fixture();injury(f);const a=selected(f);for(const extra of [{buildingId:'review-clinic'},{offerId:'fake'},{operation:'stabilize'},{evacuationAuthority:'incapacitated-adult'},{evacuationGround:{x:23,y:17}}])assert.ok(healthReason(f.w,f.g,{...a,...extra} as HealthAction));assert.equal(f.w.health!.transports.length,0);assert.equal(f.g.inventory.cloth,4);
});

test('injured child review: a persisted ground transport cannot acquire a bed through matched payload tampering',()=>{
 const f=fixture();injury(f);const t=pickup(f),at=position(f.p);t.buildingId='review-clinic';t.bed=0;(f.g.activity!.action as HealthAction).buildingId=t.buildingId;syncMedicalTransport(f.w);assert.equal(t.phase,'interrupted');assert.deepEqual(position(f.p),at);assert.equal(f.p.homeId,null);assert.equal(f.p.inside,null);
});

for(const [label,mutate] of [
 ['raised case severe threshold',(_f:Fixture,c:HealthCase)=>{c.severity=50;c.rules={...c.rules!,severeSeverity:80,criticalSeverity:90};}],
 ['negative severity',(_f:Fixture,c:HealthCase)=>{c.severity=-1;}],
 ['nonfinite case severe rule',(_f:Fixture,c:HealthCase)=>{c.rules={...c.rules!,severeSeverity:NaN};}],
 ['nonfinite case critical health',(_f:Fixture,c:HealthCase)=>{c.rules={...c.rules!,criticalHealth:NaN};}],
] as const)test(`injured child review: ${label} cannot relax the conservative scope`,()=>{
 const f=fixture(),c=injury(f),a=selected(f);mutate(f,c);assert.equal(groundChoices(f).length,0);assert.ok(healthReason(f.w,f.g,a));
});

test('injured child review: active definition changes cannot replace a case-bound health rule',()=>{
 const f=fixture(),c=injury(f,25),bound={...c.rules!};f.w.definitions['health/rules@review']={...structuredClone(f.w.definitions['health/rules@1']),version:7,data:{...bound,slowSeverity:5,severeSeverity:10}};f.w.activeDefinitions['health/rules']='health/rules@review';
 assert.equal(groundChoices(f).length,1);delete c.rules;assert.equal(groundChoices(f).length,1,'legacy case still binds health/rules@1, not the newer active rule');
});

test('injured child review: arrival does not skip a final injury check before delivery is recorded',()=>{
 const f=fixture(),c=injury(f),t=pickup(f);until(f.w,()=>!f.g.activity!.path.length);assert.equal(t.phase,'carrying');assert.deepEqual(f.p.at,t.evacuationGround);
 c.stage='critical';const at=position(f.p);stepWorld(f.w,.25);assert.equal(t.phase,'interrupted');assert.deepEqual(position(f.p),at);assert.equal(f.w.events.filter(e=>e.hazardFact?.targetId===f.p.id&&e.hazardFact.phase==='retreat').length,0);
});

test('injured child review: saved cancellation is terminal without a fresh guardian decision',()=>{
 const f=fixture(true);injury(f);const t=pickup(f);f.p.canExpress=true;queue(f.w,f.p,{type:'health',operation:'cancelRescue',transportId:t.id});const at=position(f.p),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,p=w.residents.find(r=>r.id===f.p.id)!,g=w.residents.find(r=>r.id===f.g.id)!;stepWorld(w,1);assert.equal(w.health!.transports.length,1);assert.equal(w.health!.transports[0].phase,'interrupted');assert.deepEqual(position(p),at);assert.equal(g.activity,null);assert.equal(g.inventory.cloth,3);assert.equal(p.canDecide,false);assert.equal(p.canExpress,true);}finally{store.close();}
});

test('injured child review: prior successful transport is not standing authority to restart without a new threat',()=>{
 const f=fixture();injury(f);const t=pickup(f);finish(f.w,f.g);assert.equal(t.phase,'delivered');assert.equal(groundChoices(f).length,0);const at=position(f.p),stock={...f.g.inventory};stepWorld(f.w,1);assert.equal(f.w.health!.transports.length,1);assert.deepEqual(position(f.p),at);assert.deepEqual(f.g.inventory,stock);
});

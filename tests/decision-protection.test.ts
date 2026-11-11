import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {decisionChoices,decisionContext,DecisionError,type ModelResult} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {hasTimelySelfRescue,planStartError,stepWorld,submitPlan} from '../src/world/engine.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {addHealthCase} from '../src/world/health.js';
import {initializeFood} from '../src/world/food.js';
import {initializeRooms} from '../src/world/rooms.js';
import {residentBed,roomLayout} from '../src/shared/rooms.js';
import type {Resident,World,Action} from '../src/shared/types.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const choices=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r)).map(c=>c.action);
const protectedStep=(w:World,minutes:number)=>stepWorld(w,minutes,{decisionChoices:choices});
function fixture(){
 const w=createFrontierWorld();
 // Isolated equivalent world: preserve the official population/assets, remove
 // unrelated scheduled hazards so each test supplies the exact exposure.
 w.frontierHazards=undefined;w.scenario=undefined;w.clock.paused=false;
 for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+1000;}
 const r=w.residents[0];r.decisionDue=w.minute;r.health=1;r.hunger=98;r.energy=80;
 r.inventory={meal:2};r.knownResources=[];w.plots=[];w.resources=[];
 return {w,r};
}
function choose(w:World,r:Resident,action:Action,id='chosen'){
 assert.equal(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自主选择',actions:[action]}).ok,true);
}

test('93 seconds of real menu model waiting protects only the endangered resident at the default clock',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {w,r}=fixture(),store=new WorldStore(':memory:');store.commit(w,null);
 let finish!: (result:ModelResult)=>void;
 const runtime=new ValleyRuntime(store,'test-key',async(_key,context)=>{
  if(context.actor.id===r.id)return new Promise<ModelResult>(resolve=>{finish=resolve;});
  return new Promise<ModelResult>(()=>{});
 });
 try{
  runtime.start();const before=runtime.world.minute,otherHunger=runtime.world.residents[1].hunger;
  for(let i=0;i<93;i++)runtime.tick(now+=1000);
  const waiting=runtime.world.residents[0],state=waiting.decisionProtection!;
  assert.equal(waiting.status,'alive');assert.equal(waiting.health,1);
  assert.ok(waiting.hunger>98);assert.ok(waiting.energy<80);
  assert.ok(runtime.world.residents[1].hunger>otherHunger);
  assert.ok(Math.abs(runtime.world.minute-before-111.6)<1e-8);assert.equal(runtime.world.clock.paused,false);
  assert.equal(state.expiresAt-state.startedAt,180);assert.ok(state.prevented.hunger>4.9);
  assert.equal(runtime.snapshot().world.residents[0].decisionProtection?.startedAt,state.startedAt);
  const menu=decisionChoices(decisionContext(runtime.world,waiting)),eat=menu.find(c=>c.action.type==='eat')!;
  finish({decision:parseChoice(JSON.stringify({choice:eat.id}),menu),inputTokens:1,outputTokens:1,latencyMs:93_000});await flush();
  for(let i=0;i<6;i++)runtime.tick(now+=1000);
  const fed=runtime.world.residents[0];assert.equal(fed.inventory.meal,1);assert.ok(fed.hunger<95);
  assert.equal(fed.decisionProtection?.reason,'decision');assert.ok(fed.decisionProtection?.recoveredAt);
  assert.ok(runtime.world.events.some(e=>e.decisionProtection?.phase==='ended'));
 }finally{runtime.stop();store.close();}
});

test('invalid replies and service restart retain the same 180 game minute deadline',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {w,r}=fixture(),store=new WorldStore(':memory:');store.commit(w,null);
 let calls=0;
 const model=async(_key:string,context:ReturnType<typeof decisionContext>):Promise<ModelResult>=>{if(context.actor.id!==r.id)return {decision:{intention:'自己的安排',actions:[{type:'wait',minutes:300}]},inputTokens:1,outputTokens:1,latencyMs:1};if(calls++===0)throw new DecisionError('invalid_decision',{inputTokens:1,outputTokens:1,latencyMs:1},'请重试');return new Promise(()=>{});};
 let runtime=new ValleyRuntime(store,'test-key',model);
 try{
  runtime.start();await flush();
  for(let i=0;i<70;i++)runtime.tick(now+=1000);
  assert.ok(calls>=2);const deadline=runtime.world.residents[0].decisionProtection!.expiresAt;
  runtime.stop();runtime=new ValleyRuntime(store,'test-key',model);runtime.world.residents[1].decisionDue=runtime.world.minute;runtime.start();await flush();
  assert.equal(runtime.world.residents[0].decisionProtection?.expiresAt,deadline);
  for(let i=0;i<90;i++)runtime.tick(now+=1000);
  const current=runtime.world.residents.find(p=>p.id===r.id)!;
  assert.equal(current.decisionProtection?.expiresAt,deadline);assert.equal(current.decisionProtection?.reason,'expired');
  assert.ok(current.health<1&&current.health>0);assert.equal(runtime.world.clock.paused,false);
  assert.equal(runtime.world.events.filter(e=>e.decisionProtection?.phase==='started'&&e.actors.includes(r.id)).length,1);
  assert.ok(Math.abs(current.decisionProtection!.prevented.hunger-8.1)<1e-8);
 }finally{runtime.stop();store.close();}
});

test('no food, too little time, or a blocked known source never grants protection',()=>{
 for(const mode of ['no-food','too-late','blocked'] as const){
  const {w,r}=fixture();
  if(mode==='too-late')r.health=.1;
  else r.inventory={};
  if(mode==='blocked'){
   const at={x:r.at.x+5,y:r.at.y};w.resources=[{id:'blocked-berries',kind:'bush',at,amount:3,max:3,regrowthDays:2,lastHarvest:0}];r.knownResources=['blocked-berries'];
   for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(r.at.y+dy)*w.map.width+r.at.x+dx]='cliff';
  }
  assert.equal(hasTimelySelfRescue(w,r,choices(w,r)),false,mode);
  protectedStep(w,30);assert.equal(r.decisionProtection,undefined,mode);assert.equal(r.status,'dead',mode);
 }
});

test('a reachable menu berry route is forecast through actual gathering and eating without mutating the world',()=>{
 const {w,r}=fixture();r.inventory={};r.at={x:4,y:4};
 w.map.tiles=w.map.tiles.map(()=> 'grass');
 w.resources=[{id:'berries',kind:'bush',at:{x:5,y:4},amount:3,max:3,regrowthDays:2,lastHarvest:0}];r.knownResources=['berries'];
 const menu=choices(w,r),before=structuredClone(w);
 assert.equal(hasTimelySelfRescue(w,r,menu),true);assert.deepEqual(w,before);
 protectedStep(w,3);assert.equal(r.health,1);assert.equal(w.resources[0].amount,3);
});

test('spoiled food ends an active hold without replacing inventory or renewing the crisis',()=>{
 const {w,r}=fixture();initializeFood(w);protectedStep(w,2);
 const deadline=r.decisionProtection!.expiresAt;
 for(const lot of w.food!.lots['person:'+r.id].meal!)lot.expiresAt=w.minute+1;
 protectedStep(w,2);
 assert.equal(r.inventory.meal,0);assert.equal(r.decisionProtection?.reason,'unavailable');assert.ok(r.health<1);
 r.inventory.meal=2;protectedStep(w,2);
 assert.equal(r.decisionProtection?.expiresAt,deadline);assert.equal(r.decisionProtection?.endedAt,w.minute-3);
});

test('self-chosen waiting ends protection and cannot renew it without actual recovery',()=>{
 const {w,r}=fixture();protectedStep(w,3);const deadline=r.decisionProtection!.expiresAt;
 choose(w,r,{type:'wait',minutes:10});protectedStep(w,12);
 assert.equal(r.decisionProtection?.reason,'decision');assert.ok(r.health<1);assert.equal(r.decisionProtection?.expiresAt,deadline);
 assert.equal(w.events.filter(e=>e.decisionProtection?.phase==='started').length,1);
});

test('an invalidated action does not end or renew the existing protection',()=>{
 const {w,r}=fixture();protectedStep(w,2);const deadline=r.decisionProtection!.expiresAt;
 choose(w,r,{type:'gather',resourceId:'missing',quantity:1});protectedStep(w,2);
 assert.ok(r.lastFailure);assert.equal(r.decisionProtection?.endedAt,null);assert.equal(r.decisionProtection?.expiresAt,deadline);assert.equal(r.health,1);
});

test('exhaustion protection requires a reachable real bed and ends when chosen sleep starts',()=>{
 const {w,r}=fixture();r.hunger=20;r.energy=0;r.health=.5;
 initializeRooms(w);const b=w.buildings.find(b=>b.id===r.homeId)!;
 const bed=residentBed(w,r,b)!;r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:'+bed)!.at};
 protectedStep(w,4);assert.equal(r.health,.5);assert.ok(r.decisionProtection!.prevented.exhaustion>0);
 choose(w,r,{type:'sleep',minutes:30});protectedStep(w,15);
 assert.equal(r.decisionProtection?.reason,'decision');assert.ok(r.energy>2);assert.ok(r.decisionProtection?.recoveredAt);
});

test('a recovered resident can enter a later independent crisis but repeated replies cannot',()=>{
 const {w,r}=fixture();protectedStep(w,2);const first=r.decisionProtection!.startedAt;
 choose(w,r,{type:'eat',item:'meal'});protectedStep(w,6);assert.ok(r.decisionProtection?.recoveredAt);
 r.hunger=98;r.health=1;protectedStep(w,2);
 assert.ok(r.decisionProtection!.startedAt>first);assert.equal(r.decisionProtection?.endedAt,null);
});

test('injury and disease progression still applies and loss of capacity ends eligibility',()=>{
 for(const kind of ['injury','illness'] as const){
  const {w,r}=fixture();protectedStep(w,2);addHealthCase(w,r,kind,30,'测试已有伤病');
  const before=r.health;protectedStep(w,1);
  assert.ok(r.health<before);assert.equal(r.canDecide,false);assert.notEqual(r.decisionProtection?.endedAt,null);
 }
});

test('a storm can kill a protected resident and its damage remains in the protection record',()=>{
 const {w,r}=fixture();protectedStep(w,2);
 w.frontierHazards={beasts:[],foodPatches:[],nextBeastSerial:1,shore:null,woodland:{x:1,y:1},nextDisasterAt:w.minute+1000,nextSerial:1,
  totals:{injuries:0,accidentalDeaths:0,damagedBuildings:0,damagedPlots:0,repairs:0,livestockAttacks:0,livestockKilled:0,wildlifeDeaths:0,hunted:0},
  disasters:[{id:'storm',kind:'windstorm',at:{...r.at},radius:2,phase:'active',warningAt:w.minute-30,startsAt:w.minute-1,endsAt:w.minute+100,intensity:2,warned:[r.id],exposure:{[r.id]:23}}]};
 protectedStep(w,1);assert.equal(r.status,'dead');assert.equal(r.deathCause,'accident');assert.match(r.deathDetail??'',/风暴/);
 assert.equal(r.decisionProtection?.reason,'unavailable');
});

test('sustained town-wide model silence still pauses; an empty town keeps world time moving',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 for(const empty of [false,true]){
  const {w}=fixture();if(empty)w.residents=[];
  const store=new WorldStore(':memory:');store.commit(w,null);
  const runtime=new ValleyRuntime(store,'test-key',()=>new Promise<ModelResult>(()=>{}));
  try{
   runtime.start();runtime.tick(now+=1000);
   // The pending resident survives their personal expiry long enough to test
   // the distinct global clock boundary, rather than removing the waiter.
   if(!empty)runtime.world.residents[0].health=10;
   const before=runtime.world.minute;runtime.tick(now+=180_000);
   assert.equal(runtime.world.clock.paused,!empty);
   if(empty)assert.ok(runtime.world.minute>before);else assert.equal(runtime.world.minute,before);
  }finally{runtime.stop();store.close();}
 }
});

test('crossing the hunger danger threshold during a tick is protected before health loss',()=>{
 const {w,r}=fixture();r.hunger=94.99;r.health=.3;
 protectedStep(w,1);assert.equal(r.health,.3);assert.ok(r.decisionProtection);
});

test('chosen travel is not treated as technical model waiting',()=>{
 const {w,r}=fixture();w.map.tiles=w.map.tiles.map(()=> 'grass');r.at={x:4,y:4};
 choose(w,r,{type:'move',to:{x:20,y:4}});protectedStep(w,5);
 assert.equal(r.decisionProtection,undefined);assert.ok(r.health<1);assert.notDeepEqual(r.at,{x:4,y:4});
});

test('a full bed allocation does not create an exhaustion rescue path',()=>{
 const {w,r}=fixture();r.hunger=20;r.energy=0;r.health=.5;initializeRooms(w);
 const home=w.buildings.find(b=>b.id===r.homeId)!;home.capacity=0;
 assert.equal(hasTimelySelfRescue(w,r,choices(w,r)),false);
 protectedStep(w,2);assert.equal(r.decisionProtection,undefined);assert.ok(r.health<.5);
});

test('configurable slow clocks retain the immediate dependent-care and appointment holds',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {advancePublicDuties,completeDuty}=await import('../src/world/public-duties.js');
 const {YEAR}=await import('../src/world/time.js');
 for(const boundary of ['child','appointment'] as const){
  const {w,r}=fixture();r.health=90;r.hunger=20;
  if(boundary==='child'){
   const child=w.residents[1];child.bornAt=w.minute-2*YEAR;child.guardianIds=[r.id];child.hunger=85;child.at={...r.at};child.inside=r.inside;
  }else{
   w.minute=590;r.decisionDue=w.minute;r.inventory={turnip:2,water:1};r.skills.care=2;r.skills.farming=2;advancePublicDuties(w);
   const shift=w.duties!.shifts.find(s=>s.role==='kitchen'&&s.start===600)!;
   r.at={...w.buildings.find(b=>b.id===shift.buildingId)!.door};
   assert.equal(completeDuty(w,r,{type:'publicDuty',operation:'claim',shiftId:shift.id}),null);
  }
  const store=new WorldStore(':memory:');store.commit(w,null);
  const runtime=new ValleyRuntime(store,'test-key',()=>new Promise<ModelResult>(()=>{}),{dayMinutes:180});
  try{runtime.start();const before=runtime.world.minute;runtime.tick(now+=1000);assert.equal(runtime.world.clock.paused,true,boundary);assert.equal(runtime.world.minute,before,boundary);}
  finally{runtime.stop();store.close();}
 }
});

test('normal-menu shop retrieval and paid purchase are timely rescue paths with real settlement',async()=>{
 const {initializeEconomy,completeEconomy}=await import('../src/world/economy.js');
 for(const operation of ['retrieve','buy'] as const){
  const {w,r:owner}=fixture();owner.health=90;stepWorld(w,1);initializeEconomy(w);const home=w.buildings.find(b=>b.ownerId===owner.id)!;
  owner.at={...home.door};owner.inside=null;owner.knownBuildings.push(home.id);
  assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:home.id,name:'粮铺'}),null);
  const business=w.economy!.businesses[0];
  assert.equal(completeEconomy(w,owner,{type:'economy',operation:'stock',businessId:business.id,item:'meal',quantity:2}),null);
  const r=operation==='retrieve'?owner:w.residents.find(p=>p.id!==owner.id&&w.minute-p.bornAt>=18*112*1440)!;
  r.at={...home.door};r.inside=null;r.knownBuildings.push(home.id);r.knownResources=[];r.inventory={};r.health=2;r.hunger=98;r.energy=80;r.decisionDue=w.minute;
  if(operation==='buy')assert.equal(completeEconomy(w,owner,{type:'economy',operation:'list',businessId:business.id,item:'meal',quantity:1,price:1}),null);
  const menu=decisionChoices(decisionContext(w,r)),offered=menu.find(c=>c.action.type==='economy'&&c.action.operation===operation)!;
  assert.ok(offered,operation);assert.equal(hasTimelySelfRescue(w,r,menu.map(c=>c.action)),true,operation);
  const coins=r.coins;protectedStep(w,1);assert.equal(r.health,2,operation);assert.ok(r.decisionProtection);
  const selection=parseChoice(JSON.stringify({choice:offered.id,...(operation==='retrieve'?{quantity:1}:{quantity:1,maxTotal:1})}),menu);
  choose(w,r,selection.actions[0]);stepWorld(w,25);
  assert.equal(r.inventory.meal,1);choose(w,r,{type:'eat',item:'meal'},'consume');stepWorld(w,6);
  assert.equal(r.inventory.meal,0);assert.equal(r.status,'alive');assert.ok(r.hunger<95);
  assert.equal(r.coins,coins-(operation==='buy'?1:0));
 }
});

test('an obsolete harvest or cook choice keeps the existing protection until a valid choice starts',()=>{
 for(const type of ['harvest','cook'] as const){
  const {w,r}=fixture();protectedStep(w,2);const deadline=r.decisionProtection!.expiresAt;
  let action:Action;
  if(type==='harvest'){
   w.plots=[{id:'empty-plot',ownerId:r.id,at:{...r.at},crop:null}];action={type:'harvest',plotId:'empty-plot'};
  }else action={type:'cook',quantity:1};
  choose(w,r,action);protectedStep(w,2);
  assert.ok(r.lastFailure,type);assert.equal(r.health,1,type);assert.equal(r.decisionProtection?.endedAt,null,type);assert.equal(r.decisionProtection?.expiresAt,deadline,type);
 }
});

test('rescue forecasts advance a service provider’s already-chosen departure instead of freezing them',async()=>{
 const {advancePublicDuties,completeDuty}=await import('../src/world/public-duties.js');
 for(const leaving of [false,true]){
  const {w,r}=fixture();r.health=2;r.inventory={};w.minute=601;r.decisionDue=w.minute;initializeRooms(w);advancePublicDuties(w);
  const shift=w.duties!.shifts.find(s=>s.role==='kitchen'&&s.start===600)!;
  const lodge=w.buildings.find(b=>b.id===shift.buildingId)!,worker=w.residents[1];
  worker.at={...lodge.door};worker.inside=lodge.id;worker.roomAt={...roomLayout(w,lodge).slots.find(s=>s.key==='kitchen')!.at};worker.health=90;worker.inventory={turnip:2,water:1};
  assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'claim',shiftId:shift.id}),null);
  assert.equal(completeDuty(w,worker,{type:'publicDuty',operation:'attend',shiftId:shift.id}),null);
  worker.plan={id:'provider-plan',actorId:worker.id,actorRevision:worker.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自己的安排',actions:leaving?[{type:'wait',minutes:1},{type:'move',to:{x:lodge.door.x+3,y:lodge.door.y}}]:[{type:'wait',minutes:60}]};
  r.at={...lodge.door};r.inside=lodge.id;r.roomAt={...roomLayout(w,lodge).slots.find(s=>s.key==='table')!.at};r.knownBuildings.push(lodge.id);
  const menu=choices(w,r);assert.ok(menu.some(a=>a.type==='publicDuty'&&a.operation==='receive'));
  const before=structuredClone(w);assert.equal(hasTimelySelfRescue(w,r,menu),!leaving);assert.deepEqual(w,before);
 }
});

test('the completion minute of a chosen wait still pays its physiological cost',()=>{
 const {w,r}=fixture();choose(w,r,{type:'wait',minutes:1});protectedStep(w,1);
 assert.equal(r.health,.955);assert.equal(r.decisionProtection,undefined);
 protectedStep(w,1);assert.ok(r.decisionProtection);assert.equal(r.health,.955);
});

test('repeated immediately unexecutable replies cannot reset the town-wide valid-decision clock',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {w,r}=fixture();r.health=2.7;
 const store=new WorldStore(':memory:');store.commit(w,null);
 const runtime=new ValleyRuntime(store,'test-key',async()=>({decision:{intention:'已失效的采集',actions:[{type:'gather',resourceId:'missing',quantity:1}]},inputTokens:1,outputTokens:1,latencyMs:1}));
 try{
  runtime.start();await flush();
  for(let i=0;i<181;i++){runtime.tick(now+=1000);await flush();}
  assert.equal(runtime.world.metrics.successes,0);assert.ok(runtime.world.metrics.failures>10);
  assert.equal(runtime.world.clock.paused,true);assert.match(runtime.world.clock.reason!,/持续未提供/);
  const resident=runtime.world.residents[0];assert.equal(resident.status,'alive');assert.equal(resident.decisionProtection?.reason,null);assert.ok(runtime.world.minute<=resident.decisionProtection!.expiresAt);
  assert.equal(runtime.world.events.filter(e=>e.decisionProtection?.phase==='started'&&e.actors.includes(r.id)).length,1);
 }finally{runtime.stop();store.close();}
});

test('food in an in-flight prompt is revalidated when it spoils before the reply',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {w}=fixture(),store=new WorldStore(':memory:');store.commit(w,null);
 const runtime=new ValleyRuntime(store,'test-key',()=>new Promise<ModelResult>(()=>{}));
 try{
  runtime.start();runtime.tick(now+=1000);assert.ok(runtime.world.residents[0].decisionProtection);
  const r=runtime.world.residents[0];
  for(const lot of runtime.world.food!.lots['person:'+r.id].meal!)lot.expiresAt=runtime.world.minute+.1;
  runtime.tick(now+=1000);
  const current=runtime.world.residents[0];assert.equal(current.inventory.meal,0);assert.equal(current.decisionProtection?.reason,'unavailable');assert.ok(current.health<1);
 }finally{runtime.stop();store.close();}
});

test('direct carried food and idle rest-only hunger cases avoid full-world speculative copies',t=>{
 const {w,r}=fixture();r.health=90;stepWorld(w,1);r.health=2.7;r.hunger=98;r.energy=80;
 const direct=choices(w,r),clone=globalThis.structuredClone;let copies=0;
 t.mock.method(globalThis,'structuredClone',((...args:Parameters<typeof structuredClone>)=>{copies++;return clone(...args);}) as typeof structuredClone);
 assert.equal(hasTimelySelfRescue(w,r,direct),true);assert.equal(copies,0);
 r.inventory={};const rest=direct.filter(a=>a.type==='sleep');
 assert.equal(hasTimelySelfRescue(w,r,rest),false);assert.equal(copies,0);
});

test('first-action validation uses the next room tick rather than a completed worker’s stale claim',async()=>{
 const {createWorld}=await import('../src/world/seed.js');
 const w=createWorld();w.mode='formal';w.clock.paused=false;initializeRooms(w);
 const [first,next]=w.residents,home=w.buildings.find(b=>b.id===first.homeId)!;
 home.residents=[first.id,next.id];next.homeId=home.id;
 const kitchen=roomLayout(w,home).slots.find(s=>s.key==='kitchen')!.at;
 for(const r of [first,next]){r.at={...home.door};r.inside=home.id;r.roomAt={...kitchen};r.inventory={turnip:20,water:20};r.hunger=20;r.health=100;r.energy=70;}
 first.activity={planId:'finishing',action:{type:'cook',quantity:1},startedAt:w.minute-19,remaining:1,path:[],target:{...home.door},definition:'recipe/meal@1'};
 const plan={id:'next-cook',actorId:next.id,actorRevision:next.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自己做饭',actions:[{type:'cook' as const,quantity:1}]};
 assert.match(planStartError(w,plan)!,/占用/);
 stepWorld(w,1);assert.equal(first.inventory.meal,1);assert.ok(w.rooms!.claims.some(c=>c.people.includes(first.id)));
 const before=structuredClone(w);assert.equal(planStartError(w,plan),null);assert.deepEqual(w,before);
 assert.equal(submitPlan(w,plan).ok,true);stepWorld(w,20);assert.equal(next.inventory.meal,1);
});

test('a total outage pauses before personal expiry across restart, then a valid choice releases the clock',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {w}=fixture(),store=new WorldStore(':memory:');store.commit(w,null);
 let finish!:(result:ModelResult)=>void;
 const waitingId=w.residents[0].id;
 const model=(_key:string,context:ReturnType<typeof decisionContext>)=>new Promise<ModelResult>(resolve=>{if(context.actor.id===waitingId)finish=resolve;});
 let runtime=new ValleyRuntime(store,'test-key',model);
 try{
  runtime.start();for(let i=0;i<70;i++)runtime.tick(now+=1000);
  const deadline=runtime.world.residents[0].decisionProtection!.expiresAt;
  runtime.stop();runtime=new ValleyRuntime(store,'test-key',model);runtime.start();
  for(let i=0;i<90;i++)runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.paused,true);assert.match(runtime.world.clock.reason!,/持续未提供/);
  const resident=runtime.world.residents[0],pausedAt=runtime.world.minute;
  assert.equal(resident.health,1);assert.equal(resident.status,'alive');assert.equal(resident.decisionProtection?.expiresAt,deadline);assert.ok(pausedAt<=deadline);
  for(let i=0;i<5;i++)runtime.tick(now+=1000);assert.equal(runtime.world.minute,pausedAt);
  finish({decision:{intention:'自主短暂停留',actions:[{type:'wait',minutes:1}]},inputTokens:1,outputTokens:1,latencyMs:1});await flush();
  runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.paused,false);assert.ok(runtime.world.minute>pausedAt);assert.equal(runtime.world.residents[0].decisionProtection?.reason,'decision');assert.ok(runtime.world.residents[0].health<1);
 }finally{runtime.stop();store.close();}
});

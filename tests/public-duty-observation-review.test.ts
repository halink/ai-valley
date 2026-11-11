import {ageAllowsChoice} from '../src/world/family.js';
import {movementRate} from '../src/world/health.js';
import {WorldStore} from '../src/server/store.js';
import type {PublicShift} from '../src/shared/public-duties.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {canInspectRoomPoint} from '../src/world/commons-observation.js';
import {accountBalance,initializeEconomy,totalCoins} from '../src/world/economy.js';
import {dutyReason,completeDuty} from '../src/world/public-duties.js';
import {dutyServiceApproachCost} from '../src/world/public-duty-observation.js';
import {moveInRoom} from '../src/world/rooms.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,World,Vec} from '../src/shared/types.js';
import {roomLayout,actionRoom,roomPath} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeFood} from '../src/world/food.js';
import {initializeRooms} from '../src/world/rooms.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {YEAR} from '../src/world/time.js';

// Entirely synthetic: no model requests, runtime saves, credentials or workstation teleports.
function fixture(role:'kitchen'|'care'){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};
 w.resources=[];w.plots=[];w.graves=[];w.events=[];w.estates=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 Object.assign(b,{kind:role==='care'?'clinic':'lodge',at:{x:12,y:6},width:4,height:4,door:{x:14,y:10},residents:[],capacity:2});w.buildings=[b];
 w.residents=w.residents.slice(0,3);const [r,provider,other]=w.residents;
 for(const p of w.residents){Object.assign(p,{at:{...b.door},inside:null,roomAt:null,homeId:null,parents:[],guardianIds:[],inventory:{},bornAt:w.minute-25*YEAR,health:60,energy:100,hunger:70,knownBuildings:[b.id],knownPeople:[],knownResources:[],memories:[],canDecide:true,canExpress:true,status:'alive',residency:'resident',activity:null,plan:null,lastFailure:null});p.skills.care=2;}
 other.at={x:25,y:20};initializeCivic(w);initializeRooms(w);w.civic!.stores={[b.id]:{}};w.civic!.budgets=[];w.civic!.proposals=[];
 provider.inside=b.id;provider.roomAt={...roomLayout(w,b).slots.find(s=>s.key===(role==='care'?'care':'kitchen'))!.at};provider.inventory={turnip:2,meal:1,water:1};
 const shift:PublicShift={id:'observation-shift',role,buildingId:b.id,start:600,end:1000,workerId:provider.id,status:'on-duty' as const,assignments:[{residentId:provider.id,acceptedAt:590,arrivedAt:600,leftAt:null}],declinedBy:[],served:0,clientId:null};
 w.duties={publishedThroughDay:1,shifts:[shift]};initializeFood(w);
 return {w,b,r,provider,other,shift,role};
}
const prepared=(w:World,r:Resident)=>prepareModelDecision(decisionContext(w,r),undefined,GLM_MODEL);
const receive=(a:Action)=>a.type==='publicDuty'&&a.operation==='receive';
function selected(w:World,r:Resident,match:(a:Action)=>boolean){const p=prepared(w,r),c=p.choices.find(c=>match(c.action));assert.ok(c,'choice survives the final numbered menu');assert.ok(p.messages.some(m=>m.content.includes(c.id+'. '+c.label)));return parseChoice(JSON.stringify({choice:c.id}),p.choices).actions[0];}
function queue(w:World,r:Resident,a:Action){return submitPlan(w,{id:`duty-observation:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人明确选择现场查看或接受公共服务',actions:[a]});}
function body(f:ReturnType<typeof fixture>,at:Vec){const p=structuredClone(f.other);p.id=`block:${at.x}:${at.y}`;p.status='dead';p.inside=f.b.id;p.roomAt={...at};p.body={reservedBy:null,carriedBy:null,storedAt:f.b.id};f.w.residents.push(p);}
function target(f:ReturnType<typeof fixture>){return roomLayout(f.w,f.b).slots.find(s=>s.key===(f.role==='care'?'bed:0':'table'))!.at;}

// Independent review assertions: the physical target, not merely its service
// bookkeeping key, must remain legal throughout an explicit request.
function occupy(f:ReturnType<typeof fixture>,key:string){
 f.other.at={...f.b.door};f.other.inside=f.b.id;
 f.other.roomAt={...roomLayout(f.w,f.b).slots.find(s=>s.key===key)!.at};
 f.other.activity={action:{type:'wait',minutes:30},path:[],target:{...f.b.door},remaining:30,startedAt:f.w.minute,planId:'review-occupancy',definition:f.w.activeDefinitions['action/routine']} as Resident['activity'];
 f.w.rooms!.claims.push({buildingId:f.b.id,key,group:f.other.id,people:[f.other.id]});
}
test('review: receive rejects another active claim at its actual kitchen service table',()=>{
 const f=fixture('kitchen');occupy(f,'table');
 assert.notEqual(dutyReason(f.w,f.r,{type:'publicDuty',operation:'receive',shiftId:f.shift.id}),null);
});
for(const role of ['kitchen','care'] as const){
 test(`review: ${role} inspect uses a visible adjacent point without occupying the service seat`,()=>{
  const f=fixture(role);occupy(f,role==='care'?'bed:0':'table');
  const activity={action:{type:'publicDuty',operation:'inspect',buildingId:f.b.id}} as Resident['activity'];
  const work=actionRoom(f.w,f.r,activity!);assert.ok(work);assert.notDeepEqual(work.target,target(f));
  f.r.inside=f.b.id;f.r.roomAt={...work.target};assert.equal(canInspectRoomPoint(f.w,f.r,f.b,target(f)),true);
 });
 test(`review: ${role} route reads leave lazy movement definitions untouched`,()=>{
  const f=fixture(role);f.w.definitions={};const before=structuredClone(f.w);
  dutyServiceApproachCost(f.w,f.r,f.b,f.shift);assert.deepEqual(f.w,before);
 });
 test(`review: ${role} a provider losing coordinates cannot complete a reserved service`,()=>{
  const f=fixture(role);f.r.inside=f.b.id;f.r.roomAt={...target(f)};f.shift.clientId=f.r.id;f.provider.roomAt=null;
  const stock=structuredClone(f.provider.inventory),served=f.shift.served;
  assert.notEqual(completeDuty(f.w,f.r,{type:'publicDuty',operation:'receive',shiftId:f.shift.id}),null);
  assert.equal(f.shift.served,served);assert.deepEqual(f.provider.inventory,stock);
 });
 test(`review: ${role} missing indoor origin cannot be recreated at the entry`,()=>{
  const f=fixture(role);f.r.inside=f.b.id;f.r.roomAt=null;
  f.r.activity={action:{type:'publicDuty',operation:'inspect',buildingId:f.b.id},path:[],target:{...f.b.door},remaining:1,startedAt:f.w.minute,planId:'review-origin',definition:f.w.activeDefinitions['action/routine']} as Resident['activity'];
  assert.ok(moveInRoom(f.w,f.r,1).error);assert.equal(f.r.roomAt,null);
 });
 test(`review: ${role} completion refuses a newly blocked physical service target`,()=>{
  const f=fixture(role);f.r.inside=f.b.id;f.r.roomAt={...target(f)};f.shift.clientId=f.r.id;body(f,target(f));
  const stock=structuredClone(f.provider.inventory);
  assert.notEqual(completeDuty(f.w,f.r,{type:'publicDuty',operation:'receive',shiftId:f.shift.id}),null);
  assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);
 });
}

for(const role of ['kitchen','care'] as const){
 test(`review: ${role} two explicit funded requests spend one ration and one wage`,()=>{
  const f=fixture(role);initializeEconomy(f.w);initializeForeignTrade(f.w);const account='escrow:review-wages';
  const funded=f.w.duties!.shifts[0];funded.funding={budgetId:'review-budget',wageAccount:account,wagePerService:3,reserved:3,paid:0};
  f.w.economy!.escrows['review-wages']=3;f.w.civic!.stores[f.b.id]={water:1,...(role==='care'?{meal:1}:{turnip:2})};
  f.w.economy!.treasuryStock={...f.w.civic!.stores[f.b.id]};
  f.other.at={...f.b.door};const beforeCoins=totalCoins(f.w),providerCoins=f.provider.coins,privateStock=structuredClone(f.provider.inventory);
  const a=selected(f.w,f.r,receive),b=selected(f.w,f.other,receive);
  assert.equal(queue(f.w,f.r,a).ok,true);assert.equal(queue(f.w,f.other,b).ok,true);
  let n=600;while(f.w.residents.some(r=>r.activity||r.plan)){assert.ok(n-->0);stepWorld(f.w,1);}
  assert.equal(funded.served,1);assert.equal(funded.funding!.paid,3);assert.equal(accountBalance(f.w,account),0);
  assert.equal(f.provider.coins-providerCoins,3);assert.equal(totalCoins(f.w),beforeCoins);
  assert.equal(f.w.civic!.stores[f.b.id].water,0);assert.deepEqual(f.provider.inventory,privateStock);
 });
}

for(const role of ['kitchen','care'] as const){
 test(`review: ${role} stale receive is rejected on submit after sight or route loss`,()=>{
  for(const change of ['hidden','unreachable'] as const){
   const f=fixture(role),a=selected(f.w,f.r,receive);
   f.r.at={x:10,y:10};
   if(change==='hidden')f.w.map.tiles[10*f.w.map.width+12]='cliff';
   else for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])f.w.map.tiles[(f.r.at.y+dy)*f.w.map.width+f.r.at.x+dx]='cliff';
   const before=structuredClone(f.w);const result=queue(f.w,f.r,a);
   assert.equal(result.ok,false);assert.ok(result.error);assert.deepEqual(f.w,before,'rejected stale action does not alter world or reserve service');
  }
 });
 test(`review: ${role} displaced working client fails immediately without walking back`,()=>{
  for(const displacement of ['wrong','missing'] as const){
   const f=fixture(role);assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);
   let n=100;while(f.shift.clientId!==f.r.id){assert.ok(n-->0);stepWorld(f.w,1);}
   assert.deepEqual(f.r.roomAt,target(f));assert.ok(f.r.activity);
   const stock=structuredClone(f.provider.inventory),coins=f.provider.coins;
   const displaced=displacement==='missing'?null:{...roomLayout(f.w,f.b).entry};f.r.roomAt=displaced;
   stepWorld(f.w,1);
   assert.ok(f.r.lastFailure,'first tick rejects lost service position');assert.equal(f.r.activity,null);assert.equal(f.r.plan,null);
   assert.deepEqual(f.r.roomAt,displaced,'no automatic return step');assert.equal(f.shift.served,0);
   assert.deepEqual(f.provider.inventory,stock);assert.equal(f.provider.coins,coins);
  }
 });
}

for(const role of ['kitchen','care'] as const){
 test(`review: ${role} SQLite restored indoor path stops before a new obstacle despite a detour`,()=>{
  const f=fixture(role);assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);
  let n=100;while(!f.r.activity?.room?.path.length){assert.ok(n-->0);stepWorld(f.w,1);}
  const store=new WorldStore(':memory:');try{
   store.commit(f.w,null);const w=store.load()!,r=w.residents.find(p=>p.id===f.r.id)!,provider=w.residents.find(p=>p.id===f.provider.id)!,b=w.buildings.find(b=>b.id===f.b.id)!;
   assert.deepEqual(r.activity!.room,f.r.activity!.room,'serialized journey retains its saved next step');
   const blocked={...r.activity!.room!.path[0]},origin={...r.roomAt!},stock=structuredClone(provider.inventory),coins=provider.coins;
   const blocker=structuredClone(w.residents.find(p=>p.id===f.other.id)!);blocker.id='review-restored-path-body';blocker.status='dead';blocker.inside=b.id;blocker.roomAt=blocked;blocker.body={reservedBy:null,carriedBy:null,storedAt:b.id};w.residents.push(blocker);
   const dest=roomLayout(w,b).slots.find(s=>s.key===(role==='care'?'bed:0':'table'))!.at;
   assert.ok(roomPath(roomLayout(w,b),origin,dest),'a legal alternative route exists, but is not the saved chosen route');
   stepWorld(w,1);
   assert.ok(r.lastFailure,'stale saved path must fail before crossing its next obstacle');assert.equal(r.activity,null);assert.equal(r.plan,null);
   assert.deepEqual(r.roomAt,origin);assert.notDeepEqual(r.roomAt,blocked);assert.equal(w.duties!.shifts.find(s=>s.id===f.shift.id)!.served,0);
   assert.deepEqual(provider.inventory,stock);assert.equal(provider.coins,coins);
  }finally{store.close();}
 });
}

for(const role of ['kitchen','care'] as const){
 test(`review: ${role} hidden known-place inspect is independent of duty initialization`,()=>{
  const f=fixture(role);f.r.at={x:10,y:10};f.w.map.tiles[10*f.w.map.width+12]='cliff';
  const inspections=()=>prepared(f.w,f.r).choices.filter(c=>c.action.type==='publicDuty'&&c.action.operation==='inspect').map(c=>({label:c.label,action:c.action}));
  const withDuties=inspections();assert.equal(withDuties.length,1);assert.equal(prepared(f.w,f.r).choices.some(c=>receive(c.action)),false);
  delete f.w.duties;assert.deepEqual(inspections(),withDuties);assert.equal(prepared(f.w,f.r).choices.some(c=>receive(c.action)),false);
 });
 test(`review: ${role} last-minute menu budgets the next tick but allows exactly enough seated work`,()=>{
  const f=fixture(role),duration=role==='care'?30:20,a=selected(f.w,f.r,receive);
  const cost=dutyServiceApproachCost(f.w,f.r,f.b,f.shift);assert.notEqual(cost,null);
  const travel=Math.ceil(cost!/movementRate(f.w,f.r));assert.ok(travel>0);
  f.shift.end=f.w.minute+travel+duration-1;
  assert.equal(prepared(f.w,f.r).choices.some(c=>receive(c.action)),false,'door-to-service travel cannot borrow the submission tick');
  assert.equal(queue(f.w,f.r,a).ok,false,'cached receive also respects the next-tick start');
  f.r.inside=f.b.id;f.r.roomAt={...target(f)};f.shift.end=f.w.minute+duration;
  assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);
  let n=duration+5;while(f.r.activity||f.r.plan){assert.ok(n-->0);stepWorld(f.w,1);}
  assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,1);assert.equal(f.provider.inventory.water,0);assert.equal(f.w.minute,f.shift.end);
 });
}

for(const role of ['kitchen','care'] as const){
 test(`review: ${role} children six through seventeen inspect before separately consenting to service, never labor`,()=>{
  for(const age of [6,10,17]){
   const f=fixture(role);f.r.bornAt=f.w.minute-age*YEAR;f.r.at={x:10,y:10};f.w.map.tiles[10*f.w.map.width+12]='cliff';
   const labor=['claim','attend','stay','reschedule','withdraw'] as const;
   for(const operation of labor)assert.equal(ageAllowsChoice(age,{type:'publicDuty',operation,shiftId:f.shift.id}),false);
   assert.equal(prepared(f.w,f.r).choices.some(c=>c.action.type==='publicDuty'&&labor.includes(c.action.operation as typeof labor[number])),false);
   const stock=structuredClone(f.provider.inventory);
   assert.equal(queue(f.w,f.r,selected(f.w,f.r,a=>a.type==='publicDuty'&&a.operation==='inspect')).ok,true);
   let n=100;while(f.r.activity||f.r.plan){assert.ok(n-->0);stepWorld(f.w,1);}
   assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,0);assert.deepEqual(f.provider.inventory,stock);
   assert.equal(queue(f.w,f.r,selected(f.w,f.r,receive)).ok,true);
   n=100;while(f.r.activity||f.r.plan){assert.ok(n-->0);stepWorld(f.w,1);}
   assert.equal(f.r.lastFailure,null);assert.equal(f.shift.served,1);assert.equal(f.provider.inventory.water,0);
  }
  assert.equal(ageAllowsChoice(5,{type:'publicDuty',operation:'inspect',buildingId:fixture(role).b.id}),false);
 });
}

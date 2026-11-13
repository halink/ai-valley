import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {CommonsAction} from '../src/shared/commons.js';
import {commonsStay} from '../src/shared/commons.js';
import {roomLayout} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {initializeCommons,advanceCommons,commonsReceiptId,commonsReason,commonsFoodOptions,commonsFoodRemaining,completeCommons,freeCommonsBed,hasTimelyCommonsFood} from '../src/world/commons.js';
import {initializeProduction,emergencyEstateOptions} from '../src/world/production.js';
import {recordDeath} from '../src/world/life.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeFood} from '../src/world/food.js';
import {initializeRooms} from '../src/world/rooms.js';
import {stepWorld,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {parseChoice} from '../src/server/affordances.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';

import {residentFoodCoverage,settlementFoodCoverage} from '../src/world/food-coverage.js';
import {medicalBed} from '../src/world/medical-transport.js';
import {WorldStore} from '../src/server/store.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(stock={turnip:5}){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};w.resources=[];w.plots=[];w.graves=[];
 const b=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;b.at={x:12,y:6};b.width=b.height=4;b.door={x:14,y:10};b.residents=[];b.capacity=2;w.buildings=[b];w.residents=w.residents.slice(0,3);
 for(const p of w.residents){p.at={...b.door};p.inside=null;p.roomAt=null;p.homeId=null;p.parents=[];p.guardianIds=[];p.inventory={};p.bornAt=w.minute-30*YEAR;p.health=p.energy=100;p.hunger=30;p.knownBuildings=[b.id];p.canDecide=p.canExpress=true;p.status='alive';p.residency='resident';p.activity=null;p.plan=null;}
 const [r,other,third]=w.residents;r.bornAt=w.minute-10*YEAR;
 initializeCivic(w);initializeRooms(w);initializeCommons(w);w.civic!.stores[b.id]={...stock};w.economy!.treasuryStock={...stock};initializeFood(w);
 return {w,b,r,other,third};
}
function action(w:World,r:Resident,buildingId:string,operation:CommonsAction['operation']='takeFood'):CommonsAction{
 const common={type:'commons' as const,buildingId,receiptId:commonsReceiptId(w,r)};
 return operation==='takeFood'?{...common,operation,item:'turnip'}:operation==='donateFood'?{...common,operation,item:'turnip',quantity:1}:{...common,operation};
}
function queue(w:World,r:Resident,a:Action){assert.equal(submitPlan(w,{id:`commons-test:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人自主选择',actions:[a]}).ok,true);}
function finish(w:World,r:Resident,max=800){while(r.plan||r.activity){assert.ok(max--,'action must finish in bounded time');stepWorld(w,1);}}
function atTable(f:ReturnType<typeof fixture>,r=f.r){r.at={...f.b.door};r.inside=f.b.id;r.roomAt={...roomLayout(f.w,f.b).slots.find(s=>s.key==='table')!.at};}

test('a child independently chooses, walks indoors and collects finite existing food without a worker or automatic eating',()=>{
 const f=fixture(),{w,b,r}=f,lot={...w.food!.lots['public:'+b.id]!.turnip![0]},hunger=r.hunger;
 const choices=decisionChoices(decisionContext(w,r)),a=choices.find(c=>c.action.type==='commons'&&c.action.operation==='takeFood')!.action;
 assert.ok(a);queue(w,r,a);stepWorld(w,1);assert.equal(r.inventory.turnip,undefined);assert.ok(r.activity?.room?.path.length);finish(w,r);
 assert.equal(r.lastFailure,null);assert.equal(r.inventory.turnip,1);assert.equal(w.civic!.stores[b.id].turnip,4);assert.equal(w.economy!.treasuryStock.turnip,4);assert.ok(r.hunger>hunger);
 const delivered=w.food!.lots['person:'+r.id]!.turnip![0];assert.equal(delivered.expiresAt,lot.expiresAt);assert.equal(delivered.producedAt,lot.producedAt);assert.equal(delivered.quantity,1);
 assert.equal(w.commons!.receipts.length,1);assert.ok(w.events.some(e=>e.text.includes('领取不等于已经进食')));
 assert.equal(r.homeId,null);assert.equal(r.guardianIds.length,0);queue(w,r,{type:'eat',item:'turnip'});finish(w,r);assert.ok(r.hunger<hunger);
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();const person=restored.residents.find(p=>p.id===r.id)!;
 assert.equal(completeCommons(restored,person,a as CommonsAction),null);assert.equal(person.inventory.turnip,0);assert.equal(restored.civic!.stores[b.id].turnip,4);assert.equal(restored.commons!.receipts.length,1);
});

test('rolling per-person allowance spans lodges and restarts, but does not refill stores',()=>{
 const f=fixture(),{w,r,b}=f;atTable(f);
 for(let i=0;i<2;i++)assert.equal(completeCommons(w,r,action(w,r,b.id)),null);
 assert.match(commonsReason(w,r,action(w,r,b.id))!,/额度/);const remaining=commonsFoodRemaining(w,r),stock=w.civic!.stores[b.id].turnip;
 const restored=JSON.parse(JSON.stringify(w)) as World,person=restored.residents[0];initializeCommons(restored);assert.equal(commonsFoodRemaining(restored,person),remaining);assert.equal(restored.civic!.stores[b.id].turnip,stock);
 w.minute+=DAY-1;assert.match(commonsReason(w,r,action(w,r,b.id))!,/额度/);w.minute+=1;assert.equal(commonsReason(w,r,action(w,r,b.id)),null);assert.equal(w.civic!.stores[b.id].turnip,stock);
 const duplicate={...b,id:'second-lodge'};w.buildings.push(duplicate);r.knownBuildings.push(duplicate.id);w.civic!.stores[duplicate.id]={turnip:5};initializeFood(w);w.minute-=1;assert.match(commonsReason(w,r,action(w,r,duplicate.id))!,/额度/);
});

test('the last food unit cannot be claimed twice and an already submitted choice rechecks depletion',()=>{
 const f=fixture({turnip:1}),{w,b,r,other}=f;atTable(f);atTable(f,other);const a=action(w,r,b.id),second=action(w,other,b.id);
 assert.equal(completeCommons(w,r,a),null);assert.match(completeCommons(w,other,second)!,/现物/);assert.equal(r.inventory.turnip,1);assert.equal(other.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,0);
});

test('public budgets, funded shifts, private property and unknown places never become self-service food',()=>{
 const f=fixture(),{w,b,r}=f,a=action(w,r,b.id);w.civic!.budgets.push({id:'reserved',proposalId:'p',buildingId:b.id,kind:'service',startsAt:w.minute,expiresAt:w.minute+DAY,status:'active',wage:1,wageLimit:1,suppliesLimit:10,paidWages:0,spentSupplies:0,wageAccount:'w',supplyAccount:'s',prices:{},purchased:{}});
 assert.match(commonsReason(w,r,a)!,/预算/);w.civic!.budgets=[];w.duties={publishedThroughDay:1,shifts:[{id:'reserved-shift',role:'kitchen',buildingId:b.id,start:w.minute-1,end:w.minute+20,workerId:null,status:'open',assignments:[],declinedBy:[],served:0,clientId:null,funding:{budgetId:'old',wagePerService:1,wageAccount:'w',reserved:1,paid:0}}]};assert.match(commonsReason(w,r,a)!,/预算/);
 w.duties.shifts=[];b.ownerId=r.id;assert.match(commonsReason(w,r,a)!,/公共/);b.ownerId='commons';r.knownBuildings=[];assert.match(commonsReason(w,r,a)!,/已知/);
 r.knownBuildings=[b.id];assert.match(commonsReason(w,r,{...a,operation:'takeFood',item:'water'})!,/完整可食/);
});

test('expiry or a blocked interior prevents collection; a bystander and distant stock are not knowledge',()=>{
 const f=fixture(),{w,b,r}=f;w.food!.lots['public:'+b.id]!.turnip![0].expiresAt=w.minute+2;queue(w,r,action(w,r,b.id));finish(w,r);assert.match(r.lastFailure!,/现物/);assert.equal(r.inventory.turnip,undefined);assert.equal(w.civic!.stores[b.id].turnip,0);
 const g=fixture();g.r.at={x:1,y:1};assert.equal(commonsFoodOptions(g.w,g.r).length,0);assert.equal(residentFoodCoverage(g.w,g.r).sourceLabel,null);
});

test('an adult donates actual food at the table preserving its original expiry, and minors cannot donate',()=>{
 const f=fixture({turnip:0}),{w,b,r,other}=f;other.inventory.turnip=1;initializeFood(w);const expiry=w.food!.lots['person:'+other.id]!.turnip![0].expiresAt;
 assert.match(commonsReason(w,r,action(w,r,b.id,'donateFood'))!,/未成年人/);const a=action(w,other,b.id,'donateFood');assert.match(completeCommons(w,other,a)!,/实际走到/);atTable(f,other);assert.equal(completeCommons(w,other,a),null);
 assert.equal(other.inventory.turnip,0);assert.equal(w.civic!.stores[b.id].turnip,1);assert.equal(w.economy!.treasuryStock.turnip,1);assert.equal(w.food!.lots['public:'+b.id]!.turnip![0].expiresAt,expiry);
});

test('temporary bed borrowing consumes a real free slot and sleep only restores energy after actual arrival',()=>{
 const f=fixture(),{w,b,r}=f;r.energy=15;const home=r.homeId,residency=r.residency;queue(w,r,action(w,r,b.id,'borrowBed'));finish(w,r);const stay=commonsStay(w,r)!;assert.ok(stay);assert.equal(stay.expiresAt-stay.startedAt,DAY);assert.equal(r.homeId,home);assert.equal(r.residency,residency);assert.equal(b.residents.length,0);
 const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>c.action.type==='sleep'&&c.action.buildingId===b.id)!;assert.ok(choice.chooseDuration);const sleep=parseChoice(JSON.stringify({choice:choice.id,minutes:30}),menu).actions[0];queue(w,r,sleep);const energy=r.energy;stepWorld(w,1);assert.ok(r.energy<energy);
 while(r.activity?.room?.path.length)stepWorld(w,1);stepWorld(w,1);assert.ok(r.energy>energy);finish(w,r);assert.equal(r.lastFailure,null);assert.equal(r.homeId,home);
});

test('bed limits include sleeping assignments, medical reservations and other leases; no new bed is fabricated',()=>{
 const f=fixture(),{w,b,r,other,third}=f;b.capacity=1;b.residents=[other.id];assert.equal(freeCommonsBed(w,r,b),null);b.residents=[];atTable(f);assert.equal(completeCommons(w,r,action(w,r,b.id,'borrowBed')),null);assert.equal(freeCommonsBed(w,other,b),null);assert.equal(medicalBed(w,b.id,third.id),null);
 atTable(f,other);assert.match(completeCommons(w,other,action(w,other,b.id,'borrowBed'))!,/空床/);assert.equal(w.commons!.stays.length,1);
 assert.equal(completeCommons(w,r,action(w,r,b.id,'releaseBed')),null);assert.equal(freeCommonsBed(w,other,b),0);assert.equal(b.capacity,1);
});

test('an expiring or revoked lease stops sleep at the real location and reload never extends it',()=>{
 const f=fixture(),{w,b,r}=f;atTable(f);completeCommons(w,r,action(w,r,b.id,'borrowBed'));const stay=commonsStay(w,r)!;stay.expiresAt=w.minute+3;r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:'+stay.bed)!.at};r.energy=30;
 queue(w,r,{type:'sleep',buildingId:b.id,minutes:120});stepWorld(w,1);const saved=JSON.parse(JSON.stringify(w)) as World;initializeCommons(saved);assert.equal(saved.commons!.stays[0].expiresAt,stay.expiresAt);
 stepWorld(w,2);assert.match(r.lastFailure!,/期限/);assert.equal(r.inside,b.id);assert.equal(stay.endedAt,w.minute);assert.equal(r.homeId,null);assert.ok(w.events.some(e=>e.text.includes('借床期限结束')));
});

test('commons estimates are read-only and settlement stock is counted once, not once per claimant',()=>{
 const f=fixture({turnip:1}),{w,r,other}=f,before=JSON.stringify(w);assert.equal(residentFoodCoverage(w,r).reachableNutrition,20);assert.equal(residentFoodCoverage(w,other).reachableNutrition,20);assert.equal(settlementFoodCoverage(w).uniqueNutrition,20);assert.equal(hasTimelyCommonsFood(w,r),true);assert.equal(JSON.stringify(w),before);
});

test('normal menu and survival forecast cover finite food or borrowed bed without executing either choice',()=>{
 for(const need of ['food','bed']){
  const f=fixture(need==='food'?{turnip:1}:{turnip:0}),{w,r}=f;r.hunger=need==='food'?100:10;r.energy=need==='bed'?0:100;r.health=8;
  const choices=decisionChoices(decisionContext(w,r)).map(c=>c.action),before=JSON.stringify(w);assert.ok(choices.some(a=>a.type==='commons'&&a.operation===(need==='food'?'takeFood':'borrowBed')));assert.equal(hasTimelySelfRescue(w,r,choices),true);assert.equal(JSON.stringify(w),before);
 }
});

test('initialization of an old world creates only rights ledgers, never food, beds, money or family changes',()=>{
 const {w,b,r}=fixture();delete w.commons;const before=structuredClone({minute:w.minute,residents:w.residents,buildings:w.buildings,stock:w.civic!.stores,economy:w.economy});initializeCommons(w);advanceCommons(w);assert.deepEqual({minute:w.minute,residents:w.residents,buildings:w.buildings,stock:w.civic!.stores,economy:w.economy},before);assert.deepEqual(w.commons!.receipts,[]);assert.deepEqual(w.commons!.stays,[]);
 r.bornAt=w.minute-5*YEAR;assert.match(commonsReason(w,r,action(w,r,b.id))!,/不能独立/);r.bornAt=w.minute-10*YEAR;r.canExpress=false;assert.match(commonsReason(w,r,action(w,r,b.id))!,/不能独立/);
});

test('an unreachable common table and stock that cannot last until eating never count as timely food',()=>{
 const f=fixture(),{w,b,r}=f;r.at={x:b.door.x+2,y:b.door.y};for(const at of [{x:b.door.x-1,y:b.door.y},{x:b.door.x+1,y:b.door.y},{x:b.door.x,y:b.door.y+1}])w.map.tiles[at.y*w.map.width+at.x]='water';
 assert.equal(hasTimelyCommonsFood(w,r),false);assert.equal(residentFoodCoverage(w,r).sourceLabel,null);queue(w,r,action(w,r,b.id));finish(w,r);assert.match(r.lastFailure!,/路线/);assert.equal(w.civic!.stores[b.id].turnip,5);
 const g=fixture();g.w.food!.lots['public:'+g.b.id]!.turnip![0].expiresAt=g.w.minute+6;assert.equal(hasTimelyCommonsFood(g.w,g.r),false);assert.equal(residentFoodCoverage(g.w,g.r).sourceLabel,null);
});

test('a submitted in-progress pickup survives an actual saved restart without duplicated food or a new deadline',()=>{
 const f=fixture(),{w,r,b}=f;queue(w,r,action(w,r,b.id));stepWorld(w,1);assert.ok(r.activity?.room?.path.length);const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();const person=restored.residents[0];initializeCommons(restored);finish(restored,person);assert.equal(person.inventory.turnip,1);assert.equal(restored.civic!.stores[b.id].turnip,4);assert.equal(restored.commons!.receipts.length,1);assert.equal(restored.commons!.adoptedAt,w.commons!.adoptedAt);
});

test('two simultaneous borrowers cannot receive the same final bed, including after a stale reply',()=>{
 const f=fixture(),{w,b,r,other}=f;b.capacity=1;queue(w,r,action(w,r,b.id,'borrowBed'));queue(w,other,action(w,other,b.id,'borrowBed'));finish(w,r);finish(w,other);assert.equal(w.commons!.stays.length,1);assert.ok([r,other].some(p=>p.lastFailure));assert.equal(b.capacity,1);assert.equal(b.residents.length,0);
});

test('timely independent commons food precedes the minors limited estate fallback without transferring either stock during preview',()=>{
 const f=fixture(),{w,r,b,other}=f;r.parents=[other.id];other.inventory={berry:6};initializeProduction(w);initializeFood(w);recordDeath(w,other);
 const before=JSON.stringify(w);assert.equal(hasTimelyCommonsFood(w,r),true);assert.equal(emergencyEstateOptions(w,r).length,0);assert.equal(JSON.stringify(w),before);
 w.civic!.stores[b.id].turnip=0;assert.ok(emergencyEstateOptions(w,r).length);
});

test('a borrowed bed remains selectable through the final minutes of its lease with a resident chosen duration',()=>{
 const f=fixture(),{w,r,b}=f;atTable(f);completeCommons(w,r,action(w,r,b.id,'borrowBed'));const stay=commonsStay(w,r)!;stay.expiresAt=w.minute+30;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:'+stay.bed)!.at};r.energy=3;
 const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>c.action.type==='sleep'&&c.action.buildingId===b.id)!;assert.ok(choice?.chooseDuration);const selected=parseChoice(JSON.stringify({choice:choice.id,minutes:15}),menu).actions[0];queue(w,r,selected);finish(w,r);assert.equal(r.lastFailure,null);assert.ok(r.energy>3);assert.ok(commonsStay(w,r));
});

test('release and reborrow retain the original finite deadline rather than refreshing it',()=>{
 const f=fixture(),{w,b,r}=f;atTable(f);assert.equal(completeCommons(w,r,action(w,r,b.id,'borrowBed')),null);const original=commonsStay(w,r)!.expiresAt;w.minute+=10;assert.equal(completeCommons(w,r,action(w,r,b.id,'releaseBed')),null);assert.equal(completeCommons(w,r,action(w,r,b.id,'borrowBed')),null);assert.equal(commonsStay(w,r)!.expiresAt,original);
 const saved=JSON.parse(JSON.stringify(w)) as World,p=saved.residents[0];initializeCommons(saved);saved.minute+=10;completeCommons(saved,p,action(saved,p,b.id,'releaseBed'));completeCommons(saved,p,action(saved,p,b.id,'borrowBed'));assert.equal(commonsStay(saved,p)!.expiresAt,original);
});

test('a bed still occupied by a body is not free merely because the lease holder died',()=>{
 const f=fixture(),{w,b,r,other}=f;b.capacity=1;other.inside=b.id;other.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:0')!.at};recordDeath(w,other);assert.equal(freeCommonsBed(w,r,b),null);assert.match(commonsReason(w,r,action(w,r,b.id,'borrowBed'))!,/空床/);
 other.inside=null;other.roomAt=null;assert.equal(freeCommonsBed(w,r,b),0);
});

test('a registered home bed with a physically blocked indoor target is not considered usable',()=>{
 const f=fixture(),{w,b,r,other}=f;const home={...b,id:'home-with-blocked-bed',kind:'home' as const,ownerId:r.id,residents:[r.id],door:{x:6,y:10},at:{x:4,y:6},capacity:1};w.buildings.push(home);r.homeId=home.id;w.rooms!.beds[home.id]={[r.id]:0};assert.match(commonsReason(w,r,action(w,r,b.id,'borrowBed'))!,/自家床/);
 other.status='dead';other.inside=home.id;other.roomAt={...roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at};other.body={reservedBy:null,carriedBy:null,storedAt:home.id};assert.equal(commonsReason(w,r,action(w,r,b.id,'borrowBed')),null);
});

test('an expired temporary lease does not revoke an independently valid home bed',()=>{
 const f=fixture(),{w,b,r}=f;atTable(f);assert.equal(completeCommons(w,r,action(w,r,b.id,'borrowBed')),null);const stay=commonsStay(w,r)!;
 const home={...b,id:'independent-home',kind:'home' as const,ownerId:r.id,residents:[r.id],door:{x:6,y:10},at:{x:4,y:6},capacity:1};w.buildings.push(home);r.homeId=home.id;r.knownBuildings.push(home.id);r.at={...home.door};r.inside=home.id;r.roomAt={...roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at};r.energy=10;
 stay.expiresAt=w.minute;advanceCommons(w);assert.equal(commonsStay(w,r),undefined);queue(w,r,{type:'sleep',minutes:5});finish(w,r);assert.equal(r.lastFailure,null);assert.ok(r.energy>10);assert.equal(r.inside,home.id);assert.equal(r.homeId,home.id);
});

test('an expiring explicitly borrowed-bed sleep cannot silently switch to another valid home bed',()=>{
 const f=fixture(),{w,b,r}=f;atTable(f);assert.equal(completeCommons(w,r,action(w,r,b.id,'borrowBed')),null);const stay=commonsStay(w,r)!;stay.expiresAt=w.minute+3;
 const home={...b,id:'another-valid-home',kind:'home' as const,ownerId:r.id,residents:[r.id],door:{x:6,y:10},at:{x:4,y:6},capacity:1};w.buildings.push(home);r.homeId=home.id;r.knownBuildings.push(home.id);r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:'+stay.bed)!.at};r.energy=10;
 queue(w,r,{type:'sleep',buildingId:b.id,minutes:60});stepWorld(w,1);assert.ok(r.energy>10,'valid loan bed permits recovery before its original deadline');const at={...r.at},roomAt={...r.roomAt!};stepWorld(w,1);const energy=r.energy;stepWorld(w,1);
 assert.equal(r.activity,null);assert.equal(r.plan,null);assert.equal(r.lastFailure,'临时借床期限或使用权已经失效');assert.ok(r.energy<energy);assert.equal(r.homeId,home.id);assert.equal(r.inside,b.id);assert.deepEqual(r.at,at);assert.deepEqual(r.roomAt,roomAt);assert.equal(stay.endedAt,w.minute);
});

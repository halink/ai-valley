import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {recordDeath} from '../src/world/life.js';
import {initializeProduction,completeProduction,productionTarget,emergencyEstateOptions,emergencyEstateAllowance} from '../src/world/production.js';
import {estateParcels,estateStock,estateLocation,estateBuildingLocation} from '../src/world/estate-custody.js';
import {initializeFood,foodTransaction,foodContainers,advanceFood} from '../src/world/food.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeRooms} from '../src/world/rooms.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {YEAR,DAY} from '../src/world/time.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,World} from '../src/shared/types.js';

function setup(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.resources=[];
 const [dead,child,other]=w.residents;
 for(const p of w.residents){p.at={x:34,y:40};p.inside=null;p.roomAt=null;p.inventory={};p.coins=20;p.hunger=30;p.energy=p.health=100;p.bornAt=w.minute-30*YEAR;p.knownPeople=w.residents.map(p=>p.id);p.knownBuildings=w.buildings.map(b=>b.id);p.parents=[];p.adoptiveParents=[];p.guardianIds=[];}
 child.bornAt=w.minute-10*YEAR;child.parents=[dead.id];child.canDecide=child.canExpress=true;
 dead.inventory={turnip:6,berry:6,wood:5,seed:4,water:8};
 initializeEconomy(w);initializeProduction(w);initializeForeignTrade(w);initializeFood(w);
 const home=w.buildings.find(b=>b.id===dead.homeId)!;
 return {w,dead,child,other,home};
}
function run(w:World,r:Resident,action:Action){
 const plan={id:`emergency:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人从自己的受保护份额取用有限救急食品',actions:[action]};
 assert.equal(submitPlan(w,plan).ok,true);let left=1000;while(r.plan||r.activity){assert.ok(left--);stepWorld(w,1);}assert.equal(r.lastFailure,null);return plan;
}
function take(w:World,r:Resident){const option=emergencyEstateOptions(w,r)[0];assert.ok(option);r.at={...option.location.at};r.inside=option.location.inside;r.roomAt=option.location.roomAt?{...option.location.roomAt}:null;assert.equal(completeProduction(w,r,option.action),null);return option;}
function eatAll(w:World,r:Resident){foodTransaction(w,()=>{r.inventory={};});}
const total=(w:World,item:'turnip'|'berry')=>[...foodContainers(w)].filter(([id])=>id.startsWith('estate')||w.residents.some(p=>id==='person:'+p.id)).reduce((n,[,bag])=>n+(bag[item]??0),0);

test('capable minor selects physical emergency food from the normal menu without receiving titles, money or another heirs share',()=>{
 const {w,dead,child,other,home}=setup();other.parents=[dead.id];recordDeath(w,dead);
 const before=JSON.stringify(w),options=emergencyEstateOptions(w,child);assert.ok(options.length);assert.equal(JSON.stringify(w),before,'the option preview must be read-only');
 const option=decisionChoices(decisionContext(w,child)).find(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation');assert.ok(option);
 const coins=totalCoins(w),food=total(w,'berry'),start=w.minute;child.at={x:34,y:48};const plan=run(w,child,option.action);
 assert.ok(w.minute-start>5);assert.equal(child.coins,20);assert.equal(home.ownerId,dead.id);assert.equal(totalCoins(w),coins);assert.equal(total(w,'berry'),food);
 assert.equal(child.inventory.wood??0,0);assert.equal(child.inventory.seed??0,0);assert.equal(child.inventory.water??0,0);
 const state=w.production!.emergencyFood![child.id];assert.ok(state.nutrition>0&&state.nutrition<=state.limit);assert.equal(state.receipts.length,1);
 assert.equal(w.production!.inheritances[dead.id].shares.find(s=>s.heirId===child.id)!.claimedAt,null);
 const otherShare=w.production!.inheritances[dead.id].shares.find(s=>s.heirId===other.id)!;
 assert.deepEqual(estateParcels(w).filter(p=>otherShare.goodsClaims!.includes(p.id)).map(p=>p.inventory),[{wood:[child.id,other.id].sort()[0]===other.id?3:2,berry:3,seed:2,turnip:3,water:4}]);
 const snapshot=JSON.stringify(w);assert.equal(submitPlan(w,plan).ok,true);assert.equal(JSON.stringify(w),snapshot);
 assert.ok(w.events.some(e=>e.audit?.rule==='estate/emergency-food@1'));
});

test('one child has one cumulative allowance across estates, days and restarts, and stale choices cannot repeat a transfer',()=>{
 const {w,dead,child,other}=setup();dead.inventory={berry:1};other.inventory={berry:10};child.parents=[dead.id,other.id];initializeFood(w);recordDeath(w,dead);recordDeath(w,other);
 const first=take(w,child),state=w.production!.emergencyFood![child.id];assert.equal(state.nutrition,12);eatAll(w,child);
 const quantities=total(w,'berry');assert.ok(completeProduction(w,child,first.action));assert.equal(total(w,'berry'),quantities);
 w.minute+=DAY;const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();const c=saved.residents.find(p=>p.id===child.id)!;
 const remaining=emergencyEstateAllowance(saved,c).remaining;assert.equal(remaining,54.72-12);take(saved,c);assert.equal(saved.production!.emergencyFood![c.id].nutrition,48);eatAll(saved,c);
 assert.equal(emergencyEstateOptions(saved,c).length,0);assert.equal(saved.production!.emergencyFood![c.id].receipts.length,2);
});

test('arrival and indoor room work are required; unattended public stock does not pretend to be available food',()=>{
 const {w,dead,child,home}=setup();dead.inventory={};recordDeath(w,dead);foodTransaction(w,()=>{estateStock(w,dead.id,'room-food',estateBuildingLocation(w,home.id,'原室内餐桌',true))!.berry=6;});initializeRooms(w);
 const option=emergencyEstateOptions(w,child)[0];assert.ok(option);child.at={...home.door};assert.ok(completeProduction(w,child,option.action));assert.equal(w.production!.emergencyFood,undefined);
 const start=w.minute;run(w,child,option.action);assert.ok(w.minute-start>5);assert.equal(child.inside,home.id);assert.ok(child.roomAt);assert.equal(child.inventory.berry,4);
 const f=setup();recordDeath(f.w,f.dead);const selected=emergencyEstateOptions(f.w,f.child)[0];assert.ok(selected);const lodge=f.w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;
 f.w.civic={proposals:[],budgets:[],stores:{[lodge.id]:{meal:1}},salesTax:null,nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};
 f.child.at={...selected.location.at};assert.equal(completeProduction(f.w,f.child,selected.action),null);assert.equal(f.w.production!.emergencyFood![f.child.id].receipts.length,1);
});

test('unknown death, non-heir, infant, adult, incapacity, carried food and unborn protected claims never grant emergency access',()=>{
 for(const change of [
  (f:ReturnType<typeof setup>)=>{f.child.deathKnowledge={};f.child.memories=[];},
  (f:ReturnType<typeof setup>)=>{f.w.estates[0].heirs=[f.other.id];},
  (f:ReturnType<typeof setup>)=>{f.child.bornAt=f.w.minute-5*YEAR;},
  (f:ReturnType<typeof setup>)=>{f.child.bornAt=f.w.minute-18*YEAR;},
  (f:ReturnType<typeof setup>)=>{f.child.canExpress=false;},
  (f:ReturnType<typeof setup>)=>{f.child.inventory.berry=1;},
  (f:ReturnType<typeof setup>)=>{f.w.estates[0].heirs.push('unborn:protected:0');},
 ]){const f=setup();recordDeath(f.w,f.dead);change(f);assert.equal(emergencyEstateOptions(f.w,f.child).length,0);}
});

test('existing debt, open shop and physically reserved outside stocks do not become child rations',()=>{
 const f=setup();recordDeath(f.w,f.dead);f.w.debt={loans:[{borrowerId:f.dead.id,status:'active'} as never],nextSerial:1,totals:{}} as never;assert.equal(emergencyEstateOptions(f.w,f.child).length,0);
 const g=setup();recordDeath(g.w,g.dead);g.w.economy!.businesses.push({ownerId:g.dead.id,closedAt:null} as never);assert.equal(emergencyEstateOptions(g.w,g.child).length,0);
 const h=setup();h.dead.inventory={seed:10,wood:10,water:2};recordDeath(h.w,h.dead);h.w.economy!.listings.push({id:'reserved-food',ownerId:h.dead.id,side:'sale',status:'open',item:'berry',quantity:100} as never);assert.equal(emergencyEstateOptions(h.w,h.child).length,0);
});

test('mixed legacy food ages follow the actual allocated share and are not refreshed by withdrawal',()=>{
 const {w,dead,child,other}=setup();other.parents=[dead.id];dead.inventory={berry:8};initializeFood(w);
 const key='person:'+dead.id,definition='food/life@1';w.food!.lots[key].berry=[{quantity:4,producedAt:w.minute-DAY,expiresAt:w.minute+DAY,definition},{quantity:4,producedAt:w.minute,expiresAt:w.minute+2*DAY,definition}];
 recordDeath(w,dead);const heirs=[child.id,other.id].sort();const expected=heirs.indexOf(child.id)===0?w.minute+DAY:w.minute+2*DAY;
 take(w,child);assert.deepEqual(w.food!.lots['person:'+child.id].berry!.map(l=>l.expiresAt),[expected]);
 w.minute=expected;advanceFood(w);assert.equal(child.inventory.berry,0);
});

test('legacy unclaimed shares gain physical custody once and partial food use is deducted from later adult inheritance',()=>{
 const {w,dead,child,other,home}=setup();recordDeath(w,dead);const estate=w.estates[0];estate.inventory={berry:6,wood:4};estate.coins=10;
 w.production!.inheritances[dead.id]={createdAt:w.minute,shares:[{id:'old-claimed',heirId:other.id,coins:10,inventory:{berry:5},plots:[],buildings:[],parcels:[],claimedAt:w.minute},{id:'child',heirId:child.id,coins:10,inventory:{berry:6,wood:4},plots:[],buildings:[home.id],parcels:[],claimedAt:null}]};
 const events=JSON.stringify(w.events),minute=w.minute;initializeProduction(w);initializeProduction(w);assert.equal(JSON.stringify(w.events),events);assert.equal(w.minute,minute);
 take(w,child);const before=estateParcels(w).length;initializeProduction(w);assert.equal(estateParcels(w).length,before);assert.equal(estateParcels(w).find(p=>p.claimId==='child')!.inventory.berry,2);
 child.bornAt=w.minute-18*YEAR;child.at={...home.door};child.inside=null;child.roomAt=null;assert.equal(completeProduction(w,child,{type:'production',operation:'inherit',personId:dead.id}),null);
 assert.equal(home.ownerId,child.id);assert.equal(child.inventory.berry,4);assert.equal(estateParcels(w).find(p=>p.ownerId===child.id)!.inventory.berry,2);assert.equal(w.production!.inheritances[dead.id].shares[0].claimedAt,minute);
});

test('spoiled stock, a broken indoor source and a changed entitlement fail without recording a withdrawal',()=>{
 const f=setup();recordDeath(f.w,f.dead);const a=emergencyEstateOptions(f.w,f.child)[0].action;f.w.minute+=20*DAY;assert.ok(productionTarget(f.w,f.child,a).error);assert.equal(f.w.production!.emergencyFood,undefined);
 const g=setup();g.dead.inventory={};recordDeath(g.w,g.dead);foodTransaction(g.w,()=>{estateStock(g.w,g.dead.id,'inside',estateBuildingLocation(g.w,g.home.id,'室内',true))!.meal=1;});g.home.condition=0;assert.equal(emergencyEstateOptions(g.w,g.child).length,0);
 const h=setup();recordDeath(h.w,h.dead);const selected=emergencyEstateOptions(h.w,h.child)[0];h.w.estates[0].heirs=[h.other.id];assert.ok(completeProduction(h.w,h.child,selected.action));assert.equal(h.w.production!.emergencyFood,undefined);
});

test('an in-progress physical journey survives runtime-style restart and completes only one receipt',()=>{
 const {w,dead,child}=setup();recordDeath(w,dead);const action=emergencyEstateOptions(w,child)[0].action;child.at={x:34,y:52};
 const plan={id:'estate-mid-walk-restart',actorId:child.id,actorRevision:child.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人前往原封存处取有限口粮',actions:[action]};
 assert.equal(submitPlan(w,plan).ok,true);stepWorld(w,2);assert.ok(child.plan||child.activity);assert.equal(w.production!.emergencyFood,undefined);
 const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.loadForRuntime()!,r=restored.residents.find(p=>p.id===child.id)!;const previous=restored.revision;
 assert.equal(submitPlan(restored,plan).ok,true);let left=1000;while(r.plan||r.activity){assert.ok(left--);stepWorld(restored,1);}assert.equal(r.lastFailure,null);
 assert.equal(restored.production!.emergencyFood![r.id].receipts.length,1);store.commit(restored,previous);const after=store.loadForRuntime()!,again=after.residents.find(p=>p.id===r.id)!;
 assert.equal(submitPlan(after,plan).ok,true);const inventory={...again.inventory};assert.ok(completeProduction(after,again,action));assert.deepEqual(again.inventory,inventory);assert.equal(after.production!.emergencyFood![r.id].receipts.length,1);store.close();
});

test('later FIFO shares receive their own younger batch instead of another heirs older nutrition',()=>{
 const {w,dead,child,other}=setup();other.id='a-first-heir';other.parents=[dead.id];dead.inventory={berry:8};initializeFood(w);
 const definition='food/life@1';w.food!.lots['person:'+dead.id].berry=[{quantity:4,producedAt:w.minute-DAY,expiresAt:w.minute+DAY,definition},{quantity:4,producedAt:w.minute,expiresAt:w.minute+2*DAY,definition}];
 recordDeath(w,dead);const option=emergencyEstateOptions(w,child)[0];assert.equal(option.portionOffset.berry,4);take(w,child);assert.deepEqual(w.food!.lots['person:'+child.id].berry!.map(l=>[l.quantity,l.expiresAt]),[[4,w.minute+2*DAY]]);
 const earlier=w.production!.inheritances[dead.id].shares.find(s=>s.heirId===other.id)!;const parcel=estateParcels(w).find(p=>earlier.goodsClaims!.includes(p.id))!;assert.equal(w.food!.lots[parcel.id].berry![0].expiresAt,w.minute+DAY);
});

test('single portions across separate locations are divided fairly and no minor can withdraw another heirs aggregate share',()=>{
 const {w,dead,child,other}=setup();other.bornAt=w.minute-10*YEAR;other.parents=[dead.id];dead.inventory={berry:1};recordDeath(w,dead);
 foodTransaction(w,()=>{estateStock(w,dead.id,'other-site',estateLocation({x:34,y:42},null,null,'独立储物点'))!.berry=1;});
 for(const heir of [child,other]){const options=emergencyEstateOptions(w,heir);assert.equal(options.length,1);assert.equal(options[0].inventory.berry,1);}
 take(w,child);eatAll(w,child);assert.equal(emergencyEstateOptions(w,child).length,0);assert.equal(w.production!.emergencyFood![child.id].nutrition,12);
 const share=w.production!.inheritances[dead.id].shares.find(s=>s.heirId===other.id)!;assert.equal(share.inventory.berry,1);assert.equal(share.goodsClaims!.length,1);take(w,other);assert.equal(other.inventory.berry,1);assert.equal(w.production!.emergencyFood![other.id].nutrition,12);
});

test('legacy inconsistent physical claims cannot exceed the childs registered aggregate entitlement',()=>{
 const {w,dead,child,other}=setup();dead.inventory={};recordDeath(w,dead);
 foodTransaction(w,()=>{estateStock(w,dead.id,'old-a',estateLocation(dead.at))!.berry=1;estateStock(w,dead.id,'old-b',estateLocation(dead.at))!.berry=1;});
 const claims=estateParcels(w);for(const p of claims)p.claimId='child';
 w.production!.inheritances[dead.id]={createdAt:w.minute,shares:[{id:'child',heirId:child.id,coins:0,inventory:{berry:1},plots:[],buildings:[],parcels:[],claimedAt:null,goodsClaims:claims.map(p=>p.id)},{id:'other',heirId:other.id,coins:0,inventory:{berry:1},plots:[],buildings:[],parcels:[],claimedAt:null,goodsClaims:[]}]};
 take(w,child);eatAll(w,child);assert.equal(emergencyEstateOptions(w,child).length,0);assert.equal(w.production!.emergencyFood![child.id].nutrition,12);assert.equal(claims.reduce((n,p)=>n+(p.inventory.berry??0),0),1);
});

test('a stale menu never silently increases the quantity or substitutes a newly stocked food',()=>{
 const {w,dead,child}=setup();dead.inventory={berry:1};recordDeath(w,dead);const selected=emergencyEstateOptions(w,child)[0];assert.equal(selected.inventory.berry,1);
 foodTransaction(w,()=>{w.estates[0].inventory.berry=6;});assert.ok(completeProduction(w,child,selected.action));assert.equal(child.inventory.berry??0,0);assert.equal(w.production!.emergencyFood,undefined);
 const refreshed=emergencyEstateOptions(w,child)[0];assert.equal(refreshed.inventory.berry,4);assert.notEqual(refreshed.action.rationId,selected.action.rationId);
});

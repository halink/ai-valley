import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {HouseholdAction} from '../src/shared/household.js';
import type {Resident,World} from '../src/shared/types.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeHousehold,completeHousehold,advanceHousehold,householdReason} from '../src/world/household.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {initializeFood} from '../src/world/food.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {YEAR} from '../src/world/time.js';
let serial=0;
function act(w:World,r:Resident,a:Omit<HouseholdAction,'type'>){assert.equal(completeHousehold(w,r,{type:'household',...a}),null);}
function setup(){
 const w=createFrontierWorld(5419);w.clock.paused=false;const [a,b,to]=w.residents,home=w.buildings.find(x=>x.id===a.homeId)!;
 for(const r of [a,b,to]){r.at={...home.door};r.inside=null;r.roomAt=null;r.health=r.energy=100;r.hunger=0;r.inventory.meal=10;}
 to.bornAt=w.minute-13*YEAR;to.canDecide=to.canExpress=true;initializeFood(w);initializeHousehold(w);
 act(w,a,{operation:'create',targetId:b.id,buildingId:home.id,name:'独立审查',amount:10,item:'meal',quantity:4});const p=w.household!.pools.at(-1)!;
 act(w,b,{operation:'respond',poolId:p.id,accept:true});
 act(w,a,{operation:'proposeGift',poolId:p.id,targetId:to.id,amount:7,item:'meal',quantity:5,ownPercent:40});const g=w.household!.gifts.at(-1)!;
 act(w,b,{operation:'approveGift',giftId:g.id});
 const action:HouseholdAction={type:'household',operation:'acceptGift',giftId:g.id};return {w,a,b,to,p,g,action};
}
function start(f:ReturnType<typeof setup>){const {w,to,action}=f;assert.ok(submitPlan(w,{id:'review-gift:'+ ++serial,actorId:to.id,actorRevision:to.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'领取原提议',actions:[action]}).ok);stepWorld(w,4.75);assert.equal(to.activity?.remaining,.25);}
for(const reverse of [false,true])for(const stop of ['cancelGift','close'] as const)test(`completed ${stop} stops pending original pickup, recipient first=${reverse}`,()=>{
 const f=setup();start(f);const {w,a,to,p,g,action}=f,before=to.coins,food=to.inventory.meal,money=totalCoins(w),approval=g.approvedAt;
 if(reverse)w.residents=[to,...w.residents.filter(r=>r!==to)];
 act(w,a,stop==='close'?{operation:stop,poolId:p.id}:{operation:stop,giftId:g.id});stepWorld(w,.25);
 assert.equal(g.status,'cancelled');assert.equal(g.deliveredAt,null);assert.equal(g.approvedAt,approval);assert.equal(to.coins,before);assert.equal(to.inventory.meal,food);assert.ok(to.lastFailure);assert.equal(to.activity,null);assert.equal(to.plan,null);
 assert.deepEqual(p.credits.map(c=>c.coins),[10,10]);assert.deepEqual(p.credits.map(c=>c.inventory.meal),[4,4]);assert.equal(accountBalance(w,g.account),0);assert.equal(totalCoins(w),money);assert.ok(completeHousehold(w,to,action));
});
test('one owners real food expiry preserves other owners original lots and exact remaining shares',()=>{
 const f=setup();start(f);const {w,a,b,to,p,g}=f,food=to.inventory.meal,coins=to.coins,money=totalCoins(w);
 const key=(id:string)=>'family-gift:'+g.id+':'+id;
 for(const lot of w.food!.lots[key(a.id)].meal!)lot.expiresAt=w.minute+.25;
 const otherLots=structuredClone(w.food!.lots[key(b.id)].meal!);stepWorld(w,.25);
 assert.equal(g.status,'expired');assert.equal(g.deliveredAt,null);assert.equal(to.inventory.meal,food);assert.equal(to.coins,coins);assert.deepEqual(p.credits.map(c=>c.inventory.meal),[2,4]);assert.deepEqual(p.credits.map(c=>c.coins),[10,10]);assert.equal(accountBalance(w,g.account),0);assert.equal(totalCoins(w),money);
 const returned=w.food!.lots['family-stock:'+p.id+':'+b.id].meal!;assert.ok(otherLots.every(lot=>returned.some(x=>x.producedAt===lot.producedAt&&x.expiresAt===lot.expiresAt&&x.definition===lot.definition)));assert.equal(w.food!.lots[key(a.id)]?.meal?.reduce((s,l)=>s+l.quantity,0)??0,0);
});
test('original deadline rejects final quarter-minute and cannot be extended by reusing old action',()=>{
 const f=setup();start(f);const {w,to,g,action}=f,food=to.inventory.meal;g.expiresAt=w.minute+.25;const deadline=g.expiresAt,approval=g.approvedAt;stepWorld(w,.25);
 assert.equal(g.status,'expired');assert.equal(g.expiresAt,deadline);assert.equal(g.approvedAt,approval);assert.equal(to.inventory.meal,food);assert.ok(completeHousehold(w,to,action));assert.equal(g.deliveredAt,null);
});
test('approved gift survives non-authority changes and does not require owners on site',()=>{
 const f=setup();const {w,a,b,to,g}=f;start(f);const approval=g.approvedAt,deadline=g.expiresAt,costs=structuredClone(g.costs),food=to.inventory.meal!;
 a.at={x:5,y:5};b.at={x:6,y:5};a.energy=b.energy=50;stepWorld(w,.25);
 assert.equal(g.status,'delivered');assert.equal(to.inventory.meal,food+5);assert.equal(g.approvedAt,approval);assert.equal(g.expiresAt,deadline);assert.deepEqual(g.costs,costs);
});
test('mismatched pool id cannot redirect an original gift action',()=>{
 const {w,a,to,p,g,action}=setup();const fake={...action,poolId:'not-the-original-pool'};const money=totalCoins(w);
 assert.ok(householdReason(w,to,fake));assert.ok(completeHousehold(w,to,fake));assert.equal(g.status,'ready');assert.equal(totalCoins(w),money);
 act(w,a,{operation:'cancelGift',giftId:g.id});advanceHousehold(w);assert.equal(p.status,'open');assert.equal(g.status,'cancelled');assert.ok(completeHousehold(w,to,action));
});
for(const reverse of [false,true])test(`zero-health contributor blocks final pickup before death bookkeeping, recipient first=${reverse}`,()=>{
 const f=setup();start(f);const {w,b,to,g}=f,food=to.inventory.meal,coins=to.coins;b.health=0;assert.equal(b.status,'alive');
 if(reverse)w.residents=[to,...w.residents.filter(r=>r!==to)];stepWorld(w,.25);
 assert.equal(b.status,'dead');assert.equal(g.status,'expired');assert.equal(g.deliveredAt,null);assert.equal(to.inventory.meal,food);assert.equal(to.coins,coins);
});
test('a selected nearby gift retains its known destination while a real route detours beyond eight tiles',()=>{
 const f=setup(),{w,a,b,to,p,g,action}=f;p.at={x:10,y:10};a.at=b.at={...p.at};to.at={x:14,y:10};w.buildings=[];w.resources=[];
 w.map.tiles.fill('cliff');for(let y=10;y<=18;y++)for(const x of [10,14])w.map.tiles[y*w.map.width+x]='grass';for(let x=10;x<=14;x++)w.map.tiles[18*w.map.width+x]='grass';
 assert.equal(g.knownBy.includes(to.id),false);assert.equal(householdReason(w,to,action),null);const before=to.inventory.meal!;
 assert.ok(submitPlan(w,{id:'review-detour:'+ ++serial,actorId:to.id,actorRevision:to.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'沿原路线领取',actions:[action]}).ok);
 stepWorld(w,40);assert.equal(to.lastFailure,null);assert.equal(g.status,'delivered');assert.equal(to.inventory.meal,before+5);assert.deepEqual(to.at,p.at);
});

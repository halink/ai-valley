import {estateGoods,estateParcels,ownedEstateParcels} from '../src/world/estate-custody.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFormalWorld} from '../src/world/formal-seed.js';
import type {Resident, World} from '../src/shared/types.js';
import type {EconomyAction} from '../src/shared/economy.js';
import {initializeEconomy,advanceEconomy,completeEconomy,economyTarget,moveCoins,accountBalance,totalCoins,salesLevy} from '../src/world/economy.js';
import {economyNotes,economyOpportunities,parseEconomyChoice} from '../src/server/economy-opportunities.js';
import {recordDeath} from '../src/world/life.js';
import {DAY} from '../src/world/time.js';
import {WorldStore} from '../src/server/store.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';

function fixture(){
  const w=createFormalWorld();w.clock.paused=false;initializeEconomy(w);
  const home=w.buildings.find(b=>b.kind==='home'&&b.ownerId!=='commons')!;
  const owner=w.residents.find(r=>r.id===home.ownerId)!;
  const buyer=w.residents.find(r=>r.id!==owner.id&&w.minute-r.bornAt>=18*112*DAY)!;
  for(const r of [owner,buyer]){r.at={...home.door};r.inside=null;r.knownBuildings.push(home.id);}
  const coins=totalCoins(w);
  return {w,home,owner,buyer,coins};
}
function act(w:World,r:Resident,a:Omit<EconomyAction,'type'>){
  const action:EconomyAction={type:'economy',...a};
  if(action.operation==='buy'&&action.maxTotal===undefined){const l=w.economy!.listings.find(l=>l.id===action.listingId)!;const gross=l.price*action.quantity!;action.maxTotal=gross+salesLevy(w,gross,`resident:${r.id}`);}
  if(action.operation==='order'&&action.maximumLevyBasisPoints===undefined)action.maximumLevyBasisPoints=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
  const route=economyTarget(w,r,action);assert.equal(route.error,undefined);
  r.at={...route.target};r.inside=null;
  assert.equal(completeEconomy(w,r,action),null);
}
function open(w:World,owner:Resident,buildingId:string){
  act(w,owner,{operation:'open',buildingId,name:'自定价小铺'});return w.economy!.businesses[0];
}

test('economy initialization has no grant, tax, assigned shop or minted money',()=>{
  const {w,coins}=fixture();assert.equal(w.economy!.initialCoins,coins);
  assert.equal(w.economy!.treasury,0);assert.equal(w.economy!.businesses.length,0);
  initializeEconomy(w);assert.equal(totalCoins(w),coins);assert.equal(w.economy!.ledger.length,0);
});
test('cash transfers are exact, durable and cannot be replayed with a different contract',()=>{
  const {w,owner,buyer,coins}=fixture();const before=owner.coins;
  assert.equal(moveCoins(w,`resident:${owner.id}`,`resident:${buyer.id}`,3,'赠款','once'),true);
  assert.equal(moveCoins(w,`resident:${owner.id}`,`resident:${buyer.id}`,3,'赠款','once'),true);
  assert.equal(moveCoins(w,`resident:${owner.id}`,`resident:${buyer.id}`,4,'赠款','once'),false);
  assert.equal(owner.coins,before-3);assert.equal(totalCoins(w),coins);
  assert.equal(moveCoins(w,`resident:${owner.id}`,'treasury',10000,'赠款','too-much'),false);
  assert.equal(moveCoins(w,`resident:${owner.id}`,'treasury',NaN,'赠款','nan'),false);
  const db=new WorldStore(':memory:');db.commit(w,null);const saved=db.load()!;
  assert.equal(moveCoins(saved,`resident:${owner.id}`,`resident:${buyer.id}`,3,'赠款','once'),true);
  assert.equal(totalCoins(saved),coins);db.close();
});
test('shop prices are supplied by the model; listing goods leave stock before a real buyer arrives',()=>{
  const {w,home,owner,buyer,coins}=fixture();owner.inventory.berry=10;
  const b=open(w,owner,home.id);act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:5});
  const choice=economyOpportunities(w,owner).find(c=>c.action.type==='economy'&&c.action.operation==='list'&&c.action.item==='berry')!;
  assert.ok(choice);const a=parseEconomyChoice(choice.action as EconomyAction,{price:7,quantity:3});
  act(w,owner,a);const listing=w.economy!.listings[0];assert.equal(listing.price,7);assert.equal(b.inventory.berry,2);
  const before=buyer.coins,berries=buyer.inventory.berry??0;
  act(w,buyer,{operation:'buy',listingId:listing.id,quantity:1});
  assert.equal(buyer.coins,before-7);assert.equal(b.coins,7);assert.equal(listing.quantity,2);assert.equal(buyer.inventory.berry,berries+1);
  assert.equal(totalCoins(w),coins);
  act(w,owner,{operation:'withdraw',businessId:b.id,amount:7});assert.equal(b.coins,0);assert.equal(totalCoins(w),coins);
});
test('monetary sale charges only an approved live levy and delivers all seller proceeds',()=>{
  const {w,home,owner,buyer,coins}=fixture();const b=open(w,owner,home.id);
  owner.inventory.berry=1;act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:1});
  act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:1,price:10});
  w.civic={proposals:[],budgets:[],stores:{},salesTax:{basisPoints:1000,expiresAt:w.minute+DAY,proposalId:'ratified'},nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};
  const before=buyer.coins;act(w,buyer,{operation:'buy',listingId:w.economy!.listings[0].id,quantity:1});
  assert.equal(buyer.coins,before-11);assert.equal(b.coins,10);assert.equal(w.economy!.treasury,1);assert.equal(totalCoins(w),coins);
  w.minute+=DAY;assert.equal(salesLevy(w,10),0);
});
test('an unfunded shopper cannot take goods and no remote stock is an executable choice',()=>{
  const {w,home,owner,buyer}=fixture();const b=open(w,owner,home.id);
  owner.inventory.berry=2;act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:2});
  act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:2,price:1000});
  const a:EconomyAction={type:'economy',operation:'buy',listingId:w.economy!.listings[0].id,quantity:1};
  const inv={...buyer.inventory};assert.ok(completeEconomy(w,buyer,a));assert.deepEqual(buyer.inventory,inv);assert.equal(w.economy!.listings[0].quantity,2);
  buyer.at={x:home.door.x+20,y:home.door.y};
  assert.equal(economyOpportunities(w,buyer).some(c=>c.action.type==='economy'&&c.action.operation==='buy'),false);
});
test('cancelling and expiring quotes return exact unsold goods without duplication',()=>{
  const {w,home,owner}=fixture();const b=open(w,owner,home.id);owner.inventory.berry=8;
  act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:8});
  act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:3,price:2});
  act(w,owner,{operation:'cancel',listingId:w.economy!.listings[0].id});assert.equal(b.inventory.berry,8);
  act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:5,price:4});
  w.minute+=8*DAY;advanceEconomy(w);advanceEconomy(w);assert.equal(b.inventory.berry,8);
});
test('business posts a prepaid order and another person earns actual cash on delivering actual goods',()=>{
  const {w,home,owner,buyer,coins}=fixture();const b=open(w,owner,home.id);buyer.inventory.wood=5;
  act(w,owner,{operation:'fund',businessId:b.id,amount:12});
  act(w,owner,{operation:'order',businessId:b.id,item:'wood',quantity:3,price:4});
  const l=w.economy!.listings[0];assert.equal(b.coins,0);assert.equal(accountBalance(w,l.escrowId!),12);
  const before=buyer.coins;act(w,buyer,{operation:'fulfill',listingId:l.id,quantity:2});
  assert.equal(buyer.coins,before+8);assert.equal(buyer.inventory.wood,3);assert.equal(b.inventory.wood,2);assert.equal(accountBalance(w,l.escrowId!),4);
  act(w,owner,{operation:'cancel',listingId:l.id});assert.equal(b.coins,4);assert.equal(accountBalance(w,l.escrowId!),0);assert.equal(totalCoins(w),coins);
});
test('orders cannot acquire uncarried goods and expired contracts refund the reserved cash',()=>{
  const {w,home,owner,buyer,coins}=fixture();const b=open(w,owner,home.id);
  act(w,owner,{operation:'fund',businessId:b.id,amount:10});act(w,owner,{operation:'order',businessId:b.id,item:'stone',quantity:2,price:5});
  buyer.inventory.stone=0;const l=w.economy!.listings[0];assert.ok(completeEconomy(w,buyer,{type:'economy',operation:'fulfill',listingId:l.id,quantity:1}));
  assert.equal(accountBalance(w,l.escrowId!),10);w.minute+=8*DAY;advanceEconomy(w);assert.equal(b.coins,10);assert.equal(totalCoins(w),coins);
});
test('owner death protects business funds, stock and unspent order escrow in the same estate exactly once',()=>{
  const {w,home,owner,coins}=fixture();const b=open(w,owner,home.id);owner.inventory.berry=9;
  act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:6});
  act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:4,price:2});
  act(w,owner,{operation:'fund',businessId:b.id,amount:10});act(w,owner,{operation:'order',businessId:b.id,item:'water',quantity:5,price:2});
  recordDeath(w,owner);advanceEconomy(w);advanceEconomy(w);
  const estate=w.estates.find(e=>e.personId===owner.id)!;
  assert.equal(estateGoods(w,owner.id).berry,9);assert.ok(estate.parcels?.some(s=>s.inventory.berry===6&&s.location.at.x===home.door.x&&s.location.at.y===home.door.y));assert.equal(b.coins,0);assert.deepEqual(b.inventory,{});assert.notEqual(b.closedAt,null);assert.equal(totalCoins(w),coins);
});
test('departing proprietors retain capital and a temporary inability to decide does not liquidate the business',()=>{
  const {w,home,owner,coins}=fixture();const b=open(w,owner,home.id);act(w,owner,{operation:'fund',businessId:b.id,amount:5});
  owner.canDecide=false;advanceEconomy(w);assert.equal(b.closedAt,null);
  owner.residency='outside';advanceEconomy(w);assert.notEqual(b.closedAt,null);assert.equal(b.coins,0);assert.equal(totalCoins(w),coins);
});
test('model choice parsing cannot hide a price or inject an unrelated purchase target',()=>{
  const a:EconomyAction={type:'economy',operation:'list',businessId:'one',item:'berry',quantity:1,price:1};
  assert.throws(()=>parseChoice(JSON.stringify({choice:'1'}),[{id:'1',label:'报价',action:a}]));
  assert.throws(()=>parseChoice(JSON.stringify({choice:'1',quantity:2,price:4,businessId:'another'}),[{id:'1',label:'报价',action:a}]));
  assert.throws(()=>parseEconomyChoice(a,{quantity:2,price:-1}));
  assert.equal((parseChoice(JSON.stringify({choice:'1',quantity:2,price:4}),[{id:'1',label:'报价',action:a}]).actions[0] as EconomyAction).price,4);
});
test('actual model menu and engine walk a proprietor home to establish a personally chosen shop',()=>{
  const {w,home,owner}=fixture();owner.at={x:home.door.x,y:home.door.y+2};
  const menu=decisionChoices(decisionContext(w,owner)),choice=menu.find(c=>c.action.type==='economy'&&c.action.operation==='open')!;
  assert.ok(choice);const decision=parseChoice(JSON.stringify({choice:choice.id,name:'山谷杂货'}),menu);
  const plan={id:'open-through-engine',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:decision.intention,actions:decision.actions};
  assert.equal(submitPlan(w,plan).ok,true);stepWorld(w,25);
  assert.equal(owner.lastFailure,null);assert.equal(w.economy!.businesses[0].name,'山谷杂货');assert.deepEqual(owner.at,home.door);
});
test('twenty one-coin sales collect a five-percent levy through exact persisted fractional carry',()=>{
  const {w,home,owner,buyer,coins}=fixture();const b=open(w,owner,home.id);owner.inventory.berry=20;
  act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:20});
  act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:20,price:1});
  w.civic={proposals:[],budgets:[],stores:{},salesTax:{basisPoints:500,expiresAt:w.minute+DAY,proposalId:'tax-a'},nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};
  const id=w.economy!.listings[0].id;
  for(let i=0;i<19;i++)act(w,buyer,{operation:'buy',listingId:id,quantity:1});
  assert.equal(w.economy!.treasury,0);assert.equal(salesLevy(w,1,`resident:${buyer.id}`),1);
  const db=new WorldStore(':memory:');db.commit(w,null);const saved=db.load()!,savedBuyer=saved.residents.find(r=>r.id===buyer.id)!;
  act(saved,savedBuyer,{operation:'buy',listingId:id,quantity:1});
  assert.equal(saved.economy!.treasury,1);assert.equal(saved.economy!.businesses[0].coins,20);assert.equal(totalCoins(saved),coins);db.close();
  w.civic.salesTax!.proposalId='tax-b';assert.equal(salesLevy(w,1,`resident:${buyer.id}`),0);
});
test('prepaid purchase orders reserve rounded tax headroom and can settle one unit at a time',()=>{
  const {w,home,owner,buyer,coins}=fixture();const b=open(w,owner,home.id);buyer.inventory.wood=20;
  w.civic={proposals:[],budgets:[],stores:{},salesTax:{basisPoints:500,expiresAt:w.minute+DAY,proposalId:'tax-a'},nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};
  act(w,owner,{operation:'fund',businessId:b.id,amount:21});
  act(w,owner,{operation:'order',businessId:b.id,item:'wood',quantity:20,price:1});
  const id=w.economy!.listings[0].id;
  for(let i=0;i<20;i++)act(w,buyer,{operation:'fulfill',listingId:id,quantity:1});
  assert.equal(w.economy!.treasury,1);assert.equal(b.inventory.wood,20);assert.equal(accountBalance(w,w.economy!.listings[0].escrowId!),0);assert.equal(totalCoins(w),coins);
});
test('a changed levy cannot charge a buyer more than their personally observed total',()=>{
  const {w,home,owner,buyer}=fixture();const b=open(w,owner,home.id);owner.inventory.berry=1;
  act(w,owner,{operation:'stock',businessId:b.id,item:'berry',quantity:1});act(w,owner,{operation:'list',businessId:b.id,item:'berry',quantity:1,price:10});
  const choice=economyOpportunities(w,buyer).find(c=>c.action.type==='economy'&&c.action.operation==='buy')!;
  assert.equal((choice.action as EconomyAction).maxTotal,10);
  w.civic={proposals:[],budgets:[],stores:{},salesTax:{basisPoints:1000,expiresAt:w.minute+DAY,proposalId:'new-tax'},nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};
  const before=buyer.coins;assert.ok(completeEconomy(w,buyer,choice.action as EconomyAction));assert.equal(buyer.coins,before);assert.equal(w.economy!.listings[0].quantity,1);
});
test('an absent shopkeeper must revisit their own shop to know its current ledger and stock',()=>{
  const {w,home,owner}=fixture();open(w,owner,home.id);owner.at={x:home.door.x+20,y:home.door.y};
  const menu=economyOpportunities(w,owner);
  assert.ok(menu.some(c=>c.id==='economy.return'&&c.action.type==='move'));
  assert.equal(menu.some(c=>c.action.type==='economy'),false);
  assert.match(economyNotes(w,owner),/须亲自回店查看账本/);
});
test('repeated completed businesses and empty escrow accounts do not enlarge the working state indefinitely',()=>{
  const {w,home,owner,coins}=fixture();
  for(let i=0;i<500;i++){
    act(w,owner,{operation:'open',buildingId:home.id});const business=w.economy!.businesses.at(-1)!;
    act(w,owner,{operation:'fund',businessId:business.id,amount:1});
    act(w,owner,{operation:'order',businessId:business.id,item:'wood',quantity:1,price:1});
    act(w,owner,{operation:'close',businessId:business.id});advanceEconomy(w);
  }
  assert.ok(w.economy!.businesses.length<=241);assert.ok(w.economy!.listings.length<=240);assert.equal(Object.keys(w.economy!.escrows).length,0);
  assert.equal(totalCoins(w),coins);assert.ok(w.processed.length>1000);
});

test('automatic shop estate settlement retains real stock and cash without telling on-site customers of a distant owners death',()=>{const {w,owner,buyer,home,coins}=fixture(),shop=open(w,owner,home.id);act(w,owner,{operation:'stock',businessId:shop.id,item:'wood',quantity:2});const before=owner.inventory.wood;owner.at={...w.map.entrance};owner.inside=null;recordDeath(w,owner);advanceEconomy(w);assert.notEqual(shop.closedAt,null);assert.equal(estateGoods(w,owner.id).wood,2+before!);assert.equal(totalCoins(w),coins);const e=[...w.events].reverse().find(e=>e.kind==='trade')!;assert.match(e.text,/遗产/);assert.equal(e.observerOnly,true);assert.deepEqual(e.witnesses,[]);assert.ok(!buyer.memories.some(m=>m.eventId===e.id));});

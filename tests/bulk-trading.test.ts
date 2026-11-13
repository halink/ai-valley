import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {EconomyAction} from '../src/shared/economy.js';
import type {Item,Resident,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {initializeEconomy,completeEconomy,economyReason,economyTarget,accountBalance,totalCoins,salesLevy} from '../src/world/economy.js';
import {foodContainers,initializeFood} from '../src/world/food.js';
import {economyOpportunities,parseEconomyChoice} from '../src/server/economy-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';

function fixture(frontier=false){
 const w=frontier?createFrontierWorld():createWorld();w.mode='formal';w.clock.paused=false;
 const home=w.buildings.find(b=>b.kind==='home'&&b.ownerId!=='commons')!;
 const owner=w.residents.find(r=>r.id===home.ownerId)!;
 const others=w.residents.filter(r=>r!==owner&&w.minute-r.bornAt>=18*YEAR);
 const [buyer,peer]=others;
 for(const r of [owner,buyer,peer]){r.at={...home.door};r.inside=null;r.roomAt=null;r.knownBuildings=[...new Set([...r.knownBuildings,home.id])];r.coins=500;r.health=100;r.energy=100;r.hunger=5;r.plan=null;r.activity=null;}
 initializeEconomy(w);initializeForeignTrade(w);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:home.id}),null);
 const shop=w.economy!.businesses[0];
 return {w,home,owner,buyer,peer,shop};
}
function sale(f:ReturnType<typeof fixture>,item:Item='wood',quantity=6,price=4){
 f.owner.inventory[item]=(f.owner.inventory[item]??0)+quantity;
 assert.equal(completeEconomy(f.w,f.owner,{type:'economy',operation:'stock',businessId:f.shop.id,item,quantity}),null);
 assert.equal(completeEconomy(f.w,f.owner,{type:'economy',operation:'list',businessId:f.shop.id,item,quantity,price}),null);
 return f.w.economy!.listings.at(-1)!;
}
function order(f:ReturnType<typeof fixture>,item:Item='wood',quantity=6,price=4){
 const rate=f.w.civic?.salesTax?.basisPoints??0,amount=quantity*price+Math.ceil(quantity*price*rate/10000);
 assert.equal(completeEconomy(f.w,f.owner,{type:'economy',operation:'fund',businessId:f.shop.id,amount}),null);
 assert.equal(completeEconomy(f.w,f.owner,{type:'economy',operation:'order',businessId:f.shop.id,item,quantity,price,maximumLevyBasisPoints:rate}),null);
 f.buyer.inventory[item]=(f.buyer.inventory[item]??0)+quantity;
 return f.w.economy!.listings.at(-1)!;
}
function action(f:ReturnType<typeof fixture>,operation:'buy'|'fulfill',quantity:number,extra:Partial<EconomyAction>={}):EconomyAction {
 const l=f.w.economy!.listings.at(-1)!;
 return {type:'economy',operation,listingId:l.id,item:l.item,buildingId:f.home.id,quantity,...(operation==='buy'?{maxTotal:l.price*quantity+salesLevy(f.w,l.price*quantity,'resident:'+f.buyer.id)}:{minTotal:l.price*quantity}),...extra};
}
function stable(w:World,r:Resident,a:EconomyAction,id='bulk-test'){
 r.activity={planId:id,startedAt:w.minute,action:structuredClone(a),path:[],target:{...r.at},remaining:3,definition:w.activeDefinitions['action/routine']};
}
function stock(w:World,item:Item){return [...foodContainers(w).values()].reduce((sum,i)=>sum+(i[item]??0),0);}
function state(f:ReturnType<typeof fixture>){return structuredClone({people:f.w.residents.map(r=>({coins:r.coins,inventory:r.inventory})),economy:f.w.economy,processed:f.w.processed});}
function levy(w:World,rate=1000){w.civic??={proposals:[],budgets:[],stores:{},salesTax:null,nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};w.civic.salesTax={basisPoints:rate,expiresAt:w.minute+DAY,proposalId:'bulk-tax'};}

for(const frontier of [false,true])test(`normal menu executes bulk buy and supplier minimum in ${frontier?'formal nine-person':'legacy-equivalent'} world`,()=>{
 const f=fixture(frontier),{w,buyer,home,shop}=f;levy(w);sale(f,'wood',6,4);
 buyer.hunger=85; // Keep the actor's ordinary decision frame representative; this is not a scripted direct action.
 const menu=decisionChoices(decisionContext(w,buyer)),choice=menu.find(c=>c.action.type==='economy'&&c.action.operation==='buy');
 assert.ok(choice,'the final model menu exposes the concrete market listing');assert.match(choice.label,/minimumQuantity/);
 const decision=parseChoice(JSON.stringify({choice:choice.id,quantity:4,maxTotal:18}),menu),coins=totalCoins(w),goods=stock(w,'wood'),before=buyer.coins;
 assert.match(decision.intention,/4 份/);
 const submitted=submitPlan(w,{id:'real-bulk-buy',actorId:buyer.id,actorRevision:buyer.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...decision});assert.equal(submitted.ok,true);
 for(let i=0;i<12&&(buyer.plan||buyer.activity);i++)stepWorld(w,1);
 assert.equal(buyer.lastFailure,null);assert.equal(buyer.coins,before-17);assert.equal(shop.sales,4);assert.equal(w.economy!.treasury,1);assert.equal(totalCoins(w),coins);assert.equal(stock(w,'wood'),goods);assert.deepEqual(buyer.at,home.door);
 order(f,'stone',4,5);const supplyMenu=decisionChoices(decisionContext(w,buyer)),supply=supplyMenu.find(c=>c.action.type==='economy'&&c.action.operation==='fulfill');assert.ok(supply);
 const supplyDecision=parseChoice(JSON.stringify({choice:supply.id,quantity:3,minTotal:15}),supplyMenu),beforeSupply=buyer.coins;
 assert.equal(submitPlan(w,{id:'real-bulk-supply',actorId:buyer.id,actorRevision:buyer.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...supplyDecision}).ok,true);
 for(let i=0;i<12&&(buyer.plan||buyer.activity);i++)stepWorld(w,1);
 assert.equal(buyer.lastFailure,null);assert.equal(buyer.coins,beforeSupply+15);assert.equal(shop.inventory.stone,3);assert.equal(totalCoins(w),coins);

});

test('parser requires explicit bounds, defaults to exact quantity and cannot retarget a listing',()=>{
 const f=fixture();sale(f);const base=economyOpportunities(f.w,f.buyer).find(c=>c.action.type==='economy'&&c.action.operation==='buy')!;
 const parsed=parseEconomyChoice(base.action as EconomyAction,{quantity:4,maxTotal:16});assert.equal(parsed.minimumQuantity,undefined);assert.equal(parsed.quantity,4);
 for(const data of [{quantity:4},{quantity:4,maxTotal:16,minimumQuantity:5},{quantity:4,maxTotal:16,minimumQuantity:0},{quantity:1.5,maxTotal:16},{quantity:4,maxTotal:Infinity}])assert.throws(()=>parseEconomyChoice(base.action as EconomyAction,data));
 assert.throws(()=>parseChoice(JSON.stringify({choice:'1',quantity:4,maxTotal:16,listingId:'other'}),[{...base,id:'1'}]));
 const supplier:EconomyAction={type:'economy',operation:'fulfill',quantity:1,minTotal:4};assert.throws(()=>parseEconomyChoice(supplier,{quantity:2}));
 assert.equal(parseEconomyChoice(supplier,{quantity:4,minTotal:8,minimumQuantity:2}).minTotal,8);
});

test('competing buyers only permit an explicit minimum fill, never silently change an exact order',()=>{
 const f=fixture(),l=sale(f,'wood',6,4),planned=action(f,'buy',5),before=stock(f.w,'wood'),coins=totalCoins(f.w);
 assert.equal(completeEconomy(f.w,f.peer,{...planned,quantity:3,maxTotal:12}),null);assert.equal(l.quantity,3);
 const unchanged=state(f);assert.match(completeEconomy(f.w,f.buyer,planned)!,/最低数量/);assert.deepEqual(state(f),unchanged);
 assert.match(completeEconomy(f.w,f.buyer,{...planned,minimumQuantity:4})!,/最低数量/);
 assert.equal(completeEconomy(f.w,f.buyer,{...planned,minimumQuantity:2}),null);assert.equal(l.quantity,0);assert.equal(l.status,'sold');assert.equal(f.w.economy!.trades!.at(-1)!.quantity,3);assert.equal(stock(f.w,'wood'),before);assert.equal(totalCoins(f.w),coins);

});

test('supplier partial consent never scales down the absolute proceeds floor',()=>{
 const f=fixture(),l=order(f,'wood',6,4),original=action(f,'fulfill',5,{minimumQuantity:2}),coins=totalCoins(f.w),goods=stock(f.w,'wood');
 f.peer.inventory.wood=(f.peer.inventory.wood??0)+3;const added=3;
 assert.equal(completeEconomy(f.w,f.peer,{...original,quantity:3,minTotal:12,minimumQuantity:3}),null);assert.equal(l.quantity,3);
 const unchanged=state(f);assert.match(completeEconomy(f.w,f.buyer,original)!,/最低总额/);assert.deepEqual(state(f),unchanged);
 assert.equal(completeEconomy(f.w,f.buyer,{...original,minTotal:12}),null);assert.equal(l.quantity,0);assert.equal(accountBalance(f.w,l.escrowId!),0);assert.equal(f.shop.inventory.wood,6);assert.equal(stock(f.w,'wood'),goods+added);assert.equal(totalCoins(f.w),coins);
});

test('fresh quantity is checked and original food lots follow an authorized partial fill',()=>{
 const f=fixture(),l=sale(f,'berry',6,2),a=action(f,'buy',6,{minimumQuantity:3,maxTotal:12});initializeFood(f.w);
 const original=f.w.food!.lots['listing:'+l.id].berry![0];
 f.w.food!.lots['listing:'+l.id].berry=[{...original,quantity:2,expiresAt:f.w.minute+1},{...original,quantity:4,expiresAt:f.w.minute+60}];
 f.w.minute+=2;const coins=totalCoins(f.w),before=f.buyer.inventory.berry??0;
 assert.equal(economyReason(f.w,f.buyer,a),null);assert.equal(completeEconomy(f.w,f.buyer,a),null);
 assert.equal(l.quantity,0);assert.equal(f.buyer.inventory.berry,before+4);assert.equal(f.w.food!.spoiled.berry,2);assert.equal(totalCoins(f.w),coins);
 assert.ok(f.w.food!.lots['person:'+f.buyer.id].berry!.some(lot=>lot.quantity===4&&lot.expiresAt===f.w.minute+58));
 const delivered=f.w.food!.lots['person:'+f.buyer.id].berry!.find(lot=>lot.expiresAt===f.w.minute+58)!;assert.equal(delivered.producedAt,original.producedAt);assert.equal(delivered.definition,original.definition);
});

test('spoiled supplier goods cannot be sold, and below-minimum shortage moves no money',()=>{
 const f=fixture(),l=order(f,'berry',5,3),a=action(f,'fulfill',5,{minimumQuantity:4,minTotal:12});f.buyer.inventory.berry=5;initializeFood(f.w);
 const old=f.w.food!.lots['person:'+f.buyer.id].berry![0];f.w.food!.lots['person:'+f.buyer.id].berry=[{...old,quantity:2,expiresAt:f.w.minute},{...old,quantity:3,expiresAt:f.w.minute+100}];
 const coins=f.buyer.coins,escrow=accountBalance(f.w,l.escrowId!);assert.match(completeEconomy(f.w,f.buyer,a)!,/最低数量/);assert.equal(f.buyer.coins,coins);assert.equal(accountBalance(f.w,l.escrowId!),escrow);assert.equal(f.shop.inventory.berry??0,0);assert.equal(f.buyer.inventory.berry,3);
});

test('price, levy and cash changes are bounded without silently shrinking to a cheaper fill',()=>{
 const f=fixture(),l=sale(f,'wood',6,4),a=action(f,'buy',4,{minimumQuantity:1,maxTotal:16});
 levy(f.w);let before=state(f);assert.match(completeEconomy(f.w,f.buyer,a)!,/总价/);assert.deepEqual(state(f),before);
 f.w.civic!.salesTax=null;l.price=5;before=state(f);assert.match(completeEconomy(f.w,f.buyer,a)!,/总价/);assert.deepEqual(state(f),before);
 l.price=4;f.buyer.coins=8;before=state(f);assert.match(completeEconomy(f.w,f.buyer,a)!,/钱款不足/);assert.deepEqual(state(f),before);
 const g=fixture(),o=order(g,'wood',4,5),offer=action(g,'fulfill',4);o.price=4;before=state(g);assert.match(completeEconomy(g.w,g.buyer,offer)!,/最低总额/);assert.deepEqual(state(g),before);
 o.price=5;levy(g.w);before=state(g);assert.match(completeEconomy(g.w,g.buyer,offer)!,/比例/);assert.deepEqual(state(g),before);
});

test('all payment legs and refunds preflight before any coin, goods, tax carry or receipt moves',()=>{
 const f=fixture();sale(f,'wood',4,10);levy(f.w);f.w.economy!.treasury=Number.MAX_SAFE_INTEGER;
 const a=action(f,'buy',3),before=state(f);assert.match(completeEconomy(f.w,f.buyer,a)!,/账户或收据/);assert.deepEqual(state(f),before);
 const g=fixture();levy(g.w,500);const l=order(g,'wood',2,1);g.shop.coins=Number.MAX_SAFE_INTEGER;
 // Rounded tax reservation leaves one coin to refund after this final delivery.
 const deliver=action(g,'fulfill',2),saved=state(g);assert.equal(accountBalance(g.w,l.escrowId!),3);assert.match(completeEconomy(g.w,g.buyer,deliver)!,/账户或收据/);assert.deepEqual(state(g),saved);
});

test('closed, expired, relocated, mismatched and remote quotes cannot be completed',()=>{
 for(const change of ['closed','expired','relocated','item','inside','remote'] as const){
  const f=fixture(),l=sale(f),a=action(f,'buy',3),beforeCoins=totalCoins(f.w),before=f.buyer.coins;
  if(change==='closed')f.shop.closedAt=f.w.minute;
  if(change==='expired')l.expiresAt=f.w.minute;
  if(change==='relocated'){const site={...structuredClone(f.home),id:'changed-shop',residents:[]};f.w.buildings.push(site);f.shop.buildingId=site.id;f.buyer.knownBuildings.push(site.id);}
  if(change==='item')a.item='stone';
  if(change==='inside')f.buyer.inside=f.home.id;
  if(change==='remote')f.buyer.at={x:1,y:1};
  assert.ok(completeEconomy(f.w,f.buyer,a),change);assert.equal(f.buyer.coins,before);assert.equal(l.quantity,6);assert.equal(totalCoins(f.w),beforeCoins);
 }
 const f=fixture();sale(f);f.buyer.at={x:1,y:1};assert.ok(economyTarget(f.w,f.buyer,action(f,'buy',2)).error);assert.equal(economyOpportunities(f.w,f.buyer).some(c=>c.action.type==='economy'&&c.action.operation==='buy'),false);
});

test('completed sold-out contracts replay exactly once across indexed restart and reject changed terms',()=>{
 const f=fixture(),l=sale(f,'wood',4,10);levy(f.w);const a=action(f,'buy',4),coins=totalCoins(f.w);stable(f.w,f.buyer,a);
 const activity=structuredClone(f.buyer.activity!);assert.equal(completeEconomy(f.w,f.buyer,a),null);assert.equal(l.status,'sold');
 const db=new WorldStore(':memory:');try{db.commit(f.w,null);const w=db.loadForRuntime()!,r=w.residents.find(p=>p.id===f.buyer.id)!;r.activity=activity;
 const before=JSON.stringify({economy:w.economy,inventory:r.inventory,coins:r.coins});assert.equal(completeEconomy(w,r,a),null);assert.ok(completeEconomy(w,r,{...a,maxTotal:a.maxTotal!+1}));assert.equal(JSON.stringify({economy:w.economy,inventory:r.inventory,coins:r.coins}),before);assert.deepEqual(w.processed,[]);assert.equal(totalCoins(w),coins);
 }finally{db.close();}
});

test('pending explicit partial consent survives restart without being reset or widened',()=>{
 const f=fixture();sale(f,'wood',6,3);const a=action(f,'buy',5,{minimumQuantity:3,maxTotal:15});stable(f.w,f.buyer,a);
 assert.equal(completeEconomy(f.w,f.peer,{...a,quantity:3,minimumQuantity:3,maxTotal:9}),null);
 const db=new WorldStore(':memory:');try{db.commit(f.w,null);const w=db.loadForRuntime()!,r=w.residents.find(p=>p.id===f.buyer.id)!;assert.deepEqual(r.activity!.action,a);const coins=totalCoins(w);stepWorld(w,4);assert.equal(r.lastFailure,null);assert.equal(w.economy!.trades!.at(-1)!.quantity,3);assert.equal(w.economy!.trades!.at(-1)!.minimumQuantity,3);assert.equal(totalCoins(w),coins);}finally{db.close();}
});

test('older saves acquire no retrospective trades or partial authorization; old seller action needs fresh minimum',()=>{
 const f=fixture(),l=sale(f,'wood',4,2);delete f.w.economy!.trades;const a=action(f,'buy',4);delete a.buildingId;delete a.item;
 assert.equal(completeEconomy(f.w,f.peer,{...a,quantity:1,maxTotal:2}),null);const before=state(f);assert.match(completeEconomy(f.w,f.buyer,a)!,/最低数量/);assert.deepEqual(state(f),before);assert.equal(l.quantity,3);
 const g=fixture();order(g);const legacy=action(g,'fulfill',2);delete legacy.minTotal;const unchanged=state(g);assert.match(completeEconomy(g.w,g.buyer,legacy)!,/最低总额/);assert.deepEqual(state(g),unchanged);
});

test('mixed bulk and single fills share levy fractions and conserve cash through final order refund',()=>{
 const f=fixture();levy(f.w,500);const l=order(f,'wood',20,1),coins=totalCoins(f.w),goods=stock(f.w,'wood');
 for(const quantity of [7,1,12])assert.equal(completeEconomy(f.w,f.buyer,action(f,'fulfill',quantity)),null);
 assert.equal(f.w.economy!.treasury,1);assert.equal(accountBalance(f.w,l.escrowId!),0);assert.equal(l.status,'sold');assert.equal(stock(f.w,'wood'),goods);assert.equal(totalCoins(f.w),coins);
});

test('same-tick competing activities settle once against current stock with preserved partial consent',()=>{
 const f=fixture(),l=sale(f,'wood',6,4),a=action(f,'buy',4),coins=totalCoins(f.w),goods=stock(f.w,'wood');
 stable(f.w,f.buyer,a,'buyer-one');stable(f.w,f.peer,{...a,minimumQuantity:2},'buyer-two');
 const first=f.w.residents.indexOf(f.buyer)<f.w.residents.indexOf(f.peer)?f.buyer:f.peer;
 assert.equal(first.id,f.buyer.id,'fixture actors settle in the expected engine order');
 stepWorld(f.w,4);assert.equal(f.buyer.lastFailure,null);assert.equal(f.peer.lastFailure,null);assert.equal(l.quantity,0);
 assert.deepEqual(f.w.economy!.trades!.map(t=>t.quantity),[4,2]);assert.equal(totalCoins(f.w),coins);assert.equal(stock(f.w,'wood'),goods);
});

test('supplier transfers earliest original fresh lots while untransferred stock remains in place',()=>{
 const f=fixture(),l=order(f,'berry',3,4);f.buyer.inventory.berry=5;initializeFood(f.w);
 const old=f.w.food!.lots['person:'+f.buyer.id].berry![0],early=f.w.minute+50,late=f.w.minute+100;
 f.w.food!.lots['person:'+f.buyer.id].berry=[{...old,quantity:2,expiresAt:early},{...old,quantity:3,expiresAt:late}];
 assert.equal(completeEconomy(f.w,f.buyer,action(f,'fulfill',3)),null);assert.equal(l.status,'sold');
 assert.deepEqual(f.w.food!.lots['business:'+f.shop.id].berry!.map(lot=>[lot.quantity,lot.expiresAt]),[[2,early],[1,late]]);
 assert.deepEqual(f.w.food!.lots['person:'+f.buyer.id].berry!.map(lot=>[lot.quantity,lot.expiresAt]),[[2,late]]);
});

test('a later fractional tax carry alone cannot exceed the buyers observed maximum',()=>{
 const f=fixture();sale(f,'wood',20,1);levy(f.w,500);const planned=action(f,'buy',2);assert.equal(planned.maxTotal,2);
 const l=f.w.economy!.listings[0];assert.equal(completeEconomy(f.w,f.buyer,action(f,'buy',18)),null);
 assert.equal(l.quantity,2);const before=state(f);assert.match(completeEconomy(f.w,f.buyer,planned)!,/总价/);assert.deepEqual(state(f),before);
 assert.equal(completeEconomy(f.w,f.buyer,{...planned,maxTotal:3}),null);assert.equal(f.w.economy!.treasury,1);
});

test('legacy done receipt remains sufficient to prevent old sold-out purchase replay after restart',()=>{
 const f=fixture();sale(f,'wood',2,4);const a=action(f,'buy',2);stable(f.w,f.buyer,a,'legacy-purchase');
 assert.equal(completeEconomy(f.w,f.buyer,a),null);
 const contractIndex=f.w.processed.findIndex(receipt=>receipt.startsWith('market-contract:'));
 assert.ok(contractIndex>=0);f.w.processed[contractIndex]=`done:economy-action:legacy-purchase:${f.w.minute}:buy`;
 delete f.w.economy!.trades;
 const db=new WorldStore(':memory:');try{db.commit(f.w,null);const w=db.loadForRuntime()!,r=w.residents.find(p=>p.id===f.buyer.id)!;
 const coins=totalCoins(w),inventory=structuredClone(r.inventory),transfers=w.economy!.transferCount;
 assert.equal(completeEconomy(w,r,a),null);assert.deepEqual(r.inventory,inventory);assert.equal(totalCoins(w),coins);assert.equal(w.economy!.transferCount,transfers);assert.equal(w.economy!.trades,undefined);assert.deepEqual(w.processed,[]);
 }finally{db.close();}
});

test('observer trade history stays bounded without erasing durable replay protection',()=>{
 const f=fixture();sale(f,'wood',100,1);const first=action(f,'buy',1);stable(f.w,f.buyer,first,'first-bounded-history');
 const original=structuredClone(f.buyer.activity!);assert.equal(completeEconomy(f.w,f.buyer,first),null);f.buyer.activity=null;
 for(let i=1;i<100;i++)assert.equal(completeEconomy(f.w,f.buyer,action(f,'buy',1)),null);
 sale(f,'wood',30,1);for(let i=0;i<30;i++)assert.equal(completeEconomy(f.w,f.buyer,action(f,'buy',1)),null);
 assert.equal(f.w.economy!.trades!.length,120);assert.equal(f.w.economy!.trades!.some(t=>t.id.includes('first-bounded-history')),false);
 const before=state(f);f.buyer.activity=original;assert.equal(completeEconomy(f.w,f.buyer,first),null);assert.deepEqual(state(f),before);
});

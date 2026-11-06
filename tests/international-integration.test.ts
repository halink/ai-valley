import {estateGoods,estateParcels,ownedEstateParcels} from '../src/world/estate-custody.js';
import {atWorkstation} from './helpers/workspaces.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {DecisionContext,World} from '../src/shared/types.js';
import type {ModelResult} from '../src/server/decisions.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {initializeMigration} from '../src/world/migration.js';
import {initializeForeignTrade,advanceForeignTrade,foreignCandidates,completeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeEconomy,totalCoins,completeEconomy,advanceEconomy} from '../src/world/economy.js';
import {initializeEmployment,completeEmployment,advanceEmployment} from '../src/world/employment.js';
import {recordDeath} from '../src/world/life.js';
import {initializeProduction,completeProduction,claimableInheritance} from '../src/world/production.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {initializeCivic} from '../src/world/civic.js';
import {initializeIndustry} from '../src/world/industry.js';
import {DAY,YEAR} from '../src/world/time.js';
import {emitEvent} from '../src/world/events.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function isolateMerchants():World {
 const w=createFormalWorld();
 for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+1000;}
 initializeEconomy(w);initializeMigration(w);initializeForeignTrade(w);initializeIndustry(w);
 for(const merchant of w.foreignTrade!.merchants)merchant.person.decisionDue=w.minute;
 for(const contact of w.migration!.contacts){contact.phase='home';contact.futureAt=w.minute+10000;}
 w.migration!.nextPostAt=w.minute+10000;
 return w;
}
const waitResult=():ModelResult=>({decision:{intention:'暂时不做生意，稍后再考虑',actions:[{type:'foreignTrade',operation:'wait',minutes:120}]},inputTokens:1,outputTokens:1,latencyMs:1});

test('foreign merchants use the same bounded model queue, decide only for themselves, and persist a decision to wait',async()=>{
 const base=isolateMerchants(),opening=totalCoins(base),ready=foreignCandidates(base);
 assert.ok(ready.length>=2);
 const store=new WorldStore(':memory:');store.commit(base,null);
 const received:DecisionContext[]=[],pending:Array<()=>void>=[];
 const runtime=new ValleyRuntime(store,'isolated-model',(_key,context)=>{
  assert.ok(context.foreign);assert.equal(context.outside,undefined);
  assert.deepEqual(context.people,[]);assert.deepEqual(context.buildings,[]);
  assert.ok(!base.residents.some(r=>r.id===context.actor.id));
  received.push(context);
  return new Promise<ModelResult>(resolve=>pending.push(()=>resolve(waitResult())));
 },{mode:'formal',modelSlots:2});
 try{
  runtime.start();assert.equal(received.length,2);assert.equal(runtime.world.metrics.inFlight.length,2);
  while(pending.length){pending.shift()!();await flush();await flush();}
  assert.equal(received.length,ready.length);assert.equal(runtime.world.metrics.successes,ready.length);
  assert.equal(runtime.world.residents.length,54);assert.equal(foreignCandidates(runtime.world).length,0);
  assert.equal(totalCoins(runtime.world),opening);
  assert.equal(runtime.world.foreignTrade!.offers.length,0);assert.equal(runtime.world.foreignTrade!.shipments.length,0);
  const due=runtime.world.foreignTrade!.merchants.map(m=>m.person.decisionDue);
  assert.ok(due.every(n=>n>runtime.world.minute));runtime.stop();
  const restored=new ValleyRuntime(store,null,undefined,{mode:'formal'});
  assert.deepEqual(restored.world.foreignTrade!.merchants.map(m=>m.person.decisionDue),due);
  assert.equal(totalCoins(restored.world),opening);assert.equal(restored.world.residents.length,54);
  restored.stop();
 }finally{runtime.stop();store.close();}
});

test('missing merchant model decisions cannot fabricate offers, exports, imports, or new money',()=>{
 const base=isolateMerchants(),opening=totalCoins(base);
 const stocks=base.foreignTrade!.merchants.map(m=>structuredClone(m.person.inventory));
 const store=new WorldStore(':memory:');store.commit(base,null);
 const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 try{
  const minute=runtime.world.minute;runtime.tick(Date.now()+1000);
  assert.equal(runtime.world.minute,minute);assert.equal(runtime.world.metrics.requests,0);
  // Independent physics catch-up exercises the outside route manager without granting an intention.
  runtime.world.clock.paused=false;runtime.world.minute+=5*DAY;advanceForeignTrade(runtime.world);
  assert.equal(runtime.world.foreignTrade!.offers.length,0);assert.equal(runtime.world.foreignTrade!.shipments.length,0);
  assert.deepEqual(runtime.world.foreignTrade!.merchants.map(m=>m.person.inventory),stocks);
  assert.equal(totalCoins(runtime.world),opening);
 }finally{runtime.stop();store.close();}
});

test('a foreign-only provider failure cannot stop healthy local residents or produce a fallback transaction',async()=>{
 const base=isolateMerchants(),store=new WorldStore(':memory:');store.commit(base,null);
 const runtime=new ValleyRuntime(store,'isolated-model',async(_key,context)=>{
  assert.ok(context.foreign);throw new Error('model_http_503');
 },{mode:'formal'});
 try{
  runtime.start();await flush();await flush();
  const before=runtime.world.minute;runtime.tick(Date.now()+1000);
  assert.ok(runtime.world.minute>before);assert.equal(runtime.world.clock.paused,false);
  assert.equal(runtime.world.foreignTrade!.offers.length,0);assert.equal(runtime.world.foreignTrade!.shipments.length,0);
  assert.equal(runtime.world.residents.length,54);
 }finally{runtime.stop();store.close();}
});

test('a late merchant answer is rejected when their own available assets or revision have changed',async()=>{
 const base=isolateMerchants(),store=new WorldStore(':memory:');store.commit(base,null);
 let complete:((result:ModelResult)=>void)|undefined,personId='';
 const runtime=new ValleyRuntime(store,'isolated-model',(_key,context)=>{
  personId=context.actor.id;
  return new Promise<ModelResult>(resolve=>{complete=resolve;});
 },{mode:'formal',modelSlots:1});
 try{
  runtime.start();assert.ok(complete);
  const originalId=personId;
  const merchant=runtime.world.foreignTrade!.merchants.find(m=>m.person.id===originalId)!;
  const due=merchant.person.decisionDue;merchant.person.revision++;
  complete!(waitResult());await flush();await flush();
  const saved=runtime.world.foreignTrade!.merchants.find(m=>m.person.id===originalId)!;
  assert.equal(saved.person.decisionDue,due);assert.equal(runtime.world.metrics.successes,0);
  assert.ok(runtime.world.metrics.failures>=1);assert.equal(runtime.world.foreignTrade!.offers.length,0);
 }finally{runtime.stop();store.close();}
});

test('a merchants own quote memory retains its original fact through working-history trimming and restart',()=>{
 const w=isolateMerchants(),m=w.foreignTrade!.merchants[0];
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'post',merchantId:m.id,side:'import',item:'wood',quantity:2,price:7}),null);
 const memory=m.person.memories.at(-1)!;
 assert.ok(memory);assert.equal(memory.source,'self');
 const fact=w.events.find(e=>e.id===memory.eventId)!;
 assert.ok(fact);assert.equal(fact.text,memory.text);assert.deepEqual(fact.witnesses,[]);
 const irrelevant=emitEvent(w,{kind:'trade',actors:[],witnesses:[],place:{...w.map.entrance},text:'没有居民记住的旧驿站观察记录'});
 w.minute+=DAY;
 for(let i=0;i<200;i++)emitEvent(w,{kind:'trade',actors:[],witnesses:[],place:{...w.map.entrance},text:`较新的观察记录 ${i}`});
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);
  const trimmed=workingEvents(w);
  assert.ok(trimmed.some(e=>e.id===memory.eventId),'the retained merchant memory needs a retained source fact');
  assert.ok(!trimmed.some(e=>e.id===irrelevant.id),'unreferenced old facts should actually leave the working window');
  w.events=trimmed;
  const savedRevision=w.revision;w.revision++;store.commit(w,savedRevision,{events:[],processed:[]});
  const restored=store.load(true)!,restoredMerchant=restored.foreignTrade!.merchants.find(p=>p.id===m.id)!;
  const restoredMemory=restoredMerchant.person.memories.find(p=>p.eventId===memory.eventId)!;
  assert.ok(restoredMemory);assert.deepEqual(restored.events.find(e=>e.id===restoredMemory.eventId),fact);
  assert.ok(!restored.events.some(e=>e.id===irrelevant.id));
 }finally{store.close();}
});

test('employer death settles reserved salary and partial materials before any heir can freeze the estate shares',()=>{
 const w=createFormalWorld();w.clock.paused=false;
 const [owner,worker,heir]=w.residents.filter(r=>w.minute-r.bornAt>=18*YEAR).slice(0,3);
 w.residents=[owner,worker,heir];heir.parents=[owner.id];worker.parents=[];owner.parents=[];
 const house=w.buildings.find(b=>b.id===owner.homeId)!;
 for(const r of w.residents){r.at={...house.door};r.inside=null;r.knownBuildings.push(house.id);r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);r.hunger=10;r.energy=100;r.health=100;}
 owner.coins=200;owner.inventory={turnip:8,water:8};
 initializeEconomy(w);initializeEmployment(w);initializeProduction(w);initializeForeignTrade(w);
 const initialCoins=totalCoins(w);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:house.id,name:'遗产验收小铺'}),null);
 const shop=w.economy!.businesses[0];
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'fund',businessId:shop.id,amount:100}),null);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'stock',businessId:shop.id,item:'turnip',quantity:8}),null);
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'stock',businessId:shop.id,item:'water',quantity:8}),null);
 assert.equal(completeEmployment(w,owner,{type:'employment',operation:'post',businessId:shop.id,terms:{role:'cook',wage:30,startMinute:600,durationMinutes:30,days:2}}),null);
 const post=w.employment!.posts[0];
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'apply',postId:post.id}),null);
 assert.equal(completeEmployment(w,owner,{type:'employment',operation:'select',postId:post.id,applicantId:worker.id}),null);
 assert.equal(completeEmployment(w,worker,{type:'employment',operation:'accept',postId:post.id}),null);
 const contract=w.employment!.contracts[0],workerOpening=worker.coins;
 w.minute=contract.startDay*DAY+600;atWorkstation(w,worker,{type:'employment',operation:'work',contractId:contract.id,minutes:5});
 assert.ok(submitPlan(w,{id:'work-before-employer-death',actorId:worker.id,actorRevision:worker.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'履行已接受的工作',actions:[{type:'employment',operation:'work',contractId:contract.id,minutes:5}]}).ok);
 stepWorld(w,5);
 assert.equal(contract.paid,5);assert.ok(contract.batch);assert.equal(worker.coins,workerOpening+5);
 recordDeath(w,owner);initializeProduction(w);
 assert.equal(claimableInheritance(w,heir),undefined,'unsettled job assets must prevent premature estate division');
 advanceEconomy(w);advanceEmployment(w);
 assert.equal(contract.status,'ended');assert.equal(contract.batch,null);assert.equal(shop.closedAt,w.minute);
 const estate=w.estates.find(e=>e.personId===owner.id)!;
 assert.equal(estate.coins,195);assert.equal(estateGoods(w,owner.id).turnip,8);assert.equal(estateGoods(w,owner.id).water,8);
 heir.at={...house.door};heir.inside=null;
 const heirOpening=heir.coins;
 assert.equal(completeProduction(w,heir,{type:'production',operation:'inherit',personId:owner.id}),null);
 assert.equal(heir.coins,heirOpening+195);assert.equal(estate.coins,0);assert.equal(estate.status,'settled');
 assert.equal(totalCoins(w),initialCoins);assert.equal(worker.coins,workerOpening+5);
 advanceEmployment(w);advanceEconomy(w);assert.equal(totalCoins(w),initialCoins);
});

test('domestic and foreign invoices share signed-policy tax fractions while policy replacement and pruning preserve pending rights',()=>{
 const w=createFormalWorld(),[owner,buyer]=w.residents.filter(r=>w.minute-r.bornAt>=18*YEAR);
 const house=w.buildings.find(b=>b.id===owner.homeId)!;
 owner.inventory={wood:4};buyer.coins=600;
 for(const r of [owner,buyer]){r.at={...house.door};r.inside=null;r.knownBuildings.push(house.id);}
 initializeEconomy(w);initializeCivic(w);initializeForeignTrade(w);
 const coins=totalCoins(w),payer=`resident:${buyer.id}`,m=w.foreignTrade!.merchants[0];
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'open',buildingId:house.id,name:'跨市场税账验收店'}),null);
 const shop=w.economy!.businesses[0];
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'stock',businessId:shop.id,item:'wood',quantity:4}),null);
 w.civic!.salesTax={basisPoints:500,expiresAt:w.minute+DAY,proposalId:'signed-old'};
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'list',businessId:shop.id,item:'wood',quantity:1,price:19}),null);
 assert.equal(completeEconomy(w,buyer,{type:'economy',operation:'buy',businessId:shop.id,listingId:w.economy!.listings.at(-1)!.id,quantity:1,maxTotal:20}),null);
 assert.equal(w.economy!.levyCarries?.['signed-old'][payer],9500);
 buyer.at={...w.map.entrance};
 assert.equal(completeForeignTrade(w,buyer,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'import',item:'wood',quantity:1,price:1,maximumLevyBasisPoints:500}),null);
 const offer=w.foreignTrade!.offers.at(-1)!;
 w.civic!.salesTax={basisPoints:1000,expiresAt:w.minute+2*DAY,proposalId:'current-new'};
 advanceEconomy(w);
 assert.equal(w.economy!.levyCarries?.['signed-old'][payer],9500,'an open signed offer retains the previous policy carry');
 buyer.at={...house.door};
 assert.equal(completeEconomy(w,owner,{type:'economy',operation:'list',businessId:shop.id,item:'wood',quantity:1,price:1}),null);
 assert.equal(completeEconomy(w,buyer,{type:'economy',operation:'buy',businessId:shop.id,listingId:w.economy!.listings.at(-1)!.id,quantity:1,maxTotal:2}),null);
 assert.equal(w.economy!.levyCarries?.['current-new'][payer],1000);
 assert.equal(w.economy!.treasury,0,'the new policy must not consume the previous policy fraction');
 w.minute=offer.noticeAt;advanceForeignTrade(w);
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:offer.id}),null);
 const shipment=w.foreignTrade!.shipments.at(-1)!;
 advanceEconomy(w);assert.equal(w.economy!.levyCarries?.['signed-old'][payer],9500);
 w.minute=shipment.arrivesAt!;advanceForeignTrade(w);
 assert.equal(shipment.actualTax,1,'old domestic fraction and actual foreign delivery complete one whole tax coin');
 assert.equal(w.economy!.treasury,1);assert.equal(w.economy!.levyCarries?.['current-new'][payer],1000);
 buyer.at={...w.map.entrance};
 assert.equal(completeForeignTrade(w,buyer,{type:'foreignTrade',operation:'collect',shipmentId:shipment.id}),null);
 advanceEconomy(w);
 assert.equal(w.economy!.levyCarries?.['signed-old'],undefined,'completed rights release the replaced policy');
 assert.equal(w.economy!.taxRemainders?.[payer]?.policyId==='signed-old',false);
 assert.equal(w.economy!.levyCarries?.['current-new'][payer],1000);
 w.minute=w.civic!.salesTax!.expiresAt+1;advanceEconomy(w);
 assert.equal(w.economy!.levyCarries?.['current-new'],undefined);
 assert.equal(totalCoins(w),coins);
});

test('a foreign cargo owner death blocks inheritance until actual delivery and includes the cargo in the final estate',()=>{
 const w=createFormalWorld(),[owner,heir]=w.residents.filter(r=>w.minute-r.bornAt>=18*YEAR);
 w.residents=[owner,heir];owner.parents=[];heir.parents=[owner.id];owner.coins=200;owner.inventory={wood:2};
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.knownPeople=w.residents.filter(p=>p!==r).map(p=>p.id);}
 initializeEconomy(w);initializeProduction(w);initializeForeignTrade(w);
 const coins=totalCoins(w),m=w.foreignTrade!.merchants[0];
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'post',merchantId:m.id,side:'import',item:'wood',quantity:2,price:5}),null);
 const offer=w.foreignTrade!.offers.at(-1)!;w.minute=offer.noticeAt;advanceForeignTrade(w);
 assert.equal(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'accept',offerId:offer.id,quantity:2,quotedPrice:5,maximumLevyBasisPoints:0}),null);
 const shipment=w.foreignTrade!.shipments.at(-1)!;
 recordDeath(w,owner);initializeProduction(w);
 assert.equal(claimableInheritance(w,heir),undefined);
 const estate=w.estates.find(e=>e.personId===owner.id)!;
 assert.equal(estate.inventory.wood,2);assert.equal(estate.coins,190);
 w.minute=shipment.arrivesAt!-1;advanceForeignTrade(w);
 assert.equal(claimableInheritance(w,heir),undefined);assert.equal(estate.inventory.wood,2);
 w.minute=shipment.arrivesAt!;advanceForeignTrade(w);
 assert.equal(shipment.status,'completed');assert.equal(estateGoods(w,owner.id).wood,4);
 assert.equal(claimableInheritance(w,heir),owner.id);
 const inheritancePlace=owner.homeId?w.buildings.find(b=>b.id===owner.homeId)!.door:owner.at;
 heir.at={...inheritancePlace};heir.inside=null;
 const heirCoins=heir.coins,heirWood=heir.inventory.wood??0;
 assert.equal(completeProduction(w,heir,{type:'production',operation:'inherit',personId:owner.id}),null);
 assert.equal(heir.coins,heirCoins+190);assert.equal(heir.inventory.wood??0,heirWood);assert.equal(ownedEstateParcels(w,heir).reduce((n,p)=>n+(p.inventory.wood??0),0),4);
 assert.equal(estate.status,'settled');assert.equal(totalCoins(w),coins);
 advanceForeignTrade(w);assert.equal(totalCoins(w),coins);assert.equal(heir.inventory.wood??0,heirWood);assert.equal(ownedEstateParcels(w,heir).reduce((n,p)=>n+(p.inventory.wood??0),0),4);
});

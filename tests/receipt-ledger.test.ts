import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {EconomyAction} from '../src/shared/economy.js';
import type {World} from '../src/shared/types.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {initializeCivic} from '../src/world/civic.js';
import {completeEconomy,economyReason,initializeEconomy,moveCoins,totalCoins} from '../src/world/economy.js';
import {stepWorld} from '../src/world/engine.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {DAY,YEAR} from '../src/world/time.js';

function withDatabase(action:(path:string)=>void){
 const folder=mkdtempSync(join(testTmpdir(),'valley-receipt-check-'));
 try{action(join(folder,'world.sqlite'));}finally{rmSync(folder,{recursive:true,force:true});}
}

function market(){
 const world=createFrontierWorld(),home=world.buildings.find(building=>building.kind==='home')!;
 const owner=world.residents.find(resident=>resident.id===home.ownerId)!;
 const buyer=world.residents.find(resident=>resident!==owner&&world.minute-resident.bornAt>=18*YEAR)!;
 buyer.coins=50;owner.inventory.wood=3;
 initializeEconomy(world);initializeCivic(world);
 world.civic!.salesTax={basisPoints:1000,expiresAt:world.minute+DAY,proposalId:'local-sale-levy'};
 for(const resident of [owner,buyer]){
  resident.at={...home.door};resident.inside=null;resident.knownBuildings.push(home.id);
 }
 const act=(action:Omit<EconomyAction,'type'>)=>assert.equal(completeEconomy(world,owner,{type:'economy',...action}),null);
 act({operation:'open',buildingId:home.id,name:'河边小铺'});
 const business=world.economy!.businesses[0];
 act({operation:'stock',businessId:business.id,item:'wood',quantity:3});
 act({operation:'list',businessId:business.id,item:'wood',quantity:3,price:10});
 const listing=world.economy!.listings[0];
 const action:EconomyAction={type:'economy',operation:'buy',listingId:listing.id,quantity:1,maxTotal:11};
 buyer.activity={planId:'first-wood-purchase',startedAt:world.minute,action,path:[],target:{...home.door},remaining:1,
  definition:world.activeDefinitions['action/routine']};
 for(const resident of world.residents){resident.decisionDue=world.minute+1000;resident.lastDecisionAt=world.minute;}
 return {world,owner,buyer,action};
}

function balances(world:World,buyerId:string){
 const buyer=world.residents.find(resident=>resident.id===buyerId)!;
 const economy=world.economy!,business=economy.businesses[0];
 return {wallet:buyer.coins,stock:buyer.inventory.wood??0,shop:business.coins,sales:business.sales,revenue:business.revenue,
  left:economy.listings[0].quantity,treasury:economy.treasury,transfers:economy.transferCount,coins:totalCoins(world)};
}

for(const layout of ['separate','inline'] as const){
 test(`old ${layout} purchase receipts prevent duplicate payment, tax and goods after restart`,()=>withDatabase(path=>{
  const {world,owner,buyer,action}=market(),activity=structuredClone(buyer.activity!);
  const before=balances(world,buyer.id);
  world.clock.paused=false;stepWorld(world,1);
  const paid=balances(world,buyer.id);
  assert.deepEqual(paid,{wallet:before.wallet-11,stock:before.stock+1,shop:10,sales:1,revenue:10,left:2,treasury:1,
   transfers:before.transfers+2,coins:before.coins});
  const from=`resident:${owner.id}`,to=`resident:${buyer.id}`,reference='历史结算:竹笼_\\%[1]*?🏮';
  assert.equal(moveCoins(world,from,to,2,'旧时收购',reference),true);
  const after=balances(world,buyer.id),expectedReceipts=world.processed.slice();
  let store=new WorldStore(path);
  try{store.commit(world,null);}finally{store.close();}
  if(layout==='inline'){
   const sql=new DatabaseSync(path);
   try{
    const {state}=sql.prepare('SELECT state FROM worlds').get() as {state:Uint8Array};
    const legacy=JSON.parse(gunzipSync(state).toString());
    delete legacy.ledgerVersion;legacy.processed=expectedReceipts;legacy.events=world.events;
    sql.prepare('UPDATE worlds SET state=?').run(gzipSync(JSON.stringify(legacy)));
    sql.exec('DELETE FROM receipts');
   }finally{sql.close();}
  }
  store=new WorldStore(path);
  const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
  try{
   assert.deepEqual(runtime.world.processed,[]);
   assert.deepEqual(store.load()!.processed,expectedReceipts);
   const actor=runtime.world.residents.find(resident=>resident.id===buyer.id)!;
   actor.activity=activity;
   assert.equal(economyReason(runtime.world,actor,action),null,'cash and the open listing permit another real purchase');
   assert.equal(completeEconomy(runtime.world,actor,action),null);
   assert.equal(moveCoins(runtime.world,from,to,2,'旧时收购',reference),true);
   assert.equal(moveCoins(runtime.world,from,to,3,'旧时收购',reference),false);
   assert.deepEqual(balances(runtime.world,buyer.id),after);
   assert.deepEqual(runtime.world.processed,[]);
   assert.deepEqual(store.load()!.processed,expectedReceipts);
  }finally{runtime.stop();store.close();}
 }));
}

test('a failed runtime tick rolls back money, goods, tax and receipts together, and can settle once on retry',t=>withDatabase(path=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {world,buyer}=market(),store=new WorldStore(path),sql=new DatabaseSync(path);
 let runtime:ValleyRuntime|undefined;
 try{
  store.commit(world,null);
  runtime=new ValleyRuntime(store,'isolated-test',()=>new Promise(()=>{}),{mode:'formal'});
  const before=balances(runtime.world,buyer.id),revision=runtime.world.revision,receipts=store.load()!.processed;
  sql.exec("CREATE TRIGGER fail_receipt_tick BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'receipt_tick_failed'); END");
  assert.throws(()=>runtime!.tick(now+=1000),/receipt_tick_failed/);
  assert.equal(runtime.world.revision,revision);
  assert.deepEqual(runtime.world.processed,[]);
  assert.deepEqual(balances(runtime.world,buyer.id),before);
  const rolledBack=store.load()!;
  assert.deepEqual(balances(rolledBack,buyer.id),before);
  assert.deepEqual(rolledBack.processed,receipts);
  sql.exec('DROP TRIGGER fail_receipt_tick');
  runtime.tick(now+=1000);
  const after={wallet:before.wallet-11,stock:before.stock+1,shop:10,sales:1,revenue:10,left:2,treasury:1,
   transfers:before.transfers+2,coins:before.coins};
  assert.deepEqual(balances(runtime.world,buyer.id),after);
  assert.deepEqual(runtime.world.processed,[]);
  const committed=store.load()!;
  assert.deepEqual(balances(committed,buyer.id),after);
  assert.equal(committed.processed.length,receipts.length+3,'sale, levy and delivery each have one receipt');
  assert.equal(new Set(committed.processed).size,committed.processed.length);
 }finally{
  sql.exec('DROP TRIGGER IF EXISTS fail_receipt_tick');
  runtime?.stop();sql.close();store.close();
 }
}));

test('two working copies cannot both commit the same purchase from the same saved revision',()=>withDatabase(path=>{
 const {world,buyer,action}=market(),activity=structuredClone(buyer.activity!);
 world.clock.paused=false;
 const writer=new WorldStore(path),staleWriter=new WorldStore(path);
 try{
  writer.commit(world,null);
  const first=writer.loadForRuntime()!,stale=staleWriter.loadForRuntime()!;
  const expectedRevision=first.revision,original=balances(first,buyer.id);
  assert.equal(stale.revision,expectedRevision);
  stepWorld(first,1);
  stepWorld(stale,1);
  const paid=balances(first,buyer.id);
  assert.equal(paid.wallet,original.wallet-11);
  assert.equal(paid.stock,original.stock+1);
  assert.equal(paid.treasury,original.treasury+1);
  assert.deepEqual(balances(stale,buyer.id),paid);
  writer.commit(first,expectedRevision);
  assert.throws(()=>staleWriter.commit(stale,expectedRevision),/stale_world_revision/);

  const reloaded=staleWriter.loadForRuntime()!;
  assert.deepEqual(balances(reloaded,buyer.id),paid);
  const actor=reloaded.residents.find(resident=>resident.id===buyer.id)!;
  actor.activity=activity;
  assert.equal(completeEconomy(reloaded,actor,action),null);
  assert.deepEqual(balances(reloaded,buyer.id),paid);
  assert.deepEqual(reloaded.processed,[]);
 }finally{staleWriter.close();writer.close();}
}));

import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {CivicAction,CivicMeasure} from '../src/shared/civic.js';
import type {ForeignAction,ForeignShipment} from '../src/shared/foreign-trade.js';
import {createFormalWorld,createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeCivic,completeCivic,advanceCivic,civicReason} from '../src/world/civic.js';
import {initializeForeignTrade,advanceForeignTrade,completeForeignTrade,foreignReason,foreignDecisionContext,merchantChoices,applyForeignDecision,hasForeignAssets} from '../src/world/foreign-trade.js';
import {reserveCommitted} from '../src/world/public-food-procurement.js';
import {reserveReceiptId} from '../src/world/public-food-reserves.js';
import {initializeFood,advanceFood,foodContainers} from '../src/world/food.js';
import {initializeCommons} from '../src/world/commons.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {totalCoins,accountBalance} from '../src/world/economy.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {foreignOpportunities} from '../src/server/foreign-opportunities.js';

import {WorldStore} from '../src/server/store.js';
import {recordDeath} from '../src/world/life.js';
import {YEAR} from '../src/world/time.js';

function fixture(outside=true){
 const w=createFormalWorld();w.minute=600;w.clock.paused=false;
 w.map={...w.map,width:32,height:24,tiles:Array(32*24).fill('grass'),entrance:{x:0,y:10}};w.resources=[];w.plots=[];w.graves=[];
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!;hall.at={x:12,y:6};hall.width=hall.height=4;hall.door={x:14,y:10};hall.residents=[];w.buildings=[hall];
 w.residents=w.residents.slice(0,3);for(const r of w.residents){r.at={...hall.door};r.inside=null;r.roomAt=null;r.homeId=null;r.parents=[];r.guardianIds=[];r.inventory={turnip:20};r.coins=200;r.bornAt=w.minute-30*YEAR;r.health=r.energy=100;r.hunger=20;r.knownBuildings=[hall.id];r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.activity=null;r.plan=null;}
 initializeCivic(w);initializeCommons(w);initializeRooms(w);initializeForeignTrade(w);initializeFood(w);
 const r=w.residents[0],m=w.foreignTrade!.merchants[0];w.foreignTrade!.knownStationIds.push(r.id);
 const measure:Extract<CivicMeasure,{kind:'foodReserve'}>={kind:'foodReserve',buildingId:hall.id,item:'turnip',quantity:12,unitPrice:3,suppliesBudget:39,dailyNutrition:40,durationDays:2,...(outside?{foreignProcurement:{merchantId:m.id,handlerId:r.id}}:{})};
 assert.equal(completeCivic(w,r,{type:'civic',operation:'donate',buildingId:hall.id,amount:39}),null);
 assert.equal(completeCivic(w,r,{type:'civic',operation:'propose',buildingId:hall.id,measure}),null);
 const proposal=w.civic!.proposals.at(-1)!;for(const actor of w.residents.slice(0,2))assert.equal(completeCivic(w,actor,{type:'civic',operation:'vote',proposalId:proposal.id,accept:true}),null);
 const p=w.civic!.reserves![0];r.at={...w.foreignTrade!.station};return {w,r,m,p,hall};
}
type F=ReturnType<typeof fixture>;
function propose(f:F,quantity=3){const {w,r,m,p}=f;const a:ForeignAction={type:'foreignTrade',operation:'propose',reserveId:p.id,merchantId:m.id,side:'import',item:p.item,quantity,price:p.unitPrice,maximumLevyBasisPoints:1500};assert.equal(completeForeignTrade(w,r,a),null);return w.foreignTrade!.offers.at(-1)!;}
function accepted(f:F,quantity=3){const o=propose(f,quantity);f.w.minute=o.noticeAt;advanceForeignTrade(f.w);assert.equal(completeForeignTrade(f.w,f.m.person,{type:'foreignTrade',operation:'accept',offerId:o.id}),null);return f.w.foreignTrade!.shipments.at(-1)!;}
function arrived(f:F,quantity=3){const s=accepted(f,quantity);f.w.minute=s.arrivesAt!;advanceForeignTrade(f.w);assert.equal(s.status,'arrived');return s;}
function collect(f:F,s:ForeignShipment){assert.equal(completeForeignTrade(f.w,f.r,{type:'foreignTrade',operation:'collect',shipmentId:s.id}),null);}
function delivery(f:F,s:ForeignShipment):CivicAction{return {type:'civic',operation:'deliverReserve',reserveId:f.p.id,shipmentId:s.id};}
function table(f:F){f.r.at={...f.hall.door};f.r.inside=f.hall.id;f.r.roomAt={...roomLayout(f.w,f.hall).slots.find(s=>s.key==='table')!.at};}
function physical(w:World){return [...foodContainers(w).values()].reduce((n,b)=>n+(b.turnip??0),0);}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`public-procurement:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人自主决定',actions:[a]});assert.equal(result.ok,true,JSON.stringify({result,at:w.minute,action:a,health:r.health,energy:r.energy,hunger:r.hunger,status:r.status,canDecide:r.canDecide,canExpress:r.canExpress,shipments:w.foreignTrade?.shipments.map(s=>({id:s.id,goods:s.goods,status:s.status,carrier:s.publicCarrier,lots:w.food?.lots['shipment:'+s.id]}))}));let n=1000;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function pick(w:World,r:Resident,predicate:(a:Action)=>boolean){for(let i=0;i<100;i++){const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(o=>predicate(o.action));if(choice)return {menu,choice};run(w,r,{type:'wait',minutes:30});}throw new Error('normal rotating choice not exposed');}

test('public cash and grain use real independent merchant acceptance, transport, carrying and separate shelving',()=>{
 const f=fixture(),{w,r,m,p}=f,coins=totalCoins(w),stock=physical(w),privateCoins=r.coins,privateFood=r.inventory.turnip,merchant=m.person.coins,expiry=w.food!.lots['person:'+m.id].turnip![0].expiresAt;
 const o=propose(f);assert.equal(accountBalance(w,p.supplyAccount),30);assert.equal(m.person.inventory.turnip,36);assert.equal(w.foreignTrade!.shipments.length,0);assert.equal(reserveCommitted(w,p),3);
 assert.match(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:o.id})!,/尚未/);w.minute=o.noticeAt;advanceForeignTrade(w);
 const accept=merchantChoices(w,m).find(c=>c.action.type==='foreignTrade'&&c.action.operation==='accept'&&c.action.offerId===o.id)!;assert.ok(accept);assert.equal(applyForeignDecision(w,m.id,m.person.revision,{intention:'独立同意原协商',actions:[accept.action]}).ok,true);
 const s=w.foreignTrade!.shipments.at(-1)!;assert.equal(s.publicReserveId,p.id);assert.equal(m.person.inventory.turnip,33);assert.equal(p.inventory.turnip,undefined);assert.equal(m.person.coins,merchant);assert.equal(reserveCommitted(w,p),3);
 w.minute=s.arrivesAt!;advanceForeignTrade(w);assert.equal(m.person.coins,merchant+9);assert.equal(p.spent,9);assert.equal(p.stocked,0);assert.equal(p.foreignProcurement!.acquired,3);collect(f,s);
 assert.equal(r.coins,privateCoins);assert.equal(r.inventory.turnip,privateFood);assert.equal(s.goods,3);assert.equal(s.status,'arrived');assert.ok(s.publicCarrier);assert.match(completeForeignTrade(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id})!,/尚无/);
 table(f);assert.equal(completeCivic(w,r,delivery(f,s)),null);assert.equal(p.inventory.turnip,3);assert.equal(p.stocked,3);assert.equal(p.foreignProcurement!.delivered,3);assert.equal(reserveCommitted(w,p),3);assert.equal(w.food!.lots['public-reserve:'+p.id].turnip![0].expiresAt,expiry);assert.equal(totalCoins(w),coins);assert.equal(physical(w),stock);assert.equal(w.economy!.treasuryStock.turnip,3);
 assert.ok(completeCivic(w,r,delivery(f,s)));assert.equal(p.inventory.turnip,3);assert.equal(totalCoins(w),coins);
});

test('old mandates, wrong parties, export, private destination and changed quote cannot spend public money',()=>{
 for(const outside of [false,true]){const f=fixture(outside),{w,r,p,m}=f,coins=totalCoins(w),cash=accountBalance(w,p.supplyAccount);
 const a:ForeignAction={type:'foreignTrade',operation:'propose',reserveId:p.id,merchantId:m.id,side:'import',item:p.item,quantity:3,price:p.unitPrice,maximumLevyBasisPoints:0};
 for(const patch of outside?[{merchantId:w.foreignTrade!.merchants[1].id},{side:'export' as const},{item:'seed' as const},{price:4},{deliveryId:f.hall.id},{quantity:13}]:[{}])assert.ok(completeForeignTrade(w,r,{...a,...patch}));
 const other=w.residents[1];other.at={...r.at};assert.ok(completeForeignTrade(w,other,a));assert.equal(accountBalance(w,p.supplyAccount),cash);assert.equal(totalCoins(w),coins);assert.equal(w.foreignTrade!.offers.length,0);}
});

test('quotations lock shared quantity and cash against competing local and external suppliers',()=>{
 const f=fixture(),{w,r,p}=f;propose(f,9);assert.equal(reserveCommitted(w,p),9);const a=foreignOpportunities(w,r).find(o=>o.action.type==='foreignTrade'&&o.action.reserveId===p.id)!.action as ForeignAction;
 assert.ok(foreignReason(w,r,{...a,quantity:4}));table(f);assert.ok(completeCivic(w,r,{type:'civic',operation:'supplyReserve',reserveId:p.id,receiptId:reserveReceiptId(p),quantity:4}));
 assert.equal(completeCivic(w,r,{type:'civic',operation:'supplyReserve',reserveId:p.id,receiptId:reserveReceiptId(p),quantity:3}),null);assert.equal(reserveCommitted(w,p),12);assert.equal(accountBalance(w,p.supplyAccount),3);
});

test('merchant rejection and unaccepted expiration return funds only to original public budget or treasury',()=>{
 for(const expired of [false,true]){const f=fixture(),{w,r,m,p}=f,privateCoins=r.coins,coins=totalCoins(w),o=propose(f);
 if(expired){w.minute=p.expiresAt;advanceCivic(w);advanceForeignTrade(w);assert.equal(w.economy!.treasury,39);assert.equal(p.refunded,39);}
 else{w.minute=o.noticeAt;advanceForeignTrade(w);assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'reject',offerId:o.id}),null);assert.equal(accountBalance(w,p.supplyAccount),39);}
 assert.equal(reserveCommitted(w,p),0);assert.equal(r.coins,privateCoins);assert.equal(totalCoins(w),coins);assert.equal(w.foreignTrade!.shipments.length,0);}
});

test('expiry, incapacity or death before acceptance makes stale merchant acceptance invalid',()=>{
 for(const kind of ['expiry','speech','death','ownership'] as const){const f=fixture(),{w,r,m,p,hall}=f,o=propose(f);w.minute=o.noticeAt;if(kind==='expiry')w.minute=p.expiresAt;if(kind==='speech')r.canExpress=false;if(kind==='death')recordDeath(w,r,'accident');if(kind==='ownership')hall.ownerId=r.id;
 assert.ok(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:o.id}));advanceForeignTrade(w);assert.equal(o.status,'expired');r.canExpress=true;assert.ok(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:o.id}));assert.equal(w.foreignTrade!.shipments.length,0);assert.equal(m.person.inventory.turnip,36);}
});

test('expiry at the arrival tick returns actual cargo before refund, never settles a late purchase',()=>{
 const f=fixture(),{w,p,m,r}=f,s=accepted(f),privateCoins=r.coins,merchant=m.person.coins;w.minute=p.expiresAt;advanceCivic(w);advanceForeignTrade(w);assert.equal(s.status,'returning');assert.equal(accountBalance(w,s.escrowAccount),9);assert.equal(p.refunded,30);assert.equal(m.person.coins,merchant);
 w.minute=s.arrivesAt!;advanceForeignTrade(w);assert.equal(s.status,'cancelled');assert.equal(m.person.inventory.turnip,36);assert.equal(w.economy!.treasury,39);assert.equal(p.refunded,39);assert.equal(r.coins,privateCoins);assert.equal(p.spent,0);assert.equal(reserveCommitted(w,p),0);
});

test('paid public cargo survives handler death without inheritance or refund to private accounts',()=>{
 for(const carried of [false,true]){const f=fixture(),{w,r,p}=f,s=arrived(f);if(carried){collect(f,s);r.at={x:4,y:10};}recordDeath(w,r,'accident');advanceForeignTrade(w);assert.equal(s.goods,3);assert.equal(s.status,'arrived');assert.equal(hasForeignAssets(w,r.id),false);assert.equal(w.estates.flatMap(e=>e.parcels??[]).filter(x=>x.id.includes(s.id)).length,0);if(carried){assert.equal(s.publicCarrier!.sealed,true);assert.deepEqual(s.publicCarrier!.at,{x:4,y:10});r.at={x:6,y:10};advanceForeignTrade(w);assert.deepEqual(s.publicCarrier!.at,{x:4,y:10});}assert.ok(completeCivic(w,r,delivery(f,s)));assert.equal(p.foreignProcurement!.acquired,3);}
});

test('already paid cargo can only be physically delivered to original public store after mandate expiry',()=>{
 const f=fixture(),{w,p,r}=f,s=arrived(f),coins=totalCoins(w);collect(f,s);w.minute=p.expiresAt;advanceCivic(w);advanceForeignTrade(w);assert.equal(s.goods,3);assert.equal(p.status,'expired');table(f);assert.equal(completeCivic(w,r,delivery(f,s)),null);assert.equal(w.civic!.stores[p.buildingId].turnip,3);assert.equal(p.inventory.turnip,undefined);assert.equal(totalCoins(w),coins);assert.equal(p.spent,9);assert.equal(p.refunded,30);assert.equal(reserveCommitted(w,p),3);
});

test('carried grain expires in its original shipment container and never restores acquired quota',()=>{
 const f=fixture(),{w,p}=f,s=arrived(f);collect(f,s);const initial=physical(w);for(const lot of w.food!.lots['shipment:'+s.id].turnip!)lot.expiresAt=w.minute+1;w.minute++;advanceFood(w);advanceForeignTrade(w);assert.equal(s.goods,0);assert.equal(s.status,'completed');assert.equal(reserveCommitted(w,p),3);assert.equal(p.foreignProcurement!.acquired,3);assert.equal(physical(w),initial-3);assert.equal(w.economy!.treasuryStock.turnip??0,0);table(f);assert.ok(completeCivic(w,f.r,delivery(f,s)));
});

test('public records and original batches survive SQLite reload and private-history pruning',()=>{
 const f=fixture(),{w,r,p}=f,s=arrived(f);collect(f,s);for(let i=0;i<180;i++)w.foreignTrade!.shipments.push({...structuredClone(s),id:'old-private:'+i,publicReserveId:undefined,publicCarrier:undefined,goods:0,status:'completed'});advanceForeignTrade(w);assert.ok(w.foreignTrade!.shipments.some(x=>x.id===s.id));const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load(true)!;store.close();assert.deepEqual(restored.civic!.reserves,w.civic!.reserves);const restoredShipment=restored.foreignTrade!.shipments.find(x=>x.id===s.id)!;assert.deepEqual(restoredShipment,JSON.parse(JSON.stringify(s)));assert.deepEqual(restored.food!.lots['shipment:'+s.id],w.food!.lots['shipment:'+s.id]);assert.equal(reserveCommitted(restored,restored.civic!.reserves![0]),3);assert.equal(restored.residents.find(x=>x.id===r.id)!.coins,r.coins);assert.equal(p.stocked,0);
});

test('unchanged default nine-person world completes the public procurement chain through numbered menus',()=>{
 const w=createFrontierWorld();w.clock.paused=false;initializeCivic(w);initializeCommons(w);initializeRooms(w);initializeForeignTrade(w);initializeFood(w);
 const hall=w.buildings.find(b=>b.kind==='lodge'&&b.ownerId==='commons')!,r=w.residents.find(r=>w.minute-r.bornAt>=18*YEAR)!,coins=totalCoins(w),people=w.residents.map(r=>r.id),merchant=w.foreignTrade!.merchants[0],food=physical(w);
 run(w,r,{type:'move',to:{...hall.door}});run(w,r,{type:'civic',operation:'donate',buildingId:hall.id,amount:10});
 const {menu,choice}=pick(w,r,a=>a.type==='civic'&&a.operation==='propose'&&a.measure.kind==='foodReserve'&&a.measure.foreignProcurement?.merchantId===merchant.id);
 run(w,r,parseChoice(JSON.stringify({choice:choice.id,quantity:3,unitPrice:2,suppliesBudget:10,dailyNutrition:40,durationDays:7}),menu).actions[0]);const proposal=w.civic!.proposals.at(-1)!;
 for(const voter of w.residents.filter(r=>w.minute-r.bornAt>=18*YEAR)){if(proposal.status!=='open')break;run(w,voter,{type:'move',to:{...hall.door}});const {choice}=pick(w,voter,a=>a.type==='civic'&&a.operation==='vote'&&a.proposalId===proposal.id&&a.accept);run(w,voter,choice.action);}
 assert.equal(proposal.status,'approved');const p=w.civic!.reserves!.at(-1)!;
 // This journey takes real days: choose own meals and a real bed, never give
 // the handler artificial energy or permission to eat the public cargo.
 let rootsEaten=0;const eatOwn=()=>{while(r.hunger>=35){const menu=decisionChoices(decisionContext(w,r)),choice=menu.filter(c=>c.action.type==='eat').sort((a,b)=>{const expiry=(c:typeof a)=>c.action.type==='eat'?Math.min(...(w.food?.lots['person:'+r.id]?.[c.action.item]??[]).map(l=>l.expiresAt)):Infinity;return expiry(a)-expiry(b);})[0];assert.ok(choice,'the untouched founding pantry still has an actual personal meal');if(choice.action.type==='eat'&&choice.action.item==='turnip')rootsEaten++;run(w,r,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);}};
 eatOwn();const sleep=pick(w,r,a=>a.type==='sleep');run(w,r,parseChoice(JSON.stringify({choice:sleep.choice.id,minutes:720}),sleep.menu).actions[0]);eatOwn();
 run(w,r,{type:'move',to:{...w.foreignTrade!.station}});const pending=pick(w,r,a=>a.type==='foreignTrade'&&a.reserveId===p.id);run(w,r,parseChoice(JSON.stringify({choice:pending.choice.id,quantity:3}),pending.menu).actions[0]);const o=w.foreignTrade!.offers.at(-1)!;
 while(w.minute<o.noticeAt){eatOwn();run(w,r,{type:'wait',minutes:30});}const merchantMenu=decisionChoices(foreignDecisionContext(w,merchant.person));const accept=merchantMenu.find(c=>c.action.type==='foreignTrade'&&c.action.operation==='accept'&&c.action.offerId===o.id)!;assert.ok(accept);assert.equal(applyForeignDecision(w,merchant.id,merchant.person.revision,parseChoice(JSON.stringify({choice:accept.id}),merchantMenu)).ok,true);const s=w.foreignTrade!.shipments.at(-1)!;
 while(s.status==='inTransit'){eatOwn();run(w,r,{type:'wait',minutes:30});}eatOwn();const original=r.inventory.turnip,collectChoice=pick(w,r,a=>a.type==='foreignTrade'&&a.operation==='collect'&&a.shipmentId===s.id);run(w,r,collectChoice.choice.action);assert.equal(r.inventory.turnip,original);assert.equal(p.inventory.turnip,undefined);
 run(w,r,pick(w,r,a=>a.type==='move'&&a.to.x===hall.door.x&&a.to.y===hall.door.y).choice.action);assert.equal(civicReason(w,r,{type:'civic',operation:'deliverReserve',reserveId:p.id,shipmentId:s.id}),null,JSON.stringify({at:w.minute,health:r.health,energy:r.energy,hunger:r.hunger,status:r.status}));run(w,r,pick(w,r,a=>a.type==='civic'&&a.operation==='deliverReserve'&&a.shipmentId===s.id).choice.action);assert.equal(p.inventory.turnip,3);assert.equal(s.status,'completed');assert.equal(totalCoins(w),coins);assert.equal(physical(w),food-rootsEaten);assert.ok(rootsEaten>0);assert.deepEqual(w.residents.map(r=>r.id),people);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeInfrastructure} from '../src/world/infrastructure.js';
import {initializeFerries,completeFerry,ferryReason,advanceFerries,ferryOpportunities} from '../src/world/ferry.js';
import {occupiedFerryCapacity,shipmentFerry} from '../src/world/ferry-cargo.js';
import {initializeForeignTrade,completeForeignTrade,advanceForeignTrade} from '../src/world/foreign-trade.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {advanceFood,initializeFood} from '../src/world/food.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {recordDeath} from '../src/world/life.js';
import {WorldStore} from '../src/server/store.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';

import {waterRoute} from '../src/world/water-route.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,Tile,World} from '../src/shared/types.js';
import type {FerryAction} from '../src/shared/ferry.js';

function setup(quantity=11,item:'stone'|'meal'='stone'){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.weather='sun';w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 w.map={width:32,height:16,tiles:Array<Tile>(32*16).fill('grass'),name:'隔离货运验收',entrance:{x:30,y:6}};
 for(let y=0;y<16;y++)for(let x=7;x<=21;x++)w.map.tiles[y*32+x]='water';
 initializeInfrastructure(w);initializeFerries(w);
 const docks=[6,22].map((x,i)=>({id:'freight-dock-'+i,name:i?'东货运码头':'西货运码头',projectId:'fixture-'+i,kind:'dock' as const,definition:'infrastructure/dock@1',at:{x,y:6},width:1,height:1,access:{x:x+(i?1:-1),y:6},anchors:[{x:x+(i?1:-1),y:6}],tiles:[{at:{x,y:6},before:'water' as const,after:'bridge' as const}],graveIds:[],condition:100,lastDay:0,createdAt:w.minute,retiredAt:null,cost:{wood:6,stone:2},minutes:90}));
 for(const d of docks){w.map.tiles[d.at.y*32+d.at.x]='bridge';w.infrastructure!.assets.push(d);}
 const [captain,owner,passenger]=w.residents;const other=structuredClone(passenger);other.id='freight-other';other.name='另一位候船者';w.residents.push(other);
 for(const r of w.residents){r.bornAt=w.minute-30*YEAR;r.canDecide=true;r.canExpress=true;r.status='alive';r.residency='resident';r.at={...docks[0].at};r.inside=null;r.roomAt=null;r.health=r.energy=100;r.hunger=0;r.coins=100;r.inventory={stone:40,meal:40,water:40};r.knownDocks=docks.map(d=>d.id);r.plan=null;r.activity=null;}
 initializeForeignTrade(w);const m=w.foreignTrade!.merchants[0];m.routeMinutes=10;
 owner.at={...docks[0].access};assert.equal(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item,quantity,price:3,maximumLevyBasisPoints:0,deliveryId:docks[0].id}),null);
 const offer=w.foreignTrade!.offers.at(-1)!;w.minute=offer.noticeAt;advanceForeignTrade(w);
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:offer.id}),null);
 const shipment=w.foreignTrade!.shipments.at(-1)!;w.minute=shipment.readyAt;advanceForeignTrade(w);
 const boat={id:'freight-fixture-boat',definition:'transport/ferry@1',ownerId:captain.id,at:{x:7,y:6},dockId:docks[0].id,condition:100,tripId:null};w.ferries!.boats.push(boat);
 captain.at={...docks[0].at};owner.at={...docks[0].at};
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'post',boatId:boat.id,destinationId:docks[1].id,fare:7,departIn:120}),null);
 const trip=w.ferries!.trips.at(-1)!;
 return {w,captain,owner,passenger,other,docks,m,shipment,boat,trip};
}
function run(w:World,r:Resident,a:Action){const result=submitPlan(w,{id:`freight-action:${w.revision}:${r.id}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人按已知合同实际安排客货交接',actions:[a]});assert.ok(result.ok,result.error);let guard=500;while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function choose(w:World,r:Resident,operation:FerryAction['operation'],field?:{cargoId?:string;shipmentId?:string}){const menu=decisionChoices(decisionContext(w,r));const option=menu.find(c=>c.action.type==='ferry'&&c.action.operation===operation&&(!field?.cargoId||c.action.cargoId===field.cargoId)&&(!field?.shipmentId||c.action.shipmentId===field.shipmentId));assert.ok(option,operation+' must exist in normal decision menu');return parseChoice(JSON.stringify({choice:option.id}),menu).actions[0];}
function book(f:ReturnType<typeof setup>,normal=false){const {w,owner,captain,trip,shipment}=f;if(normal)run(w,owner,choose(w,owner,'proposeCargo',{shipmentId:shipment.id}));else assert.equal(completeFerry(w,owner,{type:'ferry',operation:'proposeCargo',tripId:trip.id,shipmentId:shipment.id}),null);const c=trip.cargo!.at(-1)!;if(normal)run(w,captain,choose(w,captain,'acceptCargo',{cargoId:c.id}));else assert.equal(completeFerry(w,captain,{type:'ferry',operation:'acceptCargo',tripId:trip.id,cargoId:c.id}),null);return c;}
function dispatch(f:ReturnType<typeof setup>){f.owner.at={...f.docks[0].access};assert.equal(completeForeignTrade(f.w,f.owner,{type:'foreignTrade',operation:'dispatch',shipmentId:f.shipment.id}),null);f.w.minute+=4;advanceForeignTrade(f.w);f.owner.at={...f.docks[0].at};}
function load(f:ReturnType<typeof setup>){const c=book(f);dispatch(f);assert.equal(completeFerry(f.w,f.captain,{type:'ferry',operation:'loadCargo',tripId:f.trip.id,cargoId:c.id}),null);return c;}
function sail(f:ReturnType<typeof setup>){const c=load(f);f.w.minute=f.trip.departAt;assert.equal(completeFerry(f.w,f.captain,{type:'ferry',operation:'depart',tripId:f.trip.id}),null);return c;}
function tick(f:ReturnType<typeof setup>,minutes:number){for(let i=0;i<minutes;i++){f.w.minute++;advanceForeignTrade(f.w);advanceFerries(f.w,1);}}
function goods(f:ReturnType<typeof setup>){return f.w.residents.reduce((n,r)=>n+(r.inventory[f.shipment.item]??0),0)+f.w.foreignTrade!.merchants.reduce((n,m)=>n+(m.person.inventory[f.shipment.item]??0),0)+f.w.foreignTrade!.shipments.reduce((n,s)=>n+(s.item===f.shipment.item?s.goods:0),0)+f.w.foreignTrade!.offers.reduce((n,o)=>n+(o.item===f.shipment.item?o.stock:0),0);}

test('normal menus perform explicit owner/captain handoff, shared capacity, real land-water-land transport, and separate once-only settlement',()=>{
 const f=setup(),{w,owner,captain,passenger,other,shipment,trip,boat,docks}=f,coins=totalCoins(w),stock=goods(f),terms={price:shipment.price,gross:shipment.gross,taxRate:shipment.taxRate,stationAt:structuredClone(shipment.stationAt)};
 const c=book(f,true);assert.equal(c.units,2);assert.equal(owner.coins,86);assert.equal(accountBalance(w,c.account),14);assert.equal(occupiedFerryCapacity(trip),2);
 run(w,passenger,choose(w,passenger,'reserve'));assert.equal(occupiedFerryCapacity(trip),3);assert.ok(ferryReason(w,other,{type:'ferry',operation:'reserve',tripId:trip.id}));
 assert.ok(completeFerry(w,captain,{type:'ferry',operation:'loadCargo',tripId:trip.id,cargoId:c.id}));assert.equal(shipment.status,'ready');
 run(w,owner,{type:'foreignTrade',operation:'dispatch',shipmentId:shipment.id});stepWorld(w,5);assert.deepEqual(shipment.route!.at,c.sourceAt);assert.equal(shipment.status,'inTransit');assert.equal(captain.coins,100);
 run(w,captain,choose(w,captain,'loadCargo'));run(w,passenger,choose(w,passenger,'board'));stepWorld(w,Math.max(0,trip.departAt-w.minute));run(w,captain,choose(w,captain,'depart'));stepWorld(w,8);
 assert.deepEqual(shipment.route!.at,boat.at);assert.notDeepEqual(boat.at,{x:7,y:6});assert.equal(shipment.goods,11);assert.equal(accountBalance(w,shipment.escrowAccount),33);assert.equal(captain.coins,100);
 stepWorld(w,60);assert.equal(trip.phase,'docked');assert.equal(boat.dockId,docks[1].id);assert.equal(captain.coins,107,'passenger fare only at docking');assert.equal(accountBalance(w,c.account),14,'freight waits for real unload');
 run(w,captain,choose(w,captain,'unloadCargo'));assert.equal(c.paid,14);assert.equal(captain.coins,121);assert.deepEqual(shipment.route!.at,c.destinationAt);stepWorld(w,20);assert.deepEqual(shipment.route!.at,c.destinationAt);assert.equal(shipment.status,'inTransit');
 assert.ok(ferryReason(w,captain,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}));run(w,captain,choose(w,captain,'disembark'));run(w,captain,choose(w,captain,'releaseCargo'));stepWorld(w,60);assert.equal(shipment.status,'completed');assert.equal(shipment.goods,0);assert.equal(owner.coins,119);assert.equal(totalCoins(w),coins);assert.equal(goods(f),stock);assert.deepEqual({price:shipment.price,gross:shipment.gross,taxRate:shipment.taxRate,stationAt:shipment.stationAt},terms);
 assert.ok(completeFerry(w,captain,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}));stepWorld(w,10);assert.equal(totalCoins(w),coins);assert.equal(c.paid,14);
});

test('capacity is granted only by captain acceptance; refusal, late loading and cancellation refund without moving or duplicating goods',()=>{
 const f=setup(),{w,captain,owner,passenger,other,trip,shipment}=f;assert.equal(completeFerry(w,owner,{type:'ferry',operation:'proposeCargo',tripId:trip.id,shipmentId:shipment.id}),null);const c=trip.cargo![0];
 for(const r of [passenger,other])assert.equal(completeFerry(w,r,{type:'ferry',operation:'reserve',tripId:trip.id}),null);
 assert.ok(ferryReason(w,captain,{type:'ferry',operation:'acceptCargo',tripId:trip.id,cargoId:c.id}));assert.equal(c.status,'offered');assert.equal(completeFerry(w,captain,{type:'ferry',operation:'rejectCargo',tripId:trip.id,cargoId:c.id}),null);assert.equal(owner.coins,100);assert.equal(shipment.status,'ready');assert.equal(shipment.goods,11);assert.equal(c.refunded,14);
 const f2=setup(),c2=book(f2);dispatch(f2);const at=structuredClone(f2.shipment.route!.at),money=totalCoins(f2.w);f2.w.minute=f2.trip.departAt;assert.equal(completeFerry(f2.w,f2.captain,{type:'ferry',operation:'depart',tripId:f2.trip.id}),null);assert.equal(c2.status,'cancelled');assert.equal(c2.refunded,14);assert.deepEqual(f2.shipment.route!.at,at);assert.equal(totalCoins(f2.w),money);assert.ok(completeFerry(f2.w,f2.owner,{type:'ferry',operation:'cancelCargo',tripId:f2.trip.id,cargoId:c2.id}));
});

test('flood and blocked docks hold vessel, custody and escrows through restart; actual return unload refunds without settling the sale',()=>{
 const f=setup(),c=sail(f),{w,shipment,boat,trip,captain,docks}=f,coins=totalCoins(w);tick(f,6);const at=structuredClone(boat.at);
 w.frontierHazards={fallenTrees:[],fires:[],disasters:[{id:'flood',kind:'flashFlood',at:{...boat.at},radius:1,footprint:[{...boat.at}],phase:'active',warningAt:w.minute-5,startsAt:w.minute,endsAt:w.minute+100,affected:[]}],nextSerial:1,lastMinute:w.minute} as unknown as NonNullable<World['frontierHazards']>;
 tick(f,1);assert.equal(trip.phase,'held');assert.deepEqual(boat.at,at);assert.deepEqual(shipment.route!.at,at);assert.equal(waterRoute(w,at,{x:21,y:6}),null);assert.equal(c.paid,0);assert.equal(accountBalance(w,c.account),14);assert.equal(accountBalance(w,shipment.escrowAccount),33);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const saved=store.load()!,s=saved.foreignTrade!.shipments.find(s=>s.id===shipment.id)!,t=saved.ferries!.trips[0];saved.clock.paused=true;stepWorld(saved,300);assert.deepEqual(s.route!.at,at);assert.equal(t.phase,'held');assert.equal(t.cargo![0].status,'aboard');assert.equal(totalCoins(saved),coins);}finally{store.close();}
 w.frontierHazards=undefined;assert.equal(completeFerry(w,captain,{type:'ferry',operation:'return',tripId:trip.id}),null);tick(f,30);assert.equal(boat.dockId,docks[0].id);assert.equal(c.refunded,0);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'unloadCargo',tripId:trip.id,cargoId:c.id}),null);assert.equal(c.refunded,14);assert.deepEqual(shipment.route!.at,c.sourceAt);assert.equal(shipment.status,'inTransit');assert.equal(accountBalance(w,shipment.escrowAccount),33);assert.equal(totalCoins(w),coins);
});

test('merchant recall aboard never teleports or refunds sale escrow before physical reverse carriage and land return',()=>{
 const f=setup(),c=sail(f),{w,shipment,trip,captain,m,boat}=f;tick(f,6);const at={...boat.at},coins=totalCoins(w);
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'cancelShipment',shipmentId:shipment.id}),null);assert.equal(shipment.status,'returning');tick(f,2);assert.deepEqual(shipment.route!.at,boat.at);assert.equal(accountBalance(w,shipment.escrowAccount),33);
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'hold',tripId:trip.id}),null);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'return',tripId:trip.id}),null);tick(f,30);assert.notDeepEqual(boat.at,at);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'unloadCargo',tripId:trip.id,cargoId:c.id}),null);assert.equal(c.refunded,14);assert.equal(accountBalance(w,shipment.escrowAccount),33);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'disembark',tripId:trip.id}),null);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}),null);tick(f,4);assert.equal(shipment.status,'arrived');assert.equal(shipment.returned,true);assert.equal(accountBalance(w,shipment.escrowAccount),0);assert.equal(totalCoins(w),coins);assert.deepEqual(shipment.route!.at,f.docks[0].access);
});

test('food lots age in original custody; spoilage aboard returns sale and freight escrows only at real handoff',()=>{
 const f=setup(11,'meal'),c=sail(f),{w,shipment,trip,captain}=f;initializeFood(w);const lots=w.food!.lots['shipment:'+shipment.id]!.meal!;const original=lots[0].producedAt;for(const lot of lots)lot.expiresAt=w.minute+3;tick(f,2);assert.equal(w.food!.lots['shipment:'+shipment.id]!.meal![0].producedAt,original);w.minute++;advanceFood(w);advanceForeignTrade(w);assert.equal(shipment.goods,0);assert.equal(shipment.status,'returning');assert.equal(accountBalance(w,c.account),14);assert.equal(accountBalance(w,shipment.escrowAccount),33);
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'hold',tripId:trip.id}),null);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'return',tripId:trip.id}),null);tick(f,30);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'unloadCargo',tripId:trip.id,cargoId:c.id}),null);assert.equal(c.paid,0);assert.equal(c.refunded,14);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'disembark',tripId:trip.id}),null);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}),null);tick(f,4);assert.equal(accountBalance(w,shipment.escrowAccount),0);assert.equal(w.foreignTrade!.totals.exports,0);assert.equal(w.foreignTrade!.totals.taxes,0);
});

test('owner death before loading refunds their estate and frees capacity; foreign and passenger terms are not migrated',()=>{
 const f=setup(),c=book(f),{w,owner,trip,shipment}=f;const terms=structuredClone(shipment);recordDeath(w,owner);advanceFerries(w,1);assert.equal(c.status,'cancelled');assert.equal(c.refunded,14);assert.equal(accountBalance(w,'estate:'+owner.id),100);assert.equal(occupiedFerryCapacity(trip),0);assert.deepEqual(shipment,terms);
 const old=setup();delete old.trip.cargo;const original=structuredClone(old.trip);initializeFerries(old.w);assert.deepEqual(old.trip,original);assert.equal(shipmentFerry(old.w,old.shipment.id),undefined);
});

test('import freight keeps the original doorstep and tax cap, requires actual final land delivery, and can be collected only there',()=>{
 const f=setup(2),{w,captain,owner,boat,docks,m}=f;
 // End the unused fixture export in place, then form a real import contract at the west dock.
 owner.at={...docks[0].access};assert.equal(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'cancelShipment',shipmentId:f.shipment.id}),null);
 assert.equal(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'collect',shipmentId:f.shipment.id}),null);
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'cancel',tripId:f.trip.id}),null);
 assert.equal(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'import',item:'wood',quantity:2,price:4,maximumLevyBasisPoints:0,deliveryId:docks[0].id}),null);
 const offer=w.foreignTrade!.offers.at(-1)!;w.minute=offer.noticeAt;advanceForeignTrade(w);assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:offer.id}),null);
 const s=w.foreignTrade!.shipments.at(-1)!;w.minute=s.readyAt;advanceForeignTrade(w);
 // Fixtures place the empty boat and residents before the new journey. No cargo is relocated.
 boat.at={x:21,y:6};boat.dockId=docks[1].id;captain.at={...docks[1].at};owner.at={...docks[1].at};assert.deepEqual(s.route!.at,w.foreignTrade!.station);
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'post',boatId:boat.id,destinationId:docks[0].id,fare:5,departIn:30}),null);const t=w.ferries!.trips.at(-1)!;
 assert.equal(completeFerry(w,owner,{type:'ferry',operation:'proposeCargo',tripId:t.id,shipmentId:s.id}),null);const c=t.cargo![0];assert.equal(completeFerry(w,captain,{type:'ferry',operation:'acceptCargo',tripId:t.id,cargoId:c.id}),null);
 const coins=totalCoins(w),merchantMoney=m.person.coins;w.minute+=20;advanceForeignTrade(w);assert.deepEqual(s.route!.at,docks[1].at);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'loadCargo',tripId:t.id,cargoId:c.id}),null);
 w.minute=t.departAt;assert.equal(completeFerry(w,captain,{type:'ferry',operation:'depart',tripId:t.id}),null);tick(f,40);assert.equal(m.person.coins,merchantMoney);assert.equal(accountBalance(w,s.escrowAccount),8);
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'unloadCargo',tripId:t.id,cargoId:c.id}),null);assert.equal(c.paid,5);assert.equal(s.status,'inTransit');assert.equal(completeFerry(w,captain,{type:'ferry',operation:'disembark',tripId:t.id}),null);
 assert.equal(completeFerry(w,captain,{type:'ferry',operation:'releaseCargo',tripId:t.id,cargoId:c.id}),null);w.minute++;advanceForeignTrade(w);assert.equal(s.status,'inTransit','unloading is not arrival at the original access tile');w.minute++;advanceForeignTrade(w);assert.equal(s.status,'arrived');assert.deepEqual(s.route!.at,docks[0].access);assert.equal(m.person.coins,merchantMoney+8);assert.equal(s.price,4);assert.equal(s.taxRate,0);assert.equal(totalCoins(w),coins);
 owner.at={...docks[0].at};assert.ok(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'collect',shipmentId:s.id}));owner.at={...docks[0].access};const stock=owner.inventory.wood??0;assert.equal(completeForeignTrade(w,owner,{type:'foreignTrade',operation:'collect',shipmentId:s.id}),null);assert.equal(owner.inventory.wood,stock+2);
});

test('strict menus freeze consignment identity; stale accept/load/unload and remote releases cannot move goods or pay',()=>{
 const f=setup(),{w,captain,owner,trip,shipment,boat}=f,menu=ferryOpportunities(w,owner),proposal=menu.find(c=>c.action.type==='ferry'&&c.action.operation==='proposeCargo')!;assert.ok(proposal);
 for(const data of [{shipmentId:'forged'},{fare:0},{destinationId:'forged'},{cargoId:'forged'}])assert.throws(()=>parseChoice(JSON.stringify({choice:proposal.id,...data}),menu));
 const c=book(f);dispatch(f);const at=structuredClone(shipment.route!.at);captain.at={x:1,y:1};assert.ok(!ferryOpportunities(w,captain).some(c=>c.action.type==='ferry'&&c.action.operation==='loadCargo'));assert.ok(completeFerry(w,captain,{type:'ferry',operation:'loadCargo',tripId:trip.id,cargoId:c.id}));assert.deepEqual(shipment.route!.at,at);
 captain.at={...f.docks[0].at};assert.equal(completeFerry(w,captain,{type:'ferry',operation:'loadCargo',tripId:trip.id,cargoId:c.id}),null);assert.ok(completeFerry(w,captain,{type:'ferry',operation:'loadCargo',tripId:trip.id,cargoId:c.id}));assert.equal(completeFerry(w,captain,{type:'ferry',operation:'unloadCargo',tripId:trip.id,cargoId:c.id}),null);assert.equal(c.refunded,14);
 w.minute=trip.departAt;assert.equal(completeFerry(w,captain,{type:'ferry',operation:'depart',tripId:trip.id}),null);tick(f,2);assert.ok(completeFerry(w,captain,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}));assert.deepEqual(shipment.route!.at,c.sourceAt);assert.notDeepEqual(boat.at,c.sourceAt);assert.equal(c.status,'unloaded');
 owner.at={...c.sourceAt};assert.equal(completeFerry(w,owner,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}),null);assert.ok(completeFerry(w,owner,{type:'ferry',operation:'releaseCargo',tripId:trip.id,cargoId:c.id}));assert.equal(c.refunded,14);
});

test('owner death immediately before acceptance or loading cannot race the later automatic cancellation',()=>{
 const offered=setup();assert.equal(completeFerry(offered.w,offered.owner,{type:'ferry',operation:'proposeCargo',tripId:offered.trip.id,shipmentId:offered.shipment.id}),null);const pending=offered.trip.cargo![0];recordDeath(offered.w,offered.owner);assert.ok(completeFerry(offered.w,offered.captain,{type:'ferry',operation:'acceptCargo',tripId:offered.trip.id,cargoId:pending.id}));
 const f=setup(),c=book(f);dispatch(f);const at={...f.shipment.route!.at!};recordDeath(f.w,f.owner);assert.ok(completeFerry(f.w,f.captain,{type:'ferry',operation:'loadCargo',tripId:f.trip.id,cargoId:c.id}));assert.deepEqual(f.shipment.route!.at,at);assert.equal(c.status,'accepted');advanceFerries(f.w,1);assert.equal(c.refunded,14);assert.equal(c.status,'cancelled');
});

test('multi-tile docks bind loading and ashore unloading to the actual boat berth, never another pier tile',()=>{
 const f=setup(),{w,owner,captain,boat,trip,shipment,docks}=f;
 const extra={at:{x:6,y:8},before:'water' as const,after:'bridge' as const};docks[0].tiles.push(extra);w.map.tiles[8*32+6]='bridge';
 // The extra tile becomes the generic berth, but this boat remains beside its real y=6 berth.
 const c=book(f);assert.deepEqual(c.sourceAt,{x:6,y:6});dispatch(f);assert.equal(completeFerry(w,captain,{type:'ferry',operation:'loadCargo',tripId:trip.id,cargoId:c.id}),null);assert.deepEqual(shipment.route!.at,boat.at);
 owner.at={...extra.at};assert.ok(completeFerry(w,owner,{type:'ferry',operation:'unloadCargo',tripId:trip.id,cargoId:c.id}));assert.equal(c.status,'aboard');assert.deepEqual(shipment.route!.at,boat.at);owner.at={x:6,y:6};assert.equal(completeFerry(w,owner,{type:'ferry',operation:'unloadCargo',tripId:trip.id,cargoId:c.id}),null);assert.deepEqual(shipment.route!.at,owner.at);assert.equal(c.refunded,14);
});

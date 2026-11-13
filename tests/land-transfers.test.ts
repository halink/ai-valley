import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {LandRightsAction} from '../src/shared/land-rights.js';
import {createWorld} from '../src/world/seed.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {DAY,YEAR} from '../src/world/time.js';
import {initializeLandRights,advanceLandRights,completeLandRights,landRightsTarget} from '../src/world/land-rights.js';
import {landTransferOpportunities,privateParcelError} from '../src/world/land-transfers.js';
import {initializeProduction,productionParcels,completeProduction} from '../src/world/production.js';
import {initializeConstruction,completeConstruction,constructionReason,constructionTarget} from '../src/world/construction.js';
import {initializeEconomy,totalCoins} from '../src/world/economy.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {initializeIndustry} from '../src/world/industry.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {WorldStore,workingEvents} from '../src/server/store.js';
import {emitLedgerEvent} from '../src/world/events.js';

import {recordDeath} from '../src/world/life.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;
 w.map={...w.map,width:48,height:40,tiles:Array(48*40).fill('grass'),entrance:{x:1,y:1}};w.resources=[];w.plots=[];w.graves=[];
 const [seller,buyer,other]=w.residents,parcel={x:6,y:18,width:9,height:7,ownerId:seller.id},access={x:10,y:25};
 const source=w.buildings[0],hall={...source,id:'transfer-hall',name:'会馆',ownerId:'commons',kind:'lodge' as const,at:{x:30,y:5},width:8,height:6,door:{x:34,y:11},residents:[]};w.buildings=[hall];
 w.definitions['land/start@1'].data.parcels=[{...parcel}];
 for(const r of w.residents){r.bornAt=w.minute-25*YEAR;r.at={...access};r.inside=null;r.roomAt=null;r.homeId=null;r.residency='resident';r.canDecide=r.canExpress=true;r.coins=200;r.inventory={wood:60,stone:60,meal:40,water:40};r.health=r.energy=100;r.hunger=0;r.knownBuildings=[hall.id];r.plan=null;r.activity=null;}
 initializeEconomy(w);initializeProduction(w);initializeConstruction(w);initializeLandRights(w);initializeForeignTrade(w);initializeIndustry(w);
 return {w,seller,buyer,other,parcel,access,hall};
}
const action=(operation:LandRightsAction['operation'],saleId?:string):LandRightsAction=>({type:'landRights',operation,saleId});
function offer(f:ReturnType<typeof fixture>,price=40){
 const a:LandRightsAction={type:'landRights',operation:'offerParcel',parcelIndex:0,parcel:{...f.parcel},buyerId:f.buyer.id,price};
 assert.equal(completeLandRights(f.w,f.seller,a),null);return f.w.landRights!.transfers!.sales.at(-1)!;
}
function choose(w:World,r:Resident,operation:LandRightsAction['operation'],extra:Record<string,unknown>={}){
 const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(c=>c.action.type==='landRights'&&c.action.operation===operation);assert.ok(choice,menu.map(c=>c.id).join(','));
 return parseChoice(JSON.stringify({choice:choice.id,...extra}),menu).actions[0];
}
function run(w:World,r:Resident,a:Action){
 assert.equal(submitPlan(w,{id:'land-sale-test:'+w.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人独立选择原址地块交易',actions:[a]}).ok,true);
 let guard=100;while(r.plan||r.activity){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);
}

test('normal final choices reach owner offer and independent buyer acceptance, then buyer alone can build',()=>{
 const f=fixture(),{w,seller,buyer,parcel}=f,money=totalCoins(w),defs=JSON.stringify(w.definitions['land/start@1']),inventory=structuredClone(w.residents.map(r=>r.inventory)),map=structuredClone(w.map);
 run(w,seller,choose(w,seller,'offerParcel',{price:73}));const s=w.landRights!.transfers!.sales[0];
 assert.equal(s.buyerId,buyer.id);assert.equal(s.price,73);assert.equal(s.status,'offered');assert.equal(buyer.coins,200);assert.equal(productionParcels(w)[0].ownerId,seller.id);
 assert.ok(decisionChoices(decisionContext(w,buyer)).some(c=>c.action.type==='landRights'&&c.action.operation==='declineParcel'));
 run(w,buyer,choose(w,buyer,'buyParcel'));
 assert.equal(s.status,'sold');assert.equal(seller.coins,273);assert.equal(buyer.coins,127);assert.equal(productionParcels(w)[0].ownerId,buyer.id);assert.equal(productionParcels(w).length,1);assert.equal(totalCoins(w),money);
 assert.equal(JSON.stringify(w.definitions['land/start@1']),defs);assert.deepEqual(w.map,map);assert.deepEqual(w.residents.map(r=>r.inventory),inventory);assert.equal(w.buildings.length,1);
 const build={type:'construction' as const,operation:'propose' as const,kind:'home' as const,scope:'private' as const,at:{x:parcel.x,y:parcel.y},wagePerHour:0,prices:{wood:2,stone:2}};
 buyer.at={...constructionTarget(w,buyer,build).target};seller.at={...buyer.at};assert.ok(constructionReason(w,seller,build));assert.equal(completeConstruction(w,buyer,build),null);assert.equal(w.construction!.projects[0].ownerId,buyer.id);

});

test('offering and acceptance require actual outdoor presence, independent adults, and the named buyer',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>f.buyer.bornAt=f.w.minute-17*YEAR,f=>f.buyer.residency='visitor',f=>f.buyer.canExpress=false,f=>f.buyer.inside=f.hall.id,f=>f.buyer.at={x:1,y:1}] as Array<(f:ReturnType<typeof fixture>)=>void>){const f=fixture();mutate(f);const before=JSON.stringify(f.w);assert.equal(landTransferOpportunities(f.w,f.seller).filter(c=>c.action.type==='landRights'&&c.action.buyerId===f.buyer.id).length,0);assert.equal(JSON.stringify(f.w),before);}
 const f=fixture(),s=offer(f),a=action('buyParcel',s.id);assert.ok(completeLandRights(f.w,f.seller,a));assert.ok(completeLandRights(f.w,f.other,a));
 for(const mutate of [(r:Resident)=>r.at={x:1,y:1},r=>r.inside=f.hall.id,r=>r.canDecide=false,r=>r.canExpress=false,r=>r.bornAt=f.w.minute-17*YEAR,r=>r.residency='outside'] as Array<(r:Resident)=>void>){const snapshot=structuredClone(f.seller);mutate(f.seller);assert.ok(completeLandRights(f.w,f.buyer,a));Object.assign(f.seller,snapshot);}
 f.buyer.at={x:f.access.x+1,y:f.access.y};assert.equal(landRightsTarget(f.w,f.buyer,a).error,undefined);assert.match(completeLandRights(f.w,f.buyer,a)!,/实际到达/);assert.equal(s.status,'offered');assert.equal(f.buyer.coins,200);
});

test('a seller aboard a ferry cannot sign through the stale shore coordinate',()=>{
 const f=fixture(),s=offer(f);f.w.ferries={trips:[{aboard:[f.seller.id]}] as never,boats:[],builds:[],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0}};
 assert.ok(completeLandRights(f.w,f.buyer,action('buyParcel',s.id)));assert.equal(s.status,'offered');assert.equal(f.buyer.coins,200);
});

test('buyer can refuse and seller can withdraw independently, without money or title changes',()=>{
 for(const operation of ['declineParcel','cancelParcel'] as const){const f=fixture(),s=offer(f),coins=totalCoins(f.w);const actor=operation==='declineParcel'?f.buyer:f.seller;(operation==='declineParcel'?f.seller:f.buyer).at={x:1,y:1};assert.equal(completeLandRights(f.w,actor,action(operation,s.id)),null);assert.equal(s.status,operation==='declineParcel'?'declined':'cancelled');assert.equal(totalCoins(f.w),coins);assert.equal(productionParcels(f.w)[0].ownerId,f.seller.id);assert.ok(completeLandRights(f.w,f.buyer,action('buyParcel',s.id)));}
});

test('funding failure and unsafe account balances leave both title and money unchanged',()=>{
 for(const [cash,receiving]of [[39,200],[200,Number.MAX_SAFE_INTEGER],[1.5,200],[200,1.5]]){const f=fixture(),s=offer(f);f.buyer.coins=cash;f.seller.coins=receiving;const money=totalCoins(f.w),before=f.w.economy!.transferCount;assert.ok(completeLandRights(f.w,f.buyer,action('buyParcel',s.id)));assert.equal(s.status,'offered');assert.equal(f.w.economy!.transferCount,before);assert.equal(totalCoins(f.w),money);assert.equal(productionParcels(f.w)[0].ownerId,f.seller.id);}
});

test('terms cannot be changed by buyer parsing, and original offer binds the exact parcel geometry',()=>{
 const f=fixture(),menu=decisionChoices(decisionContext(f.w,f.seller)),choice=menu.find(c=>c.action.type==='landRights'&&c.action.operation==='offerParcel')!;assert.ok(choice);assert.match(parseChoice(JSON.stringify({choice:choice.id,price:73}),menu).intention,/73 钱/);
 for(const price of [0,-1,1.1,100001,'40'])assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,price}),menu));
 for(const field of ['buyerId','parcelIndex','parcel','saleId'])assert.throws(()=>parseChoice(JSON.stringify({choice:choice.id,[field]:'forged'}),menu));
 const draft=structuredClone(choice.action);(f.w.definitions['land/start@1'].data.parcels as typeof f.parcel[])[0].width++;assert.ok(completeLandRights(f.w,f.seller,draft as LandRightsAction));
 const fresh=fixture(),s=offer(fresh),buyMenu=decisionChoices(decisionContext(fresh.w,fresh.buyer)),buy=buyMenu.find(c=>c.action.type==='landRights'&&c.action.operation==='buyParcel')!;
 assert.throws(()=>parseChoice(JSON.stringify({choice:buy.id,price:1}),buyMenu));assert.throws(()=>parseChoice(JSON.stringify({choice:buy.id,buyerId:fresh.other.id}),buyMenu));assert.equal(s.price,40);
});

test('all existing occupancy and protected claims are excluded both before offer and at acceptance',()=>{
 const changes:Array<[string,(f:ReturnType<typeof fixture>)=>void]>=[
  ['building',f=>f.w.buildings.push({...f.hall,id:'occupied',at:{x:f.parcel.x,y:f.parcel.y},ownerId:f.other.id})],
  ['yard',f=>f.w.construction!.yards.other={x:f.parcel.x,y:f.parcel.y,width:2,height:2}],
  ['plot',f=>f.w.plots.push({id:'crop',at:{x:f.parcel.x,y:f.parcel.y},ownerId:f.other.id,crop:null})],
  ['pasture',f=>f.w.industry!.pastures=[{id:'used',barnId:f.hall.id,tiles:[{x:f.parcel.x,y:f.parcel.y}],forage:1,capacity:1,lastMinute:0}]],
  ['project',f=>f.w.construction!.projects.push({at:{x:f.parcel.x,y:f.parcel.y},width:2,height:2,reserved:true} as never)],
  ['adjacent project entrance stock',f=>f.w.construction!.projects.push({at:{x:6,y:16},width:2,height:2,door:{x:7,y:18},status:'active',reserved:true,stock:[{quantity:5}],claims:[],incorporated:{}} as never)],
  ['retained materials',f=>f.w.construction!.projects.push({at:{x:f.parcel.x,y:f.parcel.y},width:2,height:2,status:'cancelled',reserved:false,stock:[],claims:[{quantity:1}],incorporated:{}} as never)],
  ['estate goods',f=>f.w.estates.push({personId:'dead',coins:0,inventory:{wood:1},status:'protected',heirs:[],location:{at:{x:f.parcel.x,y:f.parcel.y},inside:null,roomAt:null}})],
  ['sealed tool',f=>f.w.industry!.tools.push({location:{at:{x:f.parcel.x,y:f.parcel.y},inside:null}} as never)],
  ['unburied body',f=>{f.other.status='dead';f.other.at={x:f.parcel.x,y:f.parcel.y};}],
  ['resource',f=>f.w.resources.push({id:'spring',kind:'spring',at:{x:f.parcel.x,y:f.parcel.y},amount:0,max:1,regrowthDays:1,lastHarvest:0})],
  ['road',f=>f.w.map.tiles[f.parcel.y*f.w.map.width+f.parcel.x]='path'],
  ['finite grant',f=>f.w.landRights!.applications.push({id:'finite',status:'review',at:{x:f.parcel.x,y:f.parcel.y},width:2,height:2} as never)],
  ['infrastructure',f=>f.w.infrastructure={lastDay:0,totals:{roads:0,bridges:0,docks:0,cemeteries:0,repairs:0},assets:[{retiredAt:null,tiles:[],anchors:[{x:f.parcel.x,y:f.parcel.y}]} as never]}],
  ['unclaimed inheritance',f=>f.w.production!.inheritances.dead={createdAt:0,shares:[{claimedAt:null,parcels:[0]} as never]}],
 ];
 for(const [name,mutate]of changes){const f=fixture(),s=offer(f),coins=totalCoins(f.w);mutate(f);assert.ok(privateParcelError(f.w,0,f.parcel),name);assert.ok(completeLandRights(f.w,f.buyer,action('buyParcel',s.id)),name);assert.equal(s.status,'offered');assert.equal(totalCoins(f.w),coins);assert.equal(productionParcels(f.w)[0].ownerId,f.seller.id);const before=fixture();mutate(before);assert.ok(completeLandRights(before.w,before.seller,{type:'landRights',operation:'offerParcel',parcelIndex:0,parcel:before.parcel,buyerId:before.buyer.id,price:40}),name);assert.equal(before.w.landRights!.transfers!.sales.length,0);}
});

test('stale acceptance cannot overtake newly reserved construction or continue after seller death',()=>{
 for(const change of ['construction','death'] as const){const f=fixture(),s=offer(f),a=action('buyParcel',s.id),coins=totalCoins(f.w);
  if(change==='construction'){const build={type:'construction' as const,operation:'propose' as const,kind:'home' as const,scope:'private' as const,at:{x:f.parcel.x,y:f.parcel.y},wagePerHour:0,prices:{wood:2,stone:2}};f.seller.at={...constructionTarget(f.w,f.seller,build).target};assert.equal(completeConstruction(f.w,f.seller,build),null);f.seller.at={...f.access};}else recordDeath(f.w,f.seller);
  assert.ok(completeLandRights(f.w,f.buyer,a));advanceLandRights(f.w);assert.equal(s.status,'invalid');assert.equal(totalCoins(f.w),coins);assert.equal(productionParcels(f.w)[0].ownerId,f.seller.id);
 }
});

test('one pending offer per parcel, fixed expiry and replay protection prevent duplicate title or payments',()=>{
 const f=fixture(),s=offer(f);assert.ok(completeLandRights(f.w,f.seller,{type:'landRights',operation:'offerParcel',parcelIndex:0,parcel:f.parcel,buyerId:f.other.id,price:60}));
 const a=action('buyParcel',s.id);assert.equal(completeLandRights(f.w,f.buyer,a),null);const money=totalCoins(f.w),count=f.w.economy!.transferCount;assert.ok(completeLandRights(f.w,f.buyer,a));assert.equal(f.w.economy!.transferCount,count);assert.equal(totalCoins(f.w),money);
 const g=fixture(),expired=offer(g);g.w.minute=expired.expiresAt;assert.ok(completeLandRights(g.w,g.buyer,action('buyParcel',expired.id)));advanceLandRights(g.w);assert.equal(expired.status,'expired');assert.equal(g.buyer.coins,200);assert.equal(productionParcels(g.w)[0].ownerId,g.seller.id);
});

test('a genuine later resale never reactivates the old sale or its coin receipt',()=>{
 const f=fixture(),s=offer(f),old=action('buyParcel',s.id);assert.equal(completeLandRights(f.w,f.buyer,old),null);
 assert.equal(completeLandRights(f.w,f.buyer,{type:'landRights',operation:'offerParcel',parcelIndex:0,parcel:productionParcels(f.w)[0],buyerId:f.seller.id,price:55}),null);const next=f.w.landRights!.transfers!.sales.at(-1)!;assert.notEqual(next.id,s.id);
 assert.equal(completeLandRights(f.w,f.seller,action('buyParcel',next.id)),null);const count=f.w.economy!.transferCount,coins=[f.seller.coins,f.buyer.coins];assert.equal(productionParcels(f.w)[0].ownerId,f.seller.id);
 assert.ok(completeLandRights(f.w,f.buyer,old));assert.equal(productionParcels(f.w)[0].ownerId,f.seller.id);assert.equal(f.w.economy!.transferCount,count);assert.deepEqual([f.seller.coins,f.buyer.coins],coins);
});

test('purchased private land follows the buyer estate and only its independently accepting heir',()=>{
 const f=fixture(),s=offer(f);assert.equal(completeLandRights(f.w,f.buyer,action('buyParcel',s.id)),null);f.other.parents=[f.buyer.id];f.seller.parents=[];f.buyer.relations=[];const definition=JSON.stringify(f.w.definitions['land/start@1']),money=totalCoins(f.w);
 recordDeath(f.w,f.buyer);initializeProduction(f.w);assert.equal(productionParcels(f.w)[0].ownerId,f.buyer.id);assert.ok(completeProduction(f.w,f.seller,{type:'production',operation:'inherit',personId:f.buyer.id}));
 f.other.at={...f.hall.door};assert.equal(completeProduction(f.w,f.other,{type:'production',operation:'inherit',personId:f.buyer.id}),null);assert.equal(productionParcels(f.w)[0].ownerId,f.other.id);assert.equal(JSON.stringify(f.w.definitions['land/start@1']),definition);assert.equal(totalCoins(f.w),money);assert.equal(s.status,'sold');
});

test('distant parties do not learn invalidation through changed menus or memories',()=>{
 const f=fixture(),s=offer(f);f.buyer.at={x:40,y:35};const choices=landTransferOpportunities(f.w,f.buyer),memories=structuredClone(f.buyer.memories);
 f.w.plots.push({id:'new-field',at:{x:f.parcel.x,y:f.parcel.y},ownerId:f.other.id,crop:null});advanceLandRights(f.w);
 assert.equal(s.status,'invalid');assert.equal(s.knownStatus[f.buyer.id],'offered');assert.deepEqual(landTransferOpportunities(f.w,f.buyer),choices);assert.deepEqual(f.buyer.memories,memories);
 f.buyer.at={...f.access};assert.equal(completeLandRights(f.w,f.buyer,action('inspectParcelSale',s.id)),null);assert.equal(s.knownStatus[f.buyer.id],'invalid');assert.match(f.buyer.memories.at(-1)!.text,/失效/);
});

test('old-save installation changes no title, people, funds, geometry or finite grants',()=>{
 const f=fixture();delete f.w.landRights!.transfers;const before={people:structuredClone(f.w.residents),parcels:productionParcels(f.w),map:structuredClone(f.w.map),money:totalCoins(f.w),applications:structuredClone(f.w.landRights!.applications)};
 initializeLandRights(f.w);initializeLandRights(f.w);assert.deepEqual(f.w.landRights!.transfers,{nextSerial:1,sales:[]});assert.deepEqual(f.w.residents,before.people);assert.deepEqual(productionParcels(f.w),before.parcels);assert.deepEqual(f.w.map,before.map);assert.equal(totalCoins(f.w),before.money);assert.deepEqual(f.w.landRights!.applications,before.applications);
});

test('in-flight acceptance survives SQLite working reload and rechecks seller presence at completion',()=>{
 for(const leave of [false,true]){const f=fixture(),s=offer(f),a=action('buyParcel',s.id),coins=totalCoins(f.w);assert.equal(submitPlan(f.w,{id:'land-sale-restart',actorId:f.buyer.id,actorRevision:f.buyer.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'本人独立接受原固定报价',actions:[a]}).ok,true);stepWorld(f.w,1);assert.ok(f.buyer.activity);
  const store=new WorldStore(':memory:');store.commit(f.w,null);const w=store.load(true)!,buyer=w.residents.find(r=>r.id===f.buyer.id)!,seller=w.residents.find(r=>r.id===f.seller.id)!,saved=w.landRights!.transfers!.sales[0];if(leave)seller.at={x:1,y:1};
  let guard=100;while(buyer.plan||buyer.activity){assert.ok(guard--);stepWorld(w,1);}assert.equal(saved.status,leave?'offered':'sold');assert.equal(productionParcels(w)[0].ownerId,leave?seller.id:buyer.id);assert.equal(totalCoins(w),coins);assert.equal(saved.expiresAt,s.expiresAt);
  store.commit(w,f.w.revision);const again=store.loadForRuntime()!;assert.equal(again.landRights!.transfers!.sales[0].status,saved.status);if(!leave){const count=again.economy!.transferCount;assert.ok(completeLandRights(again,again.residents.find(r=>r.id===buyer.id)!,a));assert.equal(again.economy!.transferCount,count);}store.close();
 }
});

test('sale audit evidence outlives the working event window',()=>{
 const f=fixture(),s=offer(f);assert.equal(completeLandRights(f.w,f.buyer,action('buyParcel',s.id)),null);f.w.minute+=30*DAY;for(let n=0;n<1800;n++)emitLedgerEvent(f.w,{kind:'system',actors:[],place:{x:1,y:1},text:'isolated archive filler '+n});for(const r of f.w.residents)r.memories=[];
 assert.ok(s.eventIds.every(id=>workingEvents(f.w).some(e=>e.id===id)));const store=new WorldStore(':memory:');store.commit(f.w,null);const w=store.load(true)!;store.close();assert.ok(s.eventIds.every(id=>w.events.some(e=>e.id===id)));
 f.seller.name='<script>alert(1)</script>';
});

test('formal nine-resident world exposes a genuine empty founding parcel without any new land',()=>{
 const w=createFormalWorld();w.clock.paused=false;stepWorld(w,0);initializeProduction(w);initializeLandRights(w);initializeForeignTrade(w);const parcels=productionParcels(w),seller=w.residents.find(r=>r.id===parcels[0].ownerId)!,buyer=w.residents.find(r=>r.id!==seller.id&&r.status==='alive'&&ageYearsForTest(w,r)>=18)!;
 const p=parcels[0],at={x:p.x+Math.floor(p.width/2),y:p.y+p.height};seller.at={...at};buyer.at={...at};for(const r of [seller,buyer]){r.inside=null;r.roomAt=null;r.canDecide=r.canExpress=true;}
 assert.equal(privateParcelError(w,0,p),null);const a=landTransferOpportunities(w,seller).find(c=>c.action.type==='landRights'&&c.action.operation==='offerParcel'&&c.action.buyerId===buyer.id);assert.ok(a);const before=productionParcels(w);assert.equal(completeLandRights(w,seller,a.action as LandRightsAction),null);assert.deepEqual(productionParcels(w),before);assert.equal(w.landRights!.transfers!.sales.length,1);
});
function ageYearsForTest(w:World,r:Resident){return (w.minute-r.bornAt)/YEAR;}

import {focusedChoices} from '../src/server/agency-opportunities.js';
import type {ActionChoice} from '../src/server/affordances.js';
import {focusNames,type Focus} from '../src/shared/agency.js';
import {executeSocialAction} from '../src/world/social.js';
import {canDepart} from '../src/world/migration.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {CivicAction,CivicMeasure} from '../src/shared/civic.js';
import type {ForeignAction,ForeignShipment} from '../src/shared/foreign-trade.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {initializeCivic,completeCivic,advanceCivic} from '../src/world/civic.js';
import {initializeForeignTrade,advanceForeignTrade,completeForeignTrade} from '../src/world/foreign-trade.js';
import {reserveCommitted} from '../src/world/public-food-procurement.js';
import {reserveReceiptId} from '../src/world/public-food-reserves.js';
import {initializeFood,advanceFood,foodContainers} from '../src/world/food.js';
import {initializeCommons} from '../src/world/commons.js';
import {initializeRooms} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {accountBalance} from '../src/world/economy.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {foreignOpportunities} from '../src/server/foreign-opportunities.js';

import {WorldStore} from '../src/server/store.js';
import {recordDeath} from '../src/world/life.js';
import {DAY,YEAR} from '../src/world/time.js';

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
function run(w:World,r:Resident,a:Action){assert.equal(submitPlan(w,{id:`public-procurement:${r.id}:${w.minute}:${w.revision}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人自主决定',actions:[a]}).ok,true);let n=1000;while(r.plan||r.activity){assert.ok(n-->0);stepWorld(w,1);}assert.equal(r.lastFailure,null);}
function pick(w:World,r:Resident,predicate:(a:Action)=>boolean){for(let i=0;i<100;i++){const menu=decisionChoices(decisionContext(w,r)),choice=menu.find(o=>predicate(o.action));if(choice)return {menu,choice};run(w,r,{type:'wait',minutes:30});}throw new Error('normal rotating choice not exposed');}

test('review: fractional tax refunds stay public and use an independent rounding ledger',()=>{
 const f=fixture(),{w,r,p}=f;w.civic!.salesTax={proposalId:'review-tax',basisPoints:1500,expiresAt:w.minute+DAY};
 const cash=r.coins;const a=arrived(f,1);assert.equal(a.maxTax,1);assert.equal(a.actualTax,0);assert.equal(p.spent,3);assert.equal(accountBalance(w,p.supplyAccount),36);
 const b=arrived(f,2);assert.equal(b.actualTax,1);assert.equal(p.spent,10);assert.equal(accountBalance(w,p.supplyAccount),29);assert.equal(r.coins,cash);
 assert.equal(w.economy!.taxRemainders?.['resident:'+r.id],undefined);
});

test('review: loss after purchase and partial delivery never reopen the cumulative quota',()=>{
 const f=fixture(),{w,p}=f,s=arrived(f,3);collect(f,s);
 const lot=w.food!.lots['shipment:'+s.id].turnip![0];w.food!.lots['shipment:'+s.id].turnip=[{...lot,quantity:1,expiresAt:w.minute+1},{...lot,quantity:2}];w.minute++;advanceFood(w);assert.equal(s.goods,2);table(f);assert.equal(completeCivic(w,f.r,delivery(f,s)),null);
 assert.equal(p.stocked,2);assert.equal(p.foreignProcurement!.acquired,3);assert.equal(reserveCommitted(w,p),3);assert.equal(p.inventory.turnip,2);
});

test('review: loss of speech during an existing collect plan cancels it permanently',()=>{
 const f=fixture(),{w,r}=f,s=arrived(f);const a:Action={type:'foreignTrade',operation:'collect',shipmentId:s.id};
 assert.equal(submitPlan(w,{id:'review-collect',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'collect',actions:[a]}).ok,true);
 stepWorld(w,1);assert.ok(r.activity);r.canExpress=false;stepWorld(w,1);assert.equal(r.plan,null);assert.equal(r.activity,null);assert.equal(s.publicCarrier,undefined);
 r.canExpress=true;stepWorld(w,12);assert.equal(s.publicCarrier,undefined);assert.equal(s.goods,3);
});

test('review: an old future delivery does not revive after incapacity during an earlier wait',()=>{
 const f=fixture(),{w,r}=f,s=arrived(f);collect(f,s);table(f);
 assert.equal(submitPlan(w,{id:'review-wait-deliver',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'wait then deliver',actions:[{type:'wait',minutes:30},delivery(f,s)]}).ok,true);
 stepWorld(w,1);r.canExpress=false;stepWorld(w,1);assert.equal(r.plan,null);r.canExpress=true;stepWorld(w,35);assert.equal(s.goods,3);assert.equal(f.p.stocked,0);
});

test('review: returning money and quantity stay locked until actual regional return after reload',()=>{
 const f=fixture(),s=accepted(f,12);f.r.canDecide=false;advanceForeignTrade(f.w);assert.equal(s.status,'returning');assert.equal(reserveCommitted(f.w,f.p),12);assert.equal(accountBalance(f.w,s.escrowAccount),36);
 const w=JSON.parse(JSON.stringify(f.w)) as World,p=w.civic!.reserves![0],r=w.residents[0],shipment=w.foreignTrade!.shipments[0];r.canDecide=true;advanceForeignTrade(w);assert.equal(shipment.status,'returning');assert.equal(reserveCommitted(w,p),12);
 w.minute=shipment.arrivesAt!;advanceForeignTrade(w);assert.equal(shipment.status,'cancelled');assert.equal(reserveCommitted(w,p),0);assert.equal(accountBalance(w,p.supplyAccount),39);assert.equal(r.coins,f.r.coins);
});

test('review: paid carried cargo survives pruning of more than 160 foreign shipments',()=>{
 const f=fixture(),s=arrived(f);collect(f,s);const expiry=f.w.food!.lots['shipment:'+s.id].turnip![0].expiresAt;
 for(let i=0;i<170;i++)f.w.foreignTrade!.shipments.push({...structuredClone(s),id:'review-closed-'+i,goods:0,status:'completed',publicReserveId:undefined,publicCarrier:undefined});
 advanceForeignTrade(f.w);initializeFood(f.w);assert.ok(f.w.foreignTrade!.shipments.includes(s));assert.equal(s.goods,3);assert.equal(f.w.food!.lots['shipment:'+s.id].turnip![0].expiresAt,expiry);
});

test('review: public carried goods are sealed at the instant of death, before corpse transport',()=>{
 const f=fixture(),s=arrived(f);collect(f,s);f.r.at={x:4,y:10};const deathAt={...f.r.at};recordDeath(f.w,f.r,'accident');
 assert.equal(s.publicCarrier!.sealed,true);assert.deepEqual(s.publicCarrier!.at,deathAt);
 f.r.at={x:8,y:10};advanceForeignTrade(f.w);assert.deepEqual(s.publicCarrier!.at,deathAt);
});

test('review: a blocked gate delays payment and merchant cancellation refunds only after return',()=>{
 const f=fixture(),{w,m,p}=f,s=accepted(f),cash=m.person.coins;const gate=w.foreignTrade!.station,index=gate.y*w.map.width+gate.x;w.map.tiles[index]='water';
 w.minute=s.arrivesAt!;advanceForeignTrade(w);assert.equal(s.status,'inTransit');assert.equal(p.spent,0);assert.equal(m.person.coins,cash);assert.equal(s.blockedSince,w.minute);
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'cancelShipment',shipmentId:s.id}),null);assert.equal(s.status,'returning');assert.equal(accountBalance(w,p.supplyAccount),30);assert.equal(reserveCommitted(w,p),3);
 w.minute=s.arrivesAt!-.25;advanceForeignTrade(w);assert.equal(s.status,'returning');assert.equal(accountBalance(w,p.supplyAccount),30);
 w.minute+=.25;advanceForeignTrade(w);assert.equal(s.status,'cancelled');assert.equal(accountBalance(w,p.supplyAccount),39);assert.equal(p.spent,0);assert.equal(m.person.coins,cash);
});

test('review: the last quarter-minute does not extend purchase authority past its exact deadline',()=>{
 const f=fixture(),{w,p,m}=f,s=accepted(f),cash=m.person.coins;
 w.minute=p.expiresAt-.25;s.route!.dueAt=p.expiresAt;s.arrivesAt=p.expiresAt;advanceForeignTrade(w);assert.equal(s.status,'inTransit');assert.equal(p.spent,0);
 w.minute=p.expiresAt;advanceForeignTrade(w);assert.equal(s.status,'returning');assert.equal(s.actualTax,null);assert.equal(m.person.coins,cash);assert.equal(accountBalance(w,s.escrowAccount),9);
});

test('review: carrying public grain blocks departure until actual delivery, but uncollected grain does not',()=>{
 const f=fixture(),s=arrived(f);assert.equal(canDepart(f.w,f.r),null);collect(f,s);assert.ok(canDepart(f.w,f.r));assert.equal(executeSocialAction(f.w,f.r,{type:'leave'}).ok,false);assert.equal(f.r.residency,'resident');
 f.w.minute=f.p.expiresAt;advanceCivic(f.w);assert.ok(canDepart(f.w,f.r));table(f);assert.equal(completeCivic(f.w,f.r,delivery(f,s)),null);assert.equal(canDepart(f.w,f.r),null);
});

test('review: saturated public import exposure preserves old choices and rotates all three merchants',()=>{
 const f=fixture(),context=decisionContext(f.w,f.r);
 context.actor.hunger=20;context.actor.agency=undefined;
 context.formal={...context.formal!,foodCoverage:undefined,frontier:false,aboard:false,passenger:false};
 const baseline:ActionChoice[]=[];
 const add=(id:string,action:Action)=>baseline.push({id,label:id,action});
 add('review.wait',{type:'wait',minutes:30});add('review.sleep',{type:'sleep',minutes:120});
 for(const item of ['turnip','meal','berry','fruit'] as const)add('review.eat.'+item,{type:'eat',item});
 for(let i=0;i<3;i++)add('visit.review.'+i,{type:'move',to:{x:i,y:10}});
 for(let i=0;i<8;i++)add('review.receive.'+i,{type:'publicDuty',operation:'receive',shiftId:'review-shift-'+i});
 for(let i=0;i<24;i++)add('review.respond.'+i,{type:'respond',proposalId:'review-proposal-'+i,accept:i%2===0});
 for(const focus of Object.keys(focusNames) as Focus[])add('review.reflect.'+focus,{type:'agency',operation:'reflect',focus,text:'review own goals'});
 assert.equal(baseline.length,53,'fixture reserves exactly 53 original priority choices');
 const measure:Extract<CivicMeasure,{kind:'foodReserve'}>={kind:'foodReserve',buildingId:f.hall.id,item:'turnip',quantity:30,unitPrice:2,suppliesBudget:60,dailyNutrition:60,durationDays:7};
 add('review.local-reserve',{type:'civic',operation:'propose',buildingId:f.hall.id,measure});
 for(let i=0;i<2;i++)add('review.donate.'+i,{type:'civic',operation:'donate',buildingId:f.hall.id,amount:i+1});
 for(let i=0;i<30;i++)add('review.move.'+i,{type:'move',to:{x:i%20,y:12}});
 for(let i=0;i<30;i++)add('review.construction.'+i,{type:'construction',operation:'fund',projectId:'review-project-'+i,amount:1});
 const imports:ActionChoice[]=f.w.foreignTrade!.merchants.map(m=>({id:'review.public-import.'+m.id,label:'independent public import proposal',action:{type:'civic',operation:'propose',buildingId:f.hall.id,measure:{...measure,foreignProcurement:{merchantId:m.id,handlerId:f.r.id}}}}));
 assert.equal(imports.length,3);
 const visibleMerchants=new Set<string>();let exposures=0;
 const isReflection=(c:ActionChoice)=>c.action.type==='agency'&&c.action.operation==='reflect';
 for(let tick=0;tick<99;tick++){
  context.minute=tick*30;
  const old=focusedChoices(context,baseline),next=focusedChoices(context,[...baseline,...imports]);
  assert.equal(old.length,56,'original crowded menu is full');
  assert.equal(old.filter(c=>c.action.type==='civic').length,1,'only one ordinary community slot remains');
  assert.equal(next.length,old.length,'imports cannot expand the saturated menu');
  assert.deepEqual(next.filter(c=>!isReflection(c)&&!imports.includes(c)).map(c=>c.id),old.filter(c=>!isReflection(c)).map(c=>c.id),'all original non-reflection choices and their order survive');
  const shown=next.filter(c=>imports.includes(c));assert.ok(shown.length<=1);
  if(old.some(c=>c.id==='review.local-reserve')){
   exposures++;assert.equal(shown.length,1,'a surplus reflection offers the new alternative beside the visible local template');
   const action=shown[0].action;assert.ok(action.type==='civic'&&action.operation==='propose'&&action.measure.kind==='foodReserve'&&action.measure.foreignProcurement);
   visibleMerchants.add(action.measure.foreignProcurement.merchantId);
  }else assert.equal(shown.length,0,'imports cannot bypass the original local proposal exposure');
 }
 assert.ok(exposures>3);
 assert.deepEqual([...visibleMerchants].sort(),f.w.foreignTrade!.merchants.map(m=>m.id).sort(),'same-clock rotation must not permanently hide two merchants');
});

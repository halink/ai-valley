import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import type {ForeignAction} from '../../src/shared/foreign-trade.js';
import {createWorld} from '../../src/world/seed.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {initializeForeignTrade,completeForeignTrade,advanceForeignTrade} from '../../src/world/foreign-trade.js';
import {initializeFood} from '../../src/world/food.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';
import type {DirectEatingObservation,ForeignFoodTransferReceipt} from '../../src/world/food-consumption-evidence.js';
let serial=0;
export function foreignTransferFixture(founders=false){
 const w=founders?createFrontierWorld(5401):createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.clock.realMinutesPerDay=24;
 w.map={...w.map,width:20,height:12,tiles:Array(240).fill('grass'),entrance:{x:0,y:6}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];if(!founders)w.residents=w.residents.slice(0,2);
 if(w.frontierHazards){w.frontierHazards.nextDisasterAt=Number.MAX_SAFE_INTEGER;for(const beast of w.frontierHazards.beasts){beast.nextMoveAt=Number.MAX_SAFE_INTEGER;beast.cooldownUntil=Number.MAX_SAFE_INTEGER;}}
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.homeId=null;r.inventory={turnip:8};r.parents=[];r.guardianIds=[];r.bornAt=w.minute-30*YEAR;r.hunger=25;r.energy=r.health=100;r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.plan=null;r.activity=null;r.knownBuildings=[];r.knownResources=[];r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 initializeForeignTrade(w);w.foreignTrade!.station={...w.map.entrance};initializeFood(w);const [r,other]=w.residents,m=w.foreignTrade!.merchants[0];
 const old='food/foreign-original@1';w.definitions[old]={id:'food/foreign-original',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:7}}};
 for(const person of [r,other,m.person])for(const lot of w.food!.lots['person:'+person.id].turnip!){lot.definition=old;lot.producedAt=w.minute-10;}
 for(const merchant of w.foreignTrade!.merchants)merchant.person.decisionDue=w.minute+10000;
 advanceForeignTrade(w);return {w,r,other,m};
}
export function queueForeignAction(w:World,r:Resident,wanted:ForeignAction,followWait=false){
 const choices=decisionChoices(decisionContext(w,r));const choice=choices.find(c=>c.action.type==='foreignTrade'&&c.action.operation===wanted.operation&&(!wanted.offerId||c.action.offerId===wanted.offerId)&&(!wanted.shipmentId||c.action.shipmentId===wanted.shipmentId)&&(!wanted.side||c.action.side===wanted.side)&&(!wanted.item||c.action.item===wanted.item)&&(!wanted.merchantId||c.action.merchantId===wanted.merchantId));assert.ok(choice,'foreign action must reach normal numbered menu: '+JSON.stringify(wanted));
 const action=parseChoice(JSON.stringify({choice:choice.id,...(wanted.quantity?{quantity:wanted.quantity}:{}),...(wanted.price?{price:wanted.price}:{})}),choices).actions[0];
 const result=submitPlan(w,{id:'foreign-transfer-test:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择',actions:[action,...(followWait?[{type:'wait' as const,minutes:120}]:[])]});assert.ok(result.ok,result.error);return action;
}
export function finishForeignAction(w:World,r:Resident,success=true){const observations:DirectEatingObservation[]=[];for(let i=0;r.activity||r.plan;i++){assert.ok(i<200);observations.push(stepWorldWithFoodEvidence(w,1));}if(success)assert.equal(r.lastFailure,null);return observations;}
export const foreignTransfers=(observations:DirectEatingObservation[])=>observations.flatMap(o=>o.foodTransfers??[]).filter((r):r is ForeignFoodTransferReceipt=>r.action==='foreignTrade');
export function residentProposal(f:ReturnType<typeof foreignTransferFixture>,quantity=4){const {w,r,m}=f;assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity,price:1,maximumLevyBasisPoints:0}),null);return w.foreignTrade!.offers.at(-1)!;}
export function merchantOffer(f:ReturnType<typeof foreignTransferFixture>,side:'import'|'export'='import',quantity=4){const {w,m}=f;assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'post',merchantId:m.id,side,item:'turnip',quantity,price:1}),null);const o=w.foreignTrade!.offers.at(-1)!;w.minute=o.noticeAt;advanceForeignTrade(w);return o;}
export function foreignShipmentFixture(side:'import'|'export'='import',arrived=true){const f=foreignTransferFixture(),{w,r}=f,o=merchantOffer(f,side);assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'accept',offerId:o.id,quantity:4,quotedPrice:1,maximumLevyBasisPoints:0}),null);const s=w.foreignTrade!.shipments.at(-1)!;
 if(arrived&&side==='import'){w.minute=s.arrivesAt!;advanceForeignTrade(w);assert.equal(s.status,'arrived');}
 for(const p of [...w.residents,...w.foreignTrade!.merchants.map(m=>m.person)]){p.lastDecisionAt=w.minute;p.decisionDue=w.minute+10000;}
 return {...f,o,s};}

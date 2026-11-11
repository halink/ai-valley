import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import {createWorld} from '../../src/world/seed.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {initializeForeignTrade,completeForeignTrade,advanceForeignTrade,foreignDecisionContext,applyForeignDecision} from '../../src/world/foreign-trade.js';
import {initializeOutsideAid,completeOutsideAid,advanceOutsideAid} from '../../src/world/outside-aid.js';
import {initializeFood} from '../../src/world/food.js';
import {decisionChoices,decisionContext,parseForeignReply} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {YEAR} from '../../src/world/time.js';
import type {DirectEatingObservation} from '../../src/world/food-consumption-evidence.js';

let serial=0;
/** Synthetic people and stocks; original courier, response and aid mechanisms. */
export function aidTransferFixture(quantity=4,arrived=true,founders=false){
 const w=founders?createFrontierWorld(5401):createWorld();w.mode='formal';w.clock.paused=false;w.minute=600;w.clock.realMinutesPerDay=24;
 w.map={...w.map,width:20,height:12,tiles:Array(240).fill('grass'),entrance:{x:0,y:6}};w.buildings=[];w.resources=[];w.plots=[];w.graves=[];if(!founders)w.residents=w.residents.slice(0,2);
 if(w.frontierHazards){w.frontierHazards.nextDisasterAt=Number.MAX_SAFE_INTEGER;for(const beast of w.frontierHazards.beasts){beast.nextMoveAt=Number.MAX_SAFE_INTEGER;beast.cooldownUntil=Number.MAX_SAFE_INTEGER;}}
 for(const r of w.residents){r.at={...w.map.entrance};r.inside=null;r.roomAt=null;r.homeId=null;r.inventory={};r.parents=[];r.guardianIds=[];r.bornAt=w.minute-30*YEAR;r.hunger=25;r.energy=r.health=100;r.canDecide=r.canExpress=true;r.status='alive';r.residency='resident';r.plan=null;r.activity=null;r.knownBuildings=[];r.knownResources=[];r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 const [r,other]=w.residents;other.inventory.wood=4;r.bornAt=w.minute-10*YEAR;
 initializeForeignTrade(w);w.foreignTrade!.station={...w.map.entrance};initializeOutsideAid(w);initializeFood(w);const m=w.foreignTrade!.merchants[0];
 for(const merchant of w.foreignTrade!.merchants)merchant.person.decisionDue=w.minute+10000;
 const old='food/aid-original@1';w.definitions[old]={id:'food/aid-original',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:7}}};
 for(const lot of w.food!.lots['person:'+m.id].turnip!)lot.definition=old;
 assert.equal(completeForeignTrade(w,other,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'wood',quantity:1,price:1,maximumLevyBasisPoints:0}),null);
 const offer=w.foreignTrade!.offers.at(-1)!;w.minute=offer.noticeAt;advanceForeignTrade(w);
 assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:offer.id}),null);
 const shipment=w.foreignTrade!.shipments.at(-1)!;w.minute=shipment.readyAt;
 assert.equal(completeForeignTrade(w,other,{type:'foreignTrade',operation:'dispatch',shipmentId:shipment.id}),null);
 const post=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='outsideAid'&&c.action.operation==='post');assert.ok(post);
 assert.equal(completeOutsideAid(w,r,parseChoice(JSON.stringify({choice:post.id}),[post]).actions[0] as Extract<Action,{type:'outsideAid'}>),null);
 advanceForeignTrade(w);const n=w.outsideAid!.notices[0];assert.equal(n.mail?.courierId,shipment.id);
 w.minute=shipment.arrivesAt!;advanceForeignTrade(w);assert.equal(n.mail!.receivedAt,w.minute);
 const choices=decisionChoices(foreignDecisionContext(w,m.person));
 const accept=choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='accept'&&c.action.item==='turnip'&&c.action.quantity===quantity);assert.ok(accept);
 assert.ok(applyForeignDecision(w,m.id,m.person.revision,parseForeignReply(accept.id,choices)).ok);
 const d=w.outsideAid!.deliveries[0],f={w,r,other,m,d,n};
 if(arrived)arriveAid(f);
 for(const p of [...w.residents,...w.foreignTrade!.merchants.map(m=>m.person)]){p.lastDecisionAt=w.minute;p.decisionDue=w.minute+10000;}
 return f;
}
export function arriveAid(f:ReturnType<typeof aidTransferFixture>){
 const {w,m,d}=f,choices=decisionChoices(foreignDecisionContext(w,m.person));
 const dispatch=choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='dispatch'&&c.action.deliveryId===d.id);assert.ok(dispatch);
 assert.ok(applyForeignDecision(w,m.id,m.person.revision,parseForeignReply(dispatch.id,choices)).ok);
 w.minute=d.arrivesAt!;advanceOutsideAid(w);assert.equal(d.status,'arrived');
}
export function queueAidAction(w:World,r:Resident,action:Action,followWait=false){
 const result=submitPlan(w,{id:'aid-transfer-test:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'本人选择',actions:[action,...(followWait?[{type:'wait' as const,minutes:120}]:[])]});
 assert.ok(result.ok,result.error);return r.plan!.id;
}
export function queueAidCollection(f:ReturnType<typeof aidTransferFixture>,followWait=false){
 const {w,r,d}=f,choices=decisionChoices(decisionContext(w,r));
 const choice=choices.find(c=>c.action.type==='outsideAid'&&c.action.operation==='collect'&&c.action.deliveryId===d.id);assert.ok(choice,'collection must reach the normal numbered menu');
 const action=parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0];queueAidAction(w,r,action,followWait);return action;
}
export function finishAidCollection(w:World,r:Resident,success=true){
 const observations:DirectEatingObservation[]=[];
 for(let i=0;r.activity||r.plan;i++){assert.ok(i<200);observations.push(stepWorldWithFoodEvidence(w,1));}
 if(success)assert.equal(r.lastFailure,null);return observations;
}
export const aidTransfers=(observations:DirectEatingObservation[])=>observations.flatMap(o=>o.foodTransfers??[]);

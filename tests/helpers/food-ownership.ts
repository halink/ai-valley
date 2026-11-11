import assert from 'node:assert/strict';
import type {Action,Resident,World} from '../../src/shared/types.js';
import type {Livestock,OrchardTree} from '../../src/shared/industry.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {recordDeath} from '../../src/world/life.js';
import {initializeProduction,prepareShares} from '../../src/world/production.js';
import {initializeFood,foodTransaction} from '../../src/world/food.js';
import {estateStock,estateLocation} from '../../src/world/estate-custody.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {DAY,YEAR} from '../../src/world/time.js';
import type {DirectEatingObservation} from '../../src/world/food-consumption-evidence.js';
let serial=0;
export function ownershipFixture(twoHeirs=false,identities:{parentId?:string;heirId?:string}={}){
 const w=createFrontierWorld(5401);w.minute=600;w.clock.paused=false;w.clock.realMinutesPerDay=24;w.weather='rain';
 w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=Number.MAX_SAFE_INTEGER;beast.cooldownUntil=Number.MAX_SAFE_INTEGER;}
 const home=w.buildings.find(b=>b.kind==='lodge')!,barn=w.buildings.find(b=>b.kind==='barn')!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.parents=[];r.adoptiveParents=[];r.relations=[];r.guardianIds=[];r.pregnancy=null;r.bornAt=w.minute-30*YEAR;r.inventory={};r.coins=0;r.hunger=10;r.energy=r.health=100;r.plan=null;r.activity=null;r.canDecide=r.canExpress=true;r.knownBuildings=w.buildings.map(b=>b.id);r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 const heir=w.residents[0],other=w.residents[1];if(identities.heirId)heir.id=identities.heirId;
 const parentId=identities.parentId??'ownership-parent';w.residents=w.residents.filter(r=>r.id!==parentId);
 const parent:Resident={...structuredClone(heir),id:parentId,name:'Original Owner',homeId:home.id,inventory:{meal:5,turnip:2},knownPeople:[]};w.residents.push(parent);
 for(const r of w.residents)r.knownPeople=w.residents.map(p=>p.id);
 heir.parents=[parent.id];if(twoHeirs)other.parents=[parent.id];
 const plot=w.plots[0],tree:OrchardTree={id:'ownership-tree',ownerId:parent.id,definition:'industry/processes@1',plotId:plot.id,at:{...plot.at},plantedAt:0,growth:28*DAY,lastWateredDay:0,lastMinute:w.minute,fruit:4,fruitProgress:0,status:'mature'};
 const animals:Livestock[]=(['chicken','duck','goat','cow','sheep'] as const).map((kind,index)=>({id:'ownership-'+kind,ownerId:parent.id,definition:'industry/processes@1',kind,sex:'female',bornAt:w.minute-30*DAY,barnId:barn.id,pen:index,hunger:0,thirst:0,health:100,status:'alive',deathAt:null,product:2,progress:0,pregnancy:null,lastMinute:w.minute,lactatesUntil:w.minute+10000,energy:90}));
 w.industry!.trees=[tree];w.industry!.animals=animals;
 initializeProduction(w);initializeFood(w);recordDeath(w,parent);
 foodTransaction(w,()=>{estateStock(w,parent.id,'remote-food',estateLocation({x:3,y:3}))!.fruit=3;});
 for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 return {w,heir,other,parent,tree,animals,home,barn};
}
export function splitOwnership(w:World,parentId:string){return foodTransaction(w,()=>prepareShares(w,parentId));}
export function queueOwnership(w:World,r:Resident,parentId:string,wait=false){return queueOwnershipAction(w,r,a=>a.type==='production'&&a.operation==='inherit'&&a.personId===parentId,wait);}
export function queueOwnershipAction(w:World,r:Resident,match:(a:Action)=>boolean,wait=false){
 const choices=decisionChoices(decisionContext(w,r)),choice=choices.find(c=>match(c.action));assert.ok(choice,'inheritance/collection must reach final numbered menu');assert.match(choice.id,/^\d+$/);
 const parsed=parseChoice(JSON.stringify({choice:choice.id}),choices);
 const result=submitPlan(w,{id:'food-ownership:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择',actions:[...parsed.actions,...(wait?[{type:'wait' as const,minutes:120}]:[])]});assert.equal(result.ok,true,JSON.stringify(result));return parsed.actions[0];
}
export function finishOwnership(w:World,r:Resident){const observations:DirectEatingObservation[]=[];for(let n=0;r.plan||r.activity;n++){assert.ok(n<300);observations.push(stepWorldWithFoodEvidence(w,1));}assert.equal(r.lastFailure,null);return observations;}
export const ownershipReceipts=(observations:DirectEatingObservation[])=>observations.flatMap(o=>o.foodOwnershipChanges??[]);

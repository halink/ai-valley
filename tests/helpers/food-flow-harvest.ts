import assert from 'node:assert/strict';
import {createWorld} from '../../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import {parseChoice} from '../../src/server/affordances.js';
import {initializeFood} from '../../src/world/food.js';
import {initializeIndustry} from '../../src/world/industry.js';
import {initializeProduction} from '../../src/world/production.js';
import {initializeEconomy} from '../../src/world/economy.js';
import {initializeForeignTrade} from '../../src/world/foreign-trade.js';
import {initializeRooms} from '../../src/world/rooms.js';
import {recordDeath} from '../../src/world/life.js';
import {WorldStore} from '../../src/server/store.js';
import {DAY,YEAR} from '../../src/world/time.js';
import type {GreenhouseBed} from '../../src/shared/industry.js';
import type {Action,Resident,World} from '../../src/shared/types.js';
import type {DirectEatingObservation,FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
import {atWorkstation} from './workspaces.js';
let serial=0;
export function submitHarvest(w:World,r:Resident,action:Action,followWait=false){
 const plan={id:'harvest-evidence:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人按最终编号选择实际收获',actions:[action,...(followWait?[{type:'wait' as const,minutes:120}]:[])]};
 const result=submitPlan(w,plan);assert.ok(result.ok,result.error);return plan;
}
export function harvestChoice(w:World,r:Resident,operation:string,predicate:(a:Action)=>boolean=()=>true){
 const choices=decisionChoices(decisionContext(w,r));const row=choices.find(c=>'operation' in c.action&&c.action.operation===operation&&predicate(c.action));
 assert.ok(row,'final numbered menu missing '+operation);return parseChoice(JSON.stringify({choice:row.id}),choices).actions[0];
}
export function finishHarvest(w:World,r:Resident,success=true){const observations:DirectEatingObservation[]=[];for(let n=0;r.plan||r.activity;n++){assert.ok(n<500);observations.push(stepWorldWithFoodEvidence(w,1));}if(success)assert.equal(r.lastFailure,null);return observations;}
export function harvestReceipts(observations:DirectEatingObservation[]){return observations.flatMap(o=>o.foodFlows??[]).filter((f):f is Extract<FoodFlowReceipt,{action:'harvest_house'|'custody_harvest'}>=>f.action==='harvest_house'||f.action==='custody_harvest');}
export function reloadHarvest(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load(true)!;}finally{store.close();}}
function base(){const w=createWorld();w.mode='formal';w.clock.paused=false;w.clock.realMinutesPerDay=24;const home=w.buildings.find(b=>b.id===w.residents[0].homeId)!;
 for(const r of w.residents){r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={water:8,seed:8,wood:8,stone:8,meal:5};r.coins=40;r.hunger=20;r.energy=r.health=100;r.bornAt=w.minute-30*YEAR;r.knownPeople=w.residents.map(p=>p.id);r.knownBuildings=w.buildings.map(b=>b.id);r.parents=[];r.adoptiveParents=[];r.guardianIds=[];r.relations=[];r.canDecide=r.canExpress=true;r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 initializeEconomy(w);initializeForeignTrade(w);initializeProduction(w);initializeIndustry(w);initializeRooms(w);initializeFood(w);stepWorld(w,1);for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+10000;}
 for(const merchant of w.foreignTrade?.merchants??[])merchant.person.decisionDue=w.minute+10000;for(const contact of w.migration?.contacts??[]){contact.phase='home';contact.futureAt=w.minute+10000;}
 return {w,home};}
export function houseHarvestFixture(){const {w,home}=base(),r=w.residents[0];home.kind='greenhouse';home.definition='building/greenhouse@1';
 const bed:GreenhouseBed={id:'synthetic-original-bed',buildingId:home.id,index:0,crop:{ownerId:r.id,definition:'crop/turnip@2',growth:4,wateredDay:-1,lastMinute:w.minute}};w.industry!.beds.push(bed);initializeRooms(w);
 atWorkstation(w,r,{type:'industry',operation:'harvestHouse',buildingId:home.id,bed:0});return {w,r,home,bed};}
export function custodyHarvestFixture(){const {w,home}=base(),[dead,child,provider]=w.residents;const reviewer=w.residents[3]??{...structuredClone(provider),id:'reviewer',name:'独立复核人',homeId:null},buyer=w.residents[4]??{...structuredClone(provider),id:'buyer',name:'购买人',homeId:null};if(!w.residents.includes(reviewer))w.residents.push(reviewer,buyer);for(const r of w.residents)r.knownPeople=w.residents.map(p=>p.id);
 child.bornAt=w.minute-10*YEAR;child.parents=[dead.id];child.homeId=home.id;home.residents.push(child.id);home.condition=70;
 w.resources=[];w.plots=[{id:'synthetic-protected-field',at:{...home.door},ownerId:dead.id,crop:{definition:'crop/turnip@2',planted:w.minute-5*DAY,growth:4,wateredDay:-1,lastGrowthDay:Math.floor(w.minute/DAY)}}];recordDeath(w,dead);
 const run=(r:Resident,op:string,predicate?:(a:Action)=>boolean)=>{submitHarvest(w,r,harvestChoice(w,r,op,predicate));finishHarvest(w,r);};
 run(provider,'custodyOffer',a=>a.type==='production'&&a.reviewerId===reviewer.id);run(child,'custodyAccept');run(reviewer,'custodyReview');
 const c=w.production!.protectedCustody!.mandates[0];assert.equal(c.status,'active');const share=w.production!.inheritances[dead.id].shares.find(s=>s.heirId===child.id)!;return {w,r:provider,provider,child,reviewer,buyer,dead,home,plot:w.plots[0],c,share};}
export function queueHarvest(f:ReturnType<typeof houseHarvestFixture>|ReturnType<typeof custodyHarvestFixture>,followWait=false){for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+10000;}return submitHarvest(f.w,f.r,harvestChoice(f.w,f.r,'bed' in f?'harvestHouse':'custodyHarvest'),followWait);}

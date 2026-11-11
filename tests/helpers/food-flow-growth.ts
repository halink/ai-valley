import assert from 'node:assert/strict';
import {parseChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import type {IndustryAction,Livestock,OrchardTree} from '../../src/shared/industry.js';
import type {Resident,World} from '../../src/shared/types.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import type {FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
import {initializeFood} from '../../src/world/food.js';
import {DAY} from '../../src/world/time.js';

/** Entirely synthetic seeded assets, one minute before actual engine generation. */
export function growthFlowFixture(minute=DAY-1){
 const w=createFrontierWorld();w.minute=minute;w.clock.paused=false;w.weather='rain';
 w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=minute+10000;beast.cooldownUntil=minute+10000;}
 for(const r of w.residents){r.hunger=10;r.health=r.energy=100;r.lastDecisionAt=minute;r.decisionDue=minute+10000;}
 const r=w.residents.find(r=>r.id==='founder-1-1')!,barn=w.buildings.find(b=>b.kind==='barn')!,plot=w.plots.find(p=>p.ownerId===r.id)!;
 const tree:OrchardTree={definition:'industry/processes@1',id:'growth-tree',ownerId:r.id,plotId:plot.id,at:{...plot.at},
  plantedAt:0,growth:28*DAY,lastWateredDay:Math.floor((minute+1)/DAY),lastMinute:minute,fruit:0,fruitProgress:DAY-1,status:'mature'};
 w.industry!.trees=[tree];
 const animals:Livestock[]=(['chicken','duck','goat','cow','sheep'] as const).map((kind,i)=>({
  definition:'industry/processes@1',id:'growth-'+kind,ownerId:r.id,kind,sex:'female',bornAt:minute-30*DAY,barnId:barn.id,
  pen:i,hunger:0,thirst:0,health:100,status:'alive',deathAt:null,product:0,progress:(kind==='sheep'?3:kind==='cow'?2:1)*DAY-1,
  pregnancy:null,lastMinute:minute,lactatesUntil:minute+10000,energy:90}));
 w.industry!.animals=animals;initializeFood(w);
 return {w,r,barn,tree,animals};
}
let serial=0;
export function queueGrowthCollection(w:World,r:Resident,operation:'harvestFruit'|'collectAnimal',sourceId:string){
 const choices=decisionChoices(decisionContext(w,r)),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation===operation&&
  (operation==='harvestFruit'?c.action.treeId===sourceId:c.action.animalId===sourceId));
 assert.ok(choice,operation+' must reach the normal final numbered menu');
 const actions=parseChoice(JSON.stringify({choice:choice.id}),choices).actions;
 assert.equal((actions[0] as IndustryAction).operation,operation);
 const submitted=submitPlan(w,{id:'growth-collection:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'Offline natural food collection',actions});
 assert.ok(submitted.ok,submitted.error);
}
export function finishGrowthCollection(w:World,r:Resident){
 const flows:FoodFlowReceipt[]=[];let limit=500;
 while(r.plan||r.activity){assert.ok(limit--,'collection must finish');flows.push(...stepWorldWithFoodEvidence(w,1).foodFlows!);}
 assert.equal(r.lastFailure,null);return flows;
}

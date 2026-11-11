import assert from 'node:assert/strict';
import {parseChoice,type ActionChoice} from '../../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../../src/server/decisions.js';
import type {CraftRecipe,IndustryAction} from '../../src/shared/industry.js';
import type {Resident,World} from '../../src/shared/types.js';
import {stepWorldWithFoodEvidence,submitPlan} from '../../src/world/engine.js';
import {createFrontierWorld} from '../../src/world/formal-seed.js';
import {initializeFood} from '../../src/world/food.js';
import type {DirectEatingObservation,FoodFlowReceipt} from '../../src/world/food-consumption-evidence.js';
import {recipeById} from '../../src/world/industry-content.js';

/** Synthetic inputs and workstations, not claims about the unmodified opening. */
export function craftFlowFixture(recipeId='gameMeal'){
 const w=createFrontierWorld(5401),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 w.clock.paused=false;w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts){beast.nextMoveAt=w.minute+10000;beast.cooldownUntil=w.minute+10000;}
 for(const actor of w.residents){actor.hunger=20;actor.energy=actor.health=100;actor.lastDecisionAt=w.minute;actor.decisionDue=w.minute+10000;}
 const recipe=structuredClone(recipeById(recipeId)!);assert.ok(recipe);
 r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={...recipe.input};
 r.skills[recipe.skill]=Math.max(r.skills[recipe.skill],recipe.minimum);
 if(recipe.station)w.industry!.stations.push({id:'craft-fixture:'+recipe.station,buildingId:home.id,kind:recipe.station,installedAt:w.minute});
 initializeFood(w);decisionContext(w,r);return {w,r,home,recipe};
}
let serial=0;
export function craftChoices(w:World,r:Resident){return decisionChoices(decisionContext(w,r));}
export function submitCraftChoice(w:World,r:Resident,choices:ActionChoice[],choice:ActionChoice,minutes:number){
 const parsed=parseChoice(JSON.stringify({choice:choice.id,minutes}),choices);
 const result=submitPlan(w,{id:'craft-evidence:'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:parsed.intention,actions:parsed.actions});
 assert.ok(result.ok,result.error);return parsed.actions[0];
}
export function finishCraftFlow(w:World,r:Resident,expectSuccess=true){
 const observations:DirectEatingObservation[]=[];let limit=500;
 while(r.plan||r.activity){assert.ok(limit--,'craft action should finish');observations.push(stepWorldWithFoodEvidence(w,1));}
 if(expectSuccess)assert.equal(r.lastFailure,null);return observations;
}
export function queueCraftFlow(w:World,r:Resident,recipeId='gameMeal',minutes=60){
 const choices=craftChoices(w,r),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId===recipeId);
 assert.ok(choice,recipeId+' must reach the final numbered menu');
 return submitCraftChoice(w,r,choices,choice,minutes) as IndustryAction;
}
export function runCraftFlow(w:World,r:Resident,recipeId='gameMeal',minutes=60){
 const observations:DirectEatingObservation[]=[];
 for(let attempt=0;attempt<40;attempt++){
  const choices=craftChoices(w,r),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId===recipeId);
  const selected=choice??choices.find(c=>c.action.type==='wait')!;assert.ok(selected);
  submitCraftChoice(w,r,choices,selected,choice?minutes:20);observations.push(...finishCraftFlow(w,r));
  if(choice)return observations;
 }
 throw new Error('No final numbered craft choice for '+recipeId);
}
export function craftReceipts(observations:DirectEatingObservation[]){return observations.flatMap(o=>o.foodFlows??[]).filter((f):f is Extract<FoodFlowReceipt,{action:'industry_craft'}>=>f.action==='industry_craft');}
export function recipeSnapshot(recipe:CraftRecipe){const {name:_,...snapshot}=recipe;return snapshot;}

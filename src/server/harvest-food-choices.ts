import {goods} from '../shared/items.js';
import type {Action,DecisionContext,Item,Resident,World} from '../shared/types.js';
import {SURVIVAL_FORECAST_MINUTES,needHealthDrain} from '../world/decision-protection.js';
import {stepWorld,submitPlan} from '../world/engine.js';
import {captureDirectEating,directEatingOriginalInputs} from '../world/food-consumption-evidence.js';
import {copyForSimulation} from '../world/simulation-copy.js';
import type {ActionChoice} from './affordances.js';
import {directFoodChoices} from './direct-food-choices.js';

function edibleCropOutput(w:World,plotId:string):Item|undefined {
 const crop=w.plots.find(p=>p.id===plotId)?.crop,item=((crop&&w.definitions[crop.definition]?.data.output)??'turnip') as Item;
 return crop&&Object.hasOwn(goods,item)&&goods[item].food>0?item:undefined;
}

/** Cheap negative checks run before building any menu for this preview. They
 * do not prove safety, replace ordinary eligibility filters, or choose food. */
export function harvestMealRelevant(w:World,r:Resident,c:DecisionContext):boolean {
 return !!c.formal&&!r.plan&&!r.activity&&!!(c.actor.hunger>=80||c.formal.foodCoverage?.lowFood)
  &&c.plots.some(p=>p.ownerId===r.id&&p.observed?.stage==='mature'&&edibleCropOutput(w,p.id)!==undefined);
}

/** Snapshot-only evidence for the existing, already filtered harvest menu.
 * The real world, its decisions, and its stock remain untouched. Other actors'
 * committed actions and all ordinary physical checks continue in the copy. */
export function harvestMealEvidence(w:World,r:Resident,c:DecisionContext,all:ActionChoice[],visible?:ActionChoice[]):NonNullable<NonNullable<DecisionContext['formal']>['harvestMeals']>|undefined {
 if(!harvestMealRelevant(w,r,c))return;
 const candidates=new Map<string,Action>();
 for(const {action} of all)if(action.type==='harvest'&&c.plots.some(p=>p.id===action.plotId&&p.ownerId===r.id&&p.observed?.stage==='mature')&&edibleCropOutput(w,action.plotId)!==undefined)candidates.set(action.plotId,action);
 if(!candidates.size)return;
 // No proof is needed when nothing could be restored. Compare plot identity,
 // not the final menu's renumbered IDs. If even one candidate is missing, keep
 // proving ALL candidates: a visible valid chain suppresses an added one,
 // whereas a visible but invalid chain must not hide a missing valid chain.
 if(visible&&[...candidates.keys()].every(id=>visible.some(c=>c.action.type==='harvest'&&c.action.plotId===id)))return;
 const plots:Array<{plotId:string;minutes:number}>=[];
 for(const [plotId,action] of [...candidates].sort(([a],[b])=>a.localeCompare(b))){
  const item=edibleCropOutput(w,plotId)!;
  const copy=copyForSimulation(w),person=copy.residents.find(p=>p.id===r.id)!;
  copy.clock.paused=false;delete person.decisionProtection;
  const prefix=`harvest-meal-preview:${w.revision}:${r.id}:${plotId}`,harvestId=prefix+':harvest',mealId=prefix+':meal';
  const submit=(a:Action,id:string)=>submitPlan(copy,{id,actorId:person.id,actorRevision:person.revision,createdAt:copy.minute,definition:copy.activeDefinitions['action/routine'],intention:'',actions:[a]}).ok;
  let mealStarted=false,completedAt:number|undefined;
  const observation=captureDirectEating(copy,()=>{
   if(!submit(action,harvestId))return;
   for(let minute=1;minute<=SURVIVAL_FORECAST_MINUTES;minute++){
    stepWorld(copy,1);
    if(person.status!=='alive'||person.health<=0||!person.canDecide||!person.canExpress||person.lastFailure)break;
    if(person.plan||person.activity)continue;
    if(mealStarted){const drain=needHealthDrain(copy,person);if(drain.hunger+drain.exhaustion===0)completedAt=copy.minute;break;}
    const ownMeals=directFoodChoices({...c,minute:copy.minute,actor:{...c.actor,inventory:person.inventory}});
    if(copy.plots.find(p=>p.id===plotId)?.crop!==null||!ownMeals.some(choice=>choice.action.type==='eat'&&choice.action.item===item)||!submit({type:'eat',item},mealId))break;
    mealStarted=true;
   }
  });
  if(completedAt===undefined)continue;
  // A separate feeding or treatment must not masquerade as this person's
  // independently executable harvest/meal. Existing actions still ran above.
  const assisted=[...(observation.careMeals??[]),...(observation.childCareMeals??[]),...(observation.emergencyCareMeals??[]),...(observation.longCareMeals??[]),...(observation.publicDutyMeals??[]),...(observation.journeyMeals??[]),...(observation.familyJourneyMeals??[])]
   .some(receipt=>receipt.beneficiaryId===r.id);
  if(assisted||observation.receipts.some(receipt=>receipt.residentId===r.id&&receipt.planId!==mealId))continue;
  const meal=observation.receipts.find(receipt=>receipt.residentId===r.id&&receipt.planId===mealId&&receipt.item===item&&receipt.nutrition>0&&receipt.hungerRelief>0);
  const harvest=observation.foodFlows?.find(flow=>flow.action==='harvest'&&flow.residentId===r.id&&flow.planId===harvestId&&flow.sourceId===plotId);
  if(!meal||!harvest||!('outputs'in harvest))continue;
  // Edible output must really have been produced and still be edible at the
  // meal, not a nonfood crop or an old carried meal masking a failed harvest.
  const output=harvest.outputs.find(output=>output.item===item);
  if(!output||!(output.nutrition!==null&&output.nutrition>0)||(output.lots??[]).filter(lot=>lot.expiresAt>meal.at&&lot.nutrition!==null&&lot.nutrition>0).reduce((sum,lot)=>sum+lot.quantity,0)<1)continue;
  const inputs=directEatingOriginalInputs(meal),consumed=inputs?.find(input=>input.item===item);
  if(!consumed?.lots||consumed.quantity!==1||consumed.nutrition===null||Math.abs(consumed.nutrition-meal.nutrition)>1e-9)continue;
  const identity=(lot:{definition:string;producedAt:number;expiresAt:number})=>JSON.stringify([lot.definition,lot.producedAt,lot.expiresAt]);
  const available=new Map<string,number>();for(const lot of output.lots??[])available.set(identity(lot),(available.get(identity(lot))??0)+lot.quantity);
  let exact=true;for(const lot of consumed.lots){const key=identity(lot),left=(available.get(key)??0)-lot.quantity;if(left< -1e-9||lot.nutrition===null||lot.nutrition<=0){exact=false;break;}available.set(key,left);}
  if(!exact)continue;
  plots.push({plotId,minutes:completedAt-w.minute});
 }
 return {atMinute:c.minute,plots:plots.sort((a,b)=>a.minutes-b.minutes||a.plotId.localeCompare(b.plotId))};
}

/** Preserve one proved chain inside the existing ordinary budget. Never use
 * an old snapshot or restore a candidate removed by age/journey filtering.
 * A fully protected agenda remains full; no safety/control row is displaced. */
export function restoreHarvestMeal(c:DecisionContext,all:ActionChoice[],choices:ActionChoice[],limit:number):ActionChoice[]{
 const evidence=c.formal?.harvestMeals;if(!evidence||evidence.atMinute!==c.minute)return choices;
 const available=evidence.plots.map(proof=>({proof,choice:all.find(choice=>choice.action.type==='harvest'&&choice.action.plotId===proof.plotId)}))
  .filter((row):row is {proof:{plotId:string;minutes:number};choice:ActionChoice}=>!!row.choice&&Number.isFinite(row.proof.minutes)&&row.proof.minutes>0&&row.proof.minutes<=SURVIVAL_FORECAST_MINUTES)
  .sort((a,b)=>a.proof.minutes-b.proof.minutes||a.proof.plotId.localeCompare(b.proof.plotId));
 if(available.some(({choice})=>choices.some(c=>c.action.type==='harvest'&&choice.action.type==='harvest'&&c.action.plotId===choice.action.plotId)))return choices;
 const selected=available[0]?.choice;if(!selected)return choices;
 if(choices.length<limit)return [...choices,selected];
 const reflections=choices.map((choice,index)=>({choice,index})).filter(({choice})=>choice.action.type==='agency'&&choice.action.operation==='reflect');
 const replacement=reflections.length>1?reflections.at(-1)!.index:choices.map((choice,index)=>({choice,index})).filter(({choice})=>choice.action.type==='agency'&&choice.action.operation==='arm'||choice.action.type==='design'&&choice.action.operation==='draw').at(-1)?.index;
 if(replacement===undefined)return choices;
 const result=[...choices];result[replacement]=selected;return result;
}

import type {Inventory,World} from '../shared/types.js';
import type {EmploymentContract,EmploymentPost} from '../shared/employment.js';
import type {CraftRecipe} from '../shared/industry.js';
import {industryRecipe,validCraftRecipe} from './industry-definitions.js';

type PromiseRecipe=Pick<EmploymentPost,'recipe'|'recipeDefinition'>;
/** A bound historical definition, never today's active recipe, is the signed promise. */
export function promisedEmploymentRecipe(w:World,c:PromiseRecipe):CraftRecipe|undefined {
 if(c.recipeDefinition){
  const d=w.definitions[c.recipeDefinition],id=c.recipe?.id??(d?.data as Partial<CraftRecipe>|undefined)?.id;
  const recipe=industryRecipe(w,id,c.recipeDefinition)?.recipe;
  // The former initializer could bind an already damaged snapshot. A historical
  // key alone cannot certify such a zeroed input as the original agreement.
  return recipe&&Object.values(recipe.input).every(n=>n!>0)?recipe:undefined;
 }
 // Older unbound snapshots remain usable only when structurally intact. A zeroed
 // input can be evidence of the old alias bug; do not certify it as a new recipe.
 return validCraftRecipe(c.recipe)&&Object.values(c.recipe.input).every(n=>n!>0)?c.recipe:undefined;
}
/** Old live objects may still share references even before serialization. */
export function isolateEmploymentBatch(c:EmploymentContract):void {
 if(!c.batch)return;
 if(c.batch.inventory===c.recipe?.input)c.batch.inventory=structuredClone(c.batch.inventory);
 if(c.batch.output===c.recipe?.output)c.batch.output=structuredClone(c.batch.output);
}
function sameStock(a:Inventory,b:Inventory):boolean {
 return [...new Set([...Object.keys(a),...Object.keys(b)])].every(key=>{
  const n=a[key as keyof Inventory]??0,m=b[key as keyof Inventory]??0;
  return Number.isFinite(n)&&n>=0&&n===m;
 });
}
/** Physical ingredients and the unfinished output must still match the promise. */
export function employmentBatchIntact(w:World,c:EmploymentContract):boolean {
 const recipe=promisedEmploymentRecipe(w,c),batch=c.batch;
 return !!recipe&&!!batch&&!!batch.inventory&&!!batch.output&&sameStock(batch.inventory,recipe.input)
  &&sameStock(batch.output,recipe.output)&&batch.minutes===recipe.minutes
  &&Number.isFinite(batch.progress)&&batch.progress>=0&&batch.progress<=batch.minutes;
}

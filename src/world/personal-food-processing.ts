import type {Inventory,Resident,World} from '../shared/types.js';
import type {PersonalFoodProcessing} from '../shared/personal-food-processing.js';
import {goods,itemKeys} from '../shared/items.js';
import {currentPremisesLease} from '../shared/premises.js';
import {canInspectBuilding} from './building-knowledge.js';

const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
/** Missing/malformed evidence stays unknown. Never initialize or repair it. */
function inventory(value:unknown):Inventory|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const entries=Object.entries(value);
 if(entries.some(([i,n])=>!itemKeys.includes(i as typeof itemKeys[number])||!finite(n)))return null;
 return Object.fromEntries(entries) as Inventory;
}
export function personalFoodProcessing(w:World,r:Resident):PersonalFoodProcessing {
 const result:PersonalFoodProcessing={residentId:r.id,atMinute:w.minute,rawIngredients:[],current:null};
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return result;
 result.rawIngredients=itemKeys.filter(i=>goods[i].life>0&&goods[i].food===0&&finite(r.inventory[i])&&r.inventory[i]!>0);
 // Execution resumes the first owned working batch, never a nearby stranger's.
 const batch=w.industry?.batches.find(b=>b.ownerId===r.id&&b.status==='working');
 if(!batch)return result;
 const b=w.buildings.find(b=>b.id===batch.buildingId);
 if(!b||!r.knownBuildings.includes(b.id)||!canInspectBuilding(w,r,b)||
  !(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id)||currentPremisesLease(w,b.id)?.tenantId===r.id))return result;
 const recipe=batch.recipe,required=inventory(recipe?.input),output=inventory(recipe?.output);
 if(![...Object.keys(required??{}),...Object.keys(output??{})].some(i=>goods[i as keyof typeof goods].life>0))return result;
 const minutes=finite(recipe?.minutes)&&recipe.minutes>0?recipe.minutes:null;
 const worked=finite(batch.worked)&&(minutes===null||batch.worked<=minutes)?batch.worked:null;
 result.current={batchId:batch.id,buildingId:b.id,buildingName:b.name,recipeId:recipe?.id??'',recipeName:recipe?.name??'原食物加工',
  required,reserved:inventory(batch.input),output,worked,minutes,remaining:worked!==null&&minutes!==null?minutes-worked:null};
 return result;
}

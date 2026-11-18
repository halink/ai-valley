import type {Item,Resident,World} from '../shared/types.js';
import {goods,itemKeys} from '../shared/items.js';
import {CULTIVARS,cultivarKeys} from '../shared/mvp-agriculture.js';
import {physiologyDefaults} from '../shared/physiology.js';
import {foodValue} from '../world/food.js';
import {canSow} from '../world/mvp-agriculture.js';

/** Rule preference only. No inventory reservation, ownership change or engine cap. */
export function mvpSeedRootReserve(w:World,r:Resident):Partial<Record<Item,number>> {
 const reserved:Partial<Record<Item,number>>={};
 if(r.hunger>=80)return reserved;
 if((r.inventory.seed??0)<1&&(r.inventory.turnip??0)>=1)reserved.turnip=1;
 if(!w.mvpAgriculture)return reserved;
 const plots=w.plots.filter(p=>p.ownerId===r.id).length,goal=plots>0?plots+1:0;
 for(const c of cultivarKeys)if(canSow(w,c)){
  const d=CULTIVARS[c],missing=Math.max(0,goal-(r.inventory[d.seed]??0));
  const roots=Math.min(Math.floor(r.inventory[d.root]??0),Math.ceil(missing/2));
  if(roots>0)reserved[d.root]=roots;
 }
 return reserved;
}
export function mvpEdibleQuantity(w:World,r:Resident,item:Item):number {
 const held=r.inventory[item]??0;if(!Number.isFinite(held)||held<0)throw Error('mvp_buffer_invalid_inventory');
 return goods[item].food>0?Math.max(0,Math.floor(held)-(mvpSeedRootReserve(w,r)[item]??0)):0;
}
/** No concrete lot is reserved. Count the least-nutritious available quantity
 * after a seed-root reservation, so no possible choice of roots double-counts
 * high-value batches as both future seed input and food. Ordinary unreserved
 * food still uses the engine's actual FEFO foodValue. */
function availableNutrition(w:World,r:Resident,item:Item,quantity:number,reserve:number):number {
 const lots=w.food?.lots['person:'+r.id]?.[item];
 if(lots!==undefined){
  if(!Array.isArray(lots))throw Error('mvp_buffer_invalid_food_lot');
  for(const lot of lots){
   const values=w.definitions[lot.definition]?.data.nutrition as Record<string,unknown>|undefined;
   const value=values&&Object.hasOwn(values,item)?values[item]:goods[item].food;
   if(!Number.isFinite(lot.quantity)||lot.quantity<0||!Number.isFinite(lot.producedAt)||!Number.isFinite(lot.expiresAt)||typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('mvp_buffer_invalid_food_lot');
  }
 }
 if(!reserve||!lots?.length)return foodValue(w,'person:'+r.id,item,quantity);
 let remaining=Math.floor(r.inventory[item]??0);
 const portions:Array<{quantity:number;nutrition:number}>=[];
 for(const lot of [...lots].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt)){
  const nutrition=(w.definitions[lot.definition]?.data.nutrition as Record<string,number>|undefined)?.[item]??goods[item].food;
  if(!Number.isFinite(lot.quantity)||lot.quantity<0||!Number.isFinite(nutrition)||nutrition<0)throw Error('mvp_buffer_invalid_food_lot');
  const take=Math.min(remaining,lot.quantity);if(take>0)portions.push({quantity:take,nutrition});remaining-=take;if(remaining<=0)break;
 }
 if(remaining>0)portions.push({quantity:remaining,nutrition:goods[item].food});
 let result=0,left=quantity;for(const p of portions.sort((a,b)=>a.nutrition-b.nutrition)){const take=Math.min(left,p.quantity);result+=take*p.nutrition;left-=take;if(left<=0)break;}
 return result;
}
/** Pure projection: physiology() lazily registers definitions, so do not call it here. */
export function mvpNutritionBuffer(w:World,r:Resident){
 const binding=r.physiologyDefinition??'life/physiology@1',definition=w.definitions[binding];
 if(definition&&(definition.id!=='life/physiology'||definition.kind!=='life')||!definition&&binding!=='life/physiology@1')throw Error('mvp_buffer_invalid_physiology');
 if(definition&&(!definition.data||typeof definition.data!=='object'))throw Error('mvp_buffer_invalid_physiology');
 const rate=definition&&Object.hasOwn(definition.data,'hungerPerMinute')?definition.data.hungerPerMinute:physiologyDefaults.hungerPerMinute;
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<0)throw Error('mvp_buffer_invalid_demand');
 const reserved=mvpSeedRootReserve(w,r),items:Partial<Record<Item,{quantity:number;nutrition:number}>>={};let onhand=0;
 for(const item of itemKeys){const quantity=mvpEdibleQuantity(w,r,item);if(!quantity)continue;
  const nutrition=availableNutrition(w,r,item,quantity,reserved[item]??0);if(!Number.isFinite(nutrition)||nutrition<0)throw Error('mvp_buffer_invalid_nutrition');
  items[item]={quantity,nutrition};onhand+=nutrition;
 }
 const dailyDemand=rate*1440,target=dailyDemand*2;
 if(!Number.isFinite(onhand)||!Number.isFinite(target))throw Error('mvp_buffer_overflow');
 return {actorId:r.id,policy:'nominal-two-day-buffer' as const,dailyDemand,target,onhand,deficit:Math.max(0,target-onhand),nominalDays:dailyDemand>0?onhand/dailyDemand:null,reservedRoots:reserved,items};
}

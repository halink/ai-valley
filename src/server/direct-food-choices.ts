import {goods,itemKeys,itemLabels} from '../shared/items.js';
import type {DecisionContext} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

export const MAX_DIRECT_EAT_CHOICES=4;
export const MAX_COOK_CHOICES=1;

/** Rotate the complete carried-food vocabulary BEFORE the basic menu cap.
 * Only personal counts are inspected: hidden lots, expiry, other people's
 * stock, hunger and desired outcomes never select a candidate. */
export function directFoodChoices(c:DecisionContext):ActionChoice[]{
 const foods=itemKeys.filter(item=>goods[item].food>0&&(c.actor.inventory[item]??0)>=1);
 const offset=foods.length>MAX_DIRECT_EAT_CHOICES?Math.floor(c.minute/30)%foods.length:0;
 return Array.from({length:Math.min(MAX_DIRECT_EAT_CHOICES,foods.length)},(_,i)=>{
  const item=foods[(offset+i)%foods.length];
  return {id:`eat.${item}`,label:`吃1份自有${itemLabels[item]}`,action:{type:'eat',item}};
 });
}

/** Includes already validated rented kitchens. Do not re-rank by private
 * room state or resource information that was not supplied to this context. */
export function cookingChoices(c:DecisionContext,all:ActionChoice[]):ActionChoice[]{
 const candidates=all.filter(choice=>choice.action.type==='cook').sort((a,b)=>a.id.localeCompare(b.id));
 if(!candidates.length)return [];
 const offset=Math.floor(c.minute/30)%candidates.length;
 return Array.from({length:Math.min(MAX_COOK_CHOICES,candidates.length)},(_,i)=>candidates[(offset+i)%candidates.length]);
}

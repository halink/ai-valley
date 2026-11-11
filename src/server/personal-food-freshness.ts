import type {DecisionContext} from '../shared/types.js';
import {goods,itemKeys} from '../shared/items.js';
import type {ActionChoice} from './affordances.js';

export const MAX_PERSONAL_FOOD_ITEMS=8;
/** Preserve facts for current eat choices first, then the soonest known expiry.
 * This orders an observation, never the action menu or the resident's choice. */
export function personalFoodFreshnessNote(c:DecisionContext,choices:ActionChoice[]):string {
 const view=c.formal?.personalFoodFreshness;
 if(!view||view.residentId!==c.actor.id||view.atMinute!==c.minute)return '';
 const heading=`本人随身食品时效（第${view.atMinute}游戏分钟核对，至多${MAX_PERSONAL_FOOD_ITEMS}种）：`;
 if(!view.items.length)return heading+'没有持有可直接食用的食品；未计他人或公共库存。';
 const selected=new Set(choices.flatMap(c=>c.action.type==='eat'?[c.action.item]:[]));
 const rows=[...view.items].sort((a,b)=>Number(selected.has(b.item))-Number(selected.has(a.item))||(a.earliest?.expiresAt??Infinity)-(b.earliest?.expiresAt??Infinity)||itemKeys.indexOf(a.item)-itemKeys.indexOf(b.item)).slice(0,MAX_PERSONAL_FOOD_ITEMS);
 const nutrition=(n:number|null)=>n===null?'营养未能确认':`合计营养${n}`;
 const descriptions=rows.map(row=>{
  const parts=[`${goods[row.item].name}：持有${row.quantity}份`];
  if(row.earliest){const e=row.earliest;parts.push(`最早到期部分${e.quantity}份（第${e.expiresAt}游戏分钟到期，尚余${e.expiresAt-view.atMinute}游戏分钟；${nutrition(e.nutrition)}）`);}
  if(row.later.quantity)parts.push(`更晚到期${row.later.quantity}份（${nutrition(row.later.nutrition)}，后续时点未展开）`);
  if(row.expiredQuantity)parts.push(`已到期${row.expiredQuantity}份，不计新鲜口粮`);
  if(row.unknownQuantity)parts.push(`时效未知${row.unknownQuantity}份，未当作新鲜`);
  return parts.join('；');
 });
 return heading+descriptions.join('。')+'。'+(view.items.length>rows.length?`另有${view.items.length-rows.length}种本人食品未在本次摘要展开。`:'')+'仅按已有批次登记说明，不补造未知保质期；到期前仍需完成实际进食，营养不是本次饥饿必降值。是否及先吃什么由本人选择，不会自动进食。';
}

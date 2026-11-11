import type {DecisionContext,Inventory} from '../shared/types.js';
import type {PersonalFoodProcessing} from '../shared/personal-food-processing.js';
import type {CraftRecipe} from '../shared/industry.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';

/** Only display precision is rounded; stored and executed work is unchanged. */
const number=(n:number)=>String(Math.round(n*1e6)/1e6);
export function processingStock(bag:Inventory|null):string {
 if(bag===null)return '记录缺失，未确认';
 const rows=itemKeys.filter(i=>(bag[i]??0)>0);
 return rows.slice(0,8).map(i=>`${number(bag[i]!)}份${itemLabels[i]}`).join('、')+(rows.length>8?`，另${rows.length-8}种未展开`:'')||'无';
}
export function processingProgress(row:NonNullable<PersonalFoodProcessing['current']>):string {
 return `已实际劳动${row.worked===null?'未知':number(row.worked)}分钟 / 总需${row.minutes===null?'未知':number(row.minutes)}分钟；尚需${row.remaining===null?'未知':number(row.remaining)}分钟实际劳动`;
}
export function newFoodProcessingLabel(name:string,recipe:CraftRecipe):string {
 return `在${name}新开工${recipe.name}：需从本人随身投入${processingStock(recipe.input)}；累计${recipe.minutes}分钟实际劳动后产出${processingStock(recipe.output)}，尚未入库。本次默认最多工作60分钟（可填minutes 1–120），路程另计`;
}
export function continueFoodProcessingLabel(row:NonNullable<PersonalFoodProcessing['current']>):string {
 return `在${row.buildingName}继续本人原批次${row.recipeName}：${processingProgress(row)}；原配方投入${processingStock(row.required)}，原批次现留${processingStock(row.reserved)}；完工产出${processingStock(row.output)}，尚未入库。不重新扣一份原料；本次默认最多工作60分钟（可填minutes 1–120），路程另计`;
}
export function personalFoodProcessingNote(c:DecisionContext):string {
 const view=c.formal?.personalFoodProcessing;
 if(!view||view.residentId!==c.actor.id||view.atMinute!==c.minute)return '';
 const row=view.current,parts:string[]=[];
 if(row)parts.push(`本人现场未完食物加工（第${view.atMinute}游戏分钟核对）：${row.buildingName}的${row.recipeName}；${processingProgress(row)}。原配方投入${processingStock(row.required)}；原批次现留${processingStock(row.reserved)}，已离开随身库存，不是新的开工成本。按原批次配方完工产出${processingStock(row.output)}，尚未入库；是否继续由本人决定，仍须现场权限、工位与原料有效。`);
 const ingredients=[...new Set([...view.rawIngredients,...itemKeys.filter(i=>(row?.required?.[i]??0)>0||(row?.output?.[i]??0)>0)])].filter(i=>goods[i].life>0);
 if(ingredients.length)parts.push('可识别食品规则：'+ingredients.slice(0,8).map(i=>`${itemLabels[i]}${goods[i].food>0?'可直接进食':'不能直接进食，须加工'}`).join('；')+'。规则不证明现物新鲜；未完成产出不算口粮，不推算其批次保质期或营养。');
 return parts.join('\n');
}

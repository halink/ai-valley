import {cultivarKeys,type Cultivar} from './mvp-agriculture.js';

// v1 records the actual completed agriculture recipe, not an inference from stock.
export const AGRICULTURE_MEAL_RECIPE={roots:2,water:1,meal:1} as const;
export type MvpMealFact =
 | ({schemaVersion:1;kind:'cooked';cultivar:Cultivar}&typeof AGRICULTURE_MEAL_RECIPE)
 | {schemaVersion:1;kind:'ate';meal:1};
type RecordShape=Record<string,unknown>;
function exact(value:RecordShape,keys:readonly string[]):boolean {
 return Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
export function readMvpMealFact(input:unknown):MvpMealFact|null {
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const x=input as RecordShape;
 if(x.schemaVersion!==1)return null;
 if(x.kind==='ate'&&exact(x,['schemaVersion','kind','meal'])&&x.meal===1)return {schemaVersion:1,kind:'ate',meal:1};
 if(x.kind!=='cooked'||!exact(x,['schemaVersion','kind','cultivar','roots','water','meal'])||
  typeof x.cultivar!=='string'||!cultivarKeys.includes(x.cultivar as Cultivar)||
  x.roots!==AGRICULTURE_MEAL_RECIPE.roots||x.water!==AGRICULTURE_MEAL_RECIPE.water||x.meal!==AGRICULTURE_MEAL_RECIPE.meal)return null;
 return {schemaVersion:1,kind:'cooked',cultivar:x.cultivar as Cultivar,...AGRICULTURE_MEAL_RECIPE};
}

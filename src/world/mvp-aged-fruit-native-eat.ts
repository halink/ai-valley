import type {Action,Resident,World} from '../shared/types.js';
import {goods} from '../shared/items.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {mvpThirst} from './mvp-drinking.js';
import {mvpDiningPlace} from './mvp-rooms.js';
import {same} from './navigation.js';

export interface NativeAgedEatSelection {readonly residentId:string;readonly effectId:string;readonly expiresUs:string}
interface NativeAgedEatCompletion {
 readonly residentId:string;readonly planId:string;readonly startedUs:string;readonly settledUs:string;
 readonly hungerBefore:number;readonly hungerAfter:number;readonly nutrition:number;readonly workMinutes:5;
}
const active=new WeakMap<World,{held:NativeAgedEatSelection;completion:NativeAgedEatCompletion|null}>();
const duration=5;
export function captureMvpNativeAgedEat<T>(w:World,held:NativeAgedEatSelection,run:()=>T){
 if(active.has(w))return null;
 const scope={held,completion:null as NativeAgedEatCompletion|null};
 active.set(w,scope);
 try{const result=run();return {result,completion:scope.completion};}finally{active.delete(w);}
}
function canEatInPlace(w:World,r:Resident):boolean {
 // Conservative: do not bypass any valid ordinary dining-seat candidate
 // when native rules prefer table service. The first slice is outdoors only.
 const thirst=mvpThirst(w,r)??Infinity;
 return w.mode==='validation'&&!Object.hasOwn(w,'simulationOnly')&&r.status==='alive'&&r.canDecide&&r.canExpress&&
  r.hunger>=35&&r.energy>0&&thirst<50-1e-9&&r.residency!=='outside'&&!r.regionalLocation&&r.inside===null&&
  !(r.hunger<80&&r.energy>=70&&mvpDiningPlace(w,r));
}
export function selectMvpNativeAgedEat(w:World,r:Resident):Action|null {
 const held=active.get(w)?.held;
 if(!held||r.id!==held.residentId||!canEatInPlace(w,r)||
  parseClimateUs(minuteToClimateUs(w.minute))+BigInt(duration)*1_000_000n>=parseClimateUs(held.expiresUs))return null;
 return {type:'mvpAgedFruitEat',effectId:held.effectId};
}
export function canRunMvpNativeAgedEat(w:World,id:string,action:Extract<Action,{type:'mvpAgedFruitEat'}>):boolean {
 const held=active.get(w)?.held,r=w.residents.find(r=>r.id===id);
 return !!held&&!!r&&id===held.residentId&&Object.keys(action).length===2&&action.effectId===held.effectId&&canEatInPlace(w,r)&&
  parseClimateUs(minuteToClimateUs(w.minute))<parseClimateUs(held.expiresUs);
}
export const AGED_EAT_INVALID='本人不能继续在原位食用这份未到期的随身果实';
export function completeMvpNativeAgedEat(w:World,r:Resident,action:Extract<Action,{type:'mvpAgedFruitEat'}>,elapsed:number):string|null {
 const scope=active.get(w),a=r.activity;
 if(!scope||scope.completion||!a||a.action!==action||r.plan?.id!==a.planId||!canRunMvpNativeAgedEat(w,r.id,action)||
  a.room||a.path.length||a.remaining!==0||elapsed!==1||w.minute!==a.startedAt+duration-1||!same(a.target,r.at))return AGED_EAT_INVALID;
 const hungerBefore=r.hunger,nutrition=goods.fruit.food;
 r.hunger=Math.max(0,hungerBefore-nutrition);
 scope.completion=Object.freeze({residentId:r.id,planId:a.planId,startedUs:minuteToClimateUs(a.startedAt),
  settledUs:minuteToClimateUs(w.minute),hungerBefore,hungerAfter:r.hunger,nutrition,workMinutes:5});
 return null; // Held terminal and observer fact belong to the exact sealed transaction.
}

import {emitLedgerEvent} from './events.js';
import type {Action,Resident,World} from '../shared/types.js';
import {goods} from '../shared/items.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {mvpThirst} from './mvp-drinking.js';
import {mvpDiningPlace} from './mvp-rooms.js';
import {MVP_HALL,hasMvpHamlet} from '../shared/mvp-hamlet.js';
import {findPath,same} from './navigation.js';

export interface NativeAgedEatSelection {readonly residentId:string;readonly effectId:string;readonly expiresUs:string;readonly table?:true;readonly disposableEvent?:true}
export interface NativeAgedEatCompletion {
 readonly residentId:string;readonly planId:string;readonly startedUs:string;readonly settledUs:string;
 readonly dining?: NonNullable<Extract<Action,{type:'mvpAgedFruitEat'}>['dining']>;
 readonly eventId?:string;
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
type EatAction=Extract<Action,{type:'mvpAgedFruitEat'}>;
// Deliberately only the shared hall, never an unrelated house or a cross-building exit.
function actualDining(w:World,r:Resident){
 if(w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||!w.rooms||!hasMvpHamlet(w)||r.status!=='alive'||!r.canDecide||!r.canExpress||
  r.residency==='outside'||r.regionalLocation||r.energy<=0||(mvpThirst(w,r)??Infinity)>=50-1e-9||
  !r.knownBuildings.includes(MVP_HALL)||(r.inside!==null&&r.inside!==MVP_HALL))return null;
 const p=mvpDiningPlace(w,r);
 if(!p||p.building.id!==MVP_HALL||p.building.kind!=='lodge'||p.building.ownerId!=='commons'||
  w.residents.some(o=>o.id!==r.id&&o.inside===p.building.id&&o.roomAt&&same(o.roomAt,p.at)))return null;
 return p;
}
export function selectMvpNativeAgedEat(w:World,r:Resident):Action|null {
 const held=active.get(w)?.held;
 if(!held||r.id!==held.residentId||
  parseClimateUs(minuteToClimateUs(w.minute))+BigInt(duration)*1_000_000n>=parseClimateUs(held.expiresUs))return null;
 if(held.table&&r.hunger>=35&&r.hunger<80&&r.energy>=70){
  const p=actualDining(w,r);
  if(p&&findPath(w,r.at,p.building.door)!==null)return {type:'mvpAgedFruitEat',effectId:held.effectId,dining:{buildingId:p.building.id,key:p.key,seat:{...p.at}}};
 }
 return canEatInPlace(w,r)?{type:'mvpAgedFruitEat',effectId:held.effectId}:null;
}
export function canRunMvpNativeAgedEat(w:World,id:string,action:EatAction):boolean {
 const held=active.get(w)?.held,r=w.residents.find(r=>r.id===id);
 if(!held||!r||id!==held.residentId||action.effectId!==held.effectId||
  parseClimateUs(minuteToClimateUs(w.minute))>=parseClimateUs(held.expiresUs))return false;
 if(!action.dining)return Object.keys(action).length===2&&canEatInPlace(w,r);
 const d=action.dining;
 if(!held.table||Object.keys(action).length!==3||Object.keys(d).length!==3||!d.seat||Object.keys(d.seat).length!==2||r.hunger<35)return false;
 const p=actualDining(w,r);
 return !!p&&action.dining.buildingId===p.building.id&&action.dining.key===p.key&&same(action.dining.seat,p.at);
}
export const AGED_EAT_INVALID='本人不能继续在原位食用这份未到期的随身果实';
export const AGED_DINING_INVALID='本人当前不能在实际餐位食用这份未到期的随身果实';
export function workMvpNativeAgedEat(w:World,r:Resident,action:EatAction,elapsed:number):boolean{
 const a=r.activity,d=action.dining;
 if(!a||!canRunMvpNativeAgedEat(w,r.id,action)||!same(r.at,a.target))return false;
 if(!d)return true;
 if(elapsed!==1||a.path.length||a.room||r.inside!==d.buildingId||!r.roomAt||!same(r.roomAt,d.seat)||w.rooms?.tick!==w.minute||
  !w.rooms.claims.some(c=>c.buildingId===d.buildingId&&c.key===d.key&&c.group===r.id&&c.people.includes(r.id)))return false;
 // The room engine returns only after travel, and the private clock starts
 // on the first actual claimed work minute, not when a route was selected.
 const workStart=a.mvpAgedEatWorkStartedAt??w.minute;
 if(w.minute!==workStart+duration-a.remaining)return false;
 a.mvpAgedEatWorkStartedAt=workStart;
 return true;
}
export function completeMvpNativeAgedEat(w:World,r:Resident,action:EatAction,elapsed:number):string|null {
 const scope=active.get(w),a=r.activity,d=action.dining,startedAt=d?a?.mvpAgedEatWorkStartedAt:a?.startedAt;
 if(!scope||scope.completion||!a||a.action!==action||r.plan?.id!==a.planId||!canRunMvpNativeAgedEat(w,r.id,action)||
  a.room||a.path.length||a.remaining!==0||elapsed!==1||startedAt===undefined||w.minute!==startedAt+duration-1||!same(a.target,r.at))
  return d?AGED_DINING_INVALID:AGED_EAT_INVALID;
 const hungerBefore=r.hunger,nutrition=goods.fruit.food;
 r.hunger=Math.max(0,hungerBefore-nutrition);
 const event=scope.held.disposableEvent?emitLedgerEvent(w,{kind:'action',actors:[r.id],place:{...r.at},
  text:r.name+'吃完了一份自己的食物。'}):undefined;
 scope.completion=Object.freeze({...(event?{eventId:event.id}:{}),residentId:r.id,planId:a.planId,startedUs:minuteToClimateUs(startedAt),
  settledUs:minuteToClimateUs(w.minute),hungerBefore,hungerAfter:r.hunger,nutrition,workMinutes:5,
  ...(d?{dining:Object.freeze({...d,seat:Object.freeze({...d.seat})})}:{})});
 return null; // Held terminal and observer fact belong to the exact sealed transaction.
}

import type {Action,Resident,Vec,World} from '../shared/types.js';
import {canPerceiveMvpCommonFruitPoint,mvpFallenFruitOptionalActionPermitted} from './mvp-fallen-fruit-resident.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {mvpThirst} from './mvp-drinking.js';
import {same} from './navigation.js';
import {physiology} from './physiology.js';

export interface NativeAgedPickupSelection {
 readonly residentId:string;readonly residentRevision:number;readonly effectId:string;readonly discoveryId:string;
 readonly point:Readonly<Vec>;readonly fromUs:string;readonly expiresUs:string;
}
interface Completion {readonly planId:string;readonly startedAt:number;readonly settledUs:string;readonly residentId:string}
const active=new WeakMap<World,{intents:ReadonlyMap<string,NativeAgedPickupSelection>;selected:NativeAgedPickupSelection|null;completion:Completion|null}>();
export function captureMvpNativeAgedPickup<T>(w:World,intents:ReadonlyMap<string,NativeAgedPickupSelection>,run:()=>T){
 if(active.has(w))return null;
 const scope={intents,selected:null as NativeAgedPickupSelection|null,completion:null as Completion|null};
 active.set(w,scope);
 try{const result=run();return {result,completion:scope.completion};}finally{active.delete(w);}
}
export function selectMvpNativeAgedPickup(w:World,r:Resident):Action|null {
 const scope=active.get(w),s=scope?.intents.get(r.id);
 if(!scope||scope.selected||!s||r.id!==s.residentId||r.revision!==s.residentRevision||!mvpFallenFruitOptionalActionPermitted(w,r)||
  minuteToClimateUs(w.minute)!==s.fromUs||!same(r.at,s.point)||!canPerceiveMvpCommonFruitPoint(w,r.id,s.point))return null;
 // This is invoked only by the native chooser in roster order, at a real
 // idle fallback. The host never inserts or skips a winning actor.
 scope.selected=s;
 return {type:'mvpAgedFruitPickup',effectId:s.effectId,discoveryId:s.discoveryId};
}
export function canRunMvpNativeAgedPickup(w:World,id:string,a:Extract<Action,{type:'mvpAgedFruitPickup'}>):boolean {
 const s=active.get(w)?.selected;
 if(!s||id!==s.residentId||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||
  Object.keys(a).length!==3||a.effectId!==s.effectId||a.discoveryId!==s.discoveryId)return false;
 const now=parseClimateUs(minuteToClimateUs(w.minute)),from=parseClimateUs(s.fromUs);
 const r=w.residents.find(r=>r.id===id);
 return !!r&&r.status==='alive'&&r.canDecide&&r.canExpress&&same(r.at,s.point)&&
  now>=from&&now<=from+1_000_000n&&now<parseClimateUs(s.expiresUs)&&canPerceiveMvpCommonFruitPoint(w,r.id,s.point);
}
export function completeMvpNativeAgedPickup(w:World,r:Resident,a:Extract<Action,{type:'mvpAgedFruitPickup'}>,elapsed:number):string|null {
 const scope=active.get(w),activity=r.activity,body=physiology(w,r);
 if(!scope?.selected||scope.completion||!canRunMvpNativeAgedPickup(w,r.id,a)||!activity||activity.action!==a||
  r.plan?.id!==activity.planId||activity.path.length||activity.room||activity.remaining!==0||elapsed!==1||
  r.hunger+body.hungerPerMinute*elapsed>=35||r.energy-body.energyPerMinute*elapsed<70||(mvpThirst(w,r)??Infinity)>=50-1e-9)
  return '地面果实拾取未实际完成或已有优先需求';
 const settledUs=minuteToClimateUs(w.minute);
 if(parseClimateUs(settledUs)-parseClimateUs(scope.selected.fromUs)!==1_000_000n)return '地面果实拾取时钟不匹配';
 scope.completion=Object.freeze({planId:activity.planId,startedAt:activity.startedAt,settledUs,residentId:r.id});
 return null; // The exact sealed transaction, not the engine scalar, settles custody.
}

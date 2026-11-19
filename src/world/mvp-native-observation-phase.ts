import type {Resident,Vec,World} from '../shared/types.js';
import {canPerceiveMvpCommonFruitPoint} from './mvp-fallen-fruit-resident.js';
import {minuteToClimateUs} from './mvp-climate.js';

export interface NativeMvpFruitObservation {
 readonly residentId:string;readonly residentRevision:number;readonly phaseWorldRevision:number;
 readonly atUs:string;readonly observerAt:Readonly<Vec>;
}
const active=new WeakMap<World,{point:Vec;observations:NativeMvpFruitObservation[];failed:boolean}>();

/** Native per-resident post-activity observation only. Different observation
 * calls used during action routing do not prove this phase ran. */
export function noteMvpNativeObservationPhase(world:World,resident:Resident):void {
 const scope=active.get(world);
 if(!scope)return;
 try{
  if(!canPerceiveMvpCommonFruitPoint(world,resident.id,scope.point))return;
  scope.observations.push(Object.freeze({residentId:resident.id,residentRevision:resident.revision,
   phaseWorldRevision:world.revision,atUs:minuteToClimateUs(world.minute),observerAt:Object.freeze({...resident.at})}));
  if(scope.observations.length>64)scope.failed=true;
 }catch{scope.failed=true;}
}
export function captureMvpNativeObservationPhase<T>(world:World,point:Vec,advance:()=>T){
 if(active.has(world))return null;
 const scope={point:{...point},observations:[] as NativeMvpFruitObservation[],failed:false};
 active.set(world,scope);
 try{
  const result=advance();
  return scope.failed?null:{result,observed:Object.freeze(scope.observations)};
 }finally{active.delete(world);}
}

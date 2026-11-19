import type {Resident,Vec,World} from '../shared/types.js';
import {canPerceiveMvpCommonFruitPoint} from './mvp-fallen-fruit-resident.js';
import {same} from './navigation.js';
import {minuteToClimateUs} from './mvp-climate.js';

export interface NativeMvpFruitObservation {
 readonly residentId:string;readonly residentRevision:number;readonly phaseWorldRevision:number;
 readonly atUs:string;readonly observerAt:Readonly<Vec>;
}
interface NativeAgedMoveEdge {readonly actorId:string;readonly minute:number;readonly from:Vec;readonly to:Vec;readonly planId:string}
const active=new WeakMap<World,{point:Vec;observations:NativeMvpFruitObservation[];arrivals:NativeAgedMoveEdge[];failed:boolean}>();
/** Called after the native engine really steps onto the outdoor route cell. */
export function noteMvpNativeMovePhase(world:World,resident:Resident,from:Vec,planId:string,to:Vec):void {
 const scope=active.get(world);
 if(!scope||!same(to,scope.point)||!same(resident.at,to)||resident.inside!==null||
  Math.abs(from.x-to.x)+Math.abs(from.y-to.y)!==1)return;
 scope.arrivals.push(Object.freeze({actorId:resident.id,minute:world.minute,from:{...from},to:{...to},planId}));
 if(scope.arrivals.length>64)scope.failed=true;
}

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
 const scope={point:{...point},observations:[] as NativeMvpFruitObservation[],arrivals:[] as NativeAgedMoveEdge[],failed:false};
 active.set(world,scope);
 try{
  const result=advance();
  return scope.failed?null:{result,observed:Object.freeze(scope.observations),arrivals:Object.freeze(scope.arrivals)};
 }finally{active.delete(world);}
}

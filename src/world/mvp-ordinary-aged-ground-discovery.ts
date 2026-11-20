import type {MvpGroundFruit} from '../shared/mvp-ground-fruit.js';
import type {Vec,World} from '../shared/types.js';
import {mvpFallenFruitDiscoveryId} from '../shared/valley-spirit-fairness.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {validateMvpGroundFruitState} from './mvp-ground-fruit.js';
import {captureMvpNativeObservationPhase} from './mvp-native-observation-phase.js';

export interface GroundDiscoveryHead {readonly worldId:string;readonly revision:number;readonly atUs:string}
/** Trusted owning port only: must verify the exact committed ground row,
 * receipt, live custody and head together. Empty normal installations have
 * no such port. This interface does not let callers submit a candidate lot. */
export interface OrdinaryAgedGroundDiscoveryRead {
 readonly readExactActiveLot:(head:Readonly<GroundDiscoveryHead>)=>Readonly<GroundDiscoveryHead&{
  schema:'ordinary-active-aged-ground-observation/v1';receiptDigest:string;
  fruit:MvpGroundFruit;bornUs:string;expiresUs:string;
 }>|null;
}
export interface NativeOrdinaryAgedDiscovery {
 readonly schema:'native-ordinary-aged-ground-observation/v1';
 readonly worldId:string;readonly residentId:string;readonly effectId:string;readonly receiptDigest:string;
 readonly discoveryId:string;readonly atUs:string;readonly fromRevision:number;readonly observedRevision:number;
 readonly observerAt:Readonly<Vec>;readonly target:Readonly<Vec>;
}
const exact=(v:unknown,keys:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

export function ordinaryAgedGroundObservationWorld(draft:World):boolean{
 return draft.mode==='validation'&&!Object.hasOwn(draft,'simulationOnly')&&!draft.clock.paused&&
  !!draft.mvpClimate&&!Object.hasOwn(draft.mvpClimate,'spiritEffects')&&!Object.hasOwn(draft.mvpClimate,'spiritFruitSettlement');
}
export function readOrdinaryAgedGroundObservationHead(draft:World,authority:OrdinaryAgedGroundDiscoveryRead){
 try{
  if(!ordinaryAgedGroundObservationWorld(draft)||!Number.isSafeInteger(draft.revision)||draft.revision<0)return null;
  const h=Object.freeze({worldId:draft.id,revision:draft.revision,atUs:minuteToClimateUs(draft.minute)});
  if(draft.mvpClimate?.lastUs!==h.atUs)return null;
  const r=structuredClone(authority.readExactActiveLot(h));
  if(!r||!exact(r,['schema','worldId','revision','atUs','receiptDigest','fruit','bornUs','expiresUs'])||
   r.schema!=='ordinary-active-aged-ground-observation/v1'||r.worldId!==h.worldId||r.revision!==h.revision||r.atUs!==h.atUs||
   typeof r.receiptDigest!=='string'||!/^[a-f0-9]{64}$/u.test(r.receiptDigest))return null;
  validateMvpGroundFruitState(draft,{version:1,items:[r.fruit]});
  const before=parseClimateUs(h.atUs),born=parseClimateUs(r.bornUs),expires=parseClimateUs(r.expiresUs);
  if(born>parseClimateUs(r.fruit.placedUs)||before+1_000_000n>=expires)return null;
  return {h,r,before};
 }catch{return null;}
}

/** Internal detached phase. Calls the native draft advancement exactly once
 * even if evidence is missing or invalid. Never asserts commit, first-durable
 * discovery, knowledge transfer, placement, pickup, or any ordinary enablement. */
export function captureOrdinaryAgedGroundDiscovery<T>(draft:World,authority:OrdinaryAgedGroundDiscoveryRead,advance:()=>T){
 const none=()=>Object.freeze([] as NativeOrdinaryAgedDiscovery[]);
 const selected=readOrdinaryAgedGroundObservationHead(draft,authority);
 if(!selected)return {result:advance(),observed:none()};
 const {h,r,before}=selected;
 // The engine records only the real per-resident post-activity observe phase.
 // Existing native LOS and walkability account for actual movement, wake,
 // regional absence, indoor/transport status and live site access.
 let result!:T,advanced=false;
 const captured=captureMvpNativeObservationPhase(draft,r.fruit.at,()=>{advanced=true;result=advance();});
 if(!captured)return {result:advanced?result:advance(),observed:none()};
 try{
  const atUs=minuteToClimateUs(draft.minute);
  if(!ordinaryAgedGroundObservationWorld(draft)||draft.id!==h.worldId||draft.mvpClimate?.lastUs!==atUs||
   parseClimateUs(atUs)!==before+1_000_000n||draft.revision<=h.revision||
   !Number.isSafeInteger(draft.revision))return {result,observed:none()};
  const seen=new Set<string>(),observed:NativeOrdinaryAgedDiscovery[]=[];
  for(const fact of captured.observed){
   if(fact.atUs!==atUs||fact.phaseWorldRevision<h.revision||fact.phaseWorldRevision>draft.revision||seen.has(fact.residentId))return {result,observed:none()};
   seen.add(fact.residentId);
   observed.push(Object.freeze({schema:'native-ordinary-aged-ground-observation/v1',worldId:h.worldId,residentId:fact.residentId,
    effectId:r.fruit.effectId,receiptDigest:r.receiptDigest,discoveryId:mvpFallenFruitDiscoveryId(h.worldId,fact.residentId,r.fruit.effectId),
    atUs,fromRevision:h.revision,observedRevision:fact.phaseWorldRevision,observerAt:fact.observerAt,target:Object.freeze({...r.fruit.at})}));
  }
  return {result,observed:Object.freeze(observed)};
 }catch{return {result,observed:none()};}
}

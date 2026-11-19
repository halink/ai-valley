import {isDeepStrictEqual} from 'node:util';
import type {MvpGroundFruitState} from '../shared/mvp-ground-fruit.js';
import type {World} from '../shared/types.js';
import type {ValleySpiritFallenFruitDiscoveryFact,ValleySpiritFallenFruitPickupFact} from '../shared/valley-spirit-fairness.js';
import {chooseMvpFallenFruitPickup,type MvpFallenFruitPickupIntent} from '../world/mvp-fallen-fruit-resident.js';
import {draftMvpFallenFruitDiscovery,draftMvpFallenFruitPickup,projectMvpFallenFruitLiveGround} from '../world/mvp-fallen-fruit-settlement.js';
import {chooseMvpAction} from './godot-mvp.js';

const field='spiritFruitSettlement';
export function hasMvpFallenFruitSettlement(w:World|null):boolean {
 return !!w?.mvpClimate&&Object.hasOwn(w.mvpClimate,field);
}

export type MvpFallenFruitFixtureOperation =
 | {readonly type:'adopt'}
 | {readonly type:'discover';readonly residentId:string;readonly effectId:string}
 | {readonly type:'pickup';readonly intent:MvpFallenFruitPickupIntent};
export type MvpFallenFruitFixtureResult =
 | {readonly status:'adopted'|'already-adopted'}
 | {readonly status:'recorded'|'replayed';readonly kind:'discovery';readonly fact:ValleySpiritFallenFruitDiscoveryFact}
 | {readonly status:'recorded'|'replayed';readonly kind:'pickup';readonly fact:ValleySpiritFallenFruitPickupFact}
 | {readonly status:'rejected';readonly code:string};
interface PlannedStep {
 readonly result:MvpFallenFruitFixtureResult;
 readonly draft?:World;
}
const reject=(code:string):PlannedStep=>({result:{status:'rejected',code}});
const exact=(v:unknown,keys:readonly string[]):boolean=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

/** Optional fixture UI/runner seam: consult the real first-choice rule before
 * suggesting the exact typed intent. Never swap out other kinds of wait. */
export function chooseMvpFallenFruitFixtureIntent(w:World,residentId:string):MvpFallenFruitPickupIntent|null {
 try{
  const ledger=w.mvpClimate?.spiritFruitSettlement;
  if(!ledger||!projectMvpFallenFruitLiveGround(w,ledger))return null;
  const detached=structuredClone(w),resident=detached.residents.find(r=>r.id===residentId);
  if(!resident||chooseMvpAction(detached,resident).idleFallback!==true)return null;
  return chooseMvpFallenFruitPickup(w,residentId,'idle-fallback',new Set(ledger.pickups.map(p=>p.effectId)));
 }catch{return null;}
}

export function readMvpFallenFruitFixtureGround(w:World):MvpGroundFruitState|null {
 const ledger=w.mvpClimate?.spiritFruitSettlement;
 return ledger?projectMvpFallenFruitLiveGround(w,ledger):null;
}

/** Deterministic internal planner; no caller callback or caller-authored
 * world replacement. The store reruns it on its freshly-read committed head. */
export function planMvpFallenFruitFixtureStep(current:World,operation:MvpFallenFruitFixtureOperation):PlannedStep {
 try{
  if(current.mode!=='validation'||!current.mvpClimate?.spiritEffects||Object.hasOwn(current,'simulationOnly')||
   !operation||typeof operation!=='object')return reject('unavailable');
  const state=current.mvpClimate.spiritFruitSettlement;
  if(operation.type==='adopt'&&exact(operation,['type'])){
   if(state)return {result:{status:'already-adopted'}};
   if(hasMvpFallenFruitSettlement(current)||!Number.isSafeInteger(current.revision+1))return reject('unavailable');
   const draft=structuredClone(current);
   draft.revision++;
   draft.mvpClimate!.spiritFruitSettlement={schemaVersion:1,worldId:current.id,discoveries:[],pickups:[]};
   return {result:{status:'adopted'},draft};
  }
  if(!state||current.clock.paused)return reject('unavailable');
  if(operation.type==='discover'&&exact(operation,['type','residentId','effectId'])){
   const d=draftMvpFallenFruitDiscovery(current,state,operation.residentId,operation.effectId);
   if(d.status==='rejected')return reject(d.code);
   if(d.status==='replayed')return {result:{status:'replayed',kind:'discovery',fact:d.fact}};
   d.world.mvpClimate!.spiritFruitSettlement=d.ledger;
   return {result:{status:'recorded',kind:'discovery',fact:d.fact},draft:d.world};
  }
  if(operation.type==='pickup'&&exact(operation,['type','intent'])){
   if(!operation.intent)return reject('stale-intent');
   // The pure builder may read a previously settled same-resident receipt
   // without a second reward. Fresh stock still requires the real chooser.
   const settled=state.pickups.some(p=>p.effectId===operation.intent.effectId);
   const allowed=settled||chooseMvpFallenFruitFixtureIntent(current,operation.intent.residentId)!==null;
   const p=draftMvpFallenFruitPickup(current,state,operation.intent,allowed?'idle-fallback':'ordinary-action');
   if(p.status==='rejected')return reject(p.code);
   if(p.status==='replayed')return {result:{status:'replayed',kind:'pickup',fact:p.fact}};
   p.world.mvpClimate!.spiritFruitSettlement=p.ledger;
   return {result:{status:'recorded',kind:'pickup',fact:p.fact},draft:p.world};
  }
  return reject('unknown-operation');
 }catch{return reject('unavailable');}
}

/** Generic writes can never adopt, append, edit or remove this nested ledger.
 * The private settlement port must present the operation we recompute here. */
export function assertMvpFallenFruitFixtureTransition(
 previous:World|null,next:World,operation?:MvpFallenFruitFixtureOperation,
):void {
 const before=hasMvpFallenFruitSettlement(previous),after=hasMvpFallenFruitSettlement(next);
 if(!before&&!after&&!operation)return;
 if(before&&!after)throw Error('mvp_spirit_resident_fruit_dependency_downgrade');
 if(operation){
  const verified=previous?planMvpFallenFruitFixtureStep(previous,operation).draft:undefined;
  if(!verified||!isDeepStrictEqual(verified,next))throw Error('mvp_spirit_resident_fruit_requires_exact_transaction');
  return;
 }
 if(!before||!isDeepStrictEqual(previous?.mvpClimate?.spiritFruitSettlement,next.mvpClimate?.spiritFruitSettlement))
  throw Error('mvp_spirit_resident_fruit_requires_dedicated_transaction');
}

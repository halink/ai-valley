import {createHash} from 'node:crypto';
import {disasterContains} from '../shared/frontier-hazards.js';
import type {Plan,Vec,World} from '../shared/types.js';
import {projectMvpFallenFruitLiveGround} from '../world/mvp-fallen-fruit-settlement.js';
import {mvpFallenFruitOptionalActionPermitted,observeMvpFallenFruit} from '../world/mvp-fallen-fruit-resident.js';
import {completedMovementSnapshot,enableCompletedMovement} from '../world/completed-movement.js';
import {planStartError,stepWorld,submitPlan} from '../world/engine.js';
import {distance,findPath,same} from '../world/navigation.js';
import {chooseMvpAction} from './godot-mvp.js';

interface Approach {
 readonly worldId:string;readonly basisRevision:number;readonly basisMinute:number;
 readonly residentId:string;readonly residentRevision:number;
 readonly effectId:string;readonly discoveryId:string;readonly from:Readonly<Vec>;readonly to:Readonly<Vec>;
}
export const unsafeMvpApproachEndpoint=(w:World,p:Vec)=>w.frontierHazards?.disasters.some(h=>h.phase==='active'&&disasterContains(h,p))??false;
const unavailable={status:'unavailable'} as const;

/** Typed, detached eligibility from current physical custody and the person's
 * own prior discovery. Original weather permission is not a physical right. */
export function planMvpFallenFruitAdjacentApproach(w:World):Approach|null{
 try{
  if(w.clock.paused||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly'))return null;
  const state=w.mvpClimate?.spiritFruitSettlement;
  if(!state)return null;
  const live=projectMvpFallenFruitLiveGround(w,state);
  if(!live?.items.length)return null;
  const settled=new Set(state.pickups.map(p=>p.effectId));
  for(const r of w.residents.slice(0,8)){
   if(r.status!=='alive'||!r.canDecide||!r.canExpress||unsafeMvpApproachEndpoint(w,r.at)||!mvpFallenFruitOptionalActionPermitted(w,r))continue;
   const seen=observeMvpFallenFruit(w,r.id,settled).find(s=>distance(r.at,s.at)===1&&!unsafeMvpApproachEndpoint(w,s.at)&&
    state.discoveries.some(d=>d.residentId===r.id&&d.effectId===s.effectId&&d.discoveryId===s.discoveryId)&&
    findPath(w,r.at,s.at,false,1)?.length===1);
   if(!seen)continue;
   const test=structuredClone(w),actor=test.residents.find(p=>p.id===r.id)!;
   if(chooseMvpAction(test,actor).idleFallback!==true)continue;
   return {worldId:w.id,basisRevision:w.revision,basisMinute:w.minute,residentId:r.id,residentRevision:r.revision,
    effectId:seen.effectId,discoveryId:seen.discoveryId,from:{...r.at},to:{...seen.at}};
  }
  return null;
 }catch{return null;}
}

/** Run exactly one real engine minute on a detached draft. Returns proof of
 * one observed physical edge, never the resulting mutable world. This is
 * not action completion, pickup, food authority, or a durable step. */
export function probeMvpFallenFruitAdjacentEngineEdge(w:World){
 try{
  const a=planMvpFallenFruitAdjacentApproach(w);
  if(!a)return unavailable;
  const draft=structuredClone(w),r=draft.residents.find(p=>p.id===a.residentId)!;
  const planId='mvp-private-approach:'+createHash('sha256').update(JSON.stringify(a)).digest('hex');
  const plan:Plan={id:planId,actorId:r.id,actorRevision:r.revision,createdAt:draft.minute,
   definition:draft.activeDefinitions['action/routine'],intention:r.intention,actions:[{type:'move',to:{...a.to}}]};
  if(planStartError(draft,plan))return unavailable;
  enableCompletedMovement(draft);
  const baseline=completedMovementSnapshot(draft);
  if(!baseline||!submitPlan(draft,plan).ok||r.plan?.id!==planId)return unavailable;
  stepWorld(draft,1);
  const after=completedMovementSnapshot(draft),edges=after?.steps.filter(e=>e.actorId===r.id&&e.seq>baseline.lastSeq);
  if(after?.epoch!==baseline.epoch||edges?.length!==1||!same(edges[0].from,a.from)||!same(edges[0].to,a.to)||
   edges[0].minute!==a.basisMinute+1||r.activity?.planId!==planId||r.activity.path.length!==0||
   r.lastFailure||r.inside!==null||!same(r.at,a.to)||unsafeMvpApproachEndpoint(draft,a.to)||
   !observeMvpFallenFruit(draft,r.id).some(s=>s.discoveryId===a.discoveryId))return unavailable;
  return {status:'detached_engine_edge',durable:false,pickupAuthorized:false,approach:a,steppedMinute:edges[0].minute} as const;
 }catch{return unavailable;}
}

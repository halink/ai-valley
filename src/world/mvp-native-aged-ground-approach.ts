import type {Resident,Vec,World} from '../shared/types.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {inLand,reservedLandRights} from '../shared/land-rights.js';
import {findPath,same,walkable} from './navigation.js';
import {canPerceiveMvpCommonFruitPoint,mvpFallenFruitOptionalActionPermitted} from './mvp-fallen-fruit-resident.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {mvpThirst} from './mvp-drinking.js';
import {physiology} from './physiology.js';

export type AgedGroundApproach = Readonly<{
 residentId:string;effectId:string;discoveryId:string;from:Vec;to:Vec;expiresUs:string;
 /** Omitted only for the existing one-edge format. Exactly two cardinal edges otherwise. */
 path?:readonly [Readonly<Vec>,Readonly<Vec>];
}>;
export type AgedGroundApproachPlan = AgedGroundApproach&Readonly<{planId:string;startedFromMinute:number}>;
type AgedGroundApproachEdge=Readonly<{from:Vec;to:Vec}>;
type AgedGroundApproachSupersession=Readonly<{residentId:string;planId:string}>;
export type AgedGroundApproachWitness = Readonly<{
 plan:AgedGroundApproachPlan|null; edges:readonly AgedGroundApproachEdge[]; stopped:boolean; supersededBy:AgedGroundApproachSupersession|null;
}>;
type Scope={intents:ReadonlyMap<string,AgedGroundApproach>;plan:AgedGroundApproachPlan|null;
 edges:AgedGroundApproachEdge[];stopped:boolean;supersededBy:AgedGroundApproachSupersession|null;declinedPickup:AgedGroundApproachSupersession|null};
const active=new WeakMap<World,Scope>();
const adjacent=(a:Vec,b:Vec)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
const danger=(w:World,p:Vec)=>w.frontierHazards?.disasters.some(h=>h.phase==='active'&&disasterContains(h,p))??false;
function legalAgedGroundEdge(w:World,from:Vec,to:Vec){
 return adjacent(from,to)&&!danger(w,from)&&!danger(w,to)&&walkable(w,to,from)&&
  !reservedLandRights(w).some(right=>inLand({...right.at,width:right.width,height:right.height},to));
}
function lawfulActorAndSight(w:World,r:Resident,to:Vec){
 return r.inside===null&&!r.regionalLocation&&r.status==='alive'&&r.health>0&&r.canDecide&&r.canExpress&&
  !danger(w,r.at)&&!danger(w,to)&&canPerceiveMvpCommonFruitPoint(w,r.id,to);
}
export const agedGroundApproachPath=(p:AgedGroundApproach):readonly Readonly<Vec>[]=>p.path??[p.to];
export function equalAgedGroundPath(a:readonly Readonly<Vec>[],b:readonly Readonly<Vec>[]){
 return a.length===b.length&&a.every((q,i)=>same(q,b[i]));
}
export function chooseLawfulAgedGroundPath(w:World,r:Resident,to:Vec){
 if(!lawfulActorAndSight(w,r,to)||same(r.at,to)||Math.abs(r.at.x-to.x)+Math.abs(r.at.y-to.y)>2)return null;
 // Same unbounded, road-weighted graph the ordinary move uses at begin().
 // Never substitute a private detour or encourage an unbounded walk.
 const path=findPath(w,r.at,to);
 return path?.length&&path.length<=2&&path.every((q,i)=>legalAgedGroundEdge(w,i?path[i-1]:r.at,q))?path:null;
}
export function agedGroundPathSuffix(p:AgedGroundApproach,at:Vec){
 const path=agedGroundApproachPath(p);
 if(same(at,p.from))return path;
 const i=path.findIndex(q=>same(at,q));
 return i<0?null:path.slice(i+1);
}
export function captureAgedGroundApproach<T>(w:World,intents:ReadonlyMap<string,AgedGroundApproach>,plan:AgedGroundApproachPlan|null,run:()=>T){
 if(active.has(w))throw Error('disposable_native_ground_approach_scope_conflict');
 const s:Scope={intents,plan,edges:[],stopped:false,supersededBy:null,declinedPickup:null};active.set(w,s);
 try{
  const result=run();
  return {result,witness:Object.freeze({plan:s.plan,edges:Object.freeze(s.edges),stopped:s.stopped,supersededBy:s.supersededBy})};
 }finally{active.delete(w);}
}
export function selectAgedGroundApproach(w:World,r:Resident,planId:string):Vec|null{
 const s=active.get(w),p=s?.intents.get(r.id);
 if(!s||s.plan||!p||!same(r.at,p.from)||!equalAgedGroundPath(chooseLawfulAgedGroundPath(w,r,p.to)??[],agedGroundApproachPath(p))||
  !mvpFallenFruitOptionalActionPermitted(w,r)||parseClimateUs(minuteToClimateUs(w.minute))+1_000_000n>=parseClimateUs(p.expiresUs))return null;
 s.plan=Object.freeze({...p,planId,startedFromMinute:w.minute});
 return {...p.to};
}
/** Called only from the original engine activity under a matching private
 * native capture. It does not affect any unscoped ordinary move. */
export function stopAgedGroundApproach(w:World,r:Resident,minutes:number):boolean{
 const s=active.get(w),p=s?.plan;
 if(!s||!p||r.id!==p.residentId||r.activity?.planId!==p.planId)return false;
 const rules=physiology(w,r);
 const suffix=agedGroundPathSuffix(p,r.at);
 if(r.activity.action.type==='move'&&same(r.activity.action.to,p.to)&&lawfulActorAndSight(w,r,p.to)&&suffix&&
  equalAgedGroundPath(suffix,r.activity.path)&&suffix.every((q,i)=>legalAgedGroundEdge(w,i?suffix[i-1]:r.at,q))&&
  !r.decisionProtection&&!w.health?.transports.some(t=>t.carrierId===r.id&&t.phase==='carrying')&&
  r.hunger+rules.hungerPerMinute*minutes<35&&r.energy-rules.energyPerMinute*minutes>=70&&
  (mvpThirst(w,r)??Infinity)<50-1e-9&&parseClimateUs(minuteToClimateUs(w.minute))<parseClimateUs(p.expiresUs)&&
  w.minute<=p.startedFromMinute+(p.path?8:4))return false;
 s.stopped=true;return true;
}
export function stopAgedGroundApproachOnEdge(w:World,r:Resident,to:Vec,planId:string):boolean{
 const s=active.get(w),p=s?.plan;
 if(!s||!p||p.planId!==planId||p.residentId!==r.id)return false;
 const next=agedGroundPathSuffix(p,r.at)?.[0];
 if(next&&same(to,next)&&legalAgedGroundEdge(w,r.at,to)&&parseClimateUs(minuteToClimateUs(w.minute))<parseClimateUs(p.expiresUs))return false;
 s.stopped=true;return true;
}
// Only the native frontier-hazard cancellation callback calls this. Keep any
// edges already witnessed before the hazard; don't infer an interruption
// from arbitrary resident failure text.
export function noteAgedGroundApproachHazardStop(w:World,r:Resident){
 const s=active.get(w),p=s?.plan;
 if(s&&p&&p.residentId===r.id&&r.activity?.planId===p.planId&&r.plan?.id===p.planId&&
  r.activity.action.type==='move'&&same(r.activity.action.to,p.to))s.stopped=true;
}
export function noteAgedGroundApproachEdge(w:World,r:Resident,from:Vec,to:Vec,planId:string):void{
 const s=active.get(w),p=s?.plan;
 if(!s||!p||p.planId!==planId||p.residentId!==r.id)return;
 const next=agedGroundPathSuffix(p,from)?.[0],last=s.edges.at(-1);
 if(s.stopped||s.supersededBy||s.edges.length>=agedGroundApproachPath(p).length||!next||!same(to,next)||last&&!same(last.to,from))
  throw Error('disposable_native_ground_approach_nonexact_edge');
 s.edges.push(Object.freeze({from:{...from},to:{...to}}));
}

/** Only this exact in-minute cancellation can follow the ordinary successful
 * minute path; an unrelated lastFailure text is never evidence. */
export function stoppedCurrentAgedGroundApproach(w:World,r:Resident,planId:string|undefined){
 const scope=active.get(w);
 return !!(scope?.stopped||scope?.supersededBy)&&!!scope.plan&&scope.plan.residentId===r.id&&scope.plan.planId===planId&&!r.activity&&!r.plan;
}

export const hasAgedGroundApproachCapture=(w:World):boolean=>active.has(w);

/** Only the successful native pickup completion site calls this. A failed
 * attempt has no call, and only the exact still-pending private move is
 * retired. The resident's real coordinate is left unchanged. */
export function supersedeAgedGroundApproachAfterPickup(w:World,picker:Resident,effectId:string,pickupPlanId:string):Resident|null{
 const s=active.get(w),p=s?.plan;
 if(!s||!p||s.stopped||s.supersededBy||p.residentId===picker.id||p.effectId!==effectId)return null;
 const r=w.residents.find(r=>r.id===p.residentId);
 if(!r||r.activity?.planId!==p.planId||r.plan?.id!==p.planId||r.activity.action.type!=='move'||
  !same(r.activity.action.to,p.to))return null;
 s.supersededBy=Object.freeze({residentId:picker.id,planId:pickupPlanId});
 return r;
}

/** Completion-site rejection for the different at-site resident only. Never
 * treats a generic rejected plan or a matching error string as evidence. */
export function noteDeclinedAgedGroundRacePickup(w:World,picker:Resident,effectId:string,pickupPlanId:string):void{
 const s=active.get(w),p=s?.plan;
 if(s&&p&&p.effectId===effectId&&p.residentId!==picker.id&&picker.activity?.planId===pickupPlanId&&
  picker.activity.action.type==='mvpAgedFruitPickup')
  s.declinedPickup=Object.freeze({residentId:picker.id,planId:pickupPlanId});
}
export function isDeclinedAgedGroundRacePickup(w:World,r:Resident,planId:string|undefined):boolean {
 const d=active.get(w)?.declinedPickup;
 return !!d&&d.residentId===r.id&&d.planId===planId&&!r.plan&&!r.activity;
}

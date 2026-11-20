import type {Resident,Vec,World} from '../shared/types.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {findPath,same} from './navigation.js';
import {canPerceiveMvpCommonFruitPoint,mvpFallenFruitOptionalActionPermitted} from './mvp-fallen-fruit-resident.js';
import {minuteToClimateUs,parseClimateUs} from './mvp-climate.js';
import {mvpThirst} from './mvp-drinking.js';
import {physiology} from './physiology.js';

export type AgedGroundApproach = Readonly<{
 residentId:string;effectId:string;discoveryId:string;from:Vec;to:Vec;expiresUs:string;
}>;
export type AgedGroundApproachPlan = AgedGroundApproach&Readonly<{planId:string;startedFromMinute:number}>;
export type AgedGroundApproachWitness = Readonly<{
 plan:AgedGroundApproachPlan|null; edge:Readonly<{from:Vec;to:Vec}>|null; stopped:boolean;
}>;
type Scope={intents:ReadonlyMap<string,AgedGroundApproach>;plan:AgedGroundApproachPlan|null;
 edge:AgedGroundApproachWitness['edge'];stopped:boolean};
const active=new WeakMap<World,Scope>();
const adjacent=(a:Vec,b:Vec)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;
const danger=(w:World,p:Vec)=>w.frontierHazards?.disasters.some(h=>h.phase==='active'&&disasterContains(h,p))??false;
export function lawfulAgedGroundApproach(w:World,r:Resident,to:Vec){
 return r.inside===null&&!r.regionalLocation&&r.status==='alive'&&r.health>0&&r.canDecide&&r.canExpress&&
  !danger(w,r.at)&&!danger(w,to)&&canPerceiveMvpCommonFruitPoint(w,r.id,to)&&
  (same(r.at,to)||adjacent(r.at,to)&&findPath(w,r.at,to,false,1)?.length===1);
}
export function captureAgedGroundApproach<T>(w:World,intents:ReadonlyMap<string,AgedGroundApproach>,plan:AgedGroundApproachPlan|null,run:()=>T){
 if(active.has(w))throw Error('disposable_native_ground_approach_scope_conflict');
 const s:Scope={intents,plan,edge:null,stopped:false};active.set(w,s);
 try{
  const result=run();
  return {result,witness:Object.freeze({plan:s.plan,edge:s.edge,stopped:s.stopped})};
 }finally{active.delete(w);}
}
export function selectAgedGroundApproach(w:World,r:Resident,planId:string):Vec|null{
 const s=active.get(w),p=s?.intents.get(r.id);
 if(!s||s.plan||!p||!same(r.at,p.from)||!adjacent(p.from,p.to)||!lawfulAgedGroundApproach(w,r,p.to)||
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
 if(r.activity.action.type==='move'&&same(r.activity.action.to,p.to)&&lawfulAgedGroundApproach(w,r,p.to)&&
  !r.decisionProtection&&!w.health?.transports.some(t=>t.carrierId===r.id&&t.phase==='carrying')&&
  r.hunger+rules.hungerPerMinute*minutes<35&&r.energy-rules.energyPerMinute*minutes>=70&&
  (mvpThirst(w,r)??Infinity)<50-1e-9&&parseClimateUs(minuteToClimateUs(w.minute))<parseClimateUs(p.expiresUs)&&
  w.minute<=p.startedFromMinute+4)return false;
 s.stopped=true;return true;
}
export function noteAgedGroundApproachEdge(w:World,r:Resident,from:Vec,to:Vec,planId:string):void{
 const s=active.get(w),p=s?.plan;
 if(!s||!p||p.planId!==planId||p.residentId!==r.id)return;
 if(s.edge||!same(from,p.from)||!same(to,p.to)||!adjacent(from,to))throw Error('disposable_native_ground_approach_nonexact_edge');
 s.edge=Object.freeze({from:{...from},to:{...to}});
}

/** Only this exact in-minute cancellation can follow the ordinary successful
 * minute path; an unrelated lastFailure text is never evidence. */
export function stoppedCurrentAgedGroundApproach(w:World,r:Resident,planId:string|undefined){
 const scope=active.get(w);
 return !!scope?.stopped&&!!scope.plan&&scope.plan.residentId===r.id&&scope.plan.planId===planId&&!r.activity&&!r.plan;
}

export const hasAgedGroundApproachCapture=(w:World):boolean=>active.has(w);

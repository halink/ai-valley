import {randomUUID} from 'node:crypto';
import type {ModelName} from './model-completion.js';

export type DecisionActorKind='resident'|'regional'|'foreign';
export type DecisionWaitStamp={wallTimeMs:number|null;monotonicMs:number|null;gameMinute:number};
type Identity={actorId:string;actorKind:DecisionActorKind;waitId:number};
type RequestIdentity=Identity&{requestId:number;model:ModelName};
type Duration={elapsedMs:number|null;gameMinutes:number|null};
type Body=
 |{type:'session_started';priorWait:'unknown'}
 |{type:'session_stopped'}
 |(Identity&{type:'wait_started';origin:'session_start'|'runtime_boundary';priorWaitMs:null})
 |(Identity&Duration&{type:'wait_finished';reason:'accepted'|'no_longer_eligible'|'stopped';rightCensored:boolean;requestId:number|null})
 |(RequestIdentity&{type:'request_started';route:'primary'|'backup';trigger:'normal'|'fallback_pending'|'primary_blocked'})
 |(RequestIdentity&Duration&{type:'request_finished';outcome:'reply'|'timeout'|'failed'|'interrupted';code:string|null})
 |(Identity&{type:'admission_deferred';reason:'budget';model:ModelName})
 |(Identity&{type:'preparation_failed';code:'model_context_limit'|'model_request_invalid';model:ModelName})
 |(Identity&{type:'decision_rejected';requestId:number;reason:'actor_changed'|'plan_invalid'|'regional_changed'|'foreign_changed'})
 |(Identity&{type:'retry_scheduled';delayMs:number;fallbackModel:ModelName|null});
export type DecisionWaitEvent=Readonly<Body&{schema:1;sessionId:string;sequence:number;at:Readonly<DecisionWaitStamp>}>;
/** A synchronous, trusted sink. Never receives world objects, prompts, replies, keys or error text. */
export type DecisionWaitObserver=(event:DecisionWaitEvent)=>void;
export type DecisionWaitEvidenceOptions={observe:DecisionWaitObserver;monotonicNow?:()=>number};
type Wait=Identity&{at:DecisionWaitStamp};
export type DecisionRequest= RequestIdentity&{at:DecisionWaitStamp;sessionId:string;finished:boolean};

/** Ephemeral external evidence, deliberately absent from World and snapshots.
 * Missing observation is not zero. A failed sink disables this recorder, and its
 * status remains failed until explicitly started as a new observation session.
 */
export class DecisionWaitEvidence {
 private sessionId:string|null=null;
 private sequence=0;
 private serial=0;
 private phase:'not_started'|'observing'|'stopped'|'failed'='not_started';
 private failure:'observer_threw'|'async_observer'|null=null;
 private waits=new Map<string,Wait>();
 private requests=new Set<DecisionRequest>();
 private lastMonotonic:number|null=null;
 private monotonicValid=true;
 constructor(private options:DecisionWaitEvidenceOptions){}
 status(){return {sessionId:this.sessionId,phase:this.phase,lastSequence:this.sequence,failure:this.failure,
  monotonicClockValid:this.monotonicValid,openWaits:this.waits.size,openRequests:this.requests.size};}
 private stamp(gameMinute:number):DecisionWaitStamp {
  let monotonicMs:number|null=null,wallTimeMs:number|null=null;
  try{const n=(this.options.monotonicNow??(()=>performance.now()))();
   if(!Number.isFinite(n)||this.lastMonotonic!==null&&n<this.lastMonotonic)this.monotonicValid=false;
   if(this.monotonicValid){monotonicMs=n;this.lastMonotonic=n;}
  }catch{this.monotonicValid=false;}
  try{const n=Date.now();if(Number.isFinite(n))wallTimeMs=n;}catch{/* Unknown wall timestamp. */}
  return {wallTimeMs,monotonicMs,gameMinute};
 }
 private duration(from:DecisionWaitStamp,to:DecisionWaitStamp):Duration {
  return {elapsedMs:from.monotonicMs===null||to.monotonicMs===null?null:to.monotonicMs-from.monotonicMs,
   gameMinutes:Number.isFinite(to.gameMinute-from.gameMinute)&&to.gameMinute>=from.gameMinute?to.gameMinute-from.gameMinute:null};
 }
 private emit(body:Body,at:DecisionWaitStamp){
  if(this.phase!=='observing')return;
  const event=Object.freeze({...body,schema:1 as const,sessionId:this.sessionId!,sequence:++this.sequence,at:Object.freeze({...at})});
  try{
   const result:unknown=this.options.observe(event);
   if(result&&typeof (result as PromiseLike<unknown>).then==='function'){
    // Async sinks cannot acknowledge durable delivery synchronously. Contain their rejection, too.
    void Promise.resolve(result).catch(()=>{});this.fail('async_observer');
   }
  }catch{this.fail('observer_threw');}
 }
 private fail(reason:NonNullable<DecisionWaitEvidence['failure']>){this.phase='failed';this.failure=reason;}
 start(gameMinute:number){
  if(this.phase==='observing')return;
  this.sessionId=randomUUID();this.sequence=0;this.serial=0;this.failure=null;this.phase='observing';
  this.waits.clear();this.requests.clear();this.lastMonotonic=null;this.monotonicValid=true;
  this.emit({type:'session_started',priorWait:'unknown'},this.stamp(gameMinute));
 }
 reconcile(actors:ReadonlyArray<{actorId:string;actorKind:DecisionActorKind}>,gameMinute:number,initial=false){
  if(this.phase!=='observing')return;
  const at=this.stamp(gameMinute),ids=new Set(actors.map(a=>a.actorId));
  for(const id of this.waits.keys())if(!ids.has(id))this.finishWait(id,'no_longer_eligible',at);
  for(const actor of actors)if(!this.waits.has(actor.actorId)){
   const wait={...actor,waitId:++this.serial,at};this.waits.set(actor.actorId,wait);
   this.emit({...actor,waitId:wait.waitId,type:'wait_started',origin:initial?'session_start':'runtime_boundary',priorWaitMs:null},at);
  }
 }
 private identity(actorId:string):Identity|null {
  const wait=this.waits.get(actorId);return wait?{actorId,actorKind:wait.actorKind,waitId:wait.waitId}:null;
 }
 private finishWait(actorId:string,reason:'accepted'|'no_longer_eligible'|'stopped',at:DecisionWaitStamp,requestId:number|null=null){
  const wait=this.waits.get(actorId),id=this.identity(actorId);if(!wait||!id)return;
  this.waits.delete(actorId);
  this.emit({...id,type:'wait_finished',reason,rightCensored:reason!=='accepted',requestId,...this.duration(wait.at,at)},at);
 }
 accepted(actorId:string,gameMinute:number,request:DecisionRequest|null){
  if(this.phase!=='observing'||request?.sessionId!==this.sessionId||request.actorId!==actorId||request.waitId!==this.waits.get(actorId)?.waitId)return;
  this.finishWait(actorId,'accepted',this.stamp(gameMinute),request.requestId);
 }
 requestStarted(actorId:string,model:ModelName,route:'primary'|'backup',trigger:'normal'|'fallback_pending'|'primary_blocked',gameMinute:number):DecisionRequest|null {
  if(this.phase!=='observing')return null;
  const identity=this.identity(actorId);if(!identity)return null;
  const at=this.stamp(gameMinute),request={...identity,requestId:++this.serial,model,at,sessionId:this.sessionId!,finished:false};
  this.requests.add(request);this.emit({...identity,requestId:request.requestId,model,type:'request_started',route,trigger},at);return request;
 }
 requestFinished(request:DecisionRequest|null,outcome:'reply'|'timeout'|'failed'|'interrupted',code:string|null,gameMinute:number){
  if(!request||request.finished||request.sessionId!==this.sessionId||this.phase!=='observing')return;
  request.finished=true;this.requests.delete(request);const at=this.stamp(gameMinute);
  const {actorId,actorKind,waitId,requestId,model}=request;
  this.emit({actorId,actorKind,waitId,requestId,model,type:'request_finished',outcome,code,...this.duration(request.at,at)},at);
 }
 deferred(actorId:string,model:ModelName,gameMinute:number){
  const id=this.identity(actorId);if(id&&this.phase==='observing')this.emit({...id,type:'admission_deferred',reason:'budget',model},this.stamp(gameMinute));
 }
 preparationFailed(actorId:string,model:ModelName,code:'model_context_limit'|'model_request_invalid',gameMinute:number){
  const id=this.identity(actorId);if(id&&this.phase==='observing')this.emit({...id,type:'preparation_failed',code,model},this.stamp(gameMinute));
 }
 rejected(actorId:string,request:DecisionRequest|null,reason:'actor_changed'|'plan_invalid'|'regional_changed'|'foreign_changed',gameMinute:number){
  const id=this.identity(actorId);if(id&&request?.sessionId===this.sessionId&&request.actorId===actorId&&request.waitId===id.waitId&&this.phase==='observing')
   this.emit({...id,type:'decision_rejected',requestId:request.requestId,reason},this.stamp(gameMinute));
 }
 retry(actorId:string,delayMs:number,fallbackModel:ModelName|null,gameMinute:number){
  const id=this.identity(actorId);if(id&&this.phase==='observing')this.emit({...id,type:'retry_scheduled',delayMs,fallbackModel},this.stamp(gameMinute));
 }
 stop(gameMinute:number){
  if(this.phase!=='observing')return;
  for(const request of this.requests)this.requestFinished(request,'interrupted',null,gameMinute);
  const at=this.stamp(gameMinute);
  for(const id of this.waits.keys())this.finishWait(id,'stopped',at);
  this.emit({type:'session_stopped'},at);
  if(this.phase==='observing')this.phase='stopped';
 }
}

import {DEEPSEEK_MODEL,GLM_MODEL,type ModelName} from './model-completion.js';
import type {World} from '../shared/types.js';

/** Eligible identifiers only, NOT a statement about a provider's current prices. */
export const ACCEPTANCE_FREE_MODEL_ALLOWLIST=Object.freeze([DEEPSEEK_MODEL,GLM_MODEL] as const);
export const ACCEPTANCE_STOP_REASONS=['game_endpoint','wall_limit','request_limit','signal','manual_stop',
 'model_not_allowed','cost_unknown','nonzero_cost','clock_invalid','game_time_invalid',
 'endpoint_missed','endpoint_observer_failed','evidence_failed','runtime_failed'] as const;
export type AcceptanceStopReason=typeof ACCEPTANCE_STOP_REASONS[number];
export type AcceptanceClock={now:()=>number;setTimer:(callback:()=>void,ms:number)=>unknown;clearTimer:(timer:unknown)=>void};
/** An injected price assessment must cover every charge, not merely token rates. */
export type FreePriceAssessment={model:ModelName;currency:'USD';inputPerMillion:number;outputPerMillion:number;
 perRequest:number;otherFees:number;validUntilMonotonicMs:number};
export type AcceptanceEndpointSample={worldId:string;gameMinute:number;revision:number;
 residents:ReadonlyArray<Readonly<{id:string;status:World['residents'][number]['status'];health:number;hunger:number;energy:number}>>};
export type AcceptanceStopOptions={endGameMinute:number;maxWallMs:number;maxRequests:number;
 allowedModels:readonly ModelName[];assessPrice:(model:ModelName)=>FreePriceAssessment|null;
 /** Explicit official-price basis only; does NOT turn missing bills into zero. */
 unreceiptedFreePolicy?:'siliconflow-deepseek-published-zero';
 clock?:AcceptanceClock;signal?:AbortSignal;observeEndpoint?:(sample:AcceptanceEndpointSample)=>void};
export type AcceptanceRequest={readonly id:number;readonly model:ModelName;readonly signal:AbortSignal};
type RequestState={token:AcceptanceRequest;controller:AbortController;dispatched:boolean};
const systemClock:AcceptanceClock={now:()=>performance.now(),setTimer:(callback,ms)=>setTimeout(callback,ms),
 clearTimer:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const isThenable=(value:unknown):value is PromiseLike<unknown>=>!!value&&(typeof value==='object'||typeof value==='function')&&typeof (value as {then?:unknown}).then==='function';

/** Single-use, synchronous admission/commit gate. No transport, process listeners,
 * database, filesystem, credentials, or implicit approval. All prices are injected. */
export class AcceptanceStopControl {
 private phase:'not_started'|'running'|'stopped'='not_started';
 private reason:AcceptanceStopReason|null=null;
 private startMs:number|null=null;
 private lastMs:number|null=null;
 private elapsedMs:number|null=null;
 private gameMinute:number|null=null;
 private fromMinute:number|null=null;
 private requests=new Map<number,RequestState>();
 private reserved=0;
 private dispatched=0;
 private settled=0;
 private interrupted=0;
 private unknownCost=0;
 private knownCost=0;
 private endpoint:AcceptanceEndpointSample|null=null;
 private issues=new Set<'shutdown_failed'|'timer_failed'|'endpoint_observer_failed'|'evidence_persistence_failed'>();
 private unfinished:ReadonlyArray<{id:number;model:ModelName;dispatched:boolean}>=[];
 private timer:unknown;
 private timerArmed=false;
 private clock:AcceptanceClock;
 private allowed:Set<ModelName>;
 private options:AcceptanceStopOptions;
 private stopping=false;
 private abortListener=()=>this.stop('signal');
 constructor(options:AcceptanceStopOptions,private onStop:()=>void,private onStopped?:(status:AcceptanceStopStatus)=>void,
  private onStopping?:(status:AcceptanceStopStatus)=>void){
  if(!finite(options.endGameMinute)||!Number.isSafeInteger(options.maxWallMs)||options.maxWallMs<1||options.maxWallMs>2_147_483_647
   ||!Number.isSafeInteger(options.maxRequests)||options.maxRequests<1||!options.allowedModels.length
   ||options.allowedModels.some(model=>!ACCEPTANCE_FREE_MODEL_ALLOWLIST.some(allowed=>allowed===model))
   ||new Set(options.allowedModels).size!==options.allowedModels.length)throw new Error('invalid_acceptance_stop_options');
  if(options.unreceiptedFreePolicy!==undefined&&(options.unreceiptedFreePolicy!=='siliconflow-deepseek-published-zero'
   ||options.allowedModels.length!==1||options.allowedModels[0]!==DEEPSEEK_MODEL))throw new Error('invalid_official_free_policy');
  this.options={...options,allowedModels:[...options.allowedModels]};this.allowed=new Set(options.allowedModels);this.clock=options.clock??systemClock;
 }
 start(gameMinute:number){
  if(this.phase!=='not_started')throw new Error('acceptance_stop_control_is_single_use');
  this.phase='running';this.fromMinute=gameMinute;this.gameMinute=gameMinute;
  if(!finite(gameMinute)||gameMinute>this.options.endGameMinute){this.stop('game_time_invalid');return;}
  if(!this.readClock())return;
  this.options.signal?.addEventListener('abort',this.abortListener,{once:true});
  if(this.options.signal?.aborted){this.stop('signal');return;}
  this.armTimer();
 }
 private readClock():boolean{
  let now:number;try{now=this.clock.now();}catch{now=NaN;}
  if(!finite(now)||this.lastMs!==null&&now<this.lastMs){this.elapsedMs=null;this.stop('clock_invalid');return false;}
  this.startMs??=now;this.lastMs=now;this.elapsedMs=now-this.startMs;
  if(this.elapsedMs>=this.options.maxWallMs){this.stop('wall_limit');return false;}
  return this.phase==='running';
 }
 private armTimer(){
  if(this.phase!=='running')return;
  try{
   this.timer=this.clock.setTimer(()=>{this.timerArmed=false;if(this.phase==='running'&&this.readClock())this.armTimer();},this.options.maxWallMs-this.elapsedMs!);
   this.timerArmed=true;
  }catch{this.issues.add('timer_failed');this.stop('runtime_failed');}
 }
 check(gameMinute:number):boolean{
  if(this.phase!=='running')return false;
  if(!finite(gameMinute)||this.gameMinute!==null&&gameMinute<this.gameMinute){this.stop('game_time_invalid');return false;}
  this.gameMinute=gameMinute;
  if(gameMinute>this.options.endGameMinute){this.stop('endpoint_missed');return false;}
  return this.readClock();
 }
 /** Track a successful store commit before fallible observers can request stop.
  * This updates only the durable position, never fabricates an endpoint sample. */
 recordCommittedMinute(gameMinute:number){
  if(this.phase!=='running')return;
  if(!finite(gameMinute)||this.gameMinute!==null&&gameMinute<this.gameMinute){this.stop('game_time_invalid');return;}
  this.gameMinute=gameMinute;if(gameMinute>this.options.endGameMinute)this.stop('endpoint_missed');
 }
 /** No overshoot, catch-up or fabricated sample. Caller must commit the returned step. */
 clampAdvance(gameMinute:number,requested:number):number{
  if(!this.check(gameMinute))return 0;
  if(!finite(requested)){this.stop('game_time_invalid');return 0;}
  return Math.min(requested,this.options.endGameMinute-gameMinute);
 }
 private priceAllowed(model:ModelName):boolean{
  if(this.phase!=='running')return false;
  if(!this.allowed.has(model)){this.stop('model_not_allowed');return false;}
  let price:FreePriceAssessment|null;try{price=this.options.assessPrice(model);}catch{price=null;}
  if(!price||price.model!==model||price.currency!=='USD'||!finite(price.validUntilMonotonicMs)
   ||price.validUntilMonotonicMs<=this.lastMs!||![price.inputPerMillion,price.outputPerMillion,price.perRequest,price.otherFees].every(finite)){
   this.stop('cost_unknown');return false;
  }
  if([price.inputPerMillion,price.outputPerMillion,price.perRequest,price.otherFees].some(value=>value!==0)){
   this.stop('nonzero_cost');return false;
  }
  // Price assessment is user code and may consume time or request termination.
  if(this.phase!=='running'||!this.readClock())return false;
  return price.validUntilMonotonicMs>this.lastMs!||this.expiredPrice();
 }
 private expiredPrice(){if(this.phase==='running')this.stop('cost_unknown');return false;}
 validateModels(models:readonly ModelName[]):boolean{
  if(!models.length){this.stop('model_not_allowed');return false;}
  return models.every(model=>this.priceAllowed(model));
 }
 reserve(model:ModelName,gameMinute:number):AcceptanceRequest|null{
  if(!this.check(gameMinute)||gameMinute===this.options.endGameMinute)return null;
  if(this.reserved>=this.options.maxRequests){this.stop('request_limit');return null;}
  if(!this.priceAllowed(model))return null;
  // The assessment callback may have made another reservation synchronously.
  if(this.reserved>=this.options.maxRequests){this.stop('request_limit');return null;}
  const controller=new AbortController(),token=Object.freeze({id:++this.reserved,model,signal:controller.signal});
  this.requests.set(token.id,{token,controller,dispatched:false});return token;
 }
 /** Last gate immediately before calling the injected transport. Reservations that
  * never reach this point consume headroom but are not reported as network calls. */
 dispatch(token:AcceptanceRequest,gameMinute:number):boolean{
  const state=this.requests.get(token.id);
  if(!state||state.token!==token||state.dispatched||!this.check(gameMinute)||!this.priceAllowed(token.model))return false;
  // Recheck after injected assessment: it can reenter dispatch or terminate.
  if(this.phase!=='running'||this.requests.get(token.id)!==state||state.dispatched)return false;
  state.dispatched=true;this.dispatched++;return true;
 }
 /** A token count is not a cost receipt. Missing/partial/failed billing is unknown. */
 settle(token:AcceptanceRequest,gameMinute:number,costUsd:unknown):boolean{
  const state=this.requests.get(token.id);
  if(!state||state.token!==token||!state.dispatched||this.phase!=='running')return false;
  this.requests.delete(token.id);this.settled++;
  if(!finite(costUsd)){
   this.unknownCost++;
   // Published zero-price admission is distinct from a settled provider bill.
   // Never label the missing receipt zero or mark cost/control fully verified.
   if(costUsd===undefined&&this.options.unreceiptedFreePolicy==='siliconflow-deepseek-published-zero'
    &&this.priceAllowed(token.model))return this.check(gameMinute);
   this.stop('cost_unknown');return false;
  }
  this.knownCost+=costUsd;
  if(costUsd!==0){this.stop('nonzero_cost');return false;}
  return this.check(gameMinute);
 }
 /** Invoked only with the post-commit world, before any new admissions. */
 committed(world:World):boolean{
  if(!this.check(world.minute))return false;
  if(world.minute!==this.options.endGameMinute)return true;
  this.endpoint=Object.freeze({worldId:world.id,gameMinute:world.minute,revision:world.revision,
   residents:Object.freeze(world.residents.map(r=>Object.freeze({id:r.id,status:r.status,health:r.health,hunger:r.hunger,energy:r.energy})))});
  try{
   const returned:unknown=this.options.observeEndpoint?.(this.endpoint);
   if(isThenable(returned)){void Promise.resolve(returned).catch(()=>{});throw new Error('async_endpoint_observer');}
  }catch{this.issues.add('endpoint_observer_failed');this.stop('endpoint_observer_failed');return false;}
  // Sampling may itself exhaust the wall budget; exact endpoint remains recorded,
  // but the wall limit wins and cannot be labelled a successfully closed run.
  if(this.phase!=='running'||!this.readClock())return false;
  this.stop('game_endpoint');return false;
 }
 stop(reason:AcceptanceStopReason='manual_stop'){
  if(this.phase==='stopped'||this.stopping)return;
  this.stopping=true;
  if(this.phase==='running'&&reason!=='clock_invalid'){
   try{const now=this.clock.now();if(finite(now)&&this.lastMs!==null&&now>=this.lastMs){this.lastMs=now;this.elapsedMs=now-this.startMs!;}else this.elapsedMs=null;}catch{this.elapsedMs=null;}
  }
  // A final clock read can fail or reach the deadline after the sampling check.
  if(reason==='game_endpoint')reason=this.elapsedMs===null?'clock_invalid':this.elapsedMs>=this.options.maxWallMs?'wall_limit':reason;
  this.phase='stopped';this.reason=reason;
  // A durable owner can mark shutdown intent before any abort, world write or
  // subscriber can terminate the process. Unfinished shutdown is not clean.
  try{const returned:unknown=this.onStopping?.(this.status());
   if(isThenable(returned)){void Promise.resolve(returned).catch(()=>{});throw new Error('async_stopping_observer');}
  }catch{this.issues.add('evidence_persistence_failed');}
  this.options.signal?.removeEventListener('abort',this.abortListener);
  if(this.timerArmed){try{this.clock.clearTimer(this.timer);}catch{this.issues.add('timer_failed');}this.timerArmed=false;}
  const requests=[...this.requests.values()];this.requests.clear();
  this.unfinished=Object.freeze(requests.map(r=>Object.freeze({id:r.token.id,model:r.token.model,dispatched:r.dispatched})));
  for(const request of requests){if(request.dispatched){this.interrupted++;this.unknownCost++;}request.controller.abort();}
  try{this.onStop();}catch{this.issues.add('shutdown_failed');}
  // Persist only after shutdown has either completed or recorded its failure.
  // A failed/async sink cannot retroactively claim successful control.
  try{const returned:unknown=this.onStopped?.(this.status());
   if(isThenable(returned)){void Promise.resolve(returned).catch(()=>{});throw new Error('async_stop_observer');}
  }catch{this.issues.add('evidence_persistence_failed');}
  this.stopping=false;
 }
 status(){return {phase:this.phase,reason:this.reason,fromMinute:this.fromMinute,throughMinute:this.gameMinute,
  targetMinute:this.options.endGameMinute,maxWallMs:this.options.maxWallMs,maxRequests:this.options.maxRequests,
  elapsedMs:this.elapsedMs,requestReservations:this.reserved,dispatchedRequests:this.dispatched,settledResponses:this.settled,
  interruptedRequests:this.interrupted,unfinishedRequests:this.unfinished,unknownCostRequests:this.unknownCost,confirmedCostUsd:this.unknownCost?null:this.knownCost,
  endpoint:this.endpoint,gameScopeComplete:this.endpoint!==null,controlComplete:this.reason==='game_endpoint'&&this.elapsedMs!==null&&this.issues.size===0&&this.unknownCost===0,
  issues:[...this.issues],remoteCancellationConfirmed:false,acceptancePassed:null};}
}

export type AcceptanceStopStatus=ReturnType<AcceptanceStopControl['status']>;

/** Explicit opt-in binding only. No process.exit, process-global handlers at import,
 * or handling of SIGKILL. Caller owns writer close and removes listeners on cleanup. */
export function bindAcceptanceTermination(source:{on:(event:'SIGINT'|'SIGTERM',listener:()=>void)=>unknown;
 off:(event:'SIGINT'|'SIGTERM',listener:()=>void)=>unknown},stop:()=>void){
 const handler=()=>stop();source.on('SIGINT',handler);source.on('SIGTERM',handler);
 return ()=>{source.off('SIGINT',handler);source.off('SIGTERM',handler);};
}

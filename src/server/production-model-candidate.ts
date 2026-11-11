/** Offline-only exercise of the production guard. The branded memory transport
 * cannot be substituted with fetch, an HTTP callback, credentials, or a URL.
 * A real adapter and authenticated free-price evidence remain release blockers. */
import {modelRequestPayload,type ModelMessage,type ModelReply} from './model-completion.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {ProductionModelJournal,modelEvidenceHash} from './production-model-journal.js';
type Clock={now:()=>number;setTimer:(callback:()=>void,ms:number)=>unknown;clearTimer:(timer:unknown)=>void};
type Result={status:number;model:string;endpoint:string;reply:ModelReply};
type Call={request:Readonly<{id:number;endpoint:string;model:string;body:string;signal:AbortSignal}>;resolve:(result:unknown)=>void;promise:Promise<unknown>};
export type MemoryProductionTransport=Readonly<{kind:'memory-production-candidate'}>;
const transports=new WeakMap<MemoryProductionTransport,{claimed:boolean;calls:Call[]}>();
export function createMemoryProductionTransport(){
 const transport=Object.freeze({kind:'memory-production-candidate'} as const),state={claimed:false,calls:[] as Call[]};transports.set(transport,state);
 return {transport,requests:()=>state.calls.map(c=>({...c.request})),
  respond:(index:number,result:unknown)=>state.calls[index].resolve(structuredClone(result))};
}
const systemClock:Clock={now:()=>Date.now(),setTimer:(callback,ms)=>setTimeout(callback,ms),clearTimer:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
const token=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
export class ProductionModelCandidate{
 private state:{claimed:boolean;calls:Call[]};private clock:Clock;private closed=false;private lastNow:number;
 private active:{id:number;controller:AbortController;cancel:()=>void;timer:unknown;armed:boolean}|null=null;
 private failure:string|null=null;private persistenceHealthy=true;
 constructor(private journal:ProductionModelJournal,transport:MemoryProductionTransport,private options:{clock?:Clock;onStop?:(reason:string)=>void}={}){
  if(journal.contract.executionKind!=='synthetic-production-candidate')throw new Error('synthetic_journal_required');
  const state=transports.get(transport);if(!state||state.claimed)throw new Error('synthetic_transport_required');
  state.claimed=true;this.state=state;this.clock=options.clock??systemClock;this.lastNow=journal.status().lastObservedAtMs;
  this.failure=journal.status().failure;this.closed=this.failure!==null;
 }
 private now(){const at=this.clock.now();if(!Number.isSafeInteger(at)||at<this.lastNow)throw new Error('clock_invalid');this.lastNow=at;return at;}
 private check(){if(this.closed)throw new Error(this.failure??'model_stopped');this.journal.check(this.now());}
 stop(reason='manual_stop'){
  if(this.closed)return;this.closed=true;this.failure=reason;
  try{this.journal.block(reason);}catch{this.persistenceHealthy=false;this.failure='journal_write_failed';}
  const active=this.active;this.active=null;
  if(active){if(active.armed){try{this.clock.clearTimer(active.timer);}catch{this.failure='timer_cleanup_failed';}}active.controller.abort();active.cancel();}
  try{this.options.onStop?.(this.failure);}catch{this.failure='stop_callback_failed';}
 }
 async complete(messages:ModelMessage[],options:{model?:string;signal?:AbortSignal}={}):Promise<{id:number;reply:ModelReply}|null>{
  let active:NonNullable<ProductionModelCandidate['active']>|null=null;
  const onAbort=()=>this.stop('signal');
  try{
   this.check();
   if(this.active){this.stop('concurrency_violation');return null;}
   if(options.model!==undefined&&options.model!==P.model){this.stop('model_not_allowed');return null;}
   if(options.signal?.aborted){this.stop('signal');return null;}
   const body=modelRequestPayload(P.model,messages,0.25);
   // The FULL SQLite intent commit must succeed before the transport can see it.
   const at=this.now(),id=this.journal.intent(modelEvidenceHash(body),at),controller=new AbortController();
   let cancel!:()=>void;
   const cancelled=new Promise<null>(resolve=>{cancel=()=>resolve(null);});
   active={id,controller,cancel,timer:undefined,armed:false};this.active=active;
   options.signal?.addEventListener('abort',onAbort,{once:true});
   if(options.signal?.aborted){this.stop('signal');return null;}
   let registering=true,early=false;
   const wallRemaining=this.journal.contract.deadlineAtMs-at,timeout=Math.min(this.journal.contract.requestTimeoutMs,wallRemaining);
   active.timer=this.clock.setTimer(()=>{if(registering){early=true;return;}this.stop(timeout===wallRemaining?'wall_limit':'request_timeout');},timeout);
   active.armed=true;registering=false;if(early){this.stop('clock_invalid');return null;}
   this.check();
   let resolve!:(result:unknown)=>void;const promise=new Promise<unknown>(yes=>{resolve=yes;});
   this.state.calls.push({request:Object.freeze({id,endpoint:P.endpoint,model:P.model,body,signal:controller.signal}),promise,resolve});
   const raw=await Promise.race([promise,cancelled]);
   if(this.closed||this.active!==active)return null;
   this.check();
   // A late timer cannot be bypassed by a response microtask after the deadline.
   if(this.now()-at>=this.journal.contract.requestTimeoutMs){this.stop('request_timeout');return null;}
   const result=raw as Result;
   if(!result||result.endpoint!==P.endpoint||result.model!==P.model){this.stop('response_identity_mismatch');return null;}
   if(result.status!==200){this.stop([401,402,403,429].includes(result.status)?`model_http_${result.status}`:'model_http_failed');return null;}
   const reply=result.reply;
   if(!reply||typeof reply.content!=='string'||Buffer.byteLength(reply.content)>128_000||reply.finish!=='stop'
    ||!token(reply.usage?.prompt_tokens)||!token(reply.usage?.completion_tokens)){this.stop('response_invalid');return null;}
   // Usage is observation only. It is never converted into a zero bill.
   this.journal.response(id,modelEvidenceHash(reply),this.now());
   this.clock.clearTimer(active.timer);active.armed=false;this.active=null;
   return {id,reply:structuredClone(reply)};
  }catch(error){this.stop(error instanceof Error&&/^[a-z_0-9]{1,96}$/.test(error.message)?error.message:'model_failed');return null;}
  finally{options.signal?.removeEventListener('abort',onAbort);}
 }
 /** Call only after the corresponding world transaction durably commits. A
  * response alone never clears pending intent or authorizes another dispatch. */
 acknowledgeWorldCommit(id:number,worldFingerprint:string){
  try{this.check();this.journal.acknowledgeWorldCommit(id,worldFingerprint,this.now());return true;}
  catch(error){this.stop(error instanceof Error?error.message:'world_commit_failed');return false;}
 }
 status(){return {...this.journal.status(),phase:this.closed?'blocked':'candidate-only',failure:this.failure??this.journal.status().failure,
  persistenceHealthy:this.persistenceHealthy&&this.journal.status().persistenceHealthy,transportInvocations:this.state.calls.length,
  inFlight:this.active?1:0,remoteCancellationConfirmed:false} as const;}
}

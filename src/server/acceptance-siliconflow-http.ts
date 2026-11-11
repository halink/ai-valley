/** Disconnected HTTP rehearsal. Never calls fetch, accepts a key, reads a save or
 * creates a network-capable adapter. Real authorization/billing remain unknown. */
import {createHash} from 'node:crypto';
import {DEEPSEEK_MODEL,SILICONFLOW_COMPLETIONS_ENDPOINT,modelRequestPayload,type ModelMessage,type ModelReply} from './model-completion.js';
import type {AcceptanceClock} from './acceptance-stop-control.js';

export const SILICONFLOW_HTTP_REHEARSAL=Object.freeze({schema:1,protocol:'nine-siliconflow-http-rehearsal-v1',
 executionKind:'synthetic-http-only',model:DEEPSEEK_MODEL,endpoint:SILICONFLOW_COMPLETIONS_ENDPOINT,
 modelSlots:1,maxRequests:24,maxWallMs:20_000,requestTimeoutMs:5_000,maxResponseBytes:32_000,
 retries:0,fallback:null,redirect:'error',realModelExecuted:false,readyForRealRun:false,acceptancePassed:null} as const);
const P=SILICONFLOW_HTTP_REHEARSAL,hash=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(v);
function data(input:unknown,keys:string[]){
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new Error('invalid_fixture');
 const own=Reflect.ownKeys(input);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))throw new Error('invalid_fixture');
 const result:Record<string,unknown>={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(input,key);if(!d||!('value'in d))throw new Error('invalid_fixture');result[key]=d.value;}return result;
}
type Deferred<T>={promise:Promise<{value:T}>;resolve:(value:T)=>void};
function deferred<T>():Deferred<T>{let resolve!:(value:{value:T})=>void;const promise=new Promise<{value:T}>(yes=>{resolve=yes;});return {promise,resolve:value=>resolve({value})};}
export type SyntheticHttpReceipt={provenance:'synthetic-fixture';requestId:number;providerRequestId:string;model:string;endpoint:string;currency:'USD';allChargesFinal:true;totalUsd:number};
export type SyntheticHttpHeaders={status:number;endpoint:string;redirected:boolean;contentType:string;contentLength:string|null;receipt:unknown};
export type SyntheticHttpTransport=Readonly<{kind:'memory-siliconflow-http'}>;
type Request=Readonly<{id:number;endpoint:string;method:'POST';redirect:'error';headers:Readonly<Record<string,string>>;body:string;signal:AbortSignal}>;
type Call={request:Request;headers:Deferred<unknown>;chunks:Deferred<unknown>[];read:number;cancelled:boolean};
const transports=new WeakMap<SyntheticHttpTransport,{claimed:boolean;calls:Call[]}>();
/** Branded memory capability: no fetch callback, URL/key override, or live mode.
 * Headers/body are independently released to model stalled and late HTTP stages. */
export function createMemorySiliconFlowHttp(){
 const transport=Object.freeze({kind:'memory-siliconflow-http'} as const),state={claimed:false,calls:[] as Call[]};transports.set(transport,state);
 function chunk(index:number,value:unknown){const call=state.calls[index];let target=call.chunks.find(c=>!(c as any).released);
  if(!target){target=deferred<unknown>();call.chunks.push(target);}(target as any).released=true;target.resolve(value);}
 return {transport,requests:()=>state.calls.map(c=>c.request),
  resolveHeaders:(index:number,headers:unknown)=>state.calls[index].headers.resolve(headers),
  pushChunk:(index:number,bytes:unknown)=>chunk(index,bytes instanceof Uint8Array?new Uint8Array(bytes):bytes),
  endBody:(index:number)=>chunk(index,null),failBody:(index:number)=>chunk(index,false),
  bodyCancelled:(index:number)=>state.calls[index].cancelled};
}
export type HttpRehearsalReason='disabled'|'transport_reused'|'evidence_failed'|'concurrency_violation'|'request_limit'|'wall_limit'|'request_timeout'
 |'clock_invalid'|'input_invalid'|'response_invalid'|'redirect_rejected'|'http_failed'|'rate_limited'|'body_invalid'|'model_mismatch'
 |'cost_unknown'|'nonzero_cost'|'decision_invalid'|'manual_stop'|'signal';
export type HttpRehearsalEvidence={schema:1;executionKind:'synthetic-http-only';sequence:number;type:'gate'|'dispatch_intent'|'transport_invoked'|'headers'|'body'|'completion'|'stopped';
 requestId:number|null;atMs:number|null;details:Readonly<Record<string,string|number|boolean|null>>};
export type HttpRehearsalOptions={transport?:SyntheticHttpTransport;persist?:(event:HttpRehearsalEvidence)=>true;
 clock?:AcceptanceClock;signal?:AbortSignal;onStop?:(reason:HttpRehearsalReason)=>void};
const systemClock:AcceptanceClock={now:()=>performance.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};
/** Preparation only. This is not a real price checker, approval token, HTTP client
 * or full acceptance runner. Synchronous callbacks are trusted local code. */
export class SiliconFlowHttpRehearsal {
 private phase:'new'|'starting'|'ready'|'stopped'='new';private reason:HttpRehearsalReason|null=null;
 private options:HttpRehearsalOptions;private clock:AcceptanceClock;private state?:{claimed:boolean;calls:Call[]};
 private started=0;private last:number|null=null;private sequence=0;private attempts=0;private invoked=0;private completed=0;
 private knownCost=0;private unknownCost=0;private evidenceFailed=false;private cleanupFailed=false;private stopCallbackFailed=false;
 private wall:unknown;private wallArmed=false;
 private active:{id:number;started:number;controller:AbortController;done:Deferred<null>;timer:unknown;armed:boolean;costKnown:boolean;call?:Call}|null=null;
 private abort=()=>this.stop('signal');
 constructor(options:HttpRehearsalOptions={}){this.options={...options};this.clock=options.clock??systemClock;}
 private now(){let v;try{v=this.clock.now();}catch{return null;}if(!finite(v)||this.last!==null&&v<this.last)return null;this.last=v;return v;}
 private emit(type:HttpRehearsalEvidence['type'],requestId:number|null,details:HttpRehearsalEvidence['details']){
  const event=Object.freeze({schema:1,executionKind:P.executionKind,sequence:++this.sequence,type,requestId,atMs:this.last,details:Object.freeze({...details})} as const);
  try{const result:unknown=this.options.persist?.(event);if(result!==true){if(result instanceof Promise)void result.catch(()=>{});throw new Error('unconfirmed_persistence');}return true;}
  catch{this.evidenceFailed=true;return false;}
 }
 start(){
  if(this.phase!=='new')return false;this.phase='starting';const now=this.now();if(now===null){this.stop('clock_invalid');return false;}this.started=now;
  this.state=this.options.transport?transports.get(this.options.transport):undefined;
  if(!this.state||!this.options.persist){this.stop('disabled');return false;}
  if(this.state.claimed){this.stop('transport_reused');return false;}this.state.claimed=true;
  this.options.signal?.addEventListener('abort',this.abort,{once:true});if(this.options.signal?.aborted){this.stop('signal');return false;}
  if(!this.emit('gate',null,{model:P.model,endpoint:P.endpoint,maxRequests:P.maxRequests,maxWallMs:P.maxWallMs,requestTimeoutMs:P.requestTimeoutMs,
   modelSlots:1,retries:0,fallback:null,realAuthorization:false,realProviderCostUsd:null,accountAvailabilityVerified:false})){this.stop('evidence_failed');return false;}
  if(!this.isStarting())return false;this.phase='ready';if(!this.check())return false;this.armWall();return this.phase==='ready';
 }
 private isStarting(){return this.phase==='starting';}
 private check(){
  if(this.phase!=='ready')return false;const now=this.now();if(now===null){this.stop('clock_invalid');return false;}
  if(now-this.started>=P.maxWallMs){this.stop('wall_limit');return false;}
  if(this.active&&now-this.active.started>=P.requestTimeoutMs){this.stop('request_timeout');return false;}return this.phase==='ready';
 }
 private armWall(){try{let registering=true,early=false;this.wall=this.clock.setTimer(()=>{if(registering){early=true;return;}this.wallArmed=false;if(this.check())this.armWall();},P.maxWallMs-(this.last!-this.started));
   registering=false;this.wallArmed=true;if(early)this.stop('clock_invalid');if(this.phase!=='ready')this.clearWall();
  }catch{this.cleanupFailed=true;this.stop('clock_invalid');}}
 private clearWall(){if(this.wallArmed){this.wallArmed=false;try{this.clock.clearTimer(this.wall);}catch{this.cleanupFailed=true;}}}
 private clearRequest(active:NonNullable<SiliconFlowHttpRehearsal['active']>){if(active.armed){active.armed=false;try{this.clock.clearTimer(active.timer);}catch{this.cleanupFailed=true;return false;}}return true;}
 /** Caller content stays inside the branded in-memory transport. No key argument. */
 async complete(messages:ModelMessage[],signal?:AbortSignal):Promise<ModelReply|null>{
  if(!this.check())return null;if(this.active){this.stop('concurrency_violation');return null;}if(this.attempts>=P.maxRequests){this.stop('request_limit');return null;}
  const active={id:++this.attempts,started:this.last!,controller:new AbortController(),done:deferred<null>(),timer:undefined as unknown,armed:false,costKnown:false,call:undefined as Call|undefined};this.active=active;
  const onAbort=()=>this.stop('signal');signal?.addEventListener('abort',onAbort,{once:true});
  const current=()=>this.active===active&&this.phase==='ready'&&this.check();
  const race=async(p:Promise<{value:unknown}>)=>Promise.race([p,active.done.promise.then(()=>({stopped:true}))]);
  try{
   if(signal?.aborted){this.stop('signal');return null;}
   let body:string;try{body=modelRequestPayload(P.model,messages,0.25);}catch{this.stop('input_invalid');return null;}
   if(!current())return null;
   if(!this.emit('dispatch_intent',active.id,{model:P.model,endpoint:P.endpoint,requestBodyHash:hash(body),requestBytes:Buffer.byteLength(body),networkDispatchConfirmed:false})||!current()){
    if(this.phase==='ready')this.stop('evidence_failed');return null;}
   let registering=true,early=false;
   try{active.timer=this.clock.setTimer(()=>{if(registering){early=true;return;}if(this.active===active)this.stop('request_timeout');},P.requestTimeoutMs-(this.last!-active.started));
    registering=false;active.armed=true;if(early){this.stop('clock_invalid');return null;}if(!current()){this.clearRequest(active);return null;}
   }catch{this.cleanupFailed=true;this.stop('clock_invalid');return null;}
   const call:Call={request:Object.freeze({id:active.id,endpoint:P.endpoint,method:'POST',redirect:'error',
    headers:Object.freeze({'Content-Type':'application/json',Authorization:'Bearer SYNTHETIC-NOT-A-CREDENTIAL'}),body,signal:active.controller.signal}),headers:deferred<unknown>(),chunks:[],read:0,cancelled:false};
   active.call=call;this.state!.calls.push(call);this.invoked++;
   if(!this.emit('transport_invoked',active.id,{transport:'memory-only',networkDispatchConfirmed:false})||!current()){if(this.phase==='ready')this.stop('evidence_failed');return null;}
   const result=await race(call.headers.promise);if(!current()||!('value'in result))return null;
   const header=this.headerEvidence(result.value,active.id);if(header.cost!==null){active.costKnown=true;this.knownCost+=header.cost;}
   if(!this.emit('headers',active.id,header.details)){this.stop('evidence_failed');return null;}if(!current())return null;
   if(header.reason){this.stop(header.reason);return null;}
   const chunks:Uint8Array[]=[];let bytes=0;
   for(;;){let next=call.chunks[call.read++];if(!next){next=deferred<unknown>();call.chunks.push(next);}const part=await race(next.promise);
    if(!current()||!('value'in part))return null;if(part.value===null)break;
    if(!(part.value instanceof Uint8Array)){this.stop('body_invalid');return null;}bytes+=part.value.byteLength;
    if(bytes>P.maxResponseBytes){this.stop('body_invalid');return null;}chunks.push(part.value);
   }
   if(header.length!==null&&header.length!==bytes){this.stop('body_invalid');return null;}
   const combined=Buffer.concat(chunks);if(!this.emit('body',active.id,{bytes,sha256:hash(combined)})){this.stop('evidence_failed');return null;}if(!current())return null;
   let value:any;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));}catch{this.stop('body_invalid');return null;}
   const modelMatches=value?.model===P.model;const usage=value?.usage;
   const input=Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0?usage.prompt_tokens:null;
   const output=Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0?usage.completion_tokens:null;
   const choice=Array.isArray(value?.choices)&&value.choices.length===1?value.choices[0]:null;
   if(!this.emit('completion',active.id,{modelMatches,claimedModelHash:typeof value?.model==='string'?hash(value.model):null,
    inputTokens:input,outputTokens:output,realProviderCostUsd:null,syntheticCostUsd:header.cost})){this.stop('evidence_failed');return null;}
   if(!current())return null;if(!modelMatches){this.stop('model_mismatch');return null;}
   if(!choice||typeof choice.message?.content!=='string'||choice.finish_reason!=='stop'||input===null||output===null){this.stop('response_invalid');return null;}
   if(!this.clearRequest(active)){this.stop('clock_invalid');return null;}if(!current())return null;
   this.active=null;this.completed++;return {content:choice.message.content,finish:'stop',usage:{prompt_tokens:input,completion_tokens:output}};
  }catch{if(this.phase==='ready')this.stop('response_invalid');return null;}
  finally{signal?.removeEventListener('abort',onAbort);if(active.call)active.call.cancelled=true;}
 }
 private headerEvidence(input:unknown,requestId:number):{reason:HttpRehearsalReason|null;cost:number|null;length:number|null;details:HttpRehearsalEvidence['details']}{
  let meta:Record<string,unknown>;try{meta=data(input,['status','endpoint','redirected','contentType','contentLength','receipt']);}
  catch{return {reason:'response_invalid' as HttpRehearsalReason,cost:null,length:null,details:{metadataValid:false,costUsd:null,realProviderCostUsd:null}};}
  let cost:number|null=null,providerRequestId:string|null=null;
  try{const receipt=data(meta.receipt,['provenance','requestId','providerRequestId','model','endpoint','currency','allChargesFinal','totalUsd']);
   if(receipt.provenance!=='synthetic-fixture'||receipt.requestId!==requestId||!id(receipt.providerRequestId)||receipt.model!==P.model||receipt.endpoint!==P.endpoint
    ||receipt.currency!=='USD'||receipt.allChargesFinal!==true||!finite(receipt.totalUsd))throw new Error('unknown_cost');
   cost=receipt.totalUsd;providerRequestId=receipt.providerRequestId;
  }catch{}
  const valid=Number.isInteger(meta.status)&&(meta.status as number)>=100&&(meta.status as number)<=599&&typeof meta.redirected==='boolean';
  const length=typeof meta.contentLength==='string'&&/^(0|[1-9][0-9]*)$/.test(meta.contentLength)?Number(meta.contentLength):null;
  const reason:HttpRehearsalReason|null=!valid?'response_invalid':meta.endpoint!==P.endpoint||meta.redirected||((meta.status as number)>=300&&(meta.status as number)<400)?'redirect_rejected'
   :cost===null?'cost_unknown':cost!==0?'nonzero_cost':meta.status===429?'rate_limited':meta.status!==200?'http_failed'
   :typeof meta.contentType!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(meta.contentType)
    ||meta.contentLength!==null&&(length===null||!Number.isSafeInteger(length)||length>P.maxResponseBytes)?'response_invalid':null;
  return {reason,cost,length,details:{metadataValid:valid,httpStatus:Number.isInteger(meta.status)?meta.status as number:null,endpointMatches:meta.endpoint===P.endpoint,
   redirected:typeof meta.redirected==='boolean'?meta.redirected:null,costUsd:cost,costProvenance:cost===null?null:'synthetic-fixture',providerRequestId,realProviderCostUsd:null}};
 }
 stop(reason:HttpRehearsalReason='manual_stop'){
  if(this.phase==='stopped')return;this.phase='stopped';this.reason=reason;this.options.signal?.removeEventListener('abort',this.abort);this.clearWall();
  const active=this.active;this.active=null;if(active){this.clearRequest(active);if(active.call&&!active.costKnown)this.unknownCost++;active.controller.abort();active.done.resolve(null);if(active.call)active.call.cancelled=true;}
  this.emit('stopped',active?.id??null,{reason,unknownCostRequests:this.unknownCost,syntheticCostUsd:this.invoked===0||this.unknownCost?null:this.knownCost,
   realProviderCostUsd:null,remoteCancellationConfirmed:false});
  try{this.options.onStop?.(reason);}catch{this.stopCallbackFailed=true;}
 }
 status(){return {phase:this.phase,reason:this.reason,attempts:this.attempts,transportInvocations:this.invoked,completedResponses:this.completed,
  inFlight:this.active?1:0,unknownCostRequests:this.unknownCost,syntheticCostUsd:this.invoked===0||this.unknownCost?null:this.knownCost,
  evidencePersisted:!this.evidenceFailed,timerCleanupComplete:!this.cleanupFailed,stopCallbackComplete:!this.stopCallbackFailed,
  realModelExecuted:false,readyForRealRun:false,realProviderCostUsd:null,accountAvailabilityVerified:false,remoteCancellationConfirmed:false,acceptancePassed:null};}
}

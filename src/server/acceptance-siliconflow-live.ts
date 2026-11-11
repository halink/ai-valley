/** Explicitly enabled, bounded live transport. Never reads credentials or saves.
 * persist is a trusted synchronous durable writer, not an asynchronous logger.
 * Price evidence is an operator observation, NOT a per-request billing receipt. */
import {createHash} from 'node:crypto';
import {DEEPSEEK_MODEL,SILICONFLOW_COMPLETIONS_ENDPOINT,modelRequestPayload,type ModelMessage,type ModelReply} from './model-completion.js';
import type {AcceptanceClock} from './acceptance-stop-control.js';
export const SILICONFLOW_LIVE=Object.freeze({model:DEEPSEEK_MODEL,endpoint:SILICONFLOW_COMPLETIONS_ENDPOINT,
 maxRequests:9,maxWallMs:180_000,requestTimeoutMs:45_000,maxResponseBytes:64_000,maxRequestBytes:41_000,
 modelSlots:1,retries:0,fallback:null,redirect:'error',billingBasis:'official-free-price'} as const);
export const SILICONFLOW_LIVE_PROFILES=Object.freeze({probe:Object.freeze({maxRequests:9,maxWallMs:180_000,requestTimeoutMs:45_000,maxResponseBytes:64_000})});
export const SILICONFLOW_PRICE_SOURCES=Object.freeze(['https://www.siliconflow.cn/pricing','https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation']);
const P=SILICONFLOW_LIVE,hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
export type OfficialFreePriceEvidence={sourceUrls:readonly string[];observedAtMs:number;expiresAtMs:number;
 model:typeof DEEPSEEK_MODEL;inputPricePerMillion:0;outputPricePerMillion:0};
export type LiveStopReason='disabled'|'price_evidence_invalid'|'evidence_failed'|'clock_invalid'|'input_invalid'|'signal'|'manual_stop'
 |'concurrency_violation'|'request_limit'|'wall_limit'|'request_timeout'|'http_failed'|'rate_limited'|'redirect_rejected'|'response_invalid'|'body_invalid'|'model_mismatch';
export type LiveEvidence={schema:1;executionKind:'live-http'|'mocked-http';sequence:number;type:'gate'|'dispatch_intent'|'transport_invoked'|'headers'|'body'|'completion'|'stopped';
 requestId:number|null;atMs:number|null;details:Readonly<Record<string,string|number|boolean|null>>};
export type SiliconFlowLiveOptions={enabled?:boolean;profile?:'probe';key?:string;dataApproved?:boolean;priceEvidence?:OfficialFreePriceEvidence;
 persist?:(event:LiveEvidence)=>true;fetch?:typeof fetch;clock?:AcceptanceClock;wallNow?:()=>number;signal?:AbortSignal;onStop?:(reason:LiveStopReason)=>void};
const systemClock:AcceptanceClock={now:()=>performance.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};
const validNumber=(v:number)=>Number.isFinite(v)&&v>=0;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/.test(v);
type Active={id:number;started:number;controller:AbortController;done:Promise<null>;resolve:()=>void;timer?:unknown;reader?:ReadableStreamDefaultReader<Uint8Array>};
export class SiliconFlowLive {
 private profile:typeof SILICONFLOW_LIVE_PROFILES[keyof typeof SILICONFLOW_LIVE_PROFILES];private options:SiliconFlowLiveOptions;private key:string;private clock:AcceptanceClock;
 private phase:'new'|'starting'|'ready'|'stopped'='new';private reason:LiveStopReason|null=null;
 private active:Active|null=null;private wall:unknown;private wallArmed=false;private wallGeneration=0;private started=0;private last:number|null=null;private lastWall:number|null=null;
 private sequence=0;private attempts=0;private invoked=0;private completed=0;private evidenceFailed=false;private cleanupFailed=false;private callbackFailed=false;
 private abort=()=>this.stop('signal');
 constructor(options:SiliconFlowLiveOptions={}){
  this.profile=SILICONFLOW_LIVE_PROFILES[options.profile??'probe'];this.key=options.key??'';this.options={...options,key:undefined,priceEvidence:options.priceEvidence?Object.freeze({...options.priceEvidence,sourceUrls:Object.freeze([...options.priceEvidence.sourceUrls])}):undefined};
  this.clock=options.clock??systemClock;
 }
 private now(){try{const n=this.clock.now();if(!validNumber(n)||this.last!==null&&n<this.last)return null;return this.last=n;}catch{return null;}}
 private priceValid(){try{const e=this.options.priceEvidence,n=(this.options.wallNow??Date.now)();
  if(!validNumber(n)||this.lastWall!==null&&n<this.lastWall)return false;this.lastWall=n;
  return !!e&&e.model===P.model&&e.inputPricePerMillion===0&&e.outputPricePerMillion===0
   &&validNumber(e.observedAtMs)&&validNumber(e.expiresAtMs)&&e.observedAtMs<=n&&e.expiresAtMs>n
   &&e.expiresAtMs-e.observedAtMs<=900_000&&e.sourceUrls.length===2&&SILICONFLOW_PRICE_SOURCES.every(s=>e.sourceUrls.includes(s));
 }catch{return false;}}
 private emit(type:LiveEvidence['type'],requestId:number|null,details:LiveEvidence['details']){
  const event=Object.freeze({schema:1,executionKind:this.options.fetch?'mocked-http':'live-http',sequence:++this.sequence,type,requestId,atMs:this.last,details:Object.freeze({...details})} as const);
  try{const result:unknown=this.options.persist?.(event);if(result!==true){if(result instanceof Promise)void result.catch(()=>{});throw Error();}return true;}catch{this.evidenceFailed=true;return false;}
 }
 start(){
  if(this.phase!=='new')return false;this.phase='starting';
  if(!this.profile||this.options.enabled!==true||this.options.dataApproved!==true||!this.options.persist||!this.key.trim()||/[\r\n]/.test(this.key)){this.stop('disabled');return false;}
  const n=this.now();if(n===null){this.stop('clock_invalid');return false;}this.started=n;
  if(!this.priceValid()){this.stop('price_evidence_invalid');return false;}
  this.options.signal?.addEventListener('abort',this.abort,{once:true});if(this.options.signal?.aborted){this.stop('signal');return false;}
  const e=this.options.priceEvidence!;
  if(!this.emit('gate',null,{...P,...this.profile,profile:this.options.profile??'probe',sourceUrls:JSON.stringify(e.sourceUrls),priceObservedAtMs:e.observedAtMs,priceExpiresAtMs:e.expiresAtMs,dataApproved:true,realProviderCostUsd:null,perRequestReceipt:false})){this.stop('evidence_failed');return false;}
  if(this.isStopped())return false;this.phase='ready';this.armWall();return this.check();
 }
 private isStopped(){return this.phase==='stopped';}
 private check(){if(this.phase!=='ready')return false;const n=this.now();if(n===null){this.stop('clock_invalid');return false;}
  if(n-this.started>=this.profile.maxWallMs){this.stop('wall_limit');return false;}
  if(this.active&&n-this.active.started>=this.profile.requestTimeoutMs){this.stop('request_timeout');return false;}
  if(!this.priceValid()){this.stop('price_evidence_invalid');return false;}return true;
 }
 private armWall(){
  const generation=++this.wallGeneration;let registering=true,early=false;
  try{
   const timer=this.clock.setTimer(()=>{
    if(registering){early=true;return;}
    if(generation!==this.wallGeneration||!this.wallArmed||this.phase!=='ready')return;
    this.wallArmed=false;++this.wallGeneration;
    if(this.check())this.armWall();
   },this.profile.maxWallMs-(this.last!-this.started));
   registering=false;
   // setTimer is injected trusted code, but may reenter stop before returning.
   if(this.isStopped()||generation!==this.wallGeneration){this.clearTimer(timer);return;}
   this.wall=timer;this.wallArmed=true;if(early)this.stop('clock_invalid');
  }catch{this.stop('clock_invalid');}
 }
 private clearTimer(timer:unknown){try{this.clock.clearTimer(timer);}catch{this.cleanupFailed=true;}}
 private cancelReader(reader:ReadableStreamDefaultReader<Uint8Array>|undefined){try{void reader?.cancel().catch(()=>{});}catch{this.cleanupFailed=true;}}
 async complete(messages:ModelMessage[],signal?:AbortSignal):Promise<ModelReply|null>{
  if(!this.check())return null;if(this.active){this.stop('concurrency_violation');return null;}if(this.attempts>=this.profile.maxRequests){this.stop('request_limit');return null;}
  let resolve!:()=>void;const done=new Promise<null>(yes=>{resolve=()=>yes(null);});
  const a:Active={id:++this.attempts,started:this.last!,controller:new AbortController(),done,resolve};this.active=a;
  const current=()=>this.active===a&&this.check(),onAbort=()=>this.stop('signal');signal?.addEventListener('abort',onAbort,{once:true});
  let response:Response|null=null;
  const race=<T>(promise:Promise<T>)=>Promise.race([promise,a.done]);
  try{
   if(signal?.aborted){this.stop('signal');return null;}
   let registering=true,early=false;a.timer=this.clock.setTimer(()=>{if(registering){early=true;return;}if(this.active===a)this.stop('request_timeout');},this.profile.requestTimeoutMs);registering=false;if(!current()){this.clearTimer(a.timer);return null;}if(early){this.stop('clock_invalid');return null;}
   let body:string;try{body=modelRequestPayload(P.model,messages,0.25);const parsed=JSON.parse(body);
    if(!Array.isArray(parsed.messages)||!parsed.messages.length||parsed.messages.some((m:any)=>!m||!['system','user'].includes(m.role)||typeof m.content!=='string')||Buffer.byteLength(body)>P.maxRequestBytes)throw Error();
   }catch{this.stop('input_invalid');return null;}
   if(!this.emit('dispatch_intent',a.id,{model:P.model,endpoint:P.endpoint,requestBodyHash:hash(body),requestBytes:Buffer.byteLength(body),networkDispatchConfirmed:false})){this.stop('evidence_failed');return null;}if(!current())return null;
   // Invocation is not proof that the provider received or billed the request.
   this.invoked++;const pending=(this.options.fetch??fetch)(P.endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},body,signal:a.controller.signal});
   void pending.then(r=>{if(!current())try{void r.body?.cancel().catch(()=>{});}catch{}},()=>{});
   if(!this.emit('transport_invoked',a.id,{networkDispatchConfirmed:false,realProviderCostUsd:null})){this.stop('evidence_failed');return null;}
   response=await race(pending);if(!response||!current())return null;
   const lengthText=response.headers.get('content-length'),length=lengthText===null?null:/^(0|[1-9][0-9]*)$/.test(lengthText)?Number(lengthText):NaN;
   if(!this.emit('headers',a.id,{httpStatus:response.status,endpointMatches:response.url===P.endpoint,redirected:response.redirected,realProviderCostUsd:null,billingBasis:P.billingBasis})){this.stop('evidence_failed');return null;}if(!current())return null;
   if(response.redirected||response.url!==P.endpoint||response.status>=300&&response.status<400){this.stop('redirect_rejected');return null;}
   if(response.status!==200){this.stop(response.status===429?'rate_limited':'http_failed');return null;}
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')||length!==null&&(!Number.isSafeInteger(length)||length>this.profile.maxResponseBytes)||!response.body){this.stop('response_invalid');return null;}
   a.reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
   for(;;){const part=await race(a.reader.read());if(!part||!current())return null;if(part.done)break;
    if(!(part.value instanceof Uint8Array)||(bytes+=part.value.byteLength)>this.profile.maxResponseBytes){this.stop('body_invalid');return null;}chunks.push(new Uint8Array(part.value));}
   if(length!==null&&length!==bytes){this.stop('body_invalid');return null;}const raw=Buffer.concat(chunks);
   // This separate durable HTTP evidence precedes JSON and decision parsing.
   if(!this.emit('body',a.id,{bytes,sha256:hash(raw),realProviderCostUsd:null})){this.stop('evidence_failed');return null;}if(!current())return null;
   let value:any;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{this.stop('body_invalid');return null;}
   if(value?.model!==P.model){this.stop('model_mismatch');return null;}
   const u=value?.usage,c=Array.isArray(value?.choices)&&value.choices.length===1?value.choices[0]:null;
   if(!validId(value?.id)||value?.object!=='chat.completion'||!c||c.finish_reason!=='stop'||c.message?.role!=='assistant'||typeof c.message?.content!=='string'||!c.message.content.trim()
    ||!Number.isSafeInteger(u?.prompt_tokens)||u.prompt_tokens<0||!Number.isSafeInteger(u?.completion_tokens)||u.completion_tokens<0
    ||!Number.isSafeInteger(u?.total_tokens)||u.total_tokens!==u.prompt_tokens+u.completion_tokens){this.stop('response_invalid');return null;}
   if(!this.emit('completion',a.id,{providerRequestIdHash:hash(value.id),model:P.model,inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens,realProviderCostUsd:null,billingBasis:P.billingBasis,perRequestReceipt:false})){this.stop('evidence_failed');return null;}
   if(!current())return null;this.clearTimer(a.timer);if(this.cleanupFailed){this.stop('clock_invalid');return null;}if(!current())return null;this.active=null;this.completed++;
   return {content:c.message.content,finish:'stop',usage:{prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens}};
  }catch{if(this.phase==='ready')this.stop('response_invalid');return null;}
  finally{signal?.removeEventListener('abort',onAbort);this.cancelReader(a.reader);if(response&&!a.reader)try{void response.body?.cancel().catch(()=>{});}catch{this.cleanupFailed=true;}}
 }
 stop(reason:LiveStopReason='manual_stop'){
  if(this.isStopped())return;this.phase='stopped';this.reason=reason;this.key='';this.options.signal?.removeEventListener('abort',this.abort);
  ++this.wallGeneration;if(this.wallArmed){this.wallArmed=false;this.clearTimer(this.wall);}const a=this.active;this.active=null;
  if(a){this.clearTimer(a.timer);a.resolve();a.controller.abort();this.cancelReader(a.reader);}
  this.emit('stopped',a?.id??null,{reason,realProviderCostUsd:null,billingBasis:P.billingBasis,remoteCancellationConfirmed:false});
  try{this.options.onStop?.(reason);}catch{this.callbackFailed=true;}
 }
 status(){return {executionKind:this.options.fetch?'mocked-http':'live-http',networkAttempts:this.options.fetch?0:this.invoked,phase:this.phase,reason:this.reason,attempts:this.attempts,transportInvocations:this.invoked,completedResponses:this.completed,inFlight:this.active?1:0,
  evidencePersisted:!this.evidenceFailed,timerCleanupComplete:!this.cleanupFailed,stopCallbackComplete:!this.callbackFailed,
  realProviderCostUsd:null,billingBasis:P.billingBasis,perRequestReceipt:false,remoteCancellationConfirmed:false,acceptancePassed:null};}
}

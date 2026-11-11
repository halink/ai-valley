/** Explicitly gated HTTP candidate. Nothing here is imported by main or reads
 * environment files, keys, saves, or network on import/construction. */
import {modelRequestPayload,type ModelMessage,type ModelReply} from './model-completion.js';
import {ProductionModelJournal,modelEvidenceHash,type ProductionCandidateContract} from './production-model-journal.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {evaluateProductionHttpAdmission,PRODUCTION_HTTP_LIMITS as L,type ProductionHttpAdmission} from './production-model-admission.js';
type Clock={now:()=>number;setTimer:(fn:()=>void,ms:number)=>unknown;clearTimer:(timer:unknown)=>void};
type Headers={status:number;url:string;redirected:boolean;contentType:string|null;contentLength:string|null};
type WireResponse=Headers&{body:ReadableStream<Uint8Array>|null};
type Request=Readonly<{id:number;endpoint:typeof P.endpoint;method:'POST';redirect:'error';body:string;signal:AbortSignal}>;
type Deferred<T>={promise:Promise<T>;resolve:(value:T)=>void;reject:()=>void};
function deferred<T>():Deferred<T>{let resolve!:(v:T)=>void,reject!:()=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=()=>no(new Error('transport_failed'));});return {promise,resolve,reject};}
export type ProductionHttpTransport=Readonly<{kind:'synthetic-production-http'|'gated-production-http'}>;
type TransportState={claimed:boolean;kind:ProductionHttpTransport['kind'];contractHash?:string;admission?:ProductionHttpAdmission;
 invoke:(request:Request,beforeDispatch:()=>void)=>Promise<WireResponse>;invocations:number};
const transports=new WeakMap<ProductionHttpTransport,TransportState>();
/** Only this branded memory capability is used in tests. No injectable fetch,
 * key, endpoint or executable callback can be passed to the fake factory. */
export function createMemoryProductionHttp(){
 type Call={request:Request;headers:Deferred<WireResponse>;body:ReadableStream<Uint8Array>;controller:ReadableStreamDefaultController<Uint8Array>;cancelled:boolean};
 const calls:Call[]=[],transport=Object.freeze({kind:'synthetic-production-http'} as const);
 transports.set(transport,{claimed:false,kind:transport.kind,invocations:0,invoke:request=>{
  let controller!:Call['controller'];const call={request,headers:deferred<WireResponse>(),body:new ReadableStream<Uint8Array>({
   start(value){controller=value;},cancel(){call.cancelled=true;}}),controller,cancelled:false};calls.push(call);return call.headers.promise;
 }});
 return {transport,requests:()=>calls.map(c=>c.request),reject:(index:number)=>calls[index].headers.reject(),
  headers:(index:number,meta:Partial<Headers>={},hasBody=true)=>{const c=calls[index];c.headers.resolve({status:200,url:P.endpoint,redirected:false,
   contentType:'application/json',contentLength:null,...meta,body:hasBody?c.body:null});},
  chunk:(index:number,value:Uint8Array)=>calls[index].controller.enqueue(new Uint8Array(value)),
  end:(index:number)=>calls[index].controller.close(),failBody:(index:number)=>calls[index].controller.error(new Error('synthetic_body_failed')),
  bodyCancelled:(index:number)=>calls[index].cancelled};
}
/** Pure request preparation, shared with the dormant HTTP transport so its
 * credential/guard ordering can be tested without creating a live capability.
 * The result contains a credential: never persist or log it. */
export function preparePinnedSiliconFlowDispatch(request:Readonly<{body:string;signal:AbortSignal}>,credential:()=>string,beforeDispatch:()=>void){
 if(request.signal.aborted)throw new Error('signal');
 let key:string;try{key=credential();}catch{throw new Error('credential_unavailable');}
 if(typeof key!=='string'||!key||/[\r\n]/.test(key))throw new Error('credential_invalid');
 // Reading credentials can execute trusted code or consume wall time. This
 // check must be after it, and synchronously before returning the fetch input.
 beforeDispatch();if(request.signal.aborted)throw new Error('signal');
 return {endpoint:P.endpoint,init:{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:request.body,signal:request.signal} satisfies RequestInit};
}
/** Trusted integration API, not a self-service evidence verifier. Caller must
 * already have reviewed the referenced prior-request/provider/user evidence.
 * A true flag alone cannot open the gate. No existing permission is re-requested.
 * Credential provider is accessed only after all gates; called only after FULL
 * intent commit and the last dispatch check. Never logs or persists its result. */
export function createGatedSiliconFlowHttp(options:{enableLive?:boolean;contract:ProductionCandidateContract;
 admission?:unknown;credential:()=>string}):ProductionHttpTransport{
 if(options.enableLive!==true)throw new Error('live_execution_disabled');
 if(options.contract.executionKind!=='gated-production-http-candidate')throw new Error('live_contract_required');
 const gate=evaluateProductionHttpAdmission(options.contract,options.admission,Date.now());
 if(!gate.allowed)throw new Error(gate.reason);
 const credential=options.credential;
 if(typeof credential!=='function')throw new Error('credential_provider_required');
 const transport=Object.freeze({kind:'gated-production-http'} as const);
 transports.set(transport,{claimed:false,kind:transport.kind,contractHash:modelEvidenceHash(options.contract),admission:gate.record,invocations:0,
  invoke:async (request,beforeDispatch)=>{
   const prepared=preparePinnedSiliconFlowDispatch(request,credential,beforeDispatch);
   let response:Response;try{response=await fetch(prepared.endpoint,prepared.init);}
   catch{throw new Error('transport_failed');}
   return {status:response.status,url:response.url,redirected:response.redirected,contentType:response.headers.get('content-type'),
    contentLength:response.headers.get('content-length'),body:response.body};
  }});
 return transport;
}
const systemClock:Clock={now:()=>Date.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
const token=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const reasons=new Set(('clock_invalid model_failed model_stopped manual_stop signal request_timeout wall_limit concurrency_violation model_not_allowed model_context_limit '+
 'redirect_rejected model_http_401 model_http_402 model_http_403 model_http_429 model_http_failed response_invalid response_too_large response_length_mismatch response_model_mismatch '+
 'credential_invalid credential_unavailable transport_failed admission_budget_invalid admission_time_invalid admission_identity_invalid admission_scope_mismatch authorization_evidence_missing '+
 'previous_request_unreconciled free_price_unverified free_price_expired admission_hash_mismatch admission_record_invalid '+
 'production_journal_owner_lost production_journal_unusable production_journal_invalid production_journal_stale production_journal_limit unresolved_request_no_retry request_limit dispatch_intent_mismatch').split(' '));
const safeReason=(error:unknown)=>error instanceof Error&&reasons.has(error.message)?error.message:'model_failed';
export class ProductionSiliconFlowHttpCandidate{
 private transport:TransportState;private clock:Clock;private failure:string|null;private closed=false;private lastNow:number;
 private healthy=true;private observedResponses=0;
 private active:{id:number;at:number;controller:AbortController;cancel:()=>void;timer:unknown;armed:boolean}|null=null;
 constructor(private journal:ProductionModelJournal,transport:ProductionHttpTransport,options:{clock?:Clock}={}){
  const state=transports.get(transport);if(!state||state.claimed)throw new Error('production_transport_invalid');
  const synthetic=state.kind==='synthetic-production-http';
  if(synthetic!== (journal.contract.executionKind==='synthetic-production-candidate'))throw new Error('transport_journal_mismatch');
  if(!synthetic&&state.contractHash!==modelEvidenceHash(journal.contract))throw new Error('transport_contract_mismatch');
  if(!synthetic&&options.clock)throw new Error('live_clock_override_rejected');
  state.claimed=true;this.transport=state;this.clock=options.clock??systemClock;this.lastNow=journal.status().lastObservedAtMs;
  this.failure=journal.status().failure;this.closed=!!this.failure;
 }
 private now(){const at=this.clock.now();if(!Number.isSafeInteger(at)||at<this.lastNow)throw new Error('clock_invalid');this.lastNow=at;return at;}
 private check(){
  if(this.closed)throw new Error(this.failure??'model_stopped');const now=this.now();this.journal.check(now);
  if(this.transport.kind==='gated-production-http'){
   const gate=evaluateProductionHttpAdmission(this.journal.contract,this.transport.admission,now);if(!gate.allowed)throw new Error(gate.reason);
  }
  if(this.active&&now-this.active.at>=this.journal.contract.requestTimeoutMs)throw new Error('request_timeout');
 }
 stop(reason='manual_stop'){
  if(this.closed)return;this.closed=true;this.failure=reasons.has(reason)?reason:'model_stopped';
  try{this.journal.block(this.failure);}catch{this.healthy=false;this.failure='journal_write_failed';}
  const active=this.active;this.active=null;
  if(active){if(active.armed){try{this.clock.clearTimer(active.timer);}catch{this.healthy=false;}}active.controller.abort();active.cancel();}
 }
 private async read(response:WireResponse,signal:AbortSignal):Promise<ModelReply>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   this.check();
   if(response.url!==P.endpoint||response.redirected||response.status>=300&&response.status<400)throw new Error('redirect_rejected');
   if(response.status!==200)throw new Error([401,402,403,429].includes(response.status)?`model_http_${response.status}`:'model_http_failed');
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.contentType??'')||!response.body)throw new Error('response_invalid');
   const length=response.contentLength===null?null:/^(0|[1-9][0-9]*)$/.test(response.contentLength)?Number(response.contentLength):NaN;
   if(length!==null&&(!Number.isSafeInteger(length)||length>L.maxResponseBytes))throw new Error('response_too_large');
   reader=response.body.getReader();
   const onAbort=()=>{void reader?.cancel().catch(()=>{});};signal.addEventListener('abort',onAbort,{once:true});
   try{
    const chunks:Uint8Array[]=[];let bytes=0;
    for(;;){const chunk=await reader.read();this.check();if(chunk.done)break;
     if(!(chunk.value instanceof Uint8Array))throw new Error('response_invalid');bytes+=chunk.value.byteLength;
     if(bytes>L.maxResponseBytes)throw new Error('response_too_large');chunks.push(chunk.value);
    }
    if(length!==null&&length!==bytes)throw new Error('response_length_mismatch');
    let value:any;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new Error('response_invalid');}
    if(value?.model!==P.model)throw new Error('response_model_mismatch');
    const choice=Array.isArray(value?.choices)&&value.choices.length===1?value.choices[0]:null;
    if(!choice||choice.finish_reason!=='stop'||typeof choice.message?.content!=='string'
     ||!token(value?.usage?.prompt_tokens)||!token(value?.usage?.completion_tokens))throw new Error('response_invalid');
    return {content:choice.message.content,finish:'stop',usage:{prompt_tokens:value.usage.prompt_tokens,completion_tokens:value.usage.completion_tokens}};
   }finally{signal.removeEventListener('abort',onAbort);}
  }finally{
   if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
   else if(response.body)void response.body.cancel().catch(()=>{});
  }
 }
 async complete(messages:ModelMessage[],options:{model?:string;signal?:AbortSignal}={}):Promise<{id:number;reply:ModelReply}|null>{
  const onAbort=()=>this.stop('signal');
  try{
   this.check();if(this.active)throw new Error('concurrency_violation');
   if(options.model!==undefined&&options.model!==P.model)throw new Error('model_not_allowed');
   if(options.signal?.aborted)throw new Error('signal');
   const body=modelRequestPayload(P.model,messages,0.25),at=this.now();
   const id=this.journal.intent(modelEvidenceHash(body),at),controller=new AbortController();
   let cancel!:()=>void;const cancelled=new Promise<null>(resolve=>{cancel=()=>resolve(null);});
   const active={id,at,controller,cancel,timer:undefined as unknown,armed:false};this.active=active;
   options.signal?.addEventListener('abort',onAbort,{once:true});if(options.signal?.aborted)throw new Error('signal');
   let registering=true,early=false;const wallRemaining=this.journal.contract.deadlineAtMs-at;
   const timeout=Math.min(this.journal.contract.requestTimeoutMs,wallRemaining);
   active.timer=this.clock.setTimer(()=>{if(registering){early=true;return;}this.stop(timeout===wallRemaining?'wall_limit':'request_timeout');},timeout);
   active.armed=true;registering=false;if(early)throw new Error('clock_invalid');
   this.check();
   const request=Object.freeze({id,endpoint:P.endpoint,method:'POST',redirect:'error',body,signal:controller.signal} as const);
   // Invocation may have reached the provider even if it later rejects. Count
   // it once; no catch path performs a retry, fallback or fresh-budget request.
   this.transport.invocations++;
   const beforeDispatch=()=>{
    this.check();const pending=this.journal.status().pending;
    if(this.active!==active||pending?.id!==id||pending.phase!=='intent'||pending.requestHash!==modelEvidenceHash(body))throw new Error('dispatch_intent_mismatch');
   };
   const work=this.transport.invoke(request,beforeDispatch).then(async response=>{
    if(this.closed||this.active!==active){void response.body?.cancel().catch(()=>{});return null;}
    return this.read(response,controller.signal);
   });
   const reply=await Promise.race([work,cancelled]);
   if(this.closed||this.active!==active||!reply)return null;this.check();
   this.journal.response(id,modelEvidenceHash(reply),this.now());this.observedResponses++;
   this.clock.clearTimer(active.timer);active.armed=false;this.active=null;
   return {id,reply};
  }catch(error){this.stop(safeReason(error));return null;}
  finally{options.signal?.removeEventListener('abort',onAbort);}
 }
 acknowledgeWorldCommit(id:number,fingerprint:string){try{this.check();this.journal.acknowledgeWorldCommit(id,fingerprint,this.now());return true;}
  catch(error){this.stop(safeReason(error));return false;}}
 status(){const state=this.journal.status(),live=this.transport.kind==='gated-production-http';
  return {...state,phase:this.closed?'blocked':'candidate-only',failure:this.failure??state.failure,
   executionKind:live?'gated-production-http-candidate':'synthetic-production-http',persistenceHealthy:this.healthy&&state.persistenceHealthy,
   transportInvocations:this.transport.invocations,inFlight:this.active?1:0,observedResponses:this.observedResponses,
   liveExecutionEnabled:live&&!this.closed,realModelExecuted:live&&state.attempts>0?null:false,
   actualProviderCostCny:null,providerBudgetEnforced:false,remoteCancellationConfirmed:false,readyForProduction:false,acceptancePassed:null} as const;
 }
}

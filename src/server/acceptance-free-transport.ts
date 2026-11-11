/** Offline-only candidate contract. No credentials, game context, HTTP client,
 * live adapter, environment switch, retry or fallback exists in this module. */
import {createHash} from 'node:crypto';
import type {AcceptanceClock} from './acceptance-stop-control.js';

export const FREE_CANDIDATE_PROPOSAL=Object.freeze({schema:1,protocol:'single-free-candidate-offline-contract-v1',
 executionKind:'offline-contract-rehearsal',provider:'siliconflow',
 endpoint:'https://api.siliconflow.cn/v1/chat/completions',model:'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
 accountScope:'synthetic-account-only',dataScope:'fixed-offline-probe-v1',modelSlots:1,
 maxRequests:24,maxWallMs:20_000,requestTimeoutMs:5_000,maxResponseBytes:32_000,
 currency:'USD',spendingCapUsd:0,retries:0,fallback:null,redirects:'reject',
 realModelExecuted:false,authorized:false,readyForRealRun:false,acceptancePassed:null} as const);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const FREE_CANDIDATE_PROTOCOL_HASH=hash(JSON.stringify(FREE_CANDIDATE_PROPOSAL));
export const OFFLINE_PROBE='Offline synthetic probe. Reply with {"choice":"wait"}.';
const P=FREE_CANDIDATE_PROPOSAL;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const id=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(x);
const fail=():never=>{throw new Error('invalid_offline_contract_data');};
/** Only own data properties; no accessors/toJSON or arbitrary error serialization. */
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return fail();
 const result:Record<string,unknown>={};
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))return fail();result[key]=d.value;}
 return result;
}
export type SyntheticPriceEvidence={provenance:'synthetic-fixture';protocolHash:string;provider:string;endpoint:string;model:string;
 accountScope:string;currency:'USD';observedAtMs:number;validUntilMs:number;inputPerMillion:number;outputPerMillion:number;
 reasoningPerMillion:number;perRequest:number;otherFees:number;hardZeroBilling:true;reference:string};
export type SyntheticDataApproval={provenance:'synthetic-fixture';protocolHash:string;provider:string;endpoint:string;model:string;
 accountScope:string;dataScope:string;approvedAtMs:number;validUntilMs:number;maxRequests:number;maxWallMs:number;reference:string};
const priceKeys=['provenance','protocolHash','provider','endpoint','model','accountScope','currency','observedAtMs','validUntilMs',
 'inputPerMillion','outputPerMillion','reasoningPerMillion','perRequest','otherFees','hardZeroBilling','reference'];
const approvalKeys=['provenance','protocolHash','provider','endpoint','model','accountScope','dataScope','approvedAtMs','validUntilMs',
 'maxRequests','maxWallMs','reference'];
function identity(v:Record<string,unknown>){return v.provenance==='synthetic-fixture'&&v.protocolHash===FREE_CANDIDATE_PROTOCOL_HASH
 &&v.provider===P.provider&&v.endpoint===P.endpoint&&v.model===P.model&&v.accountScope===P.accountScope&&id(v.reference);}
function price(input:unknown,now:number):SyntheticPriceEvidence{
 const v=record(input,priceKeys);
 if(!identity(v)||v.currency!=='USD'||!finite(v.observedAtMs)||!finite(v.validUntilMs)
  ||v.observedAtMs>now||v.validUntilMs<=now||v.hardZeroBilling!==true
  ||!['inputPerMillion','outputPerMillion','reasoningPerMillion','perRequest','otherFees'].every(k=>v[k]===0))return fail();
 return v as SyntheticPriceEvidence;
}
function approval(input:unknown,now:number):SyntheticDataApproval{
 const v=record(input,approvalKeys);
 if(!identity(v)||v.dataScope!==P.dataScope||v.maxRequests!==P.maxRequests||v.maxWallMs!==P.maxWallMs
  ||!finite(v.approvedAtMs)||!finite(v.validUntilMs)||v.approvedAtMs>now||v.validUntilMs<=now)return fail();
 return v as SyntheticDataApproval;
}
export type SyntheticReceipt={provenance:'synthetic-fixture';requestId:number;providerRequestId:string;provider:string;endpoint:string;
 model:string;accountScope:string;currency:'USD';allChargesFinal:true;totalUsd:number;reference:string};
export type MemoryResponseMetadata={status:number;endpoint:string;redirected:boolean;model:string|null;providerRequestId:string|null;receipt:unknown};
export type MemoryFreeTransport=Readonly<{kind:'in-memory-offline-transport'}>;
type Deferred<T>={promise:Promise<{payload:T}>;resolve:(value:T)=>void;reject:()=>void};
function deferred<T>():Deferred<T>{let resolve!:(value:{payload:T})=>void,reject!:(reason:Error)=>void;
 const promise=new Promise<{payload:T}>((yes,no)=>{resolve=yes;reject=no;});
 // A pending body can reject before headers arrive without unhandled rejection.
 // Boxing prevents Promise resolution from invoking a fixture's then getter.
 void promise.catch(()=>{});return {promise,resolve:value=>resolve({payload:value}),reject:()=>reject(new Error('synthetic_transport_failure'))};}
type Call={request:Readonly<{id:number;model:string;endpoint:string;redirect:'error';body:string;signal:AbortSignal}>;
 headers:Deferred<unknown>;body:Deferred<unknown>};
const transports=new WeakMap<MemoryFreeTransport,{calls:Call[];claimed:boolean}>();
/** An opaque, branded capability backed only by memory promises. No custom send
 * callback is accepted. Every gate claims it once; normal objects are rejected. */
export function createMemoryFreeTransport(){
 const transport=Object.freeze({kind:'in-memory-offline-transport'} as const),state={calls:[] as Call[],claimed:false};
 transports.set(transport,state);
 return {transport,calls:()=>state.calls.map(c=>c.request),
  resolveHeaders:(index:number,value:unknown)=>state.calls[index].headers.resolve(value),
  rejectHeaders:(index:number)=>state.calls[index].headers.reject(),
  resolveBody:(index:number,value:unknown)=>state.calls[index].body.resolve(value),
  rejectBody:(index:number)=>state.calls[index].body.reject()};
}
export type FreeContractReason='missing_transport'|'transport_already_used'|'missing_evidence_sink'|'price_unproven'|'data_unapproved'
 |'request_limit'|'concurrency_violation'|'wall_limit'|'request_timeout'|'clock_invalid'|'evidence_failed'|'transport_failed'
 |'response_invalid'|'redirect_rejected'|'model_mismatch'|'cost_unknown'|'nonzero_cost'|'rate_limited'|'http_failed'
 |'body_invalid'|'decision_invalid'|'manual_stop'|'signal';
export type FreeContractEvidence={schema:1;protocolHash:string;executionKind:'offline-contract-rehearsal';sequence:number;
 requestId:number|null;type:'gate'|'dispatch_intent'|'transport_invoked'|'response'|'body'|'decision'|'stopped';
 atMs:number|null;details:Readonly<Record<string,string|number|boolean|null>>};
export type FreeContractOptions={transport?:MemoryFreeTransport;priceEvidence?:unknown;dataApproval?:unknown;
 /** Synchronous durable acknowledgement required. Return exactly true after
  * persistence; undefined/thenables/failure keep the run closed. No raw body. */
 persist?:(event:FreeContractEvidence)=>true;clock?:AcceptanceClock;signal?:AbortSignal};
const systemClock:AcceptanceClock={now:()=>performance.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};

/** A rehearsal, not a live authorization checker or provider receipt verifier.
 * Inputs must be synthetic fixtures. Unknown real semantics stay unsupported. */
export class OfflineFreeCandidateContract {
 private phase:'new'|'starting'|'ready'|'stopped'='new';private reason:FreeContractReason|null=null;
 private clock:AcceptanceClock;private startMs:number|null=null;private lastMs:number|null=null;
 private sequence=0;private attempts=0;private invoked=0;private accepted=0;
 private knownSyntheticCost=0;private unknownCosts=0;private evidenceFailed=false;private timerFailed=false;
 private wallTimer:unknown;private wallArmed=false;
 private active:{id:number;controller:AbortController;timer:unknown;armed:boolean;done:Deferred<null>;costRecorded:boolean;startedMs:number}|null=null;
 private state?:{calls:Call[];claimed:boolean};private price?:SyntheticPriceEvidence;private approval?:SyntheticDataApproval;
 private events:FreeContractEvidence[]=[];
 private abort=()=>this.stop('signal');
 constructor(private options:FreeContractOptions={}){this.options={...options};this.clock=options.clock??systemClock;}
 private now():number|null{
  let now;try{now=this.clock.now();}catch{return null;}
  if(!finite(now)||this.lastMs!==null&&now<this.lastMs)return null;
  this.lastMs=now;return now;
 }
 private emit(type:FreeContractEvidence['type'],requestId:number|null,details:FreeContractEvidence['details']):boolean{
  const event=Object.freeze({schema:1,protocolHash:FREE_CANDIDATE_PROTOCOL_HASH,executionKind:P.executionKind,
   sequence:++this.sequence,requestId,type,atMs:this.lastMs,details:Object.freeze({...details})} as const);
  this.events.push(event);
  try{const result:unknown=this.options.persist?.(event);
   if(result!==true){if(result&&typeof(result as PromiseLike<unknown>).then==='function')void Promise.resolve(result).catch(()=>{});throw new Error('not_durably_acknowledged');}
   return true;
  }catch{this.evidenceFailed=true;return false;}
 }
 start():boolean{
  if(this.phase!=='new')return false;
  this.phase='starting';
  const now=this.now();if(now===null){this.stop('clock_invalid');return false;}this.startMs=now;
  if(!this.options.persist){this.stop('missing_evidence_sink');return false;}
  this.state=this.options.transport?transports.get(this.options.transport):undefined;
  if(!this.state){this.stop('missing_transport');return false;}
  if(this.state.claimed){this.stop('transport_already_used');return false;}
  try{this.price=price(this.options.priceEvidence,now);}catch{this.stop('price_unproven');return false;}
  try{this.approval=approval(this.options.dataApproval,now);}catch{this.stop('data_unapproved');return false;}
  // Copy validated data properties; later caller mutation cannot expand authority.
  this.price=Object.freeze(this.price);this.approval=Object.freeze(this.approval);
  this.state.claimed=true;
  this.options.signal?.addEventListener('abort',this.abort,{once:true});
  if(this.options.signal?.aborted){this.stop('signal');return false;}
  if(!this.emit('gate',null,{priceEvidenceHash:hash(JSON.stringify(this.price)),approvalHash:hash(JSON.stringify(this.approval)),
   realAuthorization:false,provider:P.provider,endpoint:P.endpoint,model:P.model,dataScope:P.dataScope,
   provenance:'synthetic-fixture',accountScope:P.accountScope,currency:'USD',
   priceReference:this.price.reference,priceObservedAtMs:this.price.observedAtMs,priceValidUntilMs:this.price.validUntilMs,
   inputPerMillion:this.price.inputPerMillion,outputPerMillion:this.price.outputPerMillion,reasoningPerMillion:this.price.reasoningPerMillion,
   perRequest:this.price.perRequest,otherFees:this.price.otherFees,syntheticHardZeroBilling:this.price.hardZeroBilling,
   approvalReference:this.approval.reference,approvedAtMs:this.approval.approvedAtMs,approvalValidUntilMs:this.approval.validUntilMs,
   maxRequests:P.maxRequests,maxWallMs:P.maxWallMs})){this.stop('evidence_failed');return false;}
  // No execute/start reentry is admitted before the gate record is acknowledged.
  if(!this.isStarting())return false;this.phase='ready';
  if(!this.check())return false;
  this.armWall();return this.phase==='ready';
 }
 private isStarting(){return this.phase==='starting';}
 private armWall(){
  if(this.phase!=='ready')return;
  try{let registering=true,early=false;
   this.wallTimer=this.clock.setTimer(()=>{if(registering){early=true;return;}this.wallArmed=false;if(this.check())this.armWall();},P.maxWallMs-(this.lastMs!-this.startMs!));
   registering=false;this.wallArmed=true;
   if(early){this.stop('clock_invalid');return;}
   if(this.phase!=='ready'){this.wallArmed=false;this.clock.clearTimer(this.wallTimer);}
  }catch{this.timerFailed=true;this.stop('clock_invalid');}
 }
 private check():boolean{
  if(this.phase!=='ready')return false;
  const now=this.now();if(now===null){this.stop('clock_invalid');return false;}
  if(now-this.startMs!>=P.maxWallMs){this.stop('wall_limit');return false;}
  if(this.active&&now-this.active.startedMs>=P.requestTimeoutMs){this.stop('request_timeout');return false;}
  try{price(this.price,now);}catch{this.stop('price_unproven');return false;}
  try{approval(this.approval,now);}catch{this.stop('data_unapproved');return false;}
  return this.phase==='ready';
 }
 /** No input argument: callers cannot transmit game/user data through this API. */
 async execute():Promise<Readonly<{choice:'wait'}>|null>{
  if(!this.check())return null;
  if(this.active){this.stop('concurrency_violation');return null;}
  if(this.attempts>=P.maxRequests){this.stop('request_limit');return null;}
  const requestId=++this.attempts,controller=new AbortController(),done=deferred<null>();
  const active={id:requestId,controller,done,timer:undefined as unknown,armed:false,costRecorded:false,startedMs:this.lastMs!};this.active=active;
  if(!this.emit('dispatch_intent',requestId,{provider:P.provider,endpoint:P.endpoint,model:P.model,
   dataScope:P.dataScope,priceEvidenceHash:hash(JSON.stringify(this.price)),approvalHash:hash(JSON.stringify(this.approval)),
   requestBodyHash:hash(OFFLINE_PROBE),requestTimeoutMs:P.requestTimeoutMs,networkDispatchConfirmed:false})||!this.check()){
   if(this.phase==='ready')this.stop('evidence_failed');return null;
  }
  // A synchronous sink may reenter or stop the contract. Never dispatch after it.
  if(this.active!==active||this.phase!=='ready')return null;
  try{let registering=true,early=false;
   active.timer=this.clock.setTimer(()=>{if(registering){early=true;return;}if(this.active===active)this.stop('request_timeout');},P.requestTimeoutMs-(this.lastMs!-active.startedMs));
   registering=false;active.armed=true;
   if(early){this.stop('clock_invalid');return null;}
   if(this.active!==active){this.clearRequestTimer(active);return null;}
  }catch{this.timerFailed=true;this.stop('clock_invalid');return null;}
  if(!this.check()||this.active!==active)return null;
  const call:Call={request:Object.freeze({id:requestId,model:P.model,endpoint:P.endpoint,redirect:'error',body:OFFLINE_PROBE,signal:controller.signal}),headers:deferred<unknown>(),body:deferred<unknown>()};
  this.state!.calls.push(call);this.invoked++;
  if(!this.emit('transport_invoked',requestId,{transport:'in-memory-only',networkDispatchConfirmed:false})||!this.check()){
   if(this.phase==='ready')this.stop('evidence_failed');return null;
  }
  const current=()=>this.active===active&&this.phase==='ready'&&this.check();
  const raced=async(promise:Promise<{payload:unknown}>)=>Promise.race([promise.then(({payload:value})=>({value}),()=>({failed:true})),done.promise.then(()=>({stopped:true}))]);
  const headers=await raced(call.headers.promise);if(!current())return null;
  if('failed'in headers){this.stop('transport_failed');return null;}if(!('value'in headers))return null;
  const meta=this.responseEvidence(headers.value,requestId);
  // Account independently of parsing; a synchronous sink can itself stop us.
  if(meta.cost!==null){active.costRecorded=true;this.knownSyntheticCost+=meta.cost;}
  if(!this.emit('response',requestId,meta.details)){this.stop('evidence_failed');return null;}
  if(!current())return null;
  if(meta.reason){this.stop(meta.reason);return null;}
  const body=await raced(call.body.promise);if(!current())return null;
  if('failed'in body){this.stop('transport_failed');return null;}if(!('value'in body))return null;
  if(typeof body.value!=='string'||Buffer.byteLength(body.value,'utf8')>P.maxResponseBytes){this.stop('body_invalid');return null;}
  if(!this.emit('body',requestId,{bytes:Buffer.byteLength(body.value,'utf8'),sha256:hash(body.value)})){this.stop('evidence_failed');return null;}
  if(!current())return null;
  let decision:Readonly<{choice:'wait'}>;
  try{const parsed=record(JSON.parse(body.value),['choice']);if(parsed.choice!=='wait')throw new Error('invalid');decision=Object.freeze({choice:'wait'});}
  catch{this.stop('decision_invalid');return null;}
  if(!this.emit('decision',requestId,{parsed:true,choice:'wait',appliedToWorld:false})||!current()){
   if(this.phase==='ready')this.stop('evidence_failed');return null;
  }
  if(!this.clearRequestTimer(active)){this.stop('clock_invalid');return null;}
  if(!current())return null;this.active=null;this.accepted++;return decision;
 }
 private responseEvidence(input:unknown,requestId:number):{details:FreeContractEvidence['details'];cost:number|null;reason:FreeContractReason|null}{
  let m:Record<string,unknown>;
  try{m=record(input,['status','endpoint','redirected','model','providerRequestId','receipt']);}
  catch{return {details:{metadataValid:false,costStatus:'unknown',costUsd:null,claimedModel:null},cost:null,reason:'response_invalid'};}
  const valid=Number.isInteger(m.status)&&(m.status as number)>=100&&(m.status as number)<=599&&typeof m.redirected==='boolean'
   &&typeof m.endpoint==='string'&&(m.model===null||typeof m.model==='string')&&(m.providerRequestId===null||id(m.providerRequestId));
  let cost:number|null=null,receiptHash:string|null=null,receiptReference:string|null=null;
  try{const r=record(m.receipt,['provenance','requestId','providerRequestId','provider','endpoint','model','accountScope','currency','allChargesFinal','totalUsd','reference']);
   if(r.provenance!=='synthetic-fixture'||r.requestId!==requestId||!id(m.providerRequestId)||r.providerRequestId!==m.providerRequestId
    ||r.provider!==P.provider||r.endpoint!==P.endpoint||r.model!==P.model||r.accountScope!==P.accountScope
    ||r.currency!=='USD'||r.allChargesFinal!==true||!finite(r.totalUsd)||!id(r.reference))throw new Error('unknown_receipt');
   cost=r.totalUsd;receiptReference=r.reference;receiptHash=hash(JSON.stringify(r));
  }catch{}
  const modelMatches=m.model===P.model,endpointMatches=m.endpoint===P.endpoint;
  const reason:FreeContractReason|null=!valid?'response_invalid':m.redirected||m.status as number>=300&&m.status as number<400||!endpointMatches?'redirect_rejected':
   !modelMatches?'model_mismatch':cost===null?'cost_unknown':cost!==0?'nonzero_cost':m.status===429?'rate_limited':m.status!==200?'http_failed':null;
  return {cost,reason,details:{metadataValid:valid,status:Number.isInteger(m.status)?m.status as number:null,
   endpointMatches,redirected:typeof m.redirected==='boolean'?m.redirected:null,modelMatches,
   claimedModel:modelMatches?P.model:typeof m.model==='string'?'mismatched-model':null,
   claimedModelHash:typeof m.model==='string'?hash(m.model):null,
   providerRequestId:id(m.providerRequestId)?m.providerRequestId:null,costStatus:cost===null?'unknown':'synthetic-final-receipt',costUsd:cost,receiptHash,receiptReference,receiptProvenance:cost===null?null:'synthetic-fixture',
   receiptProvider:cost===null?null:P.provider,receiptEndpoint:cost===null?null:P.endpoint,receiptModel:cost===null?null:P.model,
   receiptAccountScope:cost===null?null:P.accountScope,receiptCurrency:cost===null?null:'USD',allChargesFinal:cost===null?null:true,
   realProviderCostUsd:null}};
 }
 private clearRequestTimer(active:NonNullable<OfflineFreeCandidateContract['active']>){
  if(active.armed){active.armed=false;try{this.clock.clearTimer(active.timer);}catch{this.timerFailed=true;return false;}}
  return true;
 }
 stop(reason:FreeContractReason='manual_stop'){
  if(this.phase==='stopped')return;
  this.phase='stopped';this.reason=reason;
  this.options.signal?.removeEventListener('abort',this.abort);
  if(this.wallArmed){this.wallArmed=false;try{this.clock.clearTimer(this.wallTimer);}catch{this.timerFailed=true;}}
  const active=this.active;this.active=null;
  if(active){this.clearRequestTimer(active);if(this.invoked>=active.id&&!active.costRecorded)this.unknownCosts++;
   active.controller.abort();active.done.resolve(null);}
  this.emit('stopped',active?.id??null,{reason,remoteCancellationConfirmed:false,realProviderCostUsd:null,
   unknownCostRequests:this.unknownCosts,syntheticReceiptTotalUsd:this.invoked===0||this.unknownCosts?null:this.knownSyntheticCost});
 }
 status(){return {phase:this.phase,reason:this.reason,attempts:this.attempts,transportInvocations:this.invoked,acceptedDecisions:this.accepted,
  inFlight:this.active?1:0,unknownCostRequests:this.unknownCosts,syntheticReceiptTotalUsd:this.invoked===0||this.unknownCosts?null:this.knownSyntheticCost,
  evidencePersisted:!this.evidenceFailed,timerCleanupComplete:!this.timerFailed,realModelExecuted:false,authorized:false,readyForRealRun:false,
  realProviderCostUsd:null,remoteCancellationConfirmed:false,acceptancePassed:null};}
 /** Snapshot, not a durable read-back verifier or permission token. */
 evidence(){return this.events.map(e=>({...e,details:{...e.details}}));}
}

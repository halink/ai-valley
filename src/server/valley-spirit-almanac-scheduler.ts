import {syntheticValleySpiritAlmanacAdmission,type ValleySpiritAlmanac,type ValleySpiritAlmanacAdmission,type ValleySpiritAlmanacRange} from './valley-spirit-almanac.js';

const FEATURE='valley-spirit-almanac' as const;
const MAX_HOUR=Math.floor(1e9/60);
type Packet=Parameters<NonNullable<Awaited<ReturnType<ValleySpiritAlmanacAdmission['reserve']>>>['send']>[0];
interface Capacity {rpm:number;tpm:number;slots:number;}
export interface ValleySpiritSyntheticSchedulePolicy {
 mode:'offline-synthetic';accountId:string;periodHours:number;
 account:Capacity;residentFloor:Capacity;yearbookCap:Capacity;
 inputOverheadTokens:number; outputTokens:number; cooldownMs:number;
}
/** This port belongs to the account owner that already admits residents. The
 * implementation must atomically validate the current account identity and
 * exact policy; reserve account+purpose RPM/TPM/concurrency; defer if any
 * resident waits; preserve all resident floors; and make requestId unique.
 * It must durably keep uncertain reservations across rollover/restart, with
 * no automatic refund or retry. This proof is not inferred from a budget object. */
export interface ValleySpiritSyntheticSharedAccount {
 kind:'offline-synthetic-shared-account';
 requestLowPriority(request:{
  purpose:typeof FEATURE; accountId:string; requestId:string;
  account:Readonly<Capacity>; residentFloor:Readonly<Capacity>; yearbookCap:Readonly<Capacity>;
  maxInputTokens:number;maxOutputTokens:number;cooldownMs:number;promptVersion:1;
 }):Promise<{
  cancelBeforeDispatch():void;
  /** Safeguard: recheck permission immediately before handing off any data,
   * after all awaits. Authority owns actual usage, durable sent state and
   * unresolved risk; only proven unsent may release the RPM/TPM reservation. */
  dispatchOnce(packet:Packet, authorize:()=>boolean):Promise<unknown>;
 }|null>;
}
interface Window {fromHour:number;toHour:number;}
interface Facts {worldId:string;sourceRefs:readonly string[];}
export type ValleySpiritScheduleEvidence=(window:Window)=>Facts|null;
type Scope=Pick<ValleySpiritSyntheticSchedulePolicy,'account'|'residentFloor'|'yearbookCap'>;
const int=(v:unknown,low:number,high:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=low&&v<=high;
const keys=['rpm','tpm','slots'] as const;
const validCapacity=(v:Capacity)=>!!v&&keys.every(k=>int(v[k],1,Number.MAX_SAFE_INTEGER));
function policyOf(p?:ValleySpiritSyntheticSchedulePolicy):Readonly<ValleySpiritSyntheticSchedulePolicy>|null {
 if(p?.mode!=='offline-synthetic'||typeof p.accountId!=='string'||!/^offline-[A-Za-z0-9_-]{1,80}$/.test(p.accountId)||
  !int(p.periodHours,1,24)||!int(p.inputOverheadTokens,1,Number.MAX_SAFE_INTEGER)||!int(p.outputTokens,1,Number.MAX_SAFE_INTEGER)||
  !int(p.cooldownMs,1,Number.MAX_SAFE_INTEGER)||!validCapacity(p.account)||!validCapacity(p.residentFloor)||
  !validCapacity(p.yearbookCap)||!keys.every(k=>p.residentFloor[k]<p.account[k]&&p.yearbookCap[k]<=p.account[k]-p.residentFloor[k])||
  p.inputOverheadTokens>p.yearbookCap.tpm-p.outputTokens)return null;
 const caps=(v:Capacity)=>Object.freeze({rpm:v.rpm,tpm:v.tpm,slots:v.slots});
 return Object.freeze({mode:p.mode,accountId:p.accountId,periodHours:p.periodHours,account:caps(p.account),residentFloor:caps(p.residentFloor),yearbookCap:caps(p.yearbookCap),inputOverheadTokens:p.inputOverheadTokens,outputTokens:p.outputTokens,cooldownMs:p.cooldownMs});
}
function requestPolicy(p:Readonly<Scope>){return {account:p.account,residentFloor:p.residentFloor,yearbookCap:p.yearbookCap};}
type Status='disabled'|'not-due'|'no-evidence'|'running'|'window-processed'|'deferred'|'blocked'|'published';
type Implementation=Pick<ValleySpiritAlmanac,'schedulingState'|'generate'|'publish'|'get'|'objective'>;
export class ValleySpiritAlmanacScheduler {
 private readonly policy:Readonly<ValleySpiritSyntheticSchedulePolicy>|null;
 private running=false;
 private stopped=false;
 constructor(private readonly almanac:Implementation,private readonly evidence:ValleySpiritScheduleEvidence,
  options?:{policy:ValleySpiritSyntheticSchedulePolicy;sharedAccount:ValleySpiritSyntheticSharedAccount}){
  this.policy=options?.sharedAccount?.kind==='offline-synthetic-shared-account'?policyOf(options.policy):null;
  this.account=this.policy?options?.sharedAccount:undefined;
 }
 private readonly account:ValleySpiritSyntheticSharedAccount|undefined;
 stop(){this.stopped=true;}
 private active(){return !this.stopped&&!!this.policy&&!!this.account;}
 private async settlement(request:Parameters<ValleySpiritAlmanacAdmission['reserve']>[0]):ReturnType<ValleySpiritAlmanacAdmission['reserve']>{
  if(!this.active()||request.purpose!==FEATURE||request.promptVersion!==1||!/^valley-almanac-[a-f0-9]{64}$/.test(request.requestId)||!int(request.packetBytes,1,128_000))return null;
  const p=this.policy!,maxInputTokens=request.packetBytes+p.inputOverheadTokens;
  // Byte-count upper estimate plus explicit envelope overhead for the offline
  // protocol. Production must use its real tokenizer and model/usage contract.
  if(!Number.isSafeInteger(maxInputTokens)||maxInputTokens>p.yearbookCap.tpm-p.outputTokens)return null;
  const grant=await this.account!.requestLowPriority({purpose:FEATURE,accountId:p.accountId,requestId:request.requestId,
   ...requestPolicy(p),maxInputTokens,maxOutputTokens:p.outputTokens,cooldownMs:p.cooldownMs,promptVersion:1});
  if(!grant)return null;
  let phase:'held'|'cancelled'|'entered-shared-dispatch'='held';
  const cancelUnsent=()=>{if(phase==='held'){phase='cancelled';grant.cancelBeforeDispatch();}};
  return {
   cancelUnsent,
   send:async(packet,permit)=>{
    if(phase!=='held')throw Error('almanac_reservation_already_consumed');
    const allowed=()=>this.active()&&permit();
    if(!allowed()){cancelUnsent();throw Error('almanac_dispatch_revoked');}
    phase='entered-shared-dispatch';
    // From this point failures are ambiguous unless the account owner proves
    // otherwise. Do not convert a local abort to cancellation or return a slot.
    return grant.dispatchOnce(packet,allowed);
   },
  };
 }
 /** Advance explicitly after a complete trusted interval; no timer, catch-up,
  * world-write or runtime auto-start. At most one scheduled attempt per range:
  * durable pending intents and failed/admission-denied ranges are not retried
  * implicitly. Optional stopping never hides subordinate objective weather. */
 async advance(closedThroughHour:number):Promise<{status:Status;window?:Window;entryId?:string;fallback:'objective-weather-points'}>{
  const fallback='objective-weather-points' as const;
  if(!this.active())return {status:'disabled',fallback};
  if(this.running)return {status:'running',fallback};
  const {periodHours}=this.policy!;
  if(!int(closedThroughHour,0,MAX_HOUR)||closedThroughHour<periodHours)return {status:'not-due',fallback};
  const toHour=Math.floor(closedThroughHour/periodHours)*periodHours,window={fromHour:toHour-periodHours,toHour};
  this.running=true;
  try{
   const facts=this.evidence({...window});
   if(!facts?.sourceRefs.length)return {status:'no-evidence',window,fallback};
   // Inclusive previous representable float below a closed integer boundary.
   // Works even at high minute indices where subtracting 1e-8 is a no-op.
   const bits=new DataView(new ArrayBuffer(8));
   bits.setFloat64(0,toHour*60);
   bits.setBigUint64(0,bits.getBigUint64(0)-1n);
   const range:ValleySpiritAlmanacRange={worldId:facts.worldId,fromMinute:window.fromHour*60,throughMinute:bits.getFloat64(0),sourceRefs:[...facts.sourceRefs]};
   const previous=this.almanac.schedulingState(range);
   if(previous.status==='unavailable')return {status:'blocked',window,fallback};
   if(previous.status==='recorded'){
    if(previous.phase==='dispatch-intent'||previous.phase==='sent-unknown')return {status:'blocked',window,fallback};
    if(previous.phase!=='grounded')return {status:'window-processed',window,fallback};
    const id=previous.entryId;
    return this.active()&&this.almanac.publish(id)&&!!this.almanac.get(id)?
     {status:'published',window,entryId:id,fallback}:{status:'blocked',window,fallback};
   }
   if(!this.almanac.objective(range))return {status:'no-evidence',window,fallback};
   const id=await this.almanac.generate(range,syntheticValleySpiritAlmanacAdmission(request=>this.settlement(request)));
   if(!id){
    const now=this.almanac.schedulingState(range);
    return {status:now.status==='unavailable'||now.status==='recorded'&&['dispatch-intent','sent-unknown'].includes(now.phase)?'blocked':'deferred',window,fallback};
   }
   return this.active()&&this.almanac.publish(id)&&!!this.almanac.get(id)?
    {status:'published',window,entryId:id,fallback}:{status:'blocked',window,fallback};
  }catch{return {status:'blocked',window,fallback};}
  finally{this.running=false;}
 }
}

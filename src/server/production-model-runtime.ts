/** Default-disconnected durable runtime bridges. main never imports this module.
 * Caller owns WorldStore/SQLite handles and closes them after close(). Reviewed
 * integration is a trusted API, not an evidence authenticator or production launch. */
import {ValleyRuntime,type DecisionCommittedEvent} from './runtime.js';
import {WorldStore} from './store.js';
import {ProductionModelJournal,CLEAN_RUNTIME_STOP_REASONS} from './production-model-journal.js';
import type {AcceptanceStopStatus} from './acceptance-stop-control.js';
import {ProductionSiliconFlowHttpCandidate,type ProductionHttpTransport} from './production-model-http.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {parseModelCompletion,prepareModelDecision,type ModelResult} from './decisions.js';
import {persistedWorldFingerprint as fingerprint} from './acceptance-offline-protocol.js';
import {offlineProductionRuntimeOwners as owners} from './production-model-runtime-ownership.js';
import {createHash} from 'node:crypto';
import {ownsProductionAccountQuotaRehearsal,type ProductionModelAccountOwnership,type ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import type {SharedModelAccountPolicy} from './shared-model-account.js';
import {evaluateProductionHttpAdmission,type ProductionHttpAdmission} from './production-model-admission.js';

type RuntimeOptions={store:WorldStore;journal:ProductionModelJournal;
 transport:ProductionHttpTransport;endGameMinute:number;maxWallMs?:number};
interface OfflineResidentCanonicalQuota {
 mode:'explicit-disconnected-resident-quota';ownership:ProductionModelAccountOwnership;
 quota:ProductionAccountQuotaRehearsal;policy:SharedModelAccountPolicy;
}
const taken=new WeakSet<ProductionAccountQuotaRehearsal>();
const boundResidentJournals=new WeakSet<ProductionModelJournal>();
interface FormalSyntheticWeatherBinding {
 readonly store:WorldStore;readonly ownership:ProductionModelAccountOwnership;readonly quota:ProductionAccountQuotaRehearsal;
 readonly signal:AbortSignal;
 policy():SharedModelAccountPolicy;
 running():boolean;
}
// Only a factory-created, shared-quota offline bridge is eligible. Neither a
// runtime-shaped object nor a different account/registry can substitute here.
const formalSyntheticWeatherBindings=new WeakMap<object,FormalSyntheticWeatherBinding>();
export function formalSyntheticWeatherBinding(bridge:unknown){
 return bridge!==null&&typeof bridge==='object'?formalSyntheticWeatherBindings.get(bridge):undefined;
}

export function createProductionModelOfflineRuntime(input:RuntimeOptions&{sharedQuota?:Readonly<OfflineResidentCanonicalQuota>}){
 const options={...input},attachment=options.sharedQuota;
 if(options.journal.contract.executionKind!=='synthetic-production-candidate'||options.transport.kind!=='synthetic-production-http')
  throw new Error('production_runtime_offline_only');
 if(attachment===undefined)return createRuntimeBridge(options);
 if(!attachment||Object.keys(attachment).length!==4||attachment.mode!=='explicit-disconnected-resident-quota')
  throw Error('production_runtime_shared_quota_scope');
 const {ownership,quota}=attachment;
 if(!ownsProductionAccountQuotaRehearsal(ownership,quota)||taken.has(quota)||boundResidentJournals.has(options.journal)||!(options.store instanceof WorldStore)||
    quota.accountScope!==ownership.accountScope||quota.runId!==options.journal.contract.runId)
  throw Error('production_runtime_shared_quota_scope');
 const policy=structuredClone(attachment.policy),at=Date.now();
 ownership.assertOwned();
 if(!quota.matchesPolicy(policy)||policy.accountId!==ownership.accountScope)throw Error('production_runtime_shared_quota_policy');
 const summary=quota.summary(at);
 if(summary.held||summary.unknown||summary.waitingResidents)throw Error('production_runtime_shared_quota_unresolved');
 // The host owns an actual disconnected account handle, not a production
 // account attestation. The runtime itself validates exact journal/world head.
 const result=createRuntimeBridge(options,undefined,{quota,ownership,policy});
 taken.add(quota);boundResidentJournals.add(options.journal);
 return result;
}
/** Trusted integration only. Does not fetch evidence or authenticate records.
 * An operator must verify official exact-model pricing/account qualification and
 * previous uncertain requests outside this API. Hashes/zero fields alone prove
 * none of those facts. No provider-side zero-charge guarantee is claimed.
 * Explicit enable is required even when the caller already holds a transport.
 * main remains closed pending supervised startup and persistent account ownership.
 */
export function createReviewedProductionModelRuntime(options:RuntimeOptions&{enableLive?:boolean;admission:unknown}){
 if(options.enableLive!==true)throw new Error('live_execution_disabled');
 if(options.journal.contract.executionKind!=='gated-production-http-candidate'||options.transport.kind!=='gated-production-http')
  throw new Error('production_runtime_live_contract_required');
 const gate=evaluateProductionHttpAdmission(options.journal.contract,options.admission,Date.now());
 if(!gate.allowed)throw new Error(gate.reason);
 return createRuntimeBridge(options,gate.record);
}
function createRuntimeBridge(options:RuntimeOptions,reviewed?:ProductionHttpAdmission,shared?:Omit<OfflineResidentCanonicalQuota,'mode'>){
 const {store,journal}=options;
 if(owners.has(store))throw new Error('production_runtime_store_owned');
 const initial=store.loadForRuntime(),state=journal.status();
 if(!initial||initial.id!==journal.contract.worldId||initial.mode!=='formal'||fingerprint(initial)!==state.worldFingerprint)
  throw new Error('production_runtime_world_mismatch');
 if(state.pending||state.failure)throw new Error('production_runtime_unresolved');
 if(shared&&state.attempts!==0)throw new Error('production_runtime_shared_quota_requires_fresh_journal');
 journal.check(Date.now());
 const maxWallMs=options.maxWallMs??30_000;
 if(!Number.isFinite(options.endGameMinute)||options.endGameMinute<=initial.minute
  ||!Number.isSafeInteger(maxWallMs)||maxWallMs<1||maxWallMs>30_000
  ||journal.contract.maxRequests<=state.attempts)throw new Error('production_runtime_bounds_invalid');
 // Anchor the stricter bound before runtime construction, so construction,
 // synchronous credentials, slow journal writes and delayed timers cannot add time.
 const boundStart=performance.now(),boundWall=Date.now();
 const deadline=reviewed?boundStart+Math.min(maxWallMs,reviewed.pricing.validUntilMs-boundWall,journal.contract.deadlineAtMs-boundWall):null;
 let lastMonotonic=boundStart;
 let runtime:ValleyRuntime|undefined,closed=false,failure:string|null=null;
 const weatherStop=shared?new AbortController():undefined;
 const executionGuard=()=>{
  if(!reviewed)return;
  if(closed||failure)throw new Error(failure??'model_stopped');
  const now=performance.now();
  if(!Number.isFinite(now)||now<lastMonotonic)throw new Error('clock_invalid');lastMonotonic=now;
  const gate=evaluateProductionHttpAdmission(journal.contract,reviewed,Date.now());
  if(!gate.allowed)throw new Error(gate.reason);
  const checked=performance.now();
  if(!Number.isFinite(checked)||checked<now)throw new Error('clock_invalid');lastMonotonic=checked;
  if(checked>=deadline!)throw new Error('wall_limit');
 };
 const residentKey=shared?'resident-runtime-'+createHash('sha256').update(JSON.stringify([shared.ownership.accountScope,journal.contract.runId,journal.contract.worldId])).digest('hex'):null;
 let waiting=false,quotaFaulted=false;
 const fail=(reason:string)=>{
  failure??=reason;try{journal.block(reason);}catch{/* An uncommitted block is not successful recovery. */}
 };
 const quotaHealthy=()=>{
  if(!shared)return true;
  if(quotaFaulted)return false;
  try{
   shared.ownership.assertOwned();
   if(!shared.quota.matchesPolicy(shared.policy))throw Error('production_runtime_shared_quota_policy');
   shared.quota.summary(Date.now());
   return true;
  }catch{
   quotaFaulted=true;fail('resident_quota_wait_write_failed');return false;
  }
 };
 const updateWait=(demand:boolean):boolean=>{
  if(!shared||!residentKey)return true;
  if(quotaHealthy()){
   if(demand===waiting)return true;
   try{shared.quota.setResidentWaiting(residentKey,demand,Date.now());waiting=demand;return true;}
   catch{quotaFaulted=true;fail('resident_quota_wait_write_failed');}
  }
  // A failed store/owner check never clears a persistent waiter or marks
  // pending quota settled. Abort only the local fake transport.
  candidate.stop('shared_quota_unavailable');return false;
 };
 const candidate=new ProductionSiliconFlowHttpCandidate(journal,options.transport,reviewed?{executionGuard}:shared?
  {quotaRehearsal:shared.quota,executionGuard:()=>{if(!quotaHealthy())throw Error('shared_quota_unavailable');}}:{});
 const results=new WeakMap<ModelResult,{id:number;actorId:string}>();
 const original=store.commit;
 const load=()=>{const world=store.loadForRuntime();if(!world)throw new Error('production_runtime_world_missing');return world;};
 const failedControl=(control:AcceptanceStopStatus|null)=>!!control&&(control.issues.length>0
  ||control.phase==='stopped'&&!CLEAN_RUNTIME_STOP_REASONS.some(reason=>reason===control.reason));
 owners.add(store);
 store.commit=(...args:Parameters<WorldStore['commit']>)=>{
  try{
   // Never persist a progressed draft after an expiry encountered during
   // synchronous simulation. Stopped-control cleanup may still persist pause.
   if(reviewed&&runtime?.acceptanceStopStatus()?.phase==='running'){
    try{executionGuard();}catch(error){fail(error instanceof Error?error.message:'model_failed');throw error;}
   }
   original.apply(store,args);
   // World first, journal second. A crash in this gap fails fingerprint checks;
   // a checkpoint after response does NOT acknowledge that response.
   if(!failure&&!journal.status().failure)journal.checkpointWorld(fingerprint(load()),Date.now());
   if(['model_context_limit','model_request_invalid'].includes(args[0].metrics.lastError??'')){
    fail('request_preparation_failed');throw new Error('production_runtime_preparation_failed');
   }
  }catch(error){fail('world_checkpoint_failed');throw error;}
 };
 const decisionCommitted=(event:DecisionCommittedEvent)=>{
  try{
   const request=results.get(event.result),pending=journal.status().pending,world=load();
   if(!request||request.actorId!==event.actorId||pending?.id!==request.id||pending.phase!=='response'
    ||world.revision!==event.revision||fingerprint(world)!==journal.status().worldFingerprint)
    throw new Error('decision_commit_unmatched');
   results.delete(event.result);
   if(!event.accepted)throw new Error('decision_rejected');
   if(!candidate.acknowledgeWorldCommit(request.id,fingerprint(world)))throw new Error('decision_ack_failed');
  }catch(error){
   const reason=error instanceof Error&&['decision_commit_unmatched','decision_rejected','decision_ack_failed'].includes(error.message)?error.message:'decision_ack_failed';
   fail(reason);candidate.stop('model_failed');throw new Error(reason);
  }
 };
 try{
  // Only a matched, pending-free journal can identify saved inFlight as local
  // cleanup after an acknowledged decision. Never use this to clear an intent.
  if(initial.metrics.inFlight.length){
   const clean=structuredClone(initial);clean.metrics.inFlight=[];clean.revision++;store.commit(clean,initial.revision);
  }
  runtime=new ValleyRuntime(store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async(_key,context,feedback,model,prepared,execution)=>{
   if(closed||failure||model!==P.model)throw new Error('production_runtime_dispatch_blocked');
   try{
    const request=prepared??prepareModelDecision(context,feedback,P.model),started=Date.now();
    const response=await candidate.complete(request.messages,{model,signal:execution?.signal});
    if(!response||closed||execution?.signal.aborted)throw new Error('production_runtime_no_response');
    const result=parseModelCompletion(context,request,response.reply,Math.max(0,Date.now()-started));
    results.set(result,{id:response.id,actorId:context.actor.id});return result;
   }catch(error){fail(candidate.status().failure??'model_decision_failed');candidate.stop('model_failed');throw error;}
  },{mode:'formal',dayMinutes:20,modelSlots:1,decisionCommitted,observeResidentQuotaWaiting:shared?updateWait:undefined,
   acceptanceLifecycle:{stopping:control=>{
    weatherStop?.abort();
    if(!updateWait(false))return;
    if(failure||journal.status().failure)return;
    try{journal.beginRuntimeStop(control.reason!,Date.now());}catch(error){fail('runtime_stop_persistence_failed');throw error;}
   },stopped:control=>{
    if(failure||journal.status().failure)return;
    try{
     const failed=failedControl(control)||journal.status().pending!==null;
     journal.finishRuntimeStop(fingerprint(load()),failed,Date.now());if(failed)failure='runtime_control_failed';
    }catch(error){fail('runtime_stop_persistence_failed');throw error;}
   }},
   acceptanceStop:{endGameMinute:options.endGameMinute,maxWallMs,
    ...(reviewed?{deadlineMonotonicMs:deadline!,revalidatePriceOnProgress:true}:{}),maxRequests:journal.contract.maxRequests-state.attempts,
    allowedModels:[P.model],unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',
    // Live integration revalidates the same bound, reviewed record on every
    // admission. Exact zero is currency-independent; never converts a paid rate.
    // Synthetic zero pricing remains confined to the offline factory.
    assessPrice:model=>{
     const now=Date.now();
     if(reviewed){try{executionGuard();}catch(error){
      fail(error instanceof Error?error.message:'model_failed');candidate.stop('model_failed');return null;
     }}
     const remaining=reviewed?Math.min(maxWallMs,reviewed.pricing.validUntilMs-now,journal.contract.deadlineAtMs-now):maxWallMs;
     return {model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+remaining};
    }}});
  const ownedRuntime=runtime;
  const controlFailed=()=>failedControl(ownedRuntime.acceptanceStopStatus());
  const boundsValid=()=>{try{executionGuard();return true;}catch{return false;}};
  const status=()=>({executionKind:reviewed?'reviewed-production-runtime-candidate' as const:'synthetic-production-runtime' as const,closed,failure:failure??journal.status().failure??(controlFailed()?'runtime_control_failed':null),
   journal:journal.status(),control:ownedRuntime.acceptanceStopStatus(),realModelExecuted:reviewed?candidate.status().realModelExecuted:false,
   liveExecutionEnabled:!!reviewed&&boundsValid()&&!closed&&!failure&&!journal.status().failure&&ownedRuntime.acceptanceStopStatus()?.phase==='running',
   providerBudgetEnforced:false as const,pricingBasis:reviewed?'caller-supplied-unverified-record' as const:'synthetic' as const,
   pricingVerifiedBySoftware:false as const,actualProviderCostCny:null,readyForProduction:false as const,acceptancePassed:null});
  const bridge={runtime:ownedRuntime,status,
   close(){
    if(closed)return status();
    // Revoke the bridge before cancellation; late replies cannot be parsed or
    // acknowledged. Runtime stop is synchronous but a remote abort is not proof.
    closed=true;weatherStop?.abort();
    try{ownedRuntime.stop();updateWait(false);
     if(controlFailed())fail('runtime_control_failed');
     if(journal.status().pending)fail('unresolved_request_no_retry');
     if(!failure&&!journal.status().failure&&fingerprint(load())!==journal.status().worldFingerprint)fail('world_checkpoint_failed');
    }catch{fail('runtime_close_failed');}
    finally{store.commit=original;owners.delete(store);}
    return status();
   }};
  if(shared&&weatherStop)formalSyntheticWeatherBindings.set(bridge,Object.freeze({store,...shared,signal:weatherStop.signal,
   policy:()=>structuredClone(shared.policy),
   running:()=>!closed&&!weatherStop.signal.aborted&&!failure&&!journal.status().failure&&
    ownedRuntime.acceptanceStopStatus()?.phase==='running'}));
  return bridge;
 }catch(error){fail('runtime_initialization_failed');candidate.stop('model_failed');store.commit=original;owners.delete(store);throw error;}
}

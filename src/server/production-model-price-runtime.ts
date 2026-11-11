/** Synthetic-only, default-disconnected price/session -> durable runtime bridge.
 * No path, credential, live capability, fetch callback or clock override. The
 * trusted caller owns all three isolated SQLite handles and their safe paths.
 * Two journals plus the world are NOT an atomic transaction. Every uncertain
 * boundary fails closed; nothing here creates/replaces a session or clears it. */
import {ValleyRuntime,type DecisionCommittedEvent} from './runtime.js';
import type {WorldStore} from './store.js';
import {ProductionModelJournal,CLEAN_RUNTIME_STOP_REASONS,modelEvidenceHash as hash} from './production-model-journal.js';
import {SyntheticPriceSession,SYNTHETIC_PRICE_SESSION_LIMITS as L} from './production-model-price-session.js';
import {ProductionSiliconFlowHttpCandidate,type ProductionHttpTransport} from './production-model-http.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {modelRequestPayload} from './model-completion.js';
import {parseModelCompletion,prepareModelDecision,type ModelResult} from './decisions.js';
import {persistedWorldFingerprint as fingerprint} from './acceptance-offline-protocol.js';
import {offlineProductionRuntimeOwners as owners} from './production-model-runtime-ownership.js';
import type {AcceptanceStopStatus} from './acceptance-stop-control.js';

export function createSyntheticPriceRuntimeSegment(options:{store:WorldStore;journal:ProductionModelJournal;
 session:SyntheticPriceSession;transport:ProductionHttpTransport;endGameMinute:number}){
 const {store,journal,session}=options,c=session.contract,j=journal.contract;
 if(c.executionKind!=='synthetic-price-session-v1'||j.executionKind!=='synthetic-production-candidate'
  ||options.transport.kind!=='synthetic-production-http')throw new Error('price_runtime_offline_only');
 if(owners.has(store))throw new Error('production_runtime_store_owned');
 for(const field of ['runId','worldId','maxRequests','createdAtMs','deadlineAtMs','requestTimeoutMs','provider','model','endpoint'] as const)
  if(c[field]!==j[field])throw new Error('price_runtime_contract_mismatch');
 const initial=store.loadForRuntime(),s=session.status(),js=journal.status();
 if(!initial||initial.mode!=='formal'||initial.id!==c.worldId||fingerprint(initial)!==s.worldFingerprint
  ||s.worldFingerprint!==js.worldFingerprint)throw new Error('price_runtime_world_mismatch');
 if(s.failure||js.failure||!s.persistenceHealthy||!js.persistenceHealthy||s.segment||s.pending||js.pending||js.runtimeStop)
  throw new Error('price_runtime_unresolved');
 if(s.attempts!==js.attempts||s.completed!==js.completed)throw new Error('price_runtime_ledger_mismatch');
 if(!Number.isFinite(options.endGameMinute)||options.endGameMinute<=initial.minute)throw new Error('price_runtime_endpoint_invalid');
 journal.check(Date.now());
 // Brand validation precedes session/world mutation. This transport is now
 // single-use even if beginning the segment subsequently waits or fails.
 let candidate:ProductionSiliconFlowHttpCandidate;
 candidate=new ProductionSiliconFlowHttpCandidate(journal,options.transport,{clock:{
  // The existing candidate checks its clock again after durable intent and
  // synchronously before invoking transport. Bind that synthetic-only seam to
  // the session too; a slow journal write must not dispatch past the cutoff.
  now:()=>{
   const at=Date.now(),state=session.status(),segment=state.segment;
   if(state.failure||!state.persistenceHealthy||!segment)throw new Error('price_runtime_session_failed');
   if(!Number.isSafeInteger(at)||at<state.lastObservedAtMs||at>=segment.deadlineAtMs
    ||state.pending&&at>=state.pending.deadlineAtMs+(state.pending.phase==='response'?c.commitGraceMs:0)){
    session.poll(at);throw new Error('price_runtime_clock_invalid');
   }
   const dispatched=candidate.status().transportInvocations;
   if(dispatched<state.attempts-s.attempts&&(state.phase==='draining'||at>=segment.admissionCutoffMs))
    throw new Error('price_runtime_admission_closed');
   return at;
  },setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)}});
 if(session.beginSegment(Date.now())===null)throw new Error('price_runtime_waiting_price');
 let runtime:ValleyRuntime|undefined,failure:string|null=null,closed=false,sealed=false;
 const persistenceIssues=new Set<'journal_block_failed'|'session_block_failed'>();
 let cutoffTimer:ReturnType<typeof setTimeout>|undefined,hardTimer:ReturnType<typeof setTimeout>|undefined,
  pendingTimer:ReturnType<typeof setTimeout>|undefined;
 const original=store.commit,results=new WeakMap<ModelResult,{id:number;actorId:string}>();
 const load=()=>{const w=store.loadForRuntime();if(!w)throw new Error('price_runtime_world_missing');return w;};
 const checkpoint=()=>({worldId:c.worldId,fingerprint:fingerprint(load())});
 const fail=(reason:string)=>{
  failure??=reason;
  try{journal.block(reason);}catch{persistenceIssues.add('journal_block_failed');}
  try{session.fail('runtime_failed');}catch{persistenceIssues.add('session_block_failed');}
 };
 const clearPending=()=>{const timer=pendingTimer;pendingTimer=undefined;if(timer!==undefined)clearTimeout(timer);};
 const clearTimers=()=>{
  const timers=[cutoffTimer,hardTimer,pendingTimer];cutoffTimer=hardTimer=pendingTimer=undefined;
  let failed=false;for(const timer of timers)if(timer!==undefined){try{clearTimeout(timer);}catch{failed=true;}}
  if(failed)throw new Error('price_runtime_timer_failed');
 };
 const controlFailed=(control:AcceptanceStopStatus)=>control.issues.length>0
  ||!CLEAN_RUNTIME_STOP_REASONS.some(reason=>reason===control.reason);
 const requestDrain=()=>{
  if(closed||failure||sealed)return;
  const state=session.status();
  if(state.phase==='running')session.beginDrain(Date.now());
  else if(state.phase!=='draining')throw new Error('price_runtime_drain_invalid');
  runtime?.drainAcceptance();
 };
 const stopFailed=(reason:string)=>{
  fail(reason);
  try{clearTimers();}catch{fail('price_runtime_timer_failed');}
  candidate.stop('model_failed');
  try{runtime?.stop();}catch{fail('price_runtime_stop_failed');}
 };
 const admission=()=>{
  if(failure||closed||sealed)throw new Error('price_runtime_blocked');
  const state=session.status(),now=Date.now();
  if(state.failure||!state.persistenceHealthy)throw new Error('price_runtime_session_failed');
  if(state.phase==='draining')return false;
  if(!state.segment||state.phase!=='running')throw new Error('price_runtime_segment_missing');
  if(!Number.isSafeInteger(now)||now<state.lastObservedAtMs||now>=state.segment.deadlineAtMs){session.poll(now);throw new Error('price_runtime_clock_invalid');}
  if(now>=state.segment.admissionCutoffMs||state.attempts>=c.maxRequests||state.segment.attempts>=L.segmentRequests){
   session.beginDrain(now);return false;
  }
  return true;
 };
 owners.add(store);
 store.commit=(...args:Parameters<WorldStore['commit']>)=>{
  try{
   original.apply(store,args);
   if(!failure&&!journal.status().failure&&!session.status().failure){
    const w=checkpoint();journal.checkpointWorld(w.fingerprint,Date.now());session.checkpointWorld(w,Date.now());
   }
   if(['model_context_limit','model_request_invalid'].includes(args[0].metrics.lastError??''))throw new Error('price_runtime_preparation_failed');
  }catch(error){fail('world_checkpoint_failed');throw error;}
 };
 const decisionCommitted=(event:DecisionCommittedEvent)=>{
  try{
   const request=results.get(event.result),jp=journal.status(),sp=session.status(),world=load(),w=checkpoint();
   if(!request||request.actorId!==event.actorId||jp.pending?.id!==request.id||sp.pending?.id!==request.id
    ||jp.pending.phase!=='response'||sp.pending.phase!=='response'||jp.pending.requestHash!==sp.pending.requestHash
    ||jp.pending.responseHash!==sp.pending.responseHash||world.revision!==event.revision
    ||w.fingerprint!==jp.worldFingerprint||w.fingerprint!==sp.worldFingerprint)throw new Error('decision_commit_unmatched');
   results.delete(event.result);
   if(!event.accepted)throw new Error('decision_rejected');
   if(!candidate.acknowledgeWorldCommit(request.id,w.fingerprint))throw new Error('decision_ack_failed');
   session.acknowledgeWorldCommit(request.id,w,Date.now());clearPending();
   const after=session.status();
   if(after.attempts>=c.maxRequests||after.segment!.attempts>=L.segmentRequests)requestDrain();
  }catch(error){
   const reason=error instanceof Error&&['decision_rejected','decision_commit_unmatched'].includes(error.message)?error.message:'decision_ack_failed';
   fail(reason);candidate.stop('model_failed');throw error;
  }
 };
 try{
  if(initial.metrics.inFlight.length){const clean=structuredClone(initial);clean.metrics.inFlight=[];clean.revision++;store.commit(clean,initial.revision);}
  const segment=session.status().segment!;
  runtime=new ValleyRuntime(store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async(_key,context,feedback,model,prepared,execution)=>{
   if(failure||closed||sealed||model!==P.model)throw new Error('price_runtime_dispatch_blocked');
   try{
    const request=prepared??prepareModelDecision(context,feedback,P.model),started=Date.now();
    const body=modelRequestPayload(P.model,request.messages,0.25),id=session.beginRequest(hash(body),started);
    if(id===null||id!==journal.status().attempts+1)throw new Error('price_runtime_intent_mismatch');
    const pending=session.status().pending!;
    pendingTimer=setTimeout(()=>stopFailed('price_runtime_pending_deadline'),Math.max(0,pending.deadlineAtMs+c.commitGraceMs-Date.now()));
    const response=await candidate.complete(request.messages,{model,signal:execution?.signal});
    if(!response||closed||failure||execution?.signal.aborted||response.id!==id)throw new Error('price_runtime_no_response');
    session.recordResponse(id,hash(response.reply),Date.now());
    const result=parseModelCompletion(context,request,response.reply,Math.max(0,Date.now()-started));
    results.set(result,{id,actorId:context.actor.id});return result;
   }catch(error){fail('model_decision_failed');candidate.stop('model_failed');throw error;}
  },{mode:'formal',dayMinutes:20,modelSlots:1,decisionCommitted,acceptanceAdmission:admission,
   acceptanceLifecycle:{stopping:control=>{
    try{clearTimers();}catch(error){fail('price_runtime_timer_failed');throw error;}
    if(failure||journal.status().failure||session.status().failure){fail(failure??'price_runtime_ledger_failed');return;}
    try{
     if(controlFailed(control)||journal.status().pending||session.status().pending)throw new Error('price_runtime_unclean_stop');
     if(session.status().phase==='running')session.beginDrain(Date.now());
     journal.beginRuntimeStop(control.reason!,Date.now());
    }catch(error){fail('runtime_stop_persistence_failed');throw error;}
   },stopped:control=>{
    if(failure||journal.status().failure||session.status().failure){fail(failure??'price_runtime_ledger_failed');return;}
    try{
     if(controlFailed(control)||journal.status().pending||session.status().pending)throw new Error('price_runtime_unclean_stop');
     const w=checkpoint(),jp=journal.status(),sp=session.status();
     if(jp.attempts!==sp.attempts||jp.completed!==sp.completed||jp.worldFingerprint!==w.fingerprint||sp.worldFingerprint!==w.fingerprint)
      throw new Error('price_runtime_ledger_mismatch');
     journal.finishRuntimeStop(w.fingerprint,false,Date.now());
     // Last fallible operation of the stop observer. Until this FULL commit,
     // session recovery sees an unsealed segment and rejects all continuation.
     session.finishSegment(w,Date.now());sealed=true;
    }catch(error){fail('price_runtime_seal_failed');throw error;}
   }},acceptanceStop:{endGameMinute:options.endGameMinute,maxWallMs:Math.max(1,segment.deadlineAtMs-Date.now()),
    maxRequests:Math.min(c.maxRequests-s.attempts,L.segmentRequests),allowedModels:[P.model],
    unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',
    assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,
     validUntilMonotonicMs:performance.now()+Math.max(0,segment.deadlineAtMs-Date.now())})}});
  cutoffTimer=setTimeout(()=>{try{requestDrain();}catch{stopFailed('price_runtime_drain_failed');}},Math.max(0,segment.admissionCutoffMs-Date.now()));
  hardTimer=setTimeout(()=>stopFailed('price_runtime_segment_deadline'),Math.max(0,segment.deadlineAtMs-Date.now()));
  const ownedRuntime=runtime;
  const status=()=>({executionKind:'synthetic-price-runtime' as const,closed,sealed,failure:failure??journal.status().failure??session.status().failure,
   persistenceIssues:[...persistenceIssues],
   journal:journal.status(),session:session.status(),control:ownedRuntime.acceptanceStopStatus(),realModelExecuted:false as const,
   liveExecutionEnabled:false as const,actualProviderCostCny:null,readyForProduction:false as const,requiresExternalWatchdog:true as const,acceptancePassed:null});
  return {runtime:ownedRuntime,status,
   drain(){try{requestDrain();}catch{stopFailed('price_runtime_drain_failed');}return status();},
   close(){
    if(closed)return status();
    // Closing is cancellation, not drain: a pending request cannot be declared
    // clean. The caller must await a drained/sealed status before disposal.
    closed=true;
    try{
     try{clearTimers();}catch{fail('price_runtime_timer_failed');}
     ownedRuntime.stop();
     const control=ownedRuntime.acceptanceStopStatus();
     if(!sealed||failure||control&&controlFailed(control))fail(failure??'price_runtime_close_unsealed');
    }catch{fail('price_runtime_close_failed');}
    finally{if(!sealed)candidate.stop('model_failed');store.commit=original;owners.delete(store);}
    return status();
   }};
 }catch(error){stopFailed('price_runtime_initialization_failed');store.commit=original;owners.delete(store);throw error;}
}

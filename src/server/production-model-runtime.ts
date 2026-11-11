/** Default-disconnected, synthetic-only durable runtime bridge. No path, key,
 * endpoint, credential callback, real transport or live switch is accepted.
 * Caller owns isolated WorldStore/SQLite handles and closes them after close(). */
import {ValleyRuntime,type DecisionCommittedEvent} from './runtime.js';
import {WorldStore} from './store.js';
import {ProductionModelJournal,CLEAN_RUNTIME_STOP_REASONS} from './production-model-journal.js';
import type {AcceptanceStopStatus} from './acceptance-stop-control.js';
import {ProductionSiliconFlowHttpCandidate,type ProductionHttpTransport} from './production-model-http.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {parseModelCompletion,prepareModelDecision,type ModelResult} from './decisions.js';
import {persistedWorldFingerprint as fingerprint} from './acceptance-offline-protocol.js';
import {offlineProductionRuntimeOwners as owners} from './production-model-runtime-ownership.js';

export function createProductionModelOfflineRuntime(options:{store:WorldStore;journal:ProductionModelJournal;
 transport:ProductionHttpTransport;endGameMinute:number;maxWallMs?:number}){
 const {store,journal}=options;
 if(journal.contract.executionKind!=='synthetic-production-candidate'||options.transport.kind!=='synthetic-production-http')
  throw new Error('production_runtime_offline_only');
 if(owners.has(store))throw new Error('production_runtime_store_owned');
 const initial=store.loadForRuntime(),state=journal.status();
 if(!initial||initial.id!==journal.contract.worldId||initial.mode!=='formal'||fingerprint(initial)!==state.worldFingerprint)
  throw new Error('production_runtime_world_mismatch');
 if(state.pending||state.failure)throw new Error('production_runtime_unresolved');
 journal.check(Date.now());
 const maxWallMs=options.maxWallMs??30_000;
 if(!Number.isFinite(options.endGameMinute)||options.endGameMinute<=initial.minute
  ||!Number.isSafeInteger(maxWallMs)||maxWallMs<1||maxWallMs>30_000
  ||journal.contract.maxRequests<=state.attempts)throw new Error('production_runtime_bounds_invalid');
 const candidate=new ProductionSiliconFlowHttpCandidate(journal,options.transport);
 let runtime:ValleyRuntime|undefined,closed=false,failure:string|null=null;
 const results=new WeakMap<ModelResult,{id:number;actorId:string}>();
 const original=store.commit;
 const fail=(reason:string)=>{
  failure??=reason;try{journal.block(reason);}catch{/* An uncommitted block is not successful recovery. */}
 };
 const load=()=>{const world=store.loadForRuntime();if(!world)throw new Error('production_runtime_world_missing');return world;};
 const failedControl=(control:AcceptanceStopStatus|null)=>!!control&&(control.issues.length>0
  ||control.phase==='stopped'&&!CLEAN_RUNTIME_STOP_REASONS.some(reason=>reason===control.reason));
 owners.add(store);
 store.commit=(...args:Parameters<WorldStore['commit']>)=>{
  try{
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
   }catch(error){fail('model_decision_failed');candidate.stop('model_failed');throw error;}
  },{mode:'formal',dayMinutes:20,modelSlots:1,decisionCommitted,
   acceptanceLifecycle:{stopping:control=>{
    if(failure||journal.status().failure)return;
    try{journal.beginRuntimeStop(control.reason!,Date.now());}catch(error){fail('runtime_stop_persistence_failed');throw error;}
   },stopped:control=>{
    if(failure||journal.status().failure)return;
    try{
     const failed=failedControl(control)||journal.status().pending!==null;
     journal.finishRuntimeStop(fingerprint(load()),failed,Date.now());if(failed)failure='runtime_control_failed';
    }catch(error){fail('runtime_stop_persistence_failed');throw error;}
   }},
   acceptanceStop:{endGameMinute:options.endGameMinute,maxWallMs,maxRequests:journal.contract.maxRequests-state.attempts,
    allowedModels:[P.model],unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',
    // Synthetic control only, never evidence for production HTTP admission.
    assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+maxWallMs})}});
  const ownedRuntime=runtime;
  const controlFailed=()=>failedControl(ownedRuntime.acceptanceStopStatus());
  const status=()=>({executionKind:'synthetic-production-runtime' as const,closed,failure:failure??journal.status().failure??(controlFailed()?'runtime_control_failed':null),
   journal:journal.status(),control:ownedRuntime.acceptanceStopStatus(),realModelExecuted:false as const,
   liveExecutionEnabled:false as const,actualProviderCostCny:null,readyForProduction:false as const,acceptancePassed:null});
  return {runtime:ownedRuntime,status,
   close(){
    if(closed)return status();
    // Revoke the bridge before cancellation; late replies cannot be parsed or
    // acknowledged. Runtime stop is synchronous but a remote abort is not proof.
    closed=true;
    try{ownedRuntime.stop();
     if(controlFailed())fail('runtime_control_failed');
     if(journal.status().pending)fail('unresolved_request_no_retry');
     if(!failure&&!journal.status().failure&&fingerprint(load())!==journal.status().worldFingerprint)fail('world_checkpoint_failed');
    }catch{fail('runtime_close_failed');}
    finally{store.commit=original;owners.delete(store);}
    return status();
   }};
 }catch(error){fail('runtime_initialization_failed');candidate.stop('model_failed');store.commit=original;owners.delete(store);throw error;}
}

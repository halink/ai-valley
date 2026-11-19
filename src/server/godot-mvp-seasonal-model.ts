import {OfflineResidentAccountAdmission,type ResidentAccountRound} from './shared-resident-admission.js';
import {createServer} from 'node:http';
import {acquireRuntimeOwnership} from './runtime-lock.js';
import {preflightWorldSave} from './save-preflight.js';
import {WorldStore} from './store.js';
import {assertMvpWorld} from './godot-mvp-persistent.js';
import {createMvpSession,createMvpWorld,mvpPhase} from './godot-mvp.js';
import {validateMvpClimate} from '../world/mvp-climate-state.js';
import {validateMvpPreservation} from '../world/mvp-preservation.js';
import {validateSeasonalKnowledge} from '../world/mvp-seasonal-knowledge.js';
import {MODEL_CONTEXT_VERSION,MODEL_MENU_VERSION,seasonalModelContext} from './seasonal-model-context.js';
import {DecisionError,prepareModelDecision,parseModelCompletion} from './decisions.js';
import {ModelBudget} from './model-budget.js';
import {modelRequestPayload,modelLimits,type ModelReply} from './model-completion.js';
import {finishSeasonalCharge,modelDigest,seasonalModelPolicy as policy,type SeasonalLedger,type SeasonalRequest} from './seasonal-model-ledger.js';
import {planStartError,stepWorld,submitPlan} from '../world/engine.js';
import type {Resident,World} from '../shared/types.js';

type MemoryRequest=Readonly<{id:string;actorId:string;payload:string}>;
type Entry={request:MemoryRequest;resolve:(reply:ModelReply)=>void;reject:()=>void};
type MemoryTransport=Readonly<{kind:'seasonal-memory'}>;
const transports=new WeakMap<MemoryTransport,{claimed:boolean;invoke:(request:MemoryRequest,signal:AbortSignal)=>Promise<ModelReply>}>();
/** Data-only synthetic transport; no callback, URL, environment or live key. */
export function createSeasonalMemoryTransport(){
 const calls:Entry[]=[],transport=Object.freeze({kind:'seasonal-memory'} as const);
 transports.set(transport,{claimed:false,invoke:(request,signal)=>new Promise((resolve,reject)=>{
  const cancel=()=>reject(Error('synthetic_transport_unknown'));
  signal.addEventListener('abort',cancel,{once:true});
  calls.push({request,resolve:reply=>{signal.removeEventListener('abort',cancel);resolve(reply);},reject:()=>{signal.removeEventListener('abort',cancel);cancel();}});
 })});
 return {transport,requests:()=>calls.map(c=>c.request),
  reply:(i:number,value:ModelReply)=>calls[i].resolve(structuredClone(value)),reject:(i:number)=>calls[i].reject()};
}
export function startLiveSeasonalModel():never {
 // Prior live request outcome and billing remain unverified. Neither an
 // environment switch nor possession of a key can create this capability.
 throw Error('seasonal_model_live_blocked_previous_request_and_billing_unverified');
}
function modelWorld(w:World){
 if(w.schemaVersion===3)throw Error('seasonal_model_shelter_save_unsupported');
 assertMvpWorld(w);validateMvpClimate(w);validateMvpPreservation(w);validateSeasonalKnowledge(w);
 if(w.mvpClimate?.schemaVersion!==3||!w.mvpSoil||!w.mvpAgriculture||!w.mvpPreservation||w.simulationOnly)throw Error('seasonal_model_world_dependencies');
 const m=w.metrics;
 if(m.configured!==false||m.inFlight.length||[m.requests,m.successes,m.failures,m.inputTokens,m.outputTokens].some(n=>n!==0)||
  m.lastAttemptModel!==undefined||m.admissionCancellation!==undefined||m.routing!==undefined||Object.keys(m.usageWindow??{}).length||Object.keys(m.selfHostedCooldowns??{}).length||m.unmeteredFailures)
  throw Error('seasonal_model_legacy_provider_history');
}
const wall=()=>{const value=Date.now();if(!Number.isSafeInteger(value)||value<0)throw Error('seasonal_model_wall_clock');return value;};
function validateSyntheticReply(reply:ModelReply){
 const counts=[reply?.usage?.prompt_tokens,reply?.usage?.completion_tokens] as const;
 if(counts.some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0)))throw Error('seasonal_model_reply_usage');
 if(typeof reply?.content!=='string'||Buffer.byteLength(reply.content)>32_000||reply.finish!==null&&typeof reply.finish!=='string')throw Error('seasonal_model_reply_shape');
 return counts;
}
const ready=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&!r.plan&&!r.activity&&r.decisionDue<=w.minute;
/** Separate bounded seasonal mode. Caller explicitly pumps the server; the
 * normal rules runner and all pre-existing model entry points stay unchanged. */
export async function startOfflineSeasonalModel(options:{mode:'offline-seasonal';database:string;port?:number;transport?:MemoryTransport;sharedAccount?:OfflineResidentAccountAdmission}){
 if(options.mode!=='offline-seasonal')throw Error('seasonal_model_explicit_mode_required');
 if(options.port!==undefined&&(!Number.isInteger(options.port)||options.port<0||options.port>65535))throw Error('seasonal_model_port');
 const transport=options.transport===undefined?undefined:transports.get(options.transport);
 if(options.transport!==undefined&&(!transport||transport.claimed))throw Error('seasonal_model_transport_untrusted');
 const shared=options.sharedAccount;
 if(shared!==undefined&&(!(shared instanceof OfflineResidentAccountAdmission)||!transport))throw Error('seasonal_model_shared_fixture_required');
 const binding=shared?.fixtureBinding();
 // One-shot capability claim, even if startup later fails. No await or
 // listener bind may allow a second world to claim the same synthetic slot.
 if(transport)transport.claimed=true;
 const owner=acquireRuntimeOwnership(options.database);
 let store:WorldStore|undefined,server:ReturnType<typeof createServer>|undefined,closed=false;
 try{
  owner.assertOwned();
  let inspected:SeasonalLedger|null=null;
  const saved=preflightWorldSave(owner.database,{requireWorld:true,allowSeasonalModel:true,inspectSeasonalModel:s=>{inspected=s;},validateWorld:v=>modelWorld(v as unknown as World)});
  // Cross-store binding is checked on the private preflight copy before
  // either the existing world or any resident/account state is changed.
  const previous=inspected as SeasonalLedger|null;
  if(shared&&saved&&!previous)throw Error('seasonal_model_shared_fixture_fresh_save_required');
  if(transport&&(previous?.schemaVersion===2?binding!==previous.sharedAccountBinding:!!shared&&!!previous))throw Error('seasonal_model_shared_account_mismatch');
  if(shared&&previous&&!shared.verifyWorldRecovery(previous.requests.map(r=>({round:{worldId:previous.worldId,residentId:r.actorId,roundId:r.id},worldTerminal:r.state!=='intent'}))))throw Error('seasonal_model_shared_recovery_unresolved');
  let w:World;
  if(saved){
   if(transport){store=new WorldStore(owner.database,{allowMvpClimate:true,seasonalModel:true});w=store.load()!;}
   else w=saved as unknown as World;
   modelWorld(w);
  }else w=createMvpSession({world:createMvpWorld()}).world;
  let ledger:SeasonalLedger|null=store?.seasonalLedger(w)??inspected;
  let fault:string|null=null,budgetWaiting=false,dispatch:Promise<ModelReply>|null=null,controller:AbortController|null=null;
  const read=()=>({mode:'offline-seasonal' as const,driver:'synthetic-model-decisions' as const,
   liveModel:'blocked' as const,realModelCalls:0,account:policy.account,slots:policy.slots,
   ...(ledger?.schemaVersion===2?{sharedAdmission:'durable-offline' as const}:{}),
   paused:closed||!transport||!!fault||budgetWaiting||ledger?.requests.at(-1)?.state==='intent',
   status:closed?'closed':fault??(ledger?.requests.at(-1)?.state==='intent'?(dispatch?'awaiting-synthetic-response':'sent-unknown'):(budgetWaiting?'synthetic-budget-wait':transport?'ready':'no-synthetic-provider')),
   minute:w.minute,phases:w.residents.map(mvpPhase),
   requests:ledger?.requests.length??0,accepted:ledger?.requests.filter(r=>r.state==='accepted').length??0});
  if(options.port!==undefined){
   server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='GET'&&req.url==='/ai-town/api/seasonal-model'){res.end(JSON.stringify(read()));return;}
    res.writeHead(404);res.end('{}');
   });
   await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(options.port,'127.0.0.1',()=>{server!.off('error',reject);resolve();});});
  }
  const commit=(draft:World,next?:SeasonalLedger)=>{
   owner.assertOwned();modelWorld(draft);
   if(!store){store=new WorldStore(owner.database,{allowMvpClimate:true,seasonalModel:true});store.commit(w,null);}
   draft.revision=Math.max(w.revision+1,draft.revision);
   store.commit(draft,w.revision,undefined,next);
   w=draft;if(next)ledger=next;
  };
  const synchronizePriority=()=>{
   if(shared)shared.setWorldWaiting(w.id,ledger?.requests.at(-1)?.state==='intent'||w.residents.some(r=>ready(w,r)));
  };
  if(shared&&binding&&!ledger){
   // Bind world with a zero-request manifest first so a crash before the
   // first dispatch cannot rotate the world/round identity or fall back.
   const bound=structuredClone(w);bound.schemaVersion=2;bound.mvpSeasonalModelVersion=1;
   bound.clock={...bound.clock,paused:true,reason:'等待已绑定的离线合成决定'};
   commit(bound,{schemaVersion:2,worldId:w.id,sharedAccountBinding:binding,nextSequence:1,lastWall:wall(),charges:[],requests:[]});
  }
  synchronizePriority();
  const pump=async ()=>{
   if(closed||!transport||fault||dispatch||ledger?.requests.at(-1)?.state==='intent')return read();
   try{
    const now=wall();
    // Conservative during any synchronous world write and failures. Lower
    // optional priority pressure only after persisted world state says so.
    shared?.setWorldWaiting(w.id,true);
    if(ledger&&now<ledger.lastWall)throw Error('seasonal_model_wall_clock_reversal');
    const actor=w.residents.filter(r=>ready(w,r)).sort((a,b)=>a.decisionDue-b.decisionDue||a.id.localeCompare(b.id))[0];
    if(!actor){
     const draft=structuredClone(w);draft.clock={...draft.clock,paused:false,reason:null};stepWorld(draft,1);commit(draft);synchronizePriority();return read();
    }
    if((ledger?.requests.length??0)>=1000)throw Error('seasonal_model_request_limit');
    const context=seasonalModelContext(w,actor),prepared=prepareModelDecision(context,undefined,policy.model);
    if(prepared.choices.length>32)throw Error('seasonal_model_menu_limit');
    const payload=modelRequestPayload(policy.model,prepared.messages,0.25);
    const budget=new ModelBudget(policy.rpm,policy.tpm,ledger?.charges,now);
    const limits=modelLimits[policy.model];
    const charge=budget.reserve(now,prepared.inputBytes+512,limits.answerTokens+limits.thinkingTokens);
    budgetWaiting=!charge;if(!charge)return read();
    const base:SeasonalLedger=ledger?structuredClone(ledger):{schemaVersion:1,worldId:w.id,nextSequence:1,lastWall:now,charges:[],requests:[]};
    const request:SeasonalRequest={id:w.id+':seasonal-model:'+base.nextSequence++,actorId:actor.id,actorRevision:actor.revision,minute:w.minute,worldRevision:w.revision,at:now,contextVersion:MODEL_CONTEXT_VERSION,menuVersion:MODEL_MENU_VERSION,menuDigest:modelDigest(JSON.stringify(prepared.choices)),payload,digest:modelDigest(payload),state:'intent',finishedAt:null,usage:null};
    base.requests.push(request);base.lastWall=now;base.charges=budget.snapshot();
    const saveIntent=()=>{
     const waiting=structuredClone(w);waiting.schemaVersion=2;waiting.mvpSeasonalModelVersion=1;waiting.clock={...waiting.clock,paused:true,reason:'等待离线合成决定'};
     commit(waiting,base); // FULL SQLite world intent BEFORE memory dispatch
     return true;
    };
    const invoke=()=>{
     owner.assertOwned();
     controller=new AbortController();
     const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(150_000)]);
     dispatch=transport.invoke(Object.freeze({id:request.id,actorId:request.actorId,payload}),signal);
     return dispatch;
    };
    let reply:ModelReply;
    if(shared){
     const round:ResidentAccountRound={worldId:w.id,residentId:actor.id,roundId:request.id};
     shared.queue(round);
     const admitted=await shared.attempt({
      round,estimate:{inputTokens:charge.input,outputTokens:charge.output},
      authorize:()=>{owner.assertOwned();return !closed;},
      beforeHandoff:saveIntent,
      simulate:async()=>{
       const result=await invoke();
       const counts=validateSyntheticReply(result);
       const usage=counts[0]!==undefined||counts[1]!==undefined?{inputTokens:counts[0]??charge.input,outputTokens:counts[1]??charge.output}:undefined;
       return {completion:'synthetic-complete' as const,result,usage};
      },
     });
     if(closed)return read();
     if(admitted.status!=='complete'){
      budgetWaiting=admitted.status==='deferred';
      if(!budgetWaiting)fault=ledger?.requests.at(-1)?.state==='intent'?'sent-unknown':'seasonal_model_shared_recovery_unresolved';
      return read();
     }
     reply=admitted.result;
    }else{saveIntent();reply=await invoke();}
    if(closed)return read(); // late reply cannot acknowledge a stopped process
    const finished=wall();if(finished<now)throw Error('seasonal_model_wall_clock_reversal');
    const counts=validateSyntheticReply(reply);
    const validUsage=typeof counts[0]==='number'||typeof counts[1]==='number'?{...(typeof counts[0]==='number'?{inputTokens:counts[0]}:{}),...(typeof counts[1]==='number'?{outputTokens:counts[1]}:{})}:null;
    finishSeasonalCharge(budget,charge,finished,validUsage);
    const draft=structuredClone(w),person=draft.residents.find(r=>r.id===request.actorId);
    let accepted=false;
    let decision:ReturnType<typeof parseModelCompletion>|undefined;
    try{decision=parseModelCompletion(context,prepared,reply,finished-now);}catch(error){if(!(error instanceof DecisionError))throw error;}
    if(decision&&person&&person.revision===request.actorRevision&&ready(draft,person)){
     const plan={id:request.id+':plan',actorId:person.id,actorRevision:person.revision,createdAt:draft.minute,definition:draft.activeDefinitions['action/routine']??'action/routine@1',intention:'离线合成决定',actions:decision.decision.actions};
     if(!draft.processed.includes('plan:'+plan.id)&&!planStartError(draft,plan))accepted=submitPlan(draft,plan).ok;
    }
    if(person&&!accepted){person.lastFailure='选择未成，请在现场复查。';person.decisionDue=draft.minute+1;}
    if(person&&accepted)person.lastDecisionAt=draft.minute;
    draft.clock={...draft.clock,paused:false,reason:null};
    const next=structuredClone(base),terminal=next.requests.at(-1)!;terminal.state=accepted?'accepted':'rejected';terminal.finishedAt=finished;terminal.usage=validUsage;
    next.lastWall=finished;next.charges=budget.snapshot();
    commit(draft,next); // accepted plan + terminal receipt + replay charge in same tx
    synchronizePriority();
   }catch{
    // If intent committed, unknown remains in durable storage. No retry or
    // fabricated usage on crash, failed storage, malformed wire or close.
    if(!closed)fault=ledger?.requests.at(-1)?.state==='intent'?'sent-unknown':'seasonal-model-stopped';
   }finally{dispatch=null;controller=null;}
   return read();
  };
  let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{closed=true;controller?.abort();try{if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}store?.close();}finally{owner.release();}})();
  return {status:read,pump,close,server};
 }catch(error){try{if(server?.listening){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}store?.close();}finally{owner.release();}throw error;}
}

/** Offline-only nine-founder integration. No CLI, environment, key or save path
 * is accepted. It requires an already-created exclusive directory capability. */
import {createFrontierWorld} from '../world/formal-seed.js';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {AcceptanceEvidenceWriter} from './acceptance-evidence-writer.js';
import {AcceptanceRunDirectory} from './acceptance-run-directory.js';
import {parseModelCompletion,prepareModelDecision} from './decisions.js';
import {persistedWorldFingerprint} from './acceptance-offline-protocol.js';
import type {AcceptanceClock} from './acceptance-stop-control.js';
import {SiliconFlowHttpRehearsal,SILICONFLOW_HTTP_REHEARSAL as P,type SyntheticHttpTransport} from './acceptance-siliconflow-http.js';

export const NINE_HTTP_REHEARSAL=Object.freeze({protocol:'nine-founder-synthetic-http-wiring-v1',seed:5401,
 fromMinute:480,endGameMinute:482.5,dayMinutes:20,modelSlots:1,transport:P,
 realModelExecuted:false,readyForRealRun:false,acceptancePassed:null} as const);
export function createNineResidentHttpRehearsal(options:{directory:AcceptanceRunDirectory;transport:SyntheticHttpTransport;
 sourceFingerprint:string;sourceFingerprintAfter:()=>string;clock?:AcceptanceClock}){
 const {directory}=options;
 let store:WorldStore|undefined,writer:AcceptanceEvidenceWriter|undefined,runtime:ValleyRuntime|undefined;
 let closed=false,started=false;
 const http=new SiliconFlowHttpRehearsal({transport:options.transport,clock:options.clock,
  persist:event=>{directory.writeJson(`http-${String(event.sequence).padStart(4,'0')}.json`,event);return true;},
  onStop:reason=>runtime?.stopAcceptance(reason==='signal'?'signal':'manual_stop')});
 try{
  // Fail before opening a database if the caller tried to supply a live/custom transport.
  if(!http.start())throw new Error('synthetic_http_gate_required');
  const world=createFrontierWorld(NINE_HTTP_REHEARSAL.seed),founders=new Set(world.residents.map(r=>r.id));
  if(founders.size!==9||world.minute!==480)throw new Error('nine_founder_seed_changed');
  directory.writeJson('http-manifest.json',{...NINE_HTTP_REHEARSAL,sourceFingerprint:options.sourceFingerprint,
   founderIds:[...founders],priceEvidence:null,realAuthorization:false,accountAvailabilityVerified:false,
   realProviderCostUsd:null,remoteCancellationConfirmed:false,processSupervisorConnected:false});
  store=new WorldStore(directory.reserveDatabase());store.commit(world,null);
  writer=new AcceptanceEvidenceWriter({directory:directory.child('evidence'),sourceFingerprint:options.sourceFingerprint,worldId:world.id,fromMinute:world.minute});
  runtime=new ValleyRuntime(store,[{model:P.model,key:'SYNTHETIC-NOT-A-CREDENTIAL'}],async(_key,context,feedback,model,prepared,execution)=>{
   if(model!==P.model||!founders.has(context.actor.id)||context.foreign||context.outside){http.stop('input_invalid');throw new Error('synthetic_founder_scope_required');}
   const start=performance.now();
   try{
    const request=prepared??prepareModelDecision(context,feedback,P.model),reply=await http.complete(request.messages,execution?.signal);
    if(!reply)throw new Error('synthetic_http_stopped');
    const result=parseModelCompletion(context,request,reply,performance.now()-start);
    // This zero is an explicit fixture bridge, NEVER a provider billing claim.
    return {...result,acceptanceCostUsd:0};
   }catch{http.stop('decision_invalid');throw new Error('synthetic_http_stopped');}
  },{mode:'formal',dayMinutes:NINE_HTTP_REHEARSAL.dayMinutes,modelSlots:1,
   acceptanceStop:{endGameMinute:NINE_HTTP_REHEARSAL.endGameMinute,maxRequests:P.maxRequests,maxWallMs:P.maxWallMs,
    allowedModels:[P.model],clock:options.clock,assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,
     validUntilMonotonicMs:(options.clock?.now()??performance.now())+P.maxWallMs})},
   acceptanceEvidence:{writer,sourceFingerprintAfter:options.sourceFingerprintAfter}});
  const instance=runtime,storage=store,evidence=writer;
  return {runtime:instance,http,founderIds:Object.freeze([...founders]),
   start(){if(started||closed)throw new Error('rehearsal_single_use');started=true;instance.start();},
   close(){
    if(closed)return;closed=true;
    // Finish HTTP first when active so its stop evidence precedes runtime sealing.
    http.stop();instance.stop();
    try{const restored=storage.loadForRuntime(),runtimeFingerprint=persistedWorldFingerprint(instance.world),
      loadedFingerprint=restored?persistedWorldFingerprint(restored):null;
     directory.writeJson('http-close.json',{schema:1,executionKind:P.executionKind,status:http.status(),control:instance.acceptanceStopStatus(),
      reloadVerified:loadedFingerprint===runtimeFingerprint,loadedFingerprint,runtimeFingerprint,
      realModelExecuted:false,realProviderCostUsd:null,remoteCancellationConfirmed:false,acceptancePassed:null});
    }finally{evidence.abort();storage.close();}
   }};
 }catch{http.stop();runtime?.stop();writer?.abort();store?.close();throw new Error('synthetic_http_setup_failed');}
}

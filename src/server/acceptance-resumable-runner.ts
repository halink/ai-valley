/** Actual runtime + SQLite, fake deterministic decisions only. No transport,
 * key, old-world selection, model override or HTTP endpoint is accepted. */
import {AcceptanceRunDirectory} from './acceptance-run-directory.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from './acceptance-evidence-writer.js';
import {ResumableJournal} from './acceptance-resumable-journal.js';
import {RESUMABLE_PROTOCOL as P,RESUMABLE_PROTOCOL_HASH,RESUMABLE_LIVE_BLOCKERS} from './acceptance-resumable-protocol.js';
import {persistedWorldFingerprint as hash} from './acceptance-offline-protocol.js';
import {WorldStore} from './store.js';
import {ValleyRuntime} from './runtime.js';
import {createFrontierWorld} from '../world/formal-seed.js';
import {parseModelCompletion,prepareModelDecision} from './decisions.js';
import type {DailySnapshotConfig} from './acceptance-daily-snapshots.js';
import type {World} from '../shared/types.js';
export type ResumableFaultPoint='intent'|'response'|'committed'|'commit_gap';
export function resumableDailySnapshotConfig(sourceFingerprint:string):DailySnapshotConfig{
 return {schema:1,fromMinute:P.fromMinute,endMinute:P.endGameMinute,sourceFingerprint,
  founderIds:createFrontierWorld(P.seed).residents.map(p=>p.id)};
}
export function resumableManifest(sourceFingerprint:string){
 const world=createFrontierWorld(P.seed);
 return {schema:1,protocol:P,protocolHash:RESUMABLE_PROTOCOL_HASH,sourceFingerprint,worldId:world.id,
  initialWorldFingerprint:hash(world),dailySnapshots:resumableDailySnapshotConfig(sourceFingerprint),liveBlockers:RESUMABLE_LIVE_BLOCKERS,realModelExecuted:false,acceptancePassed:null};
}
export function createResumableOfflineSegment(options:{directory:AcceptanceRunDirectory;create:boolean;sourceFingerprint:string;
 sourceFingerprintAfter:()=>string;preallocatedSegment?:number;scenario?:'normal'|'stall'|'fail';fault?:(point:ResumableFaultPoint)=>void}){
 const {directory}=options,manifest=directory.readJson('resumable-manifest.json') as ReturnType<typeof resumableManifest>,
  expected=resumableManifest(options.sourceFingerprint);
 if(hash(manifest)!==hash(expected))throw new Error('resumable_manifest_mismatch');
 let journal:ResumableJournal|undefined,store:WorldStore|undefined,writer:AcceptanceEvidenceWriter|undefined,runtime:ValleyRuntime|undefined;
 let started=false,closed=false,segment=0,failure:string|null=null;
 try{
  journal=new ResumableJournal(directory,{create:options.create&&options.preallocatedSegment===undefined,sourceFingerprint:options.sourceFingerprint,worldId:expected.worldId});
  // Verify every pending intent BEFORE opening a world or constructing runtime.
  // A timeout/crash cannot authorize retransmission, even with a mocked provider.
  if(!options.create&&journal.status().pending)throw new Error('unresolved_request_no_retry');
  if(!options.create&&(journal.status().phase==='blocked'||journal.status().failure))throw new Error('resumable_run_blocked');
  // Closed historical segments must still exist and match the report hash
  // recorded in the durable audit. Never silently turn lost evidence into zero.
  let previousRunId:string|null=null;
  const evidenceSegments:Array<{segment:number;report:ReturnType<typeof readAcceptanceEvidence>}>=[];
  for(const closed of journal.closedEvidence()){
   let evidence;try{evidence=readAcceptanceEvidence(directory.child(`evidence-${String(closed.segment).padStart(4,'0')}`));}
   catch{throw new Error('resumable_prior_evidence_invalid');}
   if(!evidence.complete||evidence.runId!==closed.runId||evidence.previousRunId!==previousRunId||evidence.toMinute!==closed.throughMinute
    ||hash(evidence)!==closed.reportHash)throw new Error('resumable_prior_evidence_invalid');
   previousRunId=closed.runId;evidenceSegments.push({segment:closed.segment,report:evidence});
  }
  store=new WorldStore(directory.database('world.sqlite',options.create),{dailySnapshots:expected.dailySnapshots});
  if(options.create){const world=createFrontierWorld(P.seed);store.commit(world,null);const loaded=store.loadForRuntime()!;journal.checkpoint(loaded,hash(loaded));}
  const restored=store.loadForRuntime();if(!restored)throw new Error('resumable_world_missing');journal.verifyWorld(restored,hash(restored));store.dailySnapshotReport();
  if(options.preallocatedSegment!==undefined){const status=journal.status();
   if(!Number.isSafeInteger(options.preallocatedSegment)||status.segments!==options.preallocatedSegment||status.phase!=='active'||status.pending)throw new Error('resumable_reservation_mismatch');
   segment=status.segments;
  }else segment=journal.beginSegment();
  // Success commit precedes runtime's finally-block clearing its local map.
  // If the journal proves there is no unresolved request, stale inFlight is
  // local bookkeeping only, not a reason to replay or count another failure.
  if(!options.create&&restored.metrics.inFlight.length){
   const clean=structuredClone(restored);clean.metrics.inFlight=[];clean.revision++;store.commit(clean,restored.revision);
   const loaded=store.loadForRuntime()!;journal.checkpoint(loaded,hash(loaded),true);
  }
  const ownedJournal=journal,ownedStore=store,commit=store.commit.bind(store);
  let priorFailures=restored.metrics.failures;
  store.commit=(...args:Parameters<WorldStore['commit']>)=>{
   const hadPending=ownedJournal.status().pending;commit(...args);
   if(hadPending?.phase==='response')options.fault?.('commit_gap');
   // This intentionally follows the world transaction. If killed in this gap,
   // the durable world/journal mismatch blocks recovery instead of replaying.
   const loaded=ownedStore.loadForRuntime();if(!loaded)throw new Error('resumable_world_missing');
   ownedJournal.checkpoint(loaded,hash(loaded));
   if(['model_context_limit','model_request_invalid'].includes(loaded.metrics.lastError??'')){
    failure??='request_preparation_failed';ownedJournal.fail(failure);queueMicrotask(()=>runtime?.stopAcceptance());
   }
   if(loaded.metrics.failures>priorFailures){failure??='decision_failed';ownedJournal.fail(failure);}
   priorFailures=loaded.metrics.failures;
   if(hadPending&&!ownedJournal.status().pending)options.fault?.('committed');
  };
  writer=new AcceptanceEvidenceWriter({directory:directory.child(`evidence-${String(segment).padStart(4,'0')}`),sourceFingerprint:options.sourceFingerprint,
   worldId:restored.id,fromMinute:restored.minute,previousRunId:journal.status().lastEvidenceRunId});
  const endGameMinute=Math.min(P.endGameMinute,restored.minute+P.segmentGameMinutes),segmentMaxRequests=Math.min(P.segmentRequests,P.maxRequests-journal.status().attempts);
  runtime=new ValleyRuntime(store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async(_key,context,feedback,model,prepared,execution)=>{
   if(model!==P.model||execution?.signal.aborted||ownedJournal.status().phase!=='active')throw new Error('resumable_dispatch_blocked');
   const request=prepared??prepareModelDecision(context,feedback,P.model);
   const requestId=ownedJournal.intent(hash({model,messages:request.messages}));options.fault?.('intent');
   try{
    if(options.scenario==='fail')throw new Error('synthetic_failure');
    if(options.scenario==='stall')await new Promise<void>((_resolve,reject)=>{
     if(execution?.signal.aborted)reject(new Error('synthetic_cancelled'));
     else execution?.signal.addEventListener('abort',()=>reject(new Error('synthetic_cancelled')),{once:true});
    });
    const choice=request.choices.find(c=>c.action.type==='wait'||c.action.type==='stayOutside');
    if(!choice)throw new Error('synthetic_choice_missing');
    const result=parseModelCompletion(context,request,{content:JSON.stringify({choice:choice.id,minutes:15}),finish:'stop',usage:{prompt_tokens:1,completion_tokens:1}},0);
    if(execution?.signal.aborted)throw new Error('synthetic_cancelled');
    ownedJournal.response(requestId);options.fault?.('response');
    // Deliberately omit an actual-cost receipt. No invented provider zero.
    return result;
   }catch{failure??='synthetic_request_failed';ownedJournal.fail(failure);throw new Error('resumable_request_failed');}
  },{mode:'formal',dayMinutes:20,modelSlots:1,dailySnapshots:expected.dailySnapshots,
   acceptanceStop:{endGameMinute,maxWallMs:P.segmentWallMs-5000,maxRequests:segmentMaxRequests,allowedModels:[P.model],
    unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',
    // Synthetic assessment only. This module never validates real pricing.
    assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+P.segmentWallMs})},
   acceptanceEvidence:{writer,sourceFingerprintAfter:options.sourceFingerprintAfter}});
  const ownedRuntime=runtime,ownedWriter=writer;
  return {runtime:ownedRuntime,journal:ownedJournal,segment,
   start(){if(started||closed)throw new Error('resumable_segment_single_use');started=true;ownedRuntime.start();},
   close(){
    if(closed)throw new Error('resumable_segment_closed');closed=true;
    try{
     ownedRuntime.stop();
     const loaded=ownedStore.loadForRuntime();if(!loaded)throw new Error('resumable_world_missing');
     ownedJournal.verifyWorld(loaded,hash(loaded));
     const evidence=readAcceptanceEvidence(directory.child(`evidence-${String(segment).padStart(4,'0')}`));
     const control=ownedRuntime.acceptanceStopStatus();
     if(options.sourceFingerprintAfter()!==options.sourceFingerprint)failure??='source_changed';
     if(!evidence.complete||ownedWriter.status().phase!=='closed')failure??='evidence_incomplete';
     if(control?.issues.length||!['game_endpoint','manual_stop','signal','request_limit','wall_limit'].includes(control?.reason??''))failure??='runtime_failed';
     if(ownedJournal.status().pending)failure??='unresolved_request';
     if(failure)ownedJournal.fail(failure);else ownedJournal.finish(ownedWriter.status().runId,hash(evidence));
     const dailyReportFile=`segment-${String(segment).padStart(4,'0')}-daily-report.json`;
     // Derived output, not a third persistence authority. Rebuilt from atomic
     // SQLite snapshots and individually verified, sealed evidence segments.
     const segments=[...evidenceSegments,{segment,report:evidence}];
     let cursor=P.fromMinute as number;const evidenceGaps:Array<{fromMinute:number;toMinute:number|null}>=[];
     for(const {report}of segments){
      if(report.fromMinute!==cursor)evidenceGaps.push({fromMinute:cursor,toMinute:report.fromMinute});
      if(report.complete&&report.toMinute!==null)cursor=report.toMinute;
     }
     if(cursor!==loaded.minute)evidenceGaps.push({fromMinute:cursor,toMinute:loaded.minute});
     const dailyReport={schema:1,executionKind:P.executionKind,segment,worldState:ownedStore.dailySnapshotReport(),
      evidence:{scope:'Sealed segment evidence, not daily world snapshots or a complete food ledger.',
       cumulativeComplete:ownedJournal.status().unsealedSegments===0&&evidenceGaps.length===0&&segments.every(s=>s.report.complete),
       gaps:evidenceGaps,segments:segments.map(({segment,report:r})=>({segment,runId:r.runId,fromMinute:r.fromMinute,toMinute:r.toMinute,
        reportHash:hash(r),complete:r.complete,issues:r.issues,decisionWaiting:r.decisionWaiting,
        directEating:{scope:r.directEating.scope,complete:r.directEating.complete,totals:r.directEating.totals},
        foodSlices:Object.fromEntries((['foodFlows','foodLosses','foodTransfers','foodOwnershipChanges','careMeals','childCareMeals','longCareMeals','publicDutyMeals','emergencyCareMeals','journeyMeals','familyJourneyMeals'] as const)
         .map(key=>[key,{scope:r[key].scope,complete:r[key].complete,issues:r[key].issues,totals:r[key].totals}]))}))},
      foodProduction:null,foodConsumption:null,grossHealthDamage:null,realModelExecuted:false,acceptancePassed:null};
     directory.writeJson(dailyReportFile,dailyReport);
     const result={schema:1,protocol:P.protocol,segment,executionKind:P.executionKind,dailyReportFile,dailyReportHash:hash(dailyReport),journal:ownedJournal.status(),control,
      evidenceComplete:evidence.complete,cumulativeEvidenceComplete:ownedJournal.status().unsealedSegments===0&&['paused','completed'].includes(ownedJournal.status().phase),reloadVerified:true,throughMinute:loaded.minute,segmentEndpoint:endGameMinute,
      segmentComplete:loaded.minute===endGameMinute,realModelExecuted:false,actualProviderCostCny:null,remoteCancellationConfirmed:false,
      realRunReady:false,acceptancePassed:null};
     directory.writeJson(`segment-${String(segment).padStart(4,'0')}-result.json`,result);return result;
    }catch{try{ownedJournal.fail('segment_close_failed');}catch{}throw new Error('resumable_segment_close_failed');}
    finally{ownedWriter.abort();ownedStore.close();ownedJournal.close();}
   }};
 }catch(error){try{runtime?.stop();}catch{}writer?.abort();try{store?.close();}finally{journal?.close();}throw error;}
}

// Internal offline guardian. Every accepted scenario is synthetic, no live mode.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AcceptanceProcessSupervisor} from '../src/server/acceptance-process-supervisor.ts';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.ts';
import {offlineManifest,OFFLINE_SCENARIOS,OFFLINE_PROTOCOL,sourceManifest,checkedOfflineWorkerClose} from '../src/server/acceptance-offline-protocol.ts';
import {readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.ts';
const [output,scenario,...extra]=process.argv.slice(2);
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const guard=fileURLToPath(new URL('./acceptance-offline-guard.mjs',import.meta.url));
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const worker=fileURLToPath(new URL('./acceptance-offline-worker.mjs',import.meta.url));
const emit=value=>{try{process.stdout.write(JSON.stringify(value)+'\n');}catch{}};
process.stdout.on('error',()=>{});
let directory;
try{
 if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length||!OFFLINE_SCENARIOS.includes(scenario))throw new Error('offline_bootstrap_required');
 directory=AcceptanceRunDirectory.create(output);
 const manifest=offlineManifest(root,scenario);directory.writeJson('offline-manifest.json',manifest);
 const supervisor=new AcceptanceProcessSupervisor(OFFLINE_PROTOCOL.supervisor);
 const onInt=()=>supervisor.interrupt('SIGINT'),onTerm=()=>supervisor.interrupt('SIGTERM'),onEOF=()=>supervisor.interrupt('parent_disconnect');
 process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);process.stdin.once('end',onEOF);process.stdin.resume();
 const report=await supervisor.start(observe=>{
  const child=spawn(process.execPath,['--import',guard,'--import',loader,worker,scenario,manifest.sourceFingerprint],{
   cwd:'/',env:{},shell:false,detached:true,stdio:['ignore','ignore','ignore','ipc',directory.descriptor()]});
  let spawned=false,failed=false,gone=false;
  const onSpawn=()=>{spawned=true;observe({type:'spawned'});};
  const onError=()=>{if(!spawned&&!child.pid){failed=true;observe({type:'spawn_failed'});}else observe({type:'transport_error'});};
  const onExit=(code,signal)=>observe({type:'exit',code,signal});
  // Diagnostic readiness only. It never starts/resets the absolute deadline and
  // never supplies an OS exit, evidence completeness, or acceptance verdict.
  const onMessage=message=>{if(message?.type==='offline_ready')emit({type:'offline_ready',scenario});};
  child.on('spawn',onSpawn);child.on('error',onError);child.on('exit',onExit);child.on('message',onMessage);
  const signalGroup=signal=>{
   if(gone||failed)return 'not_found';if(!child.pid)return 'unknown';
   try{process.kill(-child.pid,signal);return 'sent';}catch(error){if(error.code==='ESRCH'){gone=true;return 'not_found';}return 'unknown';}
  };
  return {signalGroup,groupState(){
   if(gone||failed)return 'absent';if(!child.pid)return 'unknown';
   try{process.kill(-child.pid,0);return 'present';}catch(error){if(error.code==='ESRCH'){gone=true;return 'absent';}return 'unknown';}
  },dispose(){
   child.off('spawn',onSpawn);child.off('exit',onExit);child.off('message',onMessage);child.off('error',onError);
   child.on('error',()=>{});if(child.connected)child.disconnect();child.unref();
  }};
 });
 process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);process.stdin.off('end',onEOF);process.stdin.pause();
 directory.writeJson('process-report.json',report);
 // No database load or replay. Inspect only the evidence child in this owned
 // directory. Missing/failed/crashed capture is preserved, never resealed.
 let evidence=null,recoveryIssue=null,workerClose=null;
 if(report.cleanupComplete){try{evidence=readAcceptanceEvidence(directory.child('evidence'));}catch{recoveryIssue='evidence_unavailable';}
  try{workerClose=checkedOfflineWorkerClose(directory.readJson('offline-worker-close.json'));}catch{}
 }
 else recoveryIssue='process_cleanup_unconfirmed';
 let after=null;try{after=sourceManifest(root).sourceFingerprint;}catch{}
 const sourceUnchanged=after===manifest.sourceFingerprint;
 const reloadVerified=workerClose?.scenario===scenario&&workerClose?.reloadVerified===true
  &&workerClose.loadedWorldFingerprint===workerClose.runtimeWorldFingerprint
  &&workerClose.loadedMinute===workerClose.runtimeMinute&&workerClose.loadedRevision===workerClose.runtimeRevision;
 const result={schema:1,type:'nine-resident-offline-result',executionKind:'offline-wiring-rehearsal',scenario,
  realModelExecuted:false,readyForRealRun:false,acceptancePassed:null,endedWallTimeMs:Date.now(),
  sourceFingerprintBefore:manifest.sourceFingerprint,sourceFingerprintAfter:after,sourceUnchanged,
  process:report,recoveryIssue,evidence,workerClose,reloadVerified,
  offlineEndpointVerified:scenario==='endpoint'&&sourceUnchanged&&report.cleanupComplete&&report.outcome==='exited_zero'
   &&reloadVerified&&workerClose.loadedMinute===OFFLINE_PROTOCOL.endGameMinute
   &&evidence?.complete===true&&evidence?.acceptanceControl.controlComplete===true
   &&evidence?.toMinute===OFFLINE_PROTOCOL.endGameMinute,
  remoteCancellationConfirmed:false,realProviderCostUsd:null,foodProduction:null,foodConsumption:null};
 directory.writeJson('offline-result.json',result);
 emit({type:result.type,output,scenario,offlineEndpointVerified:result.offlineEndpointVerified,
  evidenceComplete:evidence?.complete??false,cleanupComplete:report.cleanupComplete,reason:evidence?.reason??report.trigger,
  realModelExecuted:false,readyForRealRun:false,acceptancePassed:null});
 if(scenario==='endpoint'&&!result.offlineEndpointVerified)process.exitCode=1;
}catch{
 // Never serialize filesystem paths, raw errors, prompts or credential values.
 emit({type:'offline_entry_failed',code:'offline_setup_or_persistence_failed',realModelExecuted:false,acceptancePassed:null});process.exitCode=1;
}finally{directory?.close();}

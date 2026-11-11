// Synthetic-only guardian; offline guard preloaded. The former live scenario
// is rejected before directory creation, credential-pipe reads or child spawn.
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {LEGACY_LIVE_PROBE_DISABLED,assertLegacySyntheticScenario} from './acceptance-legacy-live-policy.mjs';
const [output,observedText,scenario='live',...extra]=process.argv.slice(2),observed=Number(observedText);
// Synthetic workers still load the full runtime, hash sources and fsync evidence.
// Budget cold startup and shutdown under the full test suite, not just a warm
// focused run. This remains an absolute pre-spawn limit; readiness never resets it.
const supervisorOptions={maxWallMs:30_000,termGraceMs:1500,killWaitMs:1500};
const offlineGuard=fileURLToPath(new URL('./acceptance-offline-guard.mjs',import.meta.url));
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
const worker=fileURLToPath(new URL('./acceptance-live-worker.mjs',import.meta.url));
const emit=value=>{try{process.stdout.write(JSON.stringify(value)+'\n');}catch{}};process.stdout.on('error',()=>{});
let directory;
try{
 assertLegacySyntheticScenario(scenario);
 if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length||!Number.isSafeInteger(observed)||observed>Date.now()
  ||Date.now()-observed>12*60_000)throw new Error('live_bootstrap_required');
 const {AcceptanceProcessSupervisor}=await import('../src/server/acceptance-process-supervisor.ts');
 const {AcceptanceRunDirectory}=await import('../src/server/acceptance-run-directory.ts');
 const {sourceManifest}=await import('../src/server/acceptance-offline-protocol.ts');
 const {readAcceptanceEvidence}=await import('../src/server/acceptance-evidence-writer.ts');
 const {LIVE_PROBE_PROTOCOL:P}=await import('../src/server/acceptance-live-protocol.ts');
 const {readPrivatePipe}=await import('./acceptance-private-pipe.mjs');
 directory=AcceptanceRunDirectory.create(output);const source=sourceManifest(root),startedAtMs=Date.now();
 const manifest={schema:1,type:'nine-siliconflow-live-probe',protocol:P,...source,startedAtMs,
  scenario,executionKind:'mocked-http',supervisorOptions,officialPriceObservedAtMs:observed,officialPriceExpiresAtMs:observed+P.maxPriceAgeMs,
  dataApproval:'synthetic-fixture-no-user-data',realProviderCostUsd:null,accountAvailabilityVerified:false,
  remoteCancellationConfirmed:false,actualProcessSupervisorConnected:true,acceptancePassed:null};
 directory.writeJson('live-manifest.json',manifest);
 let key=await readPrivatePipe(3);
 const supervisor=new AcceptanceProcessSupervisor(supervisorOptions),onInt=()=>supervisor.interrupt('SIGINT'),onTerm=()=>supervisor.interrupt('SIGTERM'),onEOF=()=>supervisor.interrupt('parent_disconnect');
 process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);process.stdin.once('end',onEOF);process.stdin.resume();
 const report=await supervisor.start(observe=>{
  const child=spawn(process.execPath,['--import',offlineGuard,'--import',loader,worker,source.sourceFingerprint,String(observed),scenario],
   {cwd:'/',env:{},shell:false,detached:true,stdio:['ignore','ignore','ignore','ipc',directory.descriptor(),'pipe']});
  let spawned=false,failed=false,gone=false;
  child.stdio[5].on('error',()=>{});child.stdio[5].end(key);key='';
  const onSpawn=()=>{spawned=true;observe({type:'spawned'});};
  const onError=()=>{if(!spawned&&!child.pid){failed=true;observe({type:'spawn_failed'});}else observe({type:'transport_error'});};
  const onExit=(code,signal)=>observe({type:'exit',code,signal});
  const onMessage=message=>{if(message?.type==='live_probe_ready')emit({type:'live_probe_ready',model:P.model,sourceFingerprint:source.sourceFingerprint});};
  child.on('spawn',onSpawn);child.on('error',onError);child.on('exit',onExit);child.on('message',onMessage);
  return {signalGroup(signal){if(gone||failed)return 'not_found';if(!child.pid)return 'unknown';try{process.kill(-child.pid,signal);return 'sent';}
    catch(error){if(error.code==='ESRCH'){gone=true;return 'not_found';}return 'unknown';}},
   groupState(){if(gone||failed)return 'absent';if(!child.pid)return 'unknown';try{process.kill(-child.pid,0);return 'present';}
    catch(error){if(error.code==='ESRCH'){gone=true;return 'absent';}return 'unknown';}},
   dispose(){child.off('spawn',onSpawn);child.off('error',onError);child.off('exit',onExit);child.off('message',onMessage);child.on('error',()=>{});if(child.connected)child.disconnect();child.unref();}};
 });
 key='';process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);process.stdin.off('end',onEOF);process.stdin.pause();
 directory.writeJson('live-process-report.json',report);
 let evidence=null,close=null,recoveryIssue=null;if(report.cleanupComplete){try{evidence=readAcceptanceEvidence(directory.child('evidence'));}catch{recoveryIssue='evidence_unavailable';}
  try{close=directory.readJson('live-worker-close.json');}catch{recoveryIssue??='worker_close_unavailable';}}
 else recoveryIssue='process_cleanup_unconfirmed';
 let after=null;try{after=sourceManifest(root).sourceFingerprint;}catch{}
 const result={schema:1,type:'nine-siliconflow-live-probe-result',sourceFingerprintBefore:source.sourceFingerprint,sourceFingerprintAfter:after,
  sourceUnchanged:after===source.sourceFingerprint,process:report,evidence,workerClose:close,recoveryIssue,endedAtMs:Date.now(),
  probeMechanicsVerified:report.cleanupComplete&&report.outcome==='exited_zero'&&after===source.sourceFingerprint&&evidence?.complete===true
   &&close?.reloadVerified===true&&close?.acceptedDecisions>0&&close?.failure===null,
  networkCallAttempts:close?.transport?.networkAttempts??null,validModelResponses:close?.transport?.completedResponses??null,
  realModelExecuted:false,
  actualProviderCostUsd:null,costBasis:P.costBasis,remoteCancellationConfirmed:false,acceptancePassed:null};
 directory.writeJson('live-result.json',result);
 emit({type:result.type,output,probeMechanicsVerified:result.probeMechanicsVerified,realModelExecuted:result.realModelExecuted,
  acceptedDecisions:close?.acceptedDecisions??null,reason:close?.failure??evidence?.reason??report.trigger,actualProviderCostUsd:null,acceptancePassed:null});
 if(!result.probeMechanicsVerified)process.exitCode=1;
}catch(error){emit({type:'live_probe_setup_failed',...(error?.message===LEGACY_LIVE_PROBE_DISABLED?{reason:LEGACY_LIVE_PROBE_DISABLED}:{}),actualProviderCostUsd:null,acceptancePassed:null});process.exitCode=1;}
finally{directory?.close();}

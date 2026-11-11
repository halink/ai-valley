// No provider calls. External monotonic deadline also bounds worker startup,
// synchronous blocking, SQLite and cleanup; budget is never reset on readiness.
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {ResumableJournal} from '../src/server/acceptance-resumable-journal.ts';
import {randomUUID} from 'node:crypto';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.ts';
import {AcceptanceProcessSupervisor} from '../src/server/acceptance-process-supervisor.ts';
import {sourceManifest} from '../src/server/acceptance-offline-protocol.ts';
import {resumableManifest} from '../src/server/acceptance-resumable-runner.ts';
import {RESUMABLE_PROTOCOL as P} from '../src/server/acceptance-resumable-protocol.ts';
const [output,mode,scenario='normal',...extra]=process.argv.slice(2),root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const emit=value=>{try{process.stdout.write(JSON.stringify(value)+'\n');}catch{}};process.stdout.on('error',()=>{});let directory,launcherLock;
try{
 if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length||!['new','resume'].includes(mode)
  ||!['normal','stall','fail','crash_intent','crash_response','crash_committed','crash_commit_gap','sync_block'].includes(scenario))throw new Error();
 process.umask(0o077);
 const source=sourceManifest(root);directory=mode==='new'?AcceptanceRunDirectory.create(output):AcceptanceRunDirectory.openOfflineResume(output);
 if(mode==='new')directory.writeJson('resumable-manifest.json',resumableManifest(source.sourceFingerprint));
 // A separate guardian lock serializes pre-spawn reservations, including
 // crashes/import stalls before the worker can open its journal.
 launcherLock=new DatabaseSync(directory.database('launcher.sqlite',mode==='new'));launcherLock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
 const allocation=new ResumableJournal(directory,{create:mode==='new',sourceFingerprint:source.sourceFingerprint,worldId:resumableManifest(source.sourceFingerprint).worldId});
 let reserved;try{reserved=allocation.beginSegment();}finally{allocation.close();}
 const supervisor=new AcceptanceProcessSupervisor(P.supervisor),onInt=()=>supervisor.interrupt('SIGINT'),onTerm=()=>supervisor.interrupt('SIGTERM'),onEOF=()=>supervisor.interrupt('parent_disconnect');
 process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);process.stdin.once('end',onEOF);process.stdin.resume();
 let lastMessage=null,watchdog,watchdogResult=null,watchdogDone=Promise.resolve(false);
 const watchdogRecord=`watchdog-${randomUUID()}.json`;
 const report=await supervisor.start(observe=>{
  const child=spawn(process.execPath,['--import',root+'/scripts/acceptance-offline-guard.mjs',root+'/scripts/acceptance-resumable-worker.mjs',source.sourceFingerprint,mode,String(reserved),scenario],
   {cwd:'/',env:{},shell:false,detached:true,stdio:['ignore','ignore','ignore','ipc',directory.descriptor(),'pipe']});
  let spawned=false,failed=false,gone=false;
  child.stdio[5].on('error',()=>{});
  const onSpawn=()=>{
   spawned=true;observe({type:'spawned'});
   try{const raw=readFileSync(`/proc/${child.pid}/stat`,'utf8'),start=raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
    watchdog=spawn(process.execPath,['--import',root+'/scripts/acceptance-offline-guard.mjs',root+'/scripts/acceptance-resumable-watchdog.mjs',String(child.pid),start,watchdogRecord],
     {cwd:'/',env:{},shell:false,detached:true,stdio:['pipe','ignore','ignore','ipc',directory.descriptor()]});
    watchdog.stdin.on('error',()=>{});watchdog.on('message',message=>{if(message?.type==='resumable_watchdog_ready')child.stdio[5].end('RESUMABLE_OFFLINE_WATCHDOG_READY');
     else if(message?.type==='resumable_watchdog_result')watchdogResult=message;});
    watchdogDone=new Promise(resolve=>{watchdog.once('error',()=>{child.stdio[5].destroy();observe({type:'transport_error'});resolve(false);});
     watchdog.once('exit',code=>{child.stdio[5].destroy();if(!watchdogResult?.cleanupComplete)observe({type:'transport_error'});resolve(code===0);});});
   }catch{child.stdio[5].destroy();observe({type:'transport_error'});}
  },onError=()=>{if(!spawned&&!child.pid){failed=true;observe({type:'spawn_failed'});}else observe({type:'transport_error'});},
   onExit=(code,signal)=>observe({type:'exit',code,signal}),onMessage=message=>{if(['resumable_segment_ready','resumable_segment_result','resumable_worker_blocked'].includes(message?.type)){lastMessage=message;emit(message);}};
  child.on('spawn',onSpawn);child.on('error',onError);child.on('exit',onExit);child.on('message',onMessage);
  return {signalGroup(signal){if(gone||failed)return 'not_found';if(!child.pid)return 'unknown';try{process.kill(-child.pid,signal);return 'sent';}catch(error){if(error.code==='ESRCH'){gone=true;return 'not_found';}return 'unknown';}},
   groupState(){if(gone||failed)return 'absent';if(!child.pid)return 'unknown';try{process.kill(-child.pid,0);return 'present';}catch(error){if(error.code==='ESRCH'){gone=true;return 'absent';}return 'unknown';}},
   dispose(){child.off('spawn',onSpawn);child.off('error',onError);child.off('exit',onExit);child.off('message',onMessage);child.on('error',()=>{});if(child.connected)child.disconnect();child.unref();}};
 });
 process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);process.stdin.off('end',onEOF);process.stdin.pause();
 watchdog?.stdin.end();
 let watchdogWait;const watchdogExited=await Promise.race([watchdogDone,new Promise(resolve=>{watchdogWait=setTimeout(()=>resolve(false),4000);})]);clearTimeout(watchdogWait);
 if(!watchdogExited&&watchdog?.pid){try{watchdog.kill('SIGKILL');}catch{}}
 const result={schema:1,protocol:P.protocol,mode,scenario,process:report,watchdog:watchdogResult,watchdogExited,lastMessage,sourceFingerprint:source.sourceFingerprint,
  realModelExecuted:false,actualProviderCostCny:null,remoteCancellationConfirmed:false,acceptancePassed:null};
 directory.writeJson(`process-${randomUUID()}.json`,result);emit({type:'resumable_process_result',cleanupComplete:report.cleanupComplete,outcome:report.outcome,
  realModelExecuted:false,acceptancePassed:null});if(!report.cleanupComplete||report.outcome!=='exited_zero'||!watchdogExited||!watchdogResult?.cleanupComplete)process.exitCode=1;
}catch{emit({type:'resumable_offline_blocked',realModelExecuted:false,acceptancePassed:null});process.exitCode=1;}
finally{try{launcherLock?.close();}finally{directory?.close();}}

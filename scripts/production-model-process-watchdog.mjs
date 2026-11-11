// Independent owner of a single fixed synthetic worker group. Its own death,
// hostile descendants and uninterruptible kernel I/O are not contained here.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AcceptanceProcessSupervisor} from '../src/server/acceptance-process-supervisor.ts';
import {SyntheticProcessDirectory} from '../src/server/production-model-process-storage.ts';
import {bootIdentity} from '../src/server/production-model-process-state.ts';
const [idText,scenario,...extra]=process.argv.slice(2),id=Number(idText),root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||extra.length||!process.connected||!Number.isSafeInteger(id)||id<1)throw Error('synthetic_watchdog_bootstrap_required');
const send=value=>{if(process.connected)try{process.send?.(value,()=>{});}catch{}};
let ownerGone=false,supervisor;
const eof=()=>{ownerGone=true;supervisor?.interrupt('parent_disconnect');};
process.stdin.once('end',eof);process.stdin.once('error',eof);process.stdin.resume();
process.on('disconnect',eof);
const onInt=()=>supervisor?.interrupt('SIGINT'),onTerm=()=>supervisor?.interrupt('SIGTERM');process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
const directory=SyntheticProcessDirectory.inherit(4);let child,identity=null,report;
try{
 const receipt=directory.readJson(`launch-${id}.json`);
 await new Promise(resolve=>setImmediate(resolve));
 const mono=process.hrtime.bigint(),remaining=Math.min(receipt.deadlineAtMs-Date.now(),Number((BigInt(receipt.deadlineMonotonicNs)-mono)/1_000_000n));
 if(ownerGone||receipt.id!==id||receipt.bootId!==bootIdentity()||mono<BigInt(receipt.startedMonotonicNs)||Date.now()<receipt.startedAtMs||!Number.isSafeInteger(remaining)||remaining<1||remaining>30000)throw Error('synthetic_launch_expired');
 supervisor=new AcceptanceProcessSupervisor({maxWallMs:remaining,termGraceMs:1500,killWaitMs:1500});
 report=await supervisor.start(observe=>{
  child=spawn(process.execPath,['--import',root+'/scripts/acceptance-offline-guard.mjs',root+'/scripts/production-model-process-worker.mjs',idText,scenario],
   {cwd:'/',env:{},shell:false,detached:true,stdio:['ignore','ignore','ignore','ipc',directory.descriptor(),'pipe']});
  let spawned=false,gone=false;child.stdio[5].on('error',()=>{});
  const group=()=>{if(gone)return 'absent';if(!child.pid)return 'unknown';try{process.kill(-child.pid,0);return 'present';}catch(e){if(e.code==='ESRCH'){gone=true;return 'absent';}return 'unknown';}};
  const onSpawn=()=>{spawned=true;observe({type:'spawned'});
   try{const raw=readFileSync(`/proc/${child.pid}/stat`,'utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');identity={pid:child.pid,startTicks:fields[19]};
    send({type:'synthetic_worker_identity',...identity,id});
    if(ownerGone||Date.now()>=receipt.deadlineAtMs||process.hrtime.bigint()>=BigInt(receipt.deadlineMonotonicNs)){child.stdio[5].destroy();supervisor.interrupt('parent_disconnect');}
    else child.stdio[5].end('SYNTHETIC_PRICE_WATCHDOG_READY');
   }catch{child.stdio[5].destroy();observe({type:'transport_error'});}};
  const onError=()=>observe({type:!spawned&&!child.pid?'spawn_failed':'transport_error'}),onExit=(code,signal)=>observe({type:'exit',code,signal});
  const onMessage=message=>{if(['synthetic_worker_ready','synthetic_fault_ready','synthetic_worker_finished'].includes(message?.type))send(message);};
  child.on('spawn',onSpawn);child.on('error',onError);child.on('exit',onExit);child.on('message',onMessage);
  return {groupState:group,signalGroup(signal){if(group()==='absent')return 'not_found';if(!identity)return 'unknown';
    try{const raw=readFileSync(`/proc/${identity.pid}/stat`,'utf8'),start=raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];if(start!==identity.startTicks)return 'unknown';
     process.kill(-identity.pid,signal);return 'sent';}catch(e){return e.code==='ESRCH'?'not_found':'unknown';}},
   dispose(){child.off('spawn',onSpawn);child.off('error',onError);child.off('exit',onExit);child.off('message',onMessage);child.on('error',()=>{});if(child.connected)child.disconnect();child.unref();}};
 });
 const result={schema:1,kind:'synthetic-price-process-observation',id,identity,process:report,realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,acceptancePassed:null};
 directory.writeJson(`watchdog-${id}.json`,result);send({type:'synthetic_watchdog_result',...result});
 if(!report.cleanupComplete||report.outcome!=='exited_zero'||report.trigger!=='child_exit')process.exitCode=1;
}catch{send({type:'synthetic_watchdog_failed',id});process.exitCode=1;}
finally{directory.close();process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);process.off('disconnect',eof);process.stdin.pause();process.stdin.destroy();if(process.connected)process.disconnect();}

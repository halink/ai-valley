// Trusted internal worker. All test faults remain under the offline guard.
import {fileURLToPath} from 'node:url';
const safeSend=value=>{if(process.connected)try{process.send?.(value,()=>{});}catch{}};
const [fingerprint,mode,reservedText,scenario='normal',...extra]=process.argv.slice(2);
const scenarios=['normal','stall','fail','crash_intent','crash_response','crash_committed','crash_commit_gap','sync_block'];
if(!globalThis.__valleyOfflineGuard||Object.keys(process.env).length||!process.send||extra.length
 ||!['new','resume'].includes(mode)||!scenarios.includes(scenario)||!/^[0-9a-f]{64}$/.test(fingerprint??''))throw new Error('resumable_bootstrap_required');
process.umask(0o077);
let parentGone=!process.connected;process.once('disconnect',()=>{parentGone=true;});
// No runtime imports or blocking test fault can run before an independent
// watchdog has verified this worker's Linux process identity.
const {readPrivatePipe}=await import('./acceptance-private-pipe.mjs');
if(await readPrivatePipe(5)!=='RESUMABLE_OFFLINE_WATCHDOG_READY'||parentGone||!process.connected)throw new Error('watchdog_gate_required');
const {register}=await import('../node_modules/tsx/dist/esm/api/index.mjs');register();
const {AcceptanceRunDirectory}=await import('../src/server/acceptance-run-directory.ts');
const {sourceManifest}=await import('../src/server/acceptance-offline-protocol.ts');
const {createResumableOfflineSegment}=await import('../src/server/acceptance-resumable-runner.ts');
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),directory=AcceptanceRunDirectory.inherit(4);
let run,finished=false,poll;
const finish=()=>{
 if(finished)return;finished=true;if(poll)clearInterval(poll);
 try{if(!run)throw new Error();const result=run.close();safeSend({type:'resumable_segment_result',segment:result.segment,
  phase:result.journal.phase,attempts:result.journal.attempts,throughMinute:result.throughMinute,realModelExecuted:false,acceptancePassed:null});
  if(result.journal.phase==='blocked')process.exitCode=1;
 }catch{process.exitCode=1;}
 finally{directory.close();process.off('SIGINT',finish);process.off('SIGTERM',finish);process.off('disconnect',finish);if(process.connected)process.disconnect?.();}
};
try{
 if(parentGone||!process.connected||sourceManifest(root).sourceFingerprint!==fingerprint)throw new Error();
 run=createResumableOfflineSegment({directory,create:mode==='new',sourceFingerprint:fingerprint,sourceFingerprintAfter:()=>sourceManifest(root).sourceFingerprint,preallocatedSegment:Number(reservedText),
  scenario:['stall','fail'].includes(scenario)?scenario:'normal',fault:point=>{if(scenario===`crash_${point}`)process.exit(73);}});
 if(parentGone||!process.connected){finish();throw new Error('parent_disconnected');}
 process.on('SIGINT',finish);process.on('SIGTERM',finish);process.on('disconnect',finish);
 safeSend({type:'resumable_segment_ready',segment:run.segment,realModelExecuted:false});
 if(scenario==='sync_block')for(;;){}
 run.start();
 poll=setInterval(()=>{if(run.runtime.acceptanceStopStatus()?.phase==='stopped')finish();},50);
 if(scenario==='normal'){
  let wall=Date.now();
  for(let i=0;i<2000&&!finished&&run.runtime.acceptanceStopStatus()?.phase==='running';i++){
   await new Promise(resolve=>setImmediate(resolve));wall+=1000;run.runtime.tick(wall);
  }
  if(!finished)finish();
 }
}catch{safeSend({type:'resumable_worker_blocked',realModelExecuted:false,acceptancePassed:null});process.exitCode=1;finish();}

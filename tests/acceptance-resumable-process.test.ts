/** Real child-process crash probes, strictly synthetic with offline guard. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
import {createResumableOfflineSegment,resumableManifest} from '../src/server/acceptance-resumable-runner.js';
import {ResumableJournal} from '../src/server/acceptance-resumable-journal.js';
const source='c'.repeat(64),root=process.cwd();
for(const point of ['intent','response','commit_gap','committed'] as const)test(`real process exit after ${point} never replays an uncertain decision`,async()=>{
 const base=mkdtempSync(join(testTmpdir(),'resumable-crash-')),path=join(base,'run'),d=AcceptanceRunDirectory.create(path);
 d.writeJson('resumable-manifest.json',resumableManifest(source));d.close();
 try{
  const code=`import {AcceptanceRunDirectory} from './src/server/acceptance-run-directory.ts';
   import {createResumableOfflineSegment} from './src/server/acceptance-resumable-runner.ts';
   const d=AcceptanceRunDirectory.openOfflineResume(${JSON.stringify(path)});
   const run=createResumableOfflineSegment({directory:d,create:true,sourceFingerprint:${JSON.stringify(source)},sourceFingerprintAfter:()=>${JSON.stringify(source)},fault:p=>{if(p===${JSON.stringify(point)})process.exit(73);}});run.start();`;
  const child=spawnSync(process.execPath,['--import',join(root,'scripts/acceptance-offline-guard.mjs'),'--import',join(root,'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',code],{cwd:root,env:{},encoding:'utf8',timeout:30_000});
  assert.equal(child.status,73,child.stderr);
  const directory=AcceptanceRunDirectory.openOfflineResume(path),j=new ResumableJournal(directory,{create:false,sourceFingerprint:source});
  assert.equal(j.status().attempts,1);assert.equal(j.status().successes,point==='committed'?1:0);j.close();
  const options={directory,create:false,sourceFingerprint:source,sourceFingerprintAfter:()=>source};
  if(point!=='committed')assert.throws(()=>createResumableOfflineSegment(options),/unresolved_request_no_retry/);
  else{
   const run=createResumableOfflineSegment(options);run.start();await new Promise(resolve=>setImmediate(resolve));const result=run.close();
   assert.equal(result.journal.phase,'paused');assert.equal(result.journal.attempts,9);assert.equal(result.journal.successes,9);
   assert.equal(result.journal.unsealedSegments,1);assert.equal(result.cumulativeEvidenceComplete,false);assert.equal(result.journal.pending,null);
  }
  directory.close();
  assert.equal(readFileSync(join(path,'resumable.sqlite')).includes(Buffer.from('OFFLINE-ONLY-NOT-A-CREDENTIAL')),false);
 }finally{rmSync(base,{recursive:true,force:true});}
});

import {spawn} from 'node:child_process';
test('independent watchdog stops a synchronously blocked worker after guardian pipe loss',async()=>{
 const base=mkdtempSync(join(testTmpdir(),'resumable-watchdog-')),d=AcceptanceRunDirectory.create(join(base,'run')),
  record='watchdog-00000000-0000-4000-8000-000000000000.json';
 const worker=spawn(process.execPath,['--import',join(root,'scripts/acceptance-offline-guard.mjs'),'--input-type=module','-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');for(;;){}"],{env:{},cwd:root,detached:true,stdio:['ignore','pipe','ignore']});
 let watchdog:ReturnType<typeof spawn>|undefined;
 try{
  const workerDone=new Promise(resolve=>worker.once('exit',resolve));
  await new Promise<void>((resolve,reject)=>{worker.stdout!.once('data',()=>resolve());worker.once('error',reject);});
  const stat=readFileSync(`/proc/${worker.pid}/stat`,'utf8'),ticks=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
  watchdog=spawn(process.execPath,['--import',join(root,'scripts/acceptance-offline-guard.mjs'),join(root,'scripts/acceptance-resumable-watchdog.mjs'),String(worker.pid),ticks,record],
   {env:{},cwd:root,detached:true,stdio:['pipe','ignore','ignore','ipc',d.descriptor()]});
  let reported:any=null;watchdog.on('message',message=>{if((message as any)?.type==='resumable_watchdog_result')reported=message;});
  const watchdogDone=new Promise(resolve=>watchdog!.once('exit',resolve));
  await new Promise<void>((resolve,reject)=>{watchdog!.once('message',()=>resolve());watchdog!.once('error',reject);});
  watchdog.stdin!.end();let timeout:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([Promise.all([workerDone,watchdogDone]),new Promise((_r,reject)=>{timeout=setTimeout(()=>reject(new Error('watchdog_unbounded')),8000);})]);clearTimeout(timeout);
  assert.equal(reported?.type,'resumable_watchdog_result');assert.equal(reported?.cleanupComplete,true);
  const result=d.readJson(record) as any;assert.equal(result.reason,'guardian_disconnect');assert.equal(result.signals.term,'sent');assert.equal(result.signals.kill,'sent');
  assert.equal(result.cleanupComplete,true);assert.equal(result.groupState,'absent');assert.equal(result.realModelExecuted,false);assert.equal(result.acceptancePassed,null);
 }finally{if(worker.exitCode===null&&worker.signalCode===null)try{process.kill(-worker.pid!,'SIGKILL');}catch{}
  if(watchdog&&watchdog.exitCode===null&&watchdog.signalCode===null)watchdog.kill('SIGKILL');d.close();rmSync(base,{recursive:true,force:true});}
});

test('public offline launcher rejects real execution and outside-repository outputs before starting',()=>{
 const code=`import {resumableOfflineLaunch} from './scripts/run-nine-resumable-offline.mjs';
  const base=${JSON.stringify(root+'/output/never-created-launch-contract')};let rejected=0;
  for(const args of [[],['--live','--output',base],['--offline','--output','/tmp/outside-repository'],['--offline','--output',base,'--model','paid'],['--offline','--resume','relative']]){try{resumableOfflineLaunch(args);}catch{rejected++;}}
  const launch=resumableOfflineLaunch(['--offline','--output',base]);console.log(JSON.stringify({rejected,args:launch.args,options:launch.options}));`;
 const child=spawnSync(process.execPath,['--import',join(root,'scripts/acceptance-offline-guard.mjs'),'--input-type=module','-e',code],{env:{},cwd:root,encoding:'utf8',timeout:10_000});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.rejected,5);assert.deepEqual(result.options.env,{});
 assert.equal(result.options.shell,false);assert.equal(result.args.some((s:string)=>s.includes('.env')||s.includes('key')),false);
});

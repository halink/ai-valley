import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,openSync,closeSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {acquireProductionModelAccountOwnership as acquire} from '../src/server/production-model-account-ownership.js';
// @ts-ignore fixed JavaScript executable boundary
import {launchSyntheticAccountProcess} from '../scripts/production-model-account-launch.mjs';
function fixture(t:TestContext){
 const dir=mkdtempSync(join(testTmpdir(),'account-process-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'journal.sqlite'),reportPath=join(dir,'report.json');
 const store=new WorldStore(worldPath),world=createFrontierWorld(701);world.clock.paused=true;
 for(const actor of world.residents.slice(1))actor.decisionDue=world.minute+1000;
 store.commit(world,null);
 const now=Date.now(),contract=productionCandidateContract({runId:'synthetic-process',worldId:world.id,maxRequests:2,createdAtMs:now-1,deadlineAtMs:now+60000,requestTimeoutMs:5000});
 const db=new DatabaseSync(journalPath);new ProductionModelJournal(db,contract,{create:true,worldFingerprint:hash(store.loadForRuntime())});db.close();store.close();chmodSync(worldPath,0o600);chmodSync(journalPath,0o600);
 const options={account:{registryDirectory:join(dir,'registry'),accountScope:'synthetic-account',runId:contract.runId},worldPath,journalPath,contract,process:{maxWallMs:12000,termGraceMs:1500,killWaitMs:1500}};
 return {options,reportPath};
}
async function run(t:TestContext,scenario:string,disconnect=false,killWorker=false){
 const f=fixture(t),fd=openSync(f.reportPath,'wx',0o600);let worker:number|undefined;
 const child=launchSyntheticAccountProcess(f.options,{scenario,reportDescriptor:fd,onMessage:(m:any)=>{if(m.type==='worker')worker=m.identity.pid;if(m.type==='stage'&&m.point==='blocked'){if(disconnect)child.disconnect();if(killWorker)process.kill(worker!,'SIGKILL');}}});closeSync(fd);
 const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 const result=JSON.parse(readFileSync(f.reportPath,'utf8'));
 return {...f,result,code,worker};
}
test('fixed worker runs synthetic runtime, commits world and releases account only after group exit',{timeout:30000},async t=>{
 const f=await run(t,'normal');assert.equal(f.code,0,JSON.stringify(f.result));assert.equal(f.result.report.account,'clean');assert.equal(f.result.report.process.cleanupComplete,true);assert.equal(f.result.realModelExecuted,false);
 const next=acquire({...f.options.account,runId:'second'});next.closeClean();
 const store=new WorldStore(f.options.worldPath),db=new DatabaseSync(f.options.journalPath);
 try{const journal=new ProductionModelJournal(db,f.options.contract,{create:false,worldFingerprint:hash(store.loadForRuntime())});assert.equal(journal.status().completed,1);assert.equal(journal.status().pending,null);assert.equal(store.loadForRuntime()!.metrics.successes,1);}finally{store.close();db.close();}
});
for(const scenario of ['crash_intent','crash_response','block'])test(`fixed ${scenario} leaves account unresolved and forbids blind retry`,{timeout:30000},async t=>{
 const f=await run(t,scenario,scenario==='block');assert.equal(f.result.report.account,'unresolved',JSON.stringify(f.result));assert.throws(()=>acquire({...f.options.account,runId:'retry'}),/unresolved/);
 if(scenario!=='block'){const db=new DatabaseSync(f.options.journalPath);try{const events=db.prepare('SELECT body FROM production_model_audit').all().map((r:any)=>JSON.parse(r.body));assert.ok(events.some(e=>e.type==='intent'));assert.equal(events.some(e=>e.type==='world_committed'),false);if(scenario==='crash_response')assert.ok(events.some(e=>e.type==='response'));}finally{db.close();}}
 if(scenario==='block'){assert.equal(f.result.report.process.trigger,'parent_disconnect');assert.equal(f.result.report.process.signals.term,'sent');assert.equal(f.result.report.process.cleanupComplete,true);}
});

test('actual caller SIGKILL leaves independent watchdog alive to recover group and preserve unknown',{timeout:30000},async t=>{
 const {spawn}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const f=fixture(t),fd=openSync(f.reportPath,'wx',0o600);
 const owner=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/model-account-process-owner.mjs',import.meta.url))],{env:{},detached:true,stdio:['ignore','ignore','ignore','ipc',fd]});closeSync(fd);
 owner.once('spawn',()=>owner.send(f.options));
 await new Promise<void>((resolve,reject)=>{owner.once('error',reject);owner.on('message',(m:any)=>{if(m.type==='stage'&&m.point==='blocked'){owner.kill('SIGKILL');resolve();}});});
 await new Promise<void>(resolve=>owner.once('exit',()=>resolve()));
 let result:any;
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){try{result=JSON.parse(readFileSync(f.reportPath,'utf8'));break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.ok(result,'independent watchdog persisted no report');assert.equal(result.report.process.trigger,'parent_disconnect');assert.equal(result.report.process.cleanupComplete,true);assert.equal(result.report.account,'unresolved');
 assert.throws(()=>acquire({...f.options.account,runId:'after-parent-death'}),/unresolved/);
});

test('actual worker SIGKILL is not treated as successful completion or retried',{timeout:30000},async t=>{
 const f=await run(t,'block',false,true);assert.equal(f.result.report.account,'unresolved');assert.equal(f.result.report.process.exit.signal,'SIGKILL');assert.equal(f.result.report.durableCompletionVerified,false);assert.throws(()=>acquire({...f.options.account,runId:'after-worker-crash'}),/unresolved/);
});

test('early caller disconnect never releases worker bootstrap gate', {timeout:30000},async t=>{
 const f=fixture(t),fd=openSync(f.reportPath,'wx',0o600);let workers=0;
 const child=launchSyntheticAccountProcess(f.options,{reportDescriptor:fd,onMessage:(m:any)=>{if(m.type==='worker')workers++;}});closeSync(fd);child.disconnect();
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
 const result=JSON.parse(readFileSync(f.reportPath,'utf8'));assert.equal(workers,0);assert.equal(result.report,null);assert.equal(result.error,'synthetic_account_input_invalid');
 const next=acquire({...f.options.account,runId:'not-launched'});next.closeClean();
});

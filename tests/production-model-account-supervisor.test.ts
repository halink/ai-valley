import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {ProductionModelAccountSupervisor} from '../src/server/production-model-account-supervisor.js';
import {acquireProductionModelAccountOwnership as acquire} from '../src/server/production-model-account-ownership.js';
import type {SupervisedProcessEvent,SupervisedProcess} from '../src/server/acceptance-process-supervisor.js';
const worker=fileURLToPath(new URL('./fixtures/model-account-supervisor-worker.mjs',import.meta.url));
function launch(scenario:'clean'|'fail'|'block',observe:(e:SupervisedProcessEvent)=>void):SupervisedProcess{
 const child=spawn(process.execPath,[worker,scenario],{env:{},cwd:'/',detached:true,stdio:'ignore'});let gone=false;
 child.on('spawn',()=>observe({type:'spawned'}));child.on('error',()=>observe({type:'transport_error'}));
 child.on('exit',(code,signal)=>observe({type:'exit',code,signal}));
 return {groupState(){if(gone)return 'absent';try{process.kill(-child.pid!,0);return 'present';}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH'){gone=true;return 'absent';}return 'unknown';}},
 signalGroup(signal){try{process.kill(-child.pid!,signal);return 'sent';}catch{return 'unknown';}},dispose(){child.unref();}};
}
function fixture(t:TestContext,pending=false){
 const dir=mkdtempSync(join(testTmpdir(),'model-supervisor-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'journal.sqlite');
 const store=new WorldStore(worldPath),world=createFrontierWorld(701);world.clock.paused=true;store.commit(world,null);
 const now=Date.now(),contract=productionCandidateContract({runId:'fixture-one',worldId:world.id,maxRequests:2,createdAtMs:now-1,deadlineAtMs:now+60000,requestTimeoutMs:500});
 const db=new DatabaseSync(journalPath),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:hash(store.loadForRuntime())});
 if(pending)journal.intent('a'.repeat(64),now);db.close();store.close();chmodSync(worldPath,0o600);chmodSync(journalPath,0o600);
 const options={account:{registryDirectory:join(dir,'registry'),accountScope:'fixture-account',runId:contract.runId},worldPath,journalPath,contract,process:{maxWallMs:3000,termGraceMs:100,killWaitMs:500}};
 return {options,dir};
}
test('actual OS exit and matching durable closed artifacts release account',async t=>{
 const {options}=fixture(t),s=new ProductionModelAccountSupervisor(options),r=await s.start(o=>launch('clean',o));
 assert.equal(r.account,'clean');assert.equal(r.durableCompletionVerified,true);assert.equal(r.readyForProduction,false);
 const next=acquire({...options.account,runId:'fixture-two'});next.closeClean();
 await assert.rejects(s.start(o=>launch('clean',o)),/single_use/);
});
test('zero child exit cannot clear pending journal; restart remains blocked',async t=>{
 const {options}=fixture(t,true);let launched=false;
 await assert.rejects(new ProductionModelAccountSupervisor(options).start(o=>{launched=true;return launch('clean',o);}));
 assert.equal(launched,false);
 assert.throws(()=>acquire({...options.account,runId:'retry'}),/unresolved/);
});
for(const scenario of ['fail','block'] as const)test(`${scenario} child preserves account unknown`,async t=>{
 const {options}=fixture(t);if(scenario==='block')options.process.maxWallMs=1000;
 const r=await new ProductionModelAccountSupervisor(options).start(o=>launch(scenario,o));
 assert.equal(r.account,'unresolved');assert.equal(r.reason,'process_not_clean');assert.throws(()=>acquire({...options.account,runId:'retry'}),/unresolved/);
});
test('account is reserved before launch and cannot be reused by another world',async t=>{
 const {options}=fixture(t);let checked=false;
 const r=await new ProductionModelAccountSupervisor(options).start(o=>{
  assert.throws(()=>acquire({...options.account,runId:'other-world'}),/runtime_already_owned/);checked=true;return launch('clean',o);
 });assert.equal(checked,true);assert.equal(r.account,'clean');
});
test('replacement or missing original artifact cannot release account',async t=>{
 const {options}=fixture(t);
 const r=await new ProductionModelAccountSupervisor(options).start(o=>{renameSync(options.journalPath,options.journalPath+'.old');return launch('clean',o);});
 assert.equal(r.account,'unresolved');assert.equal(r.reason,'durable_completion_failed');
});

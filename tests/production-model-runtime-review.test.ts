import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {persistedWorldFingerprint as fingerprint} from '../src/server/acceptance-offline-protocol.js';
import {ProductionModelJournal,productionCandidateContract,productionGatedCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp} from '../src/server/production-model-http.js';
import {createProductionModelOfflineRuntime} from '../src/server/production-model-runtime.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(t:TestContext){
 const dir=mkdtempSync(join(testTmpdir(),'production-runtime-review-'));
 const store=new WorldStore(join(dir,'world.sqlite')),db=new DatabaseSync(join(dir,'journal.sqlite'));
 const world=createFrontierWorld();store.commit(world,null);
 const contract=productionCandidateContract({runId:'independent-review',worldId:world.id,maxRequests:5,createdAtMs:Date.now(),deadlineAtMs:Date.now()+60_000,requestTimeoutMs:10_000});
 const journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:fingerprint(store.loadForRuntime())});
 const memory=createMemoryProductionHttp();let run:ReturnType<typeof createProductionModelOfflineRuntime>|undefined;
 t.after(()=>{run?.close();store.close();db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,db,journal,memory,contract,open:()=>run=createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:world.minute+30})};
}
function reply(f:ReturnType<typeof fixture>,content:string){f.memory.headers(0);f.memory.chunk(0,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));f.memory.end(0);}
function waitReply(run:ReturnType<ReturnType<typeof fixture>['open']>){
 const world=run.runtime.snapshot().world,actor=world.residents.find(r=>world.metrics.inFlight.includes(r.id))!;
 const choices=prepareModelDecision(decisionContext(world,actor),undefined,P.model).choices;
 const index=choices.findIndex(c=>c.action.type==='wait');assert.ok(index>=0);
 return JSON.stringify({choice:String(index+1),minutes:15});
}
test('review: forged synthetic label is rejected before runtime mutation',t=>{
 const f=fixture(t),before=fingerprint(f.store.loadForRuntime());
 assert.throws(()=>createProductionModelOfflineRuntime({store:f.store,journal:f.journal,transport:{kind:'synthetic-production-http'},endGameMinute:510}),/production_transport_invalid/);
 assert.equal(fingerprint(f.store.loadForRuntime()),before);assert.equal(f.journal.status().attempts,0);
});
test('review: checkpoint preserves exact pending response for synthetic and gated lifecycle',t=>{
 const f=fixture(t),at=Date.now(),id=f.journal.intent('a'.repeat(64),at);f.journal.response(id,'b'.repeat(64),at);
 const before=f.journal.status().pending;f.journal.checkpointWorld('c'.repeat(64),at);
 assert.deepEqual(f.journal.status().pending,before);assert.equal(f.journal.status().completed,0);
 const dir=mkdtempSync(join(testTmpdir(),'production-runtime-review-gated-')),db=new DatabaseSync(join(dir,'journal.sqlite'));
 try{const journal=new ProductionModelJournal(db,productionGatedCandidateContract({...f.contract,admissionHash:'d'.repeat(64)}),{create:true,worldFingerprint:'a'.repeat(64)});
 const id=journal.intent('b'.repeat(64),at);journal.response(id,'c'.repeat(64),at);
 const pending=journal.status().pending;journal.checkpointWorld('e'.repeat(64),at);
 assert.deepEqual(journal.status().pending,pending);assert.equal(journal.status().completed,0);
 journal.beginRuntimeStop('manual_stop',at);
 assert.throws(()=>journal.finishRuntimeStop('e'.repeat(64),false,at),/production_journal_invalid/);
 assert.deepEqual(journal.status().pending,pending);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('review: close aborts pending request and late headers cannot acknowledge it',async t=>{
 const f=fixture(t),run=f.open();run.runtime.start();assert.equal(f.memory.requests().length,1);
 run.close();const before=fingerprint(f.store.loadForRuntime());reply(f,'{"choice":"1","minutes":15}');await flush();
 assert.equal(f.memory.requests()[0].signal.aborted,true);assert.equal(f.memory.bodyCancelled(0),true);
 assert.equal(fingerprint(f.store.loadForRuntime()),before);assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'intent');
});
test('review: actor revision changing during response leaves response pending and stops',async t=>{
 const f=fixture(t),run=f.open();run.runtime.start();const content=waitReply(run);
 // Synthetic race injection into the running world, not an edit to any real save.
 const internals=run.runtime as unknown as {world:ReturnType<WorldStore['load']>};
 const world=internals.world!;world.residents.find(r=>world.metrics.inFlight.includes(r.id))!.revision++;
 reply(f,content);await flush();
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'response');
 assert.equal(run.status().failure,'decision_rejected');assert.equal(run.status().control?.phase,'stopped');assert.equal(f.memory.requests().length,1);
});
test('review: invalid decision does not clear durable response or retry',async t=>{
 const f=fixture(t),run=f.open();run.runtime.start();reply(f,'NOT A DECISION');await flush();
 assert.equal(f.journal.status().pending?.phase,'response');assert.equal(f.journal.status().completed,0);
 assert.equal(run.status().failure,'model_decision_failed');assert.equal(run.status().control?.phase,'stopped');assert.equal(f.memory.requests().length,1);
});
test('review: duplicate store ownership is rejected and clean close is idempotent',t=>{
 const f=fixture(t),run=f.open();assert.throws(()=>createProductionModelOfflineRuntime({store:f.store,journal:f.journal,transport:createMemoryProductionHttp().transport,endGameMinute:510}),/production_runtime_store_owned/);
 const first=run.close(),records=first.journal.auditRecords;assert.equal(run.close().journal.auditRecords,records);
 assert.equal(first.failure,null);assert.equal(first.journal.worldFingerprint,fingerprint(f.store.loadForRuntime()));
 assert.equal(first.actualProviderCostCny,null);assert.equal(first.readyForProduction,false);
});
test('review: rejected durable decision commit cannot acknowledge the response',async t=>{
 const f=fixture(t),original=f.store.commit;
 f.store.commit=function(world,previous,appended){if(world.metrics.successes>0)throw new Error('synthetic_world_commit_failure');return original.call(this,world,previous,appended);};
 const run=f.open();run.runtime.start();reply(f,waitReply(run));await flush();
 assert.equal(f.store.loadForRuntime()!.metrics.successes,0);assert.equal(f.journal.status().completed,0);
 assert.equal(f.journal.status().pending?.phase,'response');assert.equal(run.status().failure,'world_checkpoint_failed');
 assert.equal(run.status().control?.phase,'stopped');assert.equal(f.memory.requests().length,1);
});
test('review: subscriber failure after accepted durability does not undo or repeat acknowledgement',async t=>{
 const f=fixture(t),run=f.open();run.runtime.start();
 run.runtime.subscribe(()=>{if(run.runtime.snapshot().world.metrics.successes>0)throw new Error('synthetic_subscriber_failure');});
 reply(f,waitReply(run));await flush();
 assert.equal(f.store.loadForRuntime()!.metrics.successes,1);assert.equal(f.journal.status().completed,1);
 assert.equal(f.journal.status().pending,null);assert.equal(run.status().control?.reason,'runtime_failed');assert.equal(f.memory.requests().length,1);
 assert.equal(run.status().failure,'runtime_control_failed');
 const result=run.close();assert.equal(result.failure,'runtime_control_failed');assert.equal(result.journal.failure,'runtime_control_failed');
 assert.equal(result.journal.completed,1);assert.equal(result.readyForProduction,false);
});

for(const gap of ['before-checkpoint','before-ack'] as const)test(`review: actual child termination ${gap} blocks reopen without redispatch`,t=>{
 const dir=mkdtempSync(join(testTmpdir(),'production-runtime-review-crash-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const world=createFrontierWorld(),contract=productionCandidateContract({runId:'crash-review',worldId:world.id,maxRequests:3,createdAtMs:Date.now(),deadlineAtMs:Date.now()+120_000,requestTimeoutMs:30_000});
 const source=`
 import {DatabaseSync} from 'node:sqlite';
 import {WorldStore} from './src/server/store.ts';
 import {createFrontierWorld} from './src/world/formal-seed.ts';
 import {ProductionModelJournal} from './src/server/production-model-journal.ts';
 import {persistedWorldFingerprint as fingerprint} from './src/server/acceptance-offline-protocol.ts';
 import {createMemoryProductionHttp} from './src/server/production-model-http.ts';
 import {createProductionModelOfflineRuntime} from './src/server/production-model-runtime.ts';
 import {decisionContext,prepareModelDecision} from './src/server/decisions.ts';
 const dir=${JSON.stringify(dir)},contract=${JSON.stringify(contract)},gap=${JSON.stringify(gap)};
 const store=new WorldStore(dir+'/world.sqlite'),world=createFrontierWorld();store.commit(world,null);
 const db=new DatabaseSync(dir+'/journal.sqlite'),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:fingerprint(store.loadForRuntime())});
 const checkpoint=journal.checkpointWorld.bind(journal);
 journal.checkpointWorld=(...args)=>{if(gap==='before-checkpoint'&&store.loadForRuntime().metrics.successes===1)process.exit(79);return checkpoint(...args);};
 if(gap==='before-ack')journal.acknowledgeWorldCommit=()=>process.exit(80);
 const memory=createMemoryProductionHttp(),run=createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:world.minute+30});
 run.runtime.start();
 if(memory.requests().length!==1)process.exit(81);
 const current=run.runtime.snapshot().world,actor=current.residents.find(r=>current.metrics.inFlight.includes(r.id));
 const choices=prepareModelDecision(decisionContext(current,actor),undefined,contract.model).choices;
 const index=choices.findIndex(c=>c.action.type==='wait');if(index<0)process.exit(82);
 const content=JSON.stringify({choice:String(index+1),minutes:15});
 memory.headers(0);memory.chunk(0,Buffer.from(JSON.stringify({model:contract.model,choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(0);
 setTimeout(()=>process.exit(83),10_000);
 `;
 const child=spawnSync(process.execPath,['--import','./scripts/acceptance-offline-guard.mjs','--import','tsx','--input-type=module','--eval',source],
  {cwd:process.cwd(),env:{HOME:dir,USERPROFILE:dir,TMPDIR:dir,TMP:dir,TEMP:dir},encoding:'utf8',timeout:20_000});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,gap==='before-checkpoint'?79:80,child.stderr);
 const store=new WorldStore(join(dir,'world.sqlite')),db=new DatabaseSync(join(dir,'journal.sqlite'));
 try{
  const loaded=store.loadForRuntime()!;assert.equal(loaded.metrics.successes,1);
  const events=(db.prepare('SELECT body FROM production_model_audit ORDER BY sequence').all() as {body:string}[]).map(row=>JSON.parse(row.body));
  assert.equal(events.filter(e=>e.type==='intent').length,1);assert.equal(events.filter(e=>e.type==='response').length,1);assert.equal(events.filter(e=>e.type==='world_committed').length,0);
  if(gap==='before-checkpoint')assert.throws(()=>new ProductionModelJournal(db,contract,{create:false,worldFingerprint:fingerprint(loaded)}),/production_world_mismatch/);
  else{
   const journal=new ProductionModelJournal(db,contract,{create:false,worldFingerprint:fingerprint(loaded)}),memory=createMemoryProductionHttp();
   assert.equal(journal.status().pending?.phase,'response');assert.equal(journal.status().completed,0);assert.equal(journal.status().failure,'unresolved_request_no_retry');
   assert.throws(()=>createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:loaded.minute+30}),/production_runtime_unresolved/);
   assert.equal(memory.requests().length,0);
  }
 }finally{store.close();db.close();}
});

import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp} from '../src/server/production-model-http.js';
import {createProductionModelOfflineRuntime} from '../src/server/production-model-runtime.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
import {PRODUCTION_MODEL_CANDIDATE as P,readProductionModelPolicy} from '../src/server/production-model-policy.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(t:TestContext,all=false){
 if(Object.getOwnPropertyDescriptor(globalThis,'fetch')?.configurable)t.mock.method(globalThis,'fetch',()=>{throw new Error('network_forbidden');});
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 const dir=mkdtempSync(join(testTmpdir(),'production-runtime-')),worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'model.sqlite');
 let store=new WorldStore(worldPath),db=new DatabaseSync(journalPath);
 const world=createFrontierWorld(5401);
 if(!all)for(const person of world.residents.slice(1))person.decisionDue=world.minute+1000;
 store.commit(world,null);
 const now=Date.now(),contract=productionCandidateContract({runId:'synthetic-runtime',worldId:world.id,maxRequests:30,
  createdAtMs:now-1,deadlineAtMs:now+120_000,requestTimeoutMs:5000});
 let journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:hash(store.loadForRuntime())}),memory=createMemoryProductionHttp();
 let bridge=createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:world.minute+60});
 t.after(()=>{bridge.close();try{store.close();}catch{}try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const respond=(index=0,content?:string)=>{
  const request=memory.requests()[index],messages=JSON.parse(request.body).messages as {content:string}[];
  const choice=messages.map(m=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];assert.ok(choice);
  const reply={model:P.model,choices:[{message:{content:content??JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}};
  memory.headers(index);memory.chunk(index,Buffer.from(JSON.stringify(reply)));memory.end(index);
 };
 return {get store(){return store;},get journal(){return journal;},get bridge(){return bridge;},get memory(){return memory;},db,dir,worldPath,journalPath,contract,respond,
  reopen(){bridge.close();store.close();db.close();store=new WorldStore(worldPath);db=new DatabaseSync(journalPath);
   journal=new ProductionModelJournal(db,contract,{create:false,worldFingerprint:hash(store.loadForRuntime())});memory=createMemoryProductionHttp();
   bridge=createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:store.loadForRuntime()!.minute+60});return bridge;}};
}
test('actual nine-person runtime accepts branded memory HTTP and cleanly checkpoints ticks and restart',async t=>{
 const f=fixture(t,true);assert.equal(f.bridge.runtime.world.residents.length,9);
 f.bridge.runtime.start();
 let index=0;
 while(index<f.memory.requests().length&&index<20){f.respond(index++);await flush();}
 assert.ok(f.journal.status().completed>0);assert.equal(f.journal.status().pending,null);
 assert.equal(f.journal.status().completed,f.bridge.runtime.world.metrics.successes);
 f.bridge.runtime.tick(Date.now()+1000);
 const before=f.journal.status(),stopped=f.bridge.close();assert.equal(stopped.failure,null);
 assert.equal(before.attempts,f.journal.status().attempts);assert.equal(f.journal.status().worldFingerprint,hash(f.store.loadForRuntime()));
 const minute=f.store.loadForRuntime()!.minute,next=f.reopen();assert.equal(next.runtime.world.minute,minute);
 assert.equal(f.journal.status().attempts,before.attempts);assert.equal(f.journal.contract.deadlineAtMs,f.contract.deadlineAtMs);
 assert.equal(next.status().realModelExecuted,false);assert.equal(next.status().actualProviderCostCny,null);assert.equal(next.status().readyForProduction,false);
 assert.equal(readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:'siliconflow',VALLEY_MODEL_ID:P.model}).state,'blocked');
 assert.equal(readFileSync(f.journalPath).includes(Buffer.from('原地停留')),false);
});
test('ordinary durable checkpoint during response preserves pending until exact accepted result',async t=>{
 const f=fixture(t),response=f.journal.response.bind(f.journal);let saw=false;
 t.mock.method(f.journal,'response',(...args:Parameters<ProductionModelJournal['response']>)=>{
  response(...args);f.bridge.runtime.tick(Date.now()+1000);saw=true;
  assert.equal(f.journal.status().pending?.phase,'response');assert.equal(f.journal.status().completed,0);
 });
 f.bridge.runtime.start();f.respond();await flush();
 assert.equal(saw,true);assert.equal(f.journal.status().completed,1);assert.equal(f.journal.status().pending,null);
 assert.equal(f.bridge.close().failure,null);
});
test('a later decision after clean restart consumes the same cumulative journal budget',async t=>{
 const f=fixture(t);f.bridge.runtime.start();f.respond();await flush();
 assert.equal(f.journal.status().completed,1);const failures=f.store.loadForRuntime()!.metrics.failures;
 f.reopen();assert.equal(f.bridge.runtime.world.metrics.failures,failures);
 const now=Date.now()+61_000;t.mock.method(Date,'now',()=>now);
 f.bridge.runtime.start();for(let i=1;i<=10&&!f.memory.requests().length;i++)f.bridge.runtime.tick(now+i*2000);
 assert.equal(f.memory.requests().length,1);assert.equal(f.journal.status().attempts,2);
 f.respond();await flush();assert.equal(f.journal.status().completed,2);assert.equal(f.bridge.runtime.world.metrics.successes,2);
 assert.equal(f.journal.contract.maxRequests,30);assert.equal(f.journal.contract.deadlineAtMs,f.contract.deadlineAtMs);
 assert.equal(f.bridge.close().failure,null);
});
test('changed actor commits rejection, never acknowledges response or retries',async t=>{
 const f=fixture(t);f.bridge.runtime.start();const actor=f.bridge.runtime.world.metrics.inFlight[0];
 f.bridge.runtime.world.residents.find(p=>p.id===actor)!.revision++;
 f.respond();await flush();
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'response');
 assert.equal(f.journal.status().failure,'decision_rejected');assert.equal(f.memory.requests().length,1);
 assert.throws(()=>f.reopen(),/production_world_mismatch|production_runtime_unresolved/);
});
test('invalid parsed reply remains unresolved and stops without another model dispatch',async t=>{
 const f=fixture(t);f.bridge.runtime.start();f.respond(0,'{"choice":"not-in-menu"}');await flush();
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'response');
 assert.equal(f.memory.requests().length,1);assert.notEqual(f.bridge.status().failure,null);
 f.bridge.runtime.tick(Date.now()+10000);assert.equal(f.memory.requests().length,1);
});
test('world transaction failure cannot acknowledge a response',async t=>{
 const f=fixture(t);f.bridge.runtime.start();const old=f.store.commit;
 f.store.commit=()=>{throw new Error('synthetic_disk_failure');};
 f.respond();await flush();
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'response');
 assert.equal(f.bridge.runtime.acceptanceStopStatus()?.reason,'runtime_failed');
 f.store.commit=old;assert.notEqual(f.bridge.close().failure,null);
});
test('world checkpoint write failure stops after actual commit and never invents acknowledgment',async t=>{
 const f=fixture(t);f.bridge.runtime.start();let once=true;const checkpoint=f.journal.checkpointWorld.bind(f.journal);
 t.mock.method(f.journal,'checkpointWorld',(...args:Parameters<ProductionModelJournal['checkpointWorld']>)=>{
  if(once){once=false;throw new Error('synthetic_journal_failure');}return checkpoint(...args);
 });
 f.respond();await flush();assert.equal(f.store.loadForRuntime()!.metrics.successes,1);
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'response');
 assert.equal(f.journal.status().failure,'world_checkpoint_failed');assert.equal(f.memory.requests().length,1);
});
test('close aborts pending HTTP and a late reply cannot become a decision',async t=>{
 const f=fixture(t);f.bridge.runtime.start();const result=f.bridge.close();
 assert.notEqual(result.failure,null);assert.equal(f.memory.requests()[0].signal.aborted,true);
 f.respond();await flush();assert.equal(f.store.loadForRuntime()!.metrics.successes,0);
 assert.equal(f.journal.status().completed,0);assert.equal(f.memory.requests().length,1);
 assert.equal(f.journal.status().pending?.phase,'intent');
});
test('duplicate store binding and forged memory capability reject before runtime writes',t=>{
 const f=fixture(t),revision=f.store.loadForRuntime()!.revision;
 assert.throws(()=>createProductionModelOfflineRuntime({store:f.store,journal:f.journal,transport:createMemoryProductionHttp().transport,endGameMinute:540}),/store_owned/);
 f.bridge.close();const stable=f.store.loadForRuntime()!.revision;
 assert.throws(()=>createProductionModelOfflineRuntime({store:f.store,journal:f.journal,transport:{kind:'synthetic-production-http'},endGameMinute:540}),/production_transport_invalid/);
 assert.equal(f.store.loadForRuntime()!.revision,stable);assert.ok(stable>=revision);
});
test('decision callback requires bounded control before runtime construction can write',()=>{
 const store=new WorldStore(':memory:');
 try{assert.throws(()=>new ValleyRuntime(store,null,undefined,{decisionCommitted:()=>{}}),/observer_requires_control/);
  assert.equal(store.loadForRuntime(),null);
 }finally{store.close();}
});
test('asynchronous decision sink is rejected after durability without replay or unhandled rejection',async t=>{
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 const store=new WorldStore(':memory:'),world=createFrontierWorld(5401);
 for(const person of world.residents.slice(1))person.decisionDue=world.minute+1000;store.commit(world,null);
 const result={decision:{intention:'合成停留',actions:[{type:'wait' as const,minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:0};
 let calls=0,observations=0;
 const runtime=new ValleyRuntime(store,[{model:P.model,key:'OFFLINE-ONLY'}],async()=>{calls++;return result;},
  {mode:'formal',modelSlots:1,decisionCommitted:event=>{
   observations++;assert.equal(event.result,result);assert.equal(event.accepted,true);assert.equal(Object.isFrozen(event),true);
   assert.equal(store.loadForRuntime()!.revision,event.revision);assert.equal(store.loadForRuntime()!.metrics.successes,1);
   return Promise.reject(new Error('synthetic_async_sink'));
  },acceptanceStop:{endGameMinute:540,maxWallMs:5000,maxRequests:5,allowedModels:[P.model],
   unreceiptedFreePolicy:'siliconflow-deepseek-published-zero',
   assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+5000})}});
 try{runtime.start();await flush();assert.equal(calls,1);assert.equal(observations,1);
  assert.equal(runtime.acceptanceStopStatus()?.reason,'runtime_failed');assert.equal(store.loadForRuntime()!.metrics.successes,1);
 }finally{runtime.stop();store.close();}
});
test('subscriber failure is durably blocked without calling bridge status or close',async t=>{
 const f=fixture(t);f.bridge.runtime.start();let thrown=false;
 f.bridge.runtime.subscribe(()=>{if(!thrown&&f.bridge.runtime.world.metrics.successes){thrown=true;throw new Error('synthetic_subscriber_failure');}});
 f.respond();await flush();
 assert.equal(f.journal.status().completed,1);assert.equal(f.journal.status().pending,null);
 assert.equal(f.journal.status().failure,'runtime_control_failed');assert.equal(f.journal.status().runtimeStop,null);
 assert.equal(f.journal.status().worldFingerprint,hash(f.store.loadForRuntime()));
});
test('a shutdown subscriber failure changes an initially normal stop into a durable failure',async t=>{
 const f=fixture(t);f.bridge.runtime.start();f.respond();await flush();
 f.bridge.runtime.subscribe(()=>{throw new Error('synthetic_shutdown_subscriber_failure');});
 f.bridge.runtime.stop();
 assert.equal(f.bridge.runtime.acceptanceStopStatus()?.reason,'manual_stop');
 assert.ok(f.bridge.runtime.acceptanceStopStatus()?.issues.includes('shutdown_failed'));
 assert.equal(f.journal.status().failure,'runtime_control_failed');assert.equal(f.journal.status().completed,1);
});
test('abnormal game-time termination without requests is durable, not a clean resumable close',t=>{
 const f=fixture(t);for(const person of f.bridge.runtime.world.residents)person.decisionDue+=1000;
 f.bridge.runtime.start();assert.equal(f.memory.requests().length,0);f.bridge.runtime.tick(NaN);
 assert.equal(f.bridge.runtime.acceptanceStopStatus()?.reason,'game_time_invalid');
 assert.equal(f.journal.status().failure,'runtime_control_failed');assert.equal(f.bridge.status().failure,'runtime_control_failed');
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().attempts,0);
});
for(const stage of ['beginRuntimeStop','finishRuntimeStop'] as const)test(`shutdown ${stage} persistence failure stays blocked`,t=>{
 const f=fixture(t);for(const person of f.bridge.runtime.world.residents)person.decisionDue+=1000;
 f.bridge.runtime.start();t.mock.method(f.journal,stage,()=>{throw new Error('synthetic_stop_journal_failure');});
 f.bridge.runtime.stop();
 assert.equal(f.journal.status().failure,'runtime_stop_persistence_failed');
 assert.ok(f.bridge.runtime.acceptanceStopStatus()?.issues.includes('evidence_persistence_failed'));
 assert.equal(f.memory.requests().length,0);assert.equal(f.journal.status().completed,0);
});
for(const gap of ['after-control-failure','before-stop-commit','before-stop-terminal'] as const)
 test(`actual child exit ${gap} cannot resume or dispatch`,t=>{
 const dir=mkdtempSync(join(testTmpdir(),'production-runtime-stop-crash-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const world=createFrontierWorld(5401),now=Date.now(),contract=productionCandidateContract({runId:'stop-crash',worldId:world.id,
  maxRequests:3,createdAtMs:now,deadlineAtMs:now+120_000,requestTimeoutMs:30_000});
 const source=`
 import {DatabaseSync} from 'node:sqlite';
 import {WorldStore} from './src/server/store.ts';
 import {createFrontierWorld} from './src/world/formal-seed.ts';
 import {ProductionModelJournal} from './src/server/production-model-journal.ts';
 import {createMemoryProductionHttp} from './src/server/production-model-http.ts';
 import {createProductionModelOfflineRuntime} from './src/server/production-model-runtime.ts';
 import {persistedWorldFingerprint as hash} from './src/server/acceptance-offline-protocol.ts';
 const dir=${JSON.stringify(dir)},contract=${JSON.stringify(contract)},gap=${JSON.stringify(gap)};
 const store=new WorldStore(dir+'/world.sqlite'),world=createFrontierWorld(5401);store.commit(world,null);
 const db=new DatabaseSync(dir+'/model.sqlite'),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:hash(store.loadForRuntime())});
 const memory=createMemoryProductionHttp(),commit=store.commit;let bridge;
 if(gap==='before-stop-commit')store.commit=function(...args){
  if(bridge?.runtime.acceptanceStopStatus()?.reason==='runtime_failed')process.exit(82);return commit.apply(this,args);
 };
 if(gap==='before-stop-terminal')journal.finishRuntimeStop=()=>process.exit(83);
 bridge=createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:540});
 bridge.runtime.start();let thrown=false;
 bridge.runtime.subscribe(()=>{if(!thrown&&bridge.runtime.world.metrics.successes){thrown=true;throw new Error('synthetic_subscriber_failure');}});
 const messages=JSON.parse(memory.requests()[0].body).messages,choice=messages.map(m=>m.content).join('\\n').match(/^(\\S+)\\. 原地停留/m)[1];
 memory.headers(0);memory.chunk(0,Buffer.from(JSON.stringify({model:contract.model,choices:[{message:{content:JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(0);
 setImmediate(()=>{if(journal.status().failure!=='runtime_control_failed')process.exit(85);process.exit(81);});
 setTimeout(()=>process.exit(86),10_000);
 `;
 const child=spawnSync(process.execPath,['--import','./scripts/acceptance-offline-guard.mjs','--import','tsx','--input-type=module','--eval',source],
  {cwd:process.cwd(),env:{HOME:dir,USERPROFILE:dir,TMPDIR:dir,TMP:dir,TEMP:dir},encoding:'utf8',timeout:20_000});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);
 assert.equal(child.status,gap==='after-control-failure'?81:gap==='before-stop-commit'?82:83,child.stderr);
 const store=new WorldStore(join(dir,'world.sqlite')),db=new DatabaseSync(join(dir,'model.sqlite'));
 try{const loaded=store.loadForRuntime()!;assert.equal(loaded.metrics.successes,1);
  const journal=new ProductionModelJournal(db,contract,{create:false,worldFingerprint:hash(loaded)}),memory=createMemoryProductionHttp();
  assert.equal(journal.status().completed,1);assert.equal(journal.status().pending,null);
  assert.equal(journal.status().failure,gap==='after-control-failure'?'runtime_control_failed':'runtime_stop_unresolved');
  assert.throws(()=>createProductionModelOfflineRuntime({store,journal,transport:memory.transport,endGameMinute:540}),/production_runtime_unresolved/);
  assert.equal(memory.requests().length,0);assert.equal(journal.status().attempts,1);
 }finally{store.close();db.close();}
});

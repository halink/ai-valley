import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp} from '../src/server/production-model-http.js';
import {SyntheticPriceSession,syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {createSyntheticPriceEvidence} from '../src/server/production-model-price-evidence.js';
import {createSyntheticPriceRuntimeSegment} from '../src/server/production-model-price-runtime.js';
import {createProductionModelOfflineRuntime} from '../src/server/production-model-runtime.js';
import {persistedWorldFingerprint as fingerprint} from '../src/server/acceptance-offline-protocol.js';
import {PRODUCTION_MODEL_CANDIDATE as P,readProductionModelPolicy} from '../src/server/production-model-policy.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(t:TestContext,limit=20){
 let at=1_000_000,nextTimer=0;
 const timers=new Map<number,{at:number;callback:()=>void}>();
 t.mock.method(Date,'now',()=>at);t.mock.method(performance,'now',()=>at);
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,ms:number)=>{const id=++nextTimer;timers.set(id,{at:at+ms,callback});return id;}) as unknown as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',((id:number)=>timers.delete(id)) as unknown as typeof clearTimeout);
 const dir=mkdtempSync(join(testTmpdir(),'price-runtime-')),worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'model.sqlite'),sessionPath=join(dir,'session.sqlite');
 let store=new WorldStore(worldPath),db=new DatabaseSync(journalPath),sd=new DatabaseSync(sessionPath);
 store.commit(createFrontierWorld(5401),null);
 const common={runId:'synthetic-price-runtime',worldId:store.loadForRuntime()!.id,maxRequests:limit,createdAtMs:at-1,deadlineAtMs:at+2_000_000,requestTimeoutMs:5000};
 const jc=productionCandidateContract(common),sc=syntheticPriceSessionContract({...common,sourceFingerprint:'a'.repeat(64),fixtureScopeHash:'b'.repeat(64),
  commitGraceMs:1000,maxSegments:30,maxEpochs:10,maxAuditRecords:60002});
 let journal=new ProductionModelJournal(db,jc,{create:true,worldFingerprint:fingerprint(store.loadForRuntime())});
 let session=new SyntheticPriceSession(sd,sc,{create:true,worldFingerprint:fingerprint(store.loadForRuntime()),nowMs:at});
 let memory=createMemoryProductionHttp(),bridge:ReturnType<typeof createSyntheticPriceRuntimeSegment>|undefined;
 const install=()=>{const s=session.status();session.installPrice(createSyntheticPriceEvidence({scopeHash:session.contractHash,sequence:s.epochs+1,
  previousEvidenceHash:s.evidenceHash,fixtureId:'runtime-test',observedAtMs:at,validUntilMs:at+900000}),at);};install();
 const open=()=>{memory=createMemoryProductionHttp();bridge=createSyntheticPriceRuntimeSegment({store,journal,session,transport:memory.transport,endGameMinute:store.loadForRuntime()!.minute+60});return bridge;};
 const respond=(index=0,content?:string)=>{
  const messages=JSON.parse(memory.requests()[index].body).messages as {content:string}[];
  const choice=messages.map(m=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];assert.ok(choice);
  memory.headers(index);memory.chunk(index,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content:content??JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],
   usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(index);
 };
 const reopen=()=>{
  bridge?.close();store.close();db.close();sd.close();store=new WorldStore(worldPath);db=new DatabaseSync(journalPath);sd=new DatabaseSync(sessionPath);
  const worldFingerprint=fingerprint(store.loadForRuntime());journal=new ProductionModelJournal(db,jc,{create:false,worldFingerprint});
  session=new SyntheticPriceSession(sd,sc,{create:false,worldFingerprint,nowMs:at});bridge=undefined;
 };
 t.after(()=>{bridge?.close();try{store.close();}catch{}try{db.close();}catch{}try{sd.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 return {open,respond,reopen,install,get bridge(){return bridge!;},get memory(){return memory;},get store(){return store;},get journal(){return journal;},get session(){return session;},
  get now(){return at;},set now(value:number){at=value;},timers,dir,worldPath,journalPath,sessionPath,jc,sc,
  advance(ms:number){const target=at+ms;for(;;){const due=[...timers.entries()].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;
   at=due[1].at;timers.delete(due[0]);due[1].callback();}at=target;}};
}
test('real nine-person runtime drains one in-flight response through both ledgers and seals, without second dispatch',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();assert.equal(f.memory.requests().length,1);
 b.drain();assert.equal(f.session.status().phase,'draining');assert.equal(f.memory.requests()[0].signal.aborted,false);
 f.respond();await flush();const s=b.status();
 assert.equal(s.sealed,true);assert.equal(s.failure,null);assert.equal(s.session.completed,1);assert.equal(s.journal.completed,1);
 assert.equal(s.session.pending,null);assert.equal(s.journal.pending,null);assert.equal(s.session.segment,null);assert.equal(f.memory.requests().length,1);
 assert.equal(s.session.worldFingerprint,fingerprint(f.store.loadForRuntime()));assert.equal(s.journal.worldFingerprint,s.session.worldFingerprint);
 assert.equal(s.liveExecutionEnabled,false);assert.equal(s.realModelExecuted,false);assert.equal(s.actualProviderCostCny,null);
 assert.equal(s.requiresExternalWatchdog,true);assert.equal(s.readyForProduction,false);assert.equal(f.timers.size,0);
 assert.equal(b.close().failure,null);assert.throws(()=>b.runtime.start(),/single_use/);
 assert.equal(readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:'siliconflow',VALLEY_MODEL_ID:P.model}).state,'blocked');
});
test('cutoff timer closes admission but lets earlier request finish before response and seal deadlines',async t=>{
 const f=fixture(t),b=f.open();f.advance(23999);b.runtime.start();assert.equal(f.memory.requests().length,1);
 f.advance(1);assert.equal(f.session.status().phase,'draining');assert.equal(f.memory.requests()[0].signal.aborted,false);
 f.advance(100);f.respond();await flush();assert.equal(b.status().sealed,true);assert.equal(b.status().failure,null);assert.equal(f.memory.requests().length,1);
});
test('exact cutoff with no requests drains and seals without dispatch or budget reset',t=>{
 const f=fixture(t),b=f.open();f.now+=24000;b.runtime.start();
 assert.equal(b.status().sealed,true);assert.equal(f.memory.requests().length,0);assert.equal(f.session.status().attempts,0);assert.equal(f.session.status().reservedWallMs,30000);
});
test('two price epochs across actual database reopen preserve world, original deadline and lifetime request count',async t=>{
 const f=fixture(t,2),first=f.open();first.runtime.start();first.drain();f.respond();await flush();assert.equal(first.status().sealed,true);
 const minute=f.store.loadForRuntime()!.minute;f.now+=900001;f.reopen();assert.equal(f.session.status().phase,'awaiting_price');f.install();
 const second=f.open();assert.equal(second.runtime.world.minute,minute);second.runtime.start();f.respond();await flush();
 assert.equal(second.status().sealed,true);assert.equal(second.status().failure,null);assert.equal(f.memory.requests().length,1);
 assert.equal(f.journal.status().attempts,2);assert.equal(f.session.status().attempts,2);assert.equal(f.session.status().completed,2);
 assert.equal(f.session.status().epochs,2);assert.equal(f.session.status().segments,2);assert.equal(f.session.status().reservedWallMs,60000);
 assert.equal(f.session.contract.deadlineAtMs,f.sc.deadlineAtMs);second.close();assert.throws(()=>f.open(),/budget_exhausted/);
});
test('ordinary checkpoint between durable response and decision adoption never acknowledges either pending',async t=>{
 const f=fixture(t),b=f.open(),response=f.session.recordResponse.bind(f.session);let checked=false;
 t.mock.method(f.session,'recordResponse',(...args:Parameters<SyntheticPriceSession['recordResponse']>)=>{
  response(...args);b.runtime.tick(f.now+1000);assert.equal(f.journal.status().pending?.phase,'response');assert.equal(f.session.status().pending?.phase,'response');
  assert.equal(f.journal.status().completed,0);assert.equal(f.session.status().completed,0);checked=true;b.drain();
 });b.runtime.start();f.respond();await flush();assert.equal(checked,true);assert.equal(b.status().sealed,true);
});
test('session intent is durable before journal intent and failed second intent dispatches nothing',async t=>{
 const f=fixture(t),b=f.open();t.mock.method(f.journal,'intent',()=>{assert.equal(f.session.status().pending?.phase,'intent');throw new Error('disk_failure');});
 b.runtime.start();await flush();assert.equal(f.memory.requests().length,0);assert.equal(f.session.status().attempts,1);assert.equal(f.journal.status().attempts,0);
 assert.ok(b.status().failure);assert.ok(f.session.status().failure);assert.ok(f.journal.status().failure);assert.equal(b.status().sealed,false);
});
test('slow durable journal intent crossing cutoff cannot invoke transport even with a reserved session intent',async t=>{
 const f=fixture(t),b=f.open(),intent=f.journal.intent.bind(f.journal);
 t.mock.method(f.journal,'intent',(...args:Parameters<ProductionModelJournal['intent']>)=>{const id=intent(...args);f.now=f.session.status().segment!.admissionCutoffMs;return id;});
 b.runtime.start();await flush();assert.equal(f.memory.requests().length,0);assert.equal(f.session.status().attempts,1);assert.equal(f.journal.status().attempts,1);
 assert.ok(b.status().failure);assert.equal(b.status().sealed,false);assert.equal(f.session.status().pending?.phase,'intent');
});
for(const boundary of ['response','commit'] as const)test(`exact ${boundary} deadline is not accepted or sealed`,async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();
 if(boundary==='response')f.now=f.session.status().pending!.deadlineAtMs;
 else{const response=f.session.recordResponse.bind(f.session);t.mock.method(f.session,'recordResponse',(...args:Parameters<SyntheticPriceSession['recordResponse']>)=>{
  response(...args);f.now=f.session.status().pending!.deadlineAtMs+f.sc.commitGraceMs;
 });}
 b.drain();f.respond();await flush();assert.equal(f.session.status().completed,0);assert.equal(f.journal.status().completed,0);
 assert.ok(b.status().failure);assert.equal(b.status().sealed,false);assert.equal(f.memory.requests().length,1);
});
test('failure to persist either block is explicit and retained pending prevents continuation',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();
 t.mock.method(f.journal,'block',()=>{throw new Error('journal_unwritable');});t.mock.method(f.session,'fail',()=>{throw new Error('session_unwritable');});
 f.respond(0,'{"choice":"bad"}');await flush();assert.ok(b.status().failure);assert.equal(b.status().sealed,false);
 assert.deepEqual(new Set(b.status().persistenceIssues),new Set(['journal_block_failed','session_block_failed']));
 assert.equal(f.session.status().pending?.phase,'response');assert.equal(f.journal.status().pending?.phase,'response');assert.equal(f.memory.requests().length,1);
});
test('journal response followed by failed session response never parses, adopts or retries',async t=>{
 const f=fixture(t),b=f.open();t.mock.method(f.session,'recordResponse',()=>{assert.equal(f.journal.status().pending?.phase,'response');throw new Error('disk_failure');});
 b.runtime.start();f.respond();await flush();assert.equal(f.store.loadForRuntime()!.metrics.successes,0);assert.equal(f.session.status().pending?.phase,'intent');
 assert.equal(f.journal.status().pending?.phase,'response');assert.equal(f.memory.requests().length,1);assert.ok(b.status().failure);assert.equal(b.status().sealed,false);
});
for(const boundary of ['checkpoint','ack'] as const)test(`failed session ${boundary} after durable world or first ack cannot seal or reopen`,async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();
 if(boundary==='checkpoint')t.mock.method(f.session,'checkpointWorld',()=>{throw new Error('disk_failure');});
 else t.mock.method(f.session,'acknowledgeWorldCommit',()=>{assert.equal(f.journal.status().completed,1);throw new Error('disk_failure');});
 f.respond();await flush();assert.equal(f.store.loadForRuntime()!.metrics.successes,1);assert.equal(f.session.status().completed,0);
 assert.equal(f.session.status().pending?.phase,'response');assert.equal(b.status().sealed,false);assert.ok(b.status().failure);assert.equal(f.memory.requests().length,1);
 try{f.reopen();assert.throws(()=>f.open(),/unresolved|mismatch/);}catch(error){assert.match(String(error),/mismatch|unresolved/);}
});
for(const kind of ['invalid','actor_changed'] as const)test(`${kind} response retains unresolved state and blocks renewal`,async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();if(kind==='actor_changed')b.runtime.world.residents.find(p=>p.id===b.runtime.world.metrics.inFlight[0])!.revision++;
 f.respond(0,kind==='invalid'?'{"choice":"bad"}':undefined);await flush();assert.equal(b.status().sealed,false);assert.equal(f.session.status().completed,0);
 assert.equal(f.journal.status().completed,0);assert.ok(f.session.status().failure);assert.throws(()=>f.install());assert.equal(f.memory.requests().length,1);
});
test('close cancels rather than falsely draining pending; late reply cannot acknowledge',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();const s=b.close();assert.equal(s.sealed,false);assert.ok(s.failure);assert.equal(f.memory.requests()[0].signal.aborted,true);
 f.respond();await flush();assert.equal(f.session.status().completed,0);assert.equal(f.journal.status().completed,0);assert.equal(f.memory.requests().length,1);
});
test('post-ack shutdown subscriber failure keeps segment unsealed and both ledgers blocked',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();b.drain();
 b.runtime.subscribe(()=>{if(b.runtime.acceptanceStopStatus()?.phase==='stopped')throw new Error('shutdown_listener');});
 f.respond();await flush();assert.equal(f.session.status().completed,1);assert.equal(f.journal.status().completed,1);assert.equal(b.status().sealed,false);
 assert.ok(b.status().failure);assert.ok(f.session.status().failure);assert.ok(f.journal.status().failure);
});
test('global deadline never becomes a clean seal',t=>{
 const f=fixture(t),b=f.open();f.now=f.sc.deadlineAtMs;b.runtime.start();assert.equal(f.memory.requests().length,0);assert.equal(b.status().sealed,false);assert.ok(b.status().failure);
});
test('clock rollback during drain cannot seal or acknowledge',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();b.drain();f.now--;f.respond();await flush();
 assert.equal(b.status().sealed,false);assert.ok(b.status().failure);assert.equal(f.session.status().completed,0);assert.equal(f.journal.status().completed,0);
});
test('forged capability and duplicate ownership are rejected before runtime writes; ordinary bridge shares ownership',t=>{
 const f=fixture(t),revision=f.store.loadForRuntime()!.revision;
 assert.throws(()=>createSyntheticPriceRuntimeSegment({store:f.store,journal:f.journal,session:f.session,transport:{kind:'synthetic-production-http'},endGameMinute:540}),/transport_invalid/);
 assert.equal(f.store.loadForRuntime()!.revision,revision);assert.equal(f.session.status().segments,0);
 const b=f.open(),after=f.store.loadForRuntime()!.revision;
 assert.throws(()=>createProductionModelOfflineRuntime({store:f.store,journal:f.journal,transport:createMemoryProductionHttp().transport,endGameMinute:540}),/store_owned/);
 assert.throws(()=>f.open(),/store_owned/);assert.equal(f.store.loadForRuntime()!.revision,after);b.close();
});
test('drain/admission are opt-in and rejected without acceptance control before world mutation',()=>{
 const store=new WorldStore(':memory:');try{
  assert.throws(()=>new ValleyRuntime(store,null,undefined,{acceptanceAdmission:()=>true}),/requires_control/);assert.equal(store.loadForRuntime(),null);
  const runtime=new ValleyRuntime(store,null);assert.throws(()=>runtime.drainAcceptance(),/not_enabled/);runtime.stop();
 }finally{store.close();}
});

// Real processes use only generated isolated databases and the same offline
// guard. These process.exit boundaries are not power-loss or SIGKILL tests.
for(const point of ['intent','response','world','ack','session_ack','stop','seal','sealed'] as const)test(`process exit at ${point} preserves the exact durable continuation boundary`,t=>{
 const dir=mkdtempSync(join(testTmpdir(),'price-runtime-crash-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const wp=join(dir,'world.sqlite'),jp=join(dir,'journal.sqlite'),sp=join(dir,'session.sqlite');
 const script=`
 import {DatabaseSync} from 'node:sqlite';
 import {WorldStore} from './src/server/store.ts';
 import {createFrontierWorld} from './src/world/formal-seed.ts';
 import {ProductionModelJournal,productionCandidateContract} from './src/server/production-model-journal.ts';
 import {SyntheticPriceSession,syntheticPriceSessionContract} from './src/server/production-model-price-session.ts';
 import {createSyntheticPriceEvidence} from './src/server/production-model-price-evidence.ts';
 import {createMemoryProductionHttp} from './src/server/production-model-http.ts';
 import {createSyntheticPriceRuntimeSegment} from './src/server/production-model-price-runtime.ts';
 import {persistedWorldFingerprint as fp} from './src/server/acceptance-offline-protocol.ts';
 import {PRODUCTION_MODEL_CANDIDATE as P} from './src/server/production-model-policy.ts';
 Date.now=()=>1000000;globalThis.setInterval=()=>0;
 const store=new WorldStore(${JSON.stringify(wp)});store.commit(createFrontierWorld(5401),null);
 const common={runId:'crash',worldId:store.loadForRuntime().id,maxRequests:10,createdAtMs:999999,deadlineAtMs:2000000,requestTimeoutMs:5000};
 const jc=productionCandidateContract(common),sc=syntheticPriceSessionContract({...common,sourceFingerprint:'a'.repeat(64),fixtureScopeHash:'b'.repeat(64),commitGraceMs:1000,maxSegments:10,maxEpochs:10,maxAuditRecords:60002});
 const journal=new ProductionModelJournal(new DatabaseSync(${JSON.stringify(jp)}),jc,{create:true,worldFingerprint:fp(store.loadForRuntime())});
 const session=new SyntheticPriceSession(new DatabaseSync(${JSON.stringify(sp)}),sc,{create:true,worldFingerprint:fp(store.loadForRuntime()),nowMs:1000000});
 session.installPrice(createSyntheticPriceEvidence({scopeHash:session.contractHash,sequence:1,previousEvidenceHash:null,fixtureId:'crash-test',observedAtMs:1000000,validUntilMs:1900000}),1000000);
 const memory=createMemoryProductionHttp(),bridge=createSyntheticPriceRuntimeSegment({store,journal,session,transport:memory.transport,endGameMinute:540});
 const hook=(target,name,before=false)=>{const old=target[name].bind(target);target[name]=(...args)=>{if(before)process.exit(73);const value=old(...args);process.exit(73);return value;};};
 const point=${JSON.stringify(point)};
 if(point==='intent')hook(session,'beginRequest');
 if(point==='response')hook(journal,'response');
 if(point==='ack')hook(journal,'acknowledgeWorldCommit');
 if(point==='session_ack')hook(session,'acknowledgeWorldCommit');
 if(point==='stop')hook(journal,'beginRuntimeStop');
 if(point==='seal')hook(session,'finishSegment',true);
 if(point==='sealed')hook(session,'finishSegment');
 bridge.runtime.start();if(point==='world')hook(journal,'checkpointWorld');bridge.drain();
 const messages=JSON.parse(memory.requests()[0].body).messages;
 const choice=messages.map(m=>m.content).join('\\n').match(/^(\\S+)\\. 原地停留/m)[1];
 memory.headers(0);memory.chunk(0,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content:JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(0);
 await new Promise(resolve=>setImmediate(resolve));process.exit(90);
 `;
 const child=spawnSync(process.execPath,['--import',resolve('scripts/acceptance-offline-guard.mjs'),'--import',resolve('node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',script],
  {cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:dir,TMPDIR:dir,TMP:dir,TEMP:dir},encoding:'utf8',timeout:20000});
 assert.equal(child.status,73,child.stderr);const store=new WorldStore(wp),sd=new DatabaseSync(sp);
 try{
  const row=sd.prepare('SELECT body FROM synthetic_price_session_audit ORDER BY sequence LIMIT 1').get() as {body:string};const c=JSON.parse(row.body).contract;
  try{const session=new SyntheticPriceSession(sd,c,{create:false,worldFingerprint:fingerprint(store.loadForRuntime()),nowMs:1000001});
   if(point==='sealed'){
    assert.equal(session.status().failure,null);assert.equal(session.status().attempts,1);assert.equal(session.status().completed,1);
    assert.equal(session.status().reservedWallMs,30000);assert.equal(session.status().segment,null);
    assert.equal(session.beginSegment(1000002),2);assert.equal(session.contract.deadlineAtMs,c.deadlineAtMs);assert.equal(session.status().attempts,1);
   }else{assert.ok(session.status().failure);assert.throws(()=>session.beginSegment(1000002));}
  }catch(error){assert.match(String(error),/world_mismatch/);}
 }finally{store.close();sd.close();}
});

import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp} from '../src/server/production-model-http.js';
import {SyntheticPriceSession,syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {createSyntheticPriceEvidence} from '../src/server/production-model-price-evidence.js';
import {createSyntheticPriceRuntimeSegment} from '../src/server/production-model-price-runtime.js';
import {persistedWorldFingerprint as fingerprint} from '../src/server/acceptance-offline-protocol.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(t:TestContext,limit=20){
 let at=1_000_000,nextTimer=0;
 const timers=new Map<number,{at:number;callback:()=>void}>();
 t.mock.method(Date,'now',()=>at);t.mock.method(performance,'now',()=>at);
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,ms:number)=>{const id=++nextTimer;timers.set(id,{at:at+ms,callback});return id;}) as unknown as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',((id:number)=>timers.delete(id)) as unknown as typeof clearTimeout);
 mkdirSync('output/price-runtime-review',{recursive:true});
 const dir=mkdtempSync(join(resolve('output/price-runtime-review'),'fixture-')),worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'model.sqlite'),sessionPath=join(dir,'session.sqlite');
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

test('review: subscriber drain between reservation and dispatch sends no request and seals cleanly',t=>{
 const f=fixture(t),b=f.open();
 b.runtime.subscribe(()=>{if(b.runtime.world.metrics.requests>0&&b.runtime.acceptanceStopStatus()?.phase==='running')b.drain();});
 b.runtime.start();
 const s=b.status();
 assert.equal(f.memory.requests().length,0);assert.equal(s.session.attempts,0);assert.equal(s.journal.attempts,0);
 assert.equal(s.control?.requestReservations,1);assert.equal(s.control?.dispatchedRequests,0);
 assert.equal(s.control?.interruptedRequests,0);assert.equal(s.sealed,true);assert.equal(s.failure,null);
});
test('review: session seal failure after journal finish stop cannot authorize continuation',async t=>{
 const f=fixture(t,1),b=f.open();
 t.mock.method(f.session,'finishSegment',()=>{assert.equal(f.journal.status().runtimeStop,null);throw new Error('seal_disk_failure');});
 b.runtime.start();f.respond();await flush();
 const s=b.status();assert.equal(s.session.completed,1);assert.equal(s.journal.completed,1);
 assert.equal(s.sealed,false);assert.ok(s.failure);assert.ok(s.session.failure);assert.ok(s.journal.failure);
 assert.ok(s.session.segment);assert.equal(s.control?.phase,'stopped');assert.equal(f.memory.requests().length,1);
});
test('review: journal finish stop failure cannot seal session',async t=>{
 const f=fixture(t,1),b=f.open();
 t.mock.method(f.journal,'finishRuntimeStop',()=>{throw new Error('stop_disk_failure');});
 b.runtime.start();f.respond();await flush();
 const s=b.status();assert.equal(s.sealed,false);assert.ok(s.failure);assert.ok(s.session.segment);
 assert.ok(s.session.failure);assert.ok(s.journal.failure);assert.equal(f.memory.requests().length,1);
});
test('review: exact commit grace boundary rejects acknowledged world and cannot seal',async t=>{
 const f=fixture(t,1),b=f.open(),record=f.session.recordResponse.bind(f.session);
 t.mock.method(f.session,'recordResponse',(...args:Parameters<SyntheticPriceSession['recordResponse']>)=>{
  record(...args);f.now=f.session.status().pending!.deadlineAtMs+f.sc.commitGraceMs;
 });
 b.runtime.start();f.respond();await flush();
 const s=b.status();assert.equal(s.sealed,false);assert.ok(s.failure);assert.equal(s.session.completed,0);
 assert.equal(s.journal.completed,0);assert.equal(f.memory.requests().length,1);
});
test('review: rollback while draining never seals and cannot acknowledge late result',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();b.drain();f.now--;
 f.respond();await flush();const s=b.status();assert.equal(s.sealed,false);assert.ok(s.failure);
 assert.equal(s.session.completed,0);assert.equal(s.journal.completed,0);assert.equal(f.memory.requests().length,1);
});
test('review: persistence of fail markers may fail but in-memory bridge remains stopped',async t=>{
 const f=fixture(t),b=f.open();
 t.mock.method(f.journal,'block',()=>{throw new Error('journal_disk_failure');});
 t.mock.method(f.session,'fail',()=>{throw new Error('session_disk_failure');});
 t.mock.method(f.session,'recordResponse',()=>{throw new Error('response_disk_failure');});
 b.runtime.start();f.respond();await flush();const s=b.status();assert.ok(s.failure);assert.equal(s.sealed,false);
 assert.equal(s.control?.phase,'stopped');assert.equal(f.memory.requests().length,1);
 assert.deepEqual(s.persistenceIssues.sort(),['journal_block_failed','session_block_failed']);
 assert.throws(()=>b.runtime.start(),/single_use/);
});
test('review: reentrant price assessment cannot dispatch a new model after drain',t=>{
 const f=fixture(t);let assessments=0,calls=0,runtime:ValleyRuntime;
 runtime=new ValleyRuntime(f.store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async()=>{
  calls++;return new Promise<never>(()=>{});
 },{mode:'formal',modelSlots:1,acceptanceAdmission:()=>true,acceptanceStop:{
  endGameMinute:f.store.loadForRuntime()!.minute+60,maxWallMs:30000,maxRequests:10,allowedModels:[P.model],
  assessPrice:model=>{
   if(++assessments===3)runtime.drainAcceptance();
   return {model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:f.now+30000};
  }
 }});
 t.after(()=>runtime.stop());runtime.start();assert.equal(assessments,3);assert.equal(calls,0);
});
test('review: one timer cleanup failure still attempts every timer and stops runtime',async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();
 const timers=[...f.timers.keys()],attempted=new Set<number>();let first=true;
 t.mock.method(globalThis,'clearTimeout',((id:number)=>{
  attempted.add(id);if(first){first=false;throw new Error('cleanup_failed');}f.timers.delete(id);
 }) as unknown as typeof clearTimeout);
 const s=b.close();assert.equal(s.sealed,false);assert.ok(s.failure);assert.equal(s.control?.phase,'stopped');
 assert.equal(f.memory.requests()[0].signal.aborted,true);
 assert.ok(timers.every(id=>attempted.has(id)),'every originally armed timer must be attempted despite first failure');
 f.respond();await flush();assert.equal(f.session.status().completed,0);assert.equal(f.memory.requests().length,1);
});

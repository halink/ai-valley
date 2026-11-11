import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp} from '../src/server/production-model-http.js';
import {SyntheticPriceSession,syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {createSyntheticPriceEvidence} from '../src/server/production-model-price-evidence.js';
import {createSyntheticPriceRuntimeSegment} from '../src/server/production-model-price-runtime.js';
import {persistedWorldFingerprint as fingerprint} from '../src/server/acceptance-offline-protocol.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
import {ModelBudget} from '../src/server/model-budget.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('unsent budget cancellation is staged, identity-specific and cannot erase a completed or restored charge',()=>{
 const b=new ModelBudget(900,45000,[],1000),first=b.reserve(1000,100,200)!,other=b.reserve(1000,100,200)!;
 assert.ok(first&&other);const original=b.snapshot(),staged=b.prepareUnsentCancellation(first);
 assert.deepEqual(b.snapshot(),original,'staging or abandoning a failed write does not refund memory');
 assert.deepEqual(staged.snapshot,[original[1]]);
 assert.throws(()=>b.prepareUnsentCancellation({...first}),/reservation_not_pending/);
 staged.committed();assert.deepEqual(b.snapshot(),[original[1]]);
 assert.throws(()=>staged.committed(),/reservation_not_pending/);assert.throws(()=>b.prepareUnsentCancellation(first),/reservation_not_pending/);
 b.finish(other,1001);assert.throws(()=>b.prepareUnsentCancellation(other),/reservation_not_pending/);
 const restored=new ModelBudget(900,45000,b.snapshot(),1002);assert.throws(()=>restored.prepareUnsentCancellation(other),/reservation_not_pending/);
 assert.deepEqual(restored.snapshot(),b.snapshot());
});

function fixture(t:TestContext){
 let at=1_000_000,next=0;const timers=new Map<number,{at:number;callback:()=>void}>();
 t.mock.method(Date,'now',()=>at);t.mock.method(performance,'now',()=>at);
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,ms:number)=>{const id=++next;timers.set(id,{at:at+ms,callback});return id;}) as unknown as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',((id:number)=>timers.delete(id)) as unknown as typeof clearTimeout);
 const path=mkdtempSync(join(testTmpdir(),'budget-cancellation-')),worldPath=join(path,'world.sqlite');
 let store=new WorldStore(worldPath),md=new DatabaseSync(join(path,'model.sqlite')),sd=new DatabaseSync(join(path,'session.sqlite'));
 store.commit(createFrontierWorld(5401),null);
 const common={runId:'synthetic-budget-cancellation',worldId:store.loadForRuntime()!.id,maxRequests:20000,createdAtMs:at,deadlineAtMs:at+21_600_000,requestTimeoutMs:5000};
 const jc=productionCandidateContract(common),sc=syntheticPriceSessionContract({...common,sourceFingerprint:'a'.repeat(64),fixtureScopeHash:fingerprint(store.loadForRuntime()),commitGraceMs:1000,maxSegments:720,maxEpochs:720,maxAuditRecords:60002});
 let journal=new ProductionModelJournal(md,jc,{create:true,worldFingerprint:fingerprint(store.loadForRuntime())});
 let session=new SyntheticPriceSession(sd,sc,{create:true,worldFingerprint:fingerprint(store.loadForRuntime()),nowMs:at});
 let memory=createMemoryProductionHttp(),bridge:ReturnType<typeof createSyntheticPriceRuntimeSegment>|undefined;
 const open=()=>{const s=session.status();session.installPrice(createSyntheticPriceEvidence({scopeHash:session.contractHash,sequence:s.epochs+1,previousEvidenceHash:s.evidenceHash,fixtureId:'budget-cancellation',observedAtMs:at,validUntilMs:at+30000}),at);
  memory=createMemoryProductionHttp();bridge=createSyntheticPriceRuntimeSegment({store,journal,session,transport:memory.transport,endGameMinute:store.loadForRuntime()!.minute+60});return bridge;};
 const reopen=()=>{bridge?.close();store.close();md.close();sd.close();at+=1000;store=new WorldStore(worldPath);md=new DatabaseSync(join(path,'model.sqlite'));sd=new DatabaseSync(join(path,'session.sqlite'));
  const fp=fingerprint(store.loadForRuntime());journal=new ProductionModelJournal(md,jc,{create:false,worldFingerprint:fp});session=new SyntheticPriceSession(sd,sc,{create:false,worldFingerprint:fp,nowMs:at});bridge=undefined;};
 const respond=(index:number,content?:string)=>{const messages=JSON.parse(memory.requests()[index].body).messages as {content:string}[],choice=messages.map(m=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];assert.ok(choice);
  memory.headers(index);memory.chunk(index,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content:content??JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(index);};
 t.after(()=>{bridge?.close();store.close();md.close();sd.close();rmSync(path,{recursive:true,force:true});});
 return {open,reopen,respond,worldPath,get store(){return store;},get memory(){return memory;},get session(){return session;},get journal(){return journal;},
  get now(){return at;},set now(value:number){at=value;},runDue(){for(const [id,timer] of [...timers])if(timer.at<=at){timers.delete(id);timer.callback();}}};
}

test('two consecutive pre-model cancellations retain 16 then 28 completed requests and the reopened third segment serves all nine',async t=>{
 const f=fixture(t),reports:Array<{requests:number;completed:number;cancelled:number;advanced:number;actors:Set<string>;charges:ReturnType<ModelBudget['snapshot']>}> = [];
 for(let epoch=1;epoch<=3;epoch++){
  if(epoch>1)f.reopen();const before=f.store.loadForRuntime()!,b=f.open(),cutoff=f.session.status().segment!.admissionCutoffMs;
  const original=f.store.commit.bind(f.store),target=epoch===1?16:12;let injected=false,responded=0;const actors=new Set<string>();
  f.store.commit=(...args:Parameters<WorldStore['commit']>)=>{const result=original(...args);
   if(epoch<3&&!injected&&args[0].metrics.successes-before.metrics.successes===target&&args[0].metrics.requests>before.metrics.requests+target){injected=true;f.now=cutoff;}return result;};
  b.runtime.start();
  for(let step=0;step<100&&!b.status().sealed;step++){
   while(responded<f.memory.requests().length){actors.add(b.runtime.world.metrics.inFlight[0]);f.respond(responded++);await flush();
    // Fixed synthetic scheduling cost, not a real-wall CI reproduction or a retry.
    if(!b.status().sealed){f.now+=400;b.runtime.tick(f.now);await flush();}}
   if(b.status().sealed)break;
   f.now=Math.min(f.now+1000,cutoff);b.runtime.tick(f.now);await flush();f.runDue();
  }
  const status=b.status(),saved=f.store.loadForRuntime()!;
  assert.equal(status.sealed,true);assert.equal(status.failure,null);assert.equal(status.session.pending,null);assert.equal(status.journal.pending,null);
  assert.equal(status.session.attempts,status.journal.attempts);assert.equal(status.session.completed,status.journal.completed);
  assert.equal(status.session.worldFingerprint,fingerprint(saved));assert.equal(status.journal.worldFingerprint,fingerprint(saved));
  assert.equal(saved.metrics.requests-before.metrics.requests,f.memory.requests().length+status.admissionCancellations.length);
  reports.push({requests:f.memory.requests().length,completed:status.session.completed,cancelled:status.admissionCancellations.length,advanced:saved.minute-before.minute,actors,charges:saved.metrics.usageWindow?.[P.model]??[]});
  if(epoch<3)assert.equal(injected,true);b.close();
 }
 assert.deepEqual(reports.slice(0,2).map(r=>r.requests),[16,12]);assert.deepEqual(reports.slice(0,2).map(r=>r.completed),[16,28]);
 assert.deepEqual(reports.map(r=>r.cancelled),[1,1,0]);
 assert.ok(reports[2].requests>=9,`third segment requests: ${reports[2].requests}`);assert.equal(reports[2].actors.size,9);assert.ok(reports[2].advanced>=10);
 for(const report of reports){assert.ok(report.charges.every(c=>c.input===1&&c.output===1&&c.finishedAt!==undefined),'only real completed usage survives; no unsent estimates');}
 assert.equal(reports[1].charges.length,28,'unrelated completed history is retained, not cleared');
});

test('failed cancellation transaction retains durable reservation and cannot seal or publish cancellation',async t=>{
 const f=fixture(t),b=f.open(),cutoff=f.session.status().segment!.admissionCutoffMs,original=f.store.commit.bind(f.store);let refused=false;
 let budget:ModelBudget|undefined;const reserve=ModelBudget.prototype.reserve;
 t.mock.method(ModelBudget.prototype,'reserve',function(this:ModelBudget,...args:Parameters<ModelBudget['reserve']>){budget=this;return reserve.apply(this,args);});
 f.store.commit=(...args:Parameters<WorldStore['commit']>)=>{
  if(args[0].metrics.admissionCancellation){refused=true;throw new Error('synthetic_cancel_write_failed');}
  const result=original(...args);if(args[0].metrics.requests===1)f.now=cutoff;return result;};
 b.runtime.start();await flush();const s=b.status(),saved=f.store.loadForRuntime()!;
 assert.equal(refused,true);assert.equal(s.sealed,false);assert.ok(s.failure);assert.equal(s.admissionCancellations.length,0);assert.equal(saved.metrics.admissionCancellation,undefined);
 assert.equal(f.memory.requests().length,0);assert.equal(s.session.attempts,0);assert.equal(s.journal.attempts,0);
 const charges=saved.metrics.usageWindow?.[P.model]??[];assert.equal(charges.length,1);assert.ok(charges[0].input>1000);assert.equal(charges[0].finishedAt,undefined);
 assert.deepEqual(budget?.snapshot(),charges,'failed durable receipt must not refund memory either');
});

for(const failure of ['unknown','transport_error','invalid_response'] as const)test(`a dispatched ${failure} request retains its conservative reservation`,async t=>{
 const f=fixture(t),b=f.open();b.runtime.start();assert.equal(f.memory.requests().length,1);const before=structuredClone(f.store.loadForRuntime()!.metrics.usageWindow?.[P.model]);assert.ok(before?.[0].input!>1000);
 if(failure==='transport_error')f.memory.reject(0);else if(failure==='invalid_response')f.respond(0,'{"choice":"invalid"}');else b.close();
 await flush();const s=b.status(),saved=f.store.loadForRuntime()!;
 assert.equal(s.sealed,false);assert.ok(s.failure);assert.equal(s.admissionCancellations.length,0);assert.equal(s.session.attempts,1);assert.equal(s.journal.attempts,1);
 assert.deepEqual(saved.metrics.usageWindow?.[P.model],before);assert.equal(saved.metrics.admissionCancellation,undefined);
 const restored=new ModelBudget(900,45000,before,f.now+1000);assert.equal(restored.snapshot()[0].input,before![0].input);assert.equal(restored.snapshot()[0].output,before![0].output);
});

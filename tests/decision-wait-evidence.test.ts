import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DecisionError,decisionContext,type ModelResult} from '../src/server/decisions.js';
import {DecisionWaitEvidence,type DecisionWaitEvent,type DecisionWaitObserver} from '../src/server/decision-wait-evidence.js';
import {QWEN_MODEL,DEEPSEEK_MODEL,type ModelConnection} from '../src/server/model-completion.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {World} from '../src/shared/types.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const result:ModelResult={decision:{intention:'PRIVATE_REPLY',actions:[{type:'wait',minutes:15}]},inputTokens:4,outputTokens:2,latencyMs:999999};
const providers=[{model:QWEN_MODEL,key:'PRIVATE_PRIMARY_KEY'},{model:DEEPSEEK_MODEL,key:'PRIVATE_BACKUP_KEY'}] as const;
type Pending={actorId:string;resolve:(value:ModelResult)=>void;reject:(error:unknown)=>void};
const timerFixtures=new WeakSet<TestContext>();
function fixture(t:TestContext,world:World=createWorld(),connections:string|null|readonly ModelConnection[]='PRIVATE_KEY',observer?:DecisionWaitObserver){
 if(!timerFixtures.has(t)){t.mock.timers.enable({apis:['setInterval']});timerFixtures.add(t);}
 let wall=1_700_000_000_000,mono=100;
 t.mock.method(Date,'now',()=>wall);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network is forbidden in this test');});
 const store=new WorldStore(':memory:');store.commit(world,null);
 const events:DecisionWaitEvent[]=[],pending:Pending[]=[];
 const runtime=new ValleyRuntime(store,connections,(_key,c)=>new Promise((resolve,reject)=>pending.push({actorId:c.actor.id,resolve,reject})),{
  modelSlots:2,decisionWaitEvidence:{observe:observer??(event=>{events.push(event);}),monotonicNow:()=>mono},
 });
 t.after(()=>{runtime.stop();store.close();});
 return {runtime,store,events,pending,advance(ms:number){wall+=ms;mono+=ms;},setMono(n:number){mono=n;},setWall(n:number){wall=n;},tick(){runtime.tick(wall);}};
}
function oneReady(world=createWorld()){
 for(const p of world.residents){p.lastDecisionAt=world.minute;p.decisionDue=world.minute+1000;}
 world.residents[0].decisionDue=world.minute;return world;
}
function ofType<T extends DecisionWaitEvent['type']>(events:DecisionWaitEvent[],type:T){return events.filter((e):e is Extract<DecisionWaitEvent,{type:T}>=>e.type===type);}

test('formal nine-person queue records actual readiness, request admission and accepted decisions separately',async t=>{
 const world=createFrontierWorld();for(const p of world.residents)p.lastDecisionAt=world.minute;
 const f=fixture(t,world);f.runtime.start();
 assert.equal(world.residents.length,9);
 assert.equal(ofType(f.events,'wait_started').filter(e=>e.actorKind==='resident').length,9);
 assert.equal(f.pending.length,2);assert.equal(ofType(f.events,'request_started').length,2);
 const first=f.pending[0];f.advance(2000);f.tick();first.resolve(result);await flush();
 const end=ofType(f.events,'wait_finished').find(e=>e.actorId===first.actorId)!;
 assert.equal(end.reason,'accepted');assert.equal(end.rightCensored,false);assert.equal(end.elapsedMs,2000);
 assert.ok(Math.abs(end.gameMinutes!-2.4)<1e-8);
 assert.equal(ofType(f.events,'request_finished')[0].outcome,'reply');
 assert.equal(ofType(f.events,'request_finished')[0].elapsedMs,2000,'do not reuse model-provided latency');
 assert.equal(f.pending.length,3,'exactly the newly freed slot is admitted');
 assert.equal(ofType(f.events,'wait_started').filter(e=>e.actorId===first.actorId).length,1,'chosen wait is not technical waiting');
 f.runtime.stop();
 assert.equal(ofType(f.events,'wait_finished').length,9);
 assert.equal(ofType(f.events,'wait_finished').filter(e=>e.reason==='stopped').length,8);
 assert.equal(ofType(f.events,'request_finished').filter(e=>e.outcome==='interrupted').length,2);
 assert.deepEqual(f.events.map(e=>e.sequence),f.events.map((_,i)=>i+1));
 assert.equal(f.runtime.decisionWaitEvidenceStatus()?.phase,'stopped');
});

test('paused world keeps game wait at zero while monotonic wall wait advances',async t=>{
 const f=fixture(t);f.runtime.start();const first=f.pending[0];
 f.advance(1750);f.tick();assert.equal(f.runtime.world.clock.paused,true);
 first.resolve(result);await flush();
 const end=ofType(f.events,'wait_finished').find(e=>e.actorId===first.actorId)!;
 assert.equal(end.elapsedMs,1750);assert.equal(end.gameMinutes,0);
});

test('explicit timeout and actual fallback remain in one wait episode',async t=>{
 const f=fixture(t,oneReady(),providers);f.runtime.start();
 const first=f.pending[0];f.advance(25_000);first.reject(new DOMException('PRIVATE_TIMEOUT_TEXT','TimeoutError'));await flush();
 const failure=ofType(f.events,'request_finished')[0];assert.equal(failure.outcome,'timeout');assert.equal(failure.elapsedMs,25_000);
 assert.equal(failure.code,'model_timeout_or_invalid_response');
 const retry=ofType(f.events,'retry_scheduled')[0];assert.equal(retry.delayMs,0);assert.equal(retry.fallbackModel,DEEPSEEK_MODEL);
 const calls=ofType(f.events,'request_started');assert.equal(calls.length,2);
 assert.equal(calls[1].route,'backup');assert.equal(calls[1].trigger,'fallback_pending');assert.equal(calls[1].waitId,calls[0].waitId);
 f.advance(3000);f.pending[1].resolve(result);await flush();
 const end=ofType(f.events,'wait_finished')[0];assert.equal(end.elapsedMs,28_000);assert.equal(end.reason,'accepted');
 assert.equal(ofType(f.events,'request_finished')[1].elapsedMs,3000);
 assert.equal(JSON.stringify(f.events).includes('PRIVATE_'),false);
});

test('generic error is not falsely labelled timeout and malformed feedback backoff is observed without storing text',async t=>{
 const f=fixture(t,oneReady());f.runtime.start();
 f.pending[0].reject(new Error('PRIVATE_ERROR'));await flush();
 assert.equal(ofType(f.events,'request_finished')[0].outcome,'failed');
 assert.equal(ofType(f.events,'retry_scheduled')[0].delayMs,30_000);
 f.advance(29_999);f.tick();assert.equal(f.pending.length,1);
 f.advance(1);f.tick();assert.equal(f.pending.length,2);
 f.pending[1].reject(new DecisionError('invalid_decision',{inputTokens:1,outputTokens:1,latencyMs:1},'PRIVATE_FEEDBACK'));await flush();
 assert.equal(ofType(f.events,'retry_scheduled').at(-1)?.delayMs,5000);
 assert.equal(ofType(f.events,'wait_started').length,1);assert.equal(ofType(f.events,'wait_finished').length,0);
 f.advance(5000);f.tick();f.pending[2].resolve(result);await flush();
 assert.equal(ofType(f.events,'wait_finished')[0].elapsedMs,35_000);
 assert.equal(JSON.stringify(f.events).includes('PRIVATE_'),false);
});

test('rate limited primary distinguishes pending fallback from other residents using blocked-primary backup',async t=>{
 const world=createWorld();const f=fixture(t,world,providers);f.runtime.start();
 f.pending[0].reject(new Error('model_http_429'));await flush();
 let cursor=1;
 for(let i=0;i<5;i++){const p=f.pending[cursor++];if(p)p.resolve(result);await flush();}
 const calls=ofType(f.events,'request_started');
 assert.ok(calls.some(e=>e.trigger==='fallback_pending'&&e.route==='backup'));
 assert.ok(calls.some(e=>e.trigger==='primary_blocked'&&e.route==='backup'));
 assert.equal(ofType(f.events,'request_finished')[0].code,'model_http_429');
});

test('budget deferral is observed waiting, never a fabricated model request or failure',t=>{
 const world=oneReady();world.metrics.usageWindow={[DEEPSEEK_MODEL]:[{startedAt:1_700_000_000_000,input:41_000,output:4000,finishedAt:1_700_000_000_000}]};
 const f=fixture(t,world,[providers[1]]);f.runtime.start();
 assert.equal(f.pending.length,0);assert.equal(ofType(f.events,'wait_started').length,1);
 assert.equal(ofType(f.events,'admission_deferred').length,1);assert.equal(ofType(f.events,'request_started').length,0);
 assert.equal(f.runtime.world.metrics.requests,0);assert.equal(f.runtime.world.metrics.failures,0);
 f.advance(60_001);f.tick();assert.equal(f.pending.length,1);
 assert.equal(ofType(f.events,'request_started')[0].route,'primary','sole configured backup provider is the runtime primary');
});

test('request preparation failure has no request-start event and preserves retry waiting',t=>{
 const world=oneReady();world.residents[0].traits=['界'.repeat(50_000)];
 const f=fixture(t,world);f.runtime.start();
 assert.equal(f.pending.length,0);assert.equal(ofType(f.events,'request_started').length,0);
 assert.equal(ofType(f.events,'preparation_failed')[0].code,'model_context_limit');
 assert.equal(ofType(f.events,'retry_scheduled')[0].delayMs,30_000);
 assert.equal(ofType(f.events,'wait_finished').length,0);
});

test('stale reply and invalid plan are not successful decisions; retries remain in the same wait',async t=>{
 const f=fixture(t,oneReady());f.runtime.start();
 f.runtime.world.residents[0].revision++;f.pending[0].resolve(result);await flush();
 assert.equal(ofType(f.events,'decision_rejected')[0].reason,'actor_changed');
 assert.equal(ofType(f.events,'wait_finished').length,0);
 assert.equal(f.pending.length,2);
 f.pending[1].resolve({...result,decision:{intention:'PRIVATE_PLAN',actions:[{type:'eat',item:'meal'}]}});await flush();
 assert.equal(ofType(f.events,'decision_rejected').at(-1)?.reason,'plan_invalid');
 assert.equal(ofType(f.events,'retry_scheduled').at(-1)?.delayMs,5000);
 assert.equal(ofType(f.events,'wait_finished').length,0);
 assert.equal(ofType(f.events,'wait_started').length,1);
});

test('eligibility loss censors a wait; late reply does not claim it ended in success',async t=>{
 const f=fixture(t,oneReady());f.runtime.start();const id=f.pending[0].actorId;
 f.advance(1000);f.runtime.world.residents[0].canExpress=false;f.tick();
 const end=ofType(f.events,'wait_finished')[0];assert.equal(end.actorId,id);assert.equal(end.reason,'no_longer_eligible');assert.equal(end.rightCensored,true);
 f.runtime.world.residents[0].revision++;f.pending[0].resolve(result);await flush();
 assert.equal(ofType(f.events,'wait_finished').length,1);
 assert.equal(ofType(f.events,'request_finished')[0].outcome,'reply');
});

test('stop closes open spans once and ignores late success or rejection',async t=>{
 const f=fixture(t);f.runtime.start();f.advance(500);f.runtime.stop();
 const count=f.events.length;f.runtime.stop();f.pending[0].resolve(result);f.pending[1].reject(new Error('late'));await flush();
 assert.equal(f.events.length,count);assert.equal(ofType(f.events,'session_stopped').length,1);
 assert.ok(ofType(f.events,'wait_finished').every(e=>e.rightCensored&&e.elapsedMs===500));
 assert.ok(ofType(f.events,'request_finished').every(e=>e.outcome==='interrupted'));
});

test('SQLite memory reload starts new evidence and cannot backfill prior wait or downtime',async t=>{
 const f=fixture(t,oneReady());f.runtime.start();f.advance(1000);f.runtime.stop();
 const oldSession=f.runtime.decisionWaitEvidenceStatus()!.sessionId;
 const saved=f.store.loadForRuntime()!;assert.equal(JSON.stringify(saved).includes('monotonicMs'),false);
 f.advance(200_000);
 const events:DecisionWaitEvent[]=[];
 const next=new ValleyRuntime(f.store,'test-key',()=>new Promise(()=>{}),{decisionWaitEvidence:{observe:e=>{events.push(e);},monotonicNow:()=>0}});
 try{
  next.start();assert.notEqual(next.decisionWaitEvidenceStatus()!.sessionId,oldSession);
  const start=ofType(events,'wait_started')[0];assert.equal(start.origin,'session_start');assert.equal(start.priorWaitMs,null);
  next.stop();assert.equal(ofType(events,'wait_finished')[0].elapsedMs,0,'only this observed session, never downtime');
 }finally{next.stop();}
});

test('clock rollback or missing clock produces unknown duration, never a false zero',t=>{
 const f=fixture(t,oneReady());f.runtime.start();f.setMono(99);f.tick();f.setMono(500);f.runtime.stop();
 assert.equal(ofType(f.events,'wait_finished')[0].elapsedMs,null);
 assert.equal(ofType(f.events,'request_finished')[0].elapsedMs,null);
 assert.equal(f.runtime.decisionWaitEvidenceStatus()?.monotonicClockValid,false);
 const events:DecisionWaitEvent[]=[];const evidence=new DecisionWaitEvidence({observe:e=>{events.push(e);},monotonicNow:()=>{throw new Error('clock unavailable');}});
 evidence.start(1);evidence.reconcile([{actorId:'a',actorKind:'resident'}],1,true);evidence.stop(2);
 assert.equal(ofType(events,'wait_finished')[0].elapsedMs,null);assert.equal(ofType(events,'wait_finished')[0].gameMinutes,1);
});

test('wall timestamp rollback does not corrupt monotonic elapsed duration',t=>{
 const f=fixture(t,oneReady());f.runtime.start();f.setWall(1_600_000_000_000);f.setMono(5100);f.runtime.stop();
 assert.equal(ofType(f.events,'wait_finished')[0].elapsedMs,5000);
 assert.ok(ofType(f.events,'wait_finished')[0].at.wallTimeMs!<ofType(f.events,'wait_started')[0].at.wallTimeMs!);
});

test('missing observer is unavailable; no-model observation is not a model request',t=>{
 const f=fixture(t,oneReady(),null);f.runtime.start();f.advance(300);f.tick();f.runtime.stop();
 assert.equal(ofType(f.events,'request_started').length,0);assert.equal(ofType(f.events,'wait_finished')[0].reason,'stopped');
 const store=new WorldStore(':memory:');const runtime=new ValleyRuntime(store,null);
 try{assert.equal(runtime.decisionWaitEvidenceStatus(),null);}finally{runtime.stop();store.close();}
});

test('throwing or asynchronous observers cannot become model failures or complete evidence',async t=>{
 for(const observe of [()=>{throw new Error('PRIVATE_SINK_ERROR');},async()=>{throw new Error('PRIVATE_ASYNC_ERROR');}]){
  const f=fixture(t,oneReady(),'test-key',observe);f.runtime.start();f.pending[0].resolve(result);await flush();
  assert.equal(f.runtime.world.metrics.successes,1);assert.equal(f.runtime.world.metrics.failures,0);
  assert.equal(f.runtime.decisionWaitEvidenceStatus()?.phase,'failed');
  assert.ok(['observer_threw','async_observer'].includes(f.runtime.decisionWaitEvidenceStatus()!.failure!));
  f.runtime.stop();
 }
});

test('event and timestamp are detached frozen records, without model context or private content',async t=>{
 const world=oneReady();world.residents[0].name='PRIVATE_NAME';world.residents[0].traits=['PRIVATE_TRAIT'];
 const f=fixture(t,world);f.runtime.start();f.pending[0].resolve(result);await flush();
 for(const event of f.events){assert.equal(Object.isFrozen(event),true);assert.equal(Object.isFrozen(event.at),true);}
 assert.equal(JSON.stringify(f.events).includes('PRIVATE_'),false);
 assert.throws(()=>{(f.events[0].at as {gameMinute:number}).gameMinute=99;},TypeError);
});

test('optional observation leaves formal world, store, model contexts and schedule identical',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network is forbidden');});
 const base=createFrontierWorld(),stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];
 for(const s of stores)s.commit(structuredClone(base),null);
 const calls:string[][]=[[],[]],contexts:unknown[][]=[[],[]],events:DecisionWaitEvent[]=[];
 const runtimes=stores.map((store,i)=>new ValleyRuntime(store,providers,async(_key,c,_feedback,model)=>{
  calls[i].push(c.actor.id+':'+model);contexts[i].push(structuredClone(c));return result;
 },{modelSlots:2,...(i?{decisionWaitEvidence:{observe:(e:DecisionWaitEvent)=>{events.push(e);},monotonicNow:()=>now}}:{})}));
 try{
  for(const r of runtimes)r.start();await flush();
  for(let n=0;n<3;n++){now+=1000;for(const r of runtimes)r.tick(now);await flush();}
  assert.deepEqual(calls[0],calls[1]);assert.deepEqual(contexts[0],contexts[1]);assert.deepEqual(runtimes[0].world,runtimes[1].world);
  assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
  for(let i=0;i<base.residents.length;i++)assert.deepEqual(decisionContext(runtimes[0].world,runtimes[0].world.residents[i]),decisionContext(runtimes[1].world,runtimes[1].world.residents[i]));
  assert.equal(events.some(e=>e.type==='wait_finished'&&e.reason==='accepted'),true);
 }finally{for(const r of runtimes)r.stop();for(const s of stores)s.close();}
});

test('late request tokens cannot close or reject a newer wait, another actor, or a new session',()=>{
 const events:DecisionWaitEvent[]=[];let now=0;
 const evidence=new DecisionWaitEvidence({observe:e=>{events.push(e);},monotonicNow:()=>now});
 const a={actorId:'a',actorKind:'resident' as const},b={actorId:'b',actorKind:'resident' as const};
 evidence.start(1);evidence.reconcile([a,b],1,true);
 const request=evidence.requestStarted('a',QWEN_MODEL,'primary','normal',1)!;
 now=1;evidence.reconcile([b],2);now=2;evidence.reconcile([a,b],3);
 evidence.requestFinished(request,'reply',null,3);
 evidence.accepted('a',3,request);evidence.rejected('a',request,'actor_changed',3);
 evidence.accepted('b',3,request);evidence.rejected('b',request,'actor_changed',3);
 assert.equal(evidence.status().openWaits,2);
 assert.equal(ofType(events,'decision_rejected').length,0);
 assert.equal(ofType(events,'wait_finished').length,1);
 const oldSession=evidence.status().sessionId;evidence.stop(3);evidence.start(4);evidence.reconcile([a],4,true);
 evidence.accepted('a',4,request);evidence.rejected('a',request,'actor_changed',4);evidence.requestFinished(request,'reply',null,4);
 assert.notEqual(evidence.status().sessionId,oldSession);assert.equal(evidence.status().openWaits,1);
 assert.equal(ofType(events,'request_finished').length,1);evidence.stop(4);
});

test('an observer that fails after some events leaves a failed incomplete session',async t=>{
 let count=0;const delivered:DecisionWaitEvent[]=[];
 const f=fixture(t,oneReady(),'test-key',e=>{if(++count===4)throw new Error('sink full');delivered.push(e);});
 f.runtime.start();f.advance(10);f.pending[0].resolve(result);await flush();f.runtime.stop();
 assert.equal(f.runtime.world.metrics.successes,1);assert.equal(f.runtime.world.metrics.failures,0);
 assert.equal(f.runtime.decisionWaitEvidenceStatus()?.phase,'failed');
 assert.equal(ofType(delivered,'session_stopped').length,0);
 assert.equal(ofType(delivered,'wait_finished').length,0,'incomplete evidence must not synthesize a successful zero-length wait');
});

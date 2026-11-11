import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {createWorld} from '../src/world/seed.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import type {ModelResult} from '../src/server/decisions.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const reply:ModelResult={decision:{intention:'合成停留',actions:[{type:'wait',minutes:15}]},inputTokens:11,outputTokens:7,latencyMs:1};

test('independent review: reentrant subscriber tick cannot resurrect terminal request before stop',async t=>{
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 const store=new WorldStore(':memory:'),world=createWorld();
 for(const actor of world.residents.slice(2))actor.decisionDue=world.minute+1000;
 store.commit(world,null);
 const pending=new Map<string,(result:ModelResult)=>void>();
 const runtime=new ValleyRuntime(store,'SYNTHETIC-NOT-A-CREDENTIAL',(_key,context)=>new Promise(resolve=>pending.set(context.actor.id,resolve)),{modelSlots:2});
 try{
  runtime.start();assert.equal(pending.size,2);
  const [finished,unfinished]=[...pending.keys()];let observed=false;const snapshots:string[][]=[];
  runtime.subscribe(()=>{
   if(observed||runtime.world.metrics.successes!==1)return;observed=true;
   snapshots.push(store.loadForRuntime()!.metrics.inFlight);
   runtime.tick(Date.now()+1000);
   snapshots.push(store.loadForRuntime()!.metrics.inFlight);
   runtime.stop();
  });
  pending.get(finished)!(reply);await flush();
  assert.equal(observed,true);assert.deepEqual(snapshots,[[unfinished],[unfinished]]);assert.equal(runtime.world.metrics.successes,1);
  assert.equal(runtime.world.metrics.failures,1);assert.equal(runtime.world.metrics.unmeteredFailures,1);
  assert.deepEqual(store.loadForRuntime()!.metrics.inFlight,[]);
  pending.get(unfinished)!(reply);await flush();
  assert.equal(runtime.world.metrics.successes,1);
  const restarted=new ValleyRuntime(store,null);
  assert.equal(restarted.world.metrics.failures,1);assert.equal(restarted.world.metrics.unmeteredFailures,1);restarted.stop();
 }finally{runtime.stop();store.close();}
});

test('independent review: post-commit subscriber exception is not a second model outcome',async t=>{
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 const store=new WorldStore(':memory:'),world=createWorld();
 for(const actor of world.residents.slice(1))actor.decisionDue=world.minute+1000;
 store.commit(world,null);
 const runtime=new ValleyRuntime(store,'SYNTHETIC-NOT-A-CREDENTIAL',async()=>({...reply,acceptanceCostUsd:0}),{modelSlots:1,
  acceptanceStop:{endGameMinute:world.minute+60,maxWallMs:5000,maxRequests:5,allowedModels:[GLM_MODEL],
   assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:performance.now()+5000})}});
 let observed=false;
 runtime.subscribe(()=>{if(!observed&&runtime.world.metrics.successes===1){observed=true;throw new Error('synthetic_subscriber_failure');}});
 try{
  runtime.start();await flush();
  assert.equal(observed,true);assert.equal(runtime.acceptanceStopStatus()?.reason,'runtime_failed');assert.equal(runtime.world.metrics.successes,1);
  assert.equal(runtime.world.metrics.failures,0);assert.equal(runtime.world.metrics.unmeteredFailures??0,0);
  assert.equal(runtime.world.metrics.inputTokens,11);assert.equal(runtime.world.metrics.outputTokens,7);
  assert.deepEqual(store.loadForRuntime()!.metrics.inFlight,[]);
  runtime.stop();const restarted=new ValleyRuntime(store,null);
  assert.equal(restarted.world.metrics.failures,0);assert.equal(restarted.world.metrics.unmeteredFailures??0,0);restarted.stop();
 }finally{runtime.stop();store.close();}
});

test('independent review: one rejected SQLite result write followed by durable unknown accounting settles only once',async t=>{
 const store=new WorldStore(':memory:');
 const {QWEN_MODEL}=await import('../src/server/model-completion.js');
 const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'SYNTHETIC-NOT-A-CREDENTIAL'}],async()=>reply,{modelSlots:1});
 const internals=runtime as unknown as {providers:unknown[];decide:(id:string,provider:unknown)=>Promise<void>;schedule:()=>void};
 t.mock.method(internals,'schedule',()=>{});
 const db=(store as unknown as {db:import('node:sqlite').DatabaseSync}).db;
 const commit=store.commit.bind(store);let failed=false;
 t.mock.method(store,'commit',(...args:Parameters<WorldStore['commit']>)=>{
  if(!failed&&args[0].metrics.successes===1){
   failed=true;db.exec("CREATE TRIGGER reject_once BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'synthetic_one_write_failure'); END");
   try{return commit(...args);}finally{db.exec('DROP TRIGGER reject_once');}
  }
  return commit(...args);
 });
 try{
  await internals.decide(runtime.world.residents[0].id,internals.providers[0]);
  const saved=store.loadForRuntime()!;
  assert.equal(failed,true);assert.equal(saved.metrics.successes,0);assert.equal(saved.metrics.failures,1);
  assert.equal(saved.metrics.unmeteredFailures,1);assert.deepEqual(saved.metrics.inFlight,[]);
  assert.equal(saved.metrics.usageWindow?.[QWEN_MODEL]?.length,1);
  assert.equal(saved.metrics.usageWindow?.[QWEN_MODEL]?.[0].input,reply.inputTokens);
  runtime.stop();const restarted=new ValleyRuntime(store,null);
  assert.equal(restarted.world.metrics.failures,1);assert.equal(restarted.world.metrics.unmeteredFailures,1);restarted.stop();
 }finally{runtime.stop();store.close();}
});

test('independent review: reentrant third request start cannot repersist terminal first request',async t=>{
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 const store=new WorldStore(':memory:'),world=createWorld(),third=world.residents[2].id;
 for(const actor of world.residents.slice(2))actor.decisionDue=world.minute+1000;
 store.commit(world,null);
 const pending=new Map<string,(result:ModelResult)=>void>();
 const runtime=new ValleyRuntime(store,'SYNTHETIC-NOT-A-CREDENTIAL',(_key,context)=>new Promise(resolve=>pending.set(context.actor.id,resolve)),{modelSlots:3});
 try{
  runtime.start();assert.equal(pending.size,2);const [first,second]=[...pending.keys()];let observed=false;let persisted:string[]=[];
  runtime.subscribe(()=>{
   if(observed||runtime.world.metrics.successes!==1)return;observed=true;
   runtime.world.residents.find(actor=>actor.id===third)!.decisionDue=runtime.world.minute;
   runtime.tick(Date.now()+1000);
   persisted=store.loadForRuntime()!.metrics.inFlight;
   runtime.stop();
  });
  pending.get(first)!(reply);await flush();
  assert.equal(observed,true);assert.equal(pending.size,3);
  assert.deepEqual(new Set(persisted),new Set([second,third]));assert.equal(runtime.world.metrics.requests,3);
  assert.equal(runtime.world.metrics.successes,1);assert.equal(runtime.world.metrics.failures,2);
  assert.equal(runtime.world.metrics.unmeteredFailures,2);assert.deepEqual(store.loadForRuntime()!.metrics.inFlight,[]);
 }finally{runtime.stop();store.close();}
});

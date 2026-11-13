import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {createMvpWorld} from '../src/server/godot-mvp.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
const flush=()=>new Promise<void>(r=>setImmediate(r));
for(const kind of ['formal','mvp','self-hosted-mvp'] as const)test(`${kind}: quiet stop persists pause without failure and is idempotent`,async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{throw Error('network forbidden');});
 const dir=mkdtempSync(join(testTmpdir(),'quiet-stop-')),path=join(dir,'synthetic.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new WorldStore(path);store.commit(kind==='formal'?createFormalWorld():createMvpWorld(),null);
 const runtime=new ValleyRuntime(store,'fake-only',async()=>({decision:{intention:'合成等待',actions:[{type:'wait',minutes:100}]},inputTokens:1,outputTokens:1,latencyMs:1}),{selfHostedSafety:kind==='self-hosted-mvp'});
 try{
  runtime.start();await flush();await flush();runtime.tick(now+=1000);
  assert.equal(runtime.mvpObservation().model.requestCount,0);assert.equal(runtime.world.clock.paused,false);
  const before=structuredClone(runtime.world),metrics=structuredClone(runtime.world.metrics);
  runtime.stop();
  assert.equal(runtime.snapshot().world.clock.paused,true);assert.equal(runtime.mvpObservation().paused,true);
  assert.equal(runtime.selfHostedUnresolved(),false);assert.deepEqual(runtime.world.metrics,metrics);
  assert.equal(runtime.world.minute,before.minute);assert.equal(runtime.world.revision,before.revision+1);
  assert.deepEqual(store.loadForRuntime()!.clock,runtime.world.clock);
  const stopped=structuredClone(runtime.world);runtime.stop();runtime.tick(now+=10000);
  assert.deepEqual(runtime.world,stopped);
  if(kind==='self-hosted-mvp')assert.throws(()=>runtime.start(),/single_use/);
 }finally{runtime.stop();store.close();}
 const reopened=new WorldStore(path);
 try{
  const saved=reopened.loadForRuntime()!;assert.equal(saved.clock.paused,true);
  const restarted=new ValleyRuntime(reopened,null,async()=>{throw Error('must not dispatch');});
  try{restarted.start();restarted.tick(now+=10000);assert.equal(restarted.world.minute,saved.minute);assert.equal(restarted.mvpObservation().paused,true);assert.equal(restarted.world.metrics.failures,saved.metrics.failures);}finally{restarted.stop();}
 }finally{reopened.close();}
});
test('already paused ordinary runtime keeps diagnostics and revision on quiet stop',()=>{
 const store=new WorldStore(':memory:');const runtime=new ValleyRuntime(store,null);
 try{const before=structuredClone(runtime.world);runtime.stop();runtime.stop();assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime()!.clock,before.clock);}finally{store.close();}
});
test('quiet stop persistence failure is surfaced without publishing an uncommitted pause',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const store=new WorldStore(':memory:');store.commit(createMvpWorld(),null);
 const runtime=new ValleyRuntime(store,'fake-only',async()=>({decision:{intention:'合成等待',actions:[{type:'wait',minutes:100}]},inputTokens:1,outputTokens:1,latencyMs:1}),{selfHostedSafety:true});
 try{
  runtime.start();await flush();await flush();runtime.tick(Date.now()+1000);
  assert.equal(runtime.world.clock.paused,false);assert.equal(runtime.mvpObservation().model.requestCount,0);
  const before=structuredClone(runtime.world);let notifications=0;runtime.subscribe(()=>notifications++);
  t.mock.method(store,'commit',()=>{throw Error('synthetic_write_failed');});
  assert.throws(()=>runtime.stop(),/synthetic_write_failed/);
  assert.deepEqual(runtime.world,before);assert.equal(notifications,0);
  runtime.tick(Date.now()+10000);assert.deepEqual(runtime.world,before);
  assert.equal(store.loadForRuntime()!.clock.paused,false,'no durable pause claimed after a failed write');
  assert.throws(()=>runtime.start(),/single_use/);
 }finally{runtime.stop();store.close();}
});

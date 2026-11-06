import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {createWorld} from '../src/world/seed.js';
import {createObserverServer} from '../src/server/http.js';
import {ValleyRuntime} from '../src/server/runtime.js';

test('durable state and events commit together; stale writes do not replace current world',()=>{
 const store=new WorldStore(':memory:');const world=createWorld();store.commit(world,null);
 const revision=world.revision;world.minute+=10;world.revision++;store.commit(world,revision);
 assert.equal(store.load()!.minute,world.minute);
 world.minute+=200;assert.throws(()=>store.commit(world,revision),/stale_world_revision/);
 assert.notEqual(store.load()!.minute,world.minute);
 assert.equal(new Set(store.history(world.id,Infinity).map(e=>e.id)).size,store.history(world.id,Infinity).length);
 store.close();
});
test('offline model freezes all world time, restart never catches up wall time',()=>{
 const store=new WorldStore(':memory:');const runtime=new ValleyRuntime(store,null);
 const before=structuredClone(runtime.world);
 runtime.tick(Date.now()+3600_000);
 assert.equal(runtime.world.minute,before.minute);
 assert.equal(runtime.world.residents[0].hunger,before.residents[0].hunger);
 assert.equal(runtime.world.clock.paused,true);
 runtime.stop();store.close();
});
test('public server exposes observations only and rejects every write method',async()=>{
 const store=new WorldStore(':memory:');const runtime=new ValleyRuntime(store,null);
 const server=createObserverServer(runtime,store,process.cwd()+'/dist');
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}/ai-town/api`;
 try{
  const revision=runtime.world.revision;
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(`${base}/world`,{method,body:'{"minute":99999}'})).status,405);
  assert.equal((await fetch(`${base}/world`)).status,200);
  const data=await (await fetch(`${base}/world`)).text();assert.ok(!data.includes('siliconflow\":'));
  assert.equal(runtime.world.revision,revision);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));runtime.stop();store.close();}
});

test('conflicting event identity aborts the whole commit instead of rewriting history',()=>{
 const store=new WorldStore(':memory:');const w=createWorld();
 w.events.push({id:'fact-1',at:w.minute,kind:'action',actors:[],place:{x:0,y:0},text:'original',witnesses:[]});store.commit(w,null);
 const previous=w.revision;w.revision++;w.minute++;w.events[0].text='rewritten';
 assert.throws(()=>store.commit(w,previous),/event_id_conflict/);
 assert.equal(store.load()!.events[0].text,'original');assert.equal(store.load()!.revision,previous);store.close();
});

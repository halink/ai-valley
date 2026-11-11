import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createObserverServer} from '../src/server/http.js';

test('formal saves restore terrain, harvested resources, additions and removals together',()=>{
 const directory=mkdtempSync(join(testTmpdir(),'valley-restart-')),file=join(directory,'world.sqlite');
 let store=new WorldStore(file);
 try {
  const world=createFormalWorld();store.commit(world,null);
  const previous=world.revision;world.revision++;world.minute+=20;
  world.resources[5].amount=0;world.resources[5].lastHarvest=world.minute;
  world.resources.splice(8,1);
  world.resources.push({...world.resources[1],id:'additional-source',at:{x:15,y:22}});
  world.residents[0].inventory.wood=17;
  store.commit(world,previous);store.close();store=new WorldStore(file);
  assert.deepEqual(store.load(),world);
  assert.throws(()=>new ValleyRuntime(store,null,undefined,{mode:'validation'}),/world_mode_mismatch/);
  assert.deepEqual(store.load(),world);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('large world reconnect and live patches reconstruct the exact public snapshot',()=>{
 const store=new WorldStore(':memory:');
 try{
  const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'}),first=runtime.snapshot();
  const initial=observerFrame(first);
  assert.equal(initial.world.map,undefined);
  assert.deepEqual(applyObserverUpdate(first,initial),first);
  const next=structuredClone(first);
  next.world.minute+=3;next.world.revision++;
  next.world.residents[3].inventory.water=1;
  next.world.resources.splice(15,1);
  next.world.resources[9].amount=0;
  next.world.plots[12].crop={definition:'crop/turnip@1',planted:480,growth:0,wateredDay:0,lastGrowthDay:0};
  const delta=observerFrame(next,first);
  assert.ok(Buffer.byteLength(JSON.stringify(delta))<6000);
  assert.deepEqual(applyObserverUpdate(first,delta),next);
  assert.equal(applyObserverUpdate({...first,mapRevision:'older-map'},delta),null);
  assert.equal(applyObserverUpdate({...first,world:{...first.world,revision:first.world.revision-1}},delta),null);
  assert.deepEqual(applyObserverUpdate(first,observerFrame(next)),next);
 }finally{store.close();}
});

test('public world requests share serialization and the event feed only sends map-free updates',async t=>{
 const store=new WorldStore(':memory:');
 const runtime=new ValleyRuntime(store,'test-key',async()=>({decision:{intention:'稍作停留',actions:[{type:'wait',minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1}),{mode:'formal'});
 const snapshot=t.mock.method(runtime,'snapshot');
 const server=createObserverServer(runtime,store,join(process.cwd(),'dist'));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}/ai-town/api/`;
 let reader:ReadableStreamDefaultReader<string>|undefined;
 try{
  const head=await fetch(base+'world',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(snapshot.mock.callCount(),0);
  const uncompressed=await fetch(base+'world',{headers:{'Accept-Encoding':'gzip;q=0'}});
  assert.equal(uncompressed.headers.get('Content-Encoding'),null);
  const initial=await uncompressed.json();
  const compressed=await fetch(base+'world',{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(compressed.headers.get('Content-Encoding'),'gzip');
  assert.deepEqual(await compressed.json(),initial);assert.equal(snapshot.mock.callCount(),1);
  const events=await fetch(base+'events',{signal:AbortSignal.timeout(5000)});
  assert.equal(events.headers.get('Content-Type'),'text/event-stream');
  reader=events.body!.pipeThrough(new TextDecoderStream()).getReader();
  let pending='';
  const readUpdate=async()=>{
   while(!pending.includes('\n\n')){const packet=await reader!.read();assert.ok(!packet.done);pending+=packet.value;}
   const boundary=pending.indexOf('\n\n'),frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
   assert.ok(frame.startsWith('event: update\ndata: '));
   const update=JSON.parse(frame.slice('event: update\ndata: '.length));assert.equal(update.world.map,undefined);
   return update;
  };
  assert.deepEqual(applyObserverUpdate(initial,await readUpdate()),initial);
  runtime.tick();
  const delta=await readUpdate();assert.equal(delta.baseRevision,initial.world.revision);
  assert.ok(delta.world.revision>initial.world.revision);
 }finally{
  await reader?.cancel().catch(()=>{});
  runtime.stop();server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();
 }
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createObserverServer} from '../src/server/http.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';

test('the former formal prefix redirects to the single public valley and retains query parameters',async()=>{
 const store=new WorldStore(':memory:');
 const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 const server=createObserverServer(runtime,store,process.cwd()+'/dist');
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  const origin=`http://127.0.0.1:${address.port}`;
  for(const [from,to] of [
   ['/ai-town?view=wide','/ai-town/?view=wide'],
   ['/ai-town/formal','/ai-town/'],
   ['/ai-town/formal/','/ai-town/'],
   ['/ai-town/formal/api/history/page?limit=5','/ai-town/api/history/page?limit=5'],
  ]){
   const response=await fetch(origin+from,{redirect:'manual'});
   assert.equal(response.status,308);
   assert.equal(response.headers.get('location'),to);
  }
  const response=await fetch(origin+'/ai-town/formal/api/world');
  assert.equal(response.url,origin+'/ai-town/api/world');
  assert.equal((await response.json()).world.id,'valley-formal-frontier-5401');
  assert.equal((await fetch(origin+'/ai-town/formality')).status,404);
  assert.equal((await fetch(origin+'/ai-town/formal/api/world',{method:'POST'})).status,405);
 }finally{
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  runtime.stop();
  store.close();
 }
});

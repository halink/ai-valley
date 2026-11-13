import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMvpSession,createMvpServer} from '../src/server/godot-mvp.js';
test('browser demo serves allowlisted exports and world at one origin without secrets or CORS',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'valley-web-')),root=join(dir,'export');mkdirSync(root);writeFileSync(join(root,'.ready'),'fixture');
 writeFileSync(join(root,'index.html'),'<html>synthetic export fixture</html>');
 writeFileSync(join(root,'index.wasm'),Buffer.from([0,97,115,109]));
 writeFileSync(join(dir,'.env'),'not-a-real-secret');
 symlinkSync(join(dir,'.env'),join(root,'index.pck'));
 const session=createMvpSession(),server=createMvpServer(session,{webRoot:root});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
 try{
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/synthetic export/);
  const wasm=await fetch(base+'/index.wasm');assert.equal(wasm.headers.get('Content-Type'),'application/wasm');
  const head=await fetch(base,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const path of ['/index.pck','/.env','/%2e%2e/.env','/package.json','/index.js','/index.html/extra'])assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base,{method:'POST'})).status,405);
  const api=await fetch(base+'/ai-town/api/world');assert.equal(api.status,200);assert.equal(api.headers.get('Access-Control-Allow-Origin'),null);
  const data=await api.json();assert.equal(data.mvp.driver,'local-rules');assert.equal(data.world.metrics.requests,0);
  unlinkSync(join(root,'.ready'));assert.equal((await fetch(base)).status,404,'failed rebuild marker blocks existing server');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
});

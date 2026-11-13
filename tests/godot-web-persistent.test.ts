import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startPersistentMvp} from '../src/server/godot-mvp-persistent.js';
import {DEEPSEEK_MODEL} from '../src/server/model-completion.js';
function fixture(t:any){
 const dir=mkdtempSync(join(testTmpdir(),'web-persistent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const webRoot=join(dir,'web');mkdirSync(webRoot);
 for(const f of ['.ready','index.html','index.js','index.wasm','index.pck'])writeFileSync(join(webRoot,f),'synthetic-export');
 return {dir,webRoot,database:join(dir,'save','world.sqlite'),port:0,env:{}};
}
test('persistent browser serves same-origin files and paused saved world without model dispatch',async t=>{
 const options=fixture(t);let calls=0;
 const run=await startPersistentMvp({...options,model:async()=>{calls++;throw Error('unexpected');}});
 const address=run.server.address();assert.ok(address&&typeof address!=='string');assert.equal(address.address,'127.0.0.1');
 const base=`http://127.0.0.1:${address.port}`;
 let id:string;
 try{
  for(const [path,mime] of [['/','text/html; charset=utf-8'],['/index.js','text/javascript; charset=utf-8'],['/index.wasm','application/wasm'],['/index.pck','application/octet-stream']]){
   const res=await fetch(base+path);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),mime);assert.equal(res.headers.get('access-control-allow-origin'),null);
  }
  const head=await fetch(base,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const path of ['/.env','/world.sqlite','/world.sqlite.self-hosted-session','/package.json','/%2e%2e/.env','/index.html/extra'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base,{method:'POST'})).status,405);
  const data=await(await fetch(base+'/ai-town/api/world')).json();id=data.world.id;assert.equal(data.mvp.driver,'disabled');assert.equal(data.mvp.ephemeral,false);assert.equal(data.world.clock.paused,true);
  unlinkSync(join(options.webRoot,'index.pck'));symlinkSync(join(options.dir,'private'),join(options.webRoot,'index.pck'));writeFileSync(join(options.dir,'private'),'synthetic-secret');
  assert.equal((await fetch(base+'/index.pck')).status,404);
  unlinkSync(join(options.webRoot,'.ready'));assert.equal((await fetch(base)).status,404);
  assert.equal((await fetch(base+'/ai-town/api/world')).status,200);
 }finally{await run.close();}
 writeFileSync(join(options.webRoot,'.ready'),'fixture');unlinkSync(join(options.webRoot,'index.pck'));writeFileSync(join(options.webRoot,'index.pck'),'fixture');
 const restored=await startPersistentMvp({...options,model:async()=>{calls++;throw Error('unexpected');}});
 try{assert.equal(restored.snapshot().world.id,id!);assert.equal(restored.snapshot().mvp.driver,'disabled');assert.equal(calls,0);}finally{await restored.close();}
});
test('invalid Web exports fail before database creation or model dispatch, even when models configured',async t=>{
 const options=fixture(t);let calls=0;
 const env={VALLEY_SELF_HOSTED:'enabled',VALLEY_PRIMARY_PROVIDER:'siliconflow',VALLEY_PRIMARY_MODEL:DEEPSEEK_MODEL,SILICONFLOW_API_KEY:'fake-only'};
 for(const file of ['.ready','index.html','index.js','index.wasm','index.pck']){
  unlinkSync(join(options.webRoot,file));
  await assert.rejects(startPersistentMvp({...options,env,model:async()=>{calls++;throw Error('unexpected');}}));
  assert.equal(existsSync(join(options.dir,'save')),false);assert.equal(calls,0);
  writeFileSync(join(options.webRoot,file),'fixture');
 }
 writeFileSync(join(options.webRoot,'index.wasm'),'');
 await assert.rejects(startPersistentMvp({...options,env}),/godot_web_export_invalid/);assert.equal(existsSync(join(options.dir,'save')),false);
});
test('Web startup rejects symlink exports and empty ready markers without creating saves',async t=>{
 const options=fixture(t);writeFileSync(join(options.webRoot,'.ready'),'');
 await assert.rejects(startPersistentMvp(options),/godot_web_export_invalid/);
 writeFileSync(join(options.webRoot,'.ready'),'fixture');unlinkSync(join(options.webRoot,'index.pck'));
 writeFileSync(join(options.dir,'outside'),'fixture');symlinkSync(join(options.dir,'outside'),join(options.webRoot,'index.pck'));
 await assert.rejects(startPersistentMvp(options),/godot_web_export_invalid/);assert.equal(existsSync(join(options.dir,'save')),false);
});
test('synthetic model Web integration exposes accepted real action and preserves it on restart',async t=>{
 const options=fixture(t),env={VALLEY_SELF_HOSTED:'enabled',VALLEY_PRIMARY_PROVIDER:'siliconflow',VALLEY_PRIMARY_MODEL:DEEPSEEK_MODEL,SILICONFLOW_API_KEY:'fake-only'};
 let calls=0;const run=await startPersistentMvp({...options,env,model:async()=>{calls++;return {decision:{intention:'合成采集',actions:[{type:'gather',resourceId:'mvp-berry-0',quantity:1}]},inputTokens:1,outputTokens:1,latencyMs:1};}});
 const addr=run.server.address();assert.ok(addr&&typeof addr!=='string');
 let id:string,residents:unknown;
 try{
  await new Promise<void>(r=>setImmediate(r));await new Promise<void>(r=>setImmediate(r));
  const res=await fetch(`http://127.0.0.1:${addr.port}/ai-town/api/world`),snapshot=await res.json();
  assert.equal(snapshot.mvp.driver,'model');assert.equal(snapshot.mvp.ephemeral,false);assert.ok(calls>0);assert.ok(run.runtime.world.residents.some(r=>r.plan||r.activity));
  assert.ok(!JSON.stringify(snapshot).includes('fake-only'));id=run.runtime.world.id;residents=structuredClone(run.runtime.world.residents);
 }finally{await run.close();}
 const restored=await startPersistentMvp(options);
 try{assert.equal(restored.runtime.world.id,id!);assert.deepEqual(restored.runtime.world.residents,residents);assert.equal(restored.snapshot().mvp.driver,'disabled');}finally{await restored.close();}
});

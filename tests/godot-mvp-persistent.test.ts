import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startPersistentMvp} from '../src/server/godot-mvp-persistent.js';
import {DEEPSEEK_MODEL,GLM_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import {createWorld} from '../src/world/seed.js';
const env={VALLEY_SELF_HOSTED:'enabled',VALLEY_PRIMARY_PROVIDER:'siliconflow',VALLEY_PRIMARY_MODEL:DEEPSEEK_MODEL,VALLEY_BACKUP_PROVIDER:'siliconflow',VALLEY_BACKUP_MODEL:GLM_MODEL,SILICONFLOW_API_KEY:'fake-only'};
const wait={decision:{intention:'合成等待',actions:[{type:'wait' as const,minutes:15}]},inputTokens:10,outputTokens:5,latencyMs:1};
const flush=()=>new Promise<void>(r=>setImmediate(r));
function fixture(t:any){const dir=mkdtempSync(join(testTmpdir(),'godot-persistent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {port:0,database:join(dir,'mvp.sqlite'),env:{}};}

test('default persistent MVP sends no model calls and preserves identity and world state on restart',async t=>{
 const options=fixture(t);let calls=0;
 const run=await startPersistentMvp({...options,model:async()=>{calls++;return wait;}});
 const w=structuredClone(run.runtime.world);
 assert.equal(run.snapshot().mvp.driver,'disabled');assert.equal(run.snapshot().mvp.ephemeral,false);assert.equal(w.clock.paused,true);
 await run.close();
 const next=await startPersistentMvp({...options,model:async()=>{calls++;return wait;}});
 assert.equal(next.runtime.world.id,w.id);assert.equal(next.runtime.world.minute,w.minute);
 assert.deepEqual(next.runtime.world.residents,w.residents);assert.deepEqual(next.runtime.world.resources,w.resources);
 assert.equal(calls,0);await next.close();
});
test('explicit fake model chooses real gather action; accepted plan survives a clean restart',async t=>{
 const options=fixture(t);let calls=0;
 const run=await startPersistentMvp({...options,env,model:async()=>{calls++;return {...wait,decision:{intention:'合成采集',actions:[{type:'gather',resourceId:'mvp-berry-0',quantity:1}]}};}});
 await flush();await flush();
 assert.ok(calls>0);assert.equal(run.snapshot().mvp.driver,'model');
 assert.ok(run.runtime.world.residents.some(r=>r.plan||r.activity));
 const residents=structuredClone(run.runtime.world.residents),id=run.runtime.world.id;
 assert.ok(!JSON.stringify(run.snapshot()).includes('fake-only'));
 await run.close();
 const next=await startPersistentMvp({...options,model:async()=>{throw Error('must not call');}});
 assert.equal(next.runtime.world.id,id);assert.deepEqual(next.runtime.world.residents,residents);await next.close();
});
test('429 can select only explicit backup and its cooldown survives restart',async t=>{
 const options=fixture(t),calls:string[]=[];
 const run=await startPersistentMvp({...options,env,model:async(_k,_c,_f,m)=>{calls.push(m!);if(m===DEEPSEEK_MODEL)throw Error('model_http_429');return wait;}});
 await flush();await flush();assert.equal(calls[0],DEEPSEEK_MODEL);assert.ok(calls.includes(GLM_MODEL));
 const cooldown=structuredClone(run.runtime.world.metrics.selfHostedCooldowns);await run.close();
 const next=await startPersistentMvp(options);assert.deepEqual(next.runtime.world.metrics.selfHostedCooldowns,cooldown);await next.close();
});
test('unknown response blocks restart without another dispatch',async t=>{
 const options=fixture(t);let calls=0;
 const run=await startPersistentMvp({...options,env,model:async()=>{calls++;throw Error('fake-private-token');}});
 await flush();assert.equal(run.runtime.world.clock.paused,true);assert.ok(!JSON.stringify(run.snapshot()).includes('fake-private-token'));
 await run.close();assert.equal(existsSync(options.database+'.self-hosted-session'),true);
 await assert.rejects(startPersistentMvp(options),/godot_mvp_unresolved_session/);assert.equal(calls,1);
});
test('another world is rejected without changing its saved state; concurrent startup is rejected',async t=>{
 const options=fixture(t);const store=new WorldStore(options.database),old=createWorld();store.commit(old,null);store.close();
 const bytes=readFileSync(options.database);
 await assert.rejects(startPersistentMvp(options),/godot_mvp_save_mismatch/);
 assert.deepEqual(readFileSync(options.database),bytes,'rejecting another world must not migrate or rewrite it');
 const check=new WorldStore(options.database);assert.deepEqual(check.load(),old);check.close();
 const second=fixture(t);const run=await startPersistentMvp(second);
 await assert.rejects(startPersistentMvp(second),/runtime_already_owned/);await run.close();
});
test('interrupted dispatch keeps guard; a late synthetic response cannot mutate persisted state',async t=>{
 const options=fixture(t);let finish!:(v:typeof wait)=>void;
 const run=await startPersistentMvp({...options,env,model:()=>new Promise(resolve=>finish=resolve)});
 await flush();const id=run.runtime.world.id,successes=run.runtime.world.metrics.successes;
 await run.close();finish(wait);await flush();
 assert.equal(run.runtime.world.metrics.successes,successes);
 await assert.rejects(startPersistentMvp(options),/godot_mvp_unresolved_session/);
 const saved=new WorldStore(options.database);assert.equal(saved.load()!.id,id);assert.equal(saved.load()!.metrics.successes,successes);saved.close();
});
test('invalid enabled configuration rejects before creating a database',async t=>{
 const options=fixture(t);
 await assert.rejects(startPersistentMvp({...options,env:{VALLEY_SELF_HOSTED:'enabled'}}),/self_hosted_primary_required/);
 assert.equal(existsSync(options.database),false);
});
test('mocked HTTP completion codec chooses a real action and real engine completes gathering',async t=>{
 const {callModel}=await import('../src/server/decisions.js');
 const options=fixture(t);let reply='',requests=0,now=Date.now();
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  requests++;assert.equal(url,'https://api.siliconflow.cn/v1/chat/completions');assert.equal(init?.redirect,'error');
  assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer fake-only');
  return new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}));
 });
 const run=await startPersistentMvp({...options,env,model:async(...args)=>{
  const choices=args[4]!.choices;
  const choice=choices.find(c=>c.action.type==='gather')??choices.find(c=>c.action.type==='wait')!;
  assert.ok(choice);reply=JSON.stringify(choice.action.type==='wait'?{choice:choice.id,minutes:15}:{choice:choice.id});
  return callModel(...args);
 }});
 try{
  await flush();await flush();assert.ok(requests>0);
  const initial=run.runtime.world.resources.filter(r=>r.kind==='bush').reduce((n,r)=>n+r.amount,0);
  for(let i=0;i<100;i++){now+=1000;run.runtime.tick();await flush();if(run.runtime.world.events.some(e=>e.text.includes('采集')))break;}
  assert.ok(run.runtime.world.events.some(e=>e.text.includes('采集')));
  assert.ok(run.runtime.world.resources.filter(r=>r.kind==='bush').reduce((n,r)=>n+r.amount,0)<initial);
  assert.ok(run.runtime.world.residents.some(r=>(r.inventory.berry??0)>0));
  assert.ok(!JSON.stringify(run.snapshot()).includes('fake-only'));
  const completed=structuredClone(run.runtime.world);
  await run.close();
  const restored=await startPersistentMvp(options);
  try{
   assert.equal(restored.runtime.world.id,completed.id);
   assert.equal(restored.runtime.world.minute,completed.minute);
   assert.deepEqual(restored.runtime.world.resources,completed.resources);
   assert.deepEqual(restored.runtime.world.residents,completed.residents);
   assert.deepEqual(restored.runtime.world.events,completed.events);
  }finally{await restored.close();}
 }finally{await run.close();}
});
test('failed store close holds ownership and can be retried',async t=>{
 const options=fixture(t),run=await startPersistentMvp(options);
 const original=WorldStore.prototype.close;let failed=false;
 t.mock.method(WorldStore.prototype,'close',function(this:WorldStore){if(!failed){failed=true;throw Error('synthetic_close_failure');}return original.call(this);});
 await assert.rejects(run.close(),/godot_mvp_store_close_failed/);
 await assert.rejects(startPersistentMvp(options),/runtime_already_owned/);
 await run.close();
 const next=await startPersistentMvp(options);await next.close();
});
test('marker unlink failure releases closed-store ownership without removing its guard',async t=>{
 const fs=(await import('node:fs')).default;
 const options=fixture(t),run=await startPersistentMvp({...options,env,model:async()=>wait});await flush();
 const original=fs.unlinkSync;
 const mock=t.mock.method(fs,'unlinkSync',((path:any)=>{if(String(path).endsWith('.self-hosted-session'))throw Error('synthetic_unlink_failure');return original(path);}) as typeof fs.unlinkSync);
 await assert.rejects(run.close(),(error:unknown)=>error instanceof AggregateError&&error.errors.some(e=>e.message==='synthetic_unlink_failure'));mock.mock.restore();
 assert.equal(existsSync(options.database+'.self-hosted-session'),true);
 await assert.rejects(startPersistentMvp(options),/godot_mvp_unresolved_session/);
 await run.close(); // Cannot touch the guard after ownership was released.
 assert.equal(existsSync(options.database+'.self-hosted-session'),true);
});
test('marker directory fsync failure restores a guard and releases ownership',async t=>{
 const fs=(await import('node:fs')).default;
 const options=fixture(t),run=await startPersistentMvp({...options,env,model:async()=>wait});await flush();
 const original=fs.fsyncSync;let failed=false;
 const mock=t.mock.method(fs,'fsyncSync',((fd:number)=>{if(!failed){failed=true;throw Error('synthetic_directory_sync_failure');}return original(fd);}) as typeof fs.fsyncSync);
 await assert.rejects(run.close(),(error:unknown)=>error instanceof AggregateError&&error.errors.some(e=>e.message==='synthetic_directory_sync_failure'));mock.mock.restore();
 assert.equal(existsSync(options.database+'.self-hosted-session'),true);
 await assert.rejects(startPersistentMvp(options),/godot_mvp_unresolved_session/);
});
test('modified session marker is never deleted by shutdown',async t=>{
 const fs=(await import('node:fs')).default;
 const options=fixture(t),run=await startPersistentMvp({...options,env,model:async()=>wait});await flush();
 fs.writeFileSync(options.database+'.self-hosted-session','unknown content');
 await assert.rejects(run.close(),(error:unknown)=>error instanceof AggregateError&&error.errors.some(e=>e.message==='godot_mvp_marker_changed'));
 assert.equal(readFileSync(options.database+'.self-hosted-session','utf8'),'unknown content');
 await assert.rejects(startPersistentMvp(options),/godot_mvp_unresolved_session/);
});
test('started movement retains path and remaining work across clean restart',async t=>{
 const options=fixture(t);let now=Date.now();t.mock.method(Date,'now',()=>now);
 const run=await startPersistentMvp({...options,env,model:async()=>({...wait,decision:{intention:'synthetic gather',actions:[{type:'gather',resourceId:'mvp-berry-0',quantity:2}]}})});
 await flush();await flush();now+=1000;run.runtime.tick();await flush();
 const before=structuredClone(run.runtime.world);
 assert.ok(before.residents.some(r=>r.activity&&r.activity.path.length>0&&r.activity.remaining>0));
 await run.close();
 const next=await startPersistentMvp(options);
 assert.deepEqual(next.runtime.world.residents,before.residents);
 assert.deepEqual(next.runtime.world.resources,before.resources);
 assert.equal(next.runtime.world.minute,before.minute);await next.close();
});

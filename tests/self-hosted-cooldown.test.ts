import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startSelfHostedServer} from '../src/server/self-hosted-startup.js';
import {GLM_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {readSelfHostedCooldowns,cooldownDelay} from '../src/server/self-hosted-cooldown.js';
const flush=()=>new Promise<void>(r=>setImmediate(r));
function fixture(t:any){const root=mkdtempSync(join(testTmpdir(),'cooldown-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {port:0,root,database:join(root,'test.sqlite'),dayMinutes:20,env:{VALLEY_SELF_HOSTED:'enabled',VALLEY_PRIMARY_MODEL:GLM_MODEL,SILICONFLOW_API_KEY:'fake-only'}};}
test('429 survives real close/reopen, expires normally, increases backoff across starts and caps at 15 minutes',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const options=fixture(t);let calls=0;
 const model=async()=>{calls++;throw Error('model_http_429');};
 for(let attempt=1;attempt<=8;attempt++){
  const run=await startSelfHostedServer({...options,model});await flush();assert.equal(calls,attempt);
  const record=run.runtime.world.metrics.selfHostedCooldowns![GLM_MODEL];assert.equal(record.limitCount,Math.min(attempt,6));assert.equal(record.blockedUntil-now,cooldownDelay(Math.min(attempt,6)));
  await run.close();
  const early=await startSelfHostedServer({...options,model});await flush();assert.equal(calls,attempt);await early.close();
  now=record.blockedUntil-1;
  const edge=await startSelfHostedServer({...options,model});await flush();assert.equal(calls,attempt);await edge.close();
  now++;
 }
});
test('primary and backup cooldowns both survive restart, then only expired provider resumes',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const options=fixture(t),calls:string[]=[];
 const settings={...options,env:{...options.env,VALLEY_BACKUP_MODEL:DEEPSEEK_MODEL},model:async(_k:string,_c:unknown,_f:unknown,model?:string)=>{calls.push(model!);now+=1000;throw Error('model_http_429');}};
 const run=await startSelfHostedServer(settings);await flush();assert.deepEqual(calls,[GLM_MODEL,DEEPSEEK_MODEL]);
 const records=run.runtime.world.metrics.selfHostedCooldowns!;await run.close();
 const next=await startSelfHostedServer(settings);await flush();assert.equal(calls.length,2);await next.close();
 now=records[GLM_MODEL].blockedUntil;
 const expired=await startSelfHostedServer(settings);await flush();assert.equal(calls[2],GLM_MODEL);await expired.close();
});
test('rollback and malformed persisted state fail closed; active rollback retains unresolved state',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const options=fixture(t);let calls=0;
 const model=async()=>{calls++;throw Error('model_http_429');};
 const run=await startSelfHostedServer({...options,model});await flush();await run.close();now--;
 await assert.rejects(startSelfHostedServer({...options,model}),/self_hosted_clock_rollback/);assert.equal(calls,1);
 assert.throws(()=>readSelfHostedCooldowns({[GLM_MODEL]:{observedAt:now,blockedUntil:now+1,limitCount:1}},now),/cooldown_invalid/);
 assert.throws(()=>readSelfHostedCooldowns({},NaN),/clock_invalid/);
 const other=fixture(t);const live=await startSelfHostedServer({...other,model});await flush();now--;live.runtime.tick();assert.equal(live.runtime.selfHostedUnresolved(),true);await live.close();
});
test('a separate process persists 429 before clean exit or SIGKILL; restart never bypasses cooldown',async t=>{
 const {spawn}=await import('node:child_process'),{writeFileSync}=await import('node:fs'),{fileURLToPath}=await import('node:url');
 const module=fileURLToPath(new URL('../src/server/self-hosted-startup.ts',import.meta.url));
 const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
 for(const crash of [false,true]){
  const options=fixture(t),script=join(options.root,'429.mjs');
  writeFileSync(script,`import {startSelfHostedServer} from ${JSON.stringify(module)};const run=await startSelfHostedServer({...${JSON.stringify(options)},model:async()=>{throw Error('model_http_429')}});await new Promise(r=>setImmediate(r));${crash?"console.log('ready');":"await run.close();console.log('ready');"}`);
  const child=spawn(process.execPath,['--import',loader,script],{env:{PATH:process.env.PATH,HOME:options.root},stdio:['ignore','pipe','pipe']});
  const done=new Promise(resolve=>child.once('exit',resolve));t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_start_timeout')),10000);child.stdout.on('data',data=>{if(String(data).includes('ready')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});});
  if(crash)child.kill('SIGKILL');await done;let calls=0;
  const start=()=>startSelfHostedServer({...options,model:async()=>{calls++;throw Error('model_http_429');}});
  if(crash)await assert.rejects(start(),/self_hosted_unresolved_session/);
  else{const restarted=await start();await flush();assert.ok(restarted.runtime.world.metrics.selfHostedCooldowns?.[GLM_MODEL]);await restarted.close();}
  assert.equal(calls,0);
 }
});
test('successful response after expiry clears only that model consecutive cooldown',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const options=fixture(t);
 const first=await startSelfHostedServer({...options,model:async()=>{throw Error('model_http_429');}});await flush();const deadline=first.runtime.world.metrics.selfHostedCooldowns![GLM_MODEL].blockedUntil;await first.close();
 now=deadline;
 const next=await startSelfHostedServer({...options,model:async()=>({decision:{intention:'等待',actions:[{type:'wait' as const,minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:1})});await flush();assert.ok(next.runtime.world.metrics.successes>0);assert.equal(next.runtime.world.metrics.selfHostedCooldowns?.[GLM_MODEL],undefined);await next.close();
});

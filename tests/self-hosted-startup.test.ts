import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {startSelfHostedServer} from '../src/server/self-hosted-startup.js';
import {DEEPSEEK_MODEL,GLM_MODEL} from '../src/server/model-completion.js';
const env={VALLEY_SELF_HOSTED:'enabled',VALLEY_PRIMARY_PROVIDER:'siliconflow',VALLEY_PRIMARY_MODEL:DEEPSEEK_MODEL,VALLEY_BACKUP_PROVIDER:'siliconflow',VALLEY_BACKUP_MODEL:GLM_MODEL,SILICONFLOW_API_KEY:'fake-only'};
const result={decision:{intention:'等待',actions:[{type:'wait' as const,minutes:15}]},inputTokens:10,outputTokens:5,latencyMs:1};
const flush=()=>new Promise<void>(r=>setImmediate(r));
function fixture(t:any){const root=mkdtempSync(join(testTmpdir(),'self-hosted-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {port:0,root,database:join(root,'test.sqlite'),dayMinutes:20,env};}
test('configured primary/backup run offline; 429 switches only to explicit backup, clean restart succeeds',async t=>{
 const options=fixture(t),calls:string[]=[];
 const run=await startSelfHostedServer({...options,model:async(_key,_ctx,_feedback,model)=>{calls.push(model!);if(calls.length===1)throw Error('model_http_429');return result;}});
 await flush();assert.equal(calls[0],DEEPSEEK_MODEL);assert.ok(calls.includes(GLM_MODEL));
 assert.equal(run.runtime.world.metrics.routing?.primary,DEEPSEEK_MODEL);
 assert.equal(run.runtime.world.metrics.routing?.backup,GLM_MODEL);
 await run.close();assert.equal(existsSync(options.database+'.self-hosted-session'),false);
 const next=await startSelfHostedServer({...options,model:async()=>result});await flush();await next.close();
});
test('unknown failure stops with no backup or retry and blocks restart',async t=>{
 const options=fixture(t);let calls=0;
 const run=await startSelfHostedServer({...options,model:async()=>{calls++;throw Error('private-fake-key should not be published');}});
 await flush();run.runtime.tick();await flush();assert.equal(calls,1);assert.equal(run.runtime.world.clock.paused,true);
 assert.ok(!JSON.stringify(run.runtime.world.metrics).includes('private-fake-key'));
 await run.close();assert.equal(existsSync(options.database+'.self-hosted-session'),true);
 await assert.rejects(startSelfHostedServer({...options,model:async()=>{calls++;return result;}}),/self_hosted_unresolved_session/);assert.equal(calls,1);
});
test('interrupted request retains marker and late response does not commit',async t=>{
 const options=fixture(t);let finish!:(v:typeof result)=>void;
 const run=await startSelfHostedServer({...options,model:()=>new Promise(r=>finish=r)});
 await flush();const successes=run.runtime.world.metrics.successes;await run.close();finish(result);await flush();
 assert.equal(run.runtime.world.metrics.successes,successes);assert.equal(existsSync(options.database+'.self-hosted-session'),true);
});
test('existing crash marker blocks before model dispatch',async t=>{
 const options=fixture(t);writeFileSync(options.database+'.self-hosted-session','');let calls=0;
 await assert.rejects(startSelfHostedServer({...options,model:async()=>{calls++;return result;}}),/self_hosted_unresolved_session/);assert.equal(calls,0);
});
test('direct stop retains unresolved marker even after it clears world inFlight',async t=>{
 const options=fixture(t);const run=await startSelfHostedServer({...options,model:()=>new Promise(()=>{})});
 await flush();run.runtime.stop();assert.equal(run.runtime.world.metrics.inFlight.length,0);
 assert.throws(()=>run.runtime.start(),/self_hosted_runtime_is_single_use/);
 await run.close();assert.equal(existsSync(options.database+'.self-hosted-session'),true);
});
test('full HTTP codec chain uses only mocked transport, fixed endpoint, configured IDs and fake key',async t=>{
 const {callModel}=await import('../src/server/decisions.js');
 const options=fixture(t);let reply='',requests=0;
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  requests++;assert.equal(url,'https://api.siliconflow.cn/v1/chat/completions');assert.equal(init?.redirect,'error');
  assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer fake-only');
  const payload=JSON.parse(String(init?.body));assert.equal(payload.model,requests===1?DEEPSEEK_MODEL:GLM_MODEL);
  if(requests===1)return new Response('{}',{status:429});
  return new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}));
 });
 const run=await startSelfHostedServer({...options,model:async(...args)=>{
  const choice=args[4]!.choices.find(c=>c.action.type==='wait')!;assert.ok(choice);
  reply=JSON.stringify({choice:choice.id,minutes:15});return callModel(...args);
 }});
 await flush();assert.ok(requests>1);assert.ok(run.runtime.world.metrics.successes>0);await run.close();
});
test('actual SIGKILL leaves the session guard and restart sends no request',async t=>{
 const {spawn}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const options=fixture(t),entry=join(options.root,'kill-fixture.mjs');
 const module=fileURLToPath(new URL('../src/server/self-hosted-startup.ts',import.meta.url));
 const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url));
 writeFileSync(entry,`import {startSelfHostedServer} from ${JSON.stringify(module)}; await startSelfHostedServer({...${JSON.stringify(options)},model:()=>new Promise(()=>{})}); console.log('ready');`);
 const child=spawn(process.execPath,['--import',loader,entry],{env:{PATH:process.env.PATH,HOME:options.root},stdio:['ignore','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('exit',resolve));t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_start_timeout')),10000);child.stdout.on('data',data=>{if(String(data).includes('ready')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture_early_exit'));});});
 child.kill('SIGKILL');await exited;let calls=0;
 assert.equal(existsSync(options.database+'.self-hosted-session'),true);
 await assert.rejects(startSelfHostedServer({...options,model:async()=>{calls++;return result;}}),/self_hosted_unresolved_session/);assert.equal(calls,0);
});

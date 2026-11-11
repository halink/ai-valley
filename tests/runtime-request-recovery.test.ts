import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DecisionError,type ModelResult} from '../src/server/decisions.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const reply:ModelResult={decision:{intention:'稍作休息',actions:[{type:'wait',minutes:100}]},inputTokens:7,outputTokens:3,latencyMs:1};
const credentials=[{model:QWEN_MODEL,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}] as const;
function fixture(t:TestContext){
 const directory=mkdtempSync(join(testTmpdir(),'runtime-request-recovery-')),path=join(directory,'world.sqlite');
 let store=new WorldStore(path);store.commit(createFrontierWorld(5401),null);
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 return {path,get store(){return store;},reopen(){store.close();store=new WorldStore(path);return store;}};
}
function singleRequest(runtime:ValleyRuntime,t:TestContext){
 // Invoke one real decision pipeline without starting timers or an automatic
 // retry. This lets a fallible subscriber/SQLite commit reject to the test.
 const internals=runtime as unknown as {providers:unknown[];decide:(id:string,provider:unknown)=>Promise<void>;schedule:()=>void};
 t.mock.method(internals,'schedule',()=>{});
 const id=runtime.world.residents.find(r=>r.canDecide&&r.canExpress)!.id;
 return {id,run:()=>internals.decide(id,internals.providers[0])};
}

test('all nine successful replies survive an immediate clean shutdown and SQLite reopen without unknown failures',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const f=fixture(t),runtime=new ValleyRuntime(f.store,credentials,async()=>reply,{mode:'formal',modelSlots:2});
 t.after(()=>runtime.stop());runtime.start();await flush();
 assert.equal(runtime.world.metrics.requests,9);assert.equal(runtime.world.metrics.successes,9);
 assert.deepEqual(f.store.loadForRuntime()!.metrics.inFlight,[]);
 runtime.stop();
 const restored=new ValleyRuntime(f.reopen(),null,undefined,{mode:'formal'});
 assert.equal(restored.world.metrics.failures,0);assert.equal(restored.world.metrics.unmeteredFailures??0,0);
 assert.equal(restored.world.metrics.inputTokens,63);assert.equal(restored.world.metrics.outputTokens,27);
 assert.equal(restored.world.metrics.usageWindow?.[QWEN_MODEL]?.length,9);
 restored.stop();
});

test('settling one concurrent request clears only itself; stopping the other records unknown usage once',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const f=fixture(t),world=f.store.loadForRuntime()!;
 const eligible=world.residents.filter(r=>r.canDecide&&r.canExpress).slice(0,2),ids=new Set(eligible.map(r=>r.id));
 for(const r of world.residents)if(!ids.has(r.id))r.decisionDue=world.minute+1000;
 const previous=world.revision++;f.store.commit(world,previous);
 const pending=new Map<string,(result:ModelResult)=>void>();
 const runtime=new ValleyRuntime(f.store,credentials,(_key,context)=>new Promise(resolve=>pending.set(context.actor.id,resolve)),{mode:'formal',modelSlots:2});
 t.after(()=>runtime.stop());runtime.start();assert.equal(pending.size,2);
 const [first,second]=[...pending.keys()];pending.get(first)!(reply);await flush();
 const saved=f.store.loadForRuntime()!;
 assert.deepEqual(saved.metrics.inFlight,[second]);assert.equal(saved.metrics.successes,1);
 assert.equal(saved.metrics.usageWindow?.[QWEN_MODEL]?.length,2,'completed usage is not a refunded reservation');
 runtime.stop();const stopped=structuredClone(f.store.loadForRuntime()!);
 assert.equal(stopped.metrics.failures,1);assert.equal(stopped.metrics.unmeteredFailures,1);
 pending.get(second)!(reply);await flush();assert.deepEqual(f.store.loadForRuntime(),stopped);
 const restored=new ValleyRuntime(f.reopen(),null,undefined,{mode:'formal'});
 assert.equal(restored.world.metrics.failures,1);assert.equal(restored.world.metrics.unmeteredFailures,1);restored.stop();
});

for(const failure of ['metered','unknown'] as const)test(`${failure} completed failure and its budget are persisted once across reopen`,async t=>{
 const f=fixture(t),runtime=new ValleyRuntime(f.store,credentials,async()=>{
  if(failure==='metered')throw new DecisionError('invalid_decision',{inputTokens:7,outputTokens:3,latencyMs:1});
  throw new Error('synthetic_transport_failure');
 },{mode:'formal',modelSlots:1});
 const request=singleRequest(runtime,t);await request.run();
 const saved=f.store.loadForRuntime()!;assert.equal(saved.metrics.requests,1);assert.equal(saved.metrics.failures,1);
 assert.deepEqual(saved.metrics.inFlight,[]);assert.equal(saved.metrics.unmeteredFailures??0,failure==='unknown'?1:0);
 const charge=saved.metrics.usageWindow?.[QWEN_MODEL]?.[0];assert.ok(charge);assert.ok(charge.finishedAt);
 if(failure==='metered'){assert.equal(charge.input,7);assert.equal(charge.output,3);}else{assert.ok(charge.input>1000);assert.ok(charge.output>3);}
 runtime.stop();const restored=new ValleyRuntime(f.reopen(),null,undefined,{mode:'formal'});
 assert.equal(restored.world.metrics.failures,1);assert.equal(restored.world.metrics.unmeteredFailures??0,failure==='unknown'?1:0);
 assert.deepEqual(restored.world.metrics.usageWindow?.[QWEN_MODEL],[charge]);restored.stop();
});

test('a subscriber throwing after durable success cannot reclassify that response as a model failure',async t=>{
 const f=fixture(t),runtime=new ValleyRuntime(f.store,credentials,async()=>reply,{mode:'formal',modelSlots:1}),request=singleRequest(runtime,t);
 const unsubscribe=runtime.subscribe(()=>{if(runtime.world.metrics.successes)throw new Error('synthetic_subscriber_failure');});
 await assert.rejects(request.run(),/synthetic_subscriber_failure/);unsubscribe();
 const saved=f.store.loadForRuntime()!;assert.equal(saved.metrics.successes,1);assert.equal(saved.metrics.failures,0);
 assert.deepEqual(saved.metrics.inFlight,[]);assert.equal(saved.metrics.unmeteredFailures??0,0);
 assert.equal(saved.metrics.inputTokens,7);runtime.stop();
 const restored=new ValleyRuntime(f.reopen(),null,undefined,{mode:'formal'});
 assert.equal(restored.world.metrics.failures,0);assert.equal(restored.world.metrics.unmeteredFailures??0,0);restored.stop();
});

test('a failed SQLite terminal transaction keeps its durable request and conservative budget unresolved',async t=>{
 const f=fixture(t),sql=new DatabaseSync(f.path);t.after(()=>sql.close());
 const runtime=new ValleyRuntime(f.store,credentials,async()=>reply,{mode:'formal',modelSlots:1}),request=singleRequest(runtime,t);
 const original=f.store.commit;
 f.store.commit=function(world,previous,appended){
  if(world.metrics.successes||world.metrics.failures)sql.exec("CREATE TRIGGER IF NOT EXISTS reject_terminal BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'synthetic_terminal_commit_failure'); END");
  return original.call(this,world,previous,appended);
 };
 await assert.rejects(request.run(),/synthetic_terminal_commit_failure/);
 f.store.commit=original;sql.exec('DROP TRIGGER reject_terminal');
 const saved=f.store.loadForRuntime()!;
 assert.deepEqual(saved.metrics.inFlight,[request.id]);assert.equal(saved.metrics.successes,0);assert.equal(saved.metrics.failures,0);
 const charge=saved.metrics.usageWindow?.[QWEN_MODEL]?.[0];assert.ok(charge);assert.equal(charge.finishedAt,undefined);assert.ok(charge.input>1000);
 runtime.stop();
 const restored=new ValleyRuntime(f.reopen(),null,undefined,{mode:'formal'});
 assert.equal(restored.world.metrics.failures,1);assert.equal(restored.world.metrics.unmeteredFailures,1);
 assert.equal(restored.world.metrics.usageWindow?.[QWEN_MODEL]?.[0].input,charge.input);restored.stop();
});

for(const gap of ['before_terminal','after_terminal'] as const)test(`actual child exit ${gap} preserves the correct request status on SQLite reopen`,t=>{
 const f=fixture(t);
 const source=`
 import {WorldStore} from './src/server/store.ts';
 import {ValleyRuntime} from './src/server/runtime.ts';
 import {QWEN_MODEL} from './src/server/model-completion.ts';
 const store=new WorldStore(${JSON.stringify(f.path)}),gap=${JSON.stringify(gap)};
 const original=store.commit.bind(store);
 store.commit=(world,...args)=>{if(gap==='before_terminal'&&world.metrics.successes)process.exit(78);return original(world,...args);};
 const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async()=>(${JSON.stringify(reply)}),{mode:'formal',modelSlots:1});
 runtime.subscribe(()=>{if(runtime.world.metrics.successes)process.exit(79);});runtime.start();
 setTimeout(()=>process.exit(80),10000);
 `;
 const directory=join(f.path,'..');
 const result=spawnSync(process.execPath,['--import','./scripts/acceptance-offline-guard.mjs','--import','tsx','--input-type=module','--eval',source],
  {cwd:process.cwd(),env:{HOME:directory,USERPROFILE:directory,TMPDIR:directory,TMP:directory,TEMP:directory,TSX_DISABLE_CACHE:'1'},encoding:'utf8',timeout:20000});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,gap==='before_terminal'?78:79,result.stderr);
 const restored=new ValleyRuntime(f.reopen(),null,undefined,{mode:'formal'});
 assert.equal(restored.world.metrics.successes,gap==='after_terminal'?1:0);
 assert.equal(restored.world.metrics.failures,gap==='before_terminal'?1:0);
 assert.equal(restored.world.metrics.unmeteredFailures??0,gap==='before_terminal'?1:0);restored.stop();
});

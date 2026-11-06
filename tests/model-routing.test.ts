import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callModel,decisionContext,decisionChoices,prepareModelDecision} from '../src/server/decisions.js';
import {QWEN_MODEL,DEEPSEEK_MODEL,type ModelName} from '../src/server/model-completion.js';
import {ModelBudget} from '../src/server/model-budget.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {createWorld} from '../src/world/seed.js';

test('Qwen streaming collects only the final answer and records usage',async t=>{
 const world=createWorld(),context=decisionContext(world,world.residents[0]);
 const choice=decisionChoices(context).find(c=>c.action.type==='wait')!;
 const packet=(data:unknown)=>`data: ${JSON.stringify(data)}\r\n\r\n`;
 const bytes=new TextEncoder().encode(packet({choices:[{delta:{reasoning_content:'这不是最终选择 {"choice":"999"}'}}]})+
  packet({choices:[{delta:{content:'{"cho'}}]})+
  packet({choices:[{delta:{content:`ice":"${choice.id}"}`}}]})+
  packet({choices:[{delta:{},finish_reason:'stop'}]})+
  packet({choices:[],usage:{prompt_tokens:321,completion_tokens:67}})+'data: [DONE]\r\n\r\n');
 const request=t.mock.method(globalThis,'fetch',async(url:string,options:RequestInit)=>{
  assert.equal(url,'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions');
  const body=JSON.parse(String(options.body));
  assert.equal(body.model,QWEN_MODEL);assert.equal(body.enable_thinking,true);assert.equal(body.stream,true);
  assert.deepEqual(body.stream_options,{include_usage:true});
  return new Response(new ReadableStream({start(controller){
   for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));
   controller.close();
  }}));
 });
 const result=await callModel('qwen-test',context,undefined,QWEN_MODEL);
 assert.deepEqual(result.decision.actions,[choice.action]);
 assert.equal(result.inputTokens,321);assert.equal(result.outputTokens,67);
 assert.equal(request.mock.callCount(),1);
});

test('each model checks the size of multibyte input before any HTTP request',async t=>{
 const world=createWorld(),context=decisionContext(world,world.residents[0]);
 const request=t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected request');});
 context.actor.traits=['界'.repeat(50_000)];
 assert.ok(prepareModelDecision(context,undefined,QWEN_MODEL).inputBytes>128_000);
 await assert.rejects(callModel('backup-test',context,undefined,DEEPSEEK_MODEL),/model_context_limit/);
 context.actor.traits=['界'.repeat(330_000)];
 await assert.rejects(callModel('qwen-test',context,undefined,QWEN_MODEL),/model_context_limit/);
 assert.equal(request.mock.callCount(),0);
});

test('reservations account for rolling RPM and TPM, including responses which last longer than one minute',()=>{
 const budget=new ModelBudget(2,100);
 const first=budget.reserve(0,40,30)!;
 assert.equal(budget.reserve(1,30,10),null);
 budget.finish(first,1000,{inputTokens:12,outputTokens:8});
 const slow=budget.reserve(1000,10,40)!;
 assert.equal(budget.reserve(2000,1,1),null);
 const next=budget.reserve(60_000,10,15)!;
 assert.ok(next);
 assert.equal(budget.reserve(61_000,40,5),null);
 budget.finish(slow,62_000,{inputTokens:5,outputTokens:7});
 assert.ok(budget.reserve(62_000,40,5));
});

const providers=[{model:QWEN_MODEL,key:'test-primary'},{model:DEEPSEEK_MODEL,key:'test-backup'}] as const;
const waitResult={decision:{intention:'稍作停留',actions:[{type:'wait' as const,minutes:15}]},inputTokens:100,outputTokens:25,latencyMs:5};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('healthy primary serves the residents without making backup calls',async()=>{
 const store=new WorldStore(':memory:'),calls:ModelName[]=[];
 const runtime=new ValleyRuntime(store,providers,async(key,_context,_feedback,model)=>{
  assert.equal(key,'test-primary');calls.push(model!);return waitResult;
 });
 try{
  runtime.start();await flush();
  assert.deepEqual(calls,[QWEN_MODEL,QWEN_MODEL,QWEN_MODEL]);
  assert.equal(runtime.world.metrics.successes,3);
 }finally{runtime.stop();store.close();}
});

test('the backup retries the same decision while a rate-limited primary cools down, then primary resumes',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:'),calls:Array<[string,ModelName|undefined]>=[];
 const runtime=new ValleyRuntime(store,providers,async(key,context,_feedback,model)=>{
  calls.push([context.actor.id,model]);
  if(calls.length===1)throw new Error('model_http_429');
  assert.equal(key,model===QWEN_MODEL?'test-primary':'test-backup');
  return waitResult;
 },{modelSlots:1});
 try{
  runtime.start();await flush();
  assert.deepEqual(calls.map(c=>c[1]),[QWEN_MODEL,DEEPSEEK_MODEL,DEEPSEEK_MODEL,DEEPSEEK_MODEL]);
  assert.equal(calls[0][0],calls[1][0]);
  assert.equal(runtime.world.metrics.requests,4);assert.equal(runtime.world.metrics.successes,3);assert.equal(runtime.world.metrics.failures,1);
  assert.equal(runtime.world.metrics.model,DEEPSEEK_MODEL);
  const actor=runtime.world.residents.find(r=>r.id===calls[0][0])!;
  actor.plan=null;actor.decisionDue=runtime.world.minute;
  runtime.tick(now+=30_001);await flush();
  assert.deepEqual(calls.at(-1),[actor.id,QWEN_MODEL]);
  assert.equal(runtime.world.metrics.model,QWEN_MODEL);
 }finally{runtime.stop();store.close();}
});

test('a single timeout falls back for that resident while other requests still use the primary',async()=>{
 const store=new WorldStore(':memory:'),calls:Array<[string,ModelName|undefined]>=[];
 const runtime=new ValleyRuntime(store,providers,async(_key,c,_feedback,model)=>{
  calls.push([c.actor.id,model]);
  if(calls.length===1)throw new Error('test timeout');
  return waitResult;
 },{modelSlots:1});
 try{
  runtime.start();await flush();
  assert.deepEqual(calls.map(c=>c[1]),[QWEN_MODEL,DEEPSEEK_MODEL,QWEN_MODEL,QWEN_MODEL]);
  assert.equal(calls[0][0],calls[1][0]);
 }finally{runtime.stop();store.close();}
});

test('the formal world starts each provider at its own concurrency without routing extra healthy primary calls',()=>{
 for(const [connections,expected] of [[providers,8],[[providers[1]],4]] as const){
  const store=new WorldStore(':memory:');
  const calls:ModelName[]=[];
  const runtime=new ValleyRuntime(store,connections,(_key,_context,_feedback,model)=>{
   calls.push(model!);return new Promise(()=>{});
  },{mode:'formal'});
  try{
   runtime.start();
   assert.equal(calls.length,expected);
   assert.ok(calls.every(model=>model===connections[0].model));
  }finally{runtime.stop();store.close();}
 }
});

test('a restored backup waits for the previous minute’s usage to clear without counting a failed call',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:'),world=createWorld();
 world.metrics.usageWindow={[DEEPSEEK_MODEL]:[{startedAt:now,input:41_000,output:4000,finishedAt:now}]};
 store.commit(world,null);
 const calls:ModelName[]=[];
 const runtime=new ValleyRuntime(store,[providers[1]],(_key,_context,_feedback,model)=>{
  calls.push(model!);return new Promise(()=>{});
 });
 try{
  runtime.start();
  assert.equal(calls.length,0);
  assert.equal(runtime.world.metrics.requests,0);
  assert.equal(runtime.world.metrics.failures,0);
  assert.equal(runtime.snapshot().world.metrics.usageWindow,undefined);
  runtime.tick(now+=60_000);
  assert.deepEqual(calls,[DEEPSEEK_MODEL,DEEPSEEK_MODEL,DEEPSEEK_MODEL]);
  assert.equal(runtime.world.metrics.requests,3);
 }finally{runtime.stop();store.close();}
});

test('simultaneous limit responses only reduce concurrency once for that wave',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:');let attempts=0;
 const runtime=new ValleyRuntime(store,[providers[0]],async()=>{
  if(++attempts<=8)throw new Error('model_http_429');
  return new Promise(()=>{});
 },{mode:'formal'});
 try{
  runtime.start();await flush();
  assert.equal(attempts,8);
  runtime.tick(now+=30_001);
  assert.equal(attempts,12);
 }finally{runtime.stop();store.close();}
});

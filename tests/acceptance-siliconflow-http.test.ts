import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createMemorySiliconFlowHttp,SiliconFlowHttpRehearsal,SILICONFLOW_HTTP_REHEARSAL as P,type HttpRehearsalEvidence} from '../src/server/acceptance-siliconflow-http.js';
import {modelRequestPayload,QWEN_MODEL,GLM_MODEL,DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {createNineResidentHttpRehearsal,NINE_HTTP_REHEARSAL} from '../src/server/acceptance-siliconflow-nine.js';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
import {readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import type {AcceptanceClock} from '../src/server/acceptance-stop-control.js';
class Clock implements AcceptanceClock{value=100;next=0;timers=new Map<number,{at:number;fn:()=>void}>();now=()=>this.value;
 setTimer=(fn:()=>void,ms:number)=>{const id=++this.next;this.timers.set(id,{at:this.value+ms,fn});return id;};clearTimer=(id:unknown)=>{this.timers.delete(id as number);};
 advance(ms:number){this.value+=ms;for(const[id,t]of [...this.timers])if(t.at<=this.value){this.timers.delete(id);t.fn();}}}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const messages=[{role:'user' as const,content:'SYNTHETIC_PRIVATE_PROMPT'}];
function setup(){const memory=createMemorySiliconFlowHttp(),clock=new Clock(),events:HttpRehearsalEvidence[]=[];
 const http=new SiliconFlowHttpRehearsal({transport:memory.transport,clock,persist:event=>{events.push(event);return true;}});return {memory,clock,events,http};}
function headers(requestId=1,overrides:Record<string,unknown>={}){return {status:200,endpoint:P.endpoint,redirected:false,contentType:'application/json; charset=utf-8',contentLength:null,
 receipt:{provenance:'synthetic-fixture',requestId,providerRequestId:`fixture-${requestId}`,model:P.model,endpoint:P.endpoint,currency:'USD',allChargesFinal:true,totalUsd:0},...overrides};}
function respond(memory:ReturnType<typeof createMemorySiliconFlowHttp>,index:number,content='{"choice":"1","minutes":15}',extra:Record<string,unknown>={}){
 memory.resolveHeaders(index,headers(index+1));memory.pushChunk(index,Buffer.from(JSON.stringify({id:`fixture-${index+1}`,model:P.model,
  choices:[{message:{content,reasoning_content:'DO_NOT_PARSE_REASONING'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4},...extra})));memory.endBody(index);}
test('shared request encoding preserves Qwen streaming and SiliconFlow parameters',()=>{
 const qwen=JSON.parse(modelRequestPayload(QWEN_MODEL,messages,0.25)),deepseek=JSON.parse(modelRequestPayload(DEEPSEEK_MODEL,messages,0.25)),glm=JSON.parse(modelRequestPayload(GLM_MODEL,messages,0.6));
 assert.deepEqual(qwen,{model:QWEN_MODEL,messages,temperature:0.25,max_tokens:768,stream:true,stream_options:{include_usage:true},enable_thinking:true,thinking_budget:512});
 assert.deepEqual(deepseek,{model:DEEPSEEK_MODEL,messages,temperature:0.25,max_tokens:512,stream:false,enable_thinking:true,thinking_budget:1536});
 assert.equal(glm.enable_thinking,false);assert.equal(glm.thinking_budget,2048);assert.equal(JSON.parse(modelRequestPayload(GLM_MODEL,messages,0.25)).thinking_budget,1536);
});
test('default construction stays disconnected and cannot perform any HTTP',async()=>{const h=new SiliconFlowHttpRehearsal();assert.equal(h.start(),false);assert.equal(await h.complete(messages),null);assert.equal(h.status().transportInvocations,0);assert.equal(h.status().readyForRealRun,false);});
test('request and independent evidence use exact model endpoint and no raw data',async()=>{const f=setup();f.http.start();const promise=f.http.complete(messages),sent=f.memory.requests()[0];
 assert.equal(sent.endpoint,P.endpoint);assert.equal(sent.redirect,'error');assert.equal(JSON.parse(sent.body).model,P.model);respond(f.memory,0);assert.equal((await promise)?.usage?.prompt_tokens,10);
 assert.deepEqual(f.events.map(e=>e.type),['gate','dispatch_intent','transport_invoked','headers','body','completion']);f.http.stop();
 const logged=JSON.stringify(f.events);assert.equal(logged.includes('SYNTHETIC_PRIVATE_PROMPT'),false);assert.equal(logged.includes('SYNTHETIC-NOT-A-CREDENTIAL'),false);assert.equal(logged.includes('DO_NOT_PARSE_REASONING'),false);
 assert.equal(f.http.status().realProviderCostUsd,null);assert.equal(f.http.status().syntheticCostUsd,0);
});
for(const [change,reason] of [[{status:302},'redirect_rejected'],[{endpoint:P.endpoint+'/'},'redirect_rejected'],[{redirected:true},'redirect_rejected'],[{status:401},'http_failed'],[{status:429},'rate_limited'],[{status:500},'http_failed'],[{contentType:'text/event-stream'},'response_invalid'],[{contentLength:'-1'},'response_invalid'],[{contentLength:String(P.maxResponseBytes+1)},'response_invalid']] as const)
 test(`HTTP stage rejects ${JSON.stringify(change)} without retry`,async()=>{const f=setup();f.http.start();const p=f.http.complete(messages);f.memory.resolveHeaders(0,headers(1,change));assert.equal(await p,null);assert.equal(f.http.status().reason,reason);assert.equal(await f.http.complete(messages),null);assert.equal(f.memory.requests().length,1);});
test('all 24 requests are bounded without next dispatch',async()=>{const f=setup();f.http.start();for(let i=0;i<P.maxRequests;i++){const p=f.http.complete(messages);respond(f.memory,i);assert.ok(await p);}assert.equal(await f.http.complete(messages),null);assert.equal(f.http.status().reason,'request_limit');assert.equal(f.memory.requests().length,24);});
test('whole-session timer stops idle admissions and preserves an exact stop record',()=>{const f=setup();f.http.start();f.clock.advance(P.maxWallMs);assert.equal(f.http.status().reason,'wall_limit');assert.equal(f.events.at(-1)!.type,'stopped');assert.equal(f.http.status().syntheticCostUsd,null);assert.equal(f.clock.timers.size,0);});
test('headers or body cancellation leaves no later accepted completion',async()=>{for(const stage of ['headers','body']){const f=setup();f.http.start();const controller=new AbortController(),p=f.http.complete(messages,controller.signal);
 if(stage==='body'){f.memory.resolveHeaders(0,headers());await flush();}controller.abort();assert.equal(await p,null);const before=JSON.stringify(f.events);respond(f.memory,0);await flush();assert.equal(JSON.stringify(f.events),before);assert.equal(f.http.status().reason,'signal');}});
function nine(t:TestContext){t.mock.timers.enable({apis:['setInterval']});let wall=1_700_000_000_000;t.mock.method(Date,'now',()=>wall);
 const parent=mkdtempSync(join(testTmpdir(),'valley-http-')),directory=AcceptanceRunDirectory.create(join(parent,'run')),memory=createMemorySiliconFlowHttp(),clock=new Clock();
 const run=createNineResidentHttpRehearsal({directory,transport:memory.transport,clock,sourceFingerprint:'a'.repeat(64),sourceFingerprintAfter:()=>'a'.repeat(64)});
 t.after(()=>{run.close();directory.close();rmSync(parent,{recursive:true,force:true});});return {parent,directory,memory,clock,run,advance(ms:number){wall+=ms;run.runtime.tick(wall);}};
}
test('nine unchanged founders flow through shared prompt/HTTP/parser into SQLite and sealed endpoint',async t=>{const f=nine(t);assert.equal(f.run.runtime.world.residents.length,9);assert.equal(f.run.runtime.world.minute,480);f.run.start();
 const chosen=new Set<string>();for(let i=0;i<9;i++){
  assert.equal(f.memory.requests().length,i+1,`founder ${i+1} admitted`);const actorId=f.run.runtime.world.metrics.inFlight[0];assert.ok(f.run.founderIds.includes(actorId));chosen.add(actorId);
  const actor=f.run.runtime.world.residents.find(r=>r.id===actorId)!;const choice=decisionChoices(decisionContext(f.run.runtime.world,actor)).find(c=>c.action.type==='wait')!;
  assert.ok(choice);respond(f.memory,i,JSON.stringify({choice:choice.id,minutes:15}));await flush();
 }
 assert.equal(chosen.size,9);assert.equal(f.run.runtime.world.metrics.successes,9);assert.equal(f.memory.requests().length,9);
 f.advance(1000);f.advance(1000);f.advance(1000);assert.equal(f.run.runtime.world.minute,NINE_HTTP_REHEARSAL.endGameMinute);f.run.close();
 const close=f.directory.readJson('http-close.json') as any;assert.equal(close.reloadVerified,true);assert.equal(close.realModelExecuted,false);assert.equal(close.realProviderCostUsd,null);
 const evidence=readAcceptanceEvidence(f.directory.child('evidence'));assert.equal(evidence.complete,true);assert.equal(evidence.reason,'game_endpoint');assert.equal(evidence.acceptancePassed,null);
 const manifest=f.directory.readJson('http-manifest.json') as any;assert.equal(manifest.processSupervisorConnected,false);assert.equal(manifest.readyForRealRun,false);
 assert.ok(readdirSync(join(f.parent,'run')).includes('world.sqlite'));assert.equal(f.memory.requests().every(r=>JSON.parse(r.body).model===P.model),true);
});
for(const variant of ['http_failure','invalid_decision','unknown_cost'] as const)test(`nine ${variant} stops before runtime retry or alternate model`,async t=>{const f=nine(t);f.run.start();
 if(variant==='invalid_decision')respond(f.memory,0,'not a valid decision');else f.memory.resolveHeaders(0,headers(1,variant==='http_failure'?{status:429}:{receipt:null}));await flush();
 assert.equal(f.run.runtime.acceptanceStopStatus()?.phase,'stopped');assert.equal(f.run.runtime.world.metrics.successes,0);assert.equal(f.memory.requests().length,1);
 f.advance(60_000);await flush();assert.equal(f.memory.requests().length,1);f.run.close();assert.equal((f.directory.readJson('http-close.json') as any).status.realProviderCostUsd,null);
});
test('nine stop records are durable before late reply and do not expose prompts',async t=>{const f=nine(t);f.run.start();f.clock.advance(P.requestTimeoutMs);await flush();f.run.close();
 const files=()=>readdirSync(join(f.parent,'run')).filter(n=>n.startsWith('http-')).sort().map(n=>readFileSync(join(f.parent,'run',n),'utf8'));
 const before=files();respond(f.memory,0);await flush();assert.deepEqual(files(),before);const close=f.directory.readJson('http-close.json') as any;
 assert.equal(close.status.reason,'request_timeout');assert.equal(close.status.unknownCostRequests,1);assert.equal(close.status.remoteCancellationConfirmed,false);assert.equal(close.reloadVerified,true);
 assert.equal(before.join('').includes('Bearer'),false);assert.equal(before.join('').includes('你是'),false);
});

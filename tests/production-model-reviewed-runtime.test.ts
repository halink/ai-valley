import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ProductionModelJournal,productionGatedCandidateContract,modelEvidenceHash} from '../src/server/production-model-journal.js';
import {createGatedSiliconFlowHttp} from '../src/server/production-model-http.js';
import {createReviewedProductionModelRuntime} from '../src/server/production-model-runtime.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
import type {ProductionHttpAdmission} from '../src/server/production-model-admission.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
/** All transport responses, keys, records, and worlds here are fabricated. No
 * environment or real save is read; fetch is replaced before transport creation.
 * A gated branch exercised with fake fetch is NOT a provider/account test. */
function fixture(t:TestContext,settings:{idle?:boolean;maxWallMs?:number;credentialDelayMs?:number;priceLifetimeMs?:number}={}){
 const dir=mkdtempSync(join(testTmpdir(),'reviewed-runtime-')),worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'journal.sqlite');
 const store=new WorldStore(worldPath),world=createFrontierWorld(701);
 for(const actor of world.residents.slice(settings.idle?0:1)){actor.decisionDue=world.minute+1000;if(settings.idle)actor.lastDecisionAt=world.minute;}
 store.commit(world,null);
 const now=Date.now(),scope={runId:'synthetic-reviewed',worldId:world.id,maxRequests:10,createdAtMs:now-1,deadlineAtMs:now+120000,requestTimeoutMs:5000};
 const record:ProductionHttpAdmission={schema:1,provider:'siliconflow',model:P.model,endpoint:P.endpoint,scope,
  authorization:{sourceHash:'a'.repeat(64),dataScope:'fictional-resident-state-memory-relationships-actions',spendingLimitCny:0},
  previousRequest:{requestEvidenceHash:'b'.repeat(64),resolutionEvidenceHash:'c'.repeat(64),billingEvidenceHash:'d'.repeat(64),remoteOutcome:'not-executed',actualCostCny:0,reconciledAtMs:now-2},
  pricing:{sourceUrl:'https://www.siliconflow.cn/pricing',sourceHash:'e'.repeat(64),model:P.model,checkedAtMs:now-1,validUntilMs:now+(settings.priceLifetimeMs??60000),inputCnyPerMillion:0,outputCnyPerMillion:0,otherApplicableChargesCny:0}};
 const contract=productionGatedCandidateContract({...scope,admissionHash:modelEvidenceHash(record)});
 let accesses=0;const calls:{body:string;resolve:(value:Response)=>void;reject:()=>void}[]=[];
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 t.mock.method(globalThis,'fetch',async(url:string|URL|Request,init?:RequestInit)=>{
  assert.equal(url,P.endpoint);assert.equal(init?.redirect,'error');assert.equal(JSON.parse(String(init?.body)).model,P.model);
  return new Promise<Response>((resolve,reject)=>calls.push({body:String(init?.body),resolve,reject:()=>reject(new Error('synthetic-timeout'))}));
 });
 const db=new DatabaseSync(journalPath),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:hash(store.loadForRuntime())});
 const transport=createGatedSiliconFlowHttp({enableLive:true,contract,admission:record,credential:()=>{accesses++;const started=performance.now();while(performance.now()-started<(settings.credentialDelayMs??0)){}return 'SYNTHETIC-NOT-A-KEY';}});
 const options={store,journal,transport,admission:record,endGameMinute:world.minute+60,maxWallMs:settings.maxWallMs};
 let bridge:ReturnType<typeof createReviewedProductionModelRuntime>|undefined;
 t.after(()=>{bridge?.close();try{store.close();}catch{}try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 return {store,journal,record,contract,calls,options,db,worldPath,journalPath,get accesses(){return accesses;},start(){bridge=createReviewedProductionModelRuntime({...options,enableLive:true});return bridge;},
  respond(status=200,model:string=P.model){
   const choice=JSON.parse(calls[0].body).messages.map((m:{content:string})=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];assert.ok(choice);
   const body=JSON.stringify({model,choices:[{message:{content:JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
   calls[0].resolve({status,url:P.endpoint,redirected:false,headers:new Headers({'content-type':'application/json'}),body:new ReadableStream({start(controller){controller.enqueue(Buffer.from(body));controller.close();}})} as Response);
  }};
}
test('reviewed bridge stays disabled unless explicitly enabled; no key read on construction',t=>{
 const f=fixture(t);assert.throws(()=>createReviewedProductionModelRuntime(f.options),/live_execution_disabled/);
 const bridge=f.start();assert.equal(f.accesses,0);assert.equal(f.calls.length,0);assert.equal(bridge.status().liveExecutionEnabled,false);
 assert.equal(bridge.status().pricingVerifiedBySoftware,false);assert.equal(bridge.status().providerBudgetEnforced,false);
 assert.equal(bridge.status().actualProviderCostCny,null);assert.equal(bridge.status().readyForProduction,false);
});
test('reviewed branch with synthetic fetch durably adopts exact result and preserves clean recovery chain',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();assert.equal(f.accesses,1);
 assert.equal(f.journal.status().pending?.phase,'intent');f.respond();await flush();await flush();
 assert.equal(f.journal.status().completed,1);assert.equal(f.journal.status().pending,null);
 assert.equal(bridge.runtime.world.metrics.successes,1);assert.equal(f.journal.status().worldFingerprint,hash(f.store.loadForRuntime()));
 assert.equal(bridge.close().failure,null);assert.equal(f.journal.status().runtimeStop,null);
});
for(const status of [401,402,429])test(`HTTP ${status} stops without retry, preserves intent and does not advance world`,async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();f.respond(status);await flush();await flush();
 assert.equal(bridge.status().failure,`model_http_${status}`);assert.equal(f.journal.status().pending?.phase,'intent');
 const minute=bridge.runtime.world.minute;bridge.runtime.tick(Date.now()+60000);await flush();
 assert.equal(bridge.runtime.world.minute,minute);assert.equal(f.calls.length,1);assert.equal(f.journal.status().completed,0);
 assert.throws(()=>f.start(),/owned|unresolved/);
});
test('unknown result is persisted and cannot be retried by constructing a new bridge',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();f.calls[0].reject();await flush();await flush();bridge.close();
 assert.equal(f.journal.status().pending?.phase,'intent');assert.equal(f.journal.status().failure,'transport_failed');
 assert.throws(()=>f.start(),/unresolved|world_mismatch/);assert.equal(f.calls.length,1);
});
test('changed pricing, expiry and paid model reject before reading synthetic credential',t=>{
 const f=fixture(t);
 for(const admission of [{...f.record,pricing:{...f.record.pricing,inputCnyPerMillion:1}},
  {...f.record,pricing:{...f.record.pricing,model:`Pro/${P.model}`}},
  {...f.record,pricing:{...f.record.pricing,validUntilMs:Date.now()}}]){
  assert.throws(()=>createReviewedProductionModelRuntime({...f.options,enableLive:true,admission}),/free_price/);
 }
 assert.equal(f.accesses,0);assert.equal(f.calls.length,0);
});
test('price expiry after construction fails closed before dispatch',async t=>{
 const f=fixture(t),bridge=f.start();t.mock.method(Date,'now',()=>f.record.pricing.validUntilMs);
 bridge.runtime.start();await flush();assert.equal(f.accesses,0);assert.equal(f.calls.length,0);assert.equal(f.journal.status().completed,0);
});
test('provider returning a different model never reaches world adoption',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();f.respond(200,`Pro/${P.model}`);await flush();await flush();
 assert.equal(bridge.status().failure,'response_model_mismatch');assert.equal(f.journal.status().completed,0);assert.equal(f.calls.length,1);
});

test('clean gated lifecycle replays from disk retaining original deadline and cumulative attempts',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();f.respond();await flush();await flush();
 assert.equal(bridge.close().failure,null);const state=f.journal.status();f.store.close();f.db.close();
 const store=new WorldStore(f.worldPath),db=new DatabaseSync(f.journalPath);
 try{
  const reopened=new ProductionModelJournal(db,f.contract,{create:false,worldFingerprint:hash(store.loadForRuntime())});
  assert.equal(reopened.status().attempts,state.attempts);assert.equal(reopened.status().completed,state.completed);
  assert.equal(reopened.status().pending,null);assert.equal(reopened.status().runtimeStop,null);
  assert.equal(reopened.contract.deadlineAtMs,f.contract.deadlineAtMs);
 }finally{store.close();db.close();}
});
test('closing during response leaves unknown intent, rejects late adoption and never retries',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();bridge.close();const closedHash=hash(f.store.loadForRuntime());f.respond();await flush();await flush();
 assert.equal(hash(f.store.loadForRuntime()),closedHash);
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'intent');
 assert.equal(f.calls.length,1);assert.equal(bridge.status().liveExecutionEnabled,false);
});

test('runtime clean stop revokes advertised live execution before bridge close',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();assert.equal(bridge.status().liveExecutionEnabled,true);
 f.respond();await flush();await flush();bridge.runtime.stop();
 assert.equal(bridge.status().control?.phase,'stopped');assert.equal(bridge.status().failure,null);
 assert.equal(bridge.status().closed,false);assert.equal(bridge.status().liveExecutionEnabled,false);
});

test('idle world stops before any progress when wall-clock pricing expires',async t=>{
 const f=fixture(t,{idle:true}),bridge=f.start();bridge.runtime.start();const before=bridge.runtime.world.minute;
 t.mock.method(Date,'now',()=>f.record.pricing.validUntilMs+1);
 assert.equal(bridge.status().liveExecutionEnabled,false);bridge.runtime.tick(Date.now());await flush();
 assert.equal(bridge.runtime.world.minute,before);assert.equal(bridge.status().control?.phase,'stopped');
 assert.equal(f.accesses,0);assert.equal(f.calls.length,0);
});
test('natural price deadline stops an idle world without waiting for a tick or model request',async t=>{
 const f=fixture(t,{idle:true,priceLifetimeMs:4000}),bridge=f.start();bridge.runtime.start();const before=bridge.runtime.world.minute;
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,f.record.pricing.validUntilMs-Date.now()+50)));
 assert.equal(bridge.status().control?.phase,'stopped');assert.equal(bridge.status().liveExecutionEnabled,false);
 bridge.runtime.tick();assert.equal(bridge.runtime.world.minute,before);assert.equal(f.accesses,0);assert.equal(f.calls.length,0);
});
test('synchronous credential time cannot extend bridge deadline or reach fetch; intent remains unknown',async t=>{
 const f=fixture(t,{maxWallMs:3000,credentialDelayMs:3200}),bridge=f.start();bridge.runtime.start();await flush();await flush();
 assert.equal(f.accesses,1);assert.equal(f.calls.length,0);assert.equal(bridge.status().failure,'wall_limit');
 assert.equal(f.journal.status().pending?.phase,'intent');assert.equal(f.journal.status().completed,0);
 assert.equal(bridge.status().control?.phase,'stopped');assert.equal(bridge.status().liveExecutionEnabled,false);
});

test('frozen wall clock cannot extend the monotonic bridge deadline',async t=>{
 const f=fixture(t,{idle:true,maxWallMs:3000}),bridge=f.start();bridge.runtime.start();
 const wall=Date.now(),mono=performance.now(),before=bridge.runtime.world.minute;
 t.mock.method(Date,'now',()=>wall);t.mock.method(performance,'now',()=>mono+3001);
 bridge.runtime.tick(wall+60000);await flush();
 assert.equal(bridge.runtime.world.minute,before);assert.equal(bridge.status().control?.phase,'stopped');
 assert.equal(bridge.status().liveExecutionEnabled,false);assert.equal(f.accesses,0);assert.equal(f.calls.length,0);
});
test('reply arriving after price expiry is not adopted or retried',async t=>{
 const f=fixture(t),bridge=f.start();bridge.runtime.start();
 t.mock.method(Date,'now',()=>f.record.pricing.validUntilMs+1);f.respond();await flush();await flush();
 assert.equal(f.journal.status().completed,0);assert.equal(f.journal.status().pending?.phase,'intent');
 assert.equal(bridge.runtime.world.metrics.successes,0);assert.equal(f.calls.length,1);
 assert.equal(bridge.status().liveExecutionEnabled,false);bridge.close();
 assert.throws(()=>f.start(),/free_price|unresolved|world_mismatch/);assert.equal(f.calls.length,1);
});
test('fabricated zero-price record is explicitly unverified, never an authenticated source',t=>{
 const f=fixture(t),bridge=f.start();
 assert.equal(bridge.status().pricingBasis,'caller-supplied-unverified-record');
 assert.equal(bridge.status().pricingVerifiedBySoftware,false);
 assert.equal(bridge.status().actualProviderCostCny,null);assert.equal(bridge.status().readyForProduction,false);
 assert.equal(f.accesses,0);assert.equal(f.calls.length,0);
});

import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp,ProductionSiliconFlowHttpCandidate} from '../src/server/production-model-http.js';
import {evaluateProductionHttpAdmission} from '../src/server/production-model-admission.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
const scope={runId:'review-synthetic',worldId:'review-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000};
function fixture(t:TestContext){
 const dir=mkdtempSync(join(testTmpdir(),'http-review-')),db=new DatabaseSync(join(dir,'synthetic.sqlite'));
 t.after(()=>{try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const journal=new ProductionModelJournal(db,productionCandidateContract(scope),{create:true,worldFingerprint:'a'.repeat(64)});
 let now=1000,fire=()=>{};
 const memory=createMemoryProductionHttp(),guard=new ProductionSiliconFlowHttpCandidate(journal,memory.transport,{clock:{now:()=>now,setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{}}});
 return {db,journal,memory,guard,timeout:()=>{now=2000;fire();}};
}
const messages=[{role:'user' as const,content:'Synthetic review only'}];
const bytes=new TextEncoder().encode(JSON.stringify({model:P.model,choices:[{message:{content:'合成'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}));

test('review: delayed headers after timeout cancel their body and never record a response',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.timeout();assert.equal(await pending,null);
 f.memory.headers(0);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.memory.bodyCancelled(0),true);assert.equal(f.journal.status().pending?.phase,'intent');assert.equal(f.guard.status().observedResponses,0);
});
test('review: delayed header rejection after timeout is handled without retry',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.timeout();assert.equal(await pending,null);
 f.memory.reject(0);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.memory.requests().length,1);assert.equal(f.guard.status().actualProviderCostCny,null);
});
test('review: stalled stream timeout cancels pending read and retains intent',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.memory.headers(0);await Promise.resolve();f.timeout();
 assert.equal(await pending,null);await Promise.resolve();assert.equal(f.memory.bodyCancelled(0),true);assert.equal(f.journal.status().pending?.phase,'intent');
});
test('review: UTF-8 split at every byte decodes only after bounded read',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.memory.headers(0, {contentLength:String(bytes.byteLength)});
 for(const byte of bytes)f.memory.chunk(0,Uint8Array.of(byte));f.memory.end(0);
 const result=await pending;assert.equal(result?.reply.content,'合成');assert.equal(f.journal.status().pending?.phase,'response');assert.equal(f.guard.status().actualProviderCostCny,null);
});
test('review: body rejection never releases durable pending slot',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.memory.headers(0);f.memory.failBody(0);
 assert.equal(await pending,null);assert.equal(await f.guard.complete(messages),null);assert.equal(f.memory.requests().length,1);assert.equal(f.journal.status().pending?.phase,'intent');
});
test('review: declared oversize response cancels without draining',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.memory.headers(0,{contentLength:'128001'});
 assert.equal(await pending,null);assert.equal(f.memory.bodyCancelled(0),true);assert.equal(f.guard.status().failure,'response_too_large');
});
test('review: owner loss between intent and dispatch produces no memory request',async t=>{
 const dir=mkdtempSync(join(testTmpdir(),'http-review-owner-')),db=new DatabaseSync(join(dir,'synthetic.sqlite'));
 t.after(()=>{try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const journal=new ProductionModelJournal(db,productionCandidateContract(scope),{create:true,worldFingerprint:'a'.repeat(64)}),memory=createMemoryProductionHttp();
 const guard=new ProductionSiliconFlowHttpCandidate(journal,memory.transport,{clock:{now:()=>1000,setTimer:()=>{db.close();return 1;},clearTimer:()=>{}}});
 assert.equal(await guard.complete(messages),null);assert.equal(memory.requests().length,0);assert.equal(guard.status().persistenceHealthy,false);
});
test('review: record scope equality does not depend on JSON key insertion order',()=>{
 const record={schema:1,provider:P.provider,model:P.model,endpoint:P.endpoint,
 scope:{requestTimeoutMs:scope.requestTimeoutMs,deadlineAtMs:scope.deadlineAtMs,createdAtMs:scope.createdAtMs,maxRequests:scope.maxRequests,worldId:scope.worldId,runId:scope.runId},
 authorization:{sourceHash:'a'.repeat(64),dataScope:'fictional-resident-state-memory-relationships-actions',spendingLimitCny:0},
 previousRequest:{requestEvidenceHash:'b'.repeat(64),resolutionEvidenceHash:'c'.repeat(64),billingEvidenceHash:'d'.repeat(64),remoteOutcome:'not-executed',actualCostCny:0,reconciledAtMs:1000},
 pricing:{sourceUrl:'https://www.siliconflow.cn/pricing',sourceHash:'e'.repeat(64),model:P.model,checkedAtMs:1000,validUntilMs:10000,inputCnyPerMillion:0,outputCnyPerMillion:0,otherApplicableChargesCny:0}};
 const result=evaluateProductionHttpAdmission(productionCandidateContract(scope),record,1000);assert.equal(result.allowed,true,JSON.stringify(result));
});

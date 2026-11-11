import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {productionCandidateContract,productionGatedCandidateContract,ProductionModelJournal,modelEvidenceHash} from '../src/server/production-model-journal.js';
import {evaluateProductionHttpAdmission,PRODUCTION_HTTP_LIMITS,type ProductionHttpAdmission} from '../src/server/production-model-admission.js';
import {createGatedSiliconFlowHttp,createMemoryProductionHttp,ProductionSiliconFlowHttpCandidate,preparePinnedSiliconFlowDispatch} from '../src/server/production-model-http.js';
import {PRODUCTION_MODEL_CANDIDATE as P,readProductionModelPolicy} from '../src/server/production-model-policy.js';
const messages=[{role:'user' as const,content:'Synthetic fictional resident only'}],fingerprint='a'.repeat(64);
const input={runId:'synthetic-http',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000};
const reply={model:P.model,choices:[{message:{content:'Synthetic reply 测试'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:3}};
function admission():ProductionHttpAdmission{return {schema:1,provider:'siliconflow',model:P.model,endpoint:P.endpoint,scope:{...input},
 authorization:{sourceHash:'b'.repeat(64),dataScope:'fictional-resident-state-memory-relationships-actions',spendingLimitCny:0},
 previousRequest:{requestEvidenceHash:'c'.repeat(64),resolutionEvidenceHash:'d'.repeat(64),billingEvidenceHash:'e'.repeat(64),remoteOutcome:'completed',actualCostCny:0,reconciledAtMs:900},
 pricing:{sourceUrl:'https://www.siliconflow.cn/pricing',sourceHash:'f'.repeat(64),model:P.model,checkedAtMs:950,validUntilMs:12000,inputCnyPerMillion:0,outputCnyPerMillion:0,otherApplicableChargesCny:0}};}
function fixture(t:TestContext){
 const directory=mkdtempSync(join(testTmpdir(),'production-http-')),path=join(directory,'synthetic.sqlite'),dbs:DatabaseSync[]=[];
 const contract=productionCandidateContract(input),open=(create:boolean,worldFingerprint=fingerprint)=>{
  const db=new DatabaseSync(path);dbs.push(db);return {db,journal:new ProductionModelJournal(db,contract,{create,worldFingerprint})};
 };
 t.after(()=>{for(const db of dbs)try{db.close();}catch{}rmSync(directory,{recursive:true,force:true});});
 t.mock.method(globalThis,'fetch',()=>{throw new Error('network_prohibited');});
 let now=1000,timerId=0;const timers=new Map<number,()=>void>(),clock={now:()=>now,setTimer:(fn:()=>void)=>{timers.set(++timerId,fn);return timerId;},clearTimer:(id:unknown)=>{timers.delete(id as number);}};
 const {db,journal}=open(true),memory=createMemoryProductionHttp(),client=new ProductionSiliconFlowHttpCandidate(journal,memory.transport,{clock});
 function respond(index=0,value:unknown=reply){memory.headers(index);memory.chunk(index,Buffer.from(JSON.stringify(value)));memory.end(index);}
 return {db,journal,contract,path,open,memory,client,clock,respond,setNow:(value:number)=>{now=value;},fire:()=>{for(const fn of [...timers.values()])fn();}};
}
test('live disabled and missing reconciliation reject before credential accessor or any fetch',t=>{
 t.mock.method(globalThis,'fetch',()=>{assert.fail('must not call fetch');});
 let accesses=0;const options={contract:productionCandidateContract(input),get credential():()=>string{accesses++;throw new Error('must_not_read');}};
 assert.throws(()=>createGatedSiliconFlowHttp(options),/live_execution_disabled/);
 const record=admission(),now=Date.now(),contract=productionGatedCandidateContract({...input,createdAtMs:now-1000,deadlineAtMs:now+10000,admissionHash:modelEvidenceHash(record)});
 assert.throws(()=>createGatedSiliconFlowHttp({enableLive:true,contract,admission:undefined,get credential():()=>string{accesses++;throw new Error('must_not_read');}}),/admission_record_invalid|admission_identity_invalid/);
 assert.equal(accesses,0);
});
test('evidence binds current official exact free price, prior resolution/billing and existing permission to immutable run scope',()=>{
 const record=admission(),base=productionCandidateContract(input),result=evaluateProductionHttpAdmission(base,record,1000);assert.equal(result.allowed,true);
 const contract=productionGatedCandidateContract({...input,admissionHash:modelEvidenceHash(record)});
 assert.equal(evaluateProductionHttpAdmission(contract,record,1000).allowed,true);
 const variants:unknown[]=[true,{}, {...record,previousRequest:true},{...record,previousRequest:{...record.previousRequest,actualCostCny:null}},
  {...record,previousRequest:{...record.previousRequest,actualCostCny:1}}, {...record,authorization:{...record.authorization,sourceHash:''}},
  {...record,scope:{...record.scope,runId:'other'}},{...record,pricing:{...record.pricing,model:'paid-model'}},
  {...record,pricing:{...record.pricing,inputCnyPerMillion:1}},{...record,pricing:{...record.pricing,otherApplicableChargesCny:null}},
  {...record,pricing:{...record.pricing,validUntilMs:1000}},{...record,pricing:{...record.pricing,checkedAtMs:1001}},
  {...record,pricing:{...record.pricing,validUntilMs:PRODUCTION_HTTP_LIMITS.priceFreshnessMs+1000}}];
 for(const variant of variants)assert.equal(evaluateProductionHttpAdmission(contract,variant,1000).allowed,false,JSON.stringify(variant));
 assert.equal(evaluateProductionHttpAdmission(contract,{...record,previousRequest:{...record.previousRequest,resolutionEvidenceHash:'0'.repeat(64)}},1000).allowed,false);
 let getterRead=false;assert.equal(evaluateProductionHttpAdmission(contract,{get schema(){getterRead=true;return 1;}},1000).allowed,false);assert.equal(getterRead,false);
});
test('fake HTTP uses FULL intent then pinned request, bounded Unicode response and world acknowledgment; never claims billing',async t=>{
 const f=fixture(t),pending=f.client.complete(messages),request=f.memory.requests()[0];
 assert.equal(f.journal.status().pending?.phase,'intent');assert.equal(f.journal.status().attempts,1);
 assert.equal(request.endpoint,P.endpoint);assert.equal(request.redirect,'error');assert.equal(request.method,'POST');
 const body=JSON.parse(request.body);assert.equal(body.model,P.model);assert.equal(body.stream,false);assert.equal(body.max_tokens,512);
 const bytes=Buffer.from(JSON.stringify(reply));f.memory.headers(0,{contentLength:String(bytes.length)});
 for(let i=0;i<bytes.length;i++)f.memory.chunk(0,bytes.subarray(i,i+1));f.memory.end(0);
 const result=await pending;assert.ok(result);assert.equal(result.reply.content,reply.choices[0].message.content);
 assert.equal(f.client.status().pending?.phase,'response');assert.equal(f.client.status().actualProviderCostCny,null);
 assert.equal(f.client.status().realModelExecuted,false);assert.equal(f.client.status().liveExecutionEnabled,false);assert.equal(f.client.status().readyForProduction,false);
 assert.equal(f.client.acknowledgeWorldCommit(result.id,'b'.repeat(64)),true);
 assert.equal(f.client.status().completed,1);assert.equal(readFileSync(f.path).includes(Buffer.from(reply.choices[0].message.content)),false);
});
for(const status of [301,401,402,403,429,500])test(`HTTP ${status} locks once, never retries and restart preserves pending`,async t=>{
 const f=fixture(t),pending=f.client.complete(messages);f.memory.headers(0,{status});assert.equal(await pending,null);
 assert.equal(await f.client.complete(messages),null);assert.equal(f.memory.requests().length,1);assert.ok(f.journal.status().pending);
 f.db.close();const reopened=f.open(false),memory=createMemoryProductionHttp(),again=new ProductionSiliconFlowHttpCandidate(reopened.journal,memory.transport,{clock:f.clock});
 assert.equal(await again.complete(messages),null);assert.equal(memory.requests().length,0);assert.equal(again.status().attempts,1);
});
for(const bad of [{url:'https://example.test/v1/chat/completions'},{redirected:true},{contentType:'text/html'},{contentLength:'-1'},{contentLength:'128001'}])
 test(`invalid HTTP header is discarded: ${JSON.stringify(bad)}`,async t=>{
  const f=fixture(t),pending=f.client.complete(messages);f.memory.headers(0,bad);assert.equal(await pending,null);assert.equal(f.journal.status().pending?.phase,'intent');assert.equal(f.memory.requests().length,1);
 });
test('stalled headers return at timeout, discarded late headers cannot clear pending',async t=>{
 const f=fixture(t),pending=f.client.complete(messages);f.setNow(2000);f.fire();assert.equal(await pending,null);
 assert.equal(f.memory.requests()[0].signal.aborted,true);f.memory.headers(0);await Promise.resolve();assert.equal(f.memory.bodyCancelled(0),true);
 assert.equal(f.client.status().pending?.phase,'intent');assert.equal(f.client.status().remoteCancellationConfirmed,false);
});
test('stalled stream aborts and late body cannot become an accepted response',async t=>{
 const f=fixture(t),pending=f.client.complete(messages);f.memory.headers(0);await Promise.resolve();await Promise.resolve();
 f.setNow(2000);f.fire();assert.equal(await pending,null);assert.equal(f.memory.bodyCancelled(0),true);assert.equal(f.client.status().observedResponses,0);
});
test('late response microtask cannot outrun elapsed deadline and cleared timer',async t=>{
 const f=fixture(t),pending=f.client.complete(messages);f.setNow(2000);f.respond();assert.equal(await pending,null);assert.equal(f.client.status().failure,'request_timeout');
});
for(const scenario of ['network-reject','body-reject','missing-body','invalid-json','oversized','wrong-length','wrong-model','missing-usage','length-finish','many-choices'])
 test(`${scenario} stays unresolved with no retry`,async t=>{
  const f=fixture(t),pending=f.client.complete(messages);
  if(scenario==='network-reject')f.memory.reject(0);
  else if(scenario==='missing-body')f.memory.headers(0,{},false);
  else if(scenario==='body-reject'){f.memory.headers(0);f.memory.failBody(0);}
  else if(scenario==='oversized'){f.memory.headers(0);f.memory.chunk(0,new Uint8Array(PRODUCTION_HTTP_LIMITS.maxResponseBytes+1));f.memory.end(0);}
  else if(scenario==='invalid-json'){f.memory.headers(0);f.memory.chunk(0,Buffer.from('{'));f.memory.end(0);}
  else if(scenario==='wrong-length'){f.memory.headers(0,{contentLength:'1'});f.memory.chunk(0,Buffer.from(JSON.stringify(reply)));f.memory.end(0);}
  else if(scenario==='wrong-model')f.respond(0,{...reply,model:'paid-model'});
  else if(scenario==='missing-usage')f.respond(0,{...reply,usage:undefined});
  else if(scenario==='length-finish')f.respond(0,{...reply,choices:[{...reply.choices[0],finish_reason:'length'}]});
  else f.respond(0,{...reply,choices:[...reply.choices,...reply.choices]});
  assert.equal(await pending,null);assert.equal(f.client.status().pending?.phase,'intent');assert.equal(await f.client.complete(messages),null);assert.equal(f.memory.requests().length,1);
 });
test('intent write failure prevents HTTP, response write failure withholds decision, corrupt journal cannot reopen',async t=>{
 const a=fixture(t);a.db.exec('PRAGMA query_only=ON');assert.equal(await a.client.complete(messages),null);assert.equal(a.memory.requests().length,0);
 const b=fixture(t),pending=b.client.complete(messages);b.db.exec('PRAGMA query_only=ON');b.respond();assert.equal(await pending,null);assert.equal(b.client.status().persistenceHealthy,false);
 b.db.close();const resumed=b.open(false);assert.equal(resumed.journal.status().failure,'unresolved_request_no_retry');
 const c=fixture(t);c.db.exec("UPDATE production_model_audit SET body='{}' WHERE sequence=1");c.db.close();assert.throws(()=>c.open(false),/journal_invalid/);
});
test('parallel calls, unsupported model, preabort and wall/clock limits fail closed',async t=>{
 const a=fixture(t),pending=a.client.complete(messages);assert.equal(await a.client.complete(messages),null);assert.equal(await pending,null);assert.equal(a.memory.requests().length,1);
 const b=fixture(t);assert.equal(await b.client.complete(messages,{model:'paid'}),null);assert.equal(b.memory.requests().length,0);
 const c=fixture(t);assert.equal(await c.client.complete(messages,{signal:AbortSignal.abort()}),null);assert.equal(c.memory.requests().length,0);
 const d=fixture(t);d.setNow(11000);assert.equal(await d.client.complete(messages),null);assert.equal(d.memory.requests().length,0);
 const e=fixture(t);e.setNow(999);assert.equal(await e.client.complete(messages),null);assert.equal(e.memory.requests().length,0);
});
test('success keeps world ack mandatory and cumulative request cap across reopened journal',async t=>{
 const f=fixture(t),a=f.client.complete(messages);f.respond();const first=await a;assert.ok(first);assert.equal(f.client.acknowledgeWorldCommit(first.id,fingerprint),true);
 f.db.close();const resumed=f.open(false),memory=createMemoryProductionHttp(),again=new ProductionSiliconFlowHttpCandidate(resumed.journal,memory.transport,{clock:f.clock});
 const b=again.complete(messages);memory.headers(0);memory.chunk(0,Buffer.from(JSON.stringify(reply)));memory.end(0);const second=await b;assert.ok(second);
 assert.equal(again.acknowledgeWorldCommit(second.id,fingerprint),true);assert.equal(await again.complete(messages),null);assert.equal(memory.requests().length,1);assert.equal(again.status().failure,'request_limit');
 const noAck=fixture(t),uncommitted=noAck.client.complete(messages);noAck.respond();assert.ok(await uncommitted);
 assert.equal(await noAck.client.complete(messages),null);assert.equal(noAck.memory.requests().length,1);assert.equal(noAck.client.status().failure,'unresolved_request_no_retry');
});
test('gated journals never claim real execution false after intent; synthetic transport cannot use one; main remains disabled',t=>{
 const dir=mkdtempSync(join(testTmpdir(),'gated-journal-')),path=join(dir,'synthetic.sqlite'),db=new DatabaseSync(path);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const record=admission(),contract=productionGatedCandidateContract({...input,admissionHash:modelEvidenceHash(record)});
 const journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:fingerprint});
 assert.throws(()=>new ProductionSiliconFlowHttpCandidate(journal,createMemoryProductionHttp().transport),/transport_journal_mismatch/);
 journal.intent('0'.repeat(64),1000);assert.equal(journal.status().realModelExecuted,null);assert.equal(journal.status().actualProviderCostCny,null);
 assert.equal(readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:P.provider,VALLEY_MODEL_ID:P.model}).liveExecutionEnabled,false);
});

test('pure live-request preparation pins HTTP options and rechecks state after synthetic credential access without network',t=>{
 t.mock.method(globalThis,'fetch',()=>{assert.fail('no network');});
 const order:string[]=[],signal=new AbortController().signal,body='synthetic-body';
 const prepared=preparePinnedSiliconFlowDispatch({body,signal},()=>{order.push('credential');return 'SYNTHETIC-NOT-A-CREDENTIAL';},()=>{order.push('guard');});
 assert.deepEqual(order,['credential','guard']);assert.equal(prepared.endpoint,P.endpoint);assert.equal(prepared.init.method,'POST');
 assert.equal(prepared.init.redirect,'error');assert.equal(prepared.init.credentials,'omit');assert.equal(prepared.init.cache,'no-store');assert.equal(prepared.init.referrerPolicy,'no-referrer');
 assert.equal(prepared.init.body,body);assert.equal(prepared.init.signal,signal);assert.equal(prepared.init.headers.Authorization,'Bearer SYNTHETIC-NOT-A-CREDENTIAL');
 let credentialComplete=false;
 assert.throws(()=>preparePinnedSiliconFlowDispatch({body,signal},()=>{credentialComplete=true;return 'SYNTHETIC';},()=>{assert.equal(credentialComplete,true);throw new Error('production_journal_owner_lost');}),/production_journal_owner_lost/);
 assert.throws(()=>preparePinnedSiliconFlowDispatch({body,signal},()=>{throw new Error('synthetic_secret_that_must_not_escape');},()=>{}),/^Error: credential_unavailable$/);
 assert.throws(()=>preparePinnedSiliconFlowDispatch({body,signal},()=>'',()=>{}),/^Error: credential_invalid$/);
 const controller=new AbortController();assert.throws(()=>preparePinnedSiliconFlowDispatch({body,signal:controller.signal},()=>{controller.abort();return 'SYNTHETIC';},()=>{}),/^Error: signal$/);
});

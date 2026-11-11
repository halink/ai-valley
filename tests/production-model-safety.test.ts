import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {readProductionModelPolicy,PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
import {ProductionModelJournal,productionCandidateContract,modelEvidenceHash as hash} from '../src/server/production-model-journal.js';
import {ProductionModelCandidate,createMemoryProductionTransport} from '../src/server/production-model-candidate.js';
import {createObserverServer} from '../src/server/http.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
const firstHash='a'.repeat(64),secondHash='b'.repeat(64);
const messages=[{role:'user' as const,content:'Synthetic decision only'}];
const response=(status=200)=>({status,model:P.model,endpoint:P.endpoint,reply:{content:'{"choice":"1"}',finish:'stop',usage:{prompt_tokens:10,completion_tokens:5}}});
function fixture(t:TestContext,overrides:Partial<Parameters<typeof productionCandidateContract>[0]>={}){
 const directory=mkdtempSync(join(testTmpdir(),'production-model-')),path=join(directory,'synthetic.sqlite');
 const contract=productionCandidateContract({runId:'synthetic-run',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000,...overrides});
 const connections:DatabaseSync[]=[];
 const open=(create:boolean,worldFingerprint=firstHash)=>{
  const db=new DatabaseSync(path);connections.push(db);return {db,journal:new ProductionModelJournal(db,contract,{create,worldFingerprint})};
 };
 t.after(()=>{for(const db of connections){try{db.close();}catch{}}rmSync(directory,{recursive:true,force:true});});
 const initial=open(true);
 let now=1000,next=0;const timers=new Map<number,()=>void>();
 const clock={now:()=>now,setTimer:(fn:()=>void,_ms:number)=>{timers.set(++next,fn);return next;},clearTimer:(id:unknown)=>{timers.delete(id as number);}};
 const memory=createMemoryProductionTransport(),guard=new ProductionModelCandidate(initial.journal,memory.transport,{clock});
 return {...initial,open,path,contract,guard,memory,clock,timers,setNow:(value:number)=>{now=value;},fire:()=>{for(const fn of [...timers.values()])fn();}};
}
test('production gate does not read credentials or accept env assertions as authority',()=>{
 const env=new Proxy({} as Record<string,string|undefined>,{get(_target,key){assert.equal(key,'VALLEY_MODEL_MODE');return undefined;}});
 assert.equal(readProductionModelPolicy(env).state,'no-model');
 for(const mode of ['true','qwen','siliconflow-free-only']){
  const p=readProductionModelPolicy({VALLEY_MODEL_MODE:mode,VALLEY_MODEL_PROVIDER:'siliconflow',VALLEY_MODEL_ID:P.model,SILICONFLOW_API_KEY:'SYNTHETIC',VALLEY_FREE_CONFIRMED:'true'});
  assert.equal(p.state,'blocked');assert.equal(p.liveExecutionEnabled,false);assert.equal(p.actualProviderCostCny,null);
 }
 assert.equal(readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:'qwen'}).reason,'single_siliconflow_provider_required');
});
test('contract pins one provider and model with finite explicit lifetime and request bounds',()=>{
 const base={runId:'fake',worldId:'fake',maxRequests:1,createdAtMs:1000,deadlineAtMs:3000,requestTimeoutMs:1000};
 const p=productionCandidateContract(base);assert.equal(p.model,P.model);assert.equal(p.retries,0);assert.equal(p.fallback,null);assert.equal(p.spendingLimitCny,0);
 for(const patch of [{maxRequests:Infinity},{maxRequests:0},{maxRequests:20_001},{deadlineAtMs:1000},{deadlineAtMs:1000+6*60*60_000+1},{requestTimeoutMs:0}])assert.throws(()=>productionCandidateContract({...base,...patch}),/contract_invalid/);
});
test('FULL intent precedes transport, response alone blocks another call, and no cost is inferred',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',()=>{throw new Error('network prohibited');});
 const result=f.guard.complete(messages);assert.equal(f.memory.requests().length,1);
 const rows=f.db.prepare('SELECT body FROM production_model_audit ORDER BY sequence').all();
 assert.equal(rows.length,2);assert.equal(JSON.parse(String(rows[1].body)).type,'intent');
 f.memory.respond(0,response());const reply=await result;assert.ok(reply);assert.equal(f.journal.status().pending?.phase,'response');
 assert.equal(f.guard.status().actualProviderCostCny,null);assert.equal(f.guard.status().realModelExecuted,false);
 assert.equal(await f.guard.complete(messages),null);assert.equal(f.memory.requests().length,1);assert.equal(f.guard.status().failure,'unresolved_request_no_retry');
 assert.equal(readFileSync(f.path).includes(Buffer.from('Synthetic decision only')),false);
});
test('matched durable world acknowledgment releases one slot and preserves cumulative cap across restart',async t=>{
 const f=fixture(t);const first=f.guard.complete(messages);f.memory.respond(0,response());const a=await first;assert.ok(a);assert.equal(f.guard.acknowledgeWorldCommit(a.id,secondHash),true);
 f.db.close();const reopened=f.open(false,secondHash),memory=createMemoryProductionTransport(),guard=new ProductionModelCandidate(reopened.journal,memory.transport,{clock:f.clock});
 const second=guard.complete(messages);memory.respond(0,response());const b=await second;assert.ok(b);assert.equal(b.id,2);assert.equal(guard.acknowledgeWorldCommit(b.id,firstHash),true);
 assert.equal(await guard.complete(messages),null);assert.equal(guard.status().attempts,2);assert.equal(guard.status().failure,'request_limit');assert.equal(memory.requests().length,1);
});
for(const status of [401,402,403,429,500])test(`${status} permanently locks without retry or fallback, including after restart`,async t=>{
 const f=fixture(t),result=f.guard.complete(messages);f.memory.respond(0,response(status));assert.equal(await result,null);
 assert.equal(await f.guard.complete(messages),null);assert.equal(f.memory.requests().length,1);assert.ok(f.journal.status().pending);
 f.db.close();const reopened=f.open(false),memory=createMemoryProductionTransport(),again=new ProductionModelCandidate(reopened.journal,memory.transport,{clock:f.clock});
 assert.equal(await again.complete(messages),null);assert.equal(memory.requests().length,0);assert.equal(reopened.journal.status().attempts,1);
});
test('timeout returns despite ignored abort and discards late response with unresolved intent retained',async t=>{
 const f=fixture(t),promise=f.guard.complete(messages);f.setNow(2000);f.fire();assert.equal(await promise,null);
 assert.equal(f.memory.requests()[0].signal.aborted,true);f.memory.respond(0,response());await Promise.resolve();
 assert.equal(f.guard.status().completed,0);assert.equal(f.guard.status().pending?.phase,'intent');assert.equal(f.guard.status().remoteCancellationConfirmed,false);
 assert.equal(await f.guard.complete(messages),null);assert.equal(f.memory.requests().length,1);
});
test('response microtask after timeout does not race past an unrun timer',async t=>{
 const f=fixture(t),pending=f.guard.complete(messages);f.setNow(2000);f.memory.respond(0,response());assert.equal(await pending,null);
 assert.equal(f.guard.status().failure,'request_timeout');assert.equal(f.guard.status().pending?.phase,'intent');
});
test('crash after intent or response cannot reopen as a fresh budget',t=>{
 for(const withResponse of [false,true]){
  const f=fixture(t),id=f.journal.intent(hash('synthetic request'),1000);if(withResponse)f.journal.response(id,hash('synthetic response'),1000);f.db.close();
  const resumed=f.open(false);assert.equal(resumed.journal.status().failure,'unresolved_request_no_retry');assert.equal(resumed.journal.status().attempts,1);
  assert.throws(()=>resumed.journal.intent(hash('new'),1000),/unresolved_request_no_retry/);
 }
});
test('failed intent commit, competing owner, and damaged audit cannot dispatch',async t=>{
 const f=fixture(t);f.db.exec('PRAGMA query_only=ON');assert.equal(await f.guard.complete(messages),null);assert.equal(f.memory.requests().length,0);assert.equal(f.guard.status().persistenceHealthy,false);
 const g=fixture(t);assert.throws(()=>g.open(false),/journal_owner_active/);
 g.db.exec("UPDATE production_model_audit SET body='{}' WHERE sequence=1");g.db.close();assert.throws(()=>g.open(false),/journal_invalid/);
});
test('budget identity, world identity, and absolute deadline do not reset on restart',async t=>{
 const altered=fixture(t);altered.db.close();const changed=new DatabaseSync(altered.path);
 try{assert.throws(()=>new ProductionModelJournal(changed,{...altered.contract,maxRequests:3},{create:false,worldFingerprint:firstHash}),/journal_invalid/);}finally{changed.close();}
 assert.throws(()=>altered.open(false,secondHash),/world_mismatch/);
 const f=fixture(t);
 f.setNow(11000);assert.equal(await f.guard.complete(messages),null);assert.equal(f.memory.requests().length,0);assert.equal(f.guard.status().failure,'wall_limit');
});
test('clock rollback, unsupported model, parallel calls, and stop each fail closed',async t=>{
 const clock=fixture(t);clock.setNow(999);assert.equal(await clock.guard.complete(messages),null);assert.equal(clock.memory.requests().length,0);
 const wrong=fixture(t);assert.equal(await wrong.guard.complete(messages,{model:'qwen3.8-flash'}),null);assert.equal(wrong.memory.requests().length,0);
 const parallel=fixture(t),pending=parallel.guard.complete(messages);assert.equal(await parallel.guard.complete(messages),null);assert.equal(await pending,null);assert.equal(parallel.memory.requests().length,1);
 const stopped=fixture(t),promise=stopped.guard.complete(messages);stopped.guard.stop();assert.equal(await promise,null);assert.equal(stopped.guard.status().pending?.phase,'intent');
});
test('no arbitrary function transport or altered model response can bypass the memory-only gate',async t=>{
 const f=fixture(t);assert.throws(()=>new ProductionModelCandidate(f.journal,{kind:'memory-production-candidate'}),/synthetic_transport_required/);
 const pending=f.guard.complete(messages);f.memory.respond(0,{...response(),model:'paid-fallback'});assert.equal(await pending,null);assert.equal(f.guard.status().failure,'response_identity_mismatch');
});
for(const mode of ['intent','response'])test(`SIGKILL after durable ${mode} leaves no automatic restart dispatch`,{timeout:10_000},async t=>{
 const f=fixture(t);f.db.close();
 const child=spawn(process.execPath,['--import','tsx','tests/fixtures/production-model-crash.mjs',f.path,mode],{
  cwd:process.cwd(),env:{HOME:testTmpdir(),TMPDIR:testTmpdir(),TMP:testTmpdir(),TEMP:testTmpdir()},stdio:['ignore','ignore','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const failed=once(child,'exit').then(([code,signal])=>{throw new Error(`fixture exited before intent: ${code}/${signal}`);});
 const [message]=await Promise.race([once(child,'message'),failed]);assert.equal(message,'durable');
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const reopened=f.open(false),memory=createMemoryProductionTransport(),guard=new ProductionModelCandidate(reopened.journal,memory.transport,{clock:f.clock});
 assert.equal(await guard.complete(messages),null);assert.equal(memory.requests().length,0);assert.equal(guard.status().attempts,1);assert.equal(guard.status().pending?.phase,mode);
});
test('health separates observer liveness from blocked or absent production model without opening a socket',()=>{
 for(const mode of [undefined,'siliconflow-free-only']){
  const policy=readProductionModelPolicy({VALLEY_MODEL_MODE:mode,VALLEY_MODEL_PROVIDER:'siliconflow',VALLEY_MODEL_ID:P.model});
  const store=new WorldStore(':memory:'),runtime=new ValleyRuntime(store,null),server=createObserverServer(runtime,store,'dist',createServer(),policy);
  let body='';const res={setHeader(){},writeHead(status:number){assert.equal(status,200);},end(value:string){body=value;}};
  server.emit('request',{method:'GET',url:'/ai-town/api/health',headers:{}},res);
  const health=JSON.parse(body);assert.equal(health.ok,true);assert.equal(health.ready,false);assert.equal(health.modelConfigured,false);assert.equal(health.modelExecution.state,mode?'blocked':'no-model');
  assert.equal(health.modelExecution.actualProviderCostCny,null);server.emit('close');runtime.stop();store.close();
 }
});

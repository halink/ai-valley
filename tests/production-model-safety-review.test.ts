import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {DatabaseSync} from 'node:sqlite';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {ProductionModelCandidate,createMemoryProductionTransport} from '../src/server/production-model-candidate.js';

test('review: another owner durably blocks the journal before transport dispatch', async t=>{
 const directory=mkdtempSync(join(testTmpdir(),'ownership-')),path=join(directory,'synthetic.sqlite');
 const db=new DatabaseSync(path),other=new DatabaseSync(path),worldFingerprint='a'.repeat(64);
 t.after(()=>{db.close();other.close();rmSync(directory,{recursive:true,force:true});});
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint});
 let recovered:ProductionModelJournal|undefined,ownerError:unknown;
 const memory=createMemoryProductionTransport();
 const guard=new ProductionModelCandidate(journal,memory.transport,{clock:{now:()=>1000,setTimer:()=>{
  // Deterministically interleave the second owner between intent commit and dispatch.
  try{recovered=new ProductionModelJournal(other,contract,{create:false,worldFingerprint});}catch(error){ownerError=error;}
  return 1;
 },clearTimer:()=>{}}});
 const pending=guard.complete([{role:'user',content:'Synthetic only'}]);
 const count=memory.requests().length;
 guard.stop();await pending;
 if(recovered){
  assert.equal(recovered.status().failure,'unresolved_request_no_retry');
  assert.equal(count,0,'a persisted owner/recovery block must prevent dispatch');
 }else{
  assert.match(String(ownerError),/production_journal_owner_active/);
  assert.equal(count,1,'the exclusive owner may dispatch its one authorized synthetic request');
 }
});

test('review: response journal write failure discards reply and restart stays blocked',async t=>{
 const directory=mkdtempSync(join(testTmpdir(),'response-failure-')),path=join(directory,'synthetic.sqlite');
 const db=new DatabaseSync(path),worldFingerprint='a'.repeat(64);
 t.after(()=>{try{db.close();}catch{}rmSync(directory,{recursive:true,force:true});});
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint}),memory=createMemoryProductionTransport();
 const guard=new ProductionModelCandidate(journal,memory.transport,{clock:{now:()=>1000,setTimer:()=>1,clearTimer:()=>{}}});
 const pending=guard.complete([{role:'user',content:'Synthetic only'}]);
 const request=memory.requests()[0];
 db.exec('PRAGMA query_only=ON');
 memory.respond(0,{status:200,model:request.model,endpoint:request.endpoint,reply:{content:'Synthetic reply',finish:'stop',usage:{prompt_tokens:1,completion_tokens:1}}});
 assert.equal(await pending,null);assert.equal(guard.status().persistenceHealthy,false);
 assert.equal(guard.status().pending?.phase,'intent');assert.equal(guard.status().actualProviderCostCny,null);
 db.close();const reopened=new DatabaseSync(path);t.after(()=>reopened.close());
 const recovered=new ProductionModelJournal(reopened,contract,{create:false,worldFingerprint});
 assert.equal(recovered.status().failure,'unresolved_request_no_retry');
 assert.equal(recovered.status().attempts,1);
});


test('review: exclusive ownership survives commits across real processes and releases on close',t=>{
 const directory=mkdtempSync(join(testTmpdir(),'process-owner-')),path=join(directory,'synthetic.sqlite');
 const db=new DatabaseSync(path),worldFingerprint='a'.repeat(64);
 t.after(()=>{try{db.close();}catch{}rmSync(directory,{recursive:true,force:true});});
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint});
 const moduleUrl=new URL('../src/server/production-model-journal.ts',import.meta.url).href;
 const child=()=>spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',`
  import {DatabaseSync} from 'node:sqlite';
  import {ProductionModelJournal} from ${JSON.stringify(moduleUrl)};
  const db=new DatabaseSync(${JSON.stringify(path)});
  try{const j=new ProductionModelJournal(db,${JSON.stringify(contract)},{create:false,worldFingerprint:${JSON.stringify(worldFingerprint)}});console.log(JSON.stringify({opened:true,status:j.status()}));}
  catch(error){console.log(JSON.stringify({opened:false,error:error.message}));}
  finally{db.close();}
 `],{env:{PATH:process.env.PATH!,HOME:directory,TMPDIR:directory},encoding:'utf8',timeout:10000});
 const inspect=()=>{const result=child();assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
 let result=inspect();assert.equal(result.opened,false);assert.equal(result.error,'production_journal_owner_active');
 journal.intent('b'.repeat(64),1000);
 result=inspect();assert.equal(result.opened,false);assert.equal(result.error,'production_journal_owner_active');
 db.close();
 result=inspect();assert.equal(result.opened,true);assert.equal(result.status.failure,'unresolved_request_no_retry');assert.equal(result.status.attempts,1);assert.equal(result.status.actualProviderCostCny,null);
});

test('review: a shared database handle cannot create a second journal owner',t=>{
 const directory=mkdtempSync(join(testTmpdir(),'same-handle-')),path=join(directory,'synthetic.sqlite');
 const db=new DatabaseSync(path),worldFingerprint='a'.repeat(64);
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint});
 assert.throws(()=>new ProductionModelJournal(db,contract,{create:false,worldFingerprint}),/production_journal_owner_active/);
 assert.equal(journal.status().failure,null);
});

test('review: killed owner releases its lock but never replenishes pending request budget',async t=>{
 const directory=mkdtempSync(join(testTmpdir(),'killed-owner-')),path=join(directory,'synthetic.sqlite'),worldFingerprint='a'.repeat(64);
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const moduleUrl=new URL('../src/server/production-model-journal.ts',import.meta.url).href;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',`
  import {DatabaseSync} from 'node:sqlite';
  import {ProductionModelJournal} from ${JSON.stringify(moduleUrl)};
  const db=new DatabaseSync(${JSON.stringify(path)});
  const journal=new ProductionModelJournal(db,${JSON.stringify(contract)},{create:true,worldFingerprint:${JSON.stringify(worldFingerprint)}});
  journal.intent('b'.repeat(64),1000);
  process.kill(process.pid,'SIGKILL');
 `],{env:{PATH:process.env.PATH!,HOME:directory,TMPDIR:directory},encoding:'utf8',timeout:10000});
 assert.equal(result.signal,'SIGKILL',result.stderr);
 const db=new DatabaseSync(path);t.after(()=>db.close());
 const journal=new ProductionModelJournal(db,contract,{create:false,worldFingerprint}),memory=createMemoryProductionTransport();
 const guard=new ProductionModelCandidate(journal,memory.transport,{clock:{now:()=>1000,setTimer:()=>1,clearTimer:()=>{}}});
 assert.equal(guard.status().phase,'blocked');
 assert.equal(guard.status().attempts,1);
 assert.equal(await guard.complete([{role:'user',content:'Synthetic only'}]),null);
 assert.equal(memory.requests().length,0);assert.equal(guard.status().actualProviderCostCny,null);
});

test('review: losing the SQLite handle after intent prevents transport dispatch',async t=>{
 const directory=mkdtempSync(join(testTmpdir(),'closed-owner-')),path=join(directory,'synthetic.sqlite'),worldFingerprint='a'.repeat(64);
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const db=new DatabaseSync(path),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint}),memory=createMemoryProductionTransport();
 t.after(()=>{try{db.close();}catch{}});
 const guard=new ProductionModelCandidate(journal,memory.transport,{clock:{now:()=>1000,setTimer:()=>{db.close();return 1;},clearTimer:()=>{}}});
 const pending=guard.complete([{role:'user',content:'Synthetic only'}]);
 const count=memory.requests().length;guard.stop();await pending;
 assert.equal(count,0,'closed SQLite handle has relinquished the exclusive owner lock');
 assert.equal(guard.status().phase,'blocked');assert.equal(guard.status().persistenceHealthy,false);
});

test('review: downgraded exclusive-lock contract prevents transport dispatch',async t=>{
 const directory=mkdtempSync(join(testTmpdir(),'downgraded-owner-')),path=join(directory,'synthetic.sqlite'),worldFingerprint='a'.repeat(64);
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const contract=productionCandidateContract({runId:'synthetic-review',worldId:'synthetic-world',maxRequests:2,createdAtMs:1000,deadlineAtMs:11000,requestTimeoutMs:1000});
 const db=new DatabaseSync(path),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint}),memory=createMemoryProductionTransport();
 t.after(()=>db.close());
 const guard=new ProductionModelCandidate(journal,memory.transport,{clock:{now:()=>1000,setTimer:()=>{db.exec('PRAGMA locking_mode=NORMAL; SELECT count(*) FROM production_model_audit');return 1;},clearTimer:()=>{}}});
 const pending=guard.complete([{role:'user',content:'Synthetic only'}]);
 const count=memory.requests().length;guard.stop();await pending;
 assert.equal(count,0,'the exclusive owner contract must still hold immediately before dispatch');
 assert.equal(guard.status().phase,'blocked');assert.equal(guard.status().persistenceHealthy,false);
});

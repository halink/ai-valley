import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {SyntheticLaunchLedger} from '../src/server/production-model-process-ledger.js';
import {syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {processFixture,ownProcessIdentity} from './helpers/production-process-fixture.js';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),boot='00000000-0000-4000-8000-000000000000';
function ledgerFixture(t:TestContext,maxSegments=3){
 const dir=mkdtempSync(join(testTmpdir(),'launch-ledger-')),path=join(dir,'launch.sqlite');let db=new DatabaseSync(path);
 const contract=syntheticPriceSessionContract({runId:'synthetic-launch',worldId:'world:test',sourceFingerprint:A,fixtureScopeHash:B,createdAtMs:1000,deadlineAtMs:1000000,maxRequests:20,
  requestTimeoutMs:5000,commitGraceMs:1000,maxSegments,maxEpochs:10,maxAuditRecords:60002});
 const options={create:true,worldFingerprint:A,sessionHash:B,journalHash:C,nowMs:1000,monotonicNs:'1000000'};
 let ledger=new SyntheticLaunchLedger(db,contract,boot,options);
 t.after(()=>{try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const reserve=(at=1001)=>{const s=ledger.status(),mono=String(BigInt(at)*1000000n);return ledger.reserve({worldFingerprint:s.worldFingerprint,attempts:s.attempts,completed:s.completed,
  previousSessionHash:s.sessionHash,sessionHash:B,journalHash:s.journalHash,evidenceHash:C,startedAtMs:at,deadlineAtMs:at+30000,startedMonotonicNs:mono,deadlineMonotonicNs:String(BigInt(mono)+30000000000n)});};
 return {get db(){return db;},get ledger(){return ledger;},path,contract,reserve,
  reopen(nowMs=1002){db.close();db=new DatabaseSync(path);ledger=new SyntheticLaunchLedger(db,contract,boot,{...options,create:false,nowMs,monotonicNs:String(BigInt(nowMs)*1000000n)});return ledger;}};
}
test('launch budget is durable before spawn and unfinished allocation is never refunded or resumed',t=>{
 const f=ledgerFixture(t);assert.equal(f.reserve().id,1);assert.equal(f.ledger.status().reservedWallMs,30000);
 const again=f.reopen();assert.equal(again.status().failure,'launch_unresolved_no_retry');assert.equal(again.status().launches,1);
 assert.equal(again.status().reservedWallMs,30000);assert.throws(()=>f.reserve(1003));assert.equal(again.status().pending?.id,1);
});
test('clean launches bind updated audit tips and consume original limits across reopen',t=>{
 const f=ledgerFixture(t,2);f.reserve();f.ledger.finish({id:1,worldFingerprint:B,attempts:1,completed:1,sessionHash:A,journalHash:B,reportHash:C,at:1002,monotonicNs:'1002000000'});
 f.reopen(1003);assert.equal(f.ledger.status().lastReportHash,C);assert.equal(f.ledger.status().sessionHash,A);f.reserve(1004);
 f.ledger.finish({id:2,worldFingerprint:C,attempts:2,completed:2,sessionHash:B,journalHash:A,reportHash:C,at:1005,monotonicNs:'1005000000'});
 assert.equal(f.ledger.status().reservedWallMs,60000);assert.equal(f.ledger.contract.deadlineAtMs,1000000);assert.throws(()=>f.reserve(1006));assert.equal(f.ledger.status().launches,2);
});
test('active launch ledger excludes another connection and restoration cannot revive lost ownership',t=>{
 const f=ledgerFixture(t);const other=new DatabaseSync(f.path);try{assert.throws(()=>new SyntheticLaunchLedger(other,f.contract,boot,{create:false,worldFingerprint:A,sessionHash:B,journalHash:C,nowMs:1000,monotonicNs:'1000000'}));}finally{other.close();}
 f.db.exec('PRAGMA synchronous=OFF');assert.throws(()=>f.reserve(),/owner_lost/);f.db.exec('PRAGMA synchronous=FULL');assert.throws(()=>f.reserve(),/unusable/);
});
test('original hard cutoff and monotonic rollback block without awarding another launch',t=>{
 const f=ledgerFixture(t);assert.throws(()=>f.ledger.check(1000000,'2000000'),/time_invalid/);assert.equal(f.ledger.status().launches,0);assert.ok(f.ledger.status().failure);
});
test('normal fixed worker completes two supervised segments without resetting time or requests',{timeout:45000},async t=>{
 const f=processFixture(t),first=await f.launch().done;assert.equal(first.code,0,first.stderr+JSON.stringify(first.messages));
 const one=first.messages.find(m=>m.type==='synthetic_process_finished');assert.equal(one.finished,1);assert.equal(one.attempts,1);assert.equal(one.reservedWallMs,30000);
 const original=JSON.parse(readFileSync(join(f.path,'manifest.json'),'utf8')).contract;
 const second=await f.launch('normal','resume').done;assert.equal(second.code,0,second.stderr+JSON.stringify(second.messages));
 const two=second.messages.find(m=>m.type==='synthetic_process_finished');assert.equal(two.finished,2);assert.equal(two.attempts,2);assert.equal(two.reservedWallMs,60000);
 assert.deepEqual(JSON.parse(readFileSync(join(f.path,'manifest.json'),'utf8')).contract,original);
 const result=JSON.parse(readFileSync(join(f.path,'process-2.json'),'utf8'));assert.equal(result.observation.process.exit.observed,true);
 assert.equal(result.observation.process.groupState,'absent');assert.equal(result.readyForProduction,false);assert.equal(result.actualProviderCostCny,null);
});
for(const scenario of ['crash_reserved','watchdog_missing','crash_intent','crash_response','crash_ack','crash_seal'] as const)
 test(`${scenario} consumes startup reservation and cannot restart an uncertain supervised run`,{timeout:45000},async t=>{
  const f=processFixture(t),first=await f.launch(scenario).done;assert.notEqual(first.code,0,JSON.stringify(first.messages));
  const db=new DatabaseSync(join(f.path,'launch.sqlite'));try{const rows=db.prepare('SELECT body FROM synthetic_launch_audit ORDER BY sequence').all() as {body:string}[];
   assert.equal(rows.map(r=>JSON.parse(r.body)).filter(e=>e.type==='reserved').length,1);}finally{db.close();}
  const again=await f.launch('normal','resume').done;assert.notEqual(again.code,0);assert.equal(again.messages.some(m=>m.type==='synthetic_watchdog_started'),false);
  const status=again.messages.find(m=>m.type==='synthetic_process_blocked')?.status;assert.equal(status?.launches,1);assert.equal(status?.reservedWallMs,30000);assert.ok(status?.failure);
 });
test('real wall deadline kills a fixed synchronously blocked worker, including startup time',{timeout:45000},async t=>{
 const f=processFixture(t),begin=performance.now(),run=f.launch('sync_block');await run.waitFor('synthetic_fault_ready');const result=await run.done;
 assert.notEqual(result.code,0);const r=JSON.parse(readFileSync(join(f.path,'watchdog-1.json'),'utf8')).process;
 assert.equal(r.trigger,'wall_limit');assert.equal(r.exit.observed,true);assert.equal(r.exit.signal,'SIGKILL');assert.equal(r.signals.term,'sent');assert.equal(r.signals.kill,'sent');
 assert.ok(r.maxWallMs<30000);assert.ok(performance.now()-begin>=30000);if(!r.cleanupComplete)assert.ok(r.issues.includes('group_unconfirmed'));
 const again=await f.launch('normal','resume').done;assert.notEqual(again.code,0);assert.equal(again.messages.some(m=>m.type==='synthetic_watchdog_started'),false);
});
test('guardian SIGKILL leaves durable pending while independent watchdog reaps its own blocked worker',{timeout:20000},async t=>{
 const f=processFixture(t),run=f.launch('sync_block');await run.waitFor('synthetic_fault_ready');const identity=run.messages.find(m=>m.type==='synthetic_worker_identity');assert.ok(identity);
 run.child.kill('SIGKILL');const result=await run.done;assert.equal(result.signal,'SIGKILL');
 const deadline=performance.now()+8000;let report:any;
 while(performance.now()<deadline){try{report=JSON.parse(readFileSync(join(f.path,'watchdog-1.json'),'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,25));}
 assert.ok(report);assert.equal(report.process.trigger,'parent_disconnect');assert.equal(report.process.exit.signal,'SIGKILL');
 const current=ownProcessIdentity(identity.pid);assert.ok(!current||current.startTicks!==identity.startTicks||current.state==='Z');
 const again=await f.launch('normal','resume').done;assert.notEqual(again.code,0);const status=again.messages.find(m=>m.type==='synthetic_process_blocked')?.status;
 assert.equal(status?.failure,'launch_unresolved_no_retry');assert.equal(status?.reservedWallMs,30000);assert.equal(status?.finished,0);
});

import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
import {ResumableJournal} from '../src/server/acceptance-resumable-journal.js';
import {RESUMABLE_PROTOCOL as P} from '../src/server/acceptance-resumable-protocol.js';
import {resumableManifest,createResumableOfflineSegment} from '../src/server/acceptance-resumable-runner.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
const source='a'.repeat(64);
function directory(t:TestContext){const base=mkdtempSync(join(testTmpdir(),'resumable-')),path=join(base,'run'),d=AcceptanceRunDirectory.create(path);
 d.writeJson('resumable-manifest.json',resumableManifest(source));t.after(()=>{d.close();rmSync(base,{recursive:true,force:true});});return {d,path,base};}
function journal(t:TestContext){const f=directory(t),j=new ResumableJournal(f.d,{create:true,sourceFingerprint:source,worldId:'synthetic'});
 t.after(()=>j.close());return {...f,j};}
function world(revision=1,successes=0){return {id:'synthetic',minute:480,revision,metrics:{successes}};}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('fixed protocol has one candidate, zero spending cap and no real executable transport',()=>{
 assert.equal(P.model,'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B');assert.equal(P.fallback,null);assert.equal(P.retries,0);
 assert.equal(P.endGameMinute-P.fromMinute,15*1440);assert.equal(P.spendingLimitCny,0);assert.equal(P.liveExecutionEnabled,false);assert.equal(P.acceptancePassed,null);
});
test('owner SQLite exclusion rejects concurrent owner then releases after close',t=>{
 const {d,j}=journal(t);assert.throws(()=>new ResumableJournal(d,{create:false,sourceFingerprint:source}),/resumable_owner_active/);
 j.close();const reopened=new ResumableJournal(d,{create:false,sourceFingerprint:source});reopened.close();
});
test('intent is durable, counted once, and forbids resume or retry',t=>{
 const {d,j}=journal(t);j.checkpoint(world(),hash(world()));j.beginSegment();assert.equal(j.intent('b'.repeat(64)),1);j.close();
 const again=new ResumableJournal(d,{create:false,sourceFingerprint:source});t.after(()=>again.close());assert.equal(again.status().attempts,1);
 assert.equal(again.status().pending?.phase,'intent');assert.throws(()=>again.beginSegment(),/unresolved_request_no_retry/);assert.throws(()=>again.intent('b'.repeat(64)),/resumable_request_rejected/);
});
test('response without corresponding world commit still forbids resumption',t=>{
 const {d,j}=journal(t);j.checkpoint(world(),hash(world()));j.beginSegment();j.response(j.intent('b'.repeat(64)));j.close();
 const again=new ResumableJournal(d,{create:false,sourceFingerprint:source});t.after(()=>again.close());assert.equal(again.status().pending?.phase,'response');assert.throws(()=>again.beginSegment(),/unresolved_request_no_retry/);
});
test('only matched committed response releases pending slot; late response is rejected',t=>{
 const {j}=journal(t);j.checkpoint(world(),hash(world()));j.beginSegment();const id=j.intent('b'.repeat(64));
 assert.throws(()=>j.checkpoint(world(2,1),hash(world(2,1))),/commit_unmatched/);j.response(id);j.checkpoint(world(2,1),hash(world(2,1)));
 assert.equal(j.status().pending,null);assert.equal(j.status().successes,1);assert.throws(()=>j.response(id),/late_response/);
});
test('crash-safe checkpoint can resume but records an unsealed prior segment and keeps cumulative budgets',t=>{
 const {d,j}=journal(t);j.checkpoint(world(),hash(world()));j.beginSegment();j.close();
 const again=new ResumableJournal(d,{create:false,sourceFingerprint:source});t.after(()=>again.close());again.verifyWorld(world(),hash(world()));assert.equal(again.beginSegment(),2);
 assert.equal(again.status().reservedWallMs,2*P.segmentWallMs);assert.equal(again.status().unsealedSegments,1);
});
test('different source, damaged audit and mismatched world refuse recovery',t=>{
 const {d,j}=journal(t);j.checkpoint(world(),hash(world()));assert.throws(()=>j.verifyWorld(world(2),hash(world(2))),/world_mismatch/);j.close();
 assert.throws(()=>new ResumableJournal(d,{create:false,sourceFingerprint:'b'.repeat(64)}),/history_mismatch/);
 const db=new DatabaseSync(d.database('resumable.sqlite'));db.exec("UPDATE audit SET body='{}' WHERE sequence=1");db.close();
 assert.throws(()=>new ResumableJournal(d,{create:false,sourceFingerprint:source}),/audit_invalid/);
});
test('reserved global time is never refunded and survives every restart',t=>{
 const {j}=journal(t);for(let i=1;i<=P.maxSegments;i++){assert.equal(j.beginSegment(),i);j.finish('00000000-0000-4000-8000-000000000000','c'.repeat(64));}
 assert.equal(j.status().reservedWallMs,P.maxReservedWallMs);assert.throws(()=>j.beginSegment(),/budget_exhausted/);
});
test('existing private directory requires the exact offline manifest marker',t=>{
 const {d,path,base}=directory(t);const reopened=AcceptanceRunDirectory.openOfflineResume(path);reopened.close();
 const outside=join(base,'outside');symlinkSync(path,outside);assert.throws(()=>AcceptanceRunDirectory.openOfflineResume(outside));
 writeFileSync(join(path,'resumable-manifest.json'),JSON.stringify({protocol:{protocol:'nine-siliconflow-live-probe-v1'}}));
 assert.throws(()=>AcceptanceRunDirectory.openOfflineResume(path),/marker_required/);
});
test('SQLite sidecar symlinks and insecure files are rejected before opening',t=>{
 const {d,path}=directory(t);d.database('world.sqlite',true);symlinkSync(join(path,'world.sqlite'),join(path,'world.sqlite-wal'));
 assert.throws(()=>d.database('world.sqlite'),/unsafe_acceptance_database/);
 d.database('owner.sqlite',true);chmodSync(join(path,'owner.sqlite'),0o644);assert.throws(()=>d.database('owner.sqlite'),/unsafe_acceptance_database/);
});
test('actual runtime clean pause and resume preserve world and globally unique requests',async t=>{
 const {d,path}=directory(t);const settings={directory:d,sourceFingerprint:source,sourceFingerprintAfter:()=>source};
 const first=createResumableOfflineSegment({...settings,create:true});first.start();await flush();await flush();const a=first.close();
 assert.equal(a.journal.phase,'paused');assert.equal(a.journal.attempts,9);assert.equal(a.journal.successes,9);assert.equal(a.control?.confirmedCostUsd,null);assert.equal(a.realModelExecuted,false);
 const second=createResumableOfflineSegment({...settings,create:false});second.start();await flush();const b=second.close();
 assert.equal(b.journal.phase,'paused');assert.equal(b.journal.attempts,9);assert.equal(b.journal.segments,2);assert.equal(b.journal.reservedWallMs,2*P.segmentWallMs);
 assert.equal(b.reloadVerified,true);assert.equal(b.acceptancePassed,null);
 assert.equal(readFileSync(join(path,'resumable.sqlite')).includes(Buffer.from('OFFLINE-ONLY-NOT-A-CREDENTIAL')),false);
});
test('actual runtime error stops permanently without retry or a zero bill claim',async t=>{
 const {d}=directory(t),settings={directory:d,sourceFingerprint:source,sourceFingerprintAfter:()=>source};
 const run=createResumableOfflineSegment({...settings,create:true,scenario:'fail'});run.start();await flush();const result=run.close();
 assert.equal(result.journal.phase,'blocked');assert.equal(result.journal.attempts,1);assert.ok(result.journal.pending);assert.equal(result.actualProviderCostCny,null);
 assert.throws(()=>createResumableOfflineSegment({...settings,create:false}),/unresolved_request_no_retry/);
});
test('actual runtime pending cancellation stays unresolved and cannot resume',async t=>{
 const {d}=directory(t),settings={directory:d,sourceFingerprint:source,sourceFingerprintAfter:()=>source};
 const run=createResumableOfflineSegment({...settings,create:true,scenario:'stall'});run.start();const result=run.close();await flush();
 assert.equal(result.journal.phase,'blocked');assert.equal(result.journal.attempts,1);assert.equal(result.journal.pending?.phase,'intent');
 assert.throws(()=>createResumableOfflineSegment({...settings,create:false}),/unresolved_request_no_retry/);
});

test('missing previously sealed evidence refuses resume rather than claiming cumulative coverage',async t=>{
 const {d,path}=directory(t),settings={directory:d,sourceFingerprint:source,sourceFingerprintAfter:()=>source};
 const run=createResumableOfflineSegment({...settings,create:true});run.start();await flush();run.close();
 rmSync(join(path,'evidence-0001'),{recursive:true});
 assert.throws(()=>createResumableOfflineSegment({...settings,create:false}),/prior_evidence_invalid/);
});

test('a committed request preparation error blocks immediately without model retries',async t=>{
 const {d}=directory(t),settings={directory:d,sourceFingerprint:source,sourceFingerprintAfter:()=>source};
 const run=createResumableOfflineSegment({...settings,create:true});run.start();await flush();
 const attempts=run.journal.status().attempts;
 // Synthetic injection of the exact runtime preparation-failure status. The
 // next ordinary runtime commit must detect it before any further dispatch.
 run.runtime.world.metrics.lastError='model_context_limit';run.runtime.tick(Date.now()+1000);await flush();
 assert.equal(run.journal.status().phase,'blocked');assert.equal(run.journal.status().failure,'request_preparation_failed');
 const result=run.close();assert.equal(result.journal.attempts,attempts);assert.equal(result.journal.phase,'blocked');
});

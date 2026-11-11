import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createSyntheticPriceEvidence,inspectSyntheticPriceEvidence,parseSyntheticPriceRecord,syntheticRecordHash as hash,SYNTHETIC_PRICE_FRESHNESS_MS} from '../src/server/production-model-price-evidence.js';
import {SyntheticPriceSession,syntheticPriceSessionContract,SYNTHETIC_PRICE_SESSION_LIMITS as L} from '../src/server/production-model-price-session.js';
import {evaluateProductionHttpAdmission} from '../src/server/production-model-admission.js';
import {productionCandidateContract} from '../src/server/production-model-journal.js';
import {readProductionModelPolicy,PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const defaults={runId:'synthetic-price-run',worldId:'synthetic-world',sourceFingerprint:A,fixtureScopeHash:B,createdAtMs:1000,
 deadlineAtMs:1_801_000,maxRequests:20,requestTimeoutMs:1000,commitGraceMs:100,maxSegments:10,maxEpochs:10,maxAuditRecords:500};
type Input=Parameters<typeof syntheticPriceSessionContract>[0];
const W=(fingerprint:string)=>({worldId:defaults.worldId,fingerprint});
function fixture(t:TestContext,overrides:Partial<Input>={}){
 const dir=mkdtempSync(join(testTmpdir(),'price-session-')),path=join(dir,'synthetic.sqlite'),handles:DatabaseSync[]=[];
 const contract=syntheticPriceSessionContract({...defaults,...overrides});
 const open=(create:boolean,nowMs=1000,worldFingerprint=A,c=contract)=>{
  const db=new DatabaseSync(path);handles.push(db);return {db,session:new SyntheticPriceSession(db,c,{create,nowMs,worldFingerprint})};
 };
 const {db,session:s}=open(true);
 t.after(()=>{for(const db of handles)try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const evidence=(at=1000,validUntilMs=at+SYNTHETIC_PRICE_FRESHNESS_MS,scopeHash=s.contractHash)=>createSyntheticPriceEvidence({scopeHash,
  sequence:s.status().epochs+1,previousEvidenceHash:s.status().evidenceHash,fixtureId:'synthetic-price',observedAtMs:at,validUntilMs});
 return {dir,path,db,s,contract,open,evidence,install:(at=1000,until=at+SYNTHETIC_PRICE_FRESHNESS_MS)=>s.installPrice(evidence(at,until),at)};
}
function finished(f:ReturnType<typeof fixture>,at=1000,worldHash=B){
 f.install(at);assert.equal(f.s.beginSegment(at+1),1);const id=f.s.beginRequest(A,at+2)!;
 f.s.beginDrain(at+3);f.s.recordResponse(id,B,at+4);f.s.acknowledgeWorldCommit(id,W(worldHash),at+5);f.s.finishSegment(W(worldHash),at+6);return id;
}
test('synthetic evidence is frozen, explicitly unverified and cannot serve as real admission',()=>{
 const c=syntheticPriceSessionContract(defaults),scopeHash=hash(c),cap=createSyntheticPriceEvidence({scopeHash,sequence:1,previousEvidenceHash:null,fixtureId:'fixture',observedAtMs:1000,validUntilMs:901000});
 const record=inspectSyntheticPriceEvidence(cap);assert.equal(Object.isFrozen(cap),true);assert.equal(Object.isFrozen(record),true);
 assert.equal(record.sourceAuthenticityVerified,false);assert.equal(record.liveExecutionEnabled,false);assert.equal(record.provenance,'synthetic-memory-fixture');
 assert.deepEqual(parseSyntheticPriceRecord(JSON.parse(JSON.stringify(record))),record);
 assert.throws(()=>inspectSyntheticPriceEvidence(JSON.parse(JSON.stringify(cap))),/capability_required/);
 const old=productionCandidateContract({runId:'test',worldId:'test',createdAtMs:1000,deadlineAtMs:10000,maxRequests:1,requestTimeoutMs:1000});
 assert.equal(evaluateProductionHttpAdmission(old,record,1000).allowed,false);
 assert.equal(readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:P.provider,VALLEY_MODEL_ID:P.model}).state,'blocked');
});
test('evidence and contract reject accessors, unknown fields and caller-supplied trust roots without reading them',()=>{
 let read=false;const input={scopeHash:A,sequence:1,previousEvidenceHash:null,fixtureId:'fixture',observedAtMs:1000,validUntilMs:2000};
 assert.throws(()=>createSyntheticPriceEvidence({...input,get observedAtMs(){read=true;return 1000;}}),/record_invalid/);assert.equal(read,false);
 for(const extra of [{trustRoot:'fake'},{sourceUrl:'https://www.siliconflow.cn/pricing'},{liveExecutionEnabled:true},{signature:'fake'}])
  assert.throws(()=>createSyntheticPriceEvidence({...input,...extra}),/record_invalid/);
 assert.throws(()=>syntheticPriceSessionContract({...defaults,get maxRequests(){read=true;return 20;}}),/record_invalid/);assert.equal(read,false);
});
for(const patch of [{inputCnyPerMillion:1},{outputCnyPerMillion:null},{otherApplicableChargesCny:0.001},{provider:'other'},
 {model:'other'},{endpoint:'https://example.invalid'},{provenance:'official-source'},{sourceAuthenticityVerified:true},
 {liveExecutionEnabled:true},{signature:'anything'}])test(`persisted synthetic record rejects unsupported price or authority ${JSON.stringify(patch)}`,()=>{
 const cap=createSyntheticPriceEvidence({scopeHash:A,sequence:1,previousEvidenceHash:null,fixtureId:'fixture',observedAtMs:1000,validUntilMs:901000});
 assert.throws(()=>parseSyntheticPriceRecord({...inspectSyntheticPriceEvidence(cap),...patch}),/synthetic_/);
});
test('evidence and status snapshots cannot mutate later validation or rewind budgets',t=>{
 const f=fixture(t),input={scopeHash:f.s.contractHash,sequence:1,previousEvidenceHash:null,fixtureId:'fixture',observedAtMs:1000,validUntilMs:901000};
 const cap=createSyntheticPriceEvidence(input);input.validUntilMs=9_000_000;f.s.installPrice(cap,1000);f.s.beginSegment(1001);f.s.beginRequest(A,1002);
 const snapshot=f.s.status();(snapshot as {attempts:number}).attempts=0;snapshot.pending!.id=99;snapshot.segment!.deadlineAtMs=9_000_000;
 assert.equal(f.s.status().attempts,1);assert.equal(f.s.status().pending!.id,1);assert.equal(f.s.status().evidence!.validUntilMs,901000);
});
test('two independently minted candidates for the same epoch cannot both advance it',t=>{
 const f=fixture(t),first=f.evidence(),second=f.evidence();f.s.installPrice(first,1000);
 assert.throws(()=>f.s.installPrice(second,1001),/renewal_rejected/);assert.equal(f.s.status().epochs,1);assert.equal(f.s.status().attempts,0);
});
for(const patch of [{validUntilMs:901001},{validUntilMs:1000},{observedAtMs:-1},{observedAtMs:1000.1},{sequence:0},{sequence:721},{scopeHash:'fake'}])
 test(`synthetic evidence rejects invalid bound ${JSON.stringify(patch)}`,()=>{
  assert.throws(()=>createSyntheticPriceEvidence({scopeHash:A,sequence:1,previousEvidenceHash:null,fixtureId:'fixture',observedAtMs:1000,validUntilMs:901000,...patch}),/synthetic_price_invalid/);
 });
for(const patch of [{maxRequests:20001},{deadlineAtMs:defaults.createdAtMs+L.maxWallMs+1},{maxSegments:721},{maxEpochs:721},
 {requestTimeoutMs:30000},{commitGraceMs:0},{maxAuditRecords:60003},{maxAuditRecords:15}])test(`session contract rejects increased bound ${JSON.stringify(patch)}`,()=>{
 assert.throws(()=>syntheticPriceSessionContract({...defaults,...patch}),/contract_invalid/);
});
test('normal price renewal, exact request phases and clean reopen retain the same lifetime budget',t=>{
 const f=fixture(t);assert.equal(finished(f),1);const first=f.s.status();
 assert.equal(first.completed,1);assert.equal(first.pending,null);assert.equal(first.segment,null);assert.equal(first.reservedWallMs,30000);
 f.install(2000);assert.equal(f.s.status().evidence?.previousEvidenceHash,first.evidenceHash);
 assert.equal(f.s.beginSegment(2001),2);const id=f.s.beginRequest(B,2002);assert.equal(id,2);
 const request=f.s.status().pending!;assert.equal(request.epoch,2);assert.equal(request.segment,2);assert.equal(request.evidenceHash,f.s.status().evidenceHash);
 f.s.recordResponse(2,C,2003);f.s.acknowledgeWorldCommit(2,W(C),2004);f.s.beginDrain(2005);f.s.finishSegment(W(C),2006);f.db.close();
 const {session:r}=f.open(false,3000,C);assert.equal(r.status().attempts,2);assert.equal(r.status().completed,2);assert.equal(r.status().reservedWallMs,60000);
 assert.deepEqual(r.contract,f.contract);assert.equal(r.status().worldFingerprint,C);assert.equal(r.status().sourceAuthenticityVerified,false);
 assert.equal(r.status().actualProviderCostCny,null);assert.equal(r.status().realModelExecuted,false);assert.equal(r.status().liveExecutionEnabled,false);
 assert.equal(readFileSync(f.path).includes(Buffer.from('Authorization')),false);
});
test('900000ms boundary expires rather than restarting its age on poll or reopen',t=>{
 const f=fixture(t);f.install();f.s.poll(900999);assert.equal(f.s.status().phase,'ready');
 f.s.poll(901000);assert.equal(f.s.status().phase,'awaiting_price');assert.equal(f.s.status().failure,null);f.db.close();
 const {session:r}=f.open(false,901001);assert.equal(r.status().phase,'awaiting_price');assert.equal(r.status().evidence?.validUntilMs,901000);
 assert.equal(r.beginSegment(901002),null);assert.equal(r.status().segments,0);
 const proof=createSyntheticPriceEvidence({scopeHash:r.contractHash,sequence:2,previousEvidenceHash:r.status().evidenceHash,
  fixtureId:'same-synthetic-fixture',observedAtMs:901003,validUntilMs:1801000});
 r.installPrice(proof,901003);assert.equal(r.beginSegment(901004),1);assert.equal(r.status().attempts,0);
});
test('insufficient request plus commit headroom waits for evidence without spending a segment',t=>{
 const f=fixture(t);f.install(1000,2100);assert.equal(f.s.beginSegment(1000),null);
 assert.equal(f.s.status().phase,'awaiting_price');assert.equal(f.s.status().segments,0);assert.equal(f.s.status().reservedWallMs,0);
 f.install(1001,5000);assert.equal(f.s.beginSegment(1002),1);
});
test('admission cutoff closes new intents while allowing one pending response and matching ack to drain',t=>{
 const f=fixture(t);f.install();f.s.beginSegment(1000);const cutoff=f.s.status().segment!.admissionCutoffMs;
 const id=f.s.beginRequest(A,cutoff-1)!;assert.equal(f.s.beginRequest(B,cutoff),null);assert.equal(f.s.status().phase,'draining');
 assert.equal(f.s.status().attempts,1);f.s.recordResponse(id,B,cutoff+998);f.s.acknowledgeWorldCommit(id,W(B),cutoff+1098);
 f.s.finishSegment(W(B),cutoff+1099);assert.equal(f.s.status().segment,null);assert.equal(f.s.status().completed,1);
});
test('ordinary checkpoint never acknowledges or replaces a pending response',t=>{
 const f=fixture(t);f.install();f.s.beginSegment(1001);f.s.beginRequest(A,1002);f.s.recordResponse(1,B,1003);
 const pending=f.s.status().pending;f.s.checkpointWorld(W(C),1004);assert.deepEqual(f.s.status().pending,pending);assert.equal(f.s.status().completed,0);
 f.db.close();const {session:r}=f.open(false,1005,C);assert.equal(r.status().failure,'unresolved_request_no_retry');assert.equal(r.status().pending?.phase,'response');
});
for(const action of ['ack','checkpoint','finish'] as const)test(`wrong world identity at ${action} never clears or seals work`,t=>{
 const f=fixture(t);f.install();f.s.beginSegment(1001);f.s.beginRequest(A,1002);f.s.recordResponse(1,B,1003);
 if(action==='finish'){f.s.acknowledgeWorldCommit(1,W(B),1004);f.s.beginDrain(1005);}
 const before=f.s.status(),wrong={worldId:'different-world',fingerprint:action==='finish'?B:C};
 assert.throws(()=>action==='ack'?f.s.acknowledgeWorldCommit(1,wrong,1006):action==='checkpoint'?f.s.checkpointWorld(wrong,1006):f.s.finishSegment(wrong,1006),/rejected/);
 assert.deepEqual(f.s.status().pending,before.pending);assert.equal(f.s.status().completed,before.completed);
 assert.equal(f.s.status().worldFingerprint,before.worldFingerprint);assert.deepEqual(f.s.status().segment,before.segment);
});
for(const action of ['wrong-response','wrong-ack','ack-before-response','duplicate-response','duplicate-ack'] as const)
 test(`request phase and identity reject ${action} without inventing acceptance`,t=>{
 const f=fixture(t);f.install();f.s.beginSegment(1001);f.s.beginRequest(A,1002);
 if(['wrong-ack','duplicate-response','duplicate-ack'].includes(action))f.s.recordResponse(1,B,1003);
 if(action==='duplicate-ack')f.s.acknowledgeWorldCommit(1,W(B),1004);
 const before=f.s.status();assert.throws(()=>action==='wrong-response'?f.s.recordResponse(2,B,1005)
  :action==='duplicate-response'?f.s.recordResponse(1,B,1005):f.s.acknowledgeWorldCommit(action==='wrong-ack'?2:1,W(C),1005),/rejected/);
 assert.equal(f.s.status().attempts,before.attempts);assert.equal(f.s.status().completed,before.completed);
 assert.deepEqual(f.s.status().pending,before.pending);assert.equal(f.s.status().worldFingerprint,before.worldFingerprint);
});
for(const phase of ['intent','response','draining'] as const)test(`renewal in ${phase} cannot clear pending or an unsealed segment`,t=>{
 const f=fixture(t);f.install();f.s.beginSegment(1001);f.s.beginRequest(A,1002);
 if(phase==='response')f.s.recordResponse(1,B,1003);if(phase==='draining')f.s.beginDrain(1003);
 const pending=f.s.status().pending;
 assert.throws(()=>f.install(1004),/renewal_rejected/);assert.deepEqual(f.s.status().pending,pending);
 assert.equal(f.s.status().epochs,1);assert.equal(f.s.status().attempts,1);assert.notEqual(f.s.status().failure,null);
});
for(const kind of ['forged','wrong-scope','replay','future','stale'] as const)test(`price installation fails closed for ${kind}`,t=>{
 const f=fixture(t);const original=f.evidence();f.s.installPrice(original,1000);
 const proof=kind==='forged'?{kind:'synthetic-price-evidence-capability' as const}:kind==='wrong-scope'?f.evidence(1001,5000,C)
  :kind==='replay'?original:kind==='future'?f.evidence(2000,5000):f.evidence(1001,1002);
 assert.throws(()=>f.s.installPrice(proof,kind==='stale'?1002:1001));assert.equal(f.s.status().epochs,1);assert.notEqual(f.s.status().failure,null);
 assert.throws(()=>f.s.beginSegment(2001));assert.equal(f.s.status().attempts,0);
});
for(const stage of ['intent','response'] as const)test(`request ${stage} deadline keeps its pending audit and cannot be renewed`,t=>{
 const f=fixture(t);f.install();f.s.beginSegment(1001);f.s.beginRequest(A,1002);
 if(stage==='response')f.s.recordResponse(1,B,1003);
 const expiry=2002+(stage==='response'?100:0);assert.throws(()=>f.s.poll(expiry),/request_deadline/);
 assert.equal(f.s.status().pending?.phase,stage);assert.equal(f.s.status().completed,0);
 assert.throws(()=>f.install(expiry+1));assert.equal(f.s.status().epochs,1);assert.equal(f.s.status().attempts,1);
});
test('price and segment hard deadlines fail closed even without incoming response chunks',t=>{
 const f=fixture(t);f.install(1000,4000);f.s.beginSegment(1001);
 assert.throws(()=>f.s.poll(4000),/price_expired_in_segment/);assert.equal(f.s.status().segment?.id,1);
 const g=fixture(t);g.install();g.s.beginSegment(1000);assert.throws(()=>g.s.poll(31000),/segment_deadline/);
});
for(const code of ['runtime_failed','evidence_failed','billing_unknown','nonzero_cost','source_unknown','manual_abandonment'] as const)
 test(`durable ${code} cannot be cleared by fresh synthetic price or reopening`,t=>{
  const f=fixture(t);f.install();f.s.fail(code);assert.throws(()=>f.install(1001));f.db.close();
  const {session:r}=f.open(false,1002);assert.equal(r.status().failure,code);assert.equal(r.status().epochs,1);assert.throws(()=>r.beginSegment(1003));
 });
test('clock rollback and global absolute deadline cannot be reset by renewal or clean reopen',t=>{
 const f=fixture(t);f.install();f.s.poll(2000);assert.throws(()=>f.s.poll(1999),/clock_invalid/);assert.throws(()=>f.install(2001));
 const g=fixture(t,{deadlineAtMs:5000});g.install();g.db.close();const db=new DatabaseSync(g.path);
 try{assert.throws(()=>new SyntheticPriceSession(db,g.contract,{create:false,worldFingerprint:A,nowMs:5000}),/global_deadline/);}finally{db.close();}
 const {session:r}=g.open(false,5001);
 assert.equal(r.status().failure,'global_deadline');assert.equal(r.contract.deadlineAtMs,5000);
});
test('global request and segment reservations are never refunded or replenished by renewal',t=>{
 const f=fixture(t,{maxRequests:1});finished(f);f.install(2000);assert.throws(()=>f.s.beginSegment(2001),/budget_exhausted/);
 assert.equal(f.s.status().attempts,1);assert.equal(f.s.status().reservedWallMs,30000);
 const g=fixture(t,{maxSegments:1});g.install();g.s.beginSegment(1001);g.s.beginDrain(1002);g.s.finishSegment(W(A),1003);g.install(1004);
 assert.throws(()=>g.s.beginSegment(1005),/budget_exhausted/);assert.equal(g.s.status().reservedWallMs,30000);
});
test('audit capacity reserves a durable final failure row rather than resetting history',t=>{
 const f=fixture(t,{maxAuditRecords:16});f.install();for(let i=0;i<13;i++)f.s.poll(1001+i);
 assert.equal(f.s.status().auditRecords,15);assert.throws(()=>f.s.poll(1015),/audit_limit/);
 assert.equal(f.s.status().auditRecords,16);assert.equal(f.s.status().failure,'synthetic_audit_limit');
 f.db.close();const {session:r}=f.open(false,1016);assert.equal(r.status().failure,'synthetic_audit_limit');assert.equal(r.status().auditRecords,16);
});
test('original identity, source, scope and limits remain immutable on reopen',t=>{
 const f=fixture(t);f.install();f.db.close();
 for(const patch of [{worldId:'other'},{runId:'other'},{sourceFingerprint:B},{fixtureScopeHash:C},{maxRequests:21},{deadlineAtMs:1_802_000}]){
  const c=syntheticPriceSessionContract({...defaults,...patch}),db=new DatabaseSync(f.path);
  try{assert.throws(()=>new SyntheticPriceSession(db,c,{create:false,worldFingerprint:A,nowMs:1001}),/event_invalid|audit_invalid/);}finally{db.close();}
 }
 assert.throws(()=>f.open(false,1001,B),/world_mismatch/);
});
test('same handle and independent connection cannot steal an active session',t=>{
 const f=fixture(t);assert.throws(()=>new SyntheticPriceSession(f.db,f.contract,{create:false,worldFingerprint:A,nowMs:1001}),/owner_active/);
 const second=new DatabaseSync(f.path);try{assert.throws(()=>new SyntheticPriceSession(second,f.contract,{create:false,worldFingerprint:A,nowMs:1001}),/locked|owner_active/);}finally{second.close();}
 f.s.poll(1001);assert.equal(f.s.status().failure,null);
});
test('foreign tables and create-over-existing session are rejected without rewriting data',t=>{
 const f=fixture(t);assert.throws(()=>new SyntheticPriceSession(f.db,f.contract,{create:true,worldFingerprint:A,nowMs:1001}),/owner_active/);
 const dir=mkdtempSync(join(testTmpdir(),'price-foreign-')),db=new DatabaseSync(join(dir,'foreign.sqlite'));
 try{db.exec('CREATE TABLE unrelated (value TEXT)');assert.throws(()=>new SyntheticPriceSession(db,f.contract,{create:true,worldFingerprint:A,nowMs:1000}),/isolated_handle_required/);
  assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='synthetic_price_session_audit'").get() as {n:number}).n,0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('damaged audit, storage failure and downgraded durability never yield a new intent',t=>{
 const f=fixture(t);f.install();f.db.exec("UPDATE synthetic_price_session_audit SET body='{}' WHERE sequence=1");f.db.close();assert.throws(()=>f.open(false,1001),/audit_invalid/);
 const g=fixture(t);g.install();g.s.beginSegment(1001);g.db.exec('PRAGMA query_only=ON');assert.throws(()=>g.s.beginRequest(A,1002));assert.equal(g.s.status().attempts,0);assert.equal(g.s.status().persistenceHealthy,false);
 const h=fixture(t);h.install();h.s.beginSegment(1001);h.db.exec('PRAGMA synchronous=NORMAL');assert.throws(()=>h.s.beginRequest(A,1002),/owner_lost/);assert.equal(h.s.status().attempts,0);
});
for(const action of ['price','response','ack','seal'] as const)test(`failed ${action} persistence returns no successful state transition`,t=>{
 const f=fixture(t);
 if(action!=='price'){f.install();f.s.beginSegment(1001);f.s.beginRequest(A,1002);}
 if(action==='ack'||action==='seal')f.s.recordResponse(1,B,1003);
 if(action==='seal'){f.s.acknowledgeWorldCommit(1,W(B),1004);f.s.beginDrain(1005);}
 const before=f.s.status();f.db.exec('PRAGMA query_only=ON');
 assert.throws(()=>action==='price'?f.install(1006):action==='response'?f.s.recordResponse(1,B,1006)
  :action==='ack'?f.s.acknowledgeWorldCommit(1,W(B),1006):f.s.finishSegment(W(B),1006));
 assert.equal(f.s.status().persistenceHealthy,false);assert.equal(f.s.status().epochs,before.epochs);
 assert.equal(f.s.status().completed,before.completed);assert.deepEqual(f.s.status().pending,before.pending);assert.deepEqual(f.s.status().segment,before.segment);
 f.db.close();const {session:r}=f.open(false,1007,action==='seal'?B:A);
 if(action==='price')assert.equal(r.status().phase,'awaiting_price');
 else assert.notEqual(r.status().failure,null);
});
for(const crash of ['price','segment','intent','response','ack','drain','sealed'] as const)test(`actual process exit after ${crash} preserves bounds and blocks incomplete work`,t=>{
 const dir=mkdtempSync(join(testTmpdir(),'price-session-crash-')),path=join(dir,'synthetic.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const c=syntheticPriceSessionContract(defaults),source=`
 import {DatabaseSync} from 'node:sqlite';
 import {SyntheticPriceSession} from './src/server/production-model-price-session.ts';
 import {createSyntheticPriceEvidence} from './src/server/production-model-price-evidence.ts';
 const db=new DatabaseSync(${JSON.stringify(path)}),c=${JSON.stringify(c)},stop=${JSON.stringify(crash)},W=fingerprint=>({worldId:c.worldId,fingerprint});
 const s=new SyntheticPriceSession(db,c,{create:true,worldFingerprint:${JSON.stringify(A)},nowMs:1000});
 s.installPrice(createSyntheticPriceEvidence({scopeHash:s.contractHash,sequence:1,previousEvidenceHash:null,fixtureId:'child',observedAtMs:1000,validUntilMs:901000}),1000);
 if(stop==='price')process.exit(71);s.beginSegment(1001);if(stop==='segment')process.exit(71);
 s.beginRequest(${JSON.stringify(A)},1002);if(stop==='intent')process.exit(71);s.recordResponse(1,${JSON.stringify(B)},1003);if(stop==='response')process.exit(71);
 s.acknowledgeWorldCommit(1,W(${JSON.stringify(B)}),1004);if(stop==='ack')process.exit(71);s.beginDrain(1005);if(stop==='drain')process.exit(71);
 s.finishSegment(W(${JSON.stringify(B)}),1006);process.exit(71);
 `;
 const child=spawnSync(process.execPath,['--import','./scripts/acceptance-offline-guard.mjs','--import','tsx','--input-type=module','--eval',source],
  {cwd:process.cwd(),env:{HOME:dir,USERPROFILE:dir,TMPDIR:dir,TMP:dir,TEMP:dir},encoding:'utf8',timeout:20000});
 assert.equal(child.error,undefined);assert.equal(child.status,71,child.stderr);const db=new DatabaseSync(path);
 try{const world=['ack','drain','sealed'].includes(crash)?B:A,s=new SyntheticPriceSession(db,c,{create:false,worldFingerprint:world,nowMs:1010});
  assert.equal(s.status().epochs,1);assert.equal(s.contract.deadlineAtMs,c.deadlineAtMs);
  assert.equal(s.status().reservedWallMs,crash==='price'?0:30000);
  assert.equal(s.status().attempts,['price','segment'].includes(crash)?0:1);
  if(['price','sealed'].includes(crash)){assert.equal(s.status().failure,null);assert.equal(s.beginSegment(1011),crash==='price'?1:2);}
  else{assert.notEqual(s.status().failure,null);assert.throws(()=>s.beginSegment(1011));
   const proof=createSyntheticPriceEvidence({scopeHash:s.contractHash,sequence:2,previousEvidenceHash:s.status().evidenceHash,fixtureId:'no-reset',observedAtMs:1012,validUntilMs:901012});
   assert.throws(()=>s.installPrice(proof,1012));assert.equal(s.status().epochs,1);
  }
 }finally{db.close();}
});

/** Independent review: only generated synthetic databases beneath this review's output. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {SyntheticPriceSession,syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {createSyntheticPriceEvidence,inspectSyntheticPriceEvidence} from '../src/server/production-model-price-evidence.js';
import {evaluateProductionHttpAdmission} from '../src/server/production-model-admission.js';
import {productionGatedCandidateContract} from '../src/server/production-model-journal.js';
import {createGatedSiliconFlowHttp} from '../src/server/production-model-http.js';
import {readProductionModelPolicy,PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
const A='1'.repeat(64),B='2'.repeat(64);
const root=resolve('output/price-session-review');mkdirSync(root,{recursive:true});
const input={runId:'independent-review',worldId:'review-world',sourceFingerprint:A,fixtureScopeHash:B,createdAtMs:0,
 deadlineAtMs:2_000_000,maxRequests:2,requestTimeoutMs:100,commitGraceMs:10,maxSegments:3,maxEpochs:3,maxAuditRecords:100};
function fixture(t:TestContext,patch:Partial<typeof input>={}){
 const dir=mkdtempSync(join(root,'synthetic-')),path=join(dir,'ledger.sqlite'),handles:DatabaseSync[]=[];
 const c=syntheticPriceSessionContract({...input,...patch});
 const open=(create:boolean,at=0,fingerprint=A)=>{const db=new DatabaseSync(path);handles.push(db);
  return {db,s:new SyntheticPriceSession(db,c,{create,nowMs:at,worldFingerprint:fingerprint})};};
 const f=open(true);t.after(()=>{for(const db of handles)try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 return {...f,c,open,path};
}
function install(s:SyntheticPriceSession,at:number,until=at+900000){const old=s.status();
 return s.installPrice(createSyntheticPriceEvidence({scopeHash:s.contractHash,sequence:old.epochs+1,previousEvidenceHash:old.evidenceHash,
 fixtureId:'review',observedAtMs:at,validUntilMs:until}),at);}
const world=(fingerprint=A)=>({worldId:input.worldId,fingerprint});
for(const action of ['poll','request','response','ack','checkpoint','drain','finish','renew'] as const)
 test(`review: every mutating timed API fails at exact global deadline (${action})`,t=>{
  const f=fixture(t,{deadlineAtMs:1000});install(f.s,0);f.s.beginSegment(0);f.s.beginRequest(A,1);f.s.recordResponse(1,B,2);
  const before=f.s.status();
  assert.throws(()=>({poll:()=>f.s.poll(1000),request:()=>f.s.beginRequest(A,1000),response:()=>f.s.recordResponse(1,B,1000),
   ack:()=>f.s.acknowledgeWorldCommit(1,world(B),1000),checkpoint:()=>f.s.checkpointWorld(world(B),1000),
   drain:()=>f.s.beginDrain(1000),finish:()=>f.s.finishSegment(world(),1000),renew:()=>install(f.s,1000)})[action](),/global_deadline/);
  const after=f.s.status();assert.equal(after.failure,'global_deadline');assert.deepEqual(after.pending,before.pending);
  assert.equal(after.attempts,1);assert.equal(after.completed,0);assert.equal(after.epochs,1);
  f.db.close();const r=f.open(false,1001).s;assert.equal(r.status().failure,'global_deadline');assert.deepEqual(r.status().pending,before.pending);
 });
test('review: repeated clean reopen never refreshes evidence or refunds reservations/requests',t=>{
 const f=fixture(t);install(f.s,0);f.s.beginSegment(0);f.s.beginRequest(A,1);f.s.recordResponse(1,B,2);
 f.s.acknowledgeWorldCommit(1,world(),3);f.s.beginDrain(4);f.s.finishSegment(world(),5);f.db.close();
 for(const at of [6,899999,900000,900001]){const {db,s}=f.open(false,at);assert.equal(s.status().attempts,1);
  assert.equal(s.status().reservedWallMs,30000);assert.equal(s.status().evidence?.validUntilMs,900000);
  assert.equal(s.status().phase,at<900000?'ready':'awaiting_price');db.close();}
 const {db,s}=f.open(false,900002);assert.equal(s.beginSegment(900002),null);install(s,900003);s.beginSegment(900004);
 assert.equal(s.beginRequest(A,900005),2);s.recordResponse(2,B,900006);s.acknowledgeWorldCommit(2,world(),900007);
 s.beginDrain(900008);s.finishSegment(world(),900009);db.close();const r=f.open(false,900010).s;
 install(r,900011);assert.throws(()=>r.beginSegment(900012),/budget_exhausted/);assert.equal(r.status().attempts,2);
 assert.equal(r.status().reservedWallMs,60000);assert.equal(r.contract.deadlineAtMs,2_000_000);
});
test('review: exact evidence-install expiry persists refusal, never a new epoch',t=>{
 const f=fixture(t);const cap=createSyntheticPriceEvidence({scopeHash:f.s.contractHash,sequence:1,previousEvidenceHash:null,
 fixtureId:'review',observedAtMs:0,validUntilMs:900000});
 assert.throws(()=>f.s.installPrice(cap,900000),/renewal_rejected/);assert.equal(f.s.status().epochs,0);
 f.db.close();const r=f.open(false,900001).s;assert.equal(r.status().failure,'synthetic_price_renewal_rejected');
});
test('review: no-start reopen stays renewable but forged capability blocks durably',t=>{
 const f=fixture(t);f.db.close();const r=f.open(false,1);assert.equal(r.s.status().segments,0);install(r.s,1);
 const serialized=JSON.parse(JSON.stringify(createSyntheticPriceEvidence({scopeHash:r.s.contractHash,sequence:2,
 previousEvidenceHash:r.s.status().evidenceHash,fixtureId:'review',observedAtMs:2,validUntilMs:900002})));
 assert.throws(()=>r.s.installPrice(serialized,2),/capability_required/);r.db.close();
 const again=f.open(false,3).s;assert.equal(again.status().epochs,1);assert.equal(again.status().failure,'synthetic_price_capability_required');
});
test('review: real gated factory rejects all new synthetic representations before credential access',t=>{
 const f=fixture(t);const cap=createSyntheticPriceEvidence({scopeHash:f.s.contractHash,sequence:1,previousEvidenceHash:null,
 fixtureId:'review',observedAtMs:0,validUntilMs:900000});f.s.installPrice(cap,0);
 let credentials=0;for(const admission of [cap,inspectSyntheticPriceEvidence(cap),f.s.status()])
  assert.throws(()=>createGatedSiliconFlowHttp({enableLive:true,contract:f.c as never,admission,credential:()=>{credentials++;throw Error('must_not_run');}}),/live_contract_required/);
 assert.equal(credentials,0);assert.equal(readProductionModelPolicy({VALLEY_MODEL_MODE:'siliconflow-free-only',VALLEY_MODEL_PROVIDER:P.provider,VALLEY_MODEL_ID:P.model}).state,'blocked');
 for(const name of ['main.ts','production-model-policy.ts','production-model-admission.ts','production-model-http.ts','production-model-journal.ts'])
  assert.doesNotMatch(readFileSync(resolve('src/server',name),'utf8'),/from ['"].*production-model-price-(?:session|evidence)/);
});
test('review: actual exit after failed seal preserves acknowledged but unsealed facts',t=>{
 const f=fixture(t);f.db.close();const code=`
 import {DatabaseSync} from 'node:sqlite';
 import {SyntheticPriceSession} from './src/server/production-model-price-session.ts';
 import {createSyntheticPriceEvidence} from './src/server/production-model-price-evidence.ts';
 const db=new DatabaseSync(${JSON.stringify(f.path)}),s=new SyntheticPriceSession(db,${JSON.stringify(f.c)},{create:false,nowMs:1,worldFingerprint:${JSON.stringify(A)}});
 s.installPrice(createSyntheticPriceEvidence({scopeHash:s.contractHash,sequence:1,previousEvidenceHash:null,fixtureId:'exit',observedAtMs:1,validUntilMs:900001}),1);
 s.beginSegment(2);s.beginRequest(${JSON.stringify(A)},3);s.recordResponse(1,${JSON.stringify(B)},4);
 s.acknowledgeWorldCommit(1,${JSON.stringify(world(B))},5);s.beginDrain(6);db.exec('PRAGMA query_only=ON');
 try{s.finishSegment(${JSON.stringify(world(B))},7);process.exit(72);}catch{process.exit(73);}`;
 const child=spawnSync(process.execPath,['--import','./scripts/acceptance-offline-guard.mjs','--import','./node_modules/tsx/dist/loader.mjs','--input-type=module','--eval',code],
 {cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:join(root,'home'),TMPDIR:join(root,'tmp')},encoding:'utf8',timeout:20000});
 assert.equal(child.status,73,child.stderr);const r=f.open(false,8,B).s;
 assert.equal(r.status().failure,'segment_unsealed_no_resume');assert.equal(r.status().completed,1);
 assert.equal(r.status().pending,null);assert.equal(r.status().worldFingerprint,B);assert.equal(r.status().reservedWallMs,30000);
 assert.throws(()=>install(r,9));assert.equal(r.status().epochs,1);
});
test('review: epoch cap remains consumed across clean reopens',t=>{
 const f=fixture(t,{maxEpochs:2});install(f.s,0);f.db.close();const second=f.open(false,1);install(second.s,2);
 second.db.close();const third=f.open(false,3);assert.throws(()=>install(third.s,4),/renewal_rejected/);
 assert.equal(third.s.status().epochs,2);third.db.close();const last=f.open(false,5).s;
 assert.equal(last.status().epochs,2);assert.equal(last.status().failure,'synthetic_price_renewal_rejected');
});
test('review: request 129 within same segment fails without incrementing lifetime reservation',t=>{
 const f=fixture(t,{maxRequests:200,maxAuditRecords:500});install(f.s,0);f.s.beginSegment(0);
 for(let i=1;i<=128;i++){const at=i*3;assert.equal(f.s.beginRequest(A,at),i);f.s.recordResponse(i,B,at+1);f.s.acknowledgeWorldCommit(i,world(),at+2);}
 const before=f.s.status();assert.throws(()=>f.s.beginRequest(A,390),/request_rejected/);
 assert.equal(f.s.status().attempts,128);assert.equal(f.s.status().completed,128);assert.equal(f.s.status().segment?.attempts,128);
 assert.equal(f.s.status().reservedWallMs,before.reservedWallMs);assert.equal(f.s.status().pending,null);
 f.db.close();const r=f.open(false,391).s;assert.equal(r.status().attempts,128);assert.equal(r.status().failure,'synthetic_request_rejected');
});
test('review: clean reopen at original deadline persists global stop',t=>{
 const f=fixture(t,{deadlineAtMs:500});install(f.s,0);f.s.beginSegment(0);f.s.beginDrain(1);f.s.finishSegment(world(),2);f.db.close();
 const db=new DatabaseSync(f.path);try{assert.throws(()=>new SyntheticPriceSession(db,f.c,{create:false,nowMs:500,worldFingerprint:A}),/global_deadline/);}finally{db.close();}
 const r=f.open(false,501).s;assert.equal(r.status().failure,'global_deadline');assert.equal(r.contract.deadlineAtMs,500);
 assert.equal(r.status().segments,1);assert.equal(r.status().reservedWallMs,30000);
});

test('review: valid legacy gated contract still rejects synthetic evidence on structure',t=>{
 const f=fixture(t);const cap=createSyntheticPriceEvidence({scopeHash:f.s.contractHash,sequence:1,previousEvidenceHash:null,
 fixtureId:'review',observedAtMs:0,validUntilMs:900000});f.s.installPrice(cap,0);
 const legacy=productionGatedCandidateContract({runId:'review-legacy',worldId:input.worldId,maxRequests:2,
 createdAtMs:0,deadlineAtMs:10000,requestTimeoutMs:100,admissionHash:A});
 assert.equal(legacy.executionKind,'gated-production-http-candidate');
 // now=1 is inside both the contract window and synthetic evidence window.
 // Do not manufacture authorization or previous-request billing records.
 assert.deepEqual(evaluateProductionHttpAdmission(legacy,cap,1),{allowed:false,reason:'admission_identity_invalid'});
 assert.deepEqual(evaluateProductionHttpAdmission(legacy,inspectSyntheticPriceEvidence(cap),1),{allowed:false,reason:'admission_scope_mismatch'});
 assert.deepEqual(evaluateProductionHttpAdmission(legacy,f.s.status(),1),{allowed:false,reason:'admission_record_invalid'});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkSyntheticRehearsal,SYNTHETIC_NINE_IDS,type SyntheticRehearsalReport} from '../src/server/production-model-process-rehearsal.js';
import {syntheticFailureDiagnostic,sanitizeSyntheticDiagnostic} from '../src/server/production-model-process-diagnostics.js';
import {syntheticRecordHash as hash} from '../src/server/production-model-price-evidence.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
import {foundingHouseholds} from '../src/world/founders.js';
import type {SyntheticLaunchReceipt} from '../src/server/production-model-process-ledger.js';
import {continuityFixture} from './helpers/production-continuity-fixture.js';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),mono=(ms:number)=>String(BigInt(ms)*1_000_000n);
// Detached, artificial validator input only. Never used as process/run evidence.
function fixture(){
 const receipt:SyntheticLaunchReceipt={schema:1,kind:'synthetic-price-launch',id:1,contractHash:C,bootId:'00000000-0000-4000-8000-000000000000',worldFingerprint:A,
  attempts:0,completed:0,previousSessionHash:C,sessionHash:C,journalHash:C,evidenceHash:C,startedAtMs:1000,deadlineAtMs:31000,startedMonotonicNs:mono(1000),deadlineMonotonicNs:mono(31000)};
 const names=foundingHouseholds.slice(0,3).flatMap(h=>h.people.map(p=>p[0]));
 const residents=SYNTHETIC_NINE_IDS.map((id,i)=>({id,name:names[i],lastDecisionAt:480,status:'alive' as const,recentActions:[]}));
 const before={worldId:'synthetic-validator-only',minute:480,revision:1,worldFingerprint:A,requests:0,successes:0,failures:0,localDecisions:0,inFlight:[],dayMinutes:20,residents};
 const ready={...structuredClone(before),revision:2},after={...structuredClone(before),minute:490,revision:20,worldFingerprint:B,requests:9,successes:9,localDecisions:9};
 const requests=SYNTHETIC_NINE_IDS.map((actorId,i)=>{
  const requestBody=JSON.stringify({model:P.model,messages:[{role:'user',content:`只输出一个 JSON 对象，直接选择实际列出的编号；没有要求的字段不填写。\n你是居民${names[i]}，\nA. 原地停留`}]}),reply={content:JSON.stringify({choice:'A',minutes:15}),finish:'stop' as const,usage:{prompt_tokens:1 as const,completion_tokens:1 as const}},at=3000+i*2000;
  return {id:i+1,actorId,requestBody,reply,requestHash:hash(requestBody),responseHash:hash(reply),observedAtMs:at,observedMonotonicNs:mono(at),acknowledgedAtMs:at+100,acknowledgedMonotonicNs:mono(at+100),worldFingerprint:B,revision:3+i,minute:481+i};
 });
 const report:SyntheticRehearsalReport={schema:1,kind:'synthetic-nine-continuity-segment',id:1,receiptHash:hash(receipt),runId:'synthetic-validator-only',sourceFingerprint:C,originalDeadlineAtMs:21601000,evidenceHash:C,
  before,ready,after,startedAtMs:2000,finishedAtMs:25200,startedMonotonicNs:mono(2000),finishedMonotonicNs:mono(25200),stopReason:'manual_stop',requests,
  ticks:[4000,8000,12000,16000,24000].map((at,i)=>({atMs:at,monotonicNs:mono(at),minute:482+i*2,revision:3+i})),
  realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};
 return {receipt,report,context:{runId:report.runId,sourceFingerprint:C,originalDeadlineAtMs:report.originalDeadlineAtMs,attempts:9,completed:9,after:report.after}};
}
test('diagnostics: every existing rehearsal predicate still rejects its deterministic counterexample',()=>{
 const clean=fixture();assert.equal(checkSyntheticRehearsal(clean.report,clean.receipt,clean.context).actors.length,9);
 const mutations:Array<[string,(r:SyntheticRehearsalReport)=>void]>=[
  ['identity',r=>{r.id=2;}],['roster',r=>{r.before.residents[0].name='wrong';}],['world_progress',r=>{r.ready.minute++;}],
  ['lifecycle_time',r=>{r.finishedAtMs=24999;}],['observation_count',r=>{r.requests.pop();}],['tick',r=>{r.ticks[1].atMs=r.ticks[0].atMs;}],
  ['counters',r=>{r.after.successes=8;}],['report_size',r=>{Object.assign(r,{padding:'x'.repeat(900001)});} ],
  ['request_hash',r=>{r.requests[0].requestHash=C;}],['request_identity',r=>{r.requests[0].actorId=r.requests[1].actorId;}],
  ['request_timing',r=>{r.requests.at(-1)!.observedAtMs=25000;}],
  ['actor_coverage',r=>{const old=r.requests.at(-1)!,replacement=structuredClone(r.requests[0]);Object.assign(old,{actorId:replacement.actorId,requestBody:replacement.requestBody,requestHash:replacement.requestHash});}],
 ];
 for(const [check,mutate] of mutations){const f=fixture();mutate(f.report);let caught:unknown;
  try{checkSyntheticRehearsal(f.report,f.receipt,f.context);}catch(error){caught=error;}
  assert.ok(caught instanceof Error,check);assert.equal(caught.message,'synthetic_continuity_evidence_invalid',check);
  const diagnostic=syntheticFailureDiagnostic({stage:'worker_rehearsal',error:caught,receipt:f.receipt,report:f.report});
  assert.equal(diagnostic.check,check);assert.equal(diagnostic.reason,'synthetic_continuity_evidence_invalid');
 }
});
test('diagnostics: clocks, identity coverage and counters are observations, never a pass',()=>{
 const {report,receipt}=fixture(),error=Object.assign(new Error('synthetic_continuity_evidence_invalid'),{syntheticCheck:'request_timing'});
 report.requests.at(-1)!.observedAtMs=25000;report.requests.at(-1)!.observedMonotonicNs=mono(25000);
 const d=syntheticFailureDiagnostic({stage:'worker_rehearsal',error,report,receipt,status:{sealed:true,failure:null,session:{attempts:9,completed:9,pending:null},journal:{attempts:9,completed:9,pending:null}}});
 assert.equal(d.actorMask,511);assert.equal(d.requests,9);assert.equal(d.observedFromCutoffMs,0);assert.equal(d.observedMonoFromCutoffMs,0);
 assert.equal(d.finishedFromCutoffMs,200);assert.equal(d.gameMinutes,10);assert.equal(d.sealed,true);assert.equal(d.acceptancePassed,null);assert.equal(d.readyForProduction,false);
 assert.equal(sanitizeSyntheticDiagnostic({...d,acceptancePassed:true,readyForProduction:true}).acceptancePassed,null);
});
test('rehearsal request timing accepts pre-cutoff dispatch with later ack but rejects polling-time substitution and either-clock late dispatch',()=>{
 const f=fixture(),request=f.report.requests.at(-1)!;
 Object.assign(request,{observedAtMs:24999,observedMonotonicNs:mono(24999),acknowledgedAtMs:25147,acknowledgedMonotonicNs:mono(25147)});
 assert.equal(checkSyntheticRehearsal(f.report,f.receipt,f.context).requests,9);
 // The old worker sampled here, at response polling, rather than when the
 // transport received the request. That timestamp must still be rejected.
 for(const [wall,monotonic] of [[25147,25147],[25000,24999],[24999,25000],[25001,24999],[24999,25001]]){
  const report=structuredClone(f.report);Object.assign(report.requests.at(-1)!,{observedAtMs:wall,observedMonotonicNs:mono(monotonic)});
  assert.throws(()=>checkSyntheticRehearsal(report,f.receipt,f.context),error=>
   error instanceof Error&&Object.getOwnPropertyDescriptor(error,'syntheticCheck')?.value==='request_timing');
 }
});
test('diagnostics: real timeout failure keeps its original charge and cannot reserve or spawn on resume',{timeout:45000},async t=>{
 const f=continuityFixture(t),failed=await f.launch('late_headers');assert.equal(failed.code,1,JSON.stringify(failed.diagnostic));
 const worker=failed.diagnostic.workerDiagnostics.find(d=>d.stage==='worker_close');assert.ok(worker);assert.equal(worker.reason,'runtime_not_clean');assert.equal(worker.sealed,false);assert.equal(worker.runtimeFailed,true);
 const guardian=failed.diagnostic.guardianDiagnostic;assert.ok(guardian);assert.equal(guardian.reason,'synthetic_process_not_clean');assert.equal(guardian.workerExitCode,1);assert.equal(guardian.trigger,'child_exit');
 assert.equal(failed.diagnostic.reservedWallMs,30000);assert.equal(failed.diagnostic.finished,0);
 const denied=await f.launch('normal','resume');assert.equal(denied.code,1);assert.equal(denied.diagnostic.reserved,false);assert.equal(denied.diagnostic.workerReady,false);
 assert.equal(denied.diagnostic.reservedWallMs,30000);assert.equal(denied.diagnostic.launches,1);assert.equal(denied.diagnostic.finished,0);
});

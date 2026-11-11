import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {sanitizeSyntheticDiagnostic,syntheticFailureDiagnostic} from '../src/server/production-model-process-diagnostics.js';
import {checkSyntheticRehearsal} from '../src/server/production-model-process-rehearsal.js';
import {SyntheticLaunchLedger} from '../src/server/production-model-process-ledger.js';
import {syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {continuityDiagnosticArtifacts,continuityInvocationDiagnostic} from './helpers/continuity-diagnostic-artifacts.js';

const secret='REVIEW_ONLY_SECRET_PROMPT_STACK_PATH';
const invocation=()=>({code:1,signal:null,scenario:'sustained',mode:'resume',startedAtMs:1000,finishedAtMs:2000,messages:[] as any[]});

test('diagnostics review: arbitrary strings, nested data and forged authority never survive sanitization',()=>{
 const baseline=sanitizeSyntheticDiagnostic(null),poison:any={};
 for(const key of Object.keys(baseline))poison[key]=secret;
 Object.assign(poison,{schema:secret,kind:secret,error:{stack:secret},requestBody:secret,reply:secret,world:secret,
  realModelExecuted:true,liveExecutionEnabled:true,actualProviderCostCny:42,readyForProduction:true,acceptancePassed:true,
  issues:[secret,'exit_unobserved','exit_unobserved']});
 const result=sanitizeSyntheticDiagnostic(poison);
 assert.equal(JSON.stringify(result).includes(secret),false);
 assert.deepEqual(Object.keys(result),Object.keys(baseline));
 assert.deepEqual(result.issues,['exit_unobserved']);
 assert.equal(result.realModelExecuted,false);assert.equal(result.liveExecutionEnabled,false);
 assert.equal(result.readyForProduction,false);assert.equal(result.acceptancePassed,null);assert.equal(result.actualProviderCostCny,null);
 assert.deepEqual(sanitizeSyntheticDiagnostic(result),result);
 for(const bad of [NaN,Infinity,-Infinity,-1,Number.MAX_SAFE_INTEGER,'1',{},1.5]){
  const d=sanitizeSyntheticDiagnostic({launchId:bad,requests:bad,watchdogExitCode:bad});
  assert.equal(d.launchId,null);assert.equal(d.requests,null);assert.equal(d.watchdogExitCode,null);
 }
});

test('diagnostics review: accessors and array hooks are never executed',()=>{
 let calls=0;const fail=()=>{calls++;throw Error(secret);},value:any={};
 for(const key of Object.keys(sanitizeSyntheticDiagnostic(null)))Object.defineProperty(value,key,{get:fail});
 assert.doesNotThrow(()=>sanitizeSyntheticDiagnostic(value));assert.equal(calls,0);
 const issues:any[]=[];Object.defineProperty(issues,0,{get:fail});issues.length=1;
 Object.defineProperty(issues,'slice',{value:fail});
 assert.deepEqual(sanitizeSyntheticDiagnostic({issues}).issues,[]);assert.equal(calls,0);
 const requests:any[]=[];Object.defineProperty(requests,0,{get:fail});requests.length=1;
 assert.doesNotThrow(()=>syntheticFailureDiagnostic({stage:'worker_rehearsal',report:{requests}}));assert.equal(calls,0);
});

test('diagnostics review: invalid evidence stays invalid with a private named check',()=>{
 const report:any={schema:0,diagnostic:{acceptancePassed:true,reason:'unknown'}};
 let caught:any;try{checkSyntheticRehearsal(report,{} as any,{} as any);}catch(e){caught=e;}
 assert.equal(caught.message,'synthetic_continuity_evidence_invalid');assert.equal(caught.syntheticCheck,'identity');
 assert.equal(Object.getOwnPropertyDescriptor(caught,'syntheticCheck')?.enumerable,false);
 const d=syntheticFailureDiagnostic({stage:'worker_rehearsal',error:caught,report});
 assert.equal(d.reason,'synthetic_continuity_evidence_invalid');assert.equal(d.check,'identity');
 assert.throws(()=>checkSyntheticRehearsal({...report,diagnostic:d},{} as any,{} as any),/synthetic_continuity_evidence_invalid/);
 assert.equal(syntheticFailureDiagnostic({stage:'worker_close',error:new Error(secret)}).reason,'unknown');
});

test('diagnostics review: invocation artifacts contain only sanitized projection in private fresh leaves',t=>{
 const root=mkdtempSync(join(testTmpdir(),'diagnostic-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'output'));const directory=mkdtempSync(join(root,'output','continuity-ci-'));
 chmodSync(directory,0o700);writeFileSync(join(root,'output','unrelated.sqlite'),secret);
 const emit=continuityDiagnosticArtifacts(root,directory)!;const raw:any=invocation();
 Object.assign(raw,{stderr:secret,stdout:secret,path:secret});
 raw.messages=[{type:'synthetic_worker_diagnostic',diagnostic:{stage:'worker_close',reason:secret,error:secret}},
  {type:'synthetic_process_blocked',status:{launches:1,finished:0,reservedWallMs:30000,attempts:0,completed:0,worldFingerprint:secret},diagnostic:{reason:'synthetic_process_not_clean',stack:secret}},
  {type:'arbitrary',requestBody:secret}];
 emit(1,raw);const cases=readdirSync(directory);assert.equal(cases.length,1);
 const leaf=join(directory,cases[0]);assert.equal(statSync(leaf).mode&0o777,0o700);
 assert.deepEqual(readdirSync(leaf),['invocation-1.json']);const file=join(leaf,'invocation-1.json');
 assert.equal(statSync(file).mode&0o777,0o600);
 const bytes=readFileSync(file,'utf8');assert.equal(bytes.includes(secret),false);
 assert.deepEqual(JSON.parse(bytes),continuityInvocationDiagnostic(raw));assert.equal(JSON.parse(bytes).reservedWallMs,30000);
 assert.throws(()=>emit(1,raw));assert.throws(()=>emit(0,raw));assert.throws(()=>emit(101,raw));
 assert.throws(()=>continuityDiagnosticArtifacts(root,join(root,'output')));
 const link=join(root,'output','continuity-ci-AbCdEf');symlinkSync(directory,link);
 assert.throws(()=>continuityDiagnosticArtifacts(root,link));chmodSync(directory,0o755);
 assert.throws(()=>continuityDiagnosticArtifacts(root,directory));
});

test('diagnostics review: supplemental diagnostics cannot refund or finish a blocked durable reservation',t=>{
 const root=mkdtempSync(join(testTmpdir(),'diagnostic-ledger-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'launch.sqlite'),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),boot='00000000-0000-4000-8000-000000000000';
 const contract=syntheticPriceSessionContract({runId:'diagnostic-review',worldId:'world:review',sourceFingerprint:a,fixtureScopeHash:b,createdAtMs:1000,deadlineAtMs:1000000,maxRequests:20,requestTimeoutMs:5000,commitGraceMs:1000,maxSegments:3,maxEpochs:10,maxAuditRecords:60002});
 const options={create:true,worldFingerprint:a,sessionHash:b,journalHash:c,nowMs:1000,monotonicNs:'1000000000'};
 let db=new DatabaseSync(path);try{
  let ledger=new SyntheticLaunchLedger(db,contract,boot,options);
  const receipt=ledger.reserve({worldFingerprint:a,attempts:0,completed:0,previousSessionHash:b,sessionHash:b,journalHash:c,evidenceHash:c,startedAtMs:1001,deadlineAtMs:31001,startedMonotonicNs:'1001000000',deadlineMonotonicNs:'31001000000'});
  ledger.fail('supervised_launch_failed');const before=ledger.status();
  const diagnostic=syntheticFailureDiagnostic({stage:'guardian_supervise',receipt,reason:'synthetic_process_not_clean'});
  writeFileSync(join(root,'guardian-failure-1.json'),JSON.stringify({...diagnostic,acceptancePassed:true,reservedWallMs:0}));
  assert.deepEqual(ledger.status(),before);db.close();db=new DatabaseSync(path);
  ledger=new SyntheticLaunchLedger(db,contract,boot,{...options,create:false,nowMs:1002,monotonicNs:'1002000000'});
  assert.equal(ledger.status().reservedWallMs,30000);assert.equal(ledger.status().failure,'supervised_launch_failed');
  assert.equal(ledger.status().pending?.id,1);assert.equal(ledger.status().finished,0);
  assert.throws(()=>ledger.finish({id:1,worldFingerprint:a,attempts:0,completed:0,sessionHash:b,journalHash:c,reportHash:a,at:1002,monotonicNs:'1002000000'}));
  assert.throws(()=>ledger.reserve({...receipt,startedAtMs:1002,deadlineAtMs:31002,startedMonotonicNs:'1002000000',deadlineMonotonicNs:'31002000000'}));
  assert.deepEqual(ledger.status(),before);
 }finally{db.close();}
});

test('diagnostics review: authority modules never read diagnostic artifacts or consume diagnostic projections',()=>{
 for(const file of ['production-model-process-ledger.ts','production-model-process-state.ts','production-model-price-session.ts','production-model-journal.ts']){
  const source=readFileSync(resolve('src/server',file),'utf8');
  assert.doesNotMatch(source,/process-diagnostics|sanitizeSyntheticDiagnostic|syntheticFailureDiagnostic|guardian-failure-|worker-failure-|invocation-/);
 }
 const guardian=readFileSync(resolve('scripts/production-model-process-guardian.mjs'),'utf8');
 assert.doesNotMatch(guardian,/readJson\([^\n]*(?:diagnostic|failure|invocation)/);
 assert.match(guardian,/ledger\?\.fail\('supervised_launch_failed'\)/);
 const ci=readFileSync(resolve('.github/workflows/ci.yml'),'utf8');
 assert.match(ci,/path: \$\{\{ env\.VALLEY_CONTINUITY_DIAGNOSTICS \}\}\/case-\*\/invocation-\*\.json/);
 assert.doesNotMatch(ci,/continue-on-error|path: output\/?\s*$/m);
});

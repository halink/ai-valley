import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedFoodEvent,checkedWaitEvent,checkedStatuses} from '../src/server/acceptance-evidence-schema.js';

const start=()=>({schema:1,sessionId:'review-session',sequence:1,worldId:'review-world',type:'food_session_started',fromMinute:480});
const step=()=>({schema:1,sessionId:'review-session',sequence:2,worldId:'review-world',type:'food_step_committed',fromMinute:480,toMinute:481.25,revision:1,receipts:[]});

test('independent review: strict schema rejects extra private fields and numeric impostors',()=>{
 for(const entry of [{...start(),prompt:'SYNTHETIC_PRIVATE_MARKER'}, {...start(),fromMinute:'480'}, {...start(),sequence:1.5}, {...start(),fromMinute:Infinity}, {...start(),schema:2}])assert.throws(()=>checkedFoodEvent(entry));
 assert.throws(()=>checkedStatuses({decisionWaiting:null,directEating:null,rawError:'SYNTHETIC_PRIVATE_MARKER'}));
 assert.throws(()=>checkedWaitEvent({schema:1,sessionId:'review',sequence:1,type:'session_started',priorWait:'unknown',at:{wallTimeMs:1,monotonicMs:1,gameMinute:480,prompt:'private'}}));
});

test('independent review: schema does not invoke object accessors or serialization hooks',()=>{
 let calls=0;const accessor={...start()};Object.defineProperty(accessor,'fromMinute',{get(){calls++;return 480;},enumerable:true});
 assert.throws(()=>checkedFoodEvent(accessor));
 assert.throws(()=>checkedFoodEvent({...start(),toJSON(){calls++;return start();}}));
 assert.equal(calls,0);
});

test('independent review: receipt arrays reject holes, accessors and overridden map without executing them',()=>{
 let calls=0;
 const getter:unknown[]=[];Object.defineProperty(getter,0,{get(){calls++;return {};},enumerable:true});
 const overridden:unknown[]=[];Object.defineProperty(overridden,'map',{value(){calls++;return [];}});
 for(const receipts of [Array(1),getter,overridden])assert.throws(()=>checkedFoodEvent({...step(),receipts}));
 assert.equal(calls,0);
});

import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,unlinkSync,symlinkSync,linkSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence,type EvidenceWriterIo} from '../src/server/acceptance-evidence-writer.js';
import {RuntimeFoodEvidence} from '../src/server/runtime-food-evidence.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';

function fixture(t:{after:(fn:()=>void)=>void},io?:Partial<EvidenceWriterIo>){
 const root=mkdtempSync(join(testTmpdir(),'acceptance-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'new-run');const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:'review-world',fromMinute:480,io});
 t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 const statuses=()=>({decisionWaiting:wait.status(),directEating:food.status()});
 const finish=(end=481.25)=>{food.committed({worldId:'review-world',fromMinute:480,toMinute:end,receipts:[]},1);wait.stop(end);food.stop('review-world',end);return writer.close({reason:'scope_finished',statuses:statuses(),sourceFingerprintAfter:'a'.repeat(64)});};
 wait.start(480);food.start('review-world',480);return {root,directory,writer,wait,food,statuses,finish};
}

test('independent review: successful short writes preserve fractional scope and never assert acceptance',t=>{
 const f=fixture(t,{writeSync:((fd:number,b:Buffer,o:number,n:number,p:null)=>writeSync(fd,b,o,Math.min(n,7),p)) as typeof writeSync});
 const report=f.finish();assert.equal(report.complete,true);assert.equal(report.directEating.observedGameMinutes,1.25);
 assert.equal(report.directEating.totals!.completedActions,0);assert.equal(report.acceptancePassed,null);assert.equal(report.realModelExecuted,null);assert.equal(report.foodConsumption,null);
 assert.deepEqual(readAcceptanceEvidence(f.directory),report);
});

test('independent review: checkpoint and abort salvage prefix without claiming zero consumption',t=>{
 const f=fixture(t);f.writer.checkpoint(f.statuses());const before=readFileSync(join(f.directory,'evidence.jsonl'));
 const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.equal(report.validPrefixRecords,3);assert.equal(report.directEating.totals,null);
 assert.deepEqual(readFileSync(join(f.directory,'evidence.jsonl')),before);f.writer.abort();
 assert.equal(readAcceptanceEvidence(f.directory).complete,false);assert.throws(()=>f.writer.checkpoint(f.statuses()));
});

test('independent review: sealed runs fail closed after truncation, duplicated records or missing close seal',t=>{
 for(const mode of ['truncate','duplicate','missing-close']){
  const f=fixture(t);f.finish();const file=join(f.directory,'evidence.jsonl'),bytes=readFileSync(file);
  if(mode==='truncate')writeFileSync(file,bytes.subarray(0,bytes.length-1));
  if(mode==='duplicate')writeFileSync(file,Buffer.concat([bytes,bytes]));
  if(mode==='missing-close')unlinkSync(join(f.directory,'run-close.json'));
  const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false,mode);assert.equal(report.directEating.totals,null);assert.equal(report.decisionWaiting.counts,null);
 }
});

test('independent review: zero/partial writes and sync failures poison writer permanently with safe marker',t=>{
 for(const mode of ['zero','partial','sync']){
  let armed=false,writes=0;
  const f=fixture(t,{writeSync:((fd:number,b:Buffer,o:number,n:number,p:null)=>{
   if(armed&&mode==='zero')return 0;
   if(armed&&mode==='partial'){if(writes++===0)return writeSync(fd,b,o,Math.min(n,11),p);throw new Error('SYNTHETIC_PRIVATE_MARKER');}
   return writeSync(fd,b,o,n,p);
  }) as typeof writeSync,fsyncSync:(fd:number)=>{if(armed&&mode==='sync')throw new Error('SYNTHETIC_PRIVATE_MARKER');fsyncSync(fd);}});
  armed=true;assert.throws(()=>f.writer.checkpoint(f.statuses()),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
  assert.equal(f.writer.status().phase,'failed');assert.throws(()=>f.writer.checkpoint(f.statuses()));
  const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.equal(report.directEating.totals,null);
  assert.equal(readFileSync(join(f.directory,'failure.json'),'utf8').includes('PRIVATE'),false);
 }
});

test('independent review: journal and seal close failures cannot leave a complete run',t=>{
 for(const failCloseAt of [1,2]){
  let armed=false,closes=0;
  const f=fixture(t,{closeSync:(fd:number)=>{if(armed&&++closes===failCloseAt)throw new Error('SYNTHETIC_PRIVATE_MARKER');closeSync(fd);}});
  armed=true;assert.throws(()=>f.finish(),/close_failed/);assert.equal(f.writer.status().phase,'failed');
  const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.equal(report.directEating.totals,null);
 }
});

test('independent review: silently discarded writes are detected during final readback',t=>{
 let armed=false;
 const f=fixture(t,{writeSync:((fd:number,b:Buffer,o:number,n:number,p:null)=>armed?n:writeSync(fd,b,o,n,p)) as typeof writeSync});
 armed=true;assert.throws(()=>f.finish(),/readback_failed/);assert.equal(readAcceptanceEvidence(f.directory).complete,false);
});

test('independent review: directory reuse, symlink ancestors and protected path components are rejected',t=>{
 const root=mkdtempSync(join(testTmpdir(),'acceptance-path-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const options={sourceFingerprint:'a'.repeat(64),worldId:'review-world',fromMinute:480};
 const existing=join(root,'existing');mkdirSync(existing);assert.throws(()=>new AcceptanceEvidenceWriter({...options,directory:existing}));
 symlinkSync(existing,join(root,'alias'));assert.throws(()=>new AcceptanceEvidenceWriter({...options,directory:join(root,'alias','new')}));
 for(const name of ['runtime','secrets','.env-review','.git'])assert.throws(()=>new AcceptanceEvidenceWriter({...options,directory:join(root,name)}));
});

test('independent review: reader rejects symlinked and multiply linked journal without reading their contents',t=>{
 for(const mode of ['symlink','hardlink']){
  const f=fixture(t);f.finish();const file=join(f.directory,'evidence.jsonl'),copy=join(f.root,'synthetic-copy');writeFileSync(copy,readFileSync(file));unlinkSync(file);
  if(mode==='symlink')symlinkSync(copy,file);else linkSync(copy,file);
  const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.ok(report.issues.includes('invalid_or_unreadable_evidence'));
 }
});

test('independent review: individually closed channels with different end minutes remain unknown',t=>{
 const f=fixture(t);f.wait.stop(482);f.food.stop('review-world',480);
 const report=f.writer.close({reason:'scope_finished',statuses:f.statuses(),sourceFingerprintAfter:'a'.repeat(64)});
 assert.equal(report.complete,false);assert.ok(report.issues.includes('channel_scope_mismatch'));assert.equal(report.directEating.totals,null);
});

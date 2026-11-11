import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,appendFileSync,rmSync,statSync,writeSync,symlinkSync,mkdirSync,fsyncSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence,type EvidenceWriterOptions} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence,type DecisionWaitEvent} from '../src/server/decision-wait-evidence.js';
import {RuntimeFoodEvidence} from '../src/server/runtime-food-evidence.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import type {ModelResult} from '../src/server/decisions.js';

const fingerprint='a'.repeat(64);
function root(t:TestContext){const path=mkdtempSync(join(testTmpdir(),'valley-evidence-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function fixture(t:TestContext,overrides:Partial<EvidenceWriterOptions>={}){
 const directory=join(root(t),'new-run'),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'fixture',fromMinute:480,...overrides});
 t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 return {directory,writer,wait,food,start(){wait.start(480);food.start('fixture',480);},
  close(){wait.stop(480);food.stop('fixture',480);return writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});}};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('opt-in writer exclusively creates private files and verifies complete zero-length observation',t=>{
 const f=fixture(t);assert.equal(statSync(f.directory).mode&0o777,0o700);f.start();
 f.writer.checkpoint({decisionWaiting:f.wait.status(),directEating:f.food.status()});const report=f.close();
 assert.equal(report.complete,true);assert.equal(report.directEating.totals!.completedActions,0);
 assert.equal(report.directEating.observedGameMinutes,0);assert.equal(report.acceptancePassed,null);assert.equal(report.realModelExecuted,null);
 assert.equal(report.foodConsumption,null);assert.deepEqual(readAcceptanceEvidence(f.directory),report);
 assert.equal(f.writer.status().phase,'closed');assert.throws(()=>f.writer.checkpoint({decisionWaiting:null,directEating:null}),/writer_closed/);
 assert.throws(()=>new AcceptanceEvidenceWriter({directory:f.directory,sourceFingerprint:fingerprint,worldId:'fixture',fromMinute:480}),/new_directory_required/);
 for(const file of readdirSync(f.directory))assert.equal(statSync(join(f.directory,file)).mode&0o777,0o600);
});

test('short writes are completed before fsync, including header and seal',t=>{
 let writes=0,syncs=0;const f=fixture(t,{io:{writeSync:((fd:number,buffer:Buffer,offset:number,length:number,position:number|null)=>{
  writes++;return writeSync(fd,buffer,offset,Math.min(length,7),position);
 }) as typeof writeSync,fsyncSync:fd=>{syncs++;fsyncSync(fd);}}});
 f.start();assert.equal(f.close().complete,true);assert.ok(writes>100);assert.ok(syncs>=10);
});

test('partial failed write stops both sinks, persists safe failure, and cannot be resumed',t=>{
 let enabled=false,calls=0;const f=fixture(t,{io:{writeSync:((fd:number,buffer:Buffer,offset:number,length:number,position:number|null)=>{
  if(enabled){if(calls++===0)return writeSync(fd,buffer,offset,4,position);throw new Error('PRIVATE_SECRET_PROMPT_REPLY');}
  return writeSync(fd,buffer,offset,length,position);
 }) as typeof writeSync}});
 enabled=true;f.start();assert.equal(f.wait.status().phase,'failed');assert.equal(f.food.status().phase,'failed');
 assert.equal(f.writer.status().failure,'write_failed');assert.throws(()=>f.close(),/writer_failed/);
 const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.equal(report.directEating.totals,null);
 assert.ok(report.issues.includes('truncated_journal'));assert.ok(report.issues.includes('writer_failure'));
 assert.equal(readdirSync(f.directory).map(p=>readFileSync(join(f.directory,p),'utf8')).join('').includes('PRIVATE_'),false);
});

test('fsync failure never acknowledges an event as durable or publishes complete totals',t=>{
 let fail=false;const f=fixture(t,{io:{fsyncSync:fd=>{if(fail)throw new Error('PRIVATE_SYNC');fsyncSync(fd);}}});
 fail=true;f.wait.start(480);assert.equal(f.writer.status().durableRecords,0);assert.equal(f.writer.status().failure,'sync_failed');
 assert.equal(readAcceptanceEvidence(f.directory).complete,false);
});

test('missing, malformed, reordered and truncated bytes retain unknown rather than zero',t=>{
 for(const mutation of ['close','line','duplicate','truncated','sensitive'] as const){
  const f=fixture(t);f.start();f.close();const path=join(f.directory,'evidence.jsonl'),lines=readFileSync(path,'utf8').trimEnd().split('\n');
  if(mutation==='close')rmSync(join(f.directory,'run-close.json'));
  if(mutation==='line')writeFileSync(path,lines.filter((_,i)=>i!==1).join('\n')+'\n');
  if(mutation==='duplicate')writeFileSync(path,[lines[0],...lines].join('\n')+'\n');
  if(mutation==='truncated')appendFileSync(path,'{"unfinished":');
  if(mutation==='sensitive'){const row=JSON.parse(lines[0]);row.payload.prompt='SECRET';lines[0]=JSON.stringify(row);writeFileSync(path,lines.join('\n')+'\n');}
  const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false,mutation);assert.equal(report.directEating.totals,null);assert.equal(report.decisionWaiting.counts,null);
 }
});

test('missing source status and source drift remain incomplete even with durable close',t=>{
 const f=fixture(t);f.start();f.wait.stop(480);f.food.stop('fixture',480);
 const report=f.writer.close({reason:'manual_stop',statuses:{decisionWaiting:null,directEating:f.food.status()},sourceFingerprintAfter:'b'.repeat(64)});
 assert.equal(f.writer.status().phase,'closed');assert.equal(report.complete,false);assert.ok(report.issues.includes('source_changed'));
 assert.ok(report.issues.includes('incomplete_decision_waiting'));assert.equal(report.directEating.totals,null);
});

test('sensitive extra keys and unsafe error text fail before serialization',t=>{
 const f=fixture(t);const event={schema:1,sessionId:'synthetic',sequence:1,type:'session_started',priorWait:'unknown',at:{wallTimeMs:0,monotonicMs:0,gameMinute:480},prompt:'SECRET_REPLY_KEY'};
 assert.throws(()=>f.writer.observeDecisionWait(event as unknown as DecisionWaitEvent),/invalid_input/);
 assert.equal(readFileSync(join(f.directory,'evidence.jsonl'),'utf8'),'');assert.equal(readAcceptanceEvidence(f.directory).complete,false);
 assert.equal(readFileSync(join(f.directory,'failure.json'),'utf8').includes('SECRET'),false);
});

test('symlink ancestors, symlink files, hardlinks, preexisting and restricted directories are refused',t=>{
 const parent=root(t),target=join(parent,'target');mkdirSync(target);symlinkSync(target,join(parent,'alias'),'dir');
 for(const directory of [join(parent,'alias','new'),join(parent,'runtime','new'),`${parent}/../unexpected`,target]){
  assert.throws(()=>new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'fixture',fromMinute:480}));
 }
 const f=fixture(t);f.start();f.close();const before=readFileSync(join(f.directory,'evidence.jsonl'));
 rmSync(join(f.directory,'evidence.jsonl'));symlinkSync(join(parent,'missing'),join(f.directory,'evidence.jsonl'));
 assert.equal(readAcceptanceEvidence(f.directory).complete,false);assert.ok(before.length>0);
});

test('process crash leaves read-only valid prefix and restart never fills the gap',t=>{
 const parent=root(t),directory=join(parent,'crashed');
 const code=`import {AcceptanceEvidenceWriter} from './src/server/acceptance-evidence-writer.ts';
 import {DecisionWaitEvidence} from './src/server/decision-wait-evidence.ts';
 const writer=new AcceptanceEvidenceWriter({directory:${JSON.stringify(directory)},sourceFingerprint:'${fingerprint}',worldId:'fixture',fromMinute:480});
 new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}).start(480);process.exit(23);`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8'});assert.equal(result.status,23,result.stderr);
 const before=readdirSync(directory).map(p=>[p,readFileSync(join(directory,p),'utf8')]);const report=readAcceptanceEvidence(directory);
 assert.equal(report.complete,false);assert.equal(report.validPrefixRecords,1);assert.equal(report.downtimeMs,null);
 assert.deepEqual(readdirSync(directory).map(p=>[p,readFileSync(join(directory,p),'utf8')]),before);
 const next=fixture(t,{previousRunId:report.runId!});next.start();const resumed=next.close();assert.equal(resumed.complete,true);
 assert.notEqual(resumed.runId,report.runId);assert.equal(resumed.previousRunId,report.runId);assert.equal(resumed.downtimeMs,null);
});

test('persisted fake-model observation preserves nine-person world, inputs and sqlite reload',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Network is forbidden');});
 const base=createFrontierWorld(),stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];for(const store of stores)store.commit(structuredClone(base),null);
 const directory=join(root(t),'runtime-observation');const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:base.id,fromMinute:base.minute});
 const contexts:unknown[][]=[[],[]];const result:ModelResult={decision:{intention:'PRIVATE_SYNTHETIC_REPLY',actions:[{type:'eat',item:'meal'},{type:'wait',minutes:60}]},inputTokens:1,outputTokens:1,latencyMs:1};
 const runtimes=stores.map((store,i)=>new ValleyRuntime(store,[{model:QWEN_MODEL,key:'PRIVATE_SYNTHETIC_KEY'}],async(_key,context)=>{contexts[i].push(structuredClone(context));return result;},
  {mode:'formal',dayMinutes:20,modelSlots:16,...(i?{directEatingEvidence:{observe:writer.observeDirectEating},decisionWaitEvidence:{observe:writer.observeDecisionWait,monotonicNow:()=>now}}:{})}));
 try{
  for(const runtime of runtimes)runtime.start();await flush();await flush();
  for(let i=0;i<6;i++){now+=1000;for(const runtime of runtimes)runtime.tick(now);await flush();}
  for(const runtime of runtimes)runtime.stop();assert.deepEqual(contexts[0],contexts[1]);assert.deepEqual(runtimes[0].world,runtimes[1].world);assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
  const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:runtimes[1].decisionWaitEvidenceStatus(),directEating:runtimes[1].directEatingEvidenceStatus()},sourceFingerprintAfter:fingerprint});
  assert.equal(report.complete,true);assert.equal(report.directEating.totals!.completedActions,9);
  const output=readdirSync(directory).map(p=>readFileSync(join(directory,p),'utf8')).join('');assert.equal(output.includes('PRIVATE_SYNTHETIC'),false);
 }finally{writer.abort();for(const runtime of runtimes)runtime.stop();for(const store of stores)store.close();}
});


test('finite individual receipt values cannot overflow into a known non-finite total',t=>{
 const f=fixture(t);f.start();
 const receipt={at:481,residentId:'a',eventId:'one',planId:'p',container:'person:a',item:'meal' as const,quantity:1,nutrition:Number.MAX_VALUE,hungerRelief:1};
 f.food.committed({worldId:'fixture',fromMinute:480,toMinute:481,receipts:[receipt,{...receipt,eventId:'two'}]},1);
 f.food.stop('fixture',481);f.wait.stop(481);
 const report=f.writer.close({reason:'scope_finished',statuses:{decisionWaiting:f.wait.status(),directEating:f.food.status()},sourceFingerprintAfter:fingerprint});
 assert.equal(report.complete,false);assert.ok(report.issues.includes('non_finite_aggregate'));assert.equal(report.directEating.totals,null);
});


test('a readback file replacement maps to a valid safe writer failure code',t=>{
 const f=fixture(t);f.start();
 rmSync(join(f.directory,'evidence.jsonl'));symlinkSync(join(f.directory,'missing-synthetic'),join(f.directory,'evidence.jsonl'));
 assert.throws(()=>f.close(),/readback_failed/);assert.equal(f.writer.status().failure,'readback_failed');
 const report=readAcceptanceEvidence(f.directory);assert.equal(report.complete,false);assert.ok(report.issues.includes('writer_failure'));assert.equal(report.issues.includes('invalid_failure_marker'),false);
});

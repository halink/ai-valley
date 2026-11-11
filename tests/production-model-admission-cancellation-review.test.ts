import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {createMemoryProductionHttp} from '../src/server/production-model-http.js';
import {SyntheticPriceSession,syntheticPriceSessionContract} from '../src/server/production-model-price-session.js';
import {createSyntheticPriceEvidence} from '../src/server/production-model-price-evidence.js';
import {createSyntheticPriceRuntimeSegment} from '../src/server/production-model-price-runtime.js';
import {persistedWorldFingerprint as fingerprint} from '../src/server/acceptance-offline-protocol.js';
import {PRODUCTION_MODEL_CANDIDATE as P} from '../src/server/production-model-policy.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function runtimeFixture(t:TestContext,limit=20){
 let at=1_000_000,nextTimer=0;
 const timers=new Map<number,{at:number;callback:()=>void}>();
 t.mock.method(Date,'now',()=>at);t.mock.method(performance,'now',()=>at);
 t.mock.method(globalThis,'setInterval',(()=>0) as unknown as typeof setInterval);
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,ms:number)=>{const id=++nextTimer;timers.set(id,{at:at+ms,callback});return id;}) as unknown as typeof setTimeout);
 t.mock.method(globalThis,'clearTimeout',((id:number)=>timers.delete(id)) as unknown as typeof clearTimeout);
 mkdirSync('output/admission-cancellation-review',{recursive:true});
 const dir=mkdtempSync(join(resolve('output/admission-cancellation-review'),'fixture-')),worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'model.sqlite'),sessionPath=join(dir,'session.sqlite');
 let store=new WorldStore(worldPath),db=new DatabaseSync(journalPath),sd=new DatabaseSync(sessionPath);
 store.commit(createFrontierWorld(5401),null);
 const common={runId:'synthetic-price-runtime',worldId:store.loadForRuntime()!.id,maxRequests:limit,createdAtMs:at-1,deadlineAtMs:at+2_000_000,requestTimeoutMs:5000};
 const jc=productionCandidateContract(common),sc=syntheticPriceSessionContract({...common,sourceFingerprint:'a'.repeat(64),fixtureScopeHash:'b'.repeat(64),
  commitGraceMs:1000,maxSegments:30,maxEpochs:10,maxAuditRecords:60002});
 let journal=new ProductionModelJournal(db,jc,{create:true,worldFingerprint:fingerprint(store.loadForRuntime())});
 let session=new SyntheticPriceSession(sd,sc,{create:true,worldFingerprint:fingerprint(store.loadForRuntime()),nowMs:at});
 let memory=createMemoryProductionHttp(),bridge:ReturnType<typeof createSyntheticPriceRuntimeSegment>|undefined;
 const install=()=>{const s=session.status();session.installPrice(createSyntheticPriceEvidence({scopeHash:session.contractHash,sequence:s.epochs+1,
  previousEvidenceHash:s.evidenceHash,fixtureId:'runtime-test',observedAtMs:at,validUntilMs:at+900000}),at);};install();
 const open=()=>{memory=createMemoryProductionHttp();bridge=createSyntheticPriceRuntimeSegment({store,journal,session,transport:memory.transport,endGameMinute:store.loadForRuntime()!.minute+60});return bridge;};
 const respond=(index=0,content?:string)=>{
  const messages=JSON.parse(memory.requests()[index].body).messages as {content:string}[];
  const choice=messages.map(m=>m.content).join('\n').match(/^(\S+)\. 原地停留/m)?.[1];assert.ok(choice);
  memory.headers(index);memory.chunk(index,Buffer.from(JSON.stringify({model:P.model,choices:[{message:{content:content??JSON.stringify({choice,minutes:15})},finish_reason:'stop'}],
   usage:{prompt_tokens:1,completion_tokens:1}})));memory.end(index);
 };
 const reopen=()=>{
  bridge?.close();store.close();db.close();sd.close();store=new WorldStore(worldPath);db=new DatabaseSync(journalPath);sd=new DatabaseSync(sessionPath);
  const worldFingerprint=fingerprint(store.loadForRuntime());journal=new ProductionModelJournal(db,jc,{create:false,worldFingerprint});
  session=new SyntheticPriceSession(sd,sc,{create:false,worldFingerprint,nowMs:at});bridge=undefined;
 };
 t.after(()=>{bridge?.close();try{store.close();}catch{}try{db.close();}catch{}try{sd.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 return {open,respond,reopen,install,get bridge(){return bridge!;},get memory(){return memory;},get store(){return store;},get journal(){return journal;},get session(){return session;},
  get now(){return at;},set now(value:number){at=value;},timers,dir,worldPath,journalPath,sessionPath,jc,sc,
  advance(ms:number){const target=at+ms;for(;;){const due=[...timers.entries()].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;
   at=due[1].at;timers.delete(due[0]);due[1].callback();}at=target;}};
}


import {checkSyntheticRehearsal,checkSyntheticCancellationHistory,rehearsalSnapshot,SYNTHETIC_NINE_IDS,type SyntheticRehearsalReport} from '../src/server/production-model-process-rehearsal.js';
import {syntheticRecordHash as hash} from '../src/server/production-model-price-evidence.js';
import {foundingHouseholds} from '../src/world/founders.js';
import type {SyntheticLaunchReceipt} from '../src/server/production-model-process-ledger.js';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),mono=(ms:number)=>String(BigInt(ms)*1_000_000n);
// Detached, artificial validator input only. Never used as process/run evidence.
function validatorFixture(){
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
 return {receipt,report,context:{runId:report.runId,sourceFingerprint:C,originalDeadlineAtMs:report.originalDeadlineAtMs,attempts:9,completed:9,after:structuredClone(report.after)}};
}

test('cancellation review: extra persisted start without explicit evidence cannot pass',()=>{
 const f=validatorFixture();f.report.after.requests++;f.context.after=structuredClone(f.report.after);
 assert.throws(()=>checkSyntheticRehearsal(f.report,f.receipt,f.context),/synthetic_continuity_evidence_invalid/);
});

for(const mode of ['cutoff','drain'] as const)test(`cancellation review: ${mode} after persisted start records one terminal cancellation and reopens cleanly`,t=>{
 const f=runtimeFixture(t),b=f.open(),before=structuredClone(b.runtime.world),cutoff=f.session.status().segment!.admissionCutoffMs;
 t.mock.method(process.hrtime,'bigint',()=>BigInt(f.now)*1_000_000n);
 b.runtime.subscribe(()=>{if(b.runtime.world.metrics.requests===before.metrics.requests+1&&b.runtime.acceptanceStopStatus()?.phase==='running'){
  if(mode==='cutoff')f.now=cutoff;else b.drain();
 }});
 b.runtime.start();const status=b.status(),events=status.admissionCancellations;
 assert.equal(status.sealed,true);assert.equal(status.failure,null);assert.equal(f.memory.requests().length,0);
 assert.equal(status.session.attempts,0);assert.equal(status.journal.attempts,0);assert.equal(status.session.completed,0);assert.equal(status.journal.completed,0);
 assert.equal(b.runtime.world.metrics.requests,before.metrics.requests+1);assert.equal(b.runtime.world.metrics.successes,before.metrics.successes);
 assert.equal(events.length,1);const e=events[0];assert.equal(e.reason,mode);assert.equal(e.requestNumber,before.metrics.requests+1);
 assert.equal(e.model,P.model);assert.ok(e.actorId);assert.ok(e.revision>before.revision&&e.revision<b.runtime.world.revision);
 assert.equal(e.atMs,f.now);assert.equal(e.monotonicNs,mono(f.now));assert.equal(e.transportInvocations,0);
 for(const field of ['sessionAttempts','sessionCompleted','modelAttempts','modelCompleted'] as const)assert.equal(e[field],0);
 for(const field of ['worldFingerprint','sessionHash','journalHash'] as const)assert.match(e[field],/^[a-f0-9]{64}$/);
 events.length=0;assert.equal(b.status().admissionCancellations.length,1,'returned evidence array is detached');
 const savedReceipt=structuredClone(b.runtime.world.metrics.admissionCancellation);assert.ok(savedReceipt);
 assert.equal(savedReceipt.count,1);assert.equal(savedReceipt.baselineRequests,before.metrics.requests);assert.equal(savedReceipt.baselineCancellations,0);
 for(const field of ['actorId','model','requestNumber','revision','atMs','monotonicNs'] as const)assert.equal(savedReceipt[field],e[field]);
 const stoppedFingerprint=fingerprint(b.runtime.world);f.reopen();assert.deepEqual(f.store.loadForRuntime()!.metrics.admissionCancellation,savedReceipt);assert.equal(fingerprint(f.store.loadForRuntime()),stoppedFingerprint);
 assert.equal(f.session.status().pending,null);assert.equal(f.journal.status().pending,null);assert.equal(f.session.status().segment,null);
 assert.equal(f.session.status().attempts,0);assert.equal(f.journal.status().attempts,0);
});

function cancelledValidatorFixture(){
 const f=validatorFixture();f.report.after.requests++;
 f.report.admissionCancellations=[{actorId:SYNTHETIC_NINE_IDS[0],model:P.model,requestNumber:10,revision:19,count:1,baselineRequests:0,baselineCancellations:0,previousReceiptHash:null,reason:'cutoff',atMs:25000,monotonicNs:mono(25000),
  sessionAttempts:9,sessionCompleted:9,modelAttempts:9,modelCompleted:9,transportInvocations:9,worldFingerprint:B,sessionHash:C,journalHash:C}];
 const expected=structuredClone(f.report.admissionCancellations[0]);
 const {actorId,model,requestNumber,revision,atMs,monotonicNs,count,baselineRequests,baselineCancellations,previousReceiptHash}=expected;
 f.report.after.admissionCancellation={actorId,model,requestNumber,revision,atMs,monotonicNs,count,baselineRequests,baselineCancellations,previousReceiptHash};
 return {...f,context:{...f.context,after:structuredClone(f.report.after),cancellationCheckpoint:(event:typeof expected)=>event.worldFingerprint===expected.worldFingerprint
  &&event.sessionHash===expected.sessionHash&&event.journalHash===expected.journalHash}};
}
test('cancellation review: balanced legacy evidence and explicit terminal cancellation both pass',()=>{
 for(const f of [validatorFixture(),cancelledValidatorFixture()])assert.equal(checkSyntheticRehearsal(f.report,f.receipt,f.context).requests,9);
});
test('cancellation review: unbalanced, forged, duplicated and nonterminal cancellation evidence fails',()=>{
 const mutations:Array<[string,(f:ReturnType<typeof cancelledValidatorFixture>)=>void]>=[
  ['hide current receipt in forged baseline',f=>{
   f.report.admissionCancellations=[];f.report.before.requests++;
   f.report.before.admissionCancellation=structuredClone(f.report.after.admissionCancellation);
  }],
  ['missing',f=>{delete f.report.admissionCancellations;}],['empty',f=>{f.report.admissionCancellations=[];}],
  ['duplicate',f=>{f.report.admissionCancellations!.push(structuredClone(f.report.admissionCancellations![0]));}],
  ['wrong start count',f=>{f.report.after.requests++;}],['invented cancellation without start',f=>{f.report.after.requests--;}],
  ['nonterminal request number',f=>{Object.assign(f.report.admissionCancellations![0],{requestNumber:f.report.admissionCancellations![0].requestNumber-1});}],
  ['pre-ack revision',f=>{Object.assign(f.report.admissionCancellations![0],{revision:f.report.requests.at(-1)!.revision!});}],
  ['post-stop revision',f=>{Object.assign(f.report.admissionCancellations![0],{revision:f.report.after.revision});}],
  ['early wall',f=>{Object.assign(f.report.admissionCancellations![0],{atMs:24999});}],['early monotonic',f=>{Object.assign(f.report.admissionCancellations![0],{monotonicNs:mono(24999)});}],
  ['late wall',f=>{Object.assign(f.report.admissionCancellations![0],{atMs:25201});}],['late monotonic',f=>{Object.assign(f.report.admissionCancellations![0],{monotonicNs:mono(25201)});}],
  ['wrong model',f=>{Object.assign(f.report.admissionCancellations![0],{model:'forged'});}],
  ['wrong actor',f=>{Object.assign(f.report.admissionCancellations![0],{actorId:'founder-99-1'});}],
  ['alternate known actor',f=>{Object.assign(f.report.admissionCancellations![0],{actorId:SYNTHETIC_NINE_IDS[1]});}],
  ['forged before counter',f=>{f.report.before.requests--;f.report.after.requests++;}],
  ['forged baseline',f=>{Object.assign(f.report.admissionCancellations![0],{baselineRequests:1});}],
  ['forged prior count',f=>{Object.assign(f.report.admissionCancellations![0],{baselineCancellations:1});}],
  ['forged total count',f=>{Object.assign(f.report.admissionCancellations![0],{count:2});}],
  ['missing persisted receipt',f=>{delete f.context.after.admissionCancellation;}],
  ['manual drain',f=>{f.report.admissionCancellations![0].reason='drain';}],
  ['checkpoint absent',f=>{Object.assign(f.context,{cancellationCheckpoint:undefined});}],
  ['checkpoint rejects',f=>{f.context.cancellationCheckpoint=()=>false;}],
  ['rehash-looking world',f=>{f.report.admissionCancellations![0].worldFingerprint='d'.repeat(64);}],
  ['rehash-looking session',f=>{f.report.admissionCancellations![0].sessionHash='d'.repeat(64);}],
  ['rehash-looking journal',f=>{f.report.admissionCancellations![0].journalHash='d'.repeat(64);}],
 ];
 for(const field of ['sessionAttempts','sessionCompleted','modelAttempts','modelCompleted','transportInvocations'] as const)
  mutations.push([`wrong ${field}`,f=>{f.report.admissionCancellations![0][field]++;}]);
 for(const field of ['worldFingerprint','sessionHash','journalHash'] as const)
  mutations.push([`invalid ${field}`,f=>{f.report.admissionCancellations![0][field]='forged';}]);
 for(const [name,mutate] of mutations){const f=cancelledValidatorFixture();mutate(f);
  assert.throws(()=>checkSyntheticRehearsal(f.report,f.receipt,f.context),/synthetic_continuity_evidence_invalid/,name);
 }
});

import {continuityFixture,reconcileContinuity,type ContinuityData} from './helpers/production-continuity-fixture.js';
function rehashReports(data:ContinuityData){
 for(const p of data.reports){const r=data.rehearsals.find(r=>r.id===p.id);if(r)p.rehearsalHash=hash(r);}
 let previous=hash(data.manifest.contract);
 for(const [i,row] of data.launch.entries()){
  const event=JSON.parse(row.body);if(event.type==='finished')event.reportHash=hash(data.reports.find(p=>p.id===event.id));
  row.body=JSON.stringify(event);row.sequence=i+1;row.previous_hash=previous;
  row.hash=hash({sequence:row.sequence,previousHash:previous,body:row.body});previous=row.hash;
 }
}
test('cancellation review: full report and launch rehash cannot disguise unexplained starts or forged cancellations',{timeout:60000},async t=>{
 const f=continuityFixture(t),run=await f.launch('sustained');assert.equal(run.code,0,JSON.stringify(run.diagnostic));
 const clean=f.read();assert.equal(reconcileContinuity(clean).finished,1);
 const mutations:Array<[string,(d:ContinuityData)=>void]>=[
  ['unexplained start',d=>{d.rehearsals[0].after.requests++;d.world.requests++;delete d.rehearsals[0].admissionCancellations;}],
  ['forged nonterminal cancellation',d=>{
   const r=d.rehearsals[0],receipt=d.receipts[0],p=d.reports[0];r.after.requests++;d.world.requests++;
   r.admissionCancellations=[{actorId:r.requests[0].actorId,model:P.model,requestNumber:r.after.requests-1,revision:r.after.revision-1,count:1,baselineRequests:r.before.requests,baselineCancellations:0,previousReceiptHash:null,
    reason:'cutoff',atMs:receipt.deadlineAtMs-6000,monotonicNs:String(BigInt(receipt.deadlineMonotonicNs)-6000000000n),
    sessionAttempts:p.attempts,sessionCompleted:p.completed,modelAttempts:p.attempts,modelCompleted:p.completed,
    transportInvocations:r.requests.length,worldFingerprint:r.after.worldFingerprint,sessionHash:p.sessionHash,journalHash:p.journalHash}];
  }],
  ['existing drain checkpoint cannot invent a durable cancellation',d=>{
   const r=d.rehearsals[0],p=d.reports[0],drain=d.session.slice().reverse().find(row=>JSON.parse(row.body).type==='drain_started')!;
   const checkpoint=d.session.slice(0,d.session.indexOf(drain)).reverse().find(row=>JSON.parse(row.body).type==='world_checkpoint')!;
   const fp=JSON.parse(checkpoint.body).worldFingerprint;
   const model=d.model.slice().reverse().find(row=>{const e=JSON.parse(row.body);return e.type==='world_checkpoint'&&e.worldFingerprint===fp;})!;
   r.before.requests--;for(const tick of r.ticks)tick.revision--;
   r.admissionCancellations=[{actorId:r.requests[0].actorId,model:P.model,requestNumber:r.after.requests,revision:r.after.revision-1,
    atMs:r.finishedAtMs,monotonicNs:r.finishedMonotonicNs,count:1,baselineRequests:r.before.requests,baselineCancellations:0,previousReceiptHash:null,reason:'cutoff',
    sessionAttempts:p.attempts,sessionCompleted:p.completed,modelAttempts:p.attempts,modelCompleted:p.completed,
    transportInvocations:r.requests.length,worldFingerprint:fp,sessionHash:drain.hash,journalHash:model.hash}];
  }],
  ['post-cutoff transport',d=>{const r=d.rehearsals[0],receipt=d.receipts[0];r.requests.at(-1)!.observedAtMs=receipt.deadlineAtMs-6000;}],
 ];
 for(const [name,mutate] of mutations){const d=structuredClone(clean);mutate(d);rehashReports(d);assert.throws(()=>reconcileContinuity(d),(error:unknown)=>error instanceof Error,name);}
 t.diagnostic(`Generated synthetic evidence: ${f.path}`);
});

test('cancellation review: reentrant drain during price dispatch produces synchronous evidence, never transport',t=>{
 const f=runtimeFixture(t);let assessments=0,calls=0;const events:unknown[]=[];let runtime:ValleyRuntime;
 runtime=new ValleyRuntime(f.store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async()=>{calls++;return new Promise<never>(()=>{});},
  {mode:'formal',modelSlots:1,acceptanceAdmission:()=>true,decisionAdmissionCancelled:event=>{events.push(event);},acceptanceStop:{
   endGameMinute:f.store.loadForRuntime()!.minute+60,maxWallMs:30000,maxRequests:10,allowedModels:[P.model],assessPrice:model=>{
    if(++assessments===3)runtime.drainAcceptance();
    return {model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:f.now+30000};
   }}});
 t.after(()=>runtime.stop());runtime.start();assert.equal(assessments,3);assert.equal(calls,0);assert.equal(events.length,1);
 assert.equal(runtime.world.metrics.requests,1);assert.equal(runtime.world.metrics.successes,0);assert.equal(runtime.acceptanceStopStatus()?.phase,'stopped');
});
test('cancellation review: throwing admission is a failure, not cancellation evidence',t=>{
 const f=runtimeFixture(t);let calls=0,events=0;let runtime:ValleyRuntime;
 runtime=new ValleyRuntime(f.store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async()=>{calls++;return new Promise<never>(()=>{});},
  {mode:'formal',modelSlots:1,acceptanceAdmission:()=>{if(runtime.world.metrics.requests)throw new Error('admission_fault');return true;},
   decisionAdmissionCancelled:()=>{events++;},acceptanceStop:{endGameMinute:f.store.loadForRuntime()!.minute+60,maxWallMs:30000,maxRequests:10,
    allowedModels:[P.model],assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:f.now+30000})}});
 t.after(()=>runtime.stop());runtime.start();assert.equal(calls,0);assert.equal(events,0);assert.equal(runtime.acceptanceStopStatus()?.reason,'runtime_failed');
});

test('cancellation review: failed receipt persistence cannot emit evidence or seal',t=>{
 const f=runtimeFixture(t),b=f.open(),commit=f.store.commit.bind(f.store);
 t.mock.method(f.store,'commit',(...args:Parameters<WorldStore['commit']>)=>{
  if(args[0].metrics.admissionCancellation)throw new Error('receipt_disk_failure');return commit(...args);
 });
 b.runtime.subscribe(()=>{if(b.runtime.world.metrics.requests&&b.runtime.acceptanceStopStatus()?.phase==='running')b.drain();});
 b.runtime.start();const s=b.status();assert.equal(s.admissionCancellations.length,0);assert.equal(f.memory.requests().length,0);
 assert.equal(s.sealed,false);assert.ok(s.failure);assert.equal(s.session.attempts,0);assert.equal(s.journal.attempts,0);
 assert.equal(f.store.loadForRuntime()!.metrics.admissionCancellation,undefined);
});
for(const kind of ['async','throw'] as const)test(`cancellation review: ${kind} observer fails closed`,t=>{
 const f=runtimeFixture(t);let calls=0,events=0;let runtime:ValleyRuntime;
 runtime=new ValleyRuntime(f.store,[{model:P.model,key:'OFFLINE-ONLY-NOT-A-CREDENTIAL'}],async()=>{calls++;return new Promise<never>(()=>{});},
  {mode:'formal',modelSlots:1,acceptanceAdmission:()=>true,decisionAdmissionCancelled:()=>{events++;if(kind==='throw')throw new Error('observer_fault');return Promise.resolve();},
   acceptanceStop:{endGameMinute:f.store.loadForRuntime()!.minute+60,maxWallMs:30000,maxRequests:10,allowedModels:[P.model],
    assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:f.now+30000})}});
 t.after(()=>runtime.stop());runtime.subscribe(()=>{if(runtime.world.metrics.requests&&runtime.acceptanceStopStatus()?.phase==='running')runtime.drainAcceptance();});
 runtime.start();assert.equal(calls,0);assert.equal(events,1);assert.equal(runtime.acceptanceStopStatus()?.reason,'runtime_failed');
});

test('cancellation review: resumed segment preserves cumulative cancellation baseline',t=>{
 const f=runtimeFixture(t);t.mock.method(process.hrtime,'bigint',()=>BigInt(f.now)*1_000_000n);
 const reports:SyntheticRehearsalReport[]=[];let previous:string|null=null;
 for(let count=1;count<=2;count++){
  const before=rehearsalSnapshot(f.store.loadForRuntime()!),b=f.open(),cutoff=f.session.status().segment!.admissionCutoffMs;
  b.runtime.subscribe(()=>{if(b.runtime.world.metrics.requests===count)f.now=cutoff;});b.runtime.start();
  const s=b.status();assert.equal(s.sealed,true);assert.equal(s.failure,null);assert.equal(s.admissionCancellations.length,1);
  const e=s.admissionCancellations[0];assert.equal(e.count,count);assert.equal(e.baselineRequests,count-1);assert.equal(e.baselineCancellations,count-1);
  assert.equal(e.previousReceiptHash,previous);previous=hash(b.runtime.world.metrics.admissionCancellation);
  reports.push({...validatorFixture().report,id:count,before,after:rehearsalSnapshot(b.runtime.world)});
  assert.equal(e.requestNumber,count);assert.equal(e.transportInvocations,0);assert.equal(s.session.attempts,0);assert.equal(s.journal.attempts,0);
  f.reopen();assert.equal(f.store.loadForRuntime()!.metrics.admissionCancellation?.count,count);if(count===1)f.install();
 }
 const final=rehearsalSnapshot(f.store.loadForRuntime()!);assert.doesNotThrow(()=>checkSyntheticCancellationHistory(reports,final));
 const mutations:Array<[string,(r:SyntheticRehearsalReport[])=>void]>=[
  ['missing predecessor',r=>{r.shift();delete r[0].before.admissionCancellation;}],
  ['conflicting duplicate',r=>{r[0].after.admissionCancellation!.actorId=r[0].after.admissionCancellation!.actorId===SYNTHETIC_NINE_IDS[0]?SYNTHETIC_NINE_IDS[1]:SYNTHETIC_NINE_IDS[0];}],
  ['modified old receipt with recomputed link',r=>{
   r[0].after.admissionCancellation!.actorId=r[0].after.admissionCancellation!.actorId===SYNTHETIC_NINE_IDS[0]?SYNTHETIC_NINE_IDS[1]:SYNTHETIC_NINE_IDS[0];
   r[1].before.admissionCancellation=structuredClone(r[0].after.admissionCancellation);
   r[1].after.admissionCancellation!.previousReceiptHash=hash(r[0].after.admissionCancellation);
  }],
  ['broken previous hash',r=>{r[1].after.admissionCancellation!.previousReceiptHash=C;}],
  ['missing terminal receipt',r=>{delete r[1].after.admissionCancellation;}],
  ['future starting receipt',r=>{r[1].before.admissionCancellation!.revision=r[1].before.revision+1;}],
 ];
 for(const [name,mutate] of mutations){const changed=structuredClone(reports);mutate(changed);
  if(name==='missing terminal receipt')assert.doesNotThrow(()=>checkSyntheticCancellationHistory(changed,final),'final raw world itself supplies terminal anchor');
  else assert.throws(()=>checkSyntheticCancellationHistory(changed,final),/synthetic_continuity_evidence_invalid/,name);
 }
});

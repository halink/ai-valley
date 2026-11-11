/** Test-only, generated synthetic output only. No live/runtime save selection. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import type {TestContext} from 'node:test';
import {SyntheticProcessDirectory} from '../../src/server/production-model-process-storage.js';
import {rehearsalSnapshot,checkSyntheticRehearsal,type SyntheticRehearsalReport} from '../../src/server/production-model-process-rehearsal.js';
import {syntheticRecordHash as hash,parseSyntheticPriceRecord} from '../../src/server/production-model-price-evidence.js';
import type {SyntheticLaunchReceipt} from '../../src/server/production-model-process-ledger.js';
export const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const root=resolve('.'),base=join(root,'output','continuity-rehearsal');
type Row={sequence:number;previous_hash:string;body:string;hash:string};
export function continuityFixture(t:TestContext){
 mkdirSync(base,{recursive:true});const path=join(mkdtempSync(join(base,'case-')),'run');let invocation=0;
 const children:ChildProcess[]=[];
 t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await pause(100);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}});
 return {path,async launch(scenario='sustained',mode:'new'|'resume'='new'){
  const child=spawn(process.execPath,['--import',join(root,'scripts/acceptance-offline-guard.mjs'),'--import',join(root,'node_modules/tsx/dist/loader.mjs'),
   join(root,'scripts/production-model-process-guardian.mjs'),'--offline',mode,path,scenario],{cwd:root,env:{},shell:false,stdio:['ignore','pipe','pipe']});
  children.push(child);const number=++invocation,messages:any[]=[];let stdout='',stderr='';const startedAtMs=Date.now();
  child.stdout!.on('data',chunk=>{stdout+=chunk;for(;;){const i=stdout.indexOf('\n');if(i<0)break;const line=stdout.slice(0,i);stdout=stdout.slice(i+1);try{messages.push(JSON.parse(line));}catch{}}});
  child.stderr!.on('data',chunk=>{stderr+=chunk;});
  const result=await new Promise<{code:number|null;signal:string|null}>(resolve=>{child.once('error',e=>{stderr+=e;resolve({code:null,signal:null});});child.once('close',(code,signal)=>resolve({code,signal}));});
  const report={...result,scenario,mode,startedAtMs,finishedAtMs:Date.now(),messages,stderr};
  // Each invocation capture is outside the run protocol and never trusted by guardian.
  writeFileSync(join(path,'..',`invocation-${number}.json`),JSON.stringify(report,null,2),{mode:0o600});return report;
 },read(){return readContinuity(path);}};
}
export function readContinuity(path:string){
 const directory=SyntheticProcessDirectory.open(root,path,false),rows=(file:'launch.sqlite'|'model.sqlite'|'session.sqlite',table:string)=>{
  const db=new DatabaseSync(directory.database(file),{readOnly:true});try{return db.prepare(`SELECT sequence,previous_hash,body,hash FROM ${table} ORDER BY sequence`).all() as Row[];}finally{db.close();}};
 try{
  const manifest=directory.readJson('manifest.json') as any,launch=rows('launch.sqlite','synthetic_launch_audit'),model=rows('model.sqlite','production_model_audit'),session=rows('session.sqlite','synthetic_price_session_audit');
  const reservations=launch.map(row=>JSON.parse(row.body)).filter(e=>e.type==='reserved'),finishes=launch.map(row=>JSON.parse(row.body)).filter(e=>e.type==='finished');
  const receipts=reservations.map(e=>directory.readJson(`launch-${e.receipt.id}.json`) as SyntheticLaunchReceipt),reports=finishes.map(e=>directory.readJson(`process-${e.id}.json`) as any);
  const rehearsals=reports.filter(p=>p.rehearsalHash).map(p=>directory.readJson(`rehearsal-${p.id}.json`) as SyntheticRehearsalReport);
  const observations=reports.map(p=>directory.readJson(`watchdog-${p.id}.json`) as any);
  const db=new DatabaseSync(directory.database('world.sqlite'),{readOnly:true});let world;
  try{
   const saved=db.prepare('SELECT state FROM worlds ORDER BY rowid DESC LIMIT 1').get() as {state:Uint8Array};
   const {terrainKey,resourceChanges,resourceCount,ledgerVersion,...raw}=JSON.parse(gunzipSync(saved.state).toString());assert.equal(ledgerVersion,1);
   const terrain=db.prepare('SELECT body FROM terrain WHERE hash=?').get(terrainKey) as {body:Uint8Array};raw.map=JSON.parse(gunzipSync(terrain.body).toString());
   const resources=db.prepare('SELECT body FROM resource_bases WHERE world_id=?').get(raw.id) as {body:Uint8Array};raw.resources=JSON.parse(gunzipSync(resources.body).toString()).slice(0,resourceCount);
   for(const [i,value] of resourceChanges)raw.resources[i]=value;
   raw.events=db.prepare('SELECT body FROM events WHERE world_id=? ORDER BY rowid').all(raw.id).map(r=>JSON.parse(String(r.body)));
   // This fixed short rehearsal must fit the complete working event window.
   // Do not silently generalize this decoder to long-lived worlds.
   assert.ok(raw.events.length<=180);raw.processed=[];world=rehearsalSnapshot(raw as Parameters<typeof rehearsalSnapshot>[0]);
  }finally{db.close();}
  return {manifest,launch,model,session,receipts,reports,rehearsals,observations,world};
 }finally{directory.close();}
}
export type ContinuityData=ReturnType<typeof readContinuity>;
function chain(rows:Row[],initial:string){let previous=initial;return rows.map((row,i)=>{
 assert.equal(row.sequence,i+1);assert.equal(row.previous_hash,previous);assert.equal(row.hash,hash({sequence:row.sequence,previousHash:row.previous_hash,body:row.body}));previous=row.hash;return JSON.parse(row.body);
 });}
/** Independent correspondence checks, not journal constructors or aggregate-only
 * equality. An expected failed run returns its unacknowledged suffix explicitly. */
export function reconcileContinuity(data:ContinuityData,clean=true){
 const {manifest,world}=data,c=manifest.contract,ch=hash(c);
 const le=chain(data.launch,ch),me=chain(data.model,hash(manifest.modelContract)),se=chain(data.session,ch);
 assert.equal(hash(me[0].contract),hash(manifest.modelContract));assert.equal(hash(se[0].contract),ch);assert.equal(le[0].contractHash,ch);
 assert.equal(c.worldId,world.worldId);assert.equal(c.maxRequests,20000);assert.equal(c.deadlineAtMs-c.createdAtMs,21600000);assert.equal(c.segmentWallMs,30000);
 assert.equal(c.modelSlots,1);assert.equal(c.retries,0);assert.equal(c.fallback,null);assert.equal(c.spendingLimitCny,0);
 const requests=(events:any[],rows:Row[],session:boolean)=>{
  const all:Array<{id:number;requestHash:string;responseHash:string|null;worldFingerprint:string|null;epoch:number}>=[];
  let pending:typeof all[number]|null=null,epoch=0,segment=0,open=false,priceHash:string|null=null,worldFingerprint=manifest.initialWorldFingerprint,completed=0,runtimeStop=false;
  const tips=new Map<string,{attempts:number;completed:number;worldFingerprint:string;epoch:number;segment:number;open:boolean;pending:boolean;runtimeStop:boolean}>();
  for(const [index,e] of events.entries()){
   if(session&&e.type==='price_installed'){const price=parseSyntheticPriceRecord(e.evidence);assert.equal(price.scopeHash,ch);assert.equal(price.sequence,++epoch);assert.equal(price.previousEvidenceHash,priceHash);priceHash=hash(price);assert.equal(open,false);}
   else if(session&&e.type==='segment_started'){assert.equal(open,false);open=true;segment++;assert.equal(epoch,segment);}
   else if(e.type==='intent'){assert.equal(pending,null);const id=all.length+1;if(!session)assert.equal(e.id,id);else assert.equal(open,true);pending={id,requestHash:e.requestHash,responseHash:null,worldFingerprint:null,epoch};all.push(pending);}
   else if(e.type==='response'){assert.ok(pending);assert.equal(e.id,pending.id);assert.equal(pending.responseHash,null);pending.responseHash=e.responseHash;}
   else if(e.type===(session?'acknowledged':'world_committed')){assert.ok(pending);assert.equal(e.id,pending.id);assert.ok(pending.responseHash);if(session)assert.equal(e.worldId,c.worldId);pending.worldFingerprint=e.worldFingerprint;pending=null;completed++;}
   else if(session&&e.type==='segment_finished'){assert.equal(open,true);assert.equal(pending,null);open=false;}
   else if(!session&&e.type==='runtime_stop_started'){assert.equal(runtimeStop,false);runtimeStop=true;}
   else if(!session&&e.type==='runtime_stop_finished'){assert.equal(runtimeStop,true);runtimeStop=false;if(clean)assert.equal(e.failed,false);}
   if(['created','world_checkpoint','world_committed','acknowledged','segment_finished','runtime_stop_finished'].includes(e.type)&&e.worldFingerprint)worldFingerprint=e.worldFingerprint;
   tips.set(rows[index].hash,{attempts:all.length,completed,worldFingerprint,epoch,segment,open,pending:pending!==null,runtimeStop});
  }
  return {all,pending,epoch,segment,open,tips};
 };
 const model=requests(me,data.model,false),session=requests(se,data.session,true);
 for(let i=0;i<Math.min(model.all.length,session.all.length);i++){
  const m=model.all[i],s=session.all[i];assert.equal(m.id,s.id);assert.equal(m.requestHash,s.requestHash);
  if(m.responseHash&&s.responseHash)assert.equal(m.responseHash,s.responseHash);
  if(m.worldFingerprint&&s.worldFingerprint)assert.equal(m.worldFingerprint,s.worldFingerprint);
 }
 const reserved=le.filter(e=>e.type==='reserved'),finished=le.filter(e=>e.type==='finished');
 assert.equal(reserved.length,data.receipts.length);assert.equal(finished.length,data.reports.length);
 let previous={worldFingerprint:manifest.initialWorldFingerprint,attempts:0,completed:0,sessionHash:manifest.initialSessionHash,journalHash:manifest.initialJournalHash};
 const evidence=se.filter(e=>e.type==='price_installed');
 for(const [i,e] of reserved.entries()){
  const r=e.receipt;assert.equal(r.id,i+1);assert.deepEqual(r,data.receipts[i]);assert.equal(r.contractHash,ch);assert.equal(r.bootId,manifest.bootId);
  assert.equal(r.deadlineAtMs-r.startedAtMs,30000);assert.equal(BigInt(r.deadlineMonotonicNs)-BigInt(r.startedMonotonicNs),30000000000n);assert.ok(r.deadlineAtMs<=c.deadlineAtMs);
  assert.equal(r.worldFingerprint,previous.worldFingerprint);assert.equal(r.attempts,previous.attempts);assert.equal(r.completed,previous.completed);
  assert.equal(r.previousSessionHash,previous.sessionHash);assert.equal(r.journalHash,previous.journalHash);assert.equal(r.evidenceHash,hash(evidence[i].evidence));
  assert.equal(evidence[i].evidence.validUntilMs,r.deadlineAtMs);
  const allocated=session.tips.get(r.sessionHash);assert.ok(allocated);assert.equal(allocated.epoch,r.id);assert.equal(allocated.segment,r.id-1);
  assert.equal(allocated.attempts,r.attempts);assert.equal(allocated.completed,r.completed);assert.equal(allocated.worldFingerprint,r.worldFingerprint);assert.equal(allocated.pending,false);assert.equal(allocated.open,false);
  const f=finished[i];if(!f){assert.equal(i,reserved.length-1);continue;}
  assert.equal(f.id,r.id);const p=data.reports[i],o=data.observations[i];assert.equal(hash(p),f.reportHash);assert.equal(p.receiptHash,hash(r));assert.deepEqual(p.observation,o);
  assert.equal(p.id,r.id);assert.equal(p.originalDeadlineAtMs,c.deadlineAtMs);assert.equal(p.reservedWallMs,r.id*30000);
  assert.equal(p.worldFingerprint,f.worldFingerprint);assert.equal(p.sessionHash,f.sessionHash);assert.equal(p.journalHash,f.journalHash);
  assert.equal(p.attempts,f.attempts);assert.equal(p.completed,f.completed);assert.equal(p.attempts,p.completed);assert.ok(p.attempts>=previous.attempts);
  assert.equal(p.realModelExecuted,false);assert.equal(p.liveExecutionEnabled,false);assert.equal(p.actualProviderCostCny,null);assert.equal(p.readyForProduction,false);assert.equal(p.acceptancePassed,null);
  assert.deepEqual(p.watchdogExit,{code:0,signal:null});assert.equal(o.process.exit.observed,true);assert.equal(o.process.exit.code,0);assert.equal(o.process.exit.signal,null);
  assert.equal(o.process.cleanupComplete,true);assert.equal(o.process.groupState,'absent');assert.equal(o.process.trigger,'child_exit');assert.deepEqual(o.process.issues,[]);
  const st=session.tips.get(f.sessionHash),mt=model.tips.get(f.journalHash);assert.ok(st&&mt);
  for(const tip of [st,mt]){assert.equal(tip.attempts,f.attempts);assert.equal(tip.completed,f.completed);assert.equal(tip.worldFingerprint,f.worldFingerprint);assert.equal(tip.pending,false);assert.equal(tip.runtimeStop,false);}
  assert.equal(st.segment,r.id);assert.equal(st.epoch,r.id);assert.equal(st.open,false);
  if(p.rehearsalHash){const rr=data.rehearsals.find(v=>v.id===r.id)!;assert.ok(rr);assert.equal(hash(rr),p.rehearsalHash);
   checkSyntheticRehearsal(rr,r,{runId:c.runId,sourceFingerprint:c.sourceFingerprint,originalDeadlineAtMs:c.deadlineAtMs,attempts:p.attempts,completed:p.completed,after:rr.after});
   assert.equal(rr.after.worldFingerprint,p.worldFingerprint);
   for(const q of rr.requests){const m=model.all[q.id-1],s=session.all[q.id-1];assert.ok(m&&s);assert.equal(s.epoch,r.id);
    assert.equal(hash(q.requestBody),m.requestHash);assert.equal(hash(q.reply),m.responseHash);assert.equal(q.requestHash,s.requestHash);assert.equal(q.responseHash,s.responseHash);
    assert.equal(q.worldFingerprint,m.worldFingerprint);assert.equal(q.worldFingerprint,s.worldFingerprint);
   }
  }
  previous=f;
 }
 if(clean){assert.equal(reserved.length,finished.length);assert.equal(session.segment,finished.length);assert.equal(session.epoch,finished.length);
  assert.equal(session.open,false);assert.equal(model.pending,null);assert.equal(session.pending,null);assert.equal(model.all.length,session.all.length);
  assert.equal(model.all.length,previous.attempts);assert.equal(model.all.length,previous.completed);assert.equal(world.worldFingerprint,previous.worldFingerprint);
  assert.equal(data.model.at(-1)?.hash,previous.journalHash);assert.equal(data.session.at(-1)?.hash,previous.sessionHash);
  for(const rows of [le,me,se])assert.equal(rows.some(e=>e.type==='blocked'),false);
  if(data.reports.at(-1)?.rehearsalHash)assert.deepEqual(world,data.rehearsals.find(r=>r.id===data.reports.at(-1).id)!.after);
  for(const [i,q] of model.all.entries()){assert.ok(q.worldFingerprint);assert.equal(q.responseHash,session.all[i].responseHash);assert.equal(q.worldFingerprint,session.all[i].worldFingerprint);}
 }
 return {launches:reserved.length,finished:finished.length,reservedWallMs:reserved.length*30000,modelAttempts:model.all.length,sessionAttempts:session.all.length,
  modelCompleted:model.all.filter(q=>q.worldFingerprint!==null).length,sessionCompleted:session.all.filter(q=>q.worldFingerprint!==null).length,
  modelPending:model.pending,sessionPending:session.pending,fromMinute:data.rehearsals[0]?.before.minute??null,toMinute:world.minute,
  observedDecisions:data.rehearsals.reduce((n,r)=>n+r.requests.length,0),epochs:session.epoch,segments:session.segment,
  realModelExecuted:false,liveExecutionEnabled:false,actualProviderCostCny:null,readyForProduction:false,acceptancePassed:null};
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {continuityFixture,reconcileContinuity,type ContinuityData} from './helpers/production-continuity-fixture.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const ids=Array.from({length:3},(_,h)=>Array.from({length:3},(_,m)=>`founder-${h+1}-${m+1}`)).flat().sort();
type Row=ContinuityData['launch'][number];

// Independent, read-only decoding of these newly generated short fixtures.
// Unlike WorldStore construction, this never installs schema or changes pragmas.
function readOwn(path:string):ContinuityData&{names:Record<string,string>}{
 const open=(name:string)=>new DatabaseSync(join(path,name),{readOnly:true});
 const rows=(name:string,table:string)=>{const db=open(name);try{return db.prepare(`SELECT sequence,previous_hash,body,hash FROM ${table} ORDER BY sequence`).all() as Row[];}finally{db.close();}};
 const manifest=json(join(path,'manifest.json')),launch=rows('launch.sqlite','synthetic_launch_audit'),model=rows('model.sqlite','production_model_audit'),session=rows('session.sqlite','synthetic_price_session_audit');
 const events=launch.map(r=>JSON.parse(r.body)),receipts=events.filter(e=>e.type==='reserved').map(e=>json(join(path,`launch-${e.receipt.id}.json`)));
 const reports=events.filter(e=>e.type==='finished').map(e=>json(join(path,`process-${e.id}.json`)));
 const rehearsals=reports.filter(r=>r.rehearsalHash).map(r=>json(join(path,`rehearsal-${r.id}.json`)));
 const observations=reports.map(r=>json(join(path,`watchdog-${r.id}.json`)));
 const db=open('world.sqlite');let raw:any;
 try{
  const saved=db.prepare('SELECT state FROM worlds ORDER BY rowid DESC LIMIT 1').get() as {state:Uint8Array};
  const {terrainKey,resourceChanges,resourceCount,ledgerVersion,...w}=JSON.parse(gunzipSync(saved.state).toString());assert.equal(ledgerVersion,1);
  const terrain=db.prepare('SELECT body FROM terrain WHERE hash=?').get(terrainKey) as {body:Uint8Array};w.map=JSON.parse(gunzipSync(terrain.body).toString());
  const base=db.prepare('SELECT body FROM resource_bases WHERE world_id=?').get(w.id) as {body:Uint8Array};w.resources=JSON.parse(gunzipSync(base.body).toString()).slice(0,resourceCount);
  for(const [index,value] of resourceChanges)w.resources[index]=value;
  w.events=db.prepare('SELECT body FROM events WHERE world_id=? ORDER BY rowid').all(w.id).map(r=>JSON.parse(String(r.body)));
  assert.ok(w.events.length<=180,'review decoder is limited to short generated fixtures whose complete event set is in the runtime window');
  w.processed=[];raw=w;
 }finally{db.close();}
 const world={worldId:raw.id,minute:raw.minute,revision:raw.revision,worldFingerprint:hash(canonical(raw)),requests:raw.metrics.requests,successes:raw.metrics.successes,failures:raw.metrics.failures,
  localDecisions:raw.metrics.localDecisions??0,inFlight:raw.metrics.inFlight,dayMinutes:raw.clock.realMinutesPerDay,
  residents:raw.residents.map((p:any)=>({id:p.id,name:p.name,lastDecisionAt:p.lastDecisionAt,status:p.status,recentActions:(p.recentActions??[]).map((a:any)=>({...a}))}))};
 return {manifest,launch,model,session,receipts,reports,rehearsals,observations,world,names:Object.fromEntries(raw.residents.map((p:any)=>[p.id,p.name]))};
}
function rechain(rows:Row[],initial:string){let previous=initial;for(const [i,row] of rows.entries()){row.sequence=i+1;row.previous_hash=previous;row.hash=hash({sequence:row.sequence,previousHash:previous,body:row.body});previous=row.hash;}}
function rebindObservation(d:ContinuityData){
 for(const p of d.reports){const r=d.rehearsals.find(r=>r.id===p.id);if(r)p.rehearsalHash=hash(r);}
 for(const row of d.launch){const e=JSON.parse(row.body);if(e.type==='finished'){e.reportHash=hash(d.reports.find(p=>p.id===e.id));row.body=JSON.stringify(e);}}
 rechain(d.launch,hash(d.manifest.contract));
}

test('continuity review: real progress and rehash-consistent evidence attacks',{timeout:60000},async t=>{
 const f=continuityFixture(t),run=await f.launch('sustained');assert.equal(run.code,0,JSON.stringify(run));
 const clean=readOwn(f.path),summary=reconcileContinuity(clean),r=clean.rehearsals[0],receipt=clean.receipts[0] as any;
 t.diagnostic(JSON.stringify({evidence:f.path,summary}));
 await t.test('actual default-clock progress, nine real prompt identities and request/response/ack triples',()=>{
  assert.deepEqual([...new Set(r.requests.map(q=>q.actorId))].sort(),ids);
  assert.ok(r.finishedAtMs>=receipt.deadlineAtMs-6000);assert.ok(run.finishedAtMs-run.startedAtMs>=24000);
  assert.ok(r.finishedAtMs<receipt.deadlineAtMs);assert.ok(r.after.minute-r.before.minute>=10&&r.after.minute-r.before.minute<=36);
  assert.equal(r.after.dayMinutes,20);assert.equal(r.after.requests-r.before.requests,r.requests.length);
  assert.equal(r.after.successes-r.before.successes,r.requests.length);assert.equal(r.after.localDecisions-r.before.localDecisions,r.requests.length);
  let priorAck=BigInt(r.startedMonotonicNs);
  for(const q of r.requests){
   const body=JSON.parse(q.requestBody),text=body.messages.map((m:any)=>m.content).join('\n');
   assert.ok(text.includes(`你是居民${clean.names[q.actorId]}，`),`request ${q.id} prompt must identify recorded actor`);
   assert.ok(q.observedAtMs<receipt.deadlineAtMs-6000);assert.ok(q.acknowledgedAtMs!<receipt.deadlineAtMs);
   assert.ok(BigInt(q.observedMonotonicNs)>=priorAck&&BigInt(q.acknowledgedMonotonicNs!)<=BigInt(r.finishedMonotonicNs));priorAck=BigInt(q.acknowledgedMonotonicNs!);
   const me=clean.model.map(row=>JSON.parse(row.body)),se=clean.session.map(row=>JSON.parse(row.body));
   for(const [events,ack] of [[me,'world_committed'],[se,'acknowledged']] as const){
    assert.equal(events.filter(e=>e.type==='response'&&e.id===q.id).length,1);assert.equal(events.filter(e=>e.type===ack&&e.id===q.id).length,1);
   }
  }
  assert.ok(r.after.residents.every(p=>p.lastDecisionAt>=r.before.minute));
 });
 await t.test('a fully rehashed actor permutation must not pass per-request actor evidence',()=>{
  const d=structuredClone(clean);for(const q of d.rehearsals[0].requests)q.actorId=ids[(ids.indexOf(q.actorId)+1)%ids.length];rebindObservation(d);
  assert.throws(()=>reconcileContinuity(d),'actor labels may not be reassigned independently from emitted request prompts');
 });
 await t.test('a fully rehashed post-cutoff request observation must not pass',()=>{
  const d=structuredClone(clean),q=d.rehearsals[0].requests.at(-1)!;q.observedAtMs=receipt.deadlineAtMs-6000;q.acknowledgedAtMs=r.finishedAtMs;
  q.observedMonotonicNs=r.finishedMonotonicNs;q.acknowledgedMonotonicNs=r.finishedMonotonicNs;rebindObservation(d);
  assert.throws(()=>reconcileContinuity(d),'admission cutoff must be checked, not only report completion time');
 });
 await t.test('a fully rehashed observation beyond monotonic hard deadline must not pass',()=>{
  const d=structuredClone(clean),q=d.rehearsals[0].requests.at(-1)!;q.observedMonotonicNs=(BigInt(receipt.deadlineMonotonicNs)+1n).toString();q.acknowledgedMonotonicNs=q.observedMonotonicNs;rebindObservation(d);
  assert.throws(()=>reconcileContinuity(d),'per-request monotonic timestamps must lie inside observed runtime lifetime');
 });
 await t.test('a fully rehashed early finish must not count as natural admission drain',()=>{
  const d=structuredClone(clean);d.rehearsals[0].finishedAtMs=receipt.deadlineAtMs-6001;
  d.rehearsals[0].finishedMonotonicNs=(BigInt(receipt.deadlineMonotonicNs)-6000000001n).toString();rebindObservation(d);
  assert.throws(()=>reconcileContinuity(d),'natural cutoff completion requires both original wall and monotonic lower bounds');
 });
 await t.test('rehashed repeated, post-finish and oversized tick observations are rejected',()=>{
  for(const mutate of [
   (rr:typeof r)=>{rr.ticks[1].atMs=rr.ticks[0].atMs;rr.ticks[1].monotonicNs=rr.ticks[0].monotonicNs;},
   (rr:typeof r)=>{rr.ticks.at(-1)!.monotonicNs=(BigInt(rr.finishedMonotonicNs)+1n).toString();},
   (rr:typeof r)=>{rr.ticks[0].minute=rr.before.minute+2.5;},
  ]){const d=structuredClone(clean);mutate(d.rehearsals[0]);rebindObservation(d);assert.throws(()=>reconcileContinuity(d));}
 });
 await t.test('rehashed model response mismatch is rejected despite valid hash chains',()=>{
  const d=structuredClone(clean),row=d.model.find(row=>JSON.parse(row.body).type==='response')!,e=JSON.parse(row.body);e.responseHash='0'.repeat(64);row.body=JSON.stringify(e);
  rechain(d.model,hash(d.manifest.modelContract));d.reports[0].journalHash=d.model.at(-1)!.hash;
  for(const row of d.launch){const e=JSON.parse(row.body);if(e.type==='finished'){e.journalHash=d.reports[0].journalHash;row.body=JSON.stringify(e);}}rebindObservation(d);
  assert.throws(()=>reconcileContinuity(d));
 });
 await t.test('modified older bound transcript blocks a real resume before another reservation',async st=>{
  assert.equal((await f.launch('normal','resume')).code,0);
  const progressed=readOwn(f.path);assert.equal(reconcileContinuity(progressed).finished,2);
  await st.test('a historical report cannot bind an existing audit tip with the wrong replayed state',()=>{
   const d=structuredClone(progressed),early=d.session.find(row=>JSON.parse(row.body).type==='price_installed')!.hash;
   d.reports[0].sessionHash=early;(d.receipts[1] as any).previousSessionHash=early;
   d.reports[1].receiptHash=hash(d.receipts[1]);
   for(const row of d.launch){const e=JSON.parse(row.body);
    if(e.type==='finished'&&e.id===1)e.sessionHash=early;
    if(e.type==='reserved'&&e.receipt.id===2)e.receipt=structuredClone(d.receipts[1]);
    row.body=JSON.stringify(e);
   }
   rebindObservation(d);
   assert.throws(()=>reconcileContinuity(d),'a present hash is insufficient unless its replayed counts and world match the report');
  });
  const path=join(f.path,'rehearsal-1.json'),changed=json(path);changed.requests[0].requestBody+=' ';writeFileSync(path,JSON.stringify(changed),{mode:0o600});
  const resumed=await f.launch('normal','resume');assert.equal(resumed.code,1,JSON.stringify(resumed));
  assert.equal(resumed.messages.some(m=>m.type==='synthetic_launch_reserved'||m.type==='synthetic_watchdog_started'),false);
 });
});

test('continuity review: an older completion report remains hash-bound after a newer launch',{timeout:20000},async t=>{
 const f=continuityFixture(t);assert.equal((await f.launch('normal')).code,0);assert.equal((await f.launch('normal','resume')).code,0);
 const before=readOwn(f.path);assert.equal(reconcileContinuity(before).finished,2);
 const path=join(f.path,'process-1.json'),changed=json(path);changed.attempts++;writeFileSync(path,JSON.stringify(changed),{mode:0o600});
 const resumed=await f.launch('normal','resume');assert.equal(resumed.code,1,JSON.stringify(resumed));
 assert.equal(resumed.messages.some(m=>m.type==='synthetic_launch_reserved'||m.type==='synthetic_watchdog_started'),false);
 const after=readOwn(f.path),events=after.launch.map(r=>JSON.parse(r.body));assert.equal(events.filter(e=>e.type==='reserved').length,2);assert.equal(events.at(-1).type,'blocked');
 t.diagnostic(JSON.stringify({evidence:f.path,reservedWallMs:60000,finished:2,oldReportTamperBlocked:true}));
});

test('continuity review: valid previous session rollback after durable progress stays blocked',{timeout:20000},async t=>{
 const f=continuityFixture(t);assert.equal((await f.launch('normal')).code,0);const old=readFileSync(join(f.path,'session.sqlite'));
 assert.equal((await f.launch('normal','resume')).code,0);const before=readOwn(f.path);assert.equal(reconcileContinuity(before).finished,2);
 writeFileSync(join(f.path,'session.sqlite'),old);const resumed=await f.launch('normal','resume');assert.equal(resumed.code,1);
 assert.equal(resumed.messages.some(m=>m.type==='synthetic_launch_reserved'||m.type==='synthetic_watchdog_started'),false);
 const after=readOwn(f.path),events=after.launch.map(r=>JSON.parse(r.body));assert.equal(events.filter(e=>e.type==='reserved').length,2);assert.equal(events.at(-1).type,'blocked');
 t.diagnostic(JSON.stringify({evidence:f.path,reservedWallMs:60000,finished:2,rollbackBlocked:true}));
});

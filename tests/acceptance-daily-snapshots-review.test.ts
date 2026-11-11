/** Independent adversarial review. Synthetic local state only. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {WorldStore} from '../src/server/store.js';
import {captureDailySnapshot,checkedDailySnapshotConfig,buildDailySnapshotReport,type DailySnapshotConfig} from '../src/server/acceptance-daily-snapshots.js';
function fixture(){const world=createFrontierWorld();const config:DailySnapshotConfig={schema:1,fromMinute:world.minute,endMinute:3360,founderIds:world.residents.map(p=>p.id),sourceFingerprint:'e'.repeat(64)};return {world,config};}
test('review: sparse founder identity input is rejected',()=>{
 const {config}=fixture();delete config.founderIds[4];assert.throws(()=>checkedDailySnapshotConfig(config),/invalid_daily_snapshot/);
});
test('review: missing prior midnights remain absent, not interpolated',()=>{
 const {world,config}=fixture();const initial=captureDailySnapshot(world,config);world.minute=2880;world.revision++;
 const report=buildDailySnapshotReport(config,world.id,2880,[initial,captureDailySnapshot(world,config)]);
 assert.deepEqual(report.missingBoundaries,[1440]);assert.equal(report.intervals.every(i=>i.endpointCoverage==='missing'),true);
});
test('review: missing founder fields are unknown and independent population includes newcomer',()=>{
 const {world,config}=fixture();const person=world.residents[0] as any;delete person.inventory;delete person.health;delete person.hunger;
 world.residents.push({...structuredClone(world.residents[1]),id:'new-arrival'});
 const snapshot=captureDailySnapshot(world,config);assert.equal(snapshot.founders.length,9);assert.equal(snapshot.population.total,10);
 assert.equal(snapshot.founders[0].health,null);assert.equal(snapshot.founders[0].hunger,null);assert.equal(snapshot.founders[0].inventory.berry,null);
 assert.ok(snapshot.founders[0].unknownFields.includes('inventory'));
});
test('review: duplicate reserve identity poisons totals instead of double counting',()=>{
 const {world,config}=fixture();(world as any).civic={stores:{one:{berry:3}},reserves:[{id:'one',inventory:{berry:4}},{id:'one',inventory:{berry:5}}]};
 const snapshot=captureDailySnapshot(world,config);assert.equal(snapshot.community.totals.berry,null);assert.ok(snapshot.community.unknownFields.includes('civic.reserves.identity'));
});
test('review: SQLite snapshot failure rolls back world, event and receipt, then restart samples once',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'daily-review-')),path=join(dir,'world.sqlite');const {world,config}=fixture();let store=new WorldStore(path,{dailySnapshots:config});const db=new DatabaseSync(path);
 try{
  store.commit(world,null);const initialRevision=world.revision;
  db.exec("CREATE TRIGGER fail_daily BEFORE INSERT ON acceptance_daily_snapshots WHEN NEW.minute=1440 BEGIN SELECT RAISE(ABORT,'review_forced_failure'); END");
  world.minute=1440;world.revision++;world.processed.push('review-receipt');world.events.push({id:'review-event',at:1440,type:'system',text:'synthetic review',actors:[]} as any);
  assert.throws(()=>store.commit(world,initialRevision),/review_forced_failure/);
  assert.equal(store.loadForRuntime()!.minute,config.fromMinute);assert.equal((db.prepare("SELECT count(*) AS n FROM events WHERE id='review-event'").get() as any).n,0);
  assert.equal((db.prepare("SELECT count(*) AS n FROM receipts WHERE receipt='review-receipt'").get() as any).n,0);
  assert.equal(store.dailySnapshotReport().boundaries.length,1);
  db.exec('DROP TRIGGER fail_daily');store.commit(world,initialRevision);store.close();store=new WorldStore(path,{dailySnapshots:config});
  const again=store.loadForRuntime()!;const prior=again.revision;again.revision++;again.residents[0].hunger=99;store.commit(again,prior);
  const report=store.dailySnapshotReport();assert.equal(report.boundaries.length,2);assert.equal(report.boundaries[1].snapshot!.revision,world.revision);
  assert.notEqual(report.boundaries[1].snapshot!.founders[0].hunger,99);
 }finally{store.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('review: skipped boundary and competing stale writer roll back',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'daily-review-')),path=join(dir,'world.sqlite');const {world,config}=fixture();const a=new WorldStore(path,{dailySnapshots:config}),b=new WorldStore(path,{dailySnapshots:config});
 try{a.commit(world,null);const stale=b.loadForRuntime()!;const previous=world.revision;world.minute=1441;world.revision++;
 assert.throws(()=>a.commit(world,previous),/daily_snapshot_boundary_skipped/);assert.equal(a.loadForRuntime()!.minute,config.fromMinute);
 world.minute=1440;a.commit(world,previous);stale.revision++;assert.throws(()=>b.commit(stale,previous),/stale_world_revision/);
 assert.equal(b.dailySnapshotReport().boundaries.length,2);
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('review: changed durable body is rejected even if JSON remains valid',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'daily-review-')),path=join(dir,'world.sqlite');const {world,config}=fixture();const store=new WorldStore(path,{dailySnapshots:config});const db=new DatabaseSync(path);
 try{store.commit(world,null);const row=db.prepare('SELECT body FROM acceptance_daily_snapshots').get() as any;const record=JSON.parse(row.body);record.snapshot.founders[0].health=1;
 db.prepare('UPDATE acceptance_daily_snapshots SET body=?').run(JSON.stringify(record));assert.throws(()=>store.dailySnapshotReport(),/daily_snapshot_integrity_failed/);
 }finally{store.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

import {stepWorld} from '../src/world/engine.js';
import {nextDailyBoundary} from '../src/server/acceptance-daily-snapshots.js';
test('review: exact engine endpoint survives fractional starting times without crossing midnight',()=>{
 for(const at of [1439.9,1439.999999999,1438.8,1422.876543211]){
  const {world,config}=fixture();world.minute=at;world.clock.paused=false;
  const end=nextDailyBoundary(at,config);assert.equal(end,1440);
  stepWorld(world,end-at,{exactEndMinute:end});assert.equal(world.minute,1440);
  assert.equal(captureDailySnapshot(world,config).boundaryKind,'midnight');
 }
});
test('review: a freshly reopened store rejects changed sampling config',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'daily-review-')),path=join(dir,'world.sqlite');const {world,config}=fixture();const store=new WorldStore(path,{dailySnapshots:config});
 let closed=false;
 try{store.commit(world,null);store.close();closed=true;assert.throws(()=>new WorldStore(path,{dailySnapshots:{...config,endMinute:config.endMinute+1}}),/daily_snapshot_config_mismatch/);}
 finally{if(!closed)store.close();rmSync(dir,{recursive:true,force:true});}
});

import {checkedDailySnapshot} from '../src/server/acceptance-daily-snapshots.js';
test('review: config arrays reject accessor elements without invoking them and reject extra keys',()=>{
 const {config}=fixture();let calls=0;Object.defineProperty(config.founderIds,'3',{get(){calls++;return 'getter-person';},enumerable:true,configurable:true});
 assert.throws(()=>checkedDailySnapshotConfig(config),/invalid_daily_snapshot/);assert.equal(calls,0);
 const extra=fixture().config;Object.assign(extra.founderIds,{unexpected:true});assert.throws(()=>checkedDailySnapshotConfig(extra),/invalid_daily_snapshot/);
});
test('review: standalone snapshot validation rejects inconsistent stock totals and known census counts',()=>{
 const {world,config}=fixture();(world as any).civic={stores:{one:{berry:3}},reserves:[{id:'reserve',inventory:{berry:4}}]};
 const snapshot=captureDailySnapshot(world,config);assert.equal(snapshot.community.totals.berry,7);checkedDailySnapshot(snapshot,config);
 const badTotals=structuredClone(snapshot);badTotals.community.totals.berry=8;assert.throws(()=>checkedDailySnapshot(badTotals,config),/invalid_daily_snapshot/);
 const badCensus=structuredClone(snapshot);badCensus.population.groups.aliveResident.count!++;badCensus.population.total!++;
 assert.throws(()=>checkedDailySnapshot(badCensus,config),/invalid_daily_snapshot/);
});
test('review: aliased community bags produce unknown totals, while equal independent bags sum normally',()=>{
 const {world,config}=fixture();const shared={berry:3};(world as any).civic={stores:{one:shared},reserves:[{id:'reserve',inventory:shared}]};
 const alias=captureDailySnapshot(world,config);assert.equal(alias.community.totals.berry,null);assert.ok(alias.community.unknownFields.includes('civic.inventoryAlias'));checkedDailySnapshot(alias,config);
 (world as any).civic.reserves[0].inventory={berry:3};const independent=captureDailySnapshot(world,config);
 assert.equal(independent.community.totals.berry,6);assert.equal(independent.community.unknownFields.includes('civic.inventoryAlias'),false);checkedDailySnapshot(independent,config);
});

test('review: duplicate and malformed identities invalidate population total and both duplicate records',()=>{
 const {world,config}=fixture();const id=world.residents[0].id;world.residents.push(structuredClone(world.residents[0]));
 const duplicate=captureDailySnapshot(world,config);assert.equal(duplicate.population.total,null);assert.equal(duplicate.population.groups.unknown.count,2);
 assert.equal(duplicate.population.groups.aliveResident.ids.includes(id),false);assert.equal(duplicate.founders[0].status,null);checkedDailySnapshot(duplicate,config);
 (world.residents.at(-1) as any).id='bad id';const malformed=captureDailySnapshot(world,config);assert.equal(malformed.population.total,null);assert.equal(malformed.population.groups.unknown.count,1);checkedDailySnapshot(malformed,config);
});
test('review: invalid exact endpoint is rejected before any initialization mutation',()=>{
 const {world}=fixture();world.clock.paused=false;const before=structuredClone(world);
 assert.throws(()=>stepWorld(world,1,{exactEndMinute:world.minute+2}),/invalid_exact_step_endpoint/);assert.deepEqual(world,before);
});
test('review: archived depart and return survive unchanged endpoint residency',()=>{
 const {world,config}=fixture();const store=new WorldStore(':memory:',{dailySnapshots:config});
 try{store.commit(world,null);const previous=world.revision;world.minute=1440;world.revision++;
 for(const [id,at,change] of [['review-depart',1000,'depart'],['review-return',1100,'visit']] as const)world.events.push({id,at,kind:'population',actors:[world.residents[0].id],place:{x:0,y:0},text:'synthetic',witnesses:[],populationChange:change} as any);
 store.commit(world,previous);const report=store.dailySnapshotReport();assert.equal(report.transitions.length,0);
 assert.deepEqual(report.transactions[1].populationEvents.map((e:any)=>[e.eventId,e.at,e.change,e.actorIds]),[['review-depart',1000,'depart',[world.residents[0].id]],['review-return',1100,'visit',[world.residents[0].id]]]);
 }finally{store.close();}
});
test('review: population facts committed after the same-minute boundary sample are retained later',()=>{
 const {world,config}=fixture();const store=new WorldStore(':memory:',{dailySnapshots:config});
 try{store.commit(world,null);let previous=world.revision;world.minute=1440;world.revision++;store.commit(world,previous);
 previous=world.revision;world.revision++;world.events.push({id:'review-late-boundary',at:1440,kind:'population',actors:[world.residents[0].id],place:{x:0,y:0},text:'synthetic',witnesses:[],populationChange:'depart'} as any);store.commit(world,previous);
 previous=world.revision;world.minute=2880;world.revision++;store.commit(world,previous);
 const report=store.dailySnapshotReport();const last=report.transactions.at(-1)!;const late=last.populationEvents.find((e:any)=>e.eventId==='review-late-boundary');
 assert.ok(late);assert.equal(late.at,1440);assert.equal(last.minute,2880);
 assert.equal(last.previousEventSequence,report.transactions[1].throughEventSequence);
 assert.ok(late.sequence>last.previousEventSequence&&late.sequence<=last.throughEventSequence);
 assert.equal(report.transactions.flatMap(t=>t.populationEvents).filter((e:any)=>e.eventId==='review-late-boundary').length,1);
 }finally{store.close();}
});

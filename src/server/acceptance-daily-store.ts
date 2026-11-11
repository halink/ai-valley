/** Optional snapshot ledger on the SAME SQLite connection/transaction as world,
 * events and receipts. Never construct this for ordinary or live runtimes. */
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {persistedWorldFingerprint as hash} from './acceptance-offline-protocol.js';
import {checkedDailySnapshot,checkedDailySnapshotConfig,captureDailySnapshot,buildDailySnapshotReport,nextDailyBoundary,
 type DailySnapshotConfig} from './acceptance-daily-snapshots.js';
type Cursor={worldId:string;revision:number;minute:number;lastHash:string};
type Row={minute:number;revision:number;body:string;previous_hash:string;hash:string};
export class AtomicDailySnapshots {
 readonly config:DailySnapshotConfig;
 constructor(private db:DatabaseSync,config:DailySnapshotConfig){
  this.config=checkedDailySnapshotConfig(config);
  db.exec(`CREATE TABLE IF NOT EXISTS acceptance_daily_meta (key TEXT PRIMARY KEY, body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS acceptance_daily_snapshots (minute REAL PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);`);
  const saved=this.meta('config');
  if(saved!==null&&hash(saved)!==hash(this.config))throw new Error('daily_snapshot_config_mismatch');
 }
 private meta(key:string):unknown|null {
  const row=this.db.prepare('SELECT body FROM acceptance_daily_meta WHERE key=?').get(key) as {body:string}|undefined;
  return row?JSON.parse(row.body):null;
 }
 private setMeta(key:string,value:unknown){this.db.prepare('INSERT INTO acceptance_daily_meta(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,JSON.stringify(value));}
 /** Called only inside WorldStore.commit's BEGIN IMMEDIATE. Any error rolls back
  * the world and both ledgers, not just an after-commit observer. */
 committed(world:World,previousRevision:number|null){
  const cursor=this.meta('cursor') as Cursor|null;
  if(!Number.isSafeInteger(world.revision)||world.revision<0||!Number.isFinite(world.minute)
   ||world.minute<this.config.fromMinute||world.minute>this.config.endMinute)throw new Error('daily_snapshot_world_invalid');
  if(cursor===null){
   if(previousRevision!==null||world.minute!==this.config.fromMinute)throw new Error('daily_snapshot_history_missing');
   this.setMeta('config',this.config);
  }else{
   if(cursor.worldId!==world.id||cursor.revision!==previousRevision||world.revision<=cursor.revision||world.minute<cursor.minute)
    throw new Error('daily_snapshot_continuity_failed');
   if(world.minute>nextDailyBoundary(cursor.minute,this.config))throw new Error('daily_snapshot_boundary_skipped');
  }
  let lastHash=cursor?.lastHash??hash(this.config);
  if(cursor===null||world.minute>cursor.minute&&world.minute===nextDailyBoundary(cursor.minute,this.config)){
   const snapshot=checkedDailySnapshot(captureDailySnapshot(world,this.config),this.config);
   const count=(table:'events'|'receipts')=>(this.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE world_id=?`).get(world.id) as {n:number}).n;
   const previousRow=this.db.prepare('SELECT body FROM acceptance_daily_snapshots ORDER BY minute DESC LIMIT 1').get() as {body:string}|undefined;
   const throughEventSequence=(this.db.prepare('SELECT COALESCE(max(rowid),0) AS sequence FROM events WHERE world_id=?').get(world.id) as {sequence:number}).sequence;
   const previousEventSequence=previousRow?JSON.parse(previousRow.body).transaction.throughEventSequence:throughEventSequence;
   // Archive-order coverage, not event-time bucketing. A same-minute event
   // committed AFTER the first midnight sample belongs to the next snapshot's
   // new archive facts, retaining its original time instead of disappearing.
   const populationEvents=(this.db.prepare(`SELECT rowid AS sequence,body FROM events WHERE world_id=? AND rowid>? AND rowid<=?
    AND json_extract(body,'$.populationChange') IN ('death','depart','endVisit','visit','settle','birth') ORDER BY rowid`).all(world.id,previousEventSequence,throughEventSequence) as {sequence:number;body:string}[])
    .map(row=>{const e=JSON.parse(row.body);return {sequence:row.sequence,eventId:e.id,at:e.at,change:e.populationChange,actorIds:e.actors};});
   const body=JSON.stringify({snapshot,transaction:{revision:world.revision,eventCount:count('events'),receiptCount:count('receipts'),
    previousEventSequence,throughEventSequence,populationEvents}});
   const digest=hash({body,previousHash:lastHash});
   this.db.prepare('INSERT INTO acceptance_daily_snapshots(minute,revision,body,previous_hash,hash) VALUES(?,?,?,?,?)')
    .run(world.minute,world.revision,body,lastHash,digest);
   lastHash=digest;
  }
  this.setMeta('cursor',{worldId:world.id,revision:world.revision,minute:world.minute,lastHash});
 }
 report(world:{id:string;revision:number;minute:number}){
  const cursor=this.meta('cursor') as Cursor|null;
  if(!cursor||cursor.worldId!==world.id||cursor.revision!==world.revision||cursor.minute!==world.minute
   ||hash(this.meta('config'))!==hash(this.config))throw new Error('daily_snapshot_continuity_failed');
  let previous=hash(this.config);
  const records=(this.db.prepare('SELECT minute,revision,body,previous_hash,hash FROM acceptance_daily_snapshots ORDER BY minute').all() as Row[]).map(row=>{
   if(row.previous_hash!==previous||hash({body:row.body,previousHash:previous})!==row.hash)throw new Error('daily_snapshot_integrity_failed');
   const record=JSON.parse(row.body);
   if(record.snapshot.worldId!==world.id||record.snapshot.minute!==row.minute||record.snapshot.revision!==row.revision
    ||record.transaction.revision!==row.revision||row.revision>world.revision)throw new Error('daily_snapshot_integrity_failed');
   previous=row.hash;return {...record,hash:row.hash};
  });
  if(previous!==cursor.lastHash)throw new Error('daily_snapshot_integrity_failed');
  return {...buildDailySnapshotReport(this.config,world.id,world.minute,records.map(r=>r.snapshot)),
   persistence:{kind:'same-world-sqlite-transaction' as const,throughRevision:cursor.revision,lastHash:cursor.lastHash},
   transactions:records.map(r=>({minute:r.snapshot.minute,...r.transaction,hash:r.hash}))};
 }
}

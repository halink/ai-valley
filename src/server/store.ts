import type {Biography,HistoryPage,HistoryQuery} from '../shared/history.js';
import {normalizeHistory,historyKey,readHistoryCursor,makeHistoryCursor} from './history-query.js';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {terrainRevision} from './landscape.js';
import type {World,WorldEvent,Resource} from '../shared/types.js';
import {attachReceiptHistory} from '../world/receipts.js';
export interface AppendedHistory {
 events: WorldEvent[];
 processed: string[];
}
const recentFacts=180;
const conversationMinutes=45;
function referencedFacts(world:Pick<World,'residents'|'foreignTrade'|'funerary'|'adoption'>):Set<string>{
 const people=[...world.residents,...(world.foreignTrade?.merchants.map(merchant=>merchant.person)??[])];
 return new Set([...(world.adoption?.agreements??[]).flatMap(c=>[...c.signatures.map(s=>s.eventId),...(c.registrationEventId?[c.registrationEventId]:[])]),...people.flatMap(r=>[...r.memories.map(m=>m.eventId),...r.relations.flatMap(t=>t.lastInterpretation?[t.lastInterpretation.sourceEventId,t.lastInterpretation.recordEventId]:[]),...Object.values(r.deathKnowledge??{}).flatMap(k=>[k.eventId,...(k.location?[k.location.eventId]:[])])]),...(world.funerary?.certificates??[]).flatMap(c=>[c.proofEventId,c.registrationEventId])]);
}

/** Keep the observer window, all recent conversation partners and evidence for living memories. */
export function workingEvents(world:World):WorldEvent[]{
 const references=referencedFacts(world);
 const start=world.events.length-recentFacts;
 return world.events.filter((event,index)=>index>=start || event.at>=world.minute-conversationMinutes || references.has(event.id));
}

/** One durable commit contains the entire fact-state and its event ledger. */
export class WorldStore {
 private db:DatabaseSync;
 private separateLedgers = new Set<string>();
 private terrainKeys = new Set<string>();
 private resourceBases = new Map<string, Resource[]>();
 private readonly exactReceipt;
 private readonly receiptPrefix;
 constructor(path:string){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS terrain (hash TEXT PRIMARY KEY, body BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS resource_bases (world_id TEXT PRIMARY KEY, body BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY,world_id TEXT NOT NULL,at REAL NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts (world_id TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(world_id,receipt));
   CREATE INDEX IF NOT EXISTS event_world ON events(world_id);
   CREATE INDEX IF NOT EXISTS event_time ON events(world_id,at,id);
   CREATE TABLE IF NOT EXISTS archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS event_people (world_id TEXT NOT NULL,person_id TEXT NOT NULL,event_id TEXT NOT NULL,event_seq INTEGER NOT NULL,PRIMARY KEY(event_id,person_id),FOREIGN KEY(event_id) REFERENCES events(id));
   CREATE INDEX IF NOT EXISTS event_person_sequence ON event_people(world_id,person_id,event_seq);
   CREATE TRIGGER IF NOT EXISTS immutable_event BEFORE UPDATE ON events WHEN NEW.body <> OLD.body BEGIN SELECT RAISE(ABORT, 'event_id_conflict'); END;`);
  if(!this.db.prepare("SELECT value FROM archive_meta WHERE key='event_people_v1'").get()){
   this.db.exec('BEGIN IMMEDIATE');try{this.db.exec("INSERT OR IGNORE INTO event_people(world_id,person_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.actors') a WHERE typeof(a.value)='text'");this.db.prepare('INSERT INTO archive_meta(key,value) VALUES(?,?)').run('event_people_v1','1');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  this.exactReceipt=this.db.prepare('SELECT 1 FROM receipts WHERE world_id=? AND receipt=?');
  this.receiptPrefix=this.db.prepare('SELECT receipt FROM receipts WHERE world_id=? AND receipt>=? AND receipt<? ORDER BY rowid LIMIT 1');
 }
 private resourceBase(id:string): Resource[] | undefined {
  let base=this.resourceBases.get(id);
  if (!base) {
   const row=this.db.prepare('SELECT body FROM resource_bases WHERE world_id=?').get(id) as {body:Uint8Array}|undefined;
   if (row) {base=JSON.parse(gunzipSync(row.body).toString());this.resourceBases.set(id,base!);}
  }
  return base;
 }
 private readEvents(world:World, working:boolean):WorldEvent[]{
  if(!working){
   const records=this.db.prepare('SELECT body FROM events WHERE world_id=? ORDER BY rowid').all(world.id) as {body:string}[];
   return records.map(record=>JSON.parse(record.body));
  }
  // Ask the time and identity indexes directly; never deserialize the entire town chronicle on restart.
  type FactRow={seq:number;body:string};
  const recent=this.db.prepare('SELECT rowid AS seq,body FROM events WHERE world_id=? ORDER BY rowid DESC LIMIT ?')
    .all(world.id,recentFacts) as FactRow[];
  const forConversations=this.db.prepare('SELECT rowid AS seq,body FROM events WHERE world_id=? AND at>=?')
    .all(world.id,world.minute-conversationMinutes) as FactRow[];
  const remembered=this.db.prepare('SELECT rowid AS seq,body FROM events WHERE world_id=? AND id IN (SELECT value FROM json_each(?))')
    .all(world.id,JSON.stringify([...referencedFacts(world)])) as FactRow[];
  const bySequence=new Map([...recent,...forConversations,...remembered].map(row=>[row.seq,row]));
  return [...bySequence.values()].sort((a,b)=>a.seq-b.seq).map(record=>JSON.parse(record.body));
 }
 load(working=false):World|null {return this.readWorld(working,false);}
 loadForRuntime():World|null {return this.readWorld(true,true);}
 useIndexedReceipts(world:World):void {
  const id=world.id;
  attachReceiptHistory(world,{
   has:receipt=>!!this.exactReceipt.get(id,receipt),
   // Replacing the final colon with its next ASCII character bounds this literal prefix.
   first:prefix=>(this.receiptPrefix.get(id,prefix,prefix.slice(0,-1)+';') as {receipt:string}|undefined)?.receipt,
  });
 }
 private readWorld(working:boolean,indexedReceipts:boolean):World|null {
  const row=this.db.prepare('SELECT state FROM worlds ORDER BY rowid DESC LIMIT 1').get() as {state:string|Uint8Array}|undefined;
  if (!row) return null;
  const saved=JSON.parse(typeof row.state==='string'?row.state:gunzipSync(row.state).toString());
  if (!saved.terrainKey) return saved;
  const {terrainKey,resourceChanges,resourceCount,ledgerVersion,...world}=saved;
  const terrain=this.db.prepare('SELECT body FROM terrain WHERE hash=?').get(terrainKey) as {body:Uint8Array}|undefined;
  const base=this.resourceBase(world.id);
  if (!terrain || !base) throw new Error('missing_saved_landscape');
  world.map=JSON.parse(gunzipSync(terrain.body).toString());
  if(terrainRevision(world.map)!==terrainKey)throw new Error('saved_terrain_checksum_mismatch');
  this.terrainKeys.add(terrainKey);
  world.resources=structuredClone(base.slice(0,resourceCount));
  for(const [index,value] of resourceChanges) world.resources[index]=value;
  if(ledgerVersion===1){
   world.events=this.readEvents(world as World,working);
   if(indexedReceipts){
    world.processed=[];
    this.useIndexedReceipts(world as World);
   }else{
    const rows=this.db.prepare('SELECT receipt FROM receipts WHERE world_id=? ORDER BY rowid').all(world.id) as {receipt:string}[];
    world.processed=rows.map(row=>row.receipt);
   }
   this.separateLedgers.add(world.id);
  }
  return world as World;
 }
 private encode(world:World):Buffer {
  if(world.mode!=='formal') return gzipSync(JSON.stringify(world),{level:1});
  const {map,resources,events:_events,processed:_receipts,...state}=world;
  const terrainKey=terrainRevision(map);
  if(!this.terrainKeys.has(terrainKey))
    this.db.prepare('INSERT OR IGNORE INTO terrain(hash,body) VALUES(?,?)').run(terrainKey,gzipSync(JSON.stringify(map)));
  let base=this.resourceBase(world.id);
  if(!base) {
   this.db.prepare('INSERT INTO resource_bases(world_id,body) VALUES(?,?)').run(world.id,gzipSync(JSON.stringify(resources)));
   base=resources;
  }
  const resourceChanges:Array<[number,Resource]>=[];
  for(let i=0;i<resources.length;i++){
   const r=resources[i],b=base[i];
   if(!b||r.id!==b.id||r.kind!==b.kind||r.at.x!==b.at.x||r.at.y!==b.at.y||r.amount!==b.amount||r.max!==b.max||r.regrowthDays!==b.regrowthDays||r.lastHarvest!==b.lastHarvest)
    resourceChanges.push([i,r]);
  }
  return gzipSync(JSON.stringify({...state,ledgerVersion:1,terrainKey,resourceCount:resources.length,resourceChanges}),{level:1});
 }
 commit(world:World,previousRevision:number|null,appended?:AppendedHistory):void{
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const row=this.db.prepare('SELECT revision FROM worlds WHERE id=?').get(world.id) as {revision:number}|undefined;
   if((row?.revision??null)!==previousRevision)throw new Error('stale_world_revision');
   const insert=this.db.prepare('INSERT INTO events(id,world_id,at,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE events.body<>excluded.body');
   // Full-state callers validate every fact. The runtime supplies a transaction-local suffix only after
   // the first checkpoint in this format. Old inline histories migrate on the first successful commit.
   const ledger=world.mode==='formal'&&this.separateLedgers.has(world.id)&&appended?appended:world;
   const indexPerson=this.db.prepare("INSERT OR IGNORE INTO event_people(world_id,person_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.actors') a WHERE e.id=? AND typeof(a.value)='text'");
   for(const event of ledger.events){insert.run(event.id,world.id,event.at,JSON.stringify(event));indexPerson.run(event.id);}
   if(world.mode==='formal'){
    const receipt=this.db.prepare('INSERT OR IGNORE INTO receipts(world_id,receipt) VALUES(?,?)');
    for(const id of ledger.processed)receipt.run(world.id,id);
   }
   this.db.prepare('INSERT INTO worlds(id,revision,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state').run(world.id,world.revision,this.encode(world));
   this.db.exec('COMMIT');
   if(world.mode==='formal'){this.terrainKeys.add(terrainRevision(world.map));this.separateLedgers.add(world.id);}
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 history(worldId:string,before:number,limit=100):WorldEvent[]{
  const rows=this.db.prepare('SELECT body FROM events WHERE world_id=? AND at<? ORDER BY at DESC,id DESC LIMIT ?').all(worldId,before,Math.min(200,limit)) as Array<{body:string}>;
  return rows.map(row=>JSON.parse(row.body));
 }
 historyPage(worldId:string,input:HistoryQuery={}):HistoryPage {
  const q=normalizeHistory(input),key=historyKey(q),before=readHistoryCursor(q.cursor,worldId,key),source=q.personId?'event_people p JOIN events e ON e.id=p.event_id AND e.world_id=p.world_id':'events e',sequence=q.personId?'p.event_seq':'e.rowid',where=q.personId?['p.world_id=?','p.person_id=?','p.event_seq<?']:['e.world_id=?','e.rowid<?'],args:Array<string|number>=q.personId?[worldId,q.personId,before]:[worldId,before];
  if(q.kind){where.push("json_extract(e.body,'$.kind')=?");args.push(q.kind);}
  if(q.conversationId){where.push("json_extract(e.body,'$.conversationId')=?");args.push(q.conversationId);}
  if(q.q){where.push("json_extract(e.body,'$.text') LIKE ? ESCAPE '\\'");args.push('%'+q.q.replace(/[\\%_]/g,c=>'\\'+c)+'%');}
  if(q.from!==undefined){where.push('e.at>=?');args.push(q.from);}if(q.to!==undefined){where.push('e.at<?');args.push(q.to);}
  if(q.populationOnly)where.push("json_extract(e.body,'$.populationChange') IS NOT NULL");
  args.push(q.limit+1);const rows=this.db.prepare('SELECT '+sequence+' AS seq,e.body FROM '+source+' WHERE '+where.join(' AND ')+' ORDER BY '+sequence+' DESC LIMIT ?').all(...args) as Array<{seq:number;body:string}>;
  const hasMore=rows.length>q.limit,selected=rows.slice(0,q.limit);return {worldId,events:selected.map(row=>JSON.parse(row.body)),hasMore,nextCursor:hasMore?makeHistoryCursor(selected.at(-1)!.seq,worldId,key):null};
 }
 personArchive(worldId:string,id:string){
  const row=this.db.prepare('SELECT count(*) AS count,min(e.at) AS first,max(e.at) AS last FROM event_people p JOIN events e ON e.id=p.event_id WHERE p.world_id=? AND p.person_id=?').get(worldId,id) as {count:number;first:number|null;last:number|null};
  const changes=this.db.prepare("SELECT e.body FROM event_people p JOIN events e ON e.id=p.event_id WHERE p.world_id=? AND p.person_id=? AND json_extract(e.body,'$.populationChange') IN ('dating','marriage','separate') ORDER BY e.rowid").all(worldId,id) as {body:string}[];
  const partners:Biography['partners']=[];for(const row of changes){const e=JSON.parse(row.body) as WorldEvent,other=e.actors.find(actor=>actor!==id);if(!other)continue;const current=[...partners].reverse().find(p=>p.personId===other&&p.endedAt===null);if(e.populationChange==='separate'){if(current){current.endedAt=e.at;current.sourceEvents.push(e.id);}else partners.push({personId:other,kind:'unspecified',startedAt:null,endedAt:e.at,sourceEvents:[e.id]});}else if(e.populationChange==='marriage'){if(current){current.kind='married';current.marriedAt=e.at;current.sourceEvents.push(e.id);}else partners.push({personId:other,kind:'married',marriedAt:e.at,startedAt:null,endedAt:null,sourceEvents:[e.id]});}else partners.push({personId:other,kind:'dating',startedAt:e.at,endedAt:null,sourceEvents:[e.id]});}
  return {recordCount:row.count,firstRecordAt:row.first,lastRecordAt:row.last,partners};
 }
 close(){this.db.close();}
}

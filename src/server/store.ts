import type {Biography,HistoryPage,HistoryQuery} from '../shared/history.js';
import {normalizeHistory,historyKey,readHistoryCursor,makeHistoryCursor} from './history-query.js';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {terrainRevision} from './landscape.js';
import type {World,WorldEvent,Resource} from '../shared/types.js';
import {AtomicDailySnapshots} from './acceptance-daily-store.js';
import type {DailySnapshotConfig} from './acceptance-daily-snapshots.js';
import {attachReceiptHistory} from '../world/receipts.js';
export interface AppendedHistory {
 events: WorldEvent[];
 processed: string[];
}
const recentFacts=180;
const conversationMinutes=45;
function referencedFacts(world:Pick<World,'socialAppointments'|'personalFoodGifts'|'adultPresence'|'health'|'residents'|'foreignTrade'|'funerary'|'adoption'|'familyRelocation'|'outsideAid'|'emergencyCare'|'landRights'|'regionSurveys'|'pregnancyPreparation'|'lastWishes'|'migration'>):Set<string>{
 const people=[...world.residents,...(world.migration?.contacts.flatMap(c=>c.person?[c.person]:[])??[]),...(world.foreignTrade?.merchants.map(merchant=>merchant.person)??[])];
 return new Set([...(world.socialAppointments?.records??[]).flatMap(c=>c.eventIds),...(world.personalFoodGifts?.gifts??[]).flatMap(c=>c.eventIds),...(world.adultPresence?.records??[]).flatMap(c=>c.eventIds),...(world.health?.transports??[]).flatMap(t=>t.arrivalEventId?[t.arrivalEventId]:[]),...(world.migration?.contacts??[]).flatMap(c=>c.journey?.staged?.eventIds??[]),...(world.lastWishes?.records??[]).flatMap(c=>c.eventIds),...(world.pregnancyPreparation?.arrangements??[]).flatMap(c=>c.eventIds),...(world.regionSurveys?.surveys??[]).flatMap(s=>s.eventIds),...(world.landRights?.applications??[]).flatMap(a=>a.eventIds),...(world.landRights?.transfers?.sales??[]).flatMap(s=>s.eventIds),...(world.emergencyCare?.agreements??[]).flatMap(c=>c.receipts.map(r=>r.eventId)),...(world.emergencyCare?.helpNotices??[]).flatMap(n=>n.eventIds),...(world.outsideAid?.visitorJourneys??[]).flatMap(j=>j.eventIds),...(world.outsideAid?.notices??[]).flatMap(n=>n.eventIds),...(world.outsideAid?.deliveries??[]).flatMap(d=>d.eventIds),...(world.familyRelocation?.agreements??[]).flatMap(c=>[...c.signatures.map(s=>s.eventId),...(c.revocations??[]).map(s=>s.eventId),...c.members.flatMap(m=>m.arrivalEventId?[m.arrivalEventId]:[])]),...(world.funerary?.notices??[]).flatMap(n=>[n.eventId,n.sourceEventId]),...(world.adoption?.agreements??[]).flatMap(c=>[...c.signatures.map(s=>s.eventId),...(c.registrationEventId?[c.registrationEventId]:[])]),...people.flatMap(r=>[...r.memories.map(m=>m.eventId),...(r.foodSourceKnowledge?.heard??[]).map(c=>c.eventId),...(r.foodSourceKnowledge?.shared??[]).map(c=>c.eventId),...r.relations.flatMap(t=>t.lastInterpretation?[t.lastInterpretation.sourceEventId,t.lastInterpretation.recordEventId]:[]),...Object.values(r.partnerDeathNotices??{}).flatMap(k=>[k.eventId,k.sourceEventId]),...Object.values(r.deathKnowledge??{}).flatMap(k=>[k.eventId,...(k.location?[k.location.eventId]:[])])]),...(world.funerary?.certificates??[]).flatMap(c=>[c.proofEventId,c.registrationEventId])]);
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
 private dailySnapshots?:AtomicDailySnapshots;
 private separateLedgers = new Set<string>();
 private terrainKeys = new Set<string>();
 private resourceBases = new Map<string, Resource[]>();
 private readonly exactReceipt;
 private readonly receiptPrefix;
 constructor(path:string,options:{dailySnapshots?:DailySnapshotConfig}={}){
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
   CREATE INDEX IF NOT EXISTS event_disaster ON events(world_id,json_extract(body,'$.hazardFact.disasterId'));
   CREATE TABLE IF NOT EXISTS archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS event_people (world_id TEXT NOT NULL,person_id TEXT NOT NULL,event_id TEXT NOT NULL,event_seq INTEGER NOT NULL,PRIMARY KEY(event_id,person_id),FOREIGN KEY(event_id) REFERENCES events(id));
   CREATE INDEX IF NOT EXISTS event_person_sequence ON event_people(world_id,person_id,event_seq);
   CREATE TABLE IF NOT EXISTS event_animals (world_id TEXT NOT NULL,animal_id TEXT NOT NULL,event_id TEXT NOT NULL,event_seq INTEGER NOT NULL,PRIMARY KEY(event_id,animal_id),FOREIGN KEY(event_id) REFERENCES events(id));
   CREATE INDEX IF NOT EXISTS event_animal_sequence ON event_animals(world_id,animal_id,event_seq);
   CREATE TRIGGER IF NOT EXISTS immutable_event BEFORE UPDATE ON events WHEN NEW.body <> OLD.body BEGIN SELECT RAISE(ABORT, 'event_id_conflict'); END;`);
  if(!this.db.prepare("SELECT value FROM archive_meta WHERE key='event_people_v1'").get()){
   this.db.exec('BEGIN IMMEDIATE');try{this.db.exec("INSERT OR IGNORE INTO event_people(world_id,person_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.actors') a WHERE typeof(a.value)='text'");this.db.prepare('INSERT INTO archive_meta(key,value) VALUES(?,?)').run('event_people_v1','1');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  // Index only explicit archived identities, never infer animals from prose or current state.
  if(!this.db.prepare("SELECT value FROM archive_meta WHERE key='event_animals_v1'").get()){
   this.db.exec('BEGIN IMMEDIATE');try{this.db.exec("INSERT OR IGNORE INTO event_animals(world_id,animal_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.animalIds') a WHERE json_type(e.body,'$.animalIds')='array' AND a.type='text'");this.db.prepare('INSERT INTO archive_meta(key,value) VALUES(?,?)').run('event_animals_v1','1');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  if(options.dailySnapshots){try{this.dailySnapshots=new AtomicDailySnapshots(this.db,options.dailySnapshots);}catch(error){this.db.close();throw error;}}
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
   if(!b||r.id!==b.id||r.kind!==b.kind||r.at.x!==b.at.x||r.at.y!==b.at.y||r.amount!==b.amount||r.max!==b.max||r.regrowthDays!==b.regrowthDays||r.lastHarvest!==b.lastHarvest||r.floodDamage?.disasterId!==b.floodDamage?.disasterId||r.floodDamage?.at!==b.floodDamage?.at||r.floodDamage?.clearedAt!==b.floodDamage?.clearedAt)
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
   const indexAnimal=this.db.prepare("INSERT OR IGNORE INTO event_animals(world_id,animal_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.animalIds') a WHERE e.id=? AND json_type(e.body,'$.animalIds')='array' AND a.type='text'");
   for(const event of ledger.events){insert.run(event.id,world.id,event.at,JSON.stringify(event));indexPerson.run(event.id);indexAnimal.run(event.id);}
   if(world.mode==='formal'){
    const receipt=this.db.prepare('INSERT OR IGNORE INTO receipts(world_id,receipt) VALUES(?,?)');
    for(const id of ledger.processed)receipt.run(world.id,id);
   }
   this.db.prepare('INSERT INTO worlds(id,revision,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state').run(world.id,world.revision,this.encode(world));
   this.dailySnapshots?.committed(world,previousRevision);
   this.db.exec('COMMIT');
   if(world.mode==='formal'){this.terrainKeys.add(terrainRevision(world.map));this.separateLedgers.add(world.id);}
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 dailySnapshotReport(){
  if(!this.dailySnapshots)throw new Error('daily_snapshots_not_enabled');
  const world=this.loadForRuntime();if(!world)throw new Error('daily_snapshot_world_missing');
  return this.dailySnapshots.report(world);
 }
 history(worldId:string,before:number,limit=100):WorldEvent[]{
  const rows=this.db.prepare('SELECT body FROM events WHERE world_id=? AND at<? ORDER BY at DESC,id DESC LIMIT ?').all(worldId,before,Math.min(200,limit)) as Array<{body:string}>;
  return rows.map(row=>JSON.parse(row.body));
 }
 historyPage(worldId:string,input:HistoryQuery={}):HistoryPage {
  const q=normalizeHistory(input),key=historyKey(q),before=readHistoryCursor(q.cursor,worldId,key);
  const identity=q.animalId??q.personId,table=q.animalId?'event_animals':'event_people',column=q.animalId?'animal_id':'person_id';
  const source=identity?`${table} p JOIN events e ON e.id=p.event_id AND e.world_id=p.world_id`:'events e',sequence=identity?'p.event_seq':'e.rowid',where=identity?['p.world_id=?',`p.${column}=?`,'p.event_seq<?']:['e.world_id=?','e.rowid<?'],args:Array<string|number>=identity?[worldId,identity,before]:[worldId,before];
  if(q.animalId&&q.personId){where.push('EXISTS (SELECT 1 FROM event_people person WHERE person.world_id=e.world_id AND person.event_id=e.id AND person.person_id=?)');args.push(q.personId);}
  if(q.disasterId){where.push("json_type(e.body,'$.hazardFact.disasterId')='text' AND json_extract(e.body,'$.hazardFact.disasterId')=?");args.push(q.disasterId);}
  if(q.kind){where.push("json_extract(e.body,'$.kind')=?");args.push(q.kind);}
  if(q.conversationId){where.push("json_extract(e.body,'$.conversationId')=?");args.push(q.conversationId);}
  if(q.q){where.push("json_extract(e.body,'$.text') LIKE ? ESCAPE '\\'");args.push('%'+q.q.replace(/[\\%_]/g,c=>'\\'+c)+'%');}
  if(q.from!==undefined){where.push('e.at>=?');args.push(q.from);}if(q.to!==undefined){where.push('e.at<?');args.push(q.to);}
  if(q.populationOnly)where.push("json_extract(e.body,'$.populationChange') IS NOT NULL");
  if(q.waterOnly)where.push("json_extract(e.body,'$.waterSupply.version') = 1");
  args.push(q.limit+1);const rows=this.db.prepare('SELECT '+sequence+' AS seq,e.body FROM '+source+' WHERE '+where.join(' AND ')+' ORDER BY '+sequence+' DESC LIMIT ?').all(...args) as Array<{seq:number;body:string}>;
  const hasMore=rows.length>q.limit,selected=rows.slice(0,q.limit);return {worldId,events:selected.map(row=>JSON.parse(row.body)),hasMore,nextCursor:hasMore?makeHistoryCursor(selected.at(-1)!.seq,worldId,key):null};
 }
 personArchive(worldId:string,id:string){
  const row=this.db.prepare('SELECT count(*) AS count,min(e.at) AS first,max(e.at) AS last FROM event_people p JOIN events e ON e.id=p.event_id WHERE p.world_id=? AND p.person_id=?').get(worldId,id) as {count:number;first:number|null;last:number|null};
  const changes=this.db.prepare("SELECT e.body FROM event_people p JOIN events e ON e.id=p.event_id WHERE p.world_id=? AND p.person_id=? AND (json_extract(e.body,'$.populationChange') IN ('dating','marriage','separate') OR json_extract(e.body,'$.relationshipEnd') IS NOT NULL) ORDER BY e.rowid").all(worldId,id) as {body:string}[];
  const partners:Biography['partners']=[];for(const row of changes){const e=JSON.parse(row.body) as WorldEvent,other=e.actors.find(actor=>actor!==id);if(!other)continue;const current=[...partners].reverse().find(p=>p.personId===other&&p.endedAt===null&&!p.endReason);if(e.relationshipEnd){const end=e.relationshipEnd;if(current){current.kind=end.kind;current.marriedAt??=end.marriedAt;current.endedAt=end.endedAt;current.endReason=end.reason;current.sourceEvents.push(e.id);}else partners.push({personId:other,kind:end.kind,startedAt:end.startedAt,marriedAt:end.marriedAt,endedAt:end.endedAt,endReason:end.reason,sourceEvents:[e.id]});}else if(e.populationChange==='separate'){if(current){current.endedAt=e.at;current.sourceEvents.push(e.id);}else partners.push({personId:other,kind:'unspecified',startedAt:null,endedAt:e.at,sourceEvents:[e.id]});}else if(e.populationChange==='marriage'){if(current){current.kind='married';current.marriedAt=e.at;current.sourceEvents.push(e.id);}else partners.push({personId:other,kind:'married',marriedAt:e.at,startedAt:null,endedAt:null,sourceEvents:[e.id]});}else partners.push({personId:other,kind:'dating',startedAt:e.at,endedAt:null,sourceEvents:[e.id]});}
  return {recordCount:row.count,firstRecordAt:row.first,lastRecordAt:row.last,partners};
 }
 close(){this.db.close();}
}

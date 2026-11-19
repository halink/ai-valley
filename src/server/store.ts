import {appendFormalDueIntent,formalDueCurrent,formalDueInputs,makeFormalDueCheckpoint,prepareFormalDueIntent,
 readFormalDueRows,writeFormalDueCheckpoint,type FormalDueCheckpoint,type FormalDueIntent} from './valley-spirit-formal-due.js';
import {appendFormalShadowPermission,appendFormalShadowProposal,formalShadowApprovalBasis,formalShadowScope,initializeFormalShadowCustody,makeFormalShadowProposal,
 readFormalShadowRows,verifyFormalShadowPermission,type FormalShadowProposal} from './valley-spirit-formal-shadow-custody.js';
import {readFormalRainShadowBasis} from './valley-spirit-formal-eligibility.js';
import {projectCommittedFormalBerryFairness} from './valley-spirit-formal-berry-fairness.js';
import {completeDeveloperFormalBerryPickup} from './valley-spirit-formal-berry-pickup.js';
import {DAY} from '../world/time.js';
import {projectDeveloperFormalBerryDiscovery} from './valley-spirit-formal-berry-discovery.js';
import {draftFormalBerryGround,validateFormalBerryDetachedLedger} from './valley-spirit-formal-berry-draft.js';
import {BRIDGED_FORMAL_BERRY_APPROVAL,DUE_FORMAL_BERRY_APPROVAL,FORMAL_BERRY_EFFECT_SCHEMA,assertFormalBerryMirrorHeader,formalBerryEffectAnchor,formalBerryFixtureScope,
 verifyFormalBerrySignedApproval,pinFormalGroundBerryFoodBirth,type FormalBerryFixtureAnchor,type FormalBerryFixtureEffect} from './valley-spirit-formal-berry-authority.js';
import {assertFormalRainProvenanceCommit,emptyFormalRainProvenance,forgetFormalRainStep} from '../world/formal-rain-provenance.js';
import {appendValleySpiritFormalArrivalCustody,readValleySpiritFormalArrivalCustody,verifyValleySpiritFormalArrivalCustody,type ValleySpiritFormalArrivalReceipt} from './valley-spirit-formal-arrival-custody.js';
import type {AddressedSpeechObservation} from '../world/addressed-speech.js';
import {appendValleySpiritSpeechCustody,readValleySpiritSpeechCustody,verifyValleySpiritSpeechCustody} from './valley-spirit-speech-custody.js';
import type {ValleySpiritLifeReceipt} from './valley-spirit-life-facts.js';
import {createHash} from 'node:crypto';
import {readSeasonalLedger,writeSeasonalLedger,type SeasonalLedger} from './seasonal-model-ledger.js';
import {assertSeasonalKnowledgeAdvance} from '../world/mvp-seasonal-knowledge.js';
import {rejectMvpClimateForModels} from '../world/mvp-climate-state.js';
import {assertMvpRainProvenanceAdvance} from '../world/mvp-rain-provenance.js';
import {assertMvpSpiritEffectsAdvance,validMvpSpiritFixtureCapacity} from '../world/mvp-spirit-effects.js';
import {assertMvpFallenFruitFixtureTransition,planMvpFallenFruitFixtureStep,
 type MvpFallenFruitFixtureOperation,type MvpFallenFruitFixtureResult} from './valley-spirit-resident-fruit-fixture.js';
import type {MvpGroundFruitCapacity} from '../world/mvp-ground-fruit.js';
import type {Biography,HistoryPage,HistoryQuery} from '../shared/history.js';
import {normalizeHistory,historyKey,readHistoryCursor,makeHistoryCursor} from './history-query.js';
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {terrainRevision} from './landscape.js';
import type {World,WorldEvent,Resource} from '../shared/types.js';
import {AtomicDailySnapshots} from './acceptance-daily-store.js';
import type {DailySnapshotConfig} from './acceptance-daily-snapshots.js';
import {attachReceiptHistory} from '../world/receipts.js';
import {assertDeveloperMvpEffectArchive,assertWorldCompatibility,decodeSavedWorld,preflightWorldSave} from './save-preflight.js';
import {claimDeveloperMvpSpiritFixtureOwner,isDeveloperMvpSpiritFixtureOwner,type DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';
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
 private readonly allowMvpClimate:boolean;
 private readonly allowFormalRainProvenance:boolean;
 private readonly seasonalModel:boolean;
 private readonly mvpSpiritEffectFixture?:MvpGroundFruitCapacity;
 private readonly developerSpiritFixtureOwner?:DeveloperMvpSpiritFixtureOwner;
 constructor(path:string,options:{formalRainProvenance?:true;dailySnapshots?:DailySnapshotConfig;allowMvpClimate?:boolean;seasonalModel?:true;mvpSpiritEffectFixture?:MvpGroundFruitCapacity;developerSpiritFixtureOwner?:DeveloperMvpSpiritFixtureOwner}={}){
  this.allowMvpClimate=options.allowMvpClimate===true;
  this.allowFormalRainProvenance=options.formalRainProvenance===true&&!this.allowMvpClimate&&!options.seasonalModel;
  this.seasonalModel=options.seasonalModel===true;
  const fixture=options.mvpSpiritEffectFixture;
  const owner=options.developerSpiritFixtureOwner;
  if(owner!==undefined){
   if(!isDeveloperMvpSpiritFixtureOwner(owner)||owner.database!==path||
    (owner.formalApprovalKeyPem?!this.allowFormalRainProvenance:!this.allowMvpClimate)||
    fixture!==undefined||this.seasonalModel||options.dailySnapshots!==undefined)
    throw Error('mvp_spirit_fixture_requires_private_disk_owner');
   claimDeveloperMvpSpiritFixtureOwner(owner);
   this.developerSpiritFixtureOwner=owner;
   if(!owner.formalApprovalKeyPem)this.mvpSpiritEffectFixture=owner.capacity;
  }
  if(fixture!==undefined){
   // Never permit this developer authority against a real or files-backed save.
   if(path!==':memory:'||!this.allowMvpClimate||this.seasonalModel||options.dailySnapshots!==undefined||
    !validMvpSpiritFixtureCapacity(fixture))throw Error('mvp_spirit_fixture_requires_disposable_memory');
   this.mvpSpiritEffectFixture=Object.freeze({...fixture});
  }
  const savedHeader=preflightWorldSave(path,{rejectClimate:!this.allowMvpClimate,allowSeasonalModel:this.seasonalModel,developerSpiritFixtureOwner:owner});
  if(savedHeader?.formalRainProvenance&&!this.allowFormalRainProvenance)throw Error('formal_rain_store_scope');
  owner?.assertOwned();
  const needsDeveloperSeal=!!owner&&lstatSync(path,{bigint:true}).size===0n;
  if(path!==':memory:'&&!owner)mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);
  try{
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  if(needsDeveloperSeal)this.db.exec('BEGIN IMMEDIATE');
  this.db.exec(`
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
  if(needsDeveloperSeal){
   this.db.exec('CREATE TABLE mvp_spirit_developer_fixture (version INTEGER NOT NULL CHECK(version=1), seal TEXT NOT NULL)');
   this.db.prepare('INSERT INTO mvp_spirit_developer_fixture VALUES (1,?)').run(owner!.seal);
   if(owner!.formalApprovalKeyPem)this.db.exec(FORMAL_BERRY_EFFECT_SCHEMA);
   if(owner!.formalShadowKeyPem)initializeFormalShadowCustody(this.db);
   this.db.exec('COMMIT');
  }
  if(!this.db.prepare("SELECT value FROM archive_meta WHERE key='event_people_v1'").get()){
   this.db.exec('BEGIN IMMEDIATE');try{this.db.exec("INSERT OR IGNORE INTO event_people(world_id,person_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.actors') a WHERE typeof(a.value)='text'");this.db.prepare('INSERT INTO archive_meta(key,value) VALUES(?,?)').run('event_people_v1','1');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  // Index only explicit archived identities, never infer animals from prose or current state.
  if(!this.db.prepare("SELECT value FROM archive_meta WHERE key='event_animals_v1'").get()){
   this.db.exec('BEGIN IMMEDIATE');try{this.db.exec("INSERT OR IGNORE INTO event_animals(world_id,animal_id,event_id,event_seq) SELECT e.world_id,a.value,e.id,e.rowid FROM events e,json_each(e.body,'$.animalIds') a WHERE json_type(e.body,'$.animalIds')='array' AND a.type='text'");this.db.prepare('INSERT INTO archive_meta(key,value) VALUES(?,?)').run('event_animals_v1','1');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  if(options.dailySnapshots)this.dailySnapshots=new AtomicDailySnapshots(this.db,options.dailySnapshots);
  this.exactReceipt=this.db.prepare('SELECT 1 FROM receipts WHERE world_id=? AND receipt=?');
  this.receiptPrefix=this.db.prepare('SELECT receipt FROM receipts WHERE world_id=? AND receipt>=? AND receipt<? ORDER BY rowid LIMIT 1');
  }catch(error){this.db.close();throw error;}
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
  this.developerSpiritFixtureOwner?.assertOwned();
  this.assertDeveloperSpiritSeal();
  const row=this.db.prepare('SELECT state FROM worlds ORDER BY rowid DESC LIMIT 1').get() as {state:string|Uint8Array}|undefined;
  if (!row) return null;
  const saved=decodeSavedWorld(row.state,!!this.mvpSpiritEffectFixture) as unknown as World & {terrainKey?:string;resourceChanges:Array<[number,Resource]>;resourceCount:number;ledgerVersion?:1};
  if(!this.allowMvpClimate)rejectMvpClimateForModels(saved);
  if(saved.formalRainProvenance&&!this.allowFormalRainProvenance)throw Error('formal_rain_store_scope');
  if(!this.seasonalModel&&saved.mvpSeasonalModelVersion!==undefined)throw Error('seasonal_model_store_required');
  if(!saved.terrainKey){this.readFormalBerryArchive(saved);return saved;}
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
  this.readFormalBerryArchive(world as World);
  return world as World;
 }
 private encode(world:World):Buffer {
  if(world.mode!=='formal') return gzipSync(JSON.stringify(world),{level:1});
  const {map,resources,events:_events,processed:_receipts,...state}=world;
  const terrainKey=terrainRevision(map);
  if(!this.terrainKeys.has(terrainKey))
    this.db.prepare('INSERT OR IGNORE INTO terrain(hash,body) VALUES(?,?)').run(terrainKey,gzipSync(JSON.stringify(map)));
  // Capture precisely the JSON that can persist, once, before diffing. This
  // detaches nested extension data from caller-owned objects and ensures an
  // unchanged legacy field list cannot hide new/removed persistent fields.
  const resourceJson=JSON.stringify(resources);
  const persistedResources:Resource[]=JSON.parse(resourceJson);
  let base=this.resourceBase(world.id);
  if(!base) {
   this.db.prepare('INSERT INTO resource_bases(world_id,body) VALUES(?,?)').run(world.id,gzipSync(resourceJson));
   // Do not cache an uncommitted base: rollback must leave retry free to create
   // the base again. Existing caches were read from committed storage.
   base=persistedResources;
  }
  const resourceChanges:Array<[number,Resource]>=[];
  for(let i=0;i<persistedResources.length;i++){
   const r=persistedResources[i],b=base[i];
   // Object key order can conservatively add a redundant delta, never omit a
   // changed JSON value. Arrays retain their meaningful order. No field allowlist.
   if(!b||JSON.stringify(r)!==JSON.stringify(b))resourceChanges.push([i,r]);
  }
  return gzipSync(JSON.stringify({...state,ledgerVersion:1,terrainKey,resourceCount:persistedResources.length,resourceChanges}),{level:1});
 }
 /** Explicit internal developer adoption; initial rain has no observed start. */
 adoptFormalRainProvenance(worldId:string):boolean {
  if(!this.allowFormalRainProvenance)return false;
  const w=this.load();
  if(!w||w.id!==worldId||w.mode!=='formal'||w.formalRainProvenance)return false;
  const before=w.revision++;w.formalRainProvenance=emptyFormalRainProvenance(w);this.commit(w,before);return true;
 }
 /** Internal same-head read for formal shadow analysis; no external route. */
 readCommittedFormalRainHead(worldId:string,id:string){
  if(!this.allowFormalRainProvenance)return null;
  try{
   const w=this.load();
   if(!w||w.id!==worldId||w.mode!=='formal')return null;
   const found=w.formalRainProvenance?.closed.find(e=>e.episodeId===id);
   return found?{world:w,episode:structuredClone(found)}:null;
  }catch{return null;}
 }
 readCommittedFormalRainEpisode(worldId:string,id:string){
  return this.readCommittedFormalRainHead(worldId,id)?.episode??null;
 }
 seasonalLedger(world:World){if(!this.seasonalModel)throw Error('seasonal_model_store_required');return readSeasonalLedger(this.db,world,true);}
 private readFormalBerryArchive(w:World):readonly FormalBerryFixtureEffect[]{
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalApprovalKeyPem){
   if(Object.hasOwn(w,'formalBerryFixtureAnchor'))throw Error('formal_berry_fixture_requires_owner');
   return [];
  }
  owner.assertOwned();
  const rows=assertFormalBerryMirrorHeader(this.db,owner,w.id,w.formalBerryFixtureAnchor,w.revision,w.minute);
  if(rows.length&&!validateFormalBerryDetachedLedger(w,{schemaVersion:1,worldId:w.id,
   rainAdoptedMinute:w.formalRainProvenance?.adoptedMinute??-1,capacity:owner.capacity,drafts:rows.map(r=>r.receipt)}))
   throw Error('formal_berry_fixture_archive_lineage');
  return rows;
 }
 /** Read-only internal audit of the exact sealed fixture head. The same
  * SQLite snapshot is used for world, plan receipts and the effect archive. */
 readDeveloperFormalBerryFairness(worldId:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalApprovalKeyPem)return {status:'unavailable',code:'not-a-sealed-formal-fixture'} as const;
  try{
   owner.assertOwned();this.db.exec('BEGIN');
   try{
    const world=this.readWorld(false,false);
    let shadow:ReturnType<typeof readFormalShadowRows>|undefined;
    if(world?.id===worldId&&owner.formalShadowKeyPem){
     try{shadow=readFormalShadowRows(this.db,owner,world);}catch{/* isolate unreadable independent G1 storage */}
    }
    const audit=world?.id===worldId?projectCommittedFormalBerryFairness(world,this.readFormalBerryArchive(world),shadow?.flatMap(r=>r.proposal?[r.proposal]:[])):
     {status:'unavailable',code:'no-matching-formal-head'} as const;
    this.db.exec('COMMIT');return audit;
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }catch{return {status:'unavailable',code:'invalid-formal-custody'} as const;}
 }
 /** Separate reviewed closed-rain projection, not a G2 signing route. */
 formalShadowPermissionScope():string|null{
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return null;
  owner.assertOwned();this.assertDeveloperSpiritSeal();return formalShadowScope(owner);
 }
 recordDeveloperFormalShadowPermission(input:unknown){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return {status:'disabled'} as const;
  let grant:unknown;
  try{grant=structuredClone(input);}catch{return {status:'denied'} as const;}
  if(!verifyFormalShadowPermission(grant,owner))return {status:'denied'} as const;
  owner.assertOwned();this.db.exec('BEGIN IMMEDIATE');
  try{
   const w=this.readWorld(false,false),t=grant.terms;
   if(!w||w.id!==t.worldId||t.startsAt>w.minute||w.minute>=t.expiresAt||
    (t.decision==='allow'&&!w.formalRainProvenance?.closed.some(e=>e.episodeId===t.episodeId))){
    this.db.exec('COMMIT');return {status:'denied'} as const;
   }
   const rows=readFormalShadowRows(this.db,owner,w);
   if(t.version!==rows.length+1){this.db.exec('COMMIT');return {status:'denied'} as const;}
   appendFormalShadowPermission(this.db,grant);
   this.db.exec('COMMIT');return {status:'recorded' as const,version:t.version};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 /** Number-only offline selection: always option 1 from the freshly
  * validated, independently signed menu. Never requests an actual effect. */
 stepDeveloperFormalShadowProposal(worldId:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return {status:'disabled'} as const;
  const no={status:'no_proposal'} as const;
  owner.assertOwned();this.db.exec('BEGIN IMMEDIATE');
  try{
   const w=this.readWorld(false,false);
   if(!w||w.id!==worldId){this.db.exec('COMMIT');return no;}
   const rows=readFormalShadowRows(this.db,owner,w),head=rows.at(-1),terms=head?.permission.terms;
   if(!terms||terms.decision!=='allow'||head.proposal||w.minute<terms.startsAt||w.minute>=terms.expiresAt){
    this.db.exec('COMMIT');return no;
   }
   const prior=rows.filter(r=>r.proposal).at(-1)?.proposal;
   if(prior&&w.minute<prior.atMinute+prior.cooldownGameMinutes){this.db.exec('COMMIT');return no;}
   const basis=readFormalRainShadowBasis(this,{scope:'formal-rain-geography-shadow-only',enabled:true,
    worldId,episodeId:terms.episodeId,maxAgeGameMinutes:terms.maxAgeGameMinutes,sites:terms.sites});
   if(basis.status!=='geography_only'||basis.revision!==w.revision||basis.atMinute!==w.minute||
    w.minute>=basis.head.episode.closedMinute+terms.maxAgeGameMinutes){this.db.exec('COMMIT');return no;}
   const numbered=basis.offers.map(offer=>makeFormalShadowProposal(terms,w,offer,basis.head.episode))
    .filter(p=>!rows.some(r=>r.proposal?.opportunityId===p.opportunityId));
   const choice=1,proposal=numbered[choice-1];
   if(!proposal){this.db.exec('COMMIT');return no;}
   appendFormalShadowProposal(this.db,proposal);
   this.db.exec('COMMIT');return {status:'proposed' as const,proposal};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 readDeveloperFormalShadowProposals(worldId:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return {status:'disabled'} as const;
  try{
   owner.assertOwned();this.db.exec('BEGIN');
   try{
    const w=this.readWorld(false,false);
    if(!w||w.id!==worldId){this.db.exec('COMMIT');return {status:'unavailable'} as const;}
    const rows=readFormalShadowRows(this.db,owner,w),current=rows.at(-1)?.permission.terms;
    const proposals=rows.flatMap(row=>{
     const p=row.proposal;if(!p)return [];
     const permissionCurrent=p.permissionVersion===current?.version&&current.decision==='allow'&&w.minute<p.expiresAt&&
      !w.clock.paused&&w.weather==='sun'&&!w.formalRainProvenance?.open&&w.formalRainProvenance?.closed.at(-1)?.episodeId===p.episodeId;
     return [{proposal:p,permissionCurrent,
      approvalBasisDigest:permissionCurrent&&p.atRevision===w.revision&&p.atMinute===w.minute?formalShadowApprovalBasis(row):null}];
    });
    this.db.exec('COMMIT');return {status:'ready' as const,proposals};
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }catch{return {status:'unavailable'} as const;}
 }
 /** An intent is not an approval or a reservation. No world data is
  * written by either the intent or checkpoint operations. */
 recordDeveloperFormalDueIntent(worldId:string,input:unknown){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return {status:'disabled'} as const;
  let request:unknown;
  try{request=structuredClone(input);}catch{return {status:'denied'} as const;}
  if(!formalDueInputs(request))return {status:'denied'} as const;
  owner.assertOwned();this.db.exec('BEGIN IMMEDIATE');
  try{
   const w=this.readWorld(false,false);
   if(!w||w.id!==worldId){this.db.exec('COMMIT');return {status:'denied'} as const;}
   const shadow=readFormalShadowRows(this.db,owner,w),intent=prepareFormalDueIntent(w,shadow.at(-1),request);
   if(!intent||this.readFormalBerryArchive(w).some(e=>e.receipt.draftId===intent.opportunityId)){
    this.db.exec('COMMIT');return {status:'denied'} as const;
   }
   const prior=readFormalDueRows(this.db,w,shadow).find(r=>r.intent.id===intent.id);
   if(prior){
    this.db.exec('COMMIT');return JSON.stringify(prior.intent)===JSON.stringify(intent)?
     {status:'recorded' as const,replay:true,intent:prior.intent}:{status:'denied' as const};
   }
   appendFormalDueIntent(this.db,intent);
   this.db.exec('COMMIT');return {status:'recorded' as const,replay:false,intent};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 readDeveloperFormalDueIntent(worldId:string,id:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return {status:'disabled'} as const;
  try{
   owner.assertOwned();this.db.exec('BEGIN');
   try{
    const w=this.readWorld(false,false);
    if(!w||w.id!==worldId){this.db.exec('COMMIT');return {status:'unavailable'} as const;}
    const shadow=readFormalShadowRows(this.db,owner,w),row=readFormalDueRows(this.db,w,shadow).find(r=>r.intent.id===id);
    const result=row?{status:formalDueCurrent(w,row.intent,shadow.at(-1),this.readFormalBerryArchive(w)),
     intent:row.intent,lastCheckpoint:row.checkpoint}:{status:'unavailable'} as const;
    this.db.exec('COMMIT');return result;
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }catch{return {status:'unavailable'} as const;}
 }
 /** Revalidate from the actual current formal head under one SQLite lock.
  * Returns evidence only. Even a successful checkpoint cannot execute v3. */
 stepDeveloperFormalDueCheckpoint(worldId:string,id:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalShadowKeyPem)return {status:'disabled'} as const;
  owner.assertOwned();this.db.exec('BEGIN IMMEDIATE');
  try{
   const w=this.readWorld(false,false);
   if(!w||w.id!==worldId){this.db.exec('COMMIT');return {status:'unavailable'} as const;}
   const shadow=readFormalShadowRows(this.db,owner,w),current=shadow.at(-1);
   const row=readFormalDueRows(this.db,w,shadow).find(r=>r.intent.id===id);
   if(!row){this.db.exec('COMMIT');return {status:'unavailable'} as const;}
   const effects=this.readFormalBerryArchive(w),state=formalDueCurrent(w,row.intent,current,effects);
   if(state!=='due'){this.db.exec('COMMIT');return {status:state} as const;}
   const p=current!.proposal!,review=current!.permission.terms;
   const planned=draftFormalBerryGround(this,{scope:'formal-berry-detached-draft',enabled:true,capacity:owner.capacity,
    geography:{scope:'formal-rain-geography-shadow-only',enabled:true,worldId:w.id,episodeId:p.episodeId,
     maxAgeGameMinutes:review.maxAgeGameMinutes,sites:[{sourceId:p.sourceId,target:p.target}]}},{
    schemaVersion:1,worldId:w.id,rainAdoptedMinute:w.formalRainProvenance!.adoptedMinute,capacity:owner.capacity,
    drafts:effects.map(e=>e.receipt),
   });
   if(planned.status!=='draft_only'||planned.expectedWorldRevision!==w.revision||planned.receipt.placedMinute!==w.minute||
    planned.receipt.draftId!==row.intent.opportunityId||planned.receipt.rain.startedMinute!==p.rainStartedAt||
    planned.receipt.rain.closedMinute!==p.rainClosedAt){
    this.db.exec('COMMIT');return {status:planned.status==='capacity'?'capacity':'blocked'} as const;
   }
   const food=pinFormalGroundBerryFoodBirth(w,planned.receipt);
   if(!food){this.db.exec('COMMIT');return {status:'blocked'} as const;}
   const checkpoint=makeFormalDueCheckpoint(row.intent,planned.receipt,food,owner.capacity);
   const replay=JSON.stringify(checkpoint)===JSON.stringify(row.checkpoint);
   if(!replay&&row.checkpoint?.atRevision===checkpoint.atRevision){
    this.db.exec('COMMIT');return {status:'blocked'} as const;
   }
   if(!replay)writeFormalDueCheckpoint(this.db,checkpoint);
   this.db.exec('COMMIT');return {status:'checkpoint' as const,replay,checkpoint};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 /** Explicit private resident projection; reads only committed ground. */
 readDeveloperFormalBerryDiscovery(worldId:string,residentId:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalApprovalKeyPem||typeof residentId!=='string'||residentId.length>200)return [];
  try{
   const world=this.readWorld(false,false);
   if(!world||world.id!==worldId)return [];
   return projectDeveloperFormalBerryDiscovery(world,this.readFormalBerryArchive(world),residentId);
  }catch{return [];}
 }
 /** Safe developer-only step, not an actor-addressed transfer endpoint.
  * Recompute a resident's private choice from the locked authoritative head. */
 stepDeveloperFormalBerryPickup(worldId:string){
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalApprovalKeyPem)return {status:'disabled'} as const;
  owner.assertOwned();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const w=this.readWorld(false,false);
   if(!w||w.id!==worldId){this.db.exec('COMMIT');return {status:'no_pickup'} as const;}
   const rows=this.readFormalBerryArchive(w),draft=structuredClone(w),planned=completeDeveloperFormalBerryPickup(draft,rows);
   const arrivalBefore=new Set(w.events.filter(e=>Object.hasOwn(e,'socialAppointmentArrival')).map(e=>e.id));
   if(!planned||draft.events.some(e=>Object.hasOwn(e,'socialAppointmentArrival')&&!arrivalBefore.has(e.id))){
    // The private roll-forward is not an alternative to formal arrival custody.
    this.db.exec('ROLLBACK');return {status:'no_pickup'} as const;
   }
   const {effect,pickup,previousInventory}=planned,anchor=formalBerryEffectAnchor(
    rows.map(row=>row.receipt.draftId===effect.receipt.draftId?effect:row));
   draft.formalBerryFixtureAnchor=anchor;
   this.assertWritable(draft);
   const update=this.db.prepare('UPDATE formal_berry_fixture_effects SET body=? WHERE draft_id=? AND approval_id=?')
    .run(JSON.stringify(effect),effect.receipt.draftId,effect.approval.terms.approvalId);
   if(update.changes!==1)throw Error('formal_berry_fixture_pickup_stock_changed');
   this.writeCommit(draft,w.revision,undefined,undefined,undefined,anchor);
   const after=this.readWorld(false,false),food=effect.foodBirth!;
   const exactLot=(world:World)=>world.food?.lots['person:'+pickup.residentId]?.berry?.find(l=>
    l.definition===food.definition&&l.producedAt===food.producedAt&&l.expiresAt===food.expiresAt)?.quantity??0;
   if(!after||after.revision!==draft.revision||JSON.stringify(after.formalBerryFixtureAnchor)!==JSON.stringify(anchor)||
    after.residents.find(r=>r.id===pickup.residentId)?.inventory.berry!==previousInventory+1||
    exactLot(after)!==exactLot(draft)||exactLot(after)<1)
    throw Error('formal_berry_fixture_pickup_commit_mismatch');
   this.db.exec('COMMIT');forgetFormalRainStep(draft);return {status:'picked' as const,receipt:structuredClone(pickup)};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 formalBerryFixtureApprovalScope():string|null {
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalApprovalKeyPem)return null;
  owner.assertOwned();this.assertDeveloperSpiritSeal();return formalBerryFixtureScope(owner);
 }
 /** Sole write authority. Caller can supply only signed pinned terms, never
  * a detached draft, DTO result, capacity, or transaction callback. */
 runDeveloperFormalBerryFixture(input:unknown) {
  const owner=this.developerSpiritFixtureOwner;
  if(!owner?.formalApprovalKeyPem)return {status:'disabled'} as const;
  let approval:unknown;
  try{approval=structuredClone(input);}catch{return {status:'denied'} as const;}
  if(!verifyFormalBerrySignedApproval(approval,owner))return {status:'denied'} as const;
  owner.assertOwned();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const w=this.readWorld(false,false),terms=approval.terms;
   if(!w||w.id!==terms.worldId)throw Error('formal_berry_fixture_wrong_world');
   const rows=this.readFormalBerryArchive(w),prior=rows.find(row=>row.approval.terms.approvalId===terms.approvalId);
   if(prior){
    const identical=prior.approval.signature===approval.signature;
    this.db.exec('COMMIT');
    return identical?{status:'committed' as const,replay:true,effect:structuredClone(prior)}:{status:'denied' as const};
   }
   if(!w.formalRainProvenance||w.revision!==terms.revision||w.clock.paused||
    w.minute<terms.firstMinute||w.minute>=terms.expiresMinute){
    this.db.exec('COMMIT');return {status:'denied'} as const;
   }
   let reviewedProposal:FormalShadowProposal|undefined;
   let due: {intent:FormalDueIntent;checkpoint:FormalDueCheckpoint}|undefined;
   if(owner.formalShadowKeyPem){
    // Existing v3 remains exact-head only. A due signature is a distinct
    // schema and cannot skip the live, persisted intent/checkpoint.
    const delayed=terms.schema===DUE_FORMAL_BERRY_APPROVAL;
    if(!delayed&&terms.schema!==BRIDGED_FORMAL_BERRY_APPROVAL){this.db.exec('COMMIT');return {status:'denied'} as const;}
    try{
     const shadowRows=readFormalShadowRows(this.db,owner,w),shadow=shadowRows.at(-1);
     const proposal=shadow?.proposal,review=shadow?.permission.terms;
     if(!shadow||!proposal||!review||review.decision!=='allow'||w.minute<review.startsAt||
      w.minute>=proposal.expiresAt||proposal.permissionVersion!==review.version||terms.shadowPermissionVersion!==review.version||
      proposal.proposalId!==terms.shadowProposalId||formalShadowApprovalBasis(shadow)!==terms.shadowBasisDigest||
      proposal.worldId!==terms.worldId||proposal.episodeId!==terms.episodeId||proposal.sourceId!==terms.sourceId||
      proposal.target.x!==terms.target.x||proposal.target.y!==terms.target.y||
      terms.maxAgeGameMinutes!==review.maxAgeGameMinutes||terms.firstMinute<proposal.atMinute||
      terms.expiresMinute>proposal.expiresAt){
      this.db.exec('COMMIT');return {status:'denied'} as const;
     }
     if(delayed){
      const slot=readFormalDueRows(this.db,w,shadowRows).find(r=>r.intent.id===terms.scheduleId),checkpoint=slot?.checkpoint;
      if(!slot||!checkpoint||formalDueCurrent(w,slot.intent,shadow,rows)!=='due'||
       slot.intent.proposalId!==proposal.proposalId||slot.intent.shadowBasisDigest!==terms.shadowBasisDigest||
       checkpoint.evidenceDigest!==terms.checkpointEvidenceDigest||checkpoint.atRevision!==w.revision||
       checkpoint.atMinute!==w.minute||terms.firstMinute!==w.minute||terms.expiresMinute>slot.intent.expiresAt){
       this.db.exec('COMMIT');return {status:'denied'} as const;
      }
      due={intent:slot.intent,checkpoint};
     }else if(proposal.atRevision!==terms.revision||proposal.atMinute!==w.minute){
      this.db.exec('COMMIT');return {status:'denied'} as const;
     }
     reviewedProposal=proposal;
    }catch{/* unreadable shadow/due custody disables new effects, not old receipts */
     this.db.exec('COMMIT');return {status:'denied'} as const;
    }
   }
   const planned=draftFormalBerryGround(this,{scope:'formal-berry-detached-draft',enabled:true,capacity:owner.capacity,
    geography:{scope:'formal-rain-geography-shadow-only',enabled:true,worldId:w.id,episodeId:terms.episodeId,
     maxAgeGameMinutes:terms.maxAgeGameMinutes,sites:[{sourceId:terms.sourceId,target:terms.target}]}},{
    schemaVersion:1,worldId:w.id,rainAdoptedMinute:w.formalRainProvenance.adoptedMinute,capacity:owner.capacity,
    drafts:rows.map(row=>row.receipt),
   });
   if(planned.status!=='draft_only'||planned.expectedWorldRevision!==w.revision||planned.receipt.sourceBefore!==terms.sourceBefore||
    reviewedProposal&&(planned.receipt.draftId!==reviewedProposal.opportunityId||
     planned.receipt.rain.startedMinute!==reviewedProposal.rainStartedAt||
     planned.receipt.rain.closedMinute!==reviewedProposal.rainClosedAt)){
    this.db.exec('COMMIT');return {status:'denied'} as const;
   }
   const foodBirth=pinFormalGroundBerryFoodBirth(w,planned.receipt);
   if(!foodBirth||terms.schema==='sealed-formal-berry-approval/v1'||terms.foodDefinition!==foodBirth.definition||
    foodBirth.expiresAt!==foodBirth.producedAt+terms.foodLifeDays!*DAY){this.db.exec('COMMIT');return {status:'denied'} as const;}
   if(due&&JSON.stringify(makeFormalDueCheckpoint(due.intent,planned.receipt,foodBirth,owner.capacity))!==JSON.stringify(due.checkpoint)){
    this.db.exec('COMMIT');return {status:'denied'} as const;
   }
   const draft=structuredClone(w),source=draft.resources.find(r=>r.id===terms.sourceId);
   if(!source||source.amount!==terms.sourceBefore||!Number.isSafeInteger(w.revision+1))throw Error('formal_berry_fixture_stock_changed');
   source.amount=planned.receipt.sourceAfter;draft.revision++;
   const effect:FormalBerryFixtureEffect={approval,receipt:planned.receipt,committedRevision:draft.revision,foodBirth};
   const anchor=formalBerryEffectAnchor([...rows,effect]);draft.formalBerryFixtureAnchor=anchor;
   this.assertWritable(draft);
   this.db.prepare('INSERT INTO formal_berry_fixture_effects (draft_id,approval_id,body) VALUES (?,?,?)')
    .run(effect.receipt.draftId,terms.approvalId,JSON.stringify(effect));
   this.writeCommit(draft,w.revision,undefined,undefined,undefined,anchor);
   const durable=this.readWorld(false,false);
   if(!durable||durable.id!==w.id||durable.revision!==draft.revision||
    durable.resources.find(r=>r.id===terms.sourceId)?.amount!==effect.receipt.sourceAfter||
    JSON.stringify(durable.formalBerryFixtureAnchor)!==JSON.stringify(anchor))
    throw Error('formal_berry_fixture_commit_mismatch');
   this.db.exec('COMMIT');
   return {status:'committed' as const,replay:false,effect:structuredClone(effect)};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 private assertWritable(world:World):void {
  this.developerSpiritFixtureOwner?.assertOwned();
  assertWorldCompatibility(world,!!this.mvpSpiritEffectFixture);
  if(Object.hasOwn(world,'formalBerryFixtureAnchor')&&!this.developerSpiritFixtureOwner?.formalApprovalKeyPem)
   throw Error('formal_berry_fixture_requires_owner');
  if(this.developerSpiritFixtureOwner){
   if(this.developerSpiritFixtureOwner.formalApprovalKeyPem){
    if(world.mode!=='formal'||!/^valley-formal-[A-Za-z0-9_-]{1,180}$/.test(world.id)||world.mvpClimate)
     throw Error('formal_berry_fixture_invalid_world');
   }else if(world.mode!=='validation'||!world.id.startsWith('godot-mvp-')||!world.mvpClimate?.rainProvenance)
    throw Error('mvp_spirit_fixture_invalid_world');
  }
  if(!this.allowMvpClimate)rejectMvpClimateForModels(world);
  if(world.formalRainProvenance&&!this.allowFormalRainProvenance)throw Error('formal_rain_store_scope');
  if(!this.seasonalModel&&world.mvpSeasonalModelVersion!==undefined)throw Error('seasonal_model_store_required');
 }
 commit(world:World,previousRevision:number|null,appended?:AppendedHistory,seasonalLedger?:SeasonalLedger):void{
  this.commitTransaction(world,previousRevision,appended,seasonalLedger);
 }
 /** Explicit developer attachment only. The private append shares the exact
  * world transaction; results escape only after COMMIT succeeds. */
 commitMvpWithAddressedSpeech(world:World,previousRevision:number,proof?:AddressedSpeechObservation):readonly ValleySpiritLifeReceipt[]{
  if(!this.allowMvpClimate||this.seasonalModel||this.dailySnapshots||world.mode!=='validation')
   throw Error('mvp_addressed_speech_store_required');
  return this.commitTransaction(world,previousRevision,undefined,undefined,proof);
 }
 readCommittedMvpAddressedSpeech(worldId:string,eventId:string):ValleySpiritLifeReceipt|null{
  return this.allowMvpClimate&&!this.seasonalModel?readValleySpiritSpeechCustody(this.db,worldId,eventId):null;
 }
 verifyCommittedMvpAddressedSpeech(receipt:Readonly<ValleySpiritLifeReceipt>):boolean{
  return this.allowMvpClimate&&!this.seasonalModel&&verifyValleySpiritSpeechCustody(this.db,receipt);
 }
 readCommittedFormalArrival(worldId:string,eventId:string):ValleySpiritFormalArrivalReceipt|null{
  return !this.allowMvpClimate&&!this.seasonalModel?readValleySpiritFormalArrivalCustody(this.db,worldId,eventId):null;
 }
 verifyCommittedFormalArrival(receipt:Readonly<ValleySpiritFormalArrivalReceipt>):boolean{
  return !this.allowMvpClimate&&!this.seasonalModel&&verifyValleySpiritFormalArrivalCustody(this.db,receipt);
 }
 private commitTransaction(world:World,previousRevision:number|null,appended?:AppendedHistory,seasonalLedger?:SeasonalLedger,
  proof?:AddressedSpeechObservation):readonly ValleySpiritLifeReceipt[]{
  this.assertWritable(world);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.writeCommit(world,previousRevision,appended,seasonalLedger);
   let speech:readonly ValleySpiritLifeReceipt[]=[];
   if(Array.isArray(proof?.receipts)&&proof.receipts.length){
    this.db.exec('SAVEPOINT optional_speech_custody');
    try{
     speech=appendValleySpiritSpeechCustody(this.db,world,previousRevision,proof);
     this.db.exec('RELEASE optional_speech_custody');
    }catch{
     // Unknown optional custody must not corrupt or block the world log.
     this.db.exec('ROLLBACK TO optional_speech_custody');
     this.db.exec('RELEASE optional_speech_custody');
     speech=[];
    }
   }
   if(!this.allowMvpClimate&&!this.seasonalModel&&world.mode==='formal'&&appended?.events.some(e=>Object.hasOwn(e,'socialAppointmentArrival'))){
    this.db.exec('SAVEPOINT optional_formal_arrival_custody');
    try{
     appendValleySpiritFormalArrivalCustody(this.db,world,previousRevision,appended.events);
     this.db.exec('RELEASE optional_formal_arrival_custody');
    }catch{
     this.db.exec('ROLLBACK TO optional_formal_arrival_custody');
     this.db.exec('RELEASE optional_formal_arrival_custody');
    }
   }
   this.db.exec('COMMIT');
   forgetFormalRainStep(world);
   if(world.mode==='formal'){this.terrainKeys.add(terrainRevision(world.map));this.separateLedgers.add(world.id);}
   return speech;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 /** Internal read-only seam. Memory fixtures and ordinary/production saves
  * cannot attest an installed private shadow capability. */
 developerMvpSpiritShadowReadPort(){
  const owner=this.developerSpiritFixtureOwner;
  if(!isDeveloperMvpSpiritFixtureOwner(owner)||owner.formalApprovalKeyPem)return null;
  const assertOwned=()=>{owner.assertOwned();this.assertDeveloperSpiritSeal();};
  assertOwned();
  return Object.freeze({
   database:owner.database,scopeId:createHash('sha256').update(owner.seal).digest('hex'),capacity:Object.freeze({...owner.capacity}),assertOwned,
   readHead:()=>{assertOwned();return this.readWorld(false,false);},
  });
 }
 hasMvpSpiritEffectFixture():boolean{return this.mvpSpiritEffectFixture!==undefined;}
 /** Fixture only: re-read and plan under the same synchronous SQLite lock
  * that validates the dedicated append and writes the authoritative rows. */
 runMvpSpiritEffectFixture<T>(
  worldId:string,operation:(current:World,capacity:MvpGroundFruitCapacity)=>{result:T;draft?:World},
 ):T {
  const capacity=this.mvpSpiritEffectFixture;
  if(!capacity)throw Error('mvp_spirit_fixture_requires_disposable_memory');
  this.developerSpiritFixtureOwner?.assertOwned();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const current=this.readWorld(false,false);
   if(!current||current.id!==worldId||current.mode!=='validation'||!current.mvpClimate?.spiritEffects)
    throw Error('mvp_spirit_fixture_world_not_adopted');
   const revision=current.revision,appliedCount=current.mvpClimate.spiritEffects.applied.length;
   const change=operation(current,capacity);
   if(change.draft){
    if(change.draft.id!==worldId||change.draft.mvpClimate?.spiritEffects?.applied.length!==appliedCount+1)
     throw Error('mvp_spirit_fixture_requires_one_effect');
    this.assertWritable(change.draft);
    this.writeCommit(change.draft,revision);
   }
   this.db.exec('COMMIT');
   return change.result;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 /** No runtime route: the fixture operation is recalculated from a fresh
  * authoritative head under one SQLite lock, never by accepting a draft. */
 runMvpFallenFruitSettlementFixture(worldId:string,operation:MvpFallenFruitFixtureOperation):MvpFallenFruitFixtureResult {
  if(!this.hasMvpSpiritEffectFixture())throw Error('mvp_spirit_resident_fruit_requires_isolated_fixture');
  this.developerSpiritFixtureOwner?.assertOwned();
  const pinned=structuredClone(operation);
  if(pinned?.type==='native-resident-round'&&(!this.developerSpiritFixtureOwner||this.developerSpiritFixtureOwner.formalApprovalKeyPem))
   throw Error('mvp_spirit_native_round_requires_owned_disk_fixture');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const current=this.readWorld(false,false);
   if(!current||current.id!==worldId)throw Error('mvp_spirit_resident_fruit_invalid_head');
   if(pinned?.type==='native-resident-round')assertDeveloperMvpEffectArchive(this.db,current);
   const planned=planMvpFallenFruitFixtureStep(current,pinned);
   if(planned.draft){
    this.assertWritable(planned.draft);
    this.writeCommit(planned.draft,current.revision,undefined,undefined,pinned);
   }
   this.db.exec('COMMIT');
   return planned.result;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 private writeCommit(world:World,previousRevision:number|null,appended?:AppendedHistory,seasonalLedger?:SeasonalLedger,
  settlementOperation?:MvpFallenFruitFixtureOperation,formalBerryAnchor?:FormalBerryFixtureAnchor):void {
  this.assertDeveloperSpiritSeal();
  if(this.developerSpiritFixtureOwner){
   const ids=this.db.prepare('SELECT id FROM worlds ORDER BY rowid LIMIT 2').all();
   if(ids.length>1||ids.length===1&&ids[0].id!==world.id)throw Error('mvp_spirit_fixture_world_changed');
  }
  const row=this.db.prepare('SELECT revision,state FROM worlds WHERE id=?').get(world.id) as {revision:number;state:string|Uint8Array}|undefined;
  const stored=row?decodeSavedWorld(row.state,!!this.mvpSpiritEffectFixture):null;
  if(stored){if(stored.schemaVersion===3&&world.schemaVersion!==3)throw Error('shelter_schema_downgrade');if(stored.mvpSeasonalModelVersion===1&&(!this.seasonalModel||world.mvpSeasonalModelVersion!==1))throw Error('seasonal_model_dependency_downgrade');assertSeasonalKnowledgeAdvance(stored as unknown as World,world);if(Object.prototype.hasOwnProperty.call(stored,'mvpPreservation')&&!world.mvpPreservation)throw Error('preservation_dependency_downgrade');if(Object.prototype.hasOwnProperty.call(stored,'mvpSoil')&&(!world.mvpSoil||(world.mvpClimate?.schemaVersion??0)<2))throw Error('soil_dependency_downgrade');if(Object.prototype.hasOwnProperty.call(stored,'mvpAgriculture')&&(!world.mvpAgriculture||world.mvpClimate?.schemaVersion!==3))throw Error('agriculture_dependency_downgrade');if(!this.allowMvpClimate)rejectMvpClimateForModels(stored);}
  if((row?.revision??null)!==previousRevision)throw new Error('stale_world_revision');
  if(formalBerryAnchor){
   if(!this.developerSpiritFixtureOwner?.formalApprovalKeyPem||
    JSON.stringify(formalBerryAnchor)!==JSON.stringify(world.formalBerryFixtureAnchor))throw Error('formal_berry_fixture_anchor_transition');
  }else if(JSON.stringify(stored?.formalBerryFixtureAnchor)!==JSON.stringify(world.formalBerryFixtureAnchor))
   throw Error('formal_berry_fixture_anchor_transition');
  assertFormalRainProvenanceCommit(stored as unknown as World|null,world,this.allowFormalRainProvenance);
  if(this.allowMvpClimate)assertMvpRainProvenanceAdvance(stored as unknown as World|null,world);
  if(this.mvpSpiritEffectFixture)assertMvpSpiritEffectsAdvance(stored as unknown as World|null,world,this.mvpSpiritEffectFixture);
  if(this.mvpSpiritEffectFixture)assertMvpFallenFruitFixtureTransition(stored as unknown as World|null,world,settlementOperation);
  const prior=this.seasonalModel?readSeasonalLedger(this.db,stored as unknown as World|null,true):null;
  if(!!(seasonalLedger??prior)!==(world.mvpSeasonalModelVersion===1))throw Error('seasonal_model_ledger_marker_mismatch');
  if(seasonalLedger){if(!this.seasonalModel)throw Error('seasonal_model_store_required');writeSeasonalLedger(this.db,seasonalLedger,prior,world);}
  else if(prior?.requests.at(-1)?.state==='intent')throw Error('seasonal_model_unresolved_request');
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
 }
 private assertDeveloperSpiritSeal():void {
  if(!this.developerSpiritFixtureOwner)return;
  const seals=this.db.prepare('SELECT * FROM mvp_spirit_developer_fixture LIMIT 2').all();
  if(seals.length!==1||Object.keys(seals[0]).length!==2||seals[0].version!==1||
   seals[0].seal!==this.developerSpiritFixtureOwner.seal)throw Error('mvp_spirit_fixture_seal_changed');
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
 close(){this.db.close();this.developerSpiritFixtureOwner?.release();}
}

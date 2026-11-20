import {createHash,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';
import {lstatSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {readMvpMealFact} from '../shared/mvp-meals.js';
import type {World} from '../shared/types.js';
import {stepWorldWithFoodEvidence} from '../world/engine.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import type {DirectEatingObservation} from '../world/food-consumption-evidence.js';
import {isValleySpiritLifeReceipt,type ValleySpiritLifeReceipt} from './valley-spirit-life-facts.js';

const TABLE='valley_spirit_meal_custody';
const LIMIT=4096;
const WORLD=/^godot-mvp-[a-zA-Z0-9_-]{1,180}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/;
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=1;
const minute=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e9;
const known=new WeakMap<ValleySpiritMvpMealWitness,World>();
/** Private engine evidence, never a projection, disclosure grant or public path. */
export interface ValleySpiritMvpMealWitness {
 readonly worldId:string;
 readonly revision:number;
 readonly eventId:string;
 readonly exactPlanId:string;
 readonly actorId:string;
 readonly atUs:string;
}

/** Derive only from a fresh captured actual eat action, matched against a newly
 * appended typed MVP meal event. The caller MUST NOT publish staged witnesses:
 * deliver them only once the exact draft has been durably committed. */
function stageValleySpiritMvpMealWitnesses(w:World,o:DirectEatingObservation,fromEventIndex:number):readonly ValleySpiritMvpMealWitness[]{
 if(w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||!WORLD.test(w.id)||!positive(w.revision)||
   !Number.isSafeInteger(fromEventIndex)||fromEventIndex<0||fromEventIndex>w.events.length||o.worldId!==w.id||
   !minute(o.fromMinute)||!minute(o.toMinute)||o.toMinute!==w.minute||
   BigInt(minuteToClimateUs(o.toMinute))-BigInt(minuteToClimateUs(o.fromMinute))!==1_000_000n||!Array.isArray(o.receipts)||
   o.receipts.length>w.residents.length)return [];
 const fresh=new Map(w.events.slice(fromEventIndex).map(e=>[e.id,e]));
 const out:ValleySpiritMvpMealWitness[]=[];
 const seen=new Set<string>();
 for(const r of o.receipts){
  if(r.item!=='meal')continue;
  if(r.quantity!==1||!minute(r.at)||r.at<=o.fromMinute||r.at>o.toMinute||typeof r.residentId!=='string'||!ID.test(r.residentId)||
     typeof r.planId!=='string'||!ID.test(r.planId)||typeof r.eventId!=='string'||!ID.test(r.eventId)||seen.has(r.eventId)||
     r.container!=='person:'+r.residentId||!w.residents.some(p=>p.id===r.residentId))return [];
  const e=fresh.get(r.eventId);
  if(!e||e.kind!=='action'||e.observerOnly||e.agriculture!==undefined||e.at!==r.at||e.actors.length!==1||
    e.actors[0]!==r.residentId||readMvpMealFact(e.mvpMeal)?.kind!=='ate')return [];
  const witness=Object.freeze({worldId:w.id,revision:w.revision,eventId:r.eventId,exactPlanId:r.planId,actorId:r.residentId,
     atUs:minuteToClimateUs(r.at)});
  known.set(witness,w);seen.add(r.eventId);out.push(witness);
 }
 return Object.freeze(out);
}
/**
 * Runs exactly one real engine step and seals its returned observations into a
 * staging closure. No API accepts caller-authored food observations. Invoke
 * the closure after the draft revision is finalized; deliver its witnesses
 * only after the world commit returns.
 */
export function captureValleySpiritMvpMealStep(w:World,options:Parameters<typeof stepWorldWithFoodEvidence>[2]):()=>readonly ValleySpiritMvpMealWitness[]{
 const fromEventIndex=w.events.length;
 const actual=stepWorldWithFoodEvidence(w,1,options);
 return ()=>stageValleySpiritMvpMealWitnesses(w,actual,fromEventIndex);
}
type CustodyRow={world_id:string;schema_version:number;event_id:string;plan_id:string;actor_id:string;at_us:string;committed_revision:number;receipt_id:string};
const expected=[
 ['event_id','TEXT',1],['world_id','TEXT',0],['schema_version','INTEGER',0],['plan_id','TEXT',0],['actor_id','TEXT',0],
 ['at_us','TEXT',0],['committed_revision','INTEGER',0],['receipt_id','TEXT',0],
] as const;
function asReceipt(row:CustodyRow):ValleySpiritLifeReceipt{
 return {schemaVersion:1,worldId:row.world_id,receiptId:row.receipt_id,receiptVersion:1,atUs:row.at_us,kind:'meal-consumed'};
}
function table(db:DatabaseSync):boolean{
 const m=db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(TABLE);
 if(!m)return false;
 const cols=db.prepare('PRAGMA table_info(valley_spirit_meal_custody)').all();
 if(m.type!=='table'||cols.length!==expected.length||cols.some((c,i)=>c.name!==expected[i][0]||c.type!==expected[i][1]||
  c.pk!==expected[i][2]||c.notnull!==1)||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))
   throw Error('unknown_life_meal_custody_schema');
 return true;
}
function rows(db:DatabaseSync,worldId:string):CustodyRow[]{
 if(!table(db))return [];
 const data=db.prepare('SELECT * FROM valley_spirit_meal_custody LIMIT ?').all(LIMIT+1) as unknown as CustodyRow[];
 const receipts=new Set<string>(),plans=new Set<string>();
 for(const r of data){
  if(r.world_id!==worldId||r.schema_version!==1||!ID.test(r.event_id)||!ID.test(r.plan_id)||!ID.test(r.actor_id)||
    !positive(r.committed_revision)||!isValleySpiritLifeReceipt(asReceipt(r))||receipts.has(r.receipt_id)||plans.has(r.plan_id))
   throw Error('unknown_life_meal_custody_state');
  receipts.add(r.receipt_id);plans.add(r.plan_id);
 }
 if(data.length>LIMIT)throw Error('life_meal_custody_overflow');
 return data;
}
export function inspectValleySpiritMealCustody(db:DatabaseSync,worldId:string):void{
 if(!WORLD.test(worldId))throw Error('invalid_life_meal_world');
 rows(db,worldId);
}
function persistedMeal(db:DatabaseSync,worldId:string,r:{revision:number;eventId:string;actorId:string;atUs:string},exactHead:boolean):boolean{
 const head=db.prepare('SELECT revision FROM main.worlds WHERE id=?').get(worldId)?.revision;
 if(!positive(head)||(exactHead?head!==r.revision:head<r.revision))return false;
 // SQLite selects only typed columns; no event prose or raw event object enters custody.
 const e=db.prepare(`SELECT at, json_extract(body,'$.id') AS body_id, json_extract(body,'$.at') AS body_at,
   json_extract(body,'$.kind') AS kind, json_extract(body,'$.mvpMeal') AS meal,
   json_type(body,'$.actors') AS actors, json_array_length(body,'$.actors') AS actor_count,
   json_extract(body,'$.actors[0]') AS actor, json_extract(body,'$.observerOnly') AS observer_only,
   json_type(body,'$.agriculture') AS agriculture FROM main.events WHERE id=? AND world_id=?`).get(r.eventId,worldId);
 return !!e&&e.body_id===r.eventId&&minute(e.at)&&e.body_at===e.at&&minuteToClimateUs(e.at)===r.atUs&&e.kind==='action'&&
  e.actors==='array'&&e.actor_count===1&&e.actor===r.actorId&&(e.observer_only===null||e.observer_only===0)&&
  e.agriculture===null&&typeof e.meal==='string'&&readMvpMealFact(JSON.parse(e.meal))?.kind==='ate';
}
function regular(path:string){
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('unsafe_life_meal_database');
 return stat;
}
const same=(a:ReturnType<typeof regular>,b:ReturnType<typeof regular>)=>a.dev===b.dev&&a.ino===b.ino;
const rowSignature=(r:CustodyRow)=>JSON.stringify(expected.map(([name])=>r[name]));

const supportedMealReceipt=(r:unknown,worldId:string):r is ValleySpiritLifeReceipt=>
 isValleySpiritLifeReceipt(r)&&r.kind==='meal-consumed'&&r.worldId===worldId&&r.receiptVersion===1;
function verifyReceipt(db:DatabaseSync,worldId:string,data:readonly CustodyRow[],receipt:Readonly<ValleySpiritLifeReceipt>):boolean{
 if(!supportedMealReceipt(receipt,worldId))return false;
 const row=data.find(r=>r.receipt_id===receipt.receiptId);
 return !!row&&row.at_us===receipt.atUs&&persistedMeal(db,worldId,{revision:row.committed_revision,
  eventId:row.event_id,actorId:row.actor_id,atUs:row.at_us},false);
}
/** Internal read-only borrower. The caller owns the file/SQL snapshot; the
 * helper never opens a writer, issues a receipt or scans events for new food. */
export function nativeMvpMealCustodyVerifierOnConnection(db:DatabaseSync,worldId:string){
 if(!WORLD.test(worldId))throw Error('invalid_life_meal_world');
 const seen=new Map(rows(db,worldId).map(row=>[row.event_id,rowSignature(row)]));
 let isolated=false;
 return (receipt:Readonly<ValleySpiritLifeReceipt>):boolean=>{
  if(isolated||!supportedMealReceipt(receipt,worldId))return false;
  try{
   const data=rows(db,worldId),current=new Map(data.map(r=>[r.event_id,rowSignature(r)]));
   if([...seen].some(([id,signature])=>current.get(id)!==signature))throw Error('rewound_life_meal_custody');
   for(const [id,signature] of current)seen.set(id,signature);
   return verifyReceipt(db,worldId,data,receipt);
  }catch{isolated=true;return false;}
 };
}

/** Optional private SQLite attachment. Requires the same live world owner.
 * No scanning past events to issue receipts: only witnessed commit hook can
 * mint UUID custody. Ledger loss after a committed world tick stays missing. */
export class SqliteValleySpiritMealCustody{
 private readonly db:DatabaseSync;
 private readonly file:ReturnType<typeof regular>;
 private readonly seen=new Map<string,string>();
 private isolated=false;
 constructor(private readonly path:string,private readonly worldId:string,private readonly assertOwned:()=>void){
  assertOwned();this.file=regular(path);
  const pre=new DatabaseSync(path,{readOnly:true});
  try{
   pre.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
   if(!same(this.file,regular(path))||!WORLD.test(worldId))throw Error('invalid_life_meal_database');
   for(const row of rows(pre,worldId))this.seen.set(row.event_id,rowSignature(row));
  }finally{pre.close();}
  assertOwned();
  this.db=new DatabaseSync(path);
  try{this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');this.read();}
  catch(e){this.db.close();throw e;}
 }
 private read(){
  this.assertOwned();if(!same(this.file,regular(this.path)))throw Error('changed_life_meal_database');
  const current=rows(this.db,this.worldId),known=new Map(current.map(row=>[row.event_id,rowSignature(row)]));
  if([...this.seen].some(([id,signature])=>known.get(id)!==signature))throw Error('rewound_life_meal_custody');
  for(const [id,signature] of known)this.seen.set(id,signature);
  return current;
 }
 acceptCommitted(witness:ValleySpiritMvpMealWitness):ValleySpiritLifeReceipt|null{
  if(this.isolated||!known.has(witness)||witness.worldId!==this.worldId)return null;
  let open=false;
  try{
   this.assertOwned();if(!same(this.file,regular(this.path)))throw Error('changed_life_meal_database');
   this.db.exec('BEGIN IMMEDIATE');open=true;
   const existing=this.read();
   if(!persistedMeal(this.db,this.worldId,witness,true))return null;
   const previous=existing.find(r=>r.event_id===witness.eventId);
   if(previous)return previous.plan_id===witness.exactPlanId&&previous.actor_id===witness.actorId&&previous.at_us===witness.atUs&&
    previous.committed_revision===witness.revision?asReceipt(previous):null;
   if(existing.length>=LIMIT||existing.some(r=>r.plan_id===witness.exactPlanId))return null;
   const receiptId=randomUUID();
   if(!table(this.db))this.db.exec('CREATE TABLE valley_spirit_meal_custody(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,schema_version INTEGER NOT NULL,plan_id TEXT UNIQUE NOT NULL,actor_id TEXT NOT NULL,at_us TEXT NOT NULL,committed_revision INTEGER NOT NULL,receipt_id TEXT UNIQUE NOT NULL)');
   this.db.prepare('INSERT INTO valley_spirit_meal_custody VALUES(?,?,1,?,?,?,?,?)')
    .run(witness.eventId,witness.worldId,witness.exactPlanId,witness.actorId,witness.atUs,witness.revision,receiptId);
   const row:CustodyRow={event_id:witness.eventId,world_id:witness.worldId,schema_version:1,plan_id:witness.exactPlanId,
    actor_id:witness.actorId,at_us:witness.atUs,committed_revision:witness.revision,receipt_id:receiptId};
   this.assertOwned();this.db.exec('COMMIT');open=false;this.seen.set(row.event_id,rowSignature(row));return asReceipt(row);
  }catch{this.isolated=true;return null;}
  finally{if(open)try{this.db.exec('ROLLBACK');}catch{this.isolated=true;}}
 }
 /** For real life authority's verifyCommitted/isCurrentReceipt ports only. */
 verifyCommitted(receipt:Readonly<ValleySpiritLifeReceipt>):boolean{
  if(this.isolated||!supportedMealReceipt(receipt,this.worldId))return false;
  try{
   return verifyReceipt(this.db,this.worldId,this.read(),receipt);
  }catch{this.isolated=true;return false;}
 }
 close(){this.db.close();}
}

const V2='valley_spirit_native_meal_custody_v2';
const V2_DDL=`CREATE TABLE ${V2}(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,schema_version INTEGER NOT NULL,plan_id TEXT NOT NULL,actor_id TEXT NOT NULL,at_us TEXT NOT NULL,committed_revision INTEGER NOT NULL,receipt_id TEXT UNIQUE NOT NULL)`;
function nativeRows(db:DatabaseSync,worldId:string):CustodyRow[]|null{
 const t=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(V2);
 if(!t)return null;
 if(t.type!=='table'||t.sql!==V2_DDL||
  db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(V2))
  throw Error('unknown_native_meal_v2_schema');
 const all=db.prepare(`SELECT * FROM ${V2} LIMIT ?`).all(LIMIT+1) as unknown as CustodyRow[];
 const events=new Set<string>(),receipts=new Set<string>();
 for(const r of all){
  if(r.world_id!==worldId||r.schema_version!==2||!ID.test(r.event_id)||!ID.test(r.plan_id)||!ID.test(r.actor_id)||
     !positive(r.committed_revision)||!isValleySpiritLifeReceipt(asReceipt(r))||events.has(r.event_id)||receipts.has(r.receipt_id))
   throw Error('invalid_native_meal_v2_row');
  events.add(r.event_id);receipts.add(r.receipt_id);
 }
 if(all.length>LIMIT)throw Error('native_meal_v2_capacity');
 return all;
}
/** V2 is event-level. Only the actual draft-bound witnesses can mint UUIDs;
 * the caller owns the surrounding same-world transaction and strict rollback. */
export function appendNativeMvpMealCustodyV2(db:DatabaseSync,w:World,witnesses:readonly ValleySpiritMvpMealWitness[]){
 if(db.isTransaction===false||!WORLD.test(w.id)||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||
    !Array.isArray(witnesses)||!witnesses.length||witnesses.length>w.residents.length)
  throw Error('invalid_native_meal_v2_transaction');
 const unique=new Set<string>();
 for(const r of witnesses){
  if(known.get(r)!==w||r.worldId!==w.id||r.revision!==w.revision||r.atUs!==minuteToClimateUs(w.minute)||
     unique.has(r.eventId)||!persistedMeal(db,w.id,r,true))throw Error('invalid_native_meal_v2_witness');
  unique.add(r.eventId);
 }
 const old=nativeRows(db,w.id);
 if((old?.length??0)+witnesses.length>LIMIT||old?.some(r=>unique.has(r.event_id)||r.committed_revision>=w.revision))
  throw Error('native_meal_v2_duplicate_or_capacity');
 if(!old)db.exec(V2_DDL);
 const insert=db.prepare(`INSERT INTO ${V2} VALUES(?,?,2,?,?,?,?,?)`);
 const result=new Map<string,ValleySpiritLifeReceipt>();
 for(const r of witnesses){
  const receiptId=randomUUID();
  insert.run(r.eventId,r.worldId,r.exactPlanId,r.actorId,r.atUs,r.revision,receiptId);
  result.set(r.eventId,Object.freeze({schemaVersion:1,worldId:w.id,receiptId,receiptVersion:1,atUs:r.atUs,kind:'meal-consumed'}));
 }
 return result;
}
/** Exact known event only, no legacy fallback or permission. */
export function readNativeMvpMealV2Receipt(db:DatabaseSync,worldId:string,eventId:string):ValleySpiritLifeReceipt|null{
 try{
  if(!WORLD.test(worldId)||!ID.test(eventId))return null;
  const r=nativeRows(db,worldId)?.find(x=>x.event_id===eventId);
  return r&&persistedMeal(db,worldId,{revision:r.committed_revision,eventId:r.event_id,actorId:r.actor_id,atUs:r.at_us},false)?
   asReceipt(r):null;
 }catch{return null;}
}

const ORDINARY='valley_spirit_ordinary_native_meal_receipts';
const ORDINARY_DDL=`CREATE TABLE ${ORDINARY}(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,schema_version INTEGER NOT NULL,plan_id TEXT NOT NULL,actor_id TEXT NOT NULL,at_us TEXT NOT NULL,committed_revision INTEGER NOT NULL,receipt_id TEXT UNIQUE NOT NULL,event_digest TEXT NOT NULL)`;
const ordinaryScope='ordinary-native-meal-custody/v1';
const ARCHIVE_META_DDL='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)';
export type OrdinaryNativeMealOptions=Readonly<{scope:typeof ordinaryScope;worldId:string}>;
export function pinOrdinaryNativeMealOptions(input:unknown):OrdinaryNativeMealOptions|null{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||
    !Object.hasOwn(input,'scope')||!Object.hasOwn(input,'worldId'))return null;
 const raw=input as OrdinaryNativeMealOptions;
 return raw.scope===ordinaryScope&&typeof raw.worldId==='string'&&WORLD.test(raw.worldId)?
  Object.freeze({scope:ordinaryScope,worldId:raw.worldId}):null;
}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function openOrdinaryNativeMealLease(owner:RuntimeOwnership,path:string,input:OrdinaryNativeMealOptions){
 const opts=pinOrdinaryNativeMealOptions(input),anchor=runtimeOwnershipAnchor(owner);
 if(!opts||!anchor||anchor.database!==path)throw Error('ordinary_native_meal_owner');
 anchor.assertOwned();
 const {worldId}=opts,file=regular(path);
 const binding=digest(JSON.stringify([ordinaryScope,worldId,String(file.dev),String(file.ino)]));
 const seen=new Map<string,string>();
 let isolated=false;
 const assertOwned=()=>{
  anchor.assertOwned();
  if(!same(file,regular(path)))throw Error('ordinary_native_meal_file_changed');
 };
 function assertCarrier(db:DatabaseSync){
  const shape=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta' LIMIT 2").all();
  if(shape.length!==1||shape[0].name!=='archive_meta'||shape[0].type!=='table'||shape[0].sql!==ARCHIVE_META_DDL||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)='archive_meta' AND type='trigger'").get()||
   db.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) IN ('archive_meta','worlds','events','event_people','event_animals',?) OR type='trigger' AND lower(tbl_name) IN ('archive_meta',?)").get(ORDINARY,ORDINARY))
   throw Error('ordinary_native_meal_carrier');
 }
 function exactHead(db:DatabaseSync,w:World){
  const head=db.prepare('SELECT revision,state FROM main.worlds WHERE id=?').get(w.id);
  return head?.revision===w.revision&&head.state instanceof Uint8Array&&gzipSync(JSON.stringify(w),{level:1}).equals(head.state);
 }
 function read(db:DatabaseSync){
  assertOwned();
  assertCarrier(db);
  const table=db.prepare('SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)=? LIMIT 2').all(ORDINARY);
  const mark=db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(ordinaryScope)?.value;
  if(!table.length&&mark===undefined&&!seen.size)return null;
  if(table.length!==1||table[0].name!==ORDINARY||table[0].type!=='table'||table[0].sql!==ORDINARY_DDL||mark!==binding||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(ORDINARY))
   throw Error('ordinary_native_meal_storage');
  const rows=db.prepare(`SELECT * FROM main.${ORDINARY} LIMIT ?`).all(LIMIT+1) as unknown as (CustodyRow&{event_digest:string})[];
  if(!rows.length||rows.length>LIMIT)throw Error('ordinary_native_meal_capacity');
  for(const r of rows)if(r.world_id!==worldId||r.schema_version!==1||!ID.test(r.event_id)||!ID.test(r.plan_id)||!ID.test(r.actor_id)||
   !positive(r.committed_revision)||!supportedMealReceipt(asReceipt(r),worldId)||!/^[a-f0-9]{64}$/.test(r.event_digest))
   throw Error('ordinary_native_meal_storage');
  const current=new Map(rows.map(r=>[r.event_id,JSON.stringify(r)]));
  if([...seen].some(([id,row])=>current.get(id)!==row))throw Error('ordinary_native_meal_observed_rollback');
  return {rows,current};
 }
 function exactEventDigest(db:DatabaseSync,r:{worldId:string;revision:number;eventId:string;actorId:string;atUs:string},exactHead:boolean){
  if(!persistedMeal(db,r.worldId,r,exactHead))return null;
  const event=db.prepare('SELECT rowid AS seq,body FROM main.events WHERE id=? AND world_id=?').get(r.eventId,r.worldId);
  const actors=db.prepare('SELECT world_id,person_id,event_seq FROM main.event_people WHERE event_id=? LIMIT 2').all(r.eventId);
  if(typeof event?.body!=='string'||actors.length!==1||actors[0].world_id!==r.worldId||
   actors[0].person_id!==r.actorId||actors[0].event_seq!==event.seq||
   db.prepare('SELECT 1 FROM main.event_animals WHERE event_id=? LIMIT 1').get(r.eventId))return null;
  return digest(event.body);
 }
 return Object.freeze({
  worldId,
  isolate(){isolated=true;},
  /** The outer WorldStore savepoint keeps evidence atomic with its world.
   * Never advance the observed rewind floor before that commit succeeds. */
  append(db:DatabaseSync,w:World,witnesses:readonly ValleySpiritMvpMealWitness[]){
   if(isolated||!witnesses.length)return;
   if(!db.isTransaction||w.id!==worldId||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly'))
    throw Error('ordinary_native_meal_append_scope');
   if(!exactHead(db,w))throw Error('ordinary_native_meal_changed_head');
   const old=read(db);
   if((old?.rows.length??0)+witnesses.length>LIMIT)throw Error('ordinary_native_meal_capacity');
   const staged=witnesses.map(r=>{
    if(known.get(r)!==w||r.worldId!==w.id||r.revision!==w.revision||r.atUs!==minuteToClimateUs(w.minute))
     throw Error('ordinary_native_meal_unverified');
    const eventDigest=exactEventDigest(db,r,true);if(!eventDigest)throw Error('ordinary_native_meal_unverified');
    return {r,eventDigest,id:randomUUID()};
   });
   if(!old){
    db.exec(ORDINARY_DDL);
    db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(ordinaryScope,binding);
   }
   const insert=db.prepare(`INSERT INTO main.${ORDINARY} VALUES(?,?,1,?,?,?,?,?,?)`);
   for(const {r,eventDigest,id} of staged)
    if(insert.run(r.eventId,w.id,r.exactPlanId,r.actorId,r.atUs,r.revision,id,eventDigest).changes!==1)
     throw Error('ordinary_native_meal_insert');
   const confirmed=read(db);
   if(!exactHead(db,w)||staged.some(({r,eventDigest,id})=>
    exactEventDigest(db,r,true)!==eventDigest||!confirmed?.rows.some(v=>v.receipt_id===id&&v.event_id===r.eventId&&
     v.event_digest===eventDigest&&v.plan_id===r.exactPlanId&&v.actor_id===r.actorId&&v.at_us===r.atUs&&v.committed_revision===r.revision)))
    throw Error('ordinary_native_meal_readback');
   assertOwned();
  },
  readAtHead(db:DatabaseSync,w:World,eventId:string){
   if(isolated||!db.isTransaction||w.id!==worldId||w.mode!=='validation'||typeof eventId!=='string'||!ID.test(eventId))return null;
   try{
    if(!exactHead(db,w))return null;
    const current=read(db),row=current?.rows.find(r=>r.event_id===eventId);
    if(current)for(const [key,value] of current.current)seen.set(key,value);
    if(!row||BigInt(row.at_us)>BigInt(minuteToClimateUs(w.minute)))return null;
    if(exactEventDigest(db,{worldId:w.id,revision:row.committed_revision,eventId,actorId:row.actor_id,atUs:row.at_us},false)!==row.event_digest)
     throw Error('ordinary_native_meal_archive_changed');
    assertOwned();
    return Object.freeze({status:'committed-private-meal' as const,receipt:Object.freeze(asReceipt(row)),disclosureAuthorized:false as const});
   }catch{isolated=true;return null;}
  },
 });
}

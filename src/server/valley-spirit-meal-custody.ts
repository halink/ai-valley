import {randomUUID} from 'node:crypto';
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
const known=new WeakSet<ValleySpiritMvpMealWitness>();
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
  known.add(witness);seen.add(r.eventId);out.push(witness);
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
 const head=db.prepare('SELECT revision FROM worlds WHERE id=?').get(worldId)?.revision;
 if(!positive(head)||(exactHead?head!==r.revision:head<r.revision))return false;
 // SQLite selects only typed columns; no event prose or raw event object enters custody.
 const e=db.prepare(`SELECT at, json_extract(body,'$.id') AS body_id, json_extract(body,'$.at') AS body_at,
   json_extract(body,'$.kind') AS kind, json_extract(body,'$.mvpMeal') AS meal,
   json_type(body,'$.actors') AS actors, json_array_length(body,'$.actors') AS actor_count,
   json_extract(body,'$.actors[0]') AS actor, json_extract(body,'$.observerOnly') AS observer_only,
   json_type(body,'$.agriculture') AS agriculture FROM events WHERE id=? AND world_id=?`).get(r.eventId,worldId);
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

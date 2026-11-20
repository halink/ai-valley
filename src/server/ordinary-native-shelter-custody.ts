import {createHash,randomUUID} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import {mvpShelterRoom} from '../shared/rooms.js';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {matchesNativeShelterEntry,type NativeShelterEntry} from '../world/mvp-native-shelter-entry.js';
import {same} from '../world/navigation.js';
import {hasReceipt} from '../world/receipts.js';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';

const TABLE='valley_spirit_ordinary_native_shelter_entries';
const DDL=`CREATE TABLE ${TABLE}(plan_id TEXT PRIMARY KEY NOT NULL,committed_revision INTEGER NOT NULL,at_us TEXT NOT NULL,receipt_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL)`;
const META='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)';
const SCOPE='ordinary-native-shelter-entry-custody/v1';
const WORLD=/^godot-mvp-[A-Za-z0-9_-]{1,180}$/u,ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/u;
const LIMIT=512;
const HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9-]{36}$/u;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const head=(w:World)=>hash(JSON.stringify(w));
const validId=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
const integer=(n:unknown,min=0):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min;
const point=(v:unknown)=>!!v&&typeof v==='object'&&Object.keys(v).length===2&&'x' in v&&'y' in v&&integer(v.x)&&integer(v.y);
const regular=(path:string)=>{
 const f=lstatSync(path,{bigint:true});
 if(!f.isFile()||f.isSymbolicLink()||f.nlink!==1n)throw Error('ordinary_native_shelter_file');
 return f;
};
export type OrdinaryNativeShelterOptions=Readonly<{scope:typeof SCOPE;worldId:string}>;
export function pinOrdinaryNativeShelterOptions(raw:unknown):OrdinaryNativeShelterOptions|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'scope')||!Object.hasOwn(raw,'worldId'))return null;
 const p=raw as OrdinaryNativeShelterOptions;
 return p.scope===SCOPE&&typeof p.worldId==='string'&&WORLD.test(p.worldId)?Object.freeze({scope:SCOPE,worldId:p.worldId}):null;
}
type Row={plan_id:string;committed_revision:number;at_us:string;receipt_id:string;body:string};
type Body=Readonly<{worldId:string;priorRevision:number;fromHead:string;toHead:string;entry:NativeShelterEntry}>;
function exactHead(db:DatabaseSync,w:World){
 const h=db.prepare('SELECT revision,state FROM main.worlds WHERE id=?').get(w.id);
 return h?.revision===w.revision&&h.state instanceof Uint8Array&&gzipSync(JSON.stringify(w),{level:1}).equals(h.state);
}
function validRow(r:Row,worldId:string,w:World){
 if(!validId(r.plan_id)||!integer(r.committed_revision,1)||r.committed_revision>w.revision||
  typeof r.at_us!=='string'||!/^(0|[1-9][0-9]{0,15})$/u.test(r.at_us)||BigInt(r.at_us)>BigInt(minuteToClimateUs(w.minute))||
  typeof r.receipt_id!=='string'||!UUID.test(r.receipt_id)||typeof r.body!=='string')return false;
 const b=JSON.parse(r.body) as Body,p=b.entry;
 return Object.keys(b).length===5&&b.worldId===worldId&&integer(b.priorRevision)&&b.priorRevision<r.committed_revision&&
  typeof b.fromHead==='string'&&HASH.test(b.fromHead)&&typeof b.toHead==='string'&&HASH.test(b.toHead)&&
  (r.committed_revision!==w.revision||b.toHead===head(w))&&!!p&&Object.keys(p).length===6&&p.planId===r.plan_id&&
  validId(p.actorId)&&validId(p.buildingId)&&point(p.door)&&point(p.entry)&&minuteToClimateUs(p.minute)===r.at_us;
}
/** Private append-only witness store. No existing WorldEvent is an entry record. */
export function openOrdinaryNativeShelterLease(owner:RuntimeOwnership,path:string,raw:OrdinaryNativeShelterOptions){
 const opts=pinOrdinaryNativeShelterOptions(raw),anchor=runtimeOwnershipAnchor(owner);
 if(!opts||!anchor||anchor.database!==path)throw Error('ordinary_native_shelter_owner');
 anchor.assertOwned();
 const initial=regular(path),{worldId}=opts,binding=hash(JSON.stringify([SCOPE,worldId,String(initial.dev),String(initial.ino)]));
 const seen=new Map<string,string>();
 let isolated=false;
 const assertOwned=()=>{
  anchor.assertOwned();const f=regular(path);
  if(f.dev!==initial.dev||f.ino!==initial.ino)throw Error('ordinary_native_shelter_file_changed');
 };
 function read(db:DatabaseSync,w:World){
  assertOwned();
  const meta=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta' LIMIT 2").all();
  if(meta.length!==1||meta[0].name!=='archive_meta'||meta[0].type!=='table'||meta[0].sql!==META||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) IN ('archive_meta',?) AND (type='trigger' OR type='index' AND sql IS NOT NULL)").get(TABLE)||
   db.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) IN ('archive_meta','worlds',?) OR type='trigger' AND lower(tbl_name) IN ('archive_meta',?)").get(TABLE,TABLE))
   throw Error('ordinary_native_shelter_storage');
  const shape=db.prepare('SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)=? LIMIT 2').all(TABLE);
  const mark=db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(SCOPE)?.value;
  if(!shape.length&&mark===undefined&&!seen.size)return null;
  if(shape.length!==1||shape[0].name!==TABLE||shape[0].type!=='table'||shape[0].sql!==DDL||mark!==binding)
   throw Error('ordinary_native_shelter_storage');
  const rows=db.prepare(`SELECT plan_id,committed_revision,at_us,receipt_id,CASE WHEN length(CAST(body AS BLOB))<=2048 THEN body END AS body FROM main.${TABLE} LIMIT ?`).all(LIMIT+1) as unknown as Row[];
  if(!rows.length||rows.length>LIMIT||rows.some(r=>!validRow(r,worldId,w)))throw Error('ordinary_native_shelter_archive');
  const current=new Map(rows.map(r=>[r.plan_id,JSON.stringify(r)]));
  if([...seen].some(([key,value])=>current.get(key)!==value))throw Error('ordinary_native_shelter_observed_rollback');
  return {rows,current};
 }
 return Object.freeze({
  worldId,
  isolate(){isolated=true;},
  append(db:DatabaseSync,previous:World,w:World,entries:readonly NativeShelterEntry[]){
   if(isolated||!entries.length)return;
   if(!db.isTransaction||previous.id!==worldId||w.id!==worldId||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||
    previous.clock.paused||w.clock.paused||w.minute!==previous.minute+1||entries.length>w.residents.length||!exactHead(db,w))
    throw Error('ordinary_native_shelter_unverified');
   const old=read(db,w);
   if((old?.rows.length??0)+entries.length>LIMIT)throw Error('ordinary_native_shelter_capacity');
   const fromHead=head(previous),toHead=head(w);
   const rows=entries.map(entry=>{
    const before=previous.residents.find(r=>r.id===entry.actorId),after=w.residents.find(r=>r.id===entry.actorId);
    const room=before&&mvpShelterRoom(previous,before);
    if(!before||!after||!room||before.inside!==null||before.roomAt!=null||!same(before.at,entry.door)||
     room.building.id!==entry.buildingId||!same(room.building.door,entry.door)||!same(room.target,entry.entry)||
     before.activity&&before.activity.planId!==entry.planId||!hasReceipt(w,'plan:'+entry.planId)||!matchesNativeShelterEntry(w,after,entry))
     throw Error('ordinary_native_shelter_transition');
    return {plan_id:entry.planId,committed_revision:w.revision,at_us:minuteToClimateUs(entry.minute),receipt_id:randomUUID(),
     body:JSON.stringify({worldId,priorRevision:previous.revision,fromHead,toHead,entry} satisfies Body)} satisfies Row;
   });
   if(!old){
    db.exec(DDL);db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(SCOPE,binding);
   }
   const insert=db.prepare(`INSERT INTO main.${TABLE} VALUES(?,?,?,?,?)`);
   for(const r of rows)if(insert.run(r.plan_id,r.committed_revision,r.at_us,r.receipt_id,r.body).changes!==1)
    throw Error('ordinary_native_shelter_insert');
   const confirmed=read(db,w);
   if(!exactHead(db,w)||rows.some(r=>!confirmed?.rows.some(v=>v.receipt_id===r.receipt_id&&v.plan_id===r.plan_id&&
    v.committed_revision===r.committed_revision&&v.at_us===r.at_us&&v.body===r.body)))throw Error('ordinary_native_shelter_readback');
   assertOwned();
  },
  latest(db:DatabaseSync,w:World){
   if(isolated||!db.isTransaction||w.id!==worldId||w.mode!=='validation')return null;
   try{
    if(!exactHead(db,w))return null;
    const found=read(db,w);
    if(!found)return null;
    for(const [key,value] of found.current)seen.set(key,value);
    const revision=Math.max(...found.rows.map(r=>r.committed_revision));
    return Object.freeze({status:'committed-private-shelter-entry' as const,
     receipts:Object.freeze(found.rows.filter(r=>r.committed_revision===revision).map(r=>Object.freeze({
      receiptId:r.receipt_id,kind:'shelter-entered' as const,atUs:r.at_us,
     }))),disclosureAuthorized:false as const});
   }catch{isolated=true;return null;}
  },
 });
}

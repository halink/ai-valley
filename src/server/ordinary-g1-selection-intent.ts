/** Original ordinary archive only: one local memory-selection attempt per closed rain. */
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

const PURPOSE='ordinary-native-g1-selection-intent/v1';
const TABLE='valley_spirit_ordinary_g1_selection_intents';
const DDL='CREATE TABLE '+TABLE+' (episode TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)';
const MAX=32;
const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export type OrdinarySelectionIntentPin=Readonly<{scope:typeof PURPOSE;originalScope:string}>;
const pins=new WeakSet<OrdinarySelectionIntentPin>();
export function pinOrdinarySelectionIntent(input:unknown){
 if(!input||typeof input!=='object'||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==2)return null;
 const scope=Object.getOwnPropertyDescriptor(input,'scope')?.value,originalScope=Object.getOwnPropertyDescriptor(input,'originalScope')?.value;
 if(scope!==PURPOSE||!hex(originalScope))return null;
 const p=Object.freeze({scope,originalScope});pins.add(p);return p;
}
export const ownsOrdinarySelectionIntentPin=(p:OrdinarySelectionIntentPin)=>pins.has(p);
export type OrdinarySelectionIntentHead=Readonly<{worldId:string;revision:number;atUs:string;permissionVersion:number;
 headDigest:string;snapshot:string;episode:string}>;
/** Approval locks the raw stored head and owned episode without adding either
 * to the anonymous request or changing the legacy selector wire format. */
export const ordinarySelectionIntentSigningSnapshot=(head:OrdinarySelectionIntentHead)=>digest([PURPOSE,'exact-approved-head',head]);
type Row={episode:string;body:string};
type Archive={rows:Row[];mark:string|null};
function surfaces(db:DatabaseSync){
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (?, 'archive_meta') OR lower(tbl_name) IN (?, 'archive_meta') LIMIT 1").get(TABLE,TABLE))
  throw Error('ordinary_g1_selection_intent_shadow');
 const table=db.prepare('SELECT type,name,sql FROM main.sqlite_schema WHERE lower(name)=?').get(TABLE);
 const meta=db.prepare("SELECT type,name,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta'").get();
 if(meta?.type!=='table'||meta.name!=='archive_meta'||meta.sql!=='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  throw Error('ordinary_g1_selection_intent_metadata');
 const mark=db.prepare('SELECT CASE WHEN length(CAST(value AS BLOB))=64 THEN value END value FROM main.archive_meta WHERE lower(key)=? LIMIT 2').all(PURPOSE);
 return {table,mark};
}
export function hasOrdinarySelectionIntentState(db:DatabaseSync){
 try{const {table,mark}=surfaces(db);return !!table||mark.length!==0;}catch{return true;}
}
function calculateAnchor(worldId:string,scope:string,rows:ReadonlyArray<Row>){
 return digest([PURPOSE,'intent-rows',worldId,scope,rows]);
}
function archive(db:DatabaseSync,worldId:string,originalScope:string):Archive{
 const {table,mark}=surfaces(db);
 if(!table&&!mark.length)return {rows:[],mark:null};
 if(table?.type!=='table'||table.name!==TABLE||table.sql!==DDL||mark.length!==1||!hex(mark[0].value)||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) IN (?, 'archive_meta') AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
  throw Error('ordinary_g1_selection_intent_archive');
 const rows=db.prepare('SELECT episode, CASE WHEN length(CAST(body AS BLOB))<=1024 THEN body END body FROM main.'+TABLE+' ORDER BY episode LIMIT '+(MAX+1)).all();
 if(!rows.length||rows.length>MAX||rows.some(r=>!hex(r.episode)||typeof r.body!=='string'))throw Error('ordinary_g1_selection_intent_archive');
 const shaped=rows as Row[];
 if(calculateAnchor(worldId,originalScope,shaped)!==mark[0].value)throw Error('ordinary_g1_selection_intent_archive');
 for(const {episode,body} of shaped){
  const tuple:unknown=JSON.parse(body);
  if(!Array.isArray(tuple)||tuple.length!==9||JSON.stringify(tuple)!==body||tuple[0]!==worldId||tuple[1]!==originalScope||
    tuple[2]!==episode||!integer(tuple[3])||typeof tuple[4]!=='string'||!/^\d{1,16}$/.test(tuple[4])||
    !integer(tuple[5])||tuple[5]<1||!tuple.slice(6).every(hex))throw Error('ordinary_g1_selection_intent_record');
 }
 return {rows:shaped,mark:mark[0].value};
}
/** Caller holds the original OS lock and BEGIN IMMEDIATE, and has just
 * independently re-derived the signed native basis. This is never a replay
 * or a settlement: existence alone consumes the opportunity even if no reply. */
export function appendOrdinarySelectionIntent(db:DatabaseSync,pin:OrdinarySelectionIntentPin,head:OrdinarySelectionIntentHead,approvalDigest:string){
 if(!db.isTransaction||!pins.has(pin)||!hex(approvalDigest)||!hex(head.episode)||!hex(head.headDigest)||!hex(head.snapshot))return false;
 const {rows,mark}=archive(db,head.worldId,pin.originalScope);
 if(rows.length>=MAX||rows.some(r=>r.episode===head.episode))return false;
 if(!mark){
  // A trigger on the companion metadata must also be refused before first use.
  if(db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)='archive_meta' AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get())
   throw Error('ordinary_g1_selection_intent_archive');
  db.exec(DDL);
 }
 const body=JSON.stringify([head.worldId,pin.originalScope,head.episode,head.revision,head.atUs,head.permissionVersion,
  head.headDigest,head.snapshot,approvalDigest]);
 db.prepare('INSERT INTO main.'+TABLE+'(episode,body) VALUES(?,?)').run(head.episode,body);
 const next=[...rows,{episode:head.episode,body}].sort((a,b)=>a.episode<b.episode?-1:a.episode>b.episode?1:0);
 const expected=calculateAnchor(head.worldId,pin.originalScope,next);
 if(mark)db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(expected,PURPOSE,mark);
 else db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(PURPOSE,expected);
 if(archive(db,head.worldId,pin.originalScope).mark!==expected)throw Error('ordinary_g1_selection_intent_readback');
 return true;
}

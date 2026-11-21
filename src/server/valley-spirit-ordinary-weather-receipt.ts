import {createHash,createPublicKey,verify} from 'node:crypto';
import {lstatSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import {isOrdinaryReviewedWeatherField,type OrdinaryReviewedWeatherField,type ValleySpiritAlmanacEntry} from './valley-spirit-almanac.js';
export const ORDINARY_OFFLINE_REVIEW_SCHEMA='ordinary-offline-weather-review/v1' as const;
const SCHEMA=ORDINARY_OFFLINE_REVIEW_SCHEMA;
export const ORDINARY_OFFLINE_CORRECTION_SCHEMA='ordinary-offline-weather-correction/v1' as const;
const CORRECTION_SCHEMA=ORDINARY_OFFLINE_CORRECTION_SCHEMA;
export const ORDINARY_OFFLINE_SELECTED_SCHEMA='ordinary-offline-weather-selected-field/v1' as const;

export const ORDINARY_REVIEW_WORLD=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/;
const ENTRY=/^valley-almanac-[a-f0-9]{64}$/;
const HEX=/^[a-f0-9]{64}$/;
export const ORDINARY_REVIEW_SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
export const ordinaryReviewDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const int=(v:unknown,n:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=n;

interface OrdinaryOfflineWeatherTerms {
 worldId:string;saveScope:string;reviewerFingerprint:string;
 headRevision:number;permissionVersion:number;priorAlmanacDigest:string;
 entryId:string;editionDigest:string;selectedSourcesDigest:string;
}
export interface OrdinaryOfflineWeatherReview extends OrdinaryOfflineWeatherTerms {schema:typeof SCHEMA}
export interface OrdinaryOfflineWeatherCorrection extends OrdinaryOfflineWeatherTerms {
 schema:typeof CORRECTION_SCHEMA;
 supersedes:string; predecessorDigest:string; predecessorReceiptDigest:string; predecessorWithdrawalDigest:string;
}
export interface OrdinaryOfflineWeatherSelection extends OrdinaryOfflineWeatherTerms {
 schema:typeof ORDINARY_OFFLINE_SELECTED_SCHEMA; rawHeadDigest:string; rendererVersion:1; sourceRef:string; field:OrdinaryReviewedWeatherField;
}
const baseline=['worldId','saveScope','reviewerFingerprint','headRevision','permissionVersion','priorAlmanacDigest','entryId','editionDigest','selectedSourcesDigest'] as const;
/** The reviewer signs the exact supported edition and authority version, not
 * a generic release request. Private key stays outside the service. */
export function encodeOrdinaryOfflineWeatherReview(t:unknown):Buffer|null {
 if(!exact(t,['schema',...baseline])||
   t.schema!==SCHEMA||typeof t.worldId!=='string'||!ORDINARY_REVIEW_WORLD.test(t.worldId)||typeof t.entryId!=='string'||!ENTRY.test(t.entryId)||
   !int(t.headRevision,0)||!int(t.permissionVersion,1)||
   [t.saveScope,t.reviewerFingerprint,t.priorAlmanacDigest,t.editionDigest,t.selectedSourcesDigest].some(v=>typeof v!=='string'||!HEX.test(v)))return null;
 return Buffer.from(JSON.stringify([SCHEMA,t.worldId,t.saveScope,t.reviewerFingerprint,t.headRevision,t.permissionVersion,
  t.priorAlmanacDigest,t.entryId,t.editionDigest,t.selectedSourcesDigest]),'utf8');
}

export function encodeOrdinaryOfflineWeatherCorrection(t:unknown):Buffer|null {
 if(!exact(t,['schema',...baseline,'supersedes','predecessorDigest','predecessorReceiptDigest','predecessorWithdrawalDigest'])||
  t.schema!==CORRECTION_SCHEMA||typeof t.supersedes!=='string'||!ENTRY.test(t.supersedes)||t.supersedes===t.entryId||
  [t.predecessorDigest,t.predecessorReceiptDigest,t.predecessorWithdrawalDigest].some(v=>typeof v!=='string'||!HEX.test(v)))return null;
 const inherited=Object.fromEntries(baseline.map(k=>[k,t[k]]));
 const bytes=encodeOrdinaryOfflineWeatherReview({schema:SCHEMA,...inherited});
 return bytes?Buffer.from(JSON.stringify([CORRECTION_SCHEMA,'first-replacement/v2',bytes.toString('base64url'),
  t.supersedes,t.predecessorDigest,t.predecessorReceiptDigest,t.predecessorWithdrawalDigest]),'utf8'):null;
}

export function encodeOrdinaryOfflineWeatherSelection(t:unknown):Buffer|null {
 if(!exact(t,['schema',...baseline,'rawHeadDigest','rendererVersion','sourceRef','field'])||
  t.schema!==ORDINARY_OFFLINE_SELECTED_SCHEMA||typeof t.rawHeadDigest!=='string'||!HEX.test(t.rawHeadDigest)||t.rendererVersion!==1||
  !isOrdinaryReviewedWeatherField(t.field)||typeof t.sourceRef!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}\/weather-[1-9][0-9]{0,15}-[0-9]{1,16}$/.test(t.sourceRef)||
  !t.sourceRef.startsWith(t.worldId+'/'+ 'weather-'+t.permissionVersion+'-'))return null;
 const inherited=Object.fromEntries(baseline.map(k=>[k,t[k]]));
 const bytes=encodeOrdinaryOfflineWeatherReview({schema:SCHEMA,...inherited});
 return bytes?Buffer.from(JSON.stringify([ORDINARY_OFFLINE_SELECTED_SCHEMA,bytes.toString('base64url'),t.rawHeadDigest,t.rendererVersion,t.sourceRef,t.field]),'utf8'):null;
}
/** Bind original compressed SQL bytes, not an in-memory reconstruction. */
export function ordinaryWeatherRawHeadDigest(db:DatabaseSync,worldId:string,revision:number){
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),row=rows[0];
 return rows.length===1&&row.id===worldId&&row.revision===revision&&row.state instanceof Uint8Array?
  createHash('sha256').update(row.state).digest('hex'):null;
}

const TABLE='valley_spirit_ordinary_weather_review';
const DDL='CREATE TABLE valley_spirit_ordinary_weather_review(entry_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,receipt_json TEXT NOT NULL)';
// The ordinary editorial developer lane needs only a bounded release
// history. Every public read checks all signatures once; never let that
// synchronous operation grow to thousands of verifier calls.
const MAX_ROWS=256, MAX_BYTES=4096;
export interface OrdinaryWeatherReviewReceipt {
 terms:OrdinaryOfflineWeatherReview|OrdinaryOfflineWeatherCorrection|OrdinaryOfflineWeatherSelection;
 reviewerDer:string;
 signature:string;
}
export function ordinaryReviewSaveScope(database:string,worldId:string):string {
 const file=lstatSync(database,{bigint:true});
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1n)throw Error('ordinary_weather_review_save_scope');
 return ordinaryReviewDigest([SCHEMA,worldId,String(file.dev),String(file.ino)]);
}
function table(db:DatabaseSync):boolean {
 const row=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(TABLE);
 if(!row)return false;
 if(row.type!=='table'||row.sql!==DDL||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(TABLE))
  throw Error('unknown_ordinary_weather_review_schema');
 return true;
}
const committedRevision=(db:DatabaseSync,worldId:string)=>db.prepare('SELECT revision FROM worlds WHERE id=?').get(worldId)?.revision;
export function verifiedOrdinaryWeatherReceipt(value:unknown,entry:ValleySpiritAlmanacEntry,worldRevision:unknown,scope?:string):OrdinaryWeatherReviewReceipt|null{
 try{
  if(!exact(value,['terms','reviewerDer','signature'])||typeof value.reviewerDer!=='string'||!(/^[A-Za-z0-9_-]{59}$/.test(value.reviewerDer))||
   typeof value.signature!=='string'||!ORDINARY_REVIEW_SIGNATURE.test(value.signature))return null;
  const t=value.terms as OrdinaryWeatherReviewReceipt['terms'], corrected=entry.textVersion===2;
  const selected=t.schema===ORDINARY_OFFLINE_SELECTED_SCHEMA;
  const bytes=corrected?encodeOrdinaryOfflineWeatherCorrection(t):entry.textVersion===1?
   selected?encodeOrdinaryOfflineWeatherSelection(t):encodeOrdinaryOfflineWeatherReview(t):null;
  if(selected&&(entry.packet.points.length!==1||entry.packet.points[0].sourceRef!==t.sourceRef||
   entry.draft?.claims.length!==1||entry.draft.claims[0].sourceRef!==t.sourceRef||entry.draft.claims[0].field!==t.field||
   entry.rendered?.rendererVersion!==t.rendererVersion||entry.rendered.facts.length!==1||entry.rendered.facts[0].field!==t.field))return null;
  if(corrected&&(t.schema!==CORRECTION_SCHEMA||t.supersedes!==entry.supersedes))return null;
  if(!bytes||t.worldId!==entry.packet.worldId||t.entryId!==entry.entryId||t.permissionVersion!==entry.packet.permissionVersion||
   t.editionDigest!==ordinaryReviewDigest(entry)||!int(worldRevision,t.headRevision)||(scope!==undefined&&t.saveScope!==scope))return null;
  const publicDer=Buffer.from(value.reviewerDer,'base64url'),signature=Buffer.from(value.signature,'base64url');
  if(publicDer.length!==44||signature.length!==64||publicDer.toString('base64url')!==value.reviewerDer||
   signature.toString('base64url')!==value.signature||createHash('sha256').update(publicDer).digest('hex')!==t.reviewerFingerprint)return null;
  const reviewer=createPublicKey({key:publicDer,format:'der',type:'spki'});
  return reviewer.asymmetricKeyType==='ed25519'&&reviewer.export({format:'der',type:'spki'}).equals(publicDer)&&verify(null,bytes,reviewer,signature)
   ? value as unknown as OrdinaryWeatherReviewReceipt:null;
 }catch{return null;}
}
function verifyReceiptAtDbHead(db:DatabaseSync,worldId:string,entry:ValleySpiritAlmanacEntry,value:unknown,revision:unknown,scope?:string){
 const r=verifiedOrdinaryWeatherReceipt(value,entry,revision,scope);
 if(r?.terms.schema===ORDINARY_OFFLINE_SELECTED_SCHEMA&&revision===r.terms.headRevision&&
    ordinaryWeatherRawHeadDigest(db,worldId,r.terms.headRevision)!==r.terms.rawHeadDigest)return null;
 return r;
}
export function readOrdinaryWeatherReceipts(db:DatabaseSync,worldId:string,reviewed:readonly ValleySpiritAlmanacEntry[],scope?:string){
 const result=new Map<string,OrdinaryWeatherReviewReceipt>();
 if(!table(db)){
  if(reviewed.length)throw Error('ordinary_weather_review_receipt_missing');
  return result;
 }
 const rows=db.prepare(`SELECT entry_id,world_id,CASE WHEN length(CAST(receipt_json AS BLOB))<=? THEN receipt_json ELSE NULL END AS receipt_json FROM ${TABLE} LIMIT ?`).all(MAX_BYTES,MAX_ROWS+1);
 if(rows.length!==reviewed.length||!rows.length||rows.length>MAX_ROWS)throw Error('ordinary_weather_review_receipt_count');
 const byId=new Map(reviewed.map(e=>[e.entryId,e])),revision=committedRevision(db,worldId);
 for(const row of rows){
  const e=typeof row.entry_id==='string'?byId.get(row.entry_id):undefined;
  const receipt=e&&row.world_id===worldId&&typeof row.receipt_json==='string'
   ?verifyReceiptAtDbHead(db,worldId,e,JSON.parse(row.receipt_json),revision,scope):null;
  if(!e||!receipt||result.has(e.entryId))throw Error('ordinary_weather_review_receipt_invalid');
  result.set(e.entryId,receipt);
 }
 return result;
}
/** Point recheck after the full table integrity gate. Read only the indexed
 * exact receipt; verify the expected edition object's exact digest in this
 * snapshot, not an ID/label match. No table-wide materialization or parse. */
export function readExactOrdinaryWeatherReceipt(db:DatabaseSync,worldId:string,e:ValleySpiritAlmanacEntry,scope:string):OrdinaryWeatherReviewReceipt|null {
 if(e.packet.worldId!==worldId||!table(db))return null;
 const row=db.prepare(`SELECT world_id,CASE WHEN length(CAST(receipt_json AS BLOB))<=? THEN receipt_json ELSE NULL END AS receipt_json
  FROM ${TABLE} WHERE entry_id=?`).get(MAX_BYTES,e.entryId);
 return row?.world_id===worldId&&typeof row.receipt_json==='string'
  ?verifyReceiptAtDbHead(db,worldId,e,JSON.parse(row.receipt_json),committedRevision(db,worldId),scope):null;
}
/** Must run inside the edition CAS transaction. Historical prior-table terms
 * are enforced at write, not recomputed against future changed legacy rows. */
export function appendOrdinaryWeatherReceipt(db:DatabaseSync,worldId:string,scope:string,prior:readonly ValleySpiritAlmanacEntry[],
 entry:ValleySpiritAlmanacEntry,proof:OrdinaryWeatherReviewReceipt){
 const revision=committedRevision(db,worldId);
 const valid=verifiedOrdinaryWeatherReceipt(proof,entry,revision,scope);
 if(!valid||valid.terms.headRevision!==revision||valid.terms.priorAlmanacDigest!==ordinaryReviewDigest(prior)||
  valid.terms.schema===ORDINARY_OFFLINE_SELECTED_SCHEMA&&ordinaryWeatherRawHeadDigest(db,worldId,valid.terms.headRevision)!==valid.terms.rawHeadDigest)return false;
 const payload=JSON.stringify(valid);
 if(Buffer.byteLength(payload)>MAX_BYTES)return false;
 if(!table(db))db.exec(DDL);
 const count=db.prepare(`SELECT COUNT(*) AS total FROM ${TABLE}`).get()?.total;
 if(!int(count,0)||count>=MAX_ROWS)return false;
 db.prepare(`INSERT INTO ${TABLE} VALUES (?,?,?)`).run(entry.entryId,worldId,payload);
 return true;
}

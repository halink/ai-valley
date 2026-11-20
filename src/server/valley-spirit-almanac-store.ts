import {appendOrdinaryWeatherWithdrawal,readOrdinaryWeatherWithdrawals,ordinaryWeatherWithdrawalTerms,encodeOrdinaryWeatherWithdrawal,type OrdinaryWeatherWithdrawalReason} from './valley-spirit-ordinary-weather-withdrawal.js';
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {ALMANAC_ENTRY_SCHEMA,REVIEWED_OFFLINE_ORIGIN,validateValleySpiritAlmanacEntries,type ValleySpiritAlmanacEntry,type ValleySpiritAlmanacStore} from './valley-spirit-almanac.js';
import {ORDINARY_OFFLINE_CORRECTION_SCHEMA,appendOrdinaryWeatherReceipt,ordinaryReviewSaveScope,ordinaryReviewDigest,readExactOrdinaryWeatherReceipt,readOrdinaryWeatherReceipts,
 type OrdinaryWeatherReviewReceipt} from './valley-spirit-ordinary-weather-receipt.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import type {PublicWeatherEntry} from './valley-spirit.js';

const reviewed=(rows:readonly ValleySpiritAlmanacEntry[])=>rows.filter(e=>e.origin.kind===REVIEWED_OFFLINE_ORIGIN);
const TABLE='valley_spirit_almanac';
const CAP=16*1024*1024;
// Deliberately unsupported by older readers: never expose pre-withdrawal text.
const WITHDRAWAL_ARCHIVE_SCHEMA=4;
const COLUMNS=[
 ['world_id','TEXT',1],['schema_version','INTEGER',0],['state_json','TEXT',0],
] as const;
const tables=(db:DatabaseSync,worldId:string)=>{
 const t=db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(TABLE);
 if(!t)return {text:null,hasWithdrawal:false};
 const columns=db.prepare('PRAGMA table_info(valley_spirit_almanac)').all();
 if(t.type!=='table'||columns.length!==COLUMNS.length||columns.some((c,i)=>c.name!==COLUMNS[i][0]||c.type!==COLUMNS[i][1]||c.pk!==COLUMNS[i][2]||c.notnull!==1))throw Error('invalid_almanac_schema');
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))throw Error('invalid_almanac_trigger');
 const result=db.prepare('SELECT world_id,schema_version,CASE WHEN length(CAST(state_json AS BLOB)) <= ? THEN state_json ELSE NULL END AS state_json FROM valley_spirit_almanac LIMIT 2').all(CAP);
 if(result.length>1||result.some(r=>r.world_id!==worldId||r.schema_version!==ALMANAC_ENTRY_SCHEMA&&r.schema_version!==WITHDRAWAL_ARCHIVE_SCHEMA||typeof r.state_json!=='string'))throw Error('invalid_almanac_state');
 return {text:result[0]?.state_json as string|undefined??null,hasWithdrawal:result[0]?.schema_version===WITHDRAWAL_ARCHIVE_SCHEMA};
};
function validated(text:string|null,worldId:string):ValleySpiritAlmanacEntry[]{
 const rows:unknown=text===null?[]:JSON.parse(text);
 if(!validateValleySpiritAlmanacEntries(rows)||!rows.every(e=>e.packet.worldId===worldId))throw Error('invalid_almanac_state');
 return rows;
}
/** Internal query; caller owns connection and snapshot lifetime. */
function readState(db:DatabaseSync,worldId:string,scope?:string){
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('worlds','valley_spirit_almanac','valley_spirit_ordinary_weather_review') OR lower(tbl_name) IN ('worlds','valley_spirit_almanac','valley_spirit_ordinary_weather_review')").get())
  throw Error('invalid_almanac_temp_schema');
 const {text,hasWithdrawal}=tables(db,worldId);
 let source=text,anchor:string|undefined;
 if(hasWithdrawal){
  const saved=JSON.parse(text!);
  if(!saved||Object.keys(saved).length!==2||!Array.isArray(saved.entries)||typeof saved.withdrawalDigest!=='string'||
   !/^[a-f0-9]{64}$/u.test(saved.withdrawalDigest))throw Error('invalid_almanac_withdrawal_anchor');
  source=JSON.stringify(saved.entries);anchor=saved.withdrawalDigest;
 }
 const rows=validated(source,worldId);
 const publications=readOrdinaryWeatherReceipts(db,worldId,reviewed(rows),scope);
 const revision=db.prepare('SELECT revision FROM main.worlds WHERE id=?').get(worldId)?.revision;
 const withdrawals=readOrdinaryWeatherWithdrawals(db,hasWithdrawal,revision,publications);
 if(hasWithdrawal&&ordinaryReviewDigest(withdrawals)!==anchor)throw Error('invalid_almanac_withdrawal_anchor');
 const state={rows,publications,withdrawals,revision};
 for(const e of reviewed(rows)){
  if(e.textVersion!==2)continue;
  const t=publications.get(e.entryId)!.terms;
  const parent=correctionPredecessor(state,e.supersedes!,t.reviewerFingerprint);
  if(t.schema!==ORDINARY_OFFLINE_CORRECTION_SCHEMA||!parent||t.headRevision<parent.minimumRevision||
   t.predecessorDigest!==parent.predecessorDigest||t.predecessorReceiptDigest!==parent.predecessorReceiptDigest||
   t.predecessorWithdrawalDigest!==parent.predecessorWithdrawalDigest)
   throw Error('invalid_ordinary_weather_correction_custody');
 }
 return state;
}
function correctionPredecessor(state:Pick<ReturnType<typeof readState>,'rows'|'publications'|'withdrawals'>,entryId:string,reviewerFingerprint:string){
 const prior=state.rows.find(e=>e.entryId===entryId);
 const receipt=state.publications.get(entryId);
 const withdrawal=state.withdrawals.find(w=>w.terms.entryId===entryId);
 if(!prior||prior.textVersion!==1||!receipt||receipt.terms.reviewerFingerprint!==reviewerFingerprint||
  withdrawal?.terms.reason!=='source-correction')return null;
 return {prior,minimumRevision:withdrawal.terms.headRevision,predecessorDigest:ordinaryReviewDigest(prior),
  predecessorReceiptDigest:ordinaryReviewDigest(receipt),predecessorWithdrawalDigest:ordinaryReviewDigest(withdrawal)};
}
export function readOrdinaryWeatherCorrectionBasis(db:DatabaseSync,worldId:string,scope:string,entryId:string,reviewerFingerprint:string){
 const state=readState(db,worldId,scope);
 const parent=correctionPredecessor(state,entryId,reviewerFingerprint);
 if(!parent||state.rows.some(e=>e.supersedes===entryId))return null;
 return {...parent,before:state.rows};
}
function visible(state:ReturnType<typeof readState>){
 const withdrawn=new Set(state.withdrawals.map(r=>r.terms.entryId));
 return state.rows.filter(e=>!withdrawn.has(e.entryId));
}
export function readValleySpiritAlmanacSnapshot(db:DatabaseSync,worldId:string,scope?:string):ValleySpiritAlmanacEntry[]{
 return visible(readState(db,worldId,scope));
}
/** Internal owning writer snapshot, never for presentation. */
export function readValleySpiritAlmanacReviewBasis(db:DatabaseSync,worldId:string,scope:string):ValleySpiritAlmanacEntry[]{
 return readState(db,worldId,scope).rows;
}
export function readOrdinaryWeatherWithdrawalBasis(db:DatabaseSync,worldId:string,scope:string,entryId:string,reason:OrdinaryWeatherWithdrawalReason,reviewerFingerprint?:string){
 const state=readState(db,worldId,scope),publication=state.publications.get(entryId);
 const headRevision=state.revision;
 if(!publication||reviewerFingerprint!==undefined&&publication.terms.reviewerFingerprint!==reviewerFingerprint||typeof headRevision!=='number'||!Number.isSafeInteger(headRevision)||
  state.withdrawals.some(r=>r.terms.entryId===entryId))return null;
 const terms=ordinaryWeatherWithdrawalTerms(worldId,scope,entryId,headRevision,publication,ordinaryReviewDigest(state.rows),ordinaryReviewDigest(state.withdrawals),reason);
 return encodeOrdinaryWeatherWithdrawal(terms)?terms:null;
}
/** Preflight copies have a different file identity. Validate signed structural
 * integrity here; the actual reader enforces the original save identity. */
export function inspectValleySpiritAlmanac(db:DatabaseSync,worldId:string):void {
 readValleySpiritAlmanacSnapshot(db,worldId);
}
/** Runtime viewer owns a physically read-only SQLite connection. */
export class SqliteValleySpiritAlmanacReader {
 private readonly db:DatabaseSync;
 private readonly scope:string;
 private publicationState:ReturnType<typeof readState>|undefined;
 constructor(private readonly database:string,private readonly worldId:string,private readonly assertOwned:()=>void){
  assertOwned();this.scope=ordinaryReviewSaveScope(database,worldId);this.db=new DatabaseSync(database,{readOnly:true});
  try{this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');this.read();}catch(e){this.db.close();throw e;}
 }
 private snapshot<T>(read:()=>T):T {
  this.assertOwned();
  if(ordinaryReviewSaveScope(this.database,this.worldId)!==this.scope)throw Error('ordinary_weather_review_save_changed');
  this.db.exec('BEGIN');
  try{const result=read();this.assertOwned();this.db.exec('COMMIT');return result;}
  catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 /** V4 validates its bounded signed archive once for a synchronous
  * public operation. Do not keep a reusable cache outside the read txn. */
 withPublicationSnapshot<T>(read:()=>T):T {
  if(this.publicationState)return read();
  this.assertOwned();
  const exists=this.db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='valley_spirit_almanac'").get();
  const schema=exists?this.db.prepare('SELECT schema_version FROM main.valley_spirit_almanac WHERE world_id=?').get(this.worldId)?.schema_version:null;
  if(schema!==WITHDRAWAL_ARCHIVE_SCHEMA)return read();
  return this.snapshot(()=>{
   this.publicationState=readState(this.db,this.worldId,this.scope);
   try{return read();}finally{this.publicationState=undefined;}
  });
 }
 read():ValleySpiritAlmanacEntry[]{
  return this.publicationState?structuredClone(visible(this.publicationState)):
   this.snapshot(()=>readValleySpiritAlmanacSnapshot(this.db,this.worldId,this.scope));
 }
 /** For the owned presentation adapter only: keep history for chain validation,
  * but visibility still requires matchesReviewedSources in this same snapshot. */
 readHistoryForPresentation():ValleySpiritAlmanacEntry[]{
  return this.publicationState?structuredClone(this.publicationState.rows):this.read();
 }
 matchesReviewedSources(entry:ValleySpiritAlmanacEntry,records:readonly PublicWeatherEntry[]):boolean {
  const matches=(state:ReturnType<typeof readState>)=>
   visible(state).some(r=>r.entryId===entry.entryId&&ordinaryReviewDigest(r)===ordinaryReviewDigest(entry))&&
   state.publications.get(entry.entryId)?.terms.selectedSourcesDigest===ordinaryReviewDigest(records);
  if(entry.origin.kind!==REVIEWED_OFFLINE_ORIGIN)return false;
  if(this.publicationState)return matches(this.publicationState);
  try{return this.snapshot(()=>{
   const schema=this.db.prepare('SELECT schema_version FROM main.valley_spirit_almanac WHERE world_id=?').get(this.worldId)?.schema_version;
   if(schema===WITHDRAWAL_ARCHIVE_SCHEMA)return matches(readState(this.db,this.worldId,this.scope));
   if(schema!==ALMANAC_ENTRY_SCHEMA)return false;
   // A metadata rollback must not turn a cached withdrawn entry into an
   // ordinary v3 point check. No extra catalog signature scan on v3.
   readOrdinaryWeatherWithdrawals(this.db,false,undefined,new Map());
   const proof=readExactOrdinaryWeatherReceipt(this.db,this.worldId,entry,this.scope);
   return !!proof&&proof.terms.selectedSourcesDigest===ordinaryReviewDigest(records);
  });}catch{return false;}
 }
 close(){this.db.close();}
}
/** Read-only optional-module preflight on a previously validated world DB.
 * A bad almanac is isolated by the caller; never repair/overwrite it here.
 * Callers own the same actor-independent runtime lease as the world writer. */
export function preflightValleySpiritAlmanac(database:string,worldId:string,assertOwned:()=>void):void {
 assertOwned();
 const file=lstatSync(database);
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)throw Error('unsafe_almanac_database');
 const db=new DatabaseSync(database,{readOnly:true});
 try{db.exec('PRAGMA trusted_schema=OFF');readValleySpiritAlmanacSnapshot(db,worldId,ordinaryReviewSaveScope(database,worldId));}finally{db.close();}
}
export class SqliteValleySpiritAlmanacStore implements ValleySpiritAlmanacStore {
 private readonly db:DatabaseSync;
 constructor(private readonly database:string,private readonly worldId:string,private readonly assertOwned:()=>void){
  preflightValleySpiritAlmanac(database,worldId,assertOwned);
  assertOwned();this.db=new DatabaseSync(database);
  try{this.db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL');}catch(e){this.db.close();throw e;}
 }
 read():ValleySpiritAlmanacEntry[]{
  this.assertOwned();return readValleySpiritAlmanacReviewBasis(this.db,this.worldId,ordinaryReviewSaveScope(this.database,this.worldId));
 }
 replace(previous:readonly ValleySpiritAlmanacEntry[],next:readonly ValleySpiritAlmanacEntry[]):boolean {
  if(ordinaryReviewDigest(reviewed(previous))!==ordinaryReviewDigest(reviewed(next)))return false;
  return this.compareAndReplace(previous,next);
 }
 recordOrdinaryReview(previous:readonly ValleySpiritAlmanacEntry[],entry:ValleySpiritAlmanacEntry,proof:OrdinaryWeatherReviewReceipt):boolean {
  if(entry.origin.kind!==REVIEWED_OFFLINE_ORIGIN)return false;
  return this.compareAndReplace(previous,[...previous,entry],proof);
 }
 recordOrdinaryWithdrawal(entryId:string,reason:OrdinaryWeatherWithdrawalReason,approval:unknown):boolean {
  this.assertOwned();
  const scope=ordinaryReviewSaveScope(this.database,this.worldId);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const state=readState(this.db,this.worldId,scope),existing=state.withdrawals.find(r=>r.terms.entryId===entryId);
   if(existing){this.db.exec('COMMIT');return JSON.stringify(existing)===JSON.stringify(approval)&&existing.terms.reason===reason;}
   const p=state.publications.get(entryId),expected=readOrdinaryWeatherWithdrawalBasis(this.db,this.worldId,scope,entryId,reason);
   if(!p||!expected||!approval||typeof approval!=='object'||!('terms' in approval)||
    !encodeOrdinaryWeatherWithdrawal(expected)?.equals(encodeOrdinaryWeatherWithdrawal(approval.terms)??Buffer.alloc(0))||
    !appendOrdinaryWeatherWithdrawal(this.db,approval,p,state.revision)){
    this.db.exec('ROLLBACK');return false;
   }
   const body=JSON.stringify({entries:state.rows,withdrawalDigest:ordinaryReviewDigest([...state.withdrawals,approval])});
   if(Buffer.byteLength(body)>CAP)throw Error('ordinary_weather_withdrawal_bound');
   if(this.db.prepare('UPDATE main.valley_spirit_almanac SET schema_version=?,state_json=? WHERE world_id=? AND schema_version IN (?,?)')
    .run(WITHDRAWAL_ARCHIVE_SCHEMA,body,this.worldId,ALMANAC_ENTRY_SCHEMA,WITHDRAWAL_ARCHIVE_SCHEMA).changes!==1)throw Error('ordinary_weather_withdrawal_marker');
   readState(this.db,this.worldId,scope);this.assertOwned();this.db.exec('COMMIT');return true;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 private compareAndReplace(previous:readonly ValleySpiritAlmanacEntry[],next:readonly ValleySpiritAlmanacEntry[],proof?:OrdinaryWeatherReviewReceipt):boolean {
  this.assertOwned();
  const scope=ordinaryReviewSaveScope(this.database,this.worldId);
  if(!validateValleySpiritAlmanacEntries(next)||!next.every(e=>e.packet.worldId===this.worldId))return false;
  const serialized=JSON.stringify(next);if(Buffer.byteLength(serialized)>CAP)return false;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const state=readState(this.db,this.worldId,scope),stored=state.rows;
   const bound=state.withdrawals.length?JSON.stringify({entries:next,withdrawalDigest:ordinaryReviewDigest(state.withdrawals)}):serialized;
   if(Buffer.byteLength(bound)>CAP){this.db.exec('ROLLBACK');return false;}
   if(JSON.stringify(stored)!==JSON.stringify(previous)){
    this.db.exec('ROLLBACK');return false;
   }
   if(proof){
    const grant=readValleySpiritWeatherPermission(this.db,this.worldId), e=next.at(-1)!;
    if(!grant?.publicWeather||grant.version!==proof.terms.permissionVersion||
     !appendOrdinaryWeatherReceipt(this.db,this.worldId,scope,stored,e,proof)){
     this.db.exec('ROLLBACK');return false;
    }
   }
   const tableExists=this.db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(TABLE);
   if(!tableExists)this.db.exec('CREATE TABLE valley_spirit_almanac(world_id TEXT PRIMARY KEY NOT NULL,schema_version INTEGER NOT NULL,state_json TEXT NOT NULL)');
   this.db.prepare('INSERT INTO valley_spirit_almanac VALUES (?,?,?) ON CONFLICT(world_id) DO UPDATE SET state_json=excluded.state_json').run(this.worldId,state.withdrawals.length?WITHDRAWAL_ARCHIVE_SCHEMA:ALMANAC_ENTRY_SCHEMA,bound);
   // Ensure both new rows are now coherent before exposing a successful COMMIT.
   if(proof)readValleySpiritAlmanacSnapshot(this.db,this.worldId,scope);
   this.assertOwned();this.db.exec('COMMIT');return true;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}

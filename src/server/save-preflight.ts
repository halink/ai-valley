import {readSeasonalLedger,type SeasonalLedger} from './seasonal-model-ledger.js';
import {validateSeasonalKnowledge} from '../world/mvp-seasonal-knowledge.js';
import {validateMvpPreservation} from '../world/mvp-preservation.js';
import {validateMvpClimate} from '../world/mvp-climate-state.js';
import type {World} from '../shared/types.js';
/** Read-before-write compatibility gate. No migration or model/runtime dependency.
 * The probe reads private copies so SQLite cannot create/change the source SHM.
 * Persistent callers still own the original save via their existing lifetime lock.
 */
import {DatabaseSync} from 'node:sqlite';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeSync,type BigIntStats} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export class SaveCompatibilityError extends Error {
 constructor(readonly code:string){super(code);this.name='SaveCompatibilityError';}
}
function fail(code:string):never {throw new SaveCompatibilityError(code);}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const owns=(v:object,key:string)=>Object.prototype.hasOwnProperty.call(v,key);
// Exact reserved upgrade names only. Unknown legacy extension names are not
// guessed from prefixes/regex. These modules have no writable format yet.
const unsupportedUpgradeFields=['worldUpgrade'] as const;
const MAX_STATE_BYTES=256*1024*1024;

/** Validate only the compatibility envelope, not every game's domain rule. */
export function assertWorldCompatibility(value:unknown):asserts value is Record<string,unknown> {
 if(!record(value))fail('save_invalid_world');
 // Reject presence, not a recognized version/truthy value. No upgrade escape.
 if(owns(value,'simulationOnly'))fail('save_simulation_only');
 if(owns(value,'mvpSeasonalModelVersion')&&(value.mvpSeasonalModelVersion!==1||value.mode!=='validation'))fail('save_seasonal_model_schema');
 try{validateSeasonalKnowledge(value as unknown as World);}catch{fail('save_invalid_mvpSeasonalKnowledge');}
 // Version 2 is exclusively the offline seasonal ledger format. Old
 // binaries reject it before their schema-1 rule writer can touch the file.
 if(value.schemaVersion===2){
  if(value.mode!=='validation'||value.mvpSeasonalModelVersion!==1)fail('save_seasonal_model_schema');
 }else if(value.schemaVersion!==1)fail('save_unsupported_world_schema');
 else if(owns(value,'mvpSeasonalModelVersion'))fail('save_seasonal_model_schema');
 try{validateMvpPreservation(value as unknown as World);}catch{fail('save_invalid_mvpPreservation');}
 if(owns(value,'mvpClimate')||owns(value,'mvpSoil')||owns(value,'mvpAgriculture')){try{validateMvpClimate(value as unknown as World);}catch{fail('save_invalid_mvpClimate');}}
 for(const field of unsupportedUpgradeFields)if(owns(value,field))fail('save_unsupported_'+field);
 if(typeof value.id!=='string'||!value.id||!Number.isSafeInteger(value.revision)||Number(value.revision)<0
  ||(value.mode!=='formal'&&value.mode!=='validation'))fail('save_invalid_world_identity');
 if(owns(value,'ledgerVersion')&&value.ledgerVersion!==1)fail('save_unsupported_ledger_version');
 const landscape=owns(value,'terrainKey');
 if(landscape){
  if(value.mode!=='formal'||typeof value.terrainKey!=='string'||!value.terrainKey
   ||!Number.isSafeInteger(value.resourceCount)||Number(value.resourceCount)<0||!Array.isArray(value.resourceChanges))
   fail('save_invalid_landscape_envelope');
  const indexes=new Set<number>();
  for(const entry of value.resourceChanges){
   if(!Array.isArray(entry)||entry.length!==2||!Number.isSafeInteger(entry[0])||entry[0]<0
    ||entry[0]>=Number(value.resourceCount)||indexes.has(entry[0])||!record(entry[1]))fail('save_invalid_resource_changes');
   indexes.add(entry[0]);
  }
 }else{
  if(owns(value,'ledgerVersion'))fail('save_ledger_without_landscape');
  if(!record(value.map)||!Array.isArray(value.resources))fail('save_invalid_inline_landscape');
 }
 // Historical landscape snapshots before separate-ledger v1 still carry both
 // arrays inline. Preserve them rather than assuming missing means empty.
 if(!owns(value,'ledgerVersion')&&(!Array.isArray(value.events)||!Array.isArray(value.processed)))
  fail('save_missing_inline_ledger');
}
export function decodeSavedWorld(body:unknown):Record<string,unknown> {
 let value:unknown;
 try{
  const json=typeof body==='string'?body:body instanceof Uint8Array?gunzipSync(body,{maxOutputLength:MAX_STATE_BYTES}).toString():fail('save_invalid_state_encoding');
  if(Buffer.byteLength(json)>MAX_STATE_BYTES)fail('save_state_too_large');
  value=JSON.parse(json);
 }catch(error){if(error instanceof SaveCompatibilityError)throw error;fail('save_invalid_state_encoding');}
 assertWorldCompatibility(value);return value;
}
function jsonBlob(body:unknown):unknown {
 if(!(body instanceof Uint8Array))fail('save_invalid_landscape_encoding');
 try{return JSON.parse(gunzipSync(body,{maxOutputLength:MAX_STATE_BYTES}).toString());}
 catch{fail('save_invalid_landscape_encoding');}
}
function inspectDatabase(db:DatabaseSync,rejectClimate:boolean,validateWorld?: (world:Record<string,unknown>)=>void,allowSeasonalModel=false,inspectSeasonalModel?:(s:SeasonalLedger|null)=>void):Record<string,unknown>|null {
 const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worlds'").get();
 if(!table)fail('save_missing_worlds_table');
 let latest:Record<string,unknown>|null=null;
 for(const row of db.prepare('SELECT id,revision,length(CAST(state AS BLOB)) AS stateBytes, CASE WHEN length(CAST(state AS BLOB))<=? THEN state ELSE NULL END AS state FROM worlds ORDER BY rowid').iterate(MAX_STATE_BYTES)){
  if(typeof row.stateBytes!=='number'||row.stateBytes>MAX_STATE_BYTES)fail('save_state_too_large');
  const world=decodeSavedWorld(row.state);
  if(!allowSeasonalModel&&world.schemaVersion===2)fail('save_seasonal_model_requires_explicit_entry');
  if(rejectClimate&&owns(world,'mvpClimate'))fail('save_mvpClimate_requires_opt_in');
  validateWorld?.(world);
  if(world.id!==row.id||world.revision!==row.revision)fail('save_world_identity_mismatch');
  if(owns(world,'terrainKey')){
   const terrain=db.prepare('SELECT body FROM terrain WHERE hash=?').get(world.terrainKey as string);
   const base=db.prepare('SELECT body FROM resource_bases WHERE world_id=?').get(world.id as string);
   if(!terrain||!base)fail('save_missing_landscape');
   const map=jsonBlob(terrain.body),resources=jsonBlob(base.body);
   if(!record(map)||!Array.isArray(map.tiles)||!Array.isArray(resources))fail('save_invalid_landscape');
   if(createHash('sha256').update(JSON.stringify(map)).digest('hex')!==world.terrainKey)fail('saved_terrain_checksum_mismatch');
   const count=Number(world.resourceCount),changes=new Set((world.resourceChanges as unknown[][]).map(e=>e[0]));
   // A grown resource list may exceed the immutable base, but every added index
   // must have a persisted change. Otherwise readWorld would create holes.
   if(count>resources.length&&[...changes].filter(i=>Number(i)>=resources.length).length!==count-resources.length)
    fail('save_missing_resource_change');
   if(world.ledgerVersion===1){
    db.prepare('SELECT id,world_id,at,body FROM events LIMIT 0').all();
    db.prepare('SELECT world_id,receipt FROM receipts LIMIT 0').all();
   }
  }
  latest=world;
 }
 if(!allowSeasonalModel&&latest?.mvpSeasonalModelVersion!==undefined)fail('save_seasonal_model_requires_explicit_entry');
 const seasonal=readSeasonalLedger(db,latest as unknown as World|null,allowSeasonalModel);
 if(!!seasonal!==(latest?.mvpSeasonalModelVersion===1))fail('save_seasonal_model_ledger_missing');
 if(allowSeasonalModel)inspectSeasonalModel?.(seasonal);
 return latest;
}
interface SourceFile {suffix:string;fd:number;stat:BigIntStats}
function same(a:BigIntStats,b:BigIntStats):boolean {
 return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
function sourceFile(path:string,suffix:string):SourceFile|null {
 let fd:number;
 try{fd=openSync(path+suffix,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;fail('save_source_unreadable');}
 try{
  const stat=fstatSync(fd,{bigint:true});
  if(!stat.isFile()||stat.nlink!==1n)fail('save_unsafe_source');
  if(stat.size>BigInt(Number.MAX_SAFE_INTEGER))fail('save_source_too_large');
  return {suffix,fd,stat};
 }catch(error){closeSync(fd);throw error;}
}
function copySource(file:SourceFile,destination:string,buffer:Buffer):void {
 const out=openSync(destination,'wx',0o600);
 try{
  let position=0;const size=Number(file.stat.size);
  while(position<size){
   const count=readSync(file.fd,buffer,0,Math.min(buffer.length,size-position),position);
   if(count===0)fail('save_source_changed');
   let written=0;
   while(written<count){const n=writeSync(out,buffer,written,count-written);if(n===0)fail('save_copy_failed');written+=n;}
   position+=count;
  }
  if(!same(file.stat,fstatSync(file.fd,{bigint:true})))fail('save_source_changed');
 }finally{closeSync(out);}
}

function unchanged(path:string,files:ReadonlyArray<SourceFile|null>,suffixes:readonly string[]):void {
 for(let i=0;i<suffixes.length;i++){
  let current:BigIntStats|undefined;
  try{current=lstatSync(path+suffixes[i],{bigint:true});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('save_source_unreadable');}
  if(files[i]?(!current||!same(files[i]!.stat,current)):current!==undefined)fail('save_source_changed');
 }
}

/** No source SQLite connection, immutable shortcut, repair, schema write or
 * checkpoint. WAL is copied alongside the DB and SQLite reads its latest state.
 * This is not a substitute for caller-held ownership against concurrent writers.
 */
export function preflightWorldSave(path:string,options:{requireWorld?:boolean;rejectClimate?:boolean;allowSeasonalModel?:boolean;inspectSeasonalModel?:(s:SeasonalLedger|null)=>void;validateWorld?:(world:Record<string,unknown>)=>void}={}):Record<string,unknown>|null {
 if(path===':memory:')return null;
 const suffixes=['','-wal','-journal'] as const;
 const files:Array<SourceFile|null>=[];
 let directory:string|undefined,db:DatabaseSync|undefined;
 try{
  for(const suffix of suffixes)files.push(sourceFile(path,suffix));
  unchanged(path,files,suffixes);
  const main=files[0];
  if(!main||main.stat.size===0n){
   if(files.slice(1).some(file=>file&&file.stat.size>0n))fail('save_orphaned_journal');
   return null;
  }
  directory=mkdtempSync(join(tmpdir(),'ai-valley-preflight-'));
  const copy=join(directory,'world.sqlite'),buffer=Buffer.allocUnsafe(64*1024);
  for(const file of files)if(file)copySource(file,copy+file.suffix,buffer);
  unchanged(path,files,suffixes);
  // readOnly may create SHM on this PRIVATE copy, never on the user's save.
  db=new DatabaseSync(copy,{readOnly:true});
  const result=inspectDatabase(db,options.rejectClimate===true,options.validateWorld,options.allowSeasonalModel===true,options.inspectSeasonalModel);
  if(!result&&options.requireWorld)fail('save_missing_world');
  unchanged(path,files,suffixes);
  return result;
 }catch(error){if(error instanceof SaveCompatibilityError)throw error;throw new SaveCompatibilityError('save_preflight_failed');}
 finally{
  let cleanupFailed=false;
  try{db?.close();}catch{cleanupFailed=true;}
  for(const file of files)if(file){try{closeSync(file.fd);}catch{cleanupFailed=true;}}
  if(directory){try{rmSync(directory,{recursive:true,force:true});}catch{cleanupFailed=true;}}
  // Do not expose underlying filesystem paths or continue to writable startup
  // after uncertain cleanup of a private copy containing save data.
  if(cleanupFailed)fail('save_preflight_cleanup_failed');
 }
}

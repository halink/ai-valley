/** Versioned storage deny marker, never an engine World. This authority is issued
 * only by the internal disposable runtime for its freshly created temporary
 * file; it is not configuration and cannot be reconstructed after process exit. */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {closeSync,constants,fstatSync,lstatSync,mkdtempSync,openSync,readdirSync,realpathSync,rmdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';

const purpose='disposable-native-rules/v1';
export type DisposableRulesSaveAuthority=Readonly<{readonly disposableRulesSave: unique symbol}>;
type Details=Readonly<{path:string;assertOwned:()=>void;key:Buffer}>;
const leases=new WeakMap<DisposableRulesSaveAuthority,Details>();

const disposablePrefix='valley-disposable-native-';
const disposableFilename='rules.sqlite';
export function isDisposableRulesScratchPath(path:string):boolean{
 const parent=dirname(resolve(path));
 return basename(path)===disposableFilename&&basename(parent).startsWith(disposablePrefix)&&
  dirname(parent)===realpathSync(tmpdir());
}
function disposableIdentity(path:string,directory=false){
 const info=lstatSync(path,{bigint:true});
 if((directory?!info.isDirectory():!info.isFile()||info.nlink!==1n)||
  info.uid!==BigInt(process.getuid!())||(info.mode&0o777n)!==(directory?0o700n:0o600n))
  throw Error('disposable_native_rules_identity');
 return info.dev+':'+info.ino;
}
/** No pathname, caller predicate or external capability can mint this authority. */
export function createFreshDisposableRulesStorage(){
 const directory=mkdtempSync(join(realpathSync(tmpdir()),disposablePrefix)),database=join(directory,disposableFilename);
 const fresh=lstatSync(directory,{bigint:true}),directoryId=fresh.dev+':'+fresh.ino;
 let fd:number|undefined,databaseId:string|undefined;
 try{
  if(disposableIdentity(directory,true)!==directoryId)throw Error('disposable_native_rules_identity');
  fd=openSync(database,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const info=fstatSync(fd,{bigint:true});databaseId=info.dev+':'+info.ino;
  closeSync(fd);fd=undefined;
  if(disposableIdentity(database)!==databaseId)throw Error('disposable_native_rules_identity');
 }catch(error){
  if(fd!==undefined)try{closeSync(fd);}catch{/* Keep the original startup error. */}
  try{
   const current=lstatSync(directory,{bigint:true});
   if(current.isDirectory()&&current.dev+':'+current.ino===directoryId){
    if(databaseId){
     const file=lstatSync(database,{bigint:true});
     if(file.isFile()&&file.nlink===1n&&file.dev+':'+file.ino===databaseId)unlinkSync(database);
    }
    rmdirSync(directory);
   }
  }catch{/* Unexpected entries are left untouched. */}
  throw error;
 }
 let disposed=false;
 const assertDisposable=()=>{
  if(disposed||disposableIdentity(directory,true)!==directoryId||disposableIdentity(database)!==databaseId)
   throw Error('disposable_native_rules_identity');
 };
 const bind=createBinder(database,assertDisposable);
 return Object.freeze({database,assertOwned:assertDisposable,bind,dispose(){
   assertDisposable();
   // The native owner deliberately leaves its lease file behind. Do not
   // reclaim it or any unexpected entry here; never recursively remove a save.
   const entries=readdirSync(directory);
   if(entries.length!==1||entries[0]!==disposableFilename){disposed=true;return false;}
   assertDisposable();unlinkSync(database);disposed=true;rmdirSync(directory);return true;
 }});
}
function createBinder(originalPath:string,assertOriginal:()=>void){
 const key=randomBytes(32);
 return (owner:RuntimeOwnership):DisposableRulesSaveAuthority=>{
  const anchor=runtimeOwnershipAnchor(owner);
  if(!anchor||realpathSync(anchor.database)!==originalPath)throw Error('disposable_native_rules_owner');
  const assertOwned=()=>{anchor.assertOwned();assertOriginal();};
  assertOwned();
  const capability=Object.freeze({}) as DisposableRulesSaveAuthority;
  leases.set(capability,{path:anchor.database,assertOwned,key});
  return capability;
 };
}
function requireLease(authority:DisposableRulesSaveAuthority):Details{
 const lease=leases.get(authority);if(!lease)throw Error('disposable_native_rules_owner');
 lease.assertOwned();return lease;
}
export function assertDisposableRulesSavePath(authority:DisposableRulesSaveAuthority,path:string):void{
 if(requireLease(authority).path!==path)throw Error('disposable_native_rules_owner');
}
const table='mvp_spirit_developer_fixture';
const ddl="CREATE TABLE mvp_spirit_developer_fixture (version INTEGER NOT NULL CHECK(version=2), purpose TEXT NOT NULL CHECK(purpose='disposable-native-rules/v1'), world_id TEXT NOT NULL, seal TEXT NOT NULL)";
const worldIdPattern=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/;
export function readDisposableRulesSaveMarker(db:DatabaseSync,authority:DisposableRulesSaveAuthority):string{
 const {key}=requireLease(authority);
 const shape=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)=?").get(table);
 if(shape?.name!==table||shape.type!=='table'||shape.sql!==ddl||
  db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='trigger' AND lower(tbl_name)=?").get(table))
  throw Error('save_disposable_rules_marker');
 const rows=db.prepare(`SELECT version,purpose,world_id,CASE WHEN length(seal)=64 THEN seal END AS seal FROM main.${table} LIMIT 2`).all();
 const row=rows[0];
 if(rows.length!==1||row.version!==2||row.purpose!==purpose||typeof row.world_id!=='string'||!worldIdPattern.test(row.world_id)||
  typeof row.seal!=='string'||!/^[0-9a-f]{64}$/.test(row.seal)||
  !timingSafeEqual(Buffer.from(row.seal,'hex'),mac(key,row.world_id)))
  throw Error('save_disposable_rules_marker');
 return row.world_id;
}
const mac=(key:Buffer,id:string)=>createHmac('sha256',key).update(purpose+'\0').update(id).digest();
/** First real ordinary world write and this immutable burn-in share one CAS/COMMIT. */
export function guardDisposableRulesSaveCommit(db:DatabaseSync,authority:DisposableRulesSaveAuthority,id:string,initial:boolean):void{
 const {key,path}=requireLease(authority);
 const main=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
 if(typeof main!=='string'||!main||realpathSync(main)!==realpathSync(path))throw Error('disposable_native_rules_owner');
 if(!db.isTransaction||!worldIdPattern.test(id))throw Error('save_disposable_rules_scope');
 if(initial){
  if(db.prepare("SELECT id FROM main.worlds LIMIT 1").get())throw Error('save_disposable_rules_world');
  db.exec(ddl);
  db.prepare(`INSERT INTO main.${table} VALUES (2,?,?,?)`).run(purpose,id,mac(key,id).toString('hex'));
 }
 if(readDisposableRulesSaveMarker(db,authority)!==id)throw Error('save_disposable_rules_world');
}

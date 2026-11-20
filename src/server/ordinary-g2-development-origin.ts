/** Private fresh-origin seal for future ordinary-rule G2 development
 * custody. Not an effect, writer approval, production trust root or save import. */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,mkdtempSync,openSync,realpathSync,rmdirSync,unlinkSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import type {DatabaseSync} from 'node:sqlite';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';

const PURPOSE='ordinary-g2-v3-development-origin/v1',PREFIX='valley-ordinary-g2-origin-',FILENAME='rules.sqlite';
const TABLE='valley_spirit_ordinary_g2_dev_origin';
const RESERVED=[TABLE,'valley_spirit_ordinary_g2_dev_ground_v3','valley_spirit_ordinary_g2_dev_receipt_v3'];
const DDL="CREATE TABLE valley_spirit_ordinary_g2_dev_origin (version INTEGER NOT NULL CHECK(version=1), purpose TEXT NOT NULL CHECK(purpose='ordinary-g2-v3-development-origin/v1'), world_id TEXT NOT NULL, seal TEXT NOT NULL)";
const worldPattern=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/;
export type OrdinaryG2DevelopmentOrigin=Readonly<{readonly ordinaryG2DevelopmentOrigin:unique symbol}>;
type Lease=Readonly<{database:string;assertOriginal:()=>void;sealFor:(world:string)=>Buffer;auth:(domain:string,body:string)=>string}>;
const leases=new WeakMap<OrdinaryG2DevelopmentOrigin,Lease>();
const storageOwners=new WeakSet<object>();
export function ownsOrdinaryG2DevelopmentStorage(storage:unknown){return !!storage&&typeof storage==='object'&&storageOwners.has(storage);}

export function isOrdinaryG2DevelopmentOriginScratch(path:string){
 let full=resolve(path);
 try{full=realpathSync(full);}catch{/* An absent reserved name still fails closed. */}
 const parent=dirname(full);
 return basename(full)===FILENAME&&basename(parent).startsWith(PREFIX)&&dirname(parent)===realpathSync(tmpdir());
}
function identity(path:string,directory=false){
 const s=lstatSync(path,{bigint:true});
 if((directory?!s.isDirectory():!s.isFile()||s.nlink!==1n)||s.uid!==BigInt(process.getuid!())||
   (s.mode&0o777n)!==(directory?0o700n:0o600n))throw Error('ordinary_g2_development_identity');
 return s.dev+':'+s.ino;
}
/** Only the factory can create this new private file; it never takes a path.
 * The process-generated HMAC secret stays private and dies with this closure. */
export function createFreshOrdinaryG2DevelopmentOriginStorage(){
 const directory=mkdtempSync(join(realpathSync(tmpdir()),PREFIX)),database=join(directory,FILENAME);
 const dirId=identity(directory,true);
 let fd:number|undefined,fileId:string|undefined;
 try{
  fd=openSync(database,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  const opened=fstatSync(fd,{bigint:true});fileId=opened.dev+':'+opened.ino;
  closeSync(fd);fd=undefined;
  if(identity(database)!==fileId)throw Error('ordinary_g2_development_identity');
 }catch(e){
  if(fd!==undefined)try{closeSync(fd);}catch{/* Keep original error. */}
  try{if(identity(directory,true)===dirId){if(fileId&&identity(database)===fileId)unlinkSync(database);rmdirSync(directory);}}catch{/* Leave unexpected paths alone. */}
  throw e;
 }
 const key=randomBytes(32);
 const assertOriginal=()=>{
  if(identity(directory,true)!==dirId||identity(database)!==fileId)throw Error('ordinary_g2_development_identity');
 };
 const storage=Object.freeze({database,assertOriginal,
  bind(owner:RuntimeOwnership){
   const a=runtimeOwnershipAnchor(owner);
   if(!a||realpathSync(a.database)!==database)throw Error('ordinary_g2_development_owner');
   const assertOwned=()=>{a.assertOwned();assertOriginal();};
   assertOwned();
   const token=Object.freeze({}) as OrdinaryG2DevelopmentOrigin;
   leases.set(token,{database,assertOriginal:assertOwned,sealFor:world=>
    createHmac('sha256',key).update(JSON.stringify([PURPOSE,dirId,fileId,world])).digest(),
    auth:(domain,body)=>createHmac('sha256',key).update(JSON.stringify([PURPOSE,dirId,fileId,domain,body])).digest('hex')});
   return token;
  },
 });
 storageOwners.add(storage);return storage;
}
function requireOrigin(origin:OrdinaryG2DevelopmentOrigin){
 const lease=leases.get(origin);
 if(!lease)throw Error('ordinary_g2_development_owner');
 lease.assertOriginal();
 return lease;
}
export function assertOrdinaryG2DevelopmentPath(origin:OrdinaryG2DevelopmentOrigin,path:string){
 if(requireOrigin(origin).database!==realpathSync(path))throw Error('ordinary_g2_development_owner');
}
/** Checks reserved table names in the actual main schema before migrations.
 * A nonempty schema version belongs to a future explicit writer, never this
 * origin-only stage. The preflight snapshot connection is intentionally a copy. */
export function inspectOrdinaryG2DevelopmentOrigin(db:DatabaseSync,origin?:OrdinaryG2DevelopmentOrigin,permitV3=false){
 const names=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name) IN (?,?,?)").all(...RESERVED);
 const dueMarker=db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(name)='valley_spirit_ordinary_g2_dev_due_v3'").get();
 const metadata=db.prepare("SELECT type FROM main.sqlite_schema WHERE name='archive_meta' COLLATE NOCASE").get();
 const retainedLatch=metadata?.type==='table'&&db.prepare('PRAGMA main.table_info(archive_meta)').all().some(c=>c.name==='key')&&
  !!db.prepare("SELECT 1 FROM main.archive_meta WHERE key IN ('ordinary_g2_development_v3_placed','ordinary_g2_development_v3_due_intent','ordinary_g2_development_v3_due_seal') LIMIT 1").get();
 if(!origin){if(names.length||retainedLatch||dueMarker)throw Error('ordinary_g2_development_requires_owner');return null;}
 const lease=requireOrigin(origin);
 const marker=names.find(n=>n.name===TABLE);
 if(!permitV3&&(retainedLatch||dueMarker))
  throw Error('ordinary_g2_development_v3_requires_pin');
 if((names.length!==1&&!(permitV3&&names.length===3))||marker?.type!=='table'||marker.sql!==DDL||
  db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(TABLE)||
  db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (?,?,?,'worlds','valley_spirit_ordinary_g2_dev_due_v3') OR lower(tbl_name) IN (?,?,?,'worlds','valley_spirit_ordinary_g2_dev_due_v3')")
   .get(...RESERVED,...RESERVED))throw Error('ordinary_g2_development_marker');
 const rows=db.prepare("SELECT version,purpose,world_id,CASE WHEN length(seal)=64 THEN seal END AS seal FROM main."+TABLE+" LIMIT 2").all();
 const r=rows[0];
 if(rows.length!==1||r.version!==1||r.purpose!==PURPOSE||typeof r.world_id!=='string'||!worldPattern.test(r.world_id)||
  typeof r.seal!=='string'||!/^[a-f0-9]{64}$/.test(r.seal)||!timingSafeEqual(Buffer.from(r.seal,'hex'),lease.sealFor(r.world_id)))
  throw Error('ordinary_g2_development_marker');
 return r.world_id;
}
export function guardOrdinaryG2DevelopmentOriginCommit(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,id:string,initial:boolean,permitV3=false){
 const lease=requireOrigin(origin),main=db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
 if(!db.isTransaction||typeof main!=='string'||realpathSync(main)!==lease.database||!worldPattern.test(id))
  throw Error('ordinary_g2_development_owner');
 if(initial){
  if(db.prepare('SELECT id FROM main.worlds LIMIT 1').get())throw Error('ordinary_g2_development_existing_world');
  inspectOrdinaryG2DevelopmentOrigin(db);
  db.exec(DDL);
  db.prepare('INSERT INTO main.'+TABLE+' VALUES (1,?,?,?)').run(PURPOSE,id,lease.sealFor(id).toString('hex'));
 }
 if(inspectOrdinaryG2DevelopmentOrigin(db,origin,permitV3&&!initial)!==id)throw Error('ordinary_g2_development_world');
}

export function authenticateOrdinaryG2DevelopmentV3(origin:OrdinaryG2DevelopmentOrigin,domain:string,body:string){
 return requireOrigin(origin).auth(domain,body);
}

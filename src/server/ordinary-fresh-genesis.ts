/** Inert genesis creation for a specially reserved ordinary pending path. No
 * deployment root, external source, production approval, session or route. */
import {createHash,randomBytes} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,openSync,realpathSync,type BigIntStats} from 'node:fs';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {gunzipSync} from 'node:zlib';
import {createMvpWorld} from './godot-mvp.js';
import {assertMvpWorld,upgradeMvpWorld} from './godot-mvp-persistent.js';
import {adoptMvpClimate,assertMvpClimateWorld} from '../world/mvp-climate-state.js';
import {adoptMvpSoil} from '../world/mvp-soil.js';
import {adoptMvpAgriculture} from '../world/mvp-agriculture.js';
import {adoptMvpRainProvenance} from '../world/mvp-rain-provenance.js';
import {canonicalDryEd25519PublicKey,verifyCanonicalDrySignedTuple} from './dry-deployment-trust.js';
import {acquireRuntimeOwnership,runtimeOwnershipAnchor} from './runtime-lock.js';

export const ORDINARY_FRESH_GENESIS_DOMAIN='ai-valley-ordinary-g2-fresh-genesis/v1';
const DOMAIN=ORDINARY_FRESH_GENESIS_DOMAIN,NAME='ordinary-fresh-pending.sqlite',MAX_WINDOW=60_000;
const TABLE='valley_spirit_ordinary_fresh_genesis',META='valley_spirit_ordinary_fresh_genesis/v1';
const schema='CREATE TABLE '+TABLE+' (seq INTEGER PRIMARY KEY CHECK(seq=1),body TEXT NOT NULL)';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const int=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&!Object.is(v,-0);
const name=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v);
const exact=(o:unknown,keys:readonly string[])=>!!o&&typeof o==='object'&&Object.getPrototypeOf(o)===Object.prototype&&
 Reflect.ownKeys(o).length===keys.length&&keys.every(k=>{const p=Object.getOwnPropertyDescriptor(o,k);return !!p&&'value' in p;});
const worldPattern=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/;
type Signed=Readonly<{utf8:string;signature:string}>;
export type OrdinaryFreshGenesisBoot=Readonly<{database:string;environment:string;generation:number;policyDigest:string;epochFloor:number;clock:()=>number;reservationRootSpki:string}>;
export type OrdinaryFreshGenesisWitness=Readonly<{schema:typeof DOMAIN;environment:string;worldId:string;instanceId:string;originalScope:string;
 generation:number;policyDigest:string;epochFloor:number;genesisRevision:number;genesisRawDigest:string;reservationDigest:string}>;
export type OrdinaryFreshGenesisLease=Readonly<{readonly ordinaryFreshGenesis:unique symbol}>;
type Lease=Readonly<{database:string;assertOriginal:()=>void;verifyTime:()=>void;world:World;nativeBodyDigest:string;origin:Omit<OrdinaryFreshGenesisWitness,'genesisRevision'|'genesisRawDigest'>}>;
const leases=new WeakMap<OrdinaryFreshGenesisLease,Lease>();
const absent=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT';
function stat(path:string){try{return lstatSync(path,{bigint:true});}catch(e){if(absent(e))return null;throw e;}}
const same=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino;
const uid=()=>BigInt(process.getuid!());
const regular=(s:BigIntStats)=>s.isFile()&&s.nlink===1n&&s.uid===uid()&&(s.mode&0o777n)===0o600n;
const protectedDir=(s:BigIntStats)=>s.isDirectory()&&s.uid===uid()&&(s.mode&0o777n)===0o700n;
function requireLease(pin:OrdinaryFreshGenesisLease){
 const lease=leases.get(pin);
 if(!lease)throw Error('ordinary_fresh_genesis_not_owner');
 lease.assertOriginal();return lease;
}
export function isOrdinaryFreshPendingPath(path:string){return basename(path)===NAME;}
export function assertOrdinaryFreshGenesisPath(pin:OrdinaryFreshGenesisLease,path:string){
 if(requireLease(pin).database!==path)throw Error('ordinary_fresh_genesis_not_owner');
}
/** Purposely blocks copied/renamed initialized images as well as the original
 * pending name. A pending image is an inert artifact, not an ordinary writer. */
export function hasOrdinaryFreshGenesisRecord(db:DatabaseSync){
 const names=db.prepare("SELECT type FROM main.sqlite_schema WHERE name=? COLLATE NOCASE").get(TABLE);
 const meta=db.prepare("SELECT type FROM main.sqlite_schema WHERE name='archive_meta' COLLATE NOCASE").get();
 return !!names||meta?.type==='table'&&!!db.prepare('SELECT 1 FROM main.archive_meta WHERE key=? LIMIT 1').get(META);
}

function witness(db:DatabaseSync,lease:Lease):OrdinaryFreshGenesisWitness{
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),row=rows[0];
 if(rows.length!==1||row.id!==lease.world.id||row.revision!==lease.world.revision||!(row.state instanceof Uint8Array)||!row.state.byteLength||hash(gunzipSync(row.state))!==lease.nativeBodyDigest)
  throw Error('ordinary_fresh_genesis_exact_head');
 return {...lease.origin,genesisRevision:lease.world.revision,genesisRawDigest:hash(row.state)};
}
function requireMainDb(db:DatabaseSync,lease:Lease){
 const main=db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
 if(typeof main!=='string'||realpathSync(main)!==realpathSync(lease.database))throw Error('ordinary_fresh_genesis_not_owner');
}
export function assertInitialOrdinaryFreshGenesisCommit(db:DatabaseSync,pin:OrdinaryFreshGenesisLease,world:World,previousRevision:number|null){
 const lease=requireLease(pin);
 requireMainDb(db,lease);lease.verifyTime();
 if(!db.isTransaction||previousRevision!==null||world!==lease.world||hash(JSON.stringify(world))!==lease.nativeBodyDigest||world.mode!=='validation'||world.clock.paused||
  Object.hasOwn(world,'simulationOnly')||Object.hasOwn(world,'mvpSeasonalModelVersion')||hasOrdinaryFreshGenesisRecord(db)||
  db.prepare('SELECT 1 FROM main.worlds LIMIT 1').get())throw Error('ordinary_fresh_genesis_first_commit_only');
}
export function recordInitialOrdinaryFreshGenesis(db:DatabaseSync,pin:OrdinaryFreshGenesisLease){
 const lease=requireLease(pin);
 requireMainDb(db,lease);lease.verifyTime();
 if(!db.isTransaction||hasOrdinaryFreshGenesisRecord(db))throw Error('ordinary_fresh_genesis_first_commit_only');
 const data=JSON.stringify(witness(db,lease));
 db.exec(schema);
 db.prepare('INSERT INTO main.'+TABLE+'(seq,body) VALUES(1,?)').run(data);
 db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(META,hash(data));
 // Re-read the exact first bytes and the dual marker before native COMMIT.
 readInitialOrdinaryFreshGenesis(db,pin);
 // Recheck after durable-row readback and immediately before the caller's
 // SQLite COMMIT. A clock crossing here must roll the world back as well.
 lease.verifyTime();lease.assertOriginal();requireMainDb(db,lease);
}
export function readInitialOrdinaryFreshGenesis(db:DatabaseSync,pin:OrdinaryFreshGenesisLease){
 const lease=requireLease(pin);requireMainDb(db,lease);
 const found=db.prepare("SELECT type,sql FROM main.sqlite_schema WHERE name=?").get(TABLE);
 if(found?.type!=='table'||found.sql!==schema)throw Error('ordinary_fresh_genesis_record');
 const records=db.prepare('SELECT seq,body FROM main.'+TABLE+' LIMIT 2').all();
 const data=witness(db,lease),raw=JSON.stringify(data);
 if(records.length!==1||records[0].seq!==1||records[0].body!==raw||
  db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(META)?.value!==hash(raw))
  throw Error('ordinary_fresh_genesis_record');
 return Object.freeze(data);
}

/** Common normalization for both genuine ordinary first commits. */
export function prepareOrdinaryRulesWorldStorage(world:World){
 const upgraded=upgradeMvpWorld(world),adopted=adoptMvpClimate(world),soilAdopted=adoptMvpSoil(world),agricultureAdopted=adoptMvpAgriculture(world);
 const rainAdopted=adoptMvpRainProvenance(world);
 if(adopted||soilAdopted||agricultureAdopted||rainAdopted)world.revision++;
 return upgraded||adopted||soilAdopted||agricultureAdopted||rainAdopted;
}
/** Called by the existing ordinary engine host. The draft is always created
 * by the engine, not accepted as input. Seal its expected native JSON so even
 * wiring code cannot substitute a caller-authored draft for this witness.
 * The compile-visible callback is trusted native WorldStore wiring only; the
 * public host adapter does not expose it. */
export function prepareOwnedOrdinaryFreshGenesis(boot:OrdinaryFreshGenesisBoot){
 const world=createMvpWorld();
 assertMvpWorld(world);prepareOrdinaryRulesWorldStorage(world);assertMvpClimateWorld(world);
 const nativeBodyDigest=hash(JSON.stringify(world));
 if(!exact(boot,['database','environment','generation','policyDigest','epochFloor','clock','reservationRootSpki'])||
  typeof boot.database!=='string'||boot.database.includes('\0')||!isAbsolute(boot.database)||resolve(boot.database)!==boot.database||
  !isOrdinaryFreshPendingPath(boot.database)||!name(boot.environment)||!int(boot.generation,1)||!hex(boot.policyDigest)||
  !int(boot.epochFloor,1)||typeof boot.clock!=='function'||!worldPattern.test(world.id))throw Error('ordinary_fresh_genesis_boot');
 const {database,environment,generation,policyDigest,epochFloor,clock}=boot,parent=dirname(database);
 const {key}=canonicalDryEd25519PublicKey(boot.reservationRootSpki);
 const instanceId=randomBytes(32).toString('hex'),challenge=randomBytes(32).toString('hex');
 const preparedAt=clock();
 if(!int(preparedAt))throw Error('ordinary_fresh_genesis_clock');
 const identity=[DOMAIN,'reserve-fresh-ordinary-before-file',environment,world.id,instanceId,generation,policyDigest,epochFloor,challenge] as const;
 const request=Object.freeze({identity:Object.freeze(identity),preparedAt});
 let used=false,busy=false;
 function create<T>(reservation:Signed,commit:(lease:OrdinaryFreshGenesisLease,path:string,world:World)=>T):T{
  if(used||busy)throw Error('ordinary_fresh_genesis_already_attempted');
  busy=true;
  let owner:ReturnType<typeof acquireRuntimeOwnership>|undefined,directory:number|undefined,fd:number|undefined;
  let pin:OrdinaryFreshGenesisLease|undefined;
  try{
   const r=verifyCanonicalDrySignedTuple(reservation,key,11);
   if(identity.some((v,i)=>r[i]!==v)||!int(r[9])||!int(r[10])||r[9]<preparedAt||
    r[10]<=r[9]||r[10]-r[9]>MAX_WINDOW)throw Error('ordinary_fresh_genesis_reservation');
   // Snapshot already verified exact wire; bind the attested tuple (not an
   // untrusted second property read) to the eventual local witness.
   const reservationDigest=hash(JSON.stringify(r));
   const issued=r[9],expires=r[10];let last=preparedAt;
   const verifyTime=()=>{
    const now=clock();
    if(!int(now)||now<last||now<issued||now>=expires)throw Error('ordinary_fresh_genesis_clock');
    last=now;
   };
   verifyTime();
   used=true; // Once attempting the filesystem, never clean up or try again.
   const before=stat(parent);
   if(!before||!protectedDir(before)||realpathSync(parent)!==parent)throw Error('ordinary_fresh_genesis_parent');
   directory=openSync(parent,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);
   const dirInfo=fstatSync(directory,{bigint:true});
   if(!same(before,dirInfo))throw Error('ordinary_fresh_genesis_parent');
   const anchored='/proc/self/fd/'+directory+'/'+NAME;
   if(['','.runtime-lock','-wal','-journal','-shm','.self-hosted-session'].some(s=>stat(anchored+s)))throw Error('ordinary_fresh_genesis_exists');
   fd=openSync(anchored,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_RDWR,0o600);
   const fileInfo=fstatSync(fd,{bigint:true});
   fsyncSync(fd);fsyncSync(directory);
   const assertOriginal=()=>{
    const dir=stat(parent),file=stat(anchored);
    if(!dir||!protectedDir(dir)||!same(dir,dirInfo)||realpathSync(parent)!==parent||
     !file||!regular(file)||!same(file,fileInfo))throw Error('ordinary_fresh_genesis_replaced');
   };
   assertOriginal();
   owner=acquireRuntimeOwnership(database);
   const a=runtimeOwnershipAnchor(owner);
   if(!a||realpathSync(a.database)!==database)throw Error('ordinary_fresh_genesis_not_owner');
   owner.assertOwned();assertOriginal();
   const originalScope=hash(JSON.stringify(['ordinary-rules-aged-g1-detached-decision/v1',fileInfo.dev.toString(),fileInfo.ino.toString()]));
   const origin=Object.freeze({schema:DOMAIN,environment,worldId:world.id,instanceId,originalScope,generation,policyDigest,epochFloor,reservationDigest}) as Lease['origin'];
   pin=Object.freeze({}) as OrdinaryFreshGenesisLease;
   leases.set(pin,{database:a.database,assertOriginal:()=>{a.assertOwned();assertOriginal();},verifyTime,world,nativeBodyDigest,origin});
   return commit(pin,a.database,world);
  }finally{
   if(pin)leases.delete(pin);
   try{owner?.release();}finally{
    try{if(fd!==undefined)closeSync(fd);}finally{if(directory!==undefined)closeSync(directory);busy=false;}
   }
  }
 }
 return Object.freeze({request,create});
}

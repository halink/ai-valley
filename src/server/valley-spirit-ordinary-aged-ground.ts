import {lstatSync,realpathSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {Vec,World} from '../shared/types.js';
import type {MvpGroundFruit} from '../shared/mvp-ground-fruit.js';
import {inspectMvpGroundFruitPlacement,validateMvpGroundFruitState} from '../world/mvp-ground-fruit.js';
import {minuteToClimateUs,parseClimateUs} from '../world/mvp-climate.js';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';

const table='valley_spirit_ordinary_aged_ground';
const ddl='CREATE TABLE valley_spirit_ordinary_aged_ground(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL,digest TEXT NOT NULL)';
const worldId=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u,sourceId=/^mvp-supply-fruit-[0-9]{1,12}$/u;
const bounded=(n:unknown,max=Number.MAX_SAFE_INTEGER):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=max;
const exact=(o:unknown,keys:readonly string[]):o is Record<string,unknown>=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const us=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/u.test(v);
const digest=(body:string|Uint8Array)=>createHash('sha256').update(body).digest('hex');

export interface OrdinaryAgedGroundPin {
 readonly scope:'ordinary-empty-aged-ground/v1';readonly worldId:string;readonly sourceId:string;readonly target:Readonly<Vec>;
}
export function pinOrdinaryAgedGround(v:unknown):OrdinaryAgedGroundPin|null{
 if(!exact(v,['scope','worldId','sourceId','target'])||v.scope!=='ordinary-empty-aged-ground/v1'||
  typeof v.worldId!=='string'||!worldId.test(v.worldId)||typeof v.sourceId!=='string'||!sourceId.test(v.sourceId)||
  !exact(v.target,['x','y'])||!bounded(v.target.x,4095)||!bounded(v.target.y,4095))return null;
 return Object.freeze({scope:v.scope,worldId:v.worldId,sourceId:v.sourceId,target:Object.freeze({x:v.target.x,y:v.target.y})});
}
interface InstalledEmpty {
 readonly version:1;readonly config:OrdinaryAgedGroundPin;readonly installedRevision:number;readonly installedAtUs:string;
 readonly sourceResourceInstanceId:string;readonly targetId:string;readonly capacity:1;readonly items:readonly [];
}
type NativeEmptyCheckpoint=Readonly<{sequence:number;fromRevision:number;revision:number;fromUs:string;atUs:string;
 priorWorldDigest:string;worldDigest:string}>;
type EmptyState=InstalledEmpty|Readonly<Omit<InstalledEmpty,'version'>&{version:2;nativeCheckpoint:NativeEmptyCheckpoint}>;
const nativeAnchor='ordinary_native_empty_ground_v2';
function readNativeAnchor(db:DatabaseSync,strict=false){
 const table=db.prepare("SELECT type,sql FROM main.sqlite_schema WHERE name='archive_meta' COLLATE NOCASE").get();
 if(!table)return null;
 if(table.type!=='table'||!db.prepare('PRAGMA main.table_info(archive_meta)').all().some(c=>c.name==='key'))
  throw Error('ordinary_native_empty_ground_anchor_schema');
 // Even when metadata drift is detected, check the real bounded key before
 // treating the lane as absent. A TEMP shadow never serves this read.
 const present=db.prepare('SELECT 1 FROM main.archive_meta WHERE key=? LIMIT 1').get(nativeAnchor);
 const malformed=table.sql!=='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)'||
  !!db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name)='archive_meta' OR lower(tbl_name)='archive_meta'").get()||
  !!db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='trigger' AND lower(tbl_name)='archive_meta'").get();
 if(malformed){
  if(strict||present)throw Error('ordinary_native_empty_ground_anchor_schema');
  return null;
 }
 if(!present)return null;
 const value=db.prepare("SELECT CASE WHEN length(CAST(value AS BLOB))=64 THEN value END AS value FROM main.archive_meta WHERE key=?").get(nativeAnchor)?.value;
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))throw Error('ordinary_native_empty_ground_anchor_value');
 return value;
}
function readInstalled(db:DatabaseSync,allowNative=false):EmptyState|null{
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('worlds',?) OR lower(tbl_name) IN ('worlds',?)").get(table,table))
  throw Error('ordinary_aged_ground_temp_shadow');
 const meta=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(!meta){if(readNativeAnchor(db)!==null)throw Error('ordinary_native_empty_ground_anchor_orphaned');return null;}
 if(meta.type!=='table'||meta.sql!==ddl||db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(table))
  throw Error('ordinary_aged_ground_unknown_schema');
 const rows=db.prepare(`SELECT slot,digest,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.${table} LIMIT 2`).all();
 if(rows.length!==1||rows[0].slot!==1||typeof rows[0].body!=='string'||digest(rows[0].body)!==rows[0].digest)
  throw Error('ordinary_aged_ground_unknown_state');
 const body:unknown=JSON.parse(rows[0].body);
 const v2=allowNative&&!!body&&typeof body==='object'&&'version' in body&&body.version===2;
 if(!exact(body,['version','config','installedRevision','installedAtUs','sourceResourceInstanceId','targetId','capacity','items',...(v2?['nativeCheckpoint']:[])])||
  !(body.version===1||v2)||body.capacity!==1||!Array.isArray(body.items)||body.items.length!==0||!bounded(body.installedRevision)||!us(body.installedAtUs))
  throw Error('ordinary_aged_ground_unknown_state');
 const pin=pinOrdinaryAgedGround(body.config);
 if(!pin||typeof body.sourceResourceInstanceId!=='string'||
  !body.sourceResourceInstanceId.startsWith('mvp-fruit:'+pin.sourceId+':')||
  !/^\d{1,4}:\d{1,4}$/u.test(body.sourceResourceInstanceId.slice(('mvp-fruit:'+pin.sourceId+':').length))||
  body.targetId!=='ground:'+pin.target.x+':'+pin.target.y||JSON.stringify(body)!==rows[0].body)
  throw Error('ordinary_aged_ground_unknown_scope');
 const anchor=readNativeAnchor(db,v2);
 if(v2?anchor!==rows[0].digest:anchor!==null)throw Error('ordinary_native_empty_ground_anchor_mismatch');
 if(v2){
  const c=body.nativeCheckpoint;
  if(!exact(c,['sequence','fromRevision','revision','fromUs','atUs','priorWorldDigest','worldDigest'])||
   !bounded(c.sequence)||c.sequence<1||!bounded(c.fromRevision)||!bounded(c.revision)||c.revision<=c.fromRevision||
   !us(c.fromUs)||!us(c.atUs)||BigInt(c.atUs as string)-BigInt(c.fromUs as string)!==1_000_000n||
   c.fromRevision<Number(body.installedRevision)||BigInt(c.fromUs as string)<BigInt(body.installedAtUs as string)||
   ![c.priorWorldDigest,c.worldDigest].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/u.test(h)))throw Error('ordinary_native_empty_ground_bad_checkpoint');
 }
 return body as unknown as EmptyState;
}
/** Before ANY persistent startup. No schema writes. An unknown/nonempty
 * future lane must not quietly run as today's empty ordinary installation. */
export function assertOrdinaryAgedGroundStartup(db:DatabaseSync,world:Record<string,unknown>|null, ordinary:boolean,nativePin?:OrdinaryAgedGroundPin){
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(name) IN ('valley_spirit_ordinary_aged_transfer','valley_spirit_ordinary_aged_continuation')").get())
  throw Error('ordinary_aged_ground_stopped_lane');
 const state=readInstalled(db,!!nativePin);
 if(!state)return;
 if(!ordinary||!world||world.mode!=='validation'||world.id!==state.config.worldId||!bounded(world.revision)||world.revision<state.installedRevision||
  typeof world.minute!=='number'||BigInt(minuteToClimateUs(world.minute))<BigInt(state.installedAtUs)||
  db.prepare('SELECT id FROM main.worlds LIMIT 2').all().length!==1)
  throw Error('ordinary_aged_ground_foreign_save');
 if(state.version===2){
  const row=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 1').get();
  const c=state.nativeCheckpoint;
  if(!nativePin||JSON.stringify(state.config)!==JSON.stringify(nativePin)||c.revision!==world.revision||
   c.atUs!==minuteToClimateUs(world.minute)||row?.id!==world.id||row.revision!==world.revision||
   !(row.state instanceof Uint8Array)||digest(row.state)!==c.worldDigest)throw Error('ordinary_native_empty_ground_wrong_head');
 }
}
export function hasNativeEmptyGroundCheckpoint(db:DatabaseSync):boolean{
 return readInstalled(db,true)?.version===2;
}
function exactHead(db:DatabaseSync,w:World){
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all();
 const row=rows[0];
 return rows.length===1&&row.id===w.id&&row.revision===w.revision&&row.state instanceof Uint8Array&&
  gzipSync(JSON.stringify(w),{level:1}).equals(row.state);
}
/** Strict participant of the same normal world transaction, after world
 * CAS and before COMMIT. Only WorldStore supplies the provenance boolean
 * from the exact WeakMap native minute; this is not an untrusted call surface.
 * No effects, actions, events or source writes. */
export function advanceOrdinaryNativeEmptyGround(db:DatabaseSync,owner:RuntimeOwnership,pin:OrdinaryAgedGroundPin,previous:World,world:World,
 genuineNative:boolean){
 const authority=runtimeOwnershipAnchor(owner);
 if(!authority||owner.database!==authority.database||!db.isTransaction)throw Error('ordinary_native_empty_ground_owner');
 authority.assertOwned();
 const main=db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
 if(typeof main!=='string'||!main||realpathSync(main)!==realpathSync(authority.database))
  throw Error('ordinary_native_empty_ground_owner');
 const state=readInstalled(db,true);
 if(!state||JSON.stringify(state.config)!==JSON.stringify(pin)||previous.id!==pin.worldId||world.id!==pin.worldId||
  previous.mode!=='validation'||world.mode!=='validation'||Object.hasOwn(world,'simulationOnly')||
  Object.hasOwn(world.mvpClimate??{},'spiritEffects')||Object.hasOwn(world.mvpClimate??{},'spiritFruitSettlement'))
  throw Error('ordinary_native_empty_ground_scope');
 // Untouched legacy installation may undergo legitimate initial adoption.
 // Once bound, only native minutes may update its exact head.
 if(!genuineNative){
  if(state.version===1&&world.minute===previous.minute)return;
  throw Error('ordinary_native_empty_ground_native_minute_required');
 }
 const fromUs=minuteToClimateUs(previous.minute),atUs=minuteToClimateUs(world.minute),priorWorldDigest=digest(gzipSync(JSON.stringify(previous),{level:1}));
 const checkpoint=state.version===2?state.nativeCheckpoint:null;
 if(previous.clock.paused||world.clock.paused||world.minute!==previous.minute+1||world.revision<=previous.revision||
  previous.revision<state.installedRevision||BigInt(fromUs)<BigInt(state.installedAtUs)||
  previous.mvpClimate?.lastUs!==fromUs||world.mvpClimate?.lastUs!==atUs||!exactHead(db,world)||
  checkpoint&&(checkpoint.revision!==previous.revision||checkpoint.atUs!==fromUs||checkpoint.worldDigest!==priorWorldDigest))
  throw Error('ordinary_native_empty_ground_wrong_head');
 const next={...state,version:2,nativeCheckpoint:{sequence:(checkpoint?.sequence??0)+1,
  fromRevision:previous.revision,revision:world.revision,fromUs,atUs,priorWorldDigest,worldDigest:digest(gzipSync(JSON.stringify(world),{level:1}))}};
 const old=JSON.stringify(state),body=JSON.stringify(next);
 const oldHash=digest(old),newHash=digest(body);
 if(readNativeAnchor(db,true)!==(checkpoint?oldHash:null))throw Error('ordinary_native_empty_ground_anchor_mismatch');
 if(db.prepare('UPDATE main.valley_spirit_ordinary_aged_ground SET body=?,digest=? WHERE slot=1 AND body=? AND digest=?')
  .run(body,newHash,old,oldHash).changes!==1)throw Error('ordinary_native_empty_ground_cas');
 const anchor=checkpoint?db.prepare('UPDATE main.archive_meta SET value=? WHERE key=? AND value=?').run(newHash,nativeAnchor,oldHash):
  db.prepare('INSERT INTO main.archive_meta (key,value) VALUES (?,?)').run(nativeAnchor,newHash);
 if(anchor.changes!==1||JSON.stringify(readInstalled(db,true))!==body)throw Error('ordinary_native_empty_ground_cas');
 authority.assertOwned();
}
const readSite=(w:World,p:OrdinaryAgedGroundPin)=>w.id===p.worldId&&w.mode==='validation'&&!Object.hasOwn(w,'simulationOnly')&&
 !!w.mvpClimate&&!Object.hasOwn(w.mvpClimate,'spiritEffects')&&!Object.hasOwn(w.mvpClimate,'spiritFruitSettlement')?
 inspectMvpGroundFruitPlacement(w,{version:1,items:[]},p.sourceId,p.target,{worldLots:1,lotsPerTarget:1}):null;
export function canInstallEmptyOrdinaryAgedGround(w:World,pin:OrdinaryAgedGroundPin):boolean{
 return readSite(w,pin)!==null;
}
/** Checked read of the exact empty installation; no ordinary nonempty writer. */
export function readOwnedEmptyGround(db:DatabaseSync,owner:RuntimeOwnership,pin:OrdinaryAgedGroundPin,w:World){
 const authority=runtimeOwnershipAnchor(owner);
 if(!authority||owner.database!==authority.database)return null;
 authority.assertOwned();
 const row=readInstalled(db);
 if(!row||JSON.stringify(row.config)!==JSON.stringify(pin)||row.installedRevision>w.revision||
  BigInt(row.installedAtUs)>BigInt(minuteToClimateUs(w.minute))||w.clock.paused||!exactHead(db,w))return null;
 const site=readSite(w,pin);
 if(!site||row.sourceResourceInstanceId!==site.source.resourceInstanceId||row.targetId!==site.target.id)return null;
 const identity=lstatSync(authority.database,{bigint:true});
 return Object.freeze({status:'empty_ground_capacity_installed' as const,worldId:w.id,revision:w.revision,atUs:minuteToClimateUs(w.minute),
  sourceResourceInstanceId:row.sourceResourceInstanceId,targetId:row.targetId,
  installationDigest:digest(JSON.stringify(['ordinary-ground-installation/v1',identity.dev.toString(),identity.ino.toString(),row])),
  capacity:1 as const,occupied:0 as const,freeCapacity:1 as const,placementAuthorized:false as const,
  discoveryInstalled:false as const,pickupInstalled:false as const});
}
export function openEmptyOrdinaryAgedGround(owner:RuntimeOwnership,pin:OrdinaryAgedGroundPin,readHead:()=>World|null,native=false){
 const authority=runtimeOwnershipAnchor(owner);
 if(!authority||owner.database!==authority.database)throw Error('ordinary_aged_ground_runtime_owner_required');
 authority.assertOwned();
 const db=new DatabaseSync(authority.database);
 try{
  db.exec('BEGIN IMMEDIATE');
  const world=readHead();
  if(!world||world.id!==pin.worldId||!exactHead(db,world))
   throw Error('ordinary_aged_ground_wrong_head');
  const site=readSite(world,pin);
  const existing=readInstalled(db,native);
  if(!site&&existing?.version!==2)throw Error('ordinary_aged_ground_legal_commons_site_required');
  if(existing){
   if(JSON.stringify(existing.config)!==JSON.stringify(pin)||site&&(existing.sourceResourceInstanceId!==site.source.resourceInstanceId||existing.targetId!==site.target.id)||existing.installedRevision>world.revision||BigInt(existing.installedAtUs)>BigInt(minuteToClimateUs(world.minute)))
    throw Error('ordinary_aged_ground_pin_changed');
  }else{
   const state:InstalledEmpty={version:1,config:pin,installedRevision:world.revision,installedAtUs:minuteToClimateUs(world.minute),
    sourceResourceInstanceId:site!.source.resourceInstanceId,targetId:site!.target.id,capacity:1,items:[]};
   const body=JSON.stringify(state);
   db.exec(ddl);db.prepare(`INSERT INTO main.${table} VALUES (1,?,?)`).run(body,digest(body));
   if(JSON.stringify(readInstalled(db))!==body)throw Error('ordinary_aged_ground_install_unverified');
  }
  authority.assertOwned();db.exec('COMMIT');
  const review=(expected:Readonly<{id:string;revision:number;minute:number}>)=>{
   try{
    authority.assertOwned();db.exec('BEGIN');
    try{
     const w=readHead();
     if(!w||w.id!==expected.id||w.revision!==expected.revision||w.minute!==expected.minute)return null;
     if(native){
      const state=readInstalled(db,true);
      if(state?.version===2){
       assertOrdinaryAgedGroundStartup(db,w as unknown as Record<string,unknown>,true,pin);
       return Object.freeze({status:'native_empty_ground_current' as const,worldId:w.id,revision:w.revision,
        atUs:state.nativeCheckpoint.atUs,sequence:state.nativeCheckpoint.sequence,occupied:0 as const,placementAuthorized:false as const,
        discoveryInstalled:false as const,pickupInstalled:false as const});
      }
     }
     return readOwnedEmptyGround(db,owner,pin,w);
    }finally{db.exec('ROLLBACK');}
   }catch{return null;}
  };
  return Object.freeze({review,close:()=>db.close()});
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');db.close();throw error;}
}

/** Future admitted lot shape only. This time/quantity rule is not a writer:
 * v1 storage above rejects ALL nonempty rows, even well-shaped lots. */
export interface AgedGroundLot {readonly fruit:MvpGroundFruit;readonly bornUs:string;readonly expiresUs:string}
export function advanceAgedGroundExpiry(prior:World,next:World,lots:readonly AgedGroundLot[]){
 if(prior.id!==next.id||prior.mode!=='validation'||next.mode!=='validation'||prior.clock.paused||next.clock.paused||
  Object.hasOwn(prior,'simulationOnly')||Object.hasOwn(next,'simulationOnly')||next.revision<=prior.revision||next.minute!==prior.minute+1||
  prior.mvpClimate?.lastUs!==minuteToClimateUs(prior.minute)||next.mvpClimate?.lastUs!==minuteToClimateUs(next.minute)||lots.length>1)return null;
 const before=parseClimateUs(prior.mvpClimate.lastUs),after=parseClimateUs(next.mvpClimate.lastUs);
 validateMvpGroundFruitState(prior,{version:1,items:lots.map(l=>l.fruit)});
 validateMvpGroundFruitState(next,{version:1,items:lots.map(l=>l.fruit)});
 const item=lots[0];
 if(!item)return Object.freeze({remaining:Object.freeze([]),expired:Object.freeze([])});
 const born=parseClimateUs(item.bornUs),expiry=parseClimateUs(item.expiresUs),placed=parseClimateUs(item.fruit.placedUs);
 if(born>placed||placed>before||expiry<=before||expiry<=placed)return null;
 return expiry>after?Object.freeze({remaining:Object.freeze([item]),expired:Object.freeze([])}):
  Object.freeze({remaining:Object.freeze([]),expired:Object.freeze([Object.freeze({effectId:item.fruit.effectId,bornUs:item.bornUs,
   expiresUs:item.expiresUs,settledUs:next.mvpClimate.lastUs,groundDebit:1 as const})])});
}

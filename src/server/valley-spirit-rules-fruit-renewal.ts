import {verifyOrdinaryDevelopmentV3,type OrdinaryDevelopmentV3Pin} from './ordinary-g2-development-v3.js';
import type {OrdinaryG2DevelopmentOrigin} from './ordinary-g2-development-origin.js';
import {ownsSelectedPositiveRehearsal,type openSelectedOrdinaryRehearsal} from './valley-spirit-ordinary-selected-rehearsal.js';
import {readAtomicNativeRulesRenewal} from './godot-mvp.js';
import {lstatSync} from 'node:fs';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {isNativeMvpFruitRenewalWitness,type MvpFruitRenewalWitness,type MvpFruitFlowBatch} from '../world/mvp-resources.js';

const table='valley_spirit_rules_native_fruit_renewal';
const ddl='CREATE TABLE valley_spirit_rules_native_fruit_renewal(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL,digest TEXT NOT NULL)';
const worldPattern=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u,sourcePattern=/^mvp-supply-fruit-[0-9]{1,12}$/u;
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const hex=/^[a-f0-9]{64}$/u;
export interface RulesNativeFruitRenewalPin{
 readonly worldId:string;readonly sourceId:string;readonly lotShelfLifeGameMinutes?:number;
}
export function pinRulesNativeFruitRenewal(v:unknown):RulesNativeFruitRenewalPin|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==(Object.hasOwn(v,'lotShelfLifeGameMinutes')?3:2)||!Object.hasOwn(v,'worldId')||!Object.hasOwn(v,'sourceId'))return null;
  const p=v as RulesNativeFruitRenewalPin;
  return typeof p.worldId==='string'&&worldPattern.test(p.worldId)&&typeof p.sourceId==='string'&&sourcePattern.test(p.sourceId)?
   (!Object.hasOwn(v,'lotShelfLifeGameMinutes')?Object.freeze({worldId:p.worldId,sourceId:p.sourceId}):
     natural(p.lotShelfLifeGameMinutes)&&p.lotShelfLifeGameMinutes>=1&&p.lotShelfLifeGameMinutes<=1440?
      Object.freeze({worldId:p.worldId,sourceId:p.sourceId,lotShelfLifeGameMinutes:p.lotShelfLifeGameMinutes}):null):null;
 }catch{return null;}
}
interface Renewal {
 readonly schemaVersion:1;readonly worldId:string;readonly sourceId:string;
 readonly x:number;readonly y:number;readonly fromRevision:number;readonly revision:number;
 readonly creditedAtUs:string;readonly openingQuantity:number;readonly beforeNaturalCredit:number;
 readonly closingQuantity:number;readonly grossNaturalRenewal:number;readonly scalarNetChange:number;readonly worldDigest:string;
}
const keys=['schemaVersion','worldId','sourceId','x','y','fromRevision','revision','creditedAtUs','openingQuantity',
 'beforeNaturalCredit','closingQuantity','grossNaturalRenewal','scalarNetChange','worldDigest'];
function valid(p:Renewal){
 return !!p&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k))&&p.schemaVersion===1&&
  worldPattern.test(p.worldId)&&sourcePattern.test(p.sourceId)&&[p.x,p.y,p.fromRevision,p.revision,p.openingQuantity,
   p.beforeNaturalCredit,p.closingQuantity,p.grossNaturalRenewal].every(natural)&&p.revision>p.fromRevision&&
  p.grossNaturalRenewal>0&&p.openingQuantity>=p.beforeNaturalCredit&&p.closingQuantity-p.beforeNaturalCredit===p.grossNaturalRenewal&&
  p.closingQuantity-p.openingQuantity===p.scalarNetChange&&typeof p.creditedAtUs==='string'&&/^[1-9][0-9]{0,15}$/u.test(p.creditedAtUs)&&
  hex.test(p.worldDigest);
}
function available(db:DatabaseSync,name=table){
 const expected=ddl.replace(table,name);
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('worlds',?) OR lower(tbl_name) IN ('worlds',?)").get(name,name))
  throw Error('rules_native_renewal_temp_shadow');
 const found=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE').get(name);
 if(!found)return false;
 if(found.type!=='table'||found.sql!==expected||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(name))
  throw Error('rules_native_renewal_schema');
 return true;
}
interface Lot {readonly id:string;readonly bornUs:string;readonly expiresUs:string;readonly birthRevision:number;readonly quantity:1}
interface LotCheckpoint {
 readonly schemaVersion:2;readonly worldId:string;readonly sourceId:string;readonly x:number;readonly y:number;
 readonly revision:number;readonly atUs:string;readonly balance:number;readonly worldDigest:string;readonly shelfLife:number;
 readonly lot:Lot|null;readonly renewal:Renewal|null;
}
const lotKeys=['id','bornUs','expiresUs','birthRevision','quantity'];
const v2Keys=['schemaVersion','worldId','sourceId','x','y','revision','atUs','balance','worldDigest','shelfLife','lot','renewal'];
const exact=(value:object,keys:string[])=>!!value&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const us=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,15}$/u.test(v);
const lotId=(worldId:string,sourceId:string,x:number,y:number,rev:number,bornUs:string)=>
 'native-fruit:'+hash(JSON.stringify([worldId,sourceId,x,y,rev,bornUs]));
function validV2(p:LotCheckpoint){
 if(!exact(p,v2Keys)||p.schemaVersion!==2||!worldPattern.test(p.worldId)||!sourcePattern.test(p.sourceId)||
  ![p.x,p.y,p.revision,p.balance,p.shelfLife].every(natural)||p.shelfLife<1||p.shelfLife>1440||!us(p.atUs)||!hex.test(p.worldDigest))return false;
 const l=p.lot,r=p.renewal;
 if(l!==null&&(!exact(l,lotKeys)||l.quantity!==1||!natural(l.birthRevision)||l.birthRevision>p.revision||!us(l.bornUs)||!us(l.expiresUs)||
  BigInt(l.bornUs)>BigInt(p.atUs)||BigInt(l.expiresUs)<=BigInt(p.atUs)||BigInt(l.expiresUs)-BigInt(l.bornUs)!==BigInt(p.shelfLife)*1_000_000n||
  p.balance<1||l.id!==lotId(p.worldId,p.sourceId,p.x,p.y,l.birthRevision,l.bornUs)))return false;
 return r===null||valid(r)&&r.worldId===p.worldId&&r.sourceId===p.sourceId&&r.x===p.x&&r.y===p.y&&r.revision===p.revision&&
  r.creditedAtUs===p.atUs&&r.closingQuantity===p.balance&&r.worldDigest===p.worldDigest;
}
function stored(db:DatabaseSync,name=table):Renewal|LotCheckpoint {
 const rows=db.prepare(`SELECT slot,digest,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.${name} LIMIT 2`).all();
 if(rows.length!==1||rows[0].slot!==1||typeof rows[0].body!=='string'||hash(rows[0].body)!==rows[0].digest)
  throw Error('rules_native_renewal_corrupt');
 const p=JSON.parse(rows[0].body) as Renewal|LotCheckpoint;
 if(p?.schemaVersion===1? !valid(p):!validV2(p as LotCheckpoint))throw Error('rules_native_renewal_invalid');
 return p;
}
function put(db:DatabaseSync,exists:boolean,row:Renewal|LotCheckpoint,name=table){
 if(!exists)db.exec(ddl.replace(table,name));
 const body=JSON.stringify(row);
 db.prepare(`INSERT INTO main.${name} VALUES (1,?,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body,digest=excluded.digest`).run(body,hash(body));
}
function digestHead(db:DatabaseSync,w:World){
 const row=db.prepare('SELECT revision,state FROM main.worlds WHERE id=?').get(w.id);
 return row?.revision===w.revision&&row.state instanceof Uint8Array?hash(row.state):null;
}
function source(w:World,p:RulesNativeFruitRenewalPin){
 if(w.id!==p.worldId||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||!w.mvpClimate?.rainProvenance||
  w.mvpClimate.spiritEffects||w.mvpClimate.spiritFruitSettlement||w.mvpResources?.lastMinute!==w.minute||
  w.mvpResources.addedResourceIds.filter(id=>id===p.sourceId).length!==1||!Object.hasOwn(w.mvpResources.renewal,p.sourceId))return null;
 const s=w.resources.filter(r=>r.id===p.sourceId);
 return s.length===1&&s[0].kind==='bush'&&s[0].foodItem==='fruit'&&natural(s[0].amount)&&natural(s[0].max)&&s[0].amount<=s[0].max?s[0]:null;
}
/** Private checkpoint only. The store separately verifies the exact native draft/previous marker. */
export function appendRulesNativeFruitRenewal(db:DatabaseSync,p:RulesNativeFruitRenewalPin,prior:World,w:World,v:MvpFruitRenewalWitness){
 const one=source(prior,p),current=source(w,p);
 if(db.isTransaction===false||prior.clock.paused||w.clock.paused||!one||!current||!isNativeMvpFruitRenewalWitness(v)||v.worldId!==w.id||v.sourceId!==p.sourceId||
  v.worldRevision!==w.revision||w.minute!==prior.minute+1||v.atUs!==w.mvpClimate?.lastUs||v.atUs!==minuteToClimateUs(w.minute)||
  one.at.x!==current.at.x||one.at.y!==current.at.y||one.max!==current.max||v.sourceAt.x!==current.at.x||v.sourceAt.y!==current.at.y||
  v.amountAfter!==current.amount||v.amountBefore>one.amount)throw Error('rules_native_renewal_mismatch');
 const worldDigest=digestHead(db,w);
 if(!worldDigest)throw Error('rules_native_renewal_head');
 const exists=available(db),old=exists?stored(db):null;
 if(old&&(old.schemaVersion!==1||old.worldId!==p.worldId||old.sourceId!==p.sourceId||old.revision>prior.revision))throw Error('rules_native_renewal_lineage');
 const row:Renewal={schemaVersion:1,worldId:p.worldId,sourceId:p.sourceId,x:current.at.x,y:current.at.y,
  fromRevision:prior.revision,revision:w.revision,creditedAtUs:v.atUs,openingQuantity:one.amount,beforeNaturalCredit:v.amountBefore,
  closingQuantity:current.amount,grossNaturalRenewal:v.naturallyRenewed,scalarNetChange:current.amount-one.amount,worldDigest};
 if(!valid(row))throw Error('rules_native_renewal_invalid');
 put(db,exists,row);
 if(!readRulesNativeFruitRenewal(db,p,w))throw Error('rules_native_renewal_readback');
}
export function readRulesNativeFruitRenewal(db:DatabaseSync,p:RulesNativeFruitRenewalPin,w:World){
 const r=source(w,p);
 if(!r||w.clock.paused||!available(db))return null;
 const storedRow=stored(db);
 const row=storedRow.schemaVersion===2?(storedRow.shelfLife===p.lotShelfLifeGameMinutes?storedRow.renewal:null):p.lotShelfLifeGameMinutes===undefined?storedRow:null;
 if(!row||row.worldId!==w.id||row.sourceId!==p.sourceId||row.revision!==w.revision||row.worldDigest!==digestHead(db,w)||
  row.creditedAtUs!==minuteToClimateUs(w.minute)||row.creditedAtUs!==w.mvpClimate?.lastUs||row.x!==r.at.x||row.y!==r.at.y||
  row.closingQuantity!==r.amount)return null;
 const {worldDigest:_private,...evidence}=row;
 return Object.freeze({status:'native_renewal_credit' as const,...evidence,stockUnitAgesKnown:false as const,
  groundCapability:false as const,executionAuthorized:false as const});
}


/** Advance the same private checkpoint only along audited native flow. The caller
 * has bound its flow to this original before/after draft and world transaction. */
function advanceLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,prior:World,w:World,flow:MvpFruitFlowBatch,name=table){
 const before=source(prior,p),after=source(w,p),shelf=p.lotShelfLifeGameMinutes;
 if(db.isTransaction===false||!shelf||!before||!after||prior.clock.paused||w.clock.paused||w.minute!==prior.minute+1||
  flow.worldId!==w.id||flow.fromRevision!==prior.revision||flow.toRevision!==w.revision||
  flow.fromUs!==prior.mvpClimate?.lastUs||flow.toUs!==w.mvpClimate?.lastUs||flow.toUs!==minuteToClimateUs(w.minute)||
  before.at.x!==after.at.x||before.at.y!==after.at.y||before.max!==after.max)throw Error('rules_native_fruit_lot_head');
 const opening=flow.opening.find(r=>r.sourceId===p.sourceId),closing=flow.closing.find(r=>r.sourceId===p.sourceId);
 if(!opening||!closing||opening.amount!==before.amount||closing.amount!==after.amount||
  opening.sourceAt.x!==before.at.x||opening.sourceAt.y!==before.at.y||
  closing.sourceAt.x!==after.at.x||closing.sourceAt.y!==after.at.y)throw Error('rules_native_fruit_lot_source');
 const native=flow.operations.filter(op=>op.kind==='renewal'&&op.witness.sourceId===p.sourceId);
 const v=native[0]?.kind==='renewal'?native[0].witness:null;
 const gathered=flow.operations.some(op=>op.kind==='gather'&&op.sourceId===p.sourceId);
 if(native.length>1||v&&!isNativeMvpFruitRenewalWitness(v))throw Error('rules_native_fruit_lot_non_native_credit');
 const exists=available(db,name),old=exists?stored(db,name):null;
 if(old&&(old.worldId!==p.worldId||old.sourceId!==p.sourceId||old.revision>prior.revision||
  old.schemaVersion===2&&old.shelfLife!==shelf))throw Error('rules_native_fruit_lot_lineage');
 // A v1 ordinary aggregate checkpoint never establishes unit age. If a
 // commit was missed/unobserved, no previous lot can ever resume.
 const beforeDigest=hash(gzipSync(JSON.stringify(prior),{level:1}));
 let lot=old?.schemaVersion===2&&old.revision===prior.revision&&old.atUs===flow.fromUs&&old.worldDigest===beforeDigest&&
  old.balance===before.amount&&old.x===before.at.x&&old.y===before.at.y?old.lot:null;
 if(gathered||lot&&BigInt(lot.expiresUs)<=BigInt(flow.toUs))lot=null;
 // The engine currently gathers before natural credit, but no lot-selection
 // contract exists. Suppress minting on mixed minutes too. No stock edit.
 if(!lot&&!gathered&&v&&v.naturallyRenewed===1&&v.amountBefore===before.amount&&v.amountAfter===after.amount)
  lot={id:lotId(w.id,p.sourceId,after.at.x,after.at.y,w.revision,flow.toUs),bornUs:flow.toUs,
   expiresUs:(BigInt(flow.toUs)+BigInt(shelf)*1_000_000n).toString(),birthRevision:w.revision,quantity:1};
 if(!lot&&!v&&!exists)return;
 // With no live lot and no new credit, retain the historical slot in place;
 // the stale revision cannot read or be revived on a later quiet minute.
 if(!lot&&!v&&!(old?.schemaVersion===2&&old.lot&&old.revision===prior.revision))return;
 const worldDigest=digestHead(db,w);
 if(!worldDigest)throw Error('rules_native_fruit_lot_exact_head');
 const renewal:Renewal|null=v?{schemaVersion:1,worldId:w.id,sourceId:p.sourceId,x:after.at.x,y:after.at.y,
  fromRevision:prior.revision,revision:w.revision,creditedAtUs:v.atUs,openingQuantity:before.amount,beforeNaturalCredit:v.amountBefore,
  closingQuantity:after.amount,grossNaturalRenewal:v.naturallyRenewed,scalarNetChange:after.amount-before.amount,worldDigest}:null;
 const row:LotCheckpoint={schemaVersion:2,worldId:w.id,sourceId:p.sourceId,x:after.at.x,y:after.at.y,revision:w.revision,atUs:flow.toUs,
  balance:after.amount,worldDigest,shelfLife:shelf,lot,renewal};
 if(!validV2(row))throw Error('rules_native_fruit_lot_invalid');
 put(db,exists,row,name);
 if(JSON.stringify(stored(db,name))!==JSON.stringify(row))throw Error('rules_native_fruit_lot_readback');
}
function readLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,w:World,name=table){
 const r=source(w,p);
 if(!p.lotShelfLifeGameMinutes||!r||w.clock.paused||!available(db,name))return null;
 const row=stored(db,name);
 if(row.schemaVersion!==2||row.shelfLife!==p.lotShelfLifeGameMinutes||row.worldId!==w.id||row.sourceId!==p.sourceId||
  row.revision!==w.revision||row.worldDigest!==digestHead(db,w)||row.atUs!==w.mvpClimate?.lastUs||row.atUs!==minuteToClimateUs(w.minute)||
  row.x!==r.at.x||row.y!==r.at.y||row.balance!==r.amount||!row.lot)return null;
 return Object.freeze({status:'tracked_native_source_lot' as const,worldId:w.id,sourceId:p.sourceId,atUs:row.atUs,
  revision:w.revision,lot:Object.freeze({...row.lot}),otherStockUnitAgesKnown:false as const,
  groundCapability:false as const,selectionAuthorized:false as const,executionAuthorized:false as const});
}

/** Exact same-clock removal of the native tracked cohort at an already
 * independently authorized transfer. A transfer is never a natural credit. */
function consumeLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,before:World,after:World,lotId:string,name=table){
 const s=source(before,p),next=source(after,p),old=stored(db,name),head=digestHead(db,after);
 if(!db.isTransaction||!s||!next||!head||!p.lotShelfLifeGameMinutes||old.schemaVersion!==2||old.lot?.id!==lotId||
  old.worldDigest!==hash(gzipSync(JSON.stringify(before),{level:1}))||old.revision!==before.revision||
  old.atUs!==minuteToClimateUs(before.minute)||old.balance!==s.amount||old.shelfLife!==p.lotShelfLifeGameMinutes||
  after.id!==before.id||after.revision!==before.revision+1||after.minute!==before.minute||next.amount!==s.amount-1)
  throw Error('disposable_native_aged_transfer_lot_cas');
 const entry={...old,revision:after.revision,balance:next.amount,worldDigest:head,lot:null,renewal:null};
 put(db,true,entry,name);
 if(JSON.stringify(stored(db,name))!==JSON.stringify(entry))throw Error('disposable_native_aged_transfer_lot_cas');
}

export function consumeRulesNativeFruitLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,before:World,after:World,lotId:string){
 consumeLot(db,p,before,after,lotId);
}

export function advanceRulesNativeFruitLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,prior:World,w:World,flow:MvpFruitFlowBatch){
 return advanceLot(db,p,prior,w,flow);
}
export function readRulesNativeFruitLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,w:World){return readLot(db,p,w);}

const SLOT_NAMES=[1,2,3,4].map(n=>'valley_spirit_rules_multisource_fruit_'+n);
const MANIFEST='valley_spirit_rules_multisource_fruit_owner';
const MANIFEST_DDL='CREATE TABLE '+MANIFEST+' (slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1), binding TEXT NOT NULL)';
type SourceSite=Readonly<{sourceId:string;x:number;y:number}>;
export type RulesNativeMultiFruitPin=Readonly<{scope:'ordinary-multi-native-fruit-lots/v1';worldId:string;lotShelfLifeGameMinutes:number;sites:readonly SourceSite[]}>;
export function pinRulesNativeMultiFruit(v:unknown):RulesNativeMultiFruitPin|null{
 try{
  const p=structuredClone(v) as RulesNativeMultiFruitPin;
  if(!p||!exact(p,['scope','worldId','lotShelfLifeGameMinutes','sites'])||p.scope!=='ordinary-multi-native-fruit-lots/v1'||
   typeof p.worldId!=='string'||!worldPattern.test(p.worldId)||!natural(p.lotShelfLifeGameMinutes)||
   p.lotShelfLifeGameMinutes<1||p.lotShelfLifeGameMinutes>1440||!Array.isArray(p.sites)||p.sites.length<2||p.sites.length>4||
   !p.sites.every(s=>s&&exact(s,['sourceId','x','y'])&&typeof s.sourceId==='string'&&sourcePattern.test(s.sourceId)&&natural(s.x)&&natural(s.y)&&s.x<=4095&&s.y<=4095)||
   new Set(p.sites.map(s=>s.sourceId)).size!==p.sites.length||new Set(p.sites.map(s=>s.x+':'+s.y)).size!==p.sites.length)return null;
  return Object.freeze({...p,sites:Object.freeze(p.sites.map(s=>Object.freeze({...s})).sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0))});
 }catch{return null;}
}

/** Bounded read/capture sidecar; lane names are constants, never caller SQL. */
export function openRulesNativeMultiFruitLease(owner:RuntimeOwnership,path:string,raw:RulesNativeMultiFruitPin){
 const o=runtimeOwnershipAnchor(owner),pin=pinRulesNativeMultiFruit(raw);
 if(!o||o.database!==path||!pin)throw Error('ordinary_multi_fruit_requires_owner');
 o.assertOwned();
 const initial=lstatSync(path,{bigint:true});
 if(!initial.isFile()||initial.nlink!==1n)throw Error('ordinary_multi_fruit_file');
 const binding=hash(JSON.stringify([pin.scope,pin.worldId,pin.lotShelfLifeGameMinutes,pin.sites,String(initial.dev),String(initial.ino)]));
 let isolated=false;
 const guard=()=>{
  o.assertOwned();
  const f=lstatSync(path,{bigint:true});
  if(!f.isFile()||f.nlink!==1n||f.dev!==initial.dev||f.ino!==initial.ino)throw Error('ordinary_multi_fruit_file');
 };
 const manifest=(db:DatabaseSync)=>{
  guard();
  if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name)=? OR lower(tbl_name)=?").get(MANIFEST,MANIFEST))
   throw Error('ordinary_multi_fruit_manifest_shadow');
  const t=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE lower(name)=?').get(MANIFEST);
  if(!t){
   if(SLOT_NAMES.some(name=>available(db,name)))throw Error('ordinary_multi_fruit_manifest_missing');
   return false;
  }
  if(t.type!=='table'||t.sql!==MANIFEST_DDL||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(MANIFEST))
   throw Error('ordinary_multi_fruit_manifest_schema');
  const rows=db.prepare('SELECT slot,binding FROM main.'+MANIFEST+' LIMIT 2').all();
  if(rows.length!==1||rows[0].slot!==1||rows[0].binding!==binding)throw Error('ordinary_multi_fruit_manifest_scope');
  for(const [i,name] of SLOT_NAMES.entries())if(available(db,name)&&i>=pin.sites.length)throw Error('ordinary_multi_fruit_extra_slot');
  return true;
 };
 const nativePin=(site:SourceSite)=>({worldId:pin.worldId,sourceId:site.sourceId,lotShelfLifeGameMinutes:pin.lotShelfLifeGameMinutes});
 const matching=(w:World,site:SourceSite)=>{
  const r=source(w,nativePin(site));
  return r?.at.x===site.x&&r.at.y===site.y;
 };
 return Object.freeze({
  worldId:pin.worldId,
  append(db:DatabaseSync,prior:World,w:World,flow:MvpFruitFlowBatch){
   if(isolated)return;
   if(!db.isTransaction||readAtomicNativeRulesRenewal(prior,w)?.flow!==flow||w.id!==pin.worldId||prior.id!==pin.worldId||Object.hasOwn(w,'mvpSeasonalModelVersion')||
    !pin.sites.every(s=>matching(prior,s)&&matching(w,s)))throw Error('ordinary_multi_fruit_scope');
   const h=digestHead(db,w);
   if(!h||h!==hash(gzipSync(JSON.stringify(w),{level:1})))throw Error('ordinary_multi_fruit_head');
   if(!manifest(db)){
    db.exec(MANIFEST_DDL);
    db.prepare('INSERT INTO main.'+MANIFEST+' VALUES(1,?)').run(binding);
   }
   for(const [i,s] of pin.sites.entries())advanceLot(db,nativePin(s),prior,w,flow,SLOT_NAMES[i]);
   if(digestHead(db,w)!==h||!manifest(db))throw Error('ordinary_multi_fruit_readback');
  },
  inspect(db:DatabaseSync,w:World){
   if(isolated||!db.isTransaction||w.id!==pin.worldId||Object.hasOwn(w,'mvpSeasonalModelVersion'))return null;
   try{
    if(!manifest(db)||!pin.sites.every(s=>matching(w,s)))return null;
    const h=digestHead(db,w);
    if(!h||h!==hash(gzipSync(JSON.stringify(w),{level:1})))return null;
    const lots=pin.sites.flatMap((s,i)=>{
     const lot=readLot(db,nativePin(s),w,SLOT_NAMES[i]);
     return lot?[Object.freeze({...lot,sourceAt:Object.freeze({x:s.x,y:s.y})})]:[];
    });
    guard();
    return Object.freeze({status:'ordinary-native-multiple-source-coverage' as const,worldId:w.id,revision:w.revision,
     atUs:minuteToClimateUs(w.minute),lots:Object.freeze(lots),selectionAuthorized:false as const,executionAuthorized:false as const});
   }catch{isolated=true;return null;}
  },
  consumeDevelopmentV3(db:DatabaseSync,before:World,after:World,origin:OrdinaryG2DevelopmentOrigin,
   reviewer:OrdinaryDevelopmentV3Pin,proof:NonNullable<ReturnType<ReturnType<typeof openSelectedOrdinaryRehearsal>['currentPositive']>>,
   input:unknown){
   const a=ownsSelectedPositiveRehearsal(proof)&&verifyOrdinaryDevelopmentV3(input,origin,reviewer);
   if(!a||a.terms.reviewDigest!==proof.reviewDigest||a.terms.snapshot!==proof.snapshot||a.terms.headDigest!==proof.headDigest||
    a.terms.worldId!==before.id||a.terms.revision!==before.revision||a.terms.sourceId!==proof.evidence.offer.sourceId||
    a.terms.lotId!==proof.evidence.lot.lot.id)throw Error('ordinary_multi_fruit_v3_consumption_consent');
   const i=pin.sites.findIndex(site=>site.sourceId===a.terms.sourceId);
   if(isolated||i<0||!db.isTransaction||!manifest(db)||!available(db,SLOT_NAMES[i]))
    throw Error('ordinary_multi_fruit_v3_consumption_scope');
   consumeLot(db,nativePin(pin.sites[i]),before,after,a.terms.lotId,SLOT_NAMES[i]);
   guard();
  },
  isolate(){isolated=true;},
 });
}

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
function available(db:DatabaseSync){
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('worlds',?) OR lower(tbl_name) IN ('worlds',?)").get(table,table))
  throw Error('rules_native_renewal_temp_shadow');
 const found=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(!found)return false;
 if(found.type!=='table'||found.sql!==ddl||db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(tbl_name)=? AND type IN ('trigger','index')").get(table))
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
function stored(db:DatabaseSync):Renewal|LotCheckpoint {
 const rows=db.prepare(`SELECT slot,digest,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.${table} LIMIT 2`).all();
 if(rows.length!==1||rows[0].slot!==1||typeof rows[0].body!=='string'||hash(rows[0].body)!==rows[0].digest)
  throw Error('rules_native_renewal_corrupt');
 const p=JSON.parse(rows[0].body) as Renewal|LotCheckpoint;
 if(p?.schemaVersion===1? !valid(p):!validV2(p as LotCheckpoint))throw Error('rules_native_renewal_invalid');
 return p;
}
function put(db:DatabaseSync,exists:boolean,row:Renewal|LotCheckpoint){
 if(!exists)db.exec(ddl);
 const body=JSON.stringify(row);
 db.prepare(`INSERT INTO main.${table} VALUES (1,?,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body,digest=excluded.digest`).run(body,hash(body));
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
export function advanceRulesNativeFruitLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,prior:World,w:World,flow:MvpFruitFlowBatch){
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
 const exists=available(db),old=exists?stored(db):null;
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
 put(db,exists,row);
 if(JSON.stringify(stored(db))!==JSON.stringify(row))throw Error('rules_native_fruit_lot_readback');
}
export function readRulesNativeFruitLot(db:DatabaseSync,p:RulesNativeFruitRenewalPin,w:World){
 const r=source(w,p);
 if(!p.lotShelfLifeGameMinutes||!r||w.clock.paused||!available(db))return null;
 const row=stored(db);
 if(row.schemaVersion!==2||row.shelfLife!==p.lotShelfLifeGameMinutes||row.worldId!==w.id||row.sourceId!==p.sourceId||
  row.revision!==w.revision||row.worldDigest!==digestHead(db,w)||row.atUs!==w.mvpClimate?.lastUs||row.atUs!==minuteToClimateUs(w.minute)||
  row.x!==r.at.x||row.y!==r.at.y||row.balance!==r.amount||!row.lot)return null;
 return Object.freeze({status:'tracked_native_source_lot' as const,worldId:w.id,sourceId:p.sourceId,atUs:row.atUs,
  revision:w.revision,lot:Object.freeze({...row.lot}),otherStockUnitAgesKnown:false as const,
  groundCapability:false as const,selectionAuthorized:false as const,executionAuthorized:false as const});
}

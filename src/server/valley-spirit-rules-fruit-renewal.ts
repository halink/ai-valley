import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {isNativeMvpFruitRenewalWitness,type MvpFruitRenewalWitness} from '../world/mvp-resources.js';

const table='valley_spirit_rules_native_fruit_renewal';
const ddl='CREATE TABLE valley_spirit_rules_native_fruit_renewal(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL,digest TEXT NOT NULL)';
const worldPattern=/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u,sourcePattern=/^mvp-supply-fruit-[0-9]{1,12}$/u;
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const hex=/^[a-f0-9]{64}$/u;
export interface RulesNativeFruitRenewalPin{
 readonly worldId:string;readonly sourceId:string;
}
export function pinRulesNativeFruitRenewal(v:unknown):RulesNativeFruitRenewalPin|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2||!Object.hasOwn(v,'worldId')||!Object.hasOwn(v,'sourceId'))return null;
  const p=v as RulesNativeFruitRenewalPin;
  return typeof p.worldId==='string'&&worldPattern.test(p.worldId)&&typeof p.sourceId==='string'&&sourcePattern.test(p.sourceId)?
   Object.freeze({worldId:p.worldId,sourceId:p.sourceId}):null;
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
function stored(db:DatabaseSync):Renewal|null {
 const rows=db.prepare(`SELECT slot,digest,CASE WHEN length(CAST(body AS BLOB))<=2048 THEN body END AS body FROM main.${table} LIMIT 2`).all();
 if(rows.length!==1||rows[0].slot!==1||typeof rows[0].body!=='string'||hash(rows[0].body)!==rows[0].digest)
  throw Error('rules_native_renewal_corrupt');
 const p=JSON.parse(rows[0].body) as Renewal;
 if(!valid(p))throw Error('rules_native_renewal_invalid');
 return p;
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
 if(old&&(old.worldId!==p.worldId||old.sourceId!==p.sourceId||old.revision>prior.revision))throw Error('rules_native_renewal_lineage');
 const row:Renewal={schemaVersion:1,worldId:p.worldId,sourceId:p.sourceId,x:current.at.x,y:current.at.y,
  fromRevision:prior.revision,revision:w.revision,creditedAtUs:v.atUs,openingQuantity:one.amount,beforeNaturalCredit:v.amountBefore,
  closingQuantity:current.amount,grossNaturalRenewal:v.naturallyRenewed,scalarNetChange:current.amount-one.amount,worldDigest};
 if(!valid(row))throw Error('rules_native_renewal_invalid');
 if(!exists)db.exec(ddl);
 const body=JSON.stringify(row);
 db.prepare(`INSERT INTO main.${table} VALUES (1,?,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body,digest=excluded.digest`).run(body,hash(body));
 if(!readRulesNativeFruitRenewal(db,p,w))throw Error('rules_native_renewal_readback');
}
export function readRulesNativeFruitRenewal(db:DatabaseSync,p:RulesNativeFruitRenewalPin,w:World){
 const r=source(w,p);
 if(!r||w.clock.paused||!available(db))return null;
 const row=stored(db);
 if(!row||row.worldId!==w.id||row.sourceId!==p.sourceId||row.revision!==w.revision||row.worldDigest!==digestHead(db,w)||
  row.creditedAtUs!==minuteToClimateUs(w.minute)||row.creditedAtUs!==w.mvpClimate?.lastUs||row.x!==r.at.x||row.y!==r.at.y||
  row.closingQuantity!==r.amount)return null;
 const {worldDigest:_private,...evidence}=row;
 return Object.freeze({status:'native_renewal_credit' as const,...evidence,stockUnitAgesKnown:false as const,
  groundCapability:false as const,executionAuthorized:false as const});
}

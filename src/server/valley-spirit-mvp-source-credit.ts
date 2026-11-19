import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {minuteToClimateUs,parseClimateUs} from '../world/mvp-climate.js';
import {isNativeMvpFruitRenewalWitness,type MvpFruitRenewalWitness} from '../world/mvp-resources.js';
import type {World} from '../shared/types.js';

const table='valley_spirit_sealed_source_credit';
const schema='CREATE TABLE valley_spirit_sealed_source_credit(slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1),body TEXT NOT NULL)';
const worldId=/^godot-mvp-[A-Za-z0-9_-]{1,180}$/;
const sourceId=/^mvp-supply-fruit-[0-9]{1,12}$/;
const hex=/^[0-9a-f]{64}$/;
const natural=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
interface StoredCredit {
 readonly schemaVersion:1;readonly worldId:string;readonly fromRevision:number;readonly revision:number;
 readonly bornUs:string;readonly sourceId:string;readonly x:number;readonly y:number;
 readonly amountBefore:number;readonly amountAfter:number;readonly credited:number;readonly headDigest:string;readonly sealDigest:string;
}
export type SealedMvpSourceCredit=Omit<StoredCredit,'headDigest'|'sealDigest'>;
const fields=['schemaVersion','worldId','fromRevision','revision','bornUs','sourceId','x','y','amountBefore','amountAfter','credited','headDigest','sealDigest'] as const;
function validate(c:StoredCredit):void {
 if(!c||Object.keys(c).length!==fields.length||fields.some(key=>!Object.hasOwn(c,key))||
  c.schemaVersion!==1||typeof c.worldId!=='string'||!worldId.test(c.worldId)||
  typeof c.sourceId!=='string'||!sourceId.test(c.sourceId)||!natural(c.x)||!natural(c.y)||
  !natural(c.fromRevision)||!natural(c.revision)||c.fromRevision>=c.revision||
  !natural(c.amountBefore)||!natural(c.amountAfter)||!natural(c.credited)||c.credited===0||
  c.amountAfter-c.amountBefore!==c.credited||typeof c.headDigest!=='string'||!hex.test(c.headDigest)||
  typeof c.sealDigest!=='string'||!hex.test(c.sealDigest)||parseClimateUs(c.bornUs)<=0n)throw Error('invalid_sealed_source_credit');
}
function stored(db:DatabaseSync):StoredCredit|null {
 const entry=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=? COLLATE NOCASE').get(table);
 if(!entry)return null;
 const cols=db.prepare('PRAGMA table_info(valley_spirit_sealed_source_credit)').all();
 if(entry.type!=='table'||entry.sql!==schema||cols.length!==2||
  cols[0].name!=='slot'||cols[0].type!=='INTEGER'||cols[0].pk!==1||cols[0].notnull!==1||
  cols[1].name!=='body'||cols[1].type!=='TEXT'||cols[1].pk!==0||cols[1].notnull!==1||
  db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type IN ('trigger','index')").get(table))
  throw Error('unknown_sealed_source_credit_schema');
 const rows=db.prepare('SELECT slot, length(body) AS size FROM valley_spirit_sealed_source_credit LIMIT 2').all();
 if(rows.length!==1||rows[0].slot!==1||!natural(rows[0].size)||rows[0].size>2048)throw Error('invalid_sealed_source_credit_slot');
 const row=db.prepare('SELECT body FROM valley_spirit_sealed_source_credit WHERE slot=1').get();
 if(typeof row?.body!=='string')throw Error('invalid_sealed_source_credit_body');
 const credit=JSON.parse(row.body) as StoredCredit;validate(credit);return credit;
}
function exactHeadDigest(db:DatabaseSync,w:World):string {
 const row=db.prepare('SELECT revision,state FROM worlds WHERE id=?').get(w.id);
 if(row?.revision!==w.revision||!(typeof row.state==='string'||row.state instanceof Uint8Array))throw Error('sealed_source_credit_head');
 return digest(row.state);
}
function publicShape({headDigest:_head,sealDigest:_seal,...credit}:StoredCredit):SealedMvpSourceCredit {
 return Object.freeze(credit);
}
/** Called only by the isolated owner under the same lock as the native commit.
 * No authority to reserve, transfer or calculate a shelf-life from this fact. */
export function writeSealedMvpSourceCredit(
 db:DatabaseSync,seal:string,previous:World,head:World,witness:MvpFruitRenewalWitness,
):SealedMvpSourceCredit {
 if(!isNativeMvpFruitRenewalWitness(witness)||head.id!==previous.id||head.id!==witness.worldId||
  head.mode!=='validation'||head.revision!==witness.worldRevision||head.minute!==previous.minute+1||
  witness.atUs!==minuteToClimateUs(head.minute)||witness.atUs!==head.mvpClimate?.lastUs)
  throw Error('unproven_sealed_source_credit');
 const sameSource=(r:World['resources'][number])=>r.id===witness.sourceId&&r.kind==='bush'&&r.foodItem==='fruit'&&
  r.at.x===witness.sourceAt.x&&r.at.y===witness.sourceAt.y;
 const source=head.resources.filter(sameSource),opening=previous.resources.filter(sameSource);
 if(source.length!==1||opening.length!==1||source[0].amount!==witness.amountAfter||
  source[0].max!==opening[0].max||opening[0].amount<witness.amountBefore||
  !head.mvpResources?.renewal[witness.sourceId])
  throw Error('sealed_source_credit_source_mismatch');
 const sealDigest=digest(seal),old=stored(db);
 if(old&&(old.worldId!==head.id||old.sealDigest!==sealDigest||old.revision>previous.revision))throw Error('sealed_source_credit_lineage');
 const credit:StoredCredit={schemaVersion:1,worldId:head.id,fromRevision:previous.revision,revision:head.revision,
  bornUs:witness.atUs,sourceId:witness.sourceId,x:witness.sourceAt.x,y:witness.sourceAt.y,
  amountBefore:witness.amountBefore,amountAfter:witness.amountAfter,credited:witness.naturallyRenewed,
  headDigest:exactHeadDigest(db,head),sealDigest};
 validate(credit);
 if(!old)db.exec(schema);
 db.prepare('INSERT INTO valley_spirit_sealed_source_credit(slot,body) VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body').run(JSON.stringify(credit));
 return publicShape(credit);
}

/** Single latest checkpoint only; an advanced world means no current proof. */
function currentCredit(db:DatabaseSync,seal:string,world:World):StoredCredit|null {
 const credit=stored(db);
 if(!credit||credit.worldId!==world.id||credit.sealDigest!==digest(seal)||credit.revision!==world.revision||
  credit.bornUs!==world.mvpClimate?.lastUs||credit.bornUs!==minuteToClimateUs(world.minute)||
  credit.headDigest!==exactHeadDigest(db,world))return null;
 const source=world.resources.filter(r=>r.id===credit.sourceId);
 if(source.length!==1||source[0].kind!=='bush'||source[0].foodItem!=='fruit'||
  source[0].at.x!==credit.x||source[0].at.y!==credit.y||source[0].amount!==credit.amountAfter)return null;
 return credit;
}
export function readCurrentSealedMvpSourceCredit(db:DatabaseSync,seal:string,world:World):SealedMvpSourceCredit|null {
 const c=currentCredit(db,seal,world);
 return c?publicShape(c):null;
}
/** The commitment includes the private database scope and exact persisted head;
 * the signing input never reveals the raw seal or raw head hash. */
export function readCurrentSealedMvpSourceCommitment(db:DatabaseSync,seal:string,world:World){
 const c=currentCredit(db,seal,world);
 if(!c)return null;
 const creditId=digest(JSON.stringify(['valley-spirit-sealed-source-credit/v1',...fields.map(field=>c[field])]));
 return {worldId:c.worldId,creditId,bornUs:c.bornUs};
}

import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {parseClimateUs,minuteToClimateUs} from '../world/mvp-climate.js';
import {ordinaryAgedG1ReviewSigningBytes} from './valley-spirit-ordinary-aged-g1-review.js';
import {readValleySpiritWeatherPermission} from './valley-spirit-permissions.js';
import {decodeSavedWorld} from './save-preflight.js';
import type {World} from '../shared/types.js';

export const ORDINARY_G1_DECISION_PURPOSE='ordinary-rules-aged-g1-detached-decision/v1' as const;
const table='valley_spirit_ordinary_g1_decisions',meta='valley_spirit_ordinary_g1_decisions/v1';
const MAX=32, MAX_BYTES=8192, EPOCH_ROW='!epoch';
const fields=['purpose','worldId','saveScope','revision','atUs','untilUs','headDigest','epoch','reviewerKeyId','permissionVersion',
 'proposalId','opportunityId','inputSnapshotId','sourceLotId','targetId','reviewDigest','rehearsalDigest','outcome'] as const;
export type OrdinaryG1DecisionTerms=Readonly<{
 purpose:typeof ORDINARY_G1_DECISION_PURPOSE;worldId:string;saveScope:string;revision:number;atUs:string;untilUs:string;
 headDigest:string;epoch:number;reviewerKeyId:string;permissionVersion:number;proposalId:string;opportunityId:string;
 inputSnapshotId:string;sourceLotId:string;targetId:string;reviewDigest:string;rehearsalDigest:string;outcome:'validated_detached';
}>;
const exact=(o:unknown,k:readonly string[]):o is Record<string,unknown>=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const integer=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const hex=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const token=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/u.test(v);
export const ordinaryG1DecisionHash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
export const ordinaryG1DecisionDigest=(v:unknown)=>ordinaryG1DecisionHash(JSON.stringify(v));
export function ordinaryAgedG1DecisionSigningBytes(v:unknown):Buffer|null {
 try{
  if(!exact(v,fields)||v.purpose!==ORDINARY_G1_DECISION_PURPOSE||v.outcome!=='validated_detached'||
   typeof v.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u.test(v.worldId)||
   !integer(v.revision)||!integer(v.epoch)||!integer(v.permissionVersion,1)||
   ![v.saveScope,v.headDigest,v.reviewerKeyId,v.reviewDigest,v.rehearsalDigest].every(hex)||
   ![v.proposalId,v.opportunityId,v.inputSnapshotId,v.sourceLotId,v.targetId].every(token)||
   typeof v.atUs!=='string'||typeof v.untilUs!=='string')return null;
  const a=parseClimateUs(v.atUs),b=parseClimateUs(v.untilUs);
  if(b<=a||b-a>60_000_000n)return null;
  return Buffer.from(JSON.stringify(fields.map(k=>v[k])));
 }catch{return null;}
}
function signatureBytes(v:unknown):Buffer|null{
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(v))return null;
 const bytes=Buffer.from(v,'base64url');
 return bytes.length===64&&bytes.toString('base64url')===v?bytes:null;
}
export function ordinaryG1DecisionReviewDigest(v:unknown){
 if(!exact(v,['terms','signature']))return null;
 const terms=ordinaryAgedG1ReviewSigningBytes(v.terms),signature=signatureBytes(v.signature);
 return terms&&signature?ordinaryG1DecisionDigest([terms.toString('base64url'),v.signature]):null;
}
export function ordinaryG1DecisionSaveScope(database:string){
 const info=lstatSync(database,{bigint:true});
 return info.isFile()&&info.nlink===1n?ordinaryG1DecisionDigest([ORDINARY_G1_DECISION_PURPOSE,info.dev.toString(),info.ino.toString()]):null;
}
export function readOrdinaryG1DecisionHead(db:DatabaseSync,database:string,worldId:string){
 const saveScope=ordinaryG1DecisionSaveScope(database);
 if(!saveScope)return null;
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),row=rows[0];
 if(rows.length!==1||row.id!==worldId||!integer(row.revision)||!(row.state instanceof Uint8Array))return null;
 const w=decodeSavedWorld(row.state) as unknown as World;
 if(w.id!==worldId||w.revision!==row.revision||w.clock.paused||w.mode!=='validation'||
  Object.hasOwn(w,'simulationOnly')||Object.hasOwn(w,'mvpSeasonalModelVersion'))return null;
 const grant=readValleySpiritWeatherPermission(db,worldId);
 if(!grant?.publicWeather)return null;
 return {worldId,revision:w.revision,atUs:minuteToClimateUs(w.minute),headDigest:ordinaryG1DecisionHash(row.state),
  saveScope,permissionVersion:grant.version};
}
type Row={id:string;body:string};
type Anchor={schema:1;epoch:number;reviewerKeyId:string;rowsDigest:string};
type RecordBody={terms:OrdinaryG1DecisionTerms;signature:string;review:unknown;reviewerDer:string};
function checkRecord(row:Row):RecordBody {
 const value:unknown=JSON.parse(row.body);
 if(!exact(value,['terms','signature','review','reviewerDer'])||typeof value.reviewerDer!=='string'||
   !/^[A-Za-z0-9_-]{59}$/u.test(value.reviewerDer)||JSON.stringify(value)!==row.body)throw Error('ordinary_g1_decision_record');
 const r=value as RecordBody,der=Buffer.from(r.reviewerDer,'base64url'),key=createPublicKey({key:der,format:'der',type:'spki'});
 const bytes=ordinaryAgedG1DecisionSigningBytes(r.terms),sig=signatureBytes(r.signature);
 const old=exact(r.review,['terms','signature'])?r.review:null;
 const oldTerms=old&&ordinaryAgedG1ReviewSigningBytes(old.terms),oldSig=old&&signatureBytes(old.signature);
 const oldValues=old?.terms as Partial<OrdinaryG1DecisionTerms>|undefined,t=r.terms;
 if(der.toString('base64url')!==r.reviewerDer||key.asymmetricKeyType!=='ed25519'||!key.export({type:'spki',format:'der'}).equals(der)||!bytes||!sig||
  row.id!==ordinaryG1DecisionHash(bytes)||ordinaryG1DecisionHash(der)!==t.reviewerKeyId||
  !old||!oldTerms||!oldSig||!verify(null,oldTerms,key,oldSig)||!verify(null,bytes,key,sig)||
  ordinaryG1DecisionReviewDigest(old)!==t.reviewDigest||!exact(old.terms,['purpose','worldId','revision','atUs','untilUs','epoch','reviewerKeyId','basisDigest'])||
  (['worldId','revision','atUs','untilUs','epoch','reviewerKeyId'] as const).some(k=>oldValues?.[k]!==t[k]))
  throw Error('ordinary_g1_decision_record_signature');
 return r;
}
function archive(db:DatabaseSync,head:Pick<OrdinaryG1DecisionTerms,'worldId'|'saveScope'>){
 // Reject a changed write surface before touching optional state. No default
 // schema or SQL trigger is needed by this annex or its companion anchor.
 if(db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='trigger' AND tbl_name IN (?, 'archive_meta') LIMIT 1").get(table))
  throw Error('ordinary_g1_decision_archive_trigger');
 const obj=db.prepare('SELECT type FROM main.sqlite_master WHERE name=?').get(table);
 const mark=db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(meta);
 if(!obj&&!mark)return {anchor:null,rows:[] as Row[],records:[] as RecordBody[]};
 const cols=db.prepare(`PRAGMA main.table_info(${table})`).all();
 if(obj?.type!=='table'||typeof mark?.value!=='string'||mark.value.length>256||cols.length!==2||
  cols.some((c,i)=>c.name!==['id','body'][i]||c.type!=='TEXT'||c.pk!==Number(i===0)||c.notnull!==1))
  throw Error('ordinary_g1_decision_archive_shape');
 const a:unknown=JSON.parse(mark.value);
 if(!exact(a,['schema','epoch','reviewerKeyId','rowsDigest'])||a.schema!==1||!integer(a.epoch)||!hex(a.reviewerKeyId)||!hex(a.rowsDigest)||
  JSON.stringify(a)!==mark.value)throw Error('ordinary_g1_decision_anchor_shape');
 const anchor=a as Anchor;
 const raw=db.prepare(`SELECT id,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM main.${table} ORDER BY id LIMIT ?`).all(MAX_BYTES,MAX+2);
 // Epoch rotations may exist without any new signed decision, so the
 // exact high-water bytes have an in-annex counterpart to the metadata
 // anchor. One-sided loss or rewind is not a fresh valid reviewer scope.
 const [epochRow,...decisions]=raw;
 if(epochRow?.id!==EPOCH_ROW||epochRow.body!==mark.value||!decisions.length||
  decisions.length>MAX||decisions.some(r=>!hex(r.id)||typeof r.body!=='string'))
  throw Error('ordinary_g1_decision_archive_limit');
 const rows=decisions as Row[];
 if(ordinaryG1DecisionDigest(rows)!==anchor.rowsDigest)throw Error('ordinary_g1_decision_archive_anchor');
 const records=rows.map(checkRecord);
 if(records.some(({terms})=>terms.worldId!==head.worldId||terms.saveScope!==head.saveScope||
  terms.epoch>anchor.epoch||terms.epoch===anchor.epoch&&terms.reviewerKeyId!==anchor.reviewerKeyId))
  throw Error('ordinary_g1_decision_archive_owner');
 return {anchor,rows,records};
}
function writeAnchor(db:DatabaseSync,a:Anchor){
 const raw=JSON.stringify(a);
 db.prepare(`INSERT INTO main.${table}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(EPOCH_ROW,raw);
 db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(meta,raw);
}
/** Only for the stopped owner opening the ordinary scope. An observed trusted
 * reviewer rotation cannot revive older verdicts after a later owner reopen;
 * no annex is created just for an unreviewed save. */
export function advanceOrdinaryG1DecisionEpoch(db:DatabaseSync,head:Pick<OrdinaryG1DecisionTerms,'worldId'|'saveScope'>,epoch:number,reviewerKeyId:string){
 if(!db.isTransaction||!integer(epoch)||!hex(reviewerKeyId))return false;
 const {anchor}=archive(db,head);
 if(!anchor)return true;
 if(epoch<anchor.epoch||epoch===anchor.epoch&&reviewerKeyId!==anchor.reviewerKeyId)return false;
 if(epoch===anchor.epoch)return true;
 const next={...anchor,epoch,reviewerKeyId};
 writeAnchor(db,next);
 if(JSON.stringify(archive(db,head).anchor)!==JSON.stringify(next))throw Error('ordinary_g1_decision_epoch_readback');
 return true;
}
export function readOrdinaryG1DecisionRecord(db:DatabaseSync,head:NonNullable<ReturnType<typeof readOrdinaryG1DecisionHead>>,epoch:number,keyId:string){
 const {anchor,records}=archive(db,head);
 if(anchor&&(anchor.epoch!==epoch||anchor.reviewerKeyId!==keyId))throw Error('ordinary_g1_decision_epoch_mismatch');
 const visible=records.filter(({terms:t})=>t.worldId===head.worldId&&t.saveScope===head.saveScope&&t.revision===head.revision&&
  t.atUs===head.atUs&&t.headDigest===head.headDigest&&t.permissionVersion===head.permissionVersion&&t.epoch===epoch&&t.reviewerKeyId===keyId);
 if(visible.length>1)throw Error('ordinary_g1_decision_duplicate_head');
 return visible[0]??null;
}
/** An append-only, bounded optional annex. Caller owns an IMMEDIATE transaction and
 * supplies the already reverified live G1 proof; its rows grant no authority. */
export function appendOrdinaryG1Decision(db:DatabaseSync,terms:OrdinaryG1DecisionTerms,review:unknown,approval:unknown,key:KeyObject){
 if(!db.isTransaction||!exact(approval,['terms','signature']))return null;
 const bytes=ordinaryAgedG1DecisionSigningBytes(terms),candidate=ordinaryAgedG1DecisionSigningBytes(approval.terms),signature=signatureBytes(approval.signature);
 if(!bytes||!candidate||!candidate.equals(bytes)||!signature||!verify(null,bytes,key,signature)||typeof approval.signature!=='string')return null;
 const id=ordinaryG1DecisionHash(bytes),raw={terms,signature:approval.signature,review,reviewerDer:key.export({type:'spki',format:'der'}).toString('base64url')};
 const row={id,body:JSON.stringify(raw)};
 if(Buffer.byteLength(row.body)>MAX_BYTES)return null;
 checkRecord(row);
 const previous=archive(db,terms),existing=previous.rows.find(r=>r.id===id);
 if(previous.anchor&&(previous.anchor.epoch!==terms.epoch||previous.anchor.reviewerKeyId!==terms.reviewerKeyId))return null;
 if(existing){
  // Preserve the original bytes: differently ordered but valid caller terms
  // never append again nor overwrite the first acknowledged review.
  return {id,replay:true as const};
 }
 if(previous.rows.length>=MAX||previous.records.some(({terms:t})=>t.worldId===terms.worldId&&t.saveScope===terms.saveScope&&
  t.revision===terms.revision&&t.atUs===terms.atUs&&t.headDigest===terms.headDigest&&t.permissionVersion===terms.permissionVersion&&
  t.epoch===terms.epoch&&t.reviewerKeyId===terms.reviewerKeyId))return null;
 if(!previous.anchor)db.exec(`CREATE TABLE main.${table} (id TEXT PRIMARY KEY NOT NULL,body TEXT NOT NULL)`);
 db.prepare(`INSERT INTO main.${table}(id,body) VALUES(?,?)`).run(id,row.body);
 const rowsDigest=ordinaryG1DecisionDigest([...previous.rows,row].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
 writeAnchor(db,{schema:1,epoch:terms.epoch,reviewerKeyId:terms.reviewerKeyId,rowsDigest});
 const after=archive(db,terms);
 if(after.rows.length!==previous.rows.length+1||!after.rows.some(r=>r.id===id&&r.body===row.body))throw Error('ordinary_g1_decision_readback');
 return {id,replay:false as const};
}

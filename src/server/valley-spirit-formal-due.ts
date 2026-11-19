import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import type {FormalBerryFixtureEffect,FormalBerryGroundFoodBirth} from './valley-spirit-formal-berry-authority.js';
import type {FormalBerryDetachedReceipt} from './valley-spirit-formal-berry-draft.js';
import {formalShadowApprovalBasis,type readFormalShadowRows} from './valley-spirit-formal-shadow-custody.js';

const LIMIT=64,table='formal_shadow_due';
const sql='CREATE TABLE '+table+' (schedule_id TEXT PRIMARY KEY NOT NULL, intent TEXT NOT NULL, checkpoint TEXT)';
const key='formal_shadow_due_v1';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const revision=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export type ShadowRow=ReturnType<typeof readFormalShadowRows>[number];
export interface FormalDueIntent {
 readonly schema:'formal-due-intent/v1';readonly id:string;readonly worldId:string;readonly proposalId:string;
 readonly opportunityId:string;readonly permissionVersion:number;readonly shadowBasisDigest:string;
 readonly recordedMinute:number;readonly recordedRevision:number;readonly notBefore:number;readonly expiresAt:number;
 readonly executionAuthorized:false;
}
interface Inputs {proposalId:string;notBefore:number;expiresAt:number}
export function formalDueInputs(v:unknown):v is Inputs{
 return exact(v,['proposalId','notBefore','expiresAt'])&&typeof v.proposalId==='string'&&/^formal-shadow:[a-f0-9]{64}$/u.test(v.proposalId)&&
  minute(v.notBefore)&&minute(v.expiresAt)&&v.notBefore<v.expiresAt;
}
export interface FormalDueCheckpoint {
 readonly schema:'formal-due-checkpoint/v1';readonly scheduleId:string;readonly atRevision:number;readonly atMinute:number;
 readonly evidenceDigest:string;readonly sourceBefore:number;readonly foodDefinition:string;readonly foodExpiresAt:number;
 readonly executionAuthorized:false;
}
const makeIntent=(w:Pick<World,'id'|'revision'|'minute'>,row:ShadowRow,input:Inputs):FormalDueIntent=>{
 const p=row.proposal!;
 return {schema:'formal-due-intent/v1',id:'formal-due:'+digest([w.id,p.opportunityId]),worldId:w.id,proposalId:p.proposalId,
  opportunityId:p.opportunityId,permissionVersion:p.permissionVersion,shadowBasisDigest:formalShadowApprovalBasis(row)!,
  recordedMinute:w.minute,recordedRevision:w.revision,notBefore:input.notBefore,expiresAt:input.expiresAt,executionAuthorized:false};
};
export function prepareFormalDueIntent(w:World,row:ShadowRow|undefined,input:Inputs){
 const p=row?.proposal;
 if(!row||!p||row.permission.terms.decision!=='allow'||p.proposalId!==input.proposalId||p.atRevision!==w.revision||
  p.atMinute!==w.minute||w.clock.paused||w.weather!=='sun'||w.formalRainProvenance?.open||
  w.formalRainProvenance?.closed.at(-1)?.episodeId!==p.episodeId||
  input.notBefore<=w.minute||input.expiresAt>p.expiresAt)return null;
 return makeIntent(w,row,input);
}
export function formalDueCurrent(w:World,intent:FormalDueIntent,row:ShadowRow|undefined,effects:readonly FormalBerryFixtureEffect[]){
 if(effects.some(e=>e.receipt.draftId===intent.opportunityId))return 'consumed' as const;
 if(w.minute>=intent.expiresAt)return 'expired' as const;
 const p=row?.proposal;
 if(!row||!p||row.permission.terms.decision!=='allow'||p.proposalId!==intent.proposalId||
  formalShadowApprovalBasis(row)!==intent.shadowBasisDigest)return 'revoked' as const;
 if(w.clock.paused||w.weather!=='sun'||w.formalRainProvenance?.open||
  w.formalRainProvenance?.closed.at(-1)?.episodeId!==p.episodeId)return 'blocked' as const;
 if(w.minute<intent.notBefore)return 'pending' as const;
 if(w.revision<=intent.recordedRevision)return 'blocked' as const;
 return 'due' as const;
}
export function makeFormalDueCheckpoint(intent:FormalDueIntent,receipt:FormalBerryDetachedReceipt,
 food:FormalBerryGroundFoodBirth,capacity:Readonly<{worldLots:number;lotsPerTarget:number}>):FormalDueCheckpoint{
 return {schema:'formal-due-checkpoint/v1',scheduleId:intent.id,atRevision:receipt.atRevision,atMinute:receipt.placedMinute,
  evidenceDigest:digest(['formal-due-evidence/v1',intent,receipt,food,capacity.worldLots,capacity.lotsPerTarget]),
  sourceBefore:receipt.sourceBefore,foodDefinition:food.definition,foodExpiresAt:food.expiresAt,executionAuthorized:false};
}

const schema=(db:DatabaseSync)=>{
 const row=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name IN (?, 'archive_meta') COLLATE NOCASE").get(table)||
  db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE name IN (?, 'archive_meta') COLLATE NOCASE OR tbl_name IN (?, 'archive_meta') COLLATE NOCASE").get(table,table)||
  row&&(row.type!=='table'||row.sql!==sql))throw Error('formal_due_schema');
 const saved=db.prepare('SELECT value FROM archive_meta WHERE key=?').get(key);
 if(!!row!==!!saved)throw Error('formal_due_anchor_missing');
 return saved?.value??null;
};
const raw=(db:DatabaseSync)=>db.prepare("SELECT schedule_id, CASE WHEN length(CAST(intent AS BLOB))<=4096 THEN intent END AS intent, "+
 "CASE WHEN length(CAST(checkpoint AS BLOB))<=4096 THEN checkpoint END AS checkpoint, checkpoint IS NULL AS empty "+
 "FROM formal_shadow_due ORDER BY schedule_id LIMIT ?").all(LIMIT+1);
const body=(rows:ReturnType<typeof raw>)=>digest(rows.map(r=>[r.schedule_id,r.intent,r.checkpoint,r.empty]));
export function readFormalDueRows(db:DatabaseSync,w:World,shadow:readonly ShadowRow[]){
 const saved=schema(db);if(saved===null)return [];
 const rows=raw(db);
 if(rows.length>LIMIT||saved!==body(rows))throw Error('formal_due_anchor_mismatch');
 return rows.map(value=>{
  if(typeof value.intent!=='string'||value.empty!==1&&typeof value.checkpoint!=='string')throw Error('formal_due_encoding');
  const i=JSON.parse(value.intent) as FormalDueIntent;
  const row=shadow.find(r=>r.proposal?.proposalId===i?.proposalId),p=row?.proposal;
  if(!row||!p||!revision(i.recordedRevision)||i.recordedRevision!==p.atRevision||i.recordedRevision>w.revision||
   !minute(i.recordedMinute)||i.recordedMinute!==p.atMinute||i.recordedMinute>w.minute||
   !minute(i.notBefore)||!minute(i.expiresAt)||i.notBefore<=i.recordedMinute||i.notBefore>=i.expiresAt||i.expiresAt>p.expiresAt||
   value.schedule_id!==i.id||value.intent!==JSON.stringify(makeIntent({id:w.id,revision:i.recordedRevision,minute:i.recordedMinute},row,i)))
   throw Error('formal_due_intent');
  const c:unknown=typeof value.checkpoint==='string'?JSON.parse(value.checkpoint):null;
  if(value.empty!==1&&(!exact(c,['schema','scheduleId','atRevision','atMinute','evidenceDigest','sourceBefore','foodDefinition','foodExpiresAt','executionAuthorized'])||
   c.schema!=='formal-due-checkpoint/v1'||c.scheduleId!==i.id||!revision(c.atRevision)||c.atRevision<=i.recordedRevision||c.atRevision>w.revision||
   !minute(c.atMinute)||c.atMinute<i.notBefore||c.atMinute>=i.expiresAt||c.atMinute>w.minute||
   typeof c.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/u.test(c.evidenceDigest)||!revision(c.sourceBefore)||c.sourceBefore<1||
   typeof c.foodDefinition!=='string'||!/^food\/life@[1-9][0-9]*$/u.test(c.foodDefinition)||
   !minute(c.foodExpiresAt)||c.foodExpiresAt<=c.atMinute||c.executionAuthorized!==false))throw Error('formal_due_checkpoint');
  return {intent:i,checkpoint:c as FormalDueCheckpoint|null};
 });
}
function anchor(db:DatabaseSync){
 const rows=raw(db);
 if(rows.length>LIMIT||db.prepare('UPDATE archive_meta SET value=? WHERE key=?').run(body(rows),key).changes!==1)
  throw Error('formal_due_capacity');
}
export function appendFormalDueIntent(db:DatabaseSync,intent:FormalDueIntent){
 if(schema(db)===null){
  db.exec(sql);
  db.prepare('INSERT INTO archive_meta (key,value) VALUES (?,?)').run(key,body([]));
 }
 db.prepare('INSERT INTO formal_shadow_due (schedule_id,intent) VALUES (?,?)').run(intent.id,JSON.stringify(intent));
 anchor(db);
}
export function writeFormalDueCheckpoint(db:DatabaseSync,checkpoint:FormalDueCheckpoint){
 if(schema(db)===null||db.prepare('UPDATE formal_shadow_due SET checkpoint=? WHERE schedule_id=?')
  .run(JSON.stringify(checkpoint),checkpoint.scheduleId).changes!==1)throw Error('formal_due_missing');
 anchor(db);
}

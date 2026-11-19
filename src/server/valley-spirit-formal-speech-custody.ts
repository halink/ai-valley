import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World,WorldEvent} from '../shared/types.js';
import {formalAddressedSpeechProof,type FormalAddressedSpeechProof} from '../world/addressed-speech.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';

const table='valley_spirit_formal_speech_custody';
const ddl='CREATE TABLE valley_spirit_formal_speech_custody(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,plan_id TEXT NOT NULL,action_index INTEGER NOT NULL,committed_revision INTEGER NOT NULL,body TEXT NOT NULL,evidence_hash TEXT NOT NULL,receipt_id TEXT UNIQUE NOT NULL,UNIQUE(world_id,plan_id,action_index))';
const limit=4096;
const worldPattern=/^valley-formal-(?:frontier-)?[0-9]{1,16}$/;
const id=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/.test(s);
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const finiteMinute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9&&!Object.is(v,-0);
const keys=['schemaVersion','kind','worldId','eventId','eventRevision','planId','actionType','actionIndexFromEnd',
 'startedAt','deliveredAt','speakerId','intendedRecipientId','actualRecipientId'];
type Row={world_id:string;event_id:string;plan_id:string;action_index:number;committed_revision:number;body:string;evidence_hash:string;receipt_id:string};
function inspect(db:DatabaseSync){
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('worlds','events','receipts',?) OR lower(tbl_name) IN ('worlds','events','receipts',?)").get(table,table))
  throw Error('formal_speech_shadow_schema');
 const meta=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(!meta)return false;
 if(meta.type!=='table'||meta.sql!==ddl||db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(tbl_name)=? AND type='trigger'").get(table))
  throw Error('formal_speech_unknown_schema');
 return true;
}
function valid(p:FormalAddressedSpeechProof,w:string,event:string){
 return !!p&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k))&&
  p.schemaVersion===1&&p.kind==='addressed-speech-delivered'&&p.actionType==='talk'&&
  p.worldId===w&&p.eventId===event&&integer(p.eventRevision,1)&&event===w+':event:'+p.eventRevision&&
  id(p.planId)&&integer(p.actionIndexFromEnd)&&p.actionIndexFromEnd<=9&&finiteMinute(p.startedAt)&&finiteMinute(p.deliveredAt)&&
  p.startedAt<=p.deliveredAt&&id(p.speakerId)&&id(p.actualRecipientId)&&p.speakerId!==p.actualRecipientId&&
  p.actualRecipientId===p.intendedRecipientId;
}
function evidenceHash(db:DatabaseSync,p:FormalAddressedSpeechProof,body:string,committedRevision:number,receiptId:string,expectedEvent?:string){
 const row=db.prepare('SELECT at,CASE WHEN length(CAST(body AS BLOB))<=131072 THEN body END AS body FROM main.events WHERE id=? AND world_id=?').get(p.eventId,p.worldId);
 if(typeof row?.body!=='string'||row.at!==p.deliveredAt||expectedEvent!==undefined&&row.body!==expectedEvent)return null;
 const e=JSON.parse(row.body);
 if(e?.id!==p.eventId||e.at!==row.at||e.kind!=='conversation'||e.observerOnly===true||
  JSON.stringify(e.actors)!==JSON.stringify([p.speakerId,p.actualRecipientId])||
  !db.prepare('SELECT 1 FROM main.receipts WHERE world_id=? AND receipt=?').get(p.worldId,'plan:'+p.planId))return null;
 return createHash('sha256').update(JSON.stringify([row.body,body,committedRevision,receiptId])).digest('hex');
}
function stored(db:DatabaseSync,w:string,event:string,head:number){
 const row=db.prepare(`SELECT event_id,world_id,plan_id,action_index,committed_revision,evidence_hash,receipt_id,
  CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.${table} WHERE world_id=? AND event_id=?`)
  .get(w,event) as unknown as Row|undefined;
 if(!row||typeof row.body!=='string'||!uuid(row.receipt_id)||!integer(row.committed_revision,1)||row.committed_revision>head)return null;
 const p=JSON.parse(row.body) as FormalAddressedSpeechProof;
 if(!valid(p,w,event)||row.committed_revision<=p.eventRevision||row.plan_id!==p.planId||row.action_index!==p.actionIndexFromEnd||
  evidenceHash(db,p,row.body,row.committed_revision,row.receipt_id)!==row.evidence_hash)return null;
 return {row,p};
}
/** Same world transaction; errors are handled by the private optional savepoint. */
export function appendFormalAddressedSpeech(db:DatabaseSync,w:World,previous:World,events:readonly WorldEvent[]){
 if(db.isTransaction===false||w.mode!=='formal'||previous.mode!=='formal'||previous.id!==w.id||!worldPattern.test(w.id)||
  !integer(previous.revision)||!integer(w.revision,previous.revision+1)||!finiteMinute(previous.minute)||!finiteMinute(w.minute)||
  w.minute<=previous.minute||db.prepare('SELECT revision FROM main.worlds WHERE id=?').get(w.id)?.revision!==w.revision)
  throw Error('formal_speech_transaction');
 const batch=events.flatMap(e=>{const p=formalAddressedSpeechProof(w,e);return p?[{e,...p}]:[];});
 if(!batch.length)return;
 if(batch.length>64)throw Error('formal_speech_batch');
 if(!inspect(db))db.exec(ddl);
 const count=db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM main.${table} LIMIT ?)`).get(limit+1)?.n;
 if(!integer(count)||count+batch.length>limit)throw Error('formal_speech_capacity');
 const insert=db.prepare(`INSERT INTO main.${table} VALUES (?,?,?,?,?,?,?,?)`);
 for(const {e,proof:p,original} of batch){
  if(!valid(p,w.id,e.id)||p.eventRevision<=previous.revision||p.eventRevision>=w.revision||
   p.deliveredAt<=previous.minute||p.deliveredAt>w.minute||w.events.find(v=>v.id===e.id)!==e||original!==JSON.stringify(e))
   throw Error('formal_speech_witness_mismatch');
  const body=JSON.stringify(p),receiptId=randomUUID(),digest=evidenceHash(db,p,body,w.revision,receiptId,original);
  if(!digest||Buffer.byteLength(body)>4096)throw Error('formal_speech_archive_mismatch');
  insert.run(e.id,w.id,p.planId,p.actionIndexFromEnd,w.revision,body,digest,receiptId);
  if(!stored(db,w.id,e.id,w.revision))throw Error('formal_speech_write_unverified');
 }
}
/** Internal private read: no identity, transcript, disclosure or publication. */
export function readFormalAddressedSpeech(db:DatabaseSync,w:string,event:string){
 if(!worldPattern.test(w)||!id(event)||!event.startsWith(w+':event:'))return null;
 try{
  if(!inspect(db))return null;
  const head=db.prepare('SELECT revision FROM main.worlds WHERE id=?').get(w)?.revision;
  if(!integer(head,1))return null;
  const value=stored(db,w,event,head);
  return value?Object.freeze({schemaVersion:1 as const,kind:'addressed-speech-received' as const,
   receiptId:value.row.receipt_id,atUs:minuteToClimateUs(value.p.deliveredAt)}):null;
 }catch{return null;}
}

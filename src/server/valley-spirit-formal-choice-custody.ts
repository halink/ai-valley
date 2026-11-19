import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World,WorldEvent} from '../shared/types.js';
import {matchesNativeFormalAppointmentChoice,nativeFormalAppointmentChoice,type NativeFormalAppointmentChoice} from '../world/social-appointments.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';

const table='valley_spirit_formal_choice_custody';
const ddl='CREATE TABLE valley_spirit_formal_choice_custody(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,kind TEXT NOT NULL,appointment_id TEXT NOT NULL,committed_revision INTEGER NOT NULL,body TEXT NOT NULL,event_hash TEXT NOT NULL,UNIQUE(world_id,appointment_id,kind))';
const limit=4096, worldIdPattern=/^valley-formal-(?:frontier-)?[0-9]{1,16}$/;
const identifier=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const id=(v:unknown):v is string=>typeof v==='string'&&identifier.test(v);
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const keys=['kind','worldId','appointmentId','eventId','offeredEventId','actorId','counterpartId','planId','executionStartedAt','at','terms'];
const revision=(worldId:string,eventId:string)=>{
 const prefix=worldId+':event:',serial=eventId.slice(prefix.length);
 return eventId.startsWith(prefix)&&/^[1-9][0-9]{0,15}$/.test(serial)&&int(Number(serial))?Number(serial):null;
};
interface Row {event_id:string;world_id:string;kind:string;appointment_id:string;committed_revision:number;body:string;event_hash:string}
function inspect(db:DatabaseSync){
 if(db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN ('worlds','events','receipts',?) OR lower(tbl_name) IN ('worlds','events','receipts',?)").get(table,table))
  throw Error('formal_choice_shadow_schema');
 const meta=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(table);
 if(!meta)return false;
 if(meta.type!=='table'||meta.sql!==ddl||db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(tbl_name)=? AND type='trigger'").get(table))
  throw Error('formal_choice_unknown_schema');
 return true;
}
function archiveHash(db:DatabaseSync,p:NativeFormalAppointmentChoice,expectedEvent?:string) {
 const row=db.prepare("SELECT at,CASE WHEN length(CAST(body AS BLOB))<=131072 THEN body ELSE NULL END AS body FROM main.events WHERE world_id=? AND id=?").get(p.worldId,p.eventId);
 if(typeof row?.body!=='string'||row.at!==p.at||expectedEvent!==undefined&&row.body!==expectedEvent)return null;
 const e=JSON.parse(row.body);
 if(e?.id!==p.eventId||e.at!==p.at||e.kind!=='action'||e.observerOnly===true||
  JSON.stringify(e.actors)!==JSON.stringify([p.actorId,p.counterpartId])||
  !Array.isArray(e.witnesses)||!e.witnesses.includes(p.actorId)||!e.witnesses.includes(p.counterpartId)||
  !db.prepare("SELECT 1 FROM main.receipts WHERE world_id=? AND receipt=?").get(p.worldId,'plan:'+p.planId))return null;
 return hash(JSON.stringify([row.body,p]));
}
function validProof(p:NativeFormalAppointmentChoice,worldId:string,eventId:string){
 if(!p||!keys.every(k=>Object.hasOwn(p,k))||Object.keys(p).length!==keys.length||
  (p.kind!=='offered'&&p.kind!=='accepted')||p.worldId!==worldId||p.eventId!==eventId||
  ![p.appointmentId,p.eventId,p.offeredEventId,p.actorId,p.counterpartId,p.planId].every(id)||
  p.actorId===p.counterpartId||!minute(p.executionStartedAt)||!minute(p.at)||p.executionStartedAt>p.at||
  typeof p.terms!=='string'||Buffer.byteLength(p.terms)>4096)return false;
 const n=revision(worldId,eventId),o=revision(worldId,p.offeredEventId);
 if(n===null||o===null||(p.kind==='offered'?o!==n:o>=n))return false;
 const t=JSON.parse(p.terms);
 if(!Array.isArray(t)||t.length!==12)return false;
 const [appointment,proposer,recipient,building,place,name,offeredAt,start,end,offerReceipt,births,names]=t;
 return appointment===p.appointmentId&&proposer===(p.kind==='offered'?p.actorId:p.counterpartId)&&recipient===(p.kind==='offered'?p.counterpartId:p.actorId)&&
  id(building)&&place&&int(place.x)&&int(place.y)&&typeof name==='string'&&minute(offeredAt)&&minute(start)&&minute(end)&&
  offeredAt<start&&start<end&&id(offerReceipt)&&Array.isArray(births)&&births.length===2&&Array.isArray(names)&&names.length===2&&
  (p.kind==='offered'?p.at===offeredAt:p.at>=offeredAt&&p.at<start);
}
function stored(db:DatabaseSync,worldId:string,eventId:string,head:number):{row:Row;proof:NativeFormalAppointmentChoice}|null {
 const row=db.prepare(`SELECT event_id,world_id,kind,appointment_id,committed_revision,event_hash,
 CASE WHEN length(CAST(body AS BLOB))<=8192 THEN body END AS body FROM main.${table} WHERE world_id=? AND event_id=?`)
  .get(worldId,eventId) as unknown as Row|undefined;
 if(!row||typeof row.body!=='string'||!int(row.committed_revision)||row.committed_revision>head||
  (revision(worldId,eventId)??Infinity)>=row.committed_revision)return null;
 const proof=JSON.parse(row.body) as NativeFormalAppointmentChoice;
 if(!validProof(proof,worldId,eventId)||row.kind!==proof.kind||row.appointment_id!==proof.appointmentId||
  archiveHash(db,proof)!==row.event_hash)return null;
 if(proof.kind==='offered'&&!db.prepare('SELECT 1 FROM main.receipts WHERE world_id=? AND receipt=?')
  .get(worldId,'social-appointment:offer:'+JSON.parse(proof.terms)[9]))return null;
 return {row,proof};
}
function matched(a:NativeFormalAppointmentChoice,o:NativeFormalAppointmentChoice){
 return o.kind==='offered'&&a.kind==='accepted'&&a.offeredEventId===o.eventId&&a.appointmentId===o.appointmentId&&
  a.terms===o.terms&&a.actorId===o.counterpartId&&a.counterpartId===o.actorId&&a.planId!==o.planId&&
  a.executionStartedAt>=o.at-1e-7;
}
/** Companions to gameplay only: the caller owns a savepoint within the world commit. */
export function appendFormalAppointmentChoices(db:DatabaseSync,w:World,previous:number,events:readonly WorldEvent[]){
 if(!db.isTransaction||w.mode!=='formal'||!worldIdPattern.test(w.id)||
  db.prepare('SELECT revision FROM main.worlds WHERE id=?').get(w.id)?.revision!==w.revision||
  !int(previous)||!int(w.revision))throw Error('formal_choice_transaction');
 const proofs=events.flatMap(e=>{const p=nativeFormalAppointmentChoice(w,e);return p?[{e,p}]:[];});
 if(!proofs.length)return;
 if(proofs.length>64)throw Error('formal_choice_batch');
 if(!inspect(db))db.exec(ddl);
 const count=db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM main.${table} LIMIT ?)`).get(limit+1)?.n;
 if(!int(count)||count+proofs.length>limit)throw Error('formal_choice_capacity');
 const write=db.prepare(`INSERT INTO main.${table} VALUES (?,?,?,?,?,?,?)`);
 for(const {e,p} of proofs){
  const n=revision(w.id,e.id);
  const c=w.socialAppointments?.records.find(c=>c.id===p.appointmentId);
  if(!validProof(p,w.id,e.id)||n===null||n<=previous||n>=w.revision||p.at>w.minute||
   w.events.find(v=>v.id===e.id)!==e||!matchesNativeFormalAppointmentChoice(w,e)||c?.eventIds[0]!==p.offeredEventId||!c.eventIds.includes(e.id))
   throw Error('formal_choice_witness_invalid');
  const eventHash=archiveHash(db,p,JSON.stringify(e)),body=JSON.stringify(p);
  if(!eventHash||Buffer.byteLength(body)>8192)throw Error('formal_choice_archive_invalid');
  if(p.kind==='accepted'){
   const offer=stored(db,w.id,p.offeredEventId,w.revision);
   if(!offer)continue; // Legacy/offline absence cannot reconstruct antecedent custody.
   if(!matched(p,offer.proof))throw Error('formal_choice_prior_mismatch');
  }
  write.run(e.id,w.id,p.kind,p.appointmentId,w.revision,body,eventHash);
  if(!stored(db,w.id,e.id,w.revision))throw Error('formal_choice_write_verification');
 }
}
/** Private kind/timestamp only; not a life projection, disclosure grant, or route. */
export function readFormalAppointmentChoice(db:DatabaseSync,w:string,event:string){
 if(!worldIdPattern.test(w)||!id(event)||revision(w,event)===null)return null;
 try{
  if(!inspect(db))return null;
  const head=db.prepare('SELECT revision FROM main.worlds WHERE id=?').get(w)?.revision;
  if(!int(head))return null;
  const value=stored(db,w,event,head);
  if(!value)return null;
  const p=value.proof;
  if(p.kind==='accepted'){
   const offer=stored(db,w,p.offeredEventId,head);
   if(!offer||!matched(p,offer.proof))return null;
  }
  return Object.freeze({schemaVersion:1 as const,worldId:w,eventId:event,kind:p.kind,atUs:minuteToClimateUs(p.at)});
 }catch{return null;}
}

import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World,WorldEvent} from '../shared/types.js';
import type {SocialAppointmentArrivalFact} from '../shared/social-appointments.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {isFreshSocialAppointmentArrival} from '../world/social-appointments.js';

const TABLE='valley_spirit_formal_arrival_custody';
const LIMIT=4096, EVENT_BYTES=131072;
const WORLD=/^valley-formal-(?:frontier-)?[0-9]{1,16}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const DDL='CREATE TABLE valley_spirit_formal_arrival_custody(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,schema_version INTEGER NOT NULL,event_revision INTEGER NOT NULL,plan_id TEXT NOT NULL,at_us TEXT NOT NULL,proof_hash TEXT NOT NULL,committed_revision INTEGER NOT NULL,receipt_id TEXT UNIQUE NOT NULL,UNIQUE(world_id,plan_id))';
const exact=(v:unknown,k:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
const id=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
const integer=(v:unknown,lo:number,hi=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const atUs=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=1_000_000_000_000_000n;
const eventNumber=(w:string,e:unknown)=>{
 const prefix=w+':event:';if(!id(e)||!e.startsWith(prefix))return null;
 const n=e.slice(prefix.length);return /^[1-9][0-9]{0,15}$/.test(n)&&integer(Number(n),1)?Number(n):null;
};
export interface ValleySpiritFormalArrivalReceipt {
 readonly schemaVersion:1;readonly worldId:string;readonly receiptId:string;
 readonly kind:'arrived';readonly atUs:string;readonly receiptVersion:1;
}
interface Row {event_id:string;world_id:string;schema_version:1;event_revision:number;plan_id:string;
 at_us:string;proof_hash:string;committed_revision:number;receipt_id:string;}
const receipt=(r:Row):ValleySpiritFormalArrivalReceipt=>Object.freeze({schemaVersion:1,worldId:r.world_id,
 receiptId:r.receipt_id,kind:'arrived',atUs:r.at_us,receiptVersion:1});
function validReceipt(v:unknown):v is ValleySpiritFormalArrivalReceipt {
 if(!exact(v,['schemaVersion','worldId','receiptId','kind','atUs','receiptVersion']))return false;
 const r=v as ValleySpiritFormalArrivalReceipt;
 return r.schemaVersion===1&&id(r.worldId)&&WORLD.test(r.worldId)&&typeof r.receiptId==='string'&&
  UUID.test(r.receiptId)&&r.kind==='arrived'&&atUs(r.atUs)&&r.receiptVersion===1;
}
function validRow(r:Row,w:string):boolean {
 return r.world_id===w&&r.schema_version===1&&r.event_revision===eventNumber(w,r.event_id)&&
  integer(r.committed_revision,r.event_revision+1)&&id(r.plan_id)&&typeof r.proof_hash==='string'&&
  HASH.test(r.proof_hash)&&validReceipt(receipt(r));
}
function inspect(db:DatabaseSync):boolean {
 const row=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(TABLE);
 if(!row)return false;
 if(row.type!=='table'||row.sql!==DDL||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))
  throw Error('unknown_formal_arrival_custody_schema');
 return true;
}
function archived(db:DatabaseSync,worldId:string,eventId:string):WorldEvent|null {
 const row=db.prepare('SELECT at,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM events WHERE id=? AND world_id=?').get(EVENT_BYTES,eventId,worldId);
 if(!row||typeof row.body!=='string'||!minute(row.at))return null;
 const e=JSON.parse(row.body) as WorldEvent;
 return e&&e.id===eventId&&e.at===row.at&&e.kind==='action'&&e.observerOnly!==true?e:null;
}
const fields=['schemaVersion','worldId','appointmentId','offeredEventId','acceptedTermsEventId','residentId','planId','executionStartedAt','arrivedAt','terminalEventId'];
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function committedProof(db:DatabaseSync,w:string,eventId:string){
 const term=archived(db,w,eventId),proof=term?.socialAppointmentArrival;
 if(!proof||!exact(proof,fields))return null;
 const f=proof as SocialAppointmentArrivalFact;
 const terminal=eventNumber(w,f.terminalEventId),offer=eventNumber(w,f.offeredEventId),accepted=eventNumber(w,f.acceptedTermsEventId);
 if(f.schemaVersion!==1||f.worldId!==w||eventId!==f.terminalEventId||!id(f.appointmentId)||!id(f.residentId)||
  !id(f.planId)||!minute(f.executionStartedAt)||!minute(f.arrivedAt)||f.arrivedAt!==term!.at||
  f.executionStartedAt>f.arrivedAt||!integer(offer,1)||!integer(accepted,offer+1)||!integer(terminal,accepted+1)||
  !equal(term!.actors,[f.residentId])||!db.prepare('SELECT 1 FROM receipts WHERE world_id=? AND receipt=?').get(w,'plan:'+f.planId))return null;
 const proposed=archived(db,w,f.offeredEventId),agreed=archived(db,w,f.acceptedTermsEventId);
 const a=proposed?.audit,b=agreed?.audit;
 if(!a||!b||a.rule!=='social-appointment/offer@1'||b.rule!=='social-appointment/accept@1'||
  a.authority!=='independent-adult-social-choice'||b.authority!==a.authority||
  !equal(a.scope,['public-rendezvous-only'])||!equal(b.scope,a.scope)||b.evidence!==a.evidence||
  typeof a.evidence!=='string'||a.evidence.length>4096)return null;
 const terms:unknown=JSON.parse(a.evidence);
 if(!Array.isArray(terms)||terms.length!==12)return null;
 const [appointmentId,proposer,recipient,building,place,name,offeredAt,start,end,offerReceipt,births,names]=terms;
 if(appointmentId!==f.appointmentId||!id(proposer)||!id(recipient)||proposer===recipient||
  (f.residentId!==proposer&&f.residentId!==recipient)||a.providerId!==proposer||b.providerId!==proposer||
  !minute(offeredAt)||!minute(start)||!minute(end)||offeredAt!==proposed!.at||!(offeredAt<start&&start<end)||
  agreed!.at<offeredAt||agreed!.at>=start||f.executionStartedAt+1e-7<agreed!.at||f.arrivedAt>end||
  !equal(term!.place,place)||!equal(proposed!.actors,[proposer,recipient])||!equal(agreed!.actors,[recipient,proposer])||
  !Array.isArray(proposed!.witnesses)||!Array.isArray(agreed!.witnesses)||
  ![proposer,recipient].every(x=>proposed!.witnesses.includes(x)&&agreed!.witnesses.includes(x))||
  !id(offerReceipt)||!db.prepare('SELECT 1 FROM receipts WHERE world_id=? AND receipt=?').get(w,'social-appointment:offer:'+offerReceipt))return null;
 return {eventRevision:terminal,planId:f.planId,atUs:minuteToClimateUs(f.arrivedAt),
  proofHash:createHash('sha256').update(JSON.stringify([f,a.evidence,proposed!.at,agreed!.at])).digest('hex')};
}
function stillCurrent(db:DatabaseSync,r:Row):boolean {
 if(!integer(db.prepare('SELECT revision FROM worlds WHERE id=?').get(r.world_id)?.revision,r.committed_revision))return false;
 const proof=committedProof(db,r.world_id,r.event_id);
 return !!proof&&proof.eventRevision===r.event_revision&&proof.planId===r.plan_id&&
  proof.atUs===r.at_us&&proof.proofHash===r.proof_hash;
}

/** Exact current formal append only. The caller owns the world transaction and
 * optional savepoint; archival reads never create missing custody. */
export function appendValleySpiritFormalArrivalCustody(
 db:DatabaseSync,w:World,previousRevision:number|null,appended:readonly WorldEvent[],
):void {
 if(db.isTransaction===false||w.mode!=='formal'||!WORLD.test(w.id)||!integer(previousRevision,0)||
  db.prepare('SELECT revision FROM worlds WHERE id=?').get(w.id)?.revision!==w.revision)return;
 const terminals=appended.filter(isFreshSocialAppointmentArrival);
 if(!terminals.length||terminals.length>w.residents.length)return;
 const ids=new Set<string>(),plans=new Set<string>(),rows:Row[]=[];
 for(const event of terminals){
  const proof=committedProof(db,w.id,event.id);
  const authored=w.events.find(e=>e.id===event.id);
  const c=w.socialAppointments?.records.find(c=>c.id===event.socialAppointmentArrival?.appointmentId);
  if(!proof||!integer(proof.eventRevision,previousRevision+1,w.revision-1)||
   authored!==event||!c||!c.eventIds.includes(event.id)||
   !c.eventIds.includes(event.socialAppointmentArrival!.offeredEventId)||
   !c.eventIds.includes(event.socialAppointmentArrival!.acceptedTermsEventId)||
   event.at>w.minute||ids.has(event.id)||plans.has(proof.planId))return;
  ids.add(event.id);plans.add(proof.planId);
  rows.push({event_id:event.id,world_id:w.id,schema_version:1,event_revision:proof.eventRevision,plan_id:proof.planId,
   at_us:proof.atUs,proof_hash:proof.proofHash,committed_revision:w.revision,receipt_id:randomUUID()});
 }
 if(!inspect(db))db.exec(DDL);
 const existing=db.prepare('SELECT * FROM valley_spirit_formal_arrival_custody LIMIT ?').all(LIMIT+1) as unknown as Row[];
 if(existing.length+rows.length>LIMIT||existing.some(r=>!validRow(r,w.id)||r.committed_revision>previousRevision||
  ids.has(r.event_id)||plans.has(r.plan_id)))return;
 const insert=db.prepare('INSERT INTO valley_spirit_formal_arrival_custody VALUES (?,?,1,?,?,?,?,?,?)');
 for(const r of rows)insert.run(r.event_id,r.world_id,r.event_revision,r.plan_id,r.at_us,r.proof_hash,r.committed_revision,r.receipt_id);
}
export function readValleySpiritFormalArrivalCustody(db:DatabaseSync,w:string,eventId:string):ValleySpiritFormalArrivalReceipt|null {
 if(!WORLD.test(w)||!eventNumber(w,eventId))return null;
 try{
  if(!inspect(db))return null;
  const row=db.prepare('SELECT * FROM valley_spirit_formal_arrival_custody WHERE event_id=? AND world_id=?').get(eventId,w) as unknown as Row|undefined;
  return row&&validRow(row,w)&&stillCurrent(db,row)?receipt(row):null;
 }catch{return null;}
}
export function verifyValleySpiritFormalArrivalCustody(db:DatabaseSync,value:Readonly<ValleySpiritFormalArrivalReceipt>):boolean {
 if(!validReceipt(value))return false;
 try{
  if(!inspect(db))return false;
  const row=db.prepare('SELECT * FROM valley_spirit_formal_arrival_custody WHERE receipt_id=? AND world_id=?').get(value.receiptId,value.worldId) as unknown as Row|undefined;
  return !!row&&validRow(row,value.worldId)&&row.at_us===value.atUs&&stillCurrent(db,row);
 }catch{return false;}
}

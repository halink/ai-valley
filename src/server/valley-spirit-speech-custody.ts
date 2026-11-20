import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {isCurrentAddressedSpeechObservation,type AddressedSpeechObservation} from '../world/addressed-speech.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {isValleySpiritLifeReceipt,type ValleySpiritLifeReceipt} from './valley-spirit-life-facts.js';

const TABLE='valley_spirit_speech_custody';
const LIMIT=4096;
const WORLD=/^godot-mvp-[a-zA-Z0-9_-]{1,180}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/;
const DDL='CREATE TABLE valley_spirit_speech_custody(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,schema_version INTEGER NOT NULL,event_revision INTEGER NOT NULL,plan_id TEXT NOT NULL,plan_action INTEGER NOT NULL,speaker_id TEXT NOT NULL,recipient_id TEXT NOT NULL,at_us TEXT NOT NULL,committed_revision INTEGER NOT NULL,receipt_id TEXT UNIQUE NOT NULL,UNIQUE(world_id,plan_id,plan_action))';
const integer=(v:unknown,lo:number,hi=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const id=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
interface Row{
 event_id:string;world_id:string;schema_version:1;event_revision:number;plan_id:string;plan_action:number;
 speaker_id:string;recipient_id:string;at_us:string;committed_revision:number;receipt_id:string;
}
const receipt=(r:Row):ValleySpiritLifeReceipt=>Object.freeze({schemaVersion:1,worldId:r.world_id,receiptId:r.receipt_id,
 kind:'conversation-completed',receiptVersion:1,atUs:r.at_us});
function matchesSchema(db:DatabaseSync):boolean {
 const m=db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(TABLE);
 if(!m)return false;
 if(m.type!=='table'||m.sql!==DDL||db.prepare("SELECT 1 FROM sqlite_master WHERE tbl_name=? AND type='trigger'").get(TABLE))
  throw Error('unknown_life_speech_custody_schema');
 return true;
}
function validRow(row:Row,worldId:string):boolean {
 return WORLD.test(worldId)&&row.world_id===worldId&&row.schema_version===1&&integer(row.event_revision,1)&&
  integer(row.committed_revision,row.event_revision+1)&&row.event_id===`${worldId}:event:${row.event_revision}`&&
  id(row.plan_id)&&integer(row.plan_action,0,9)&&id(row.speaker_id)&&id(row.recipient_id)&&row.speaker_id!==row.recipient_id&&
  isValleySpiritLifeReceipt(receipt(row));
}
function committedEvent(db:DatabaseSync,worldId:string,r:Row,exactHead:boolean):boolean {
 const rev=db.prepare('SELECT revision FROM worlds WHERE id=?').get(worldId)?.revision;
 if(!integer(rev,r.committed_revision)||(exactHead&&rev!==r.committed_revision))return false;
 // Match exact persisted event and delivered parties against fresh private
 // proof. Metadata cross-check is not a standalone reception observation.
 const e=db.prepare(`SELECT at, json_extract(body,'$.id') AS body_id, json_extract(body,'$.at') AS body_at,
  json_extract(body,'$.kind') AS kind, json_extract(body,'$.observerOnly') AS observer_only,
  json_type(body,'$.actors') AS actors, json_array_length(body,'$.actors') AS count,
  json_extract(body,'$.actors[0]') AS speaker, json_extract(body,'$.actors[1]') AS recipient
  FROM events WHERE id=? AND world_id=?`).get(r.event_id,worldId);
 return !!e&&e.body_id===r.event_id&&minute(e.at)&&e.body_at===e.at&&minuteToClimateUs(e.at)===r.at_us&&
  e.kind==='conversation'&&(e.observer_only===null||e.observer_only===0)&&e.actors==='array'&&e.count===2&&
  e.speaker===r.speaker_id&&e.recipient===r.recipient_id;
}

/** Internal, WorldStore-owned transaction only, after authoritative world/event
 * writes and before COMMIT. No snapshots, models, routes, history, or backfill. */
export function appendValleySpiritSpeechCustody(db:DatabaseSync,w:World,previousRevision:number|null,o:AddressedSpeechObservation):readonly ValleySpiritLifeReceipt[]{
 // Node 22.13–22.15 lack isTransaction; the sole production caller owns BEGIN IMMEDIATE.
 if(db.isTransaction===false||w.mode!=='validation'||!WORLD.test(w.id)||!integer(previousRevision,0)||
  !isCurrentAddressedSpeechObservation(w,o)||!integer(o.previousRevision,previousRevision)||
  !minute(o.fromMinute)||!minute(o.toMinute)||BigInt(minuteToClimateUs(o.toMinute))-BigInt(minuteToClimateUs(o.fromMinute))!==1_000_000n||
  !o.receipts.length||o.receipts.length>w.residents.length)return [];
 const rows:Row[]=[],events=new Set<string>(),actions=new Set<string>();
 for(const r of o.receipts){
  if(r.schemaVersion!==1||r.kind!=='addressed-speech-delivered'||r.worldId!==w.id||r.actionType!=='talk'||
   r.intendedRecipientId!==r.actualRecipientId||!integer(r.eventRevision,o.previousRevision+1,w.revision-1)||
   !minute(r.startedAt)||r.startedAt>r.deliveredAt||r.deliveredAt!==o.toMinute||
   !w.residents.some(p=>p.id===r.speakerId)||!w.residents.some(p=>p.id===r.actualRecipientId))return [];
  const row:Row={event_id:r.eventId,world_id:w.id,schema_version:1,event_revision:r.eventRevision,plan_id:r.planId,
   plan_action:r.actionIndexFromEnd,speaker_id:r.speakerId,recipient_id:r.actualRecipientId,
   at_us:minuteToClimateUs(r.deliveredAt),committed_revision:w.revision,receipt_id:randomUUID()};
  const action=`${row.plan_id}:${row.plan_action}`;
  if(!validRow(row,w.id)||events.has(row.event_id)||actions.has(action)||!committedEvent(db,w.id,row,true))return [];
  rows.push(row);events.add(row.event_id);actions.add(action);
 }
 if(!matchesSchema(db))db.exec(DDL);
 const existing=db.prepare('SELECT * FROM valley_spirit_speech_custody LIMIT ?').all(LIMIT+1) as unknown as Row[];
 if(existing.length+rows.length>LIMIT||existing.some(r=>!validRow(r,w.id)||r.committed_revision>previousRevision||
  events.has(r.event_id)||actions.has(`${r.plan_id}:${r.plan_action}`)))return [];
 const insert=db.prepare('INSERT INTO valley_spirit_speech_custody VALUES(?,?,1,?,?,?,?,?,?,?,?)');
 for(const r of rows)insert.run(r.event_id,r.world_id,r.event_revision,r.plan_id,r.plan_action,r.speaker_id,r.recipient_id,r.at_us,r.committed_revision,r.receipt_id);
 return Object.freeze(rows.map(receipt));
}
/** Recovery is by an already known exact event identity, and only from a
 * dedicated custody row. This never treats the event itself as a receipt. */
export function readValleySpiritSpeechCustody(db:DatabaseSync,worldId:string,eventId:string):ValleySpiritLifeReceipt|null{
 if(!WORLD.test(worldId)||!id(eventId)||!eventId.startsWith(worldId+':event:'))return null;
 try{
  if(!matchesSchema(db))return null;
  const r=db.prepare('SELECT * FROM valley_spirit_speech_custody WHERE event_id=? AND world_id=?').get(eventId,worldId) as unknown as Row|undefined;
  return r&&validRow(r,worldId)&&committedEvent(db,worldId,r,false)?receipt(r):null;
 }catch{return null;}
}
/** Verify for an independently gated life authority; verification does not
 * grant publication. No original dialogue, speaker or recipient is returned. */
export function verifyValleySpiritSpeechCustody(db:DatabaseSync,value:Readonly<ValleySpiritLifeReceipt>):boolean {
 if(!isValleySpiritLifeReceipt(value)||value.kind!=='conversation-completed'||value.receiptVersion!==1)return false;
 try{
  if(!matchesSchema(db))return false;
  const r=db.prepare('SELECT * FROM valley_spirit_speech_custody WHERE receipt_id=? AND world_id=?').get(value.receiptId,value.worldId) as unknown as Row|undefined;
  return !!r&&validRow(r,value.worldId)&&r.at_us===value.atUs&&committedEvent(db,value.worldId,r,false);
 }catch{return false;}
}

/** Private integrity-only index for the owning speech annex. Uses the
 * authoritative base custody, never event text, actors, or a candidate cache.
 * Caller supplies the same SQLite snapshot and the exact current head bound. */
export function latestValleySpiritSpeechCustodyKeys(db:DatabaseSync,worldId:string,headRevision:number,excludeCurrent=false){
 if(!WORLD.test(worldId)||!integer(headRevision,1))throw Error('invalid_speech_custody_head');
 if(!matchesSchema(db))return null;
 const count=db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM valley_spirit_speech_custody LIMIT ?)').get(LIMIT+1)?.n;
 if(!integer(count,1,LIMIT)||db.prepare('SELECT 1 FROM valley_spirit_speech_custody WHERE world_id<>? LIMIT 1').get(worldId))
  throw Error('invalid_speech_custody_extent');
 const top=db.prepare('SELECT committed_revision FROM valley_spirit_speech_custody WHERE world_id=? ORDER BY committed_revision DESC LIMIT 1').get(worldId)?.committed_revision;
 if(top===undefined)return null;
 if(!integer(top,1,headRevision))throw Error('future_speech_custody_revision');
 const ceiling=excludeCurrent?headRevision-1:headRevision;
 const revision=db.prepare('SELECT committed_revision FROM valley_spirit_speech_custody WHERE world_id=? AND committed_revision<=? ORDER BY committed_revision DESC LIMIT 1').get(worldId,ceiling)?.committed_revision;
 if(revision===undefined)return null;
 if(!integer(revision,1,ceiling))throw Error('invalid_speech_custody_revision');
 const rows=db.prepare('SELECT * FROM valley_spirit_speech_custody WHERE world_id=? AND committed_revision=? LIMIT 17').all(worldId,revision) as unknown as Row[];
 if(!rows.length||rows.length>16||new Set(rows.map(r=>r.receipt_id)).size!==rows.length||rows.some(r=>!validRow(r,worldId)||!committedEvent(db,worldId,r,false)))
  throw Error('invalid_speech_custody_receipt_set');
 return {revision,ids:rows.map(r=>r.receipt_id).sort()};
}

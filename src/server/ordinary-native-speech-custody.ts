import {createHash,randomUUID} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {isCurrentAddressedSpeechObservation,type AddressedSpeechObservation} from '../world/addressed-speech.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {hasReceipt} from '../world/receipts.js';
import {runtimeOwnershipAnchor,type RuntimeOwnership} from './runtime-lock.js';
import {isValleySpiritLifeReceipt,type ValleySpiritLifeReceipt} from './valley-spirit-life-facts.js';

const TABLE='valley_spirit_ordinary_native_speech_receipts';
const DDL=`CREATE TABLE ${TABLE}(event_id TEXT PRIMARY KEY NOT NULL,world_id TEXT NOT NULL,plan_id TEXT NOT NULL,plan_action INTEGER NOT NULL,speaker_id TEXT NOT NULL,recipient_id TEXT NOT NULL,at_us TEXT NOT NULL,committed_revision INTEGER NOT NULL,receipt_id TEXT UNIQUE NOT NULL,event_digest TEXT NOT NULL,UNIQUE(plan_id,plan_action))`;
const META='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)';
const SCOPE='ordinary-native-addressed-speech-custody/v1';
const WORLD=/^godot-mvp-[A-Za-z0-9_-]{1,180}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,319}$/;
const LIMIT=4096;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const integer=(n:unknown,min:number,max=Number.MAX_SAFE_INTEGER):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const minute=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e9;
const id=(k:unknown):k is string=>typeof k==='string'&&ID.test(k);
function file(path:string){
 const f=lstatSync(path,{bigint:true});
 if(!f.isFile()||f.isSymbolicLink()||f.nlink!==1n)throw Error('ordinary_native_speech_file');
 return f;
}
type Row={event_id:string;world_id:string;plan_id:string;plan_action:number;speaker_id:string;recipient_id:string;
 at_us:string;committed_revision:number;receipt_id:string;event_digest:string};
const receipt=(r:Row):ValleySpiritLifeReceipt=>({schemaVersion:1,worldId:r.world_id,receiptId:r.receipt_id,receiptVersion:1,atUs:r.at_us,kind:'conversation-completed'});
export type OrdinaryNativeSpeechOptions=Readonly<{scope:typeof SCOPE;worldId:string}>;
export function pinOrdinaryNativeSpeechOptions(raw:unknown):OrdinaryNativeSpeechOptions|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'scope')||!Object.hasOwn(raw,'worldId'))return null;
 const p=raw as OrdinaryNativeSpeechOptions;
 return p.scope===SCOPE&&typeof p.worldId==='string'&&WORLD.test(p.worldId)?Object.freeze({scope:SCOPE,worldId:p.worldId}):null;
}
function exactHead(db:DatabaseSync,w:World){
 const h=db.prepare('SELECT revision,state FROM main.worlds WHERE id=?').get(w.id);
 return h?.revision===w.revision&&h.state instanceof Uint8Array&&gzipSync(JSON.stringify(w),{level:1}).equals(h.state);
}
function eventDigest(db:DatabaseSync,r:Row){
 const e=db.prepare(`SELECT rowid AS seq,body,at,json_extract(body,'$.at') AS body_at,json_extract(body,'$.id') AS body_id,
  json_extract(body,'$.kind') AS kind,json_extract(body,'$.conversationId') AS conversation_id,json_extract(body,'$.observerOnly') AS observer,
  json_array_length(body,'$.actors') AS actor_count,json_extract(body,'$.actors[0]') AS speaker,json_extract(body,'$.actors[1]') AS recipient
  FROM main.events WHERE id=? AND world_id=?`).get(r.event_id,r.world_id);
 const a=db.prepare('SELECT world_id,person_id,event_seq FROM main.event_people WHERE event_id=? LIMIT 3').all(r.event_id);
 if(typeof e?.body!=='string'||!minute(e.at)||e.at!==e.body_at||minuteToClimateUs(e.at)!==r.at_us||e.body_id!==r.event_id||
  e.kind!=='conversation'||typeof e.conversation_id!=='string'||!e.conversation_id.startsWith('conversation-'+r.world_id+'-')||
  (e.observer!==null&&e.observer!==0)||e.actor_count!==2||e.speaker!==r.speaker_id||e.recipient!==r.recipient_id||a.length!==2||
  a.some(v=>v.world_id!==r.world_id||v.event_seq!==e.seq)||!a.some(v=>v.person_id===r.speaker_id)||!a.some(v=>v.person_id===r.recipient_id)||
  db.prepare('SELECT 1 FROM main.event_animals WHERE event_id=? LIMIT 1').get(r.event_id))return null;
 return digest(e.body); // Existing archived text stays in its ordinary event, never copied here.
}
/** Ordinary, stopped and explicitly local. No old fixture table/mirror is authority. */
export function openOrdinaryNativeSpeechLease(owner:RuntimeOwnership,path:string,raw:OrdinaryNativeSpeechOptions){
 const config=pinOrdinaryNativeSpeechOptions(raw),anchor=runtimeOwnershipAnchor(owner);
 if(!config||!anchor||anchor.database!==path)throw Error('ordinary_native_speech_owner');
 anchor.assertOwned();
 const initial=file(path),{worldId}=config;
 const binding=digest(JSON.stringify([SCOPE,worldId,String(initial.dev),String(initial.ino)]));
 const seen=new Map<string,string>();
 let isolated=false;
 const assertOwned=()=>{
  anchor.assertOwned();const current=file(path);
  if(current.dev!==initial.dev||current.ino!==initial.ino)throw Error('ordinary_native_speech_file_changed');
 };
 function read(db:DatabaseSync){
  assertOwned();
  const meta=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta' LIMIT 2").all();
  if(meta.length!==1||meta[0].name!=='archive_meta'||meta[0].type!=='table'||meta[0].sql!==META||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) IN ('archive_meta',?) AND (type='trigger' OR type='index' AND sql IS NOT NULL)").get(TABLE)||
   db.prepare("SELECT 1 FROM temp.sqlite_schema WHERE lower(name) IN ('archive_meta','worlds','events','event_people','event_animals',?) OR type='trigger' AND lower(tbl_name) IN ('archive_meta',?)").get(TABLE,TABLE))
   throw Error('ordinary_native_speech_storage');
  const shape=db.prepare('SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)=? LIMIT 2').all(TABLE);
  const mark=db.prepare('SELECT value FROM main.archive_meta WHERE key=?').get(SCOPE)?.value;
  if(!shape.length&&mark===undefined&&!seen.size)return null;
  if(shape.length!==1||shape[0].name!==TABLE||shape[0].type!=='table'||shape[0].sql!==DDL||mark!==binding)
   throw Error('ordinary_native_speech_storage');
  const rows=db.prepare(`SELECT * FROM main.${TABLE} LIMIT ?`).all(LIMIT+1) as unknown as Row[];
  if(!rows.length||rows.length>LIMIT||rows.some(r=>r.world_id!==worldId||!id(r.event_id)||!id(r.plan_id)||!id(r.speaker_id)||
   !id(r.recipient_id)||r.speaker_id===r.recipient_id||!integer(r.plan_action,0,9)||!integer(r.committed_revision,1)||
   !isValleySpiritLifeReceipt(receipt(r))||typeof r.event_digest!=='string'||!/^[a-f0-9]{64}$/.test(r.event_digest)))
   throw Error('ordinary_native_speech_rows');
  const current=new Map(rows.map(r=>[r.event_id,JSON.stringify(r)]));
  if([...seen].some(([k,v])=>current.get(k)!==v))throw Error('ordinary_native_speech_observed_rollback');
  return {rows,current};
 }
 function readEditorialSourceAtHead(db:DatabaseSync,w:World,eventId:string){
   if(isolated||!db.isTransaction||w.id!==worldId||w.mode!=='validation'||!id(eventId))return null;
   try{
    if(!exactHead(db,w))return null;
    const current=read(db),row=current?.rows.find(r=>r.event_id===eventId);
    if(current)for(const [k,v] of current.current)seen.set(k,v);
    if(!row)return null;
    if(row.committed_revision>w.revision||BigInt(row.at_us)>BigInt(minuteToClimateUs(w.minute))||eventDigest(db,row)!==row.event_digest)
     throw Error('ordinary_native_speech_changed');
    assertOwned();
    const indexed=db.prepare('SELECT world_id,person_id,event_seq FROM main.event_people WHERE event_id=? ORDER BY person_id LIMIT 3').all(row.event_id);
    return Object.freeze({receipt:Object.freeze(receipt(row)),witnessDigest:digest(JSON.stringify([SCOPE,row,indexed]))});
   }catch{isolated=true;return null;}
  }
 return Object.freeze({
  worldId,
  isolate(){isolated=true;},
  append(db:DatabaseSync,previous:World,w:World,o:AddressedSpeechObservation){
   if(isolated||!o.receipts.length)return;
   if(!db.isTransaction||previous.id!==worldId||w.id!==worldId||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||
    !isCurrentAddressedSpeechObservation(w,o)||o.fromMinute!==previous.minute||o.toMinute!==w.minute||
    w.minute!==previous.minute+1||o.previousRevision<previous.revision||o.receipts.length>w.residents.length||!exactHead(db,w))
    throw Error('ordinary_native_speech_unverified');
   const old=read(db);
   if((old?.rows.length??0)+o.receipts.length>LIMIT)throw Error('ordinary_native_speech_capacity');
   const rows=o.receipts.map(p=>{
    const listener=w.residents.find(v=>v.id===p.actualRecipientId),actor=w.residents.find(v=>v.id===p.speakerId);
    if(p.kind!=='addressed-speech-delivered'||p.actionType!=='talk'||p.intendedRecipientId!==p.actualRecipientId||!listener||!actor||actor===listener||
     p.deliveredAt!==w.minute||p.startedAt>p.deliveredAt||!integer(p.eventRevision,o.previousRevision+1,w.revision)||
     !integer(p.actionIndexFromEnd,0,9)||!id(p.planId)||!id(p.eventId)||!hasReceipt(w,'plan:'+p.planId)||
     previous.events.some(e=>e.id===p.eventId)||
     !listener.memories.some(m=>m.source==='heard'&&m.eventId===p.eventId&&m.receivedAt===p.deliveredAt))
     throw Error('ordinary_native_speech_unverified');
    const row:Row={event_id:p.eventId,world_id:worldId,plan_id:p.planId,plan_action:p.actionIndexFromEnd,speaker_id:p.speakerId,
     recipient_id:p.actualRecipientId,at_us:minuteToClimateUs(p.deliveredAt),committed_revision:w.revision,receipt_id:randomUUID(),event_digest:''};
    const hash=eventDigest(db,row);
    if(!hash)throw Error('ordinary_native_speech_event');
    return {...row,event_digest:hash};
   });
   if(!old){
    db.exec(DDL);
    db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(SCOPE,binding);
   }
   const insert=db.prepare(`INSERT INTO main.${TABLE} VALUES(?,?,?,?,?,?,?,?,?,?)`);
   for(const r of rows)if(insert.run(r.event_id,r.world_id,r.plan_id,r.plan_action,r.speaker_id,r.recipient_id,r.at_us,
    r.committed_revision,r.receipt_id,r.event_digest).changes!==1)throw Error('ordinary_native_speech_insert');
   const confirmed=read(db);
   if(!exactHead(db,w)||rows.some(r=>eventDigest(db,r)!==r.event_digest||
    !confirmed?.rows.some(v=>Object.keys(r).every(k=>r[k as keyof Row]===v[k as keyof Row]))))
    throw Error('ordinary_native_speech_readback');
   assertOwned();
  },
  readEditorialSourceAtHead,
  readAtHead(db:DatabaseSync,w:World,eventId:string){
   const proof=readEditorialSourceAtHead(db,w,eventId);
   return proof?Object.freeze({status:'committed-private-addressed-speech' as const,receipt:proof.receipt,disclosureAuthorized:false as const}):null;
  },
 });
}

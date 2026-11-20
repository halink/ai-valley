import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual} from 'node:crypto';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {submitPlan} from '../world/engine.js';
import {authenticateDisposableRulesPayload,assertDisposableRulesSavePath,readDisposableRulesSaveMarker,
 type DisposableRulesSaveAuthority} from './disposable-native-rules-save.js';
import {readNativeValidationWeatherHead} from './valley-spirit-native-basis.js';
import {isValleySpiritLifeReceipt,type ValleySpiritLifeReceipt} from './valley-spirit-life-facts.js';
import {latestValleySpiritSpeechCustodyKeys,verifyValleySpiritSpeechCustody} from './valley-spirit-speech-custody.js';

export type DisposableSpeechCase='recipient-perceives'|'recipient-cannot-perceive';
export type DisposableSpeechPurpose=Readonly<{readonly disposableSpeechPurpose:unique symbol}>;
const purposeOwners=new WeakMap<DisposableSpeechPurpose,DisposableRulesSaveAuthority>();
/** Called only by the dedicated socketless speech profile after acquiring its
 * fresh file. A generic/aged process-only ownership marker is not this pin. */
export function bindDisposableSpeechPurpose(database:string,owner:DisposableRulesSaveAuthority){
 assertDisposableRulesSavePath(owner,database);
 const purpose=Object.freeze({}) as DisposableSpeechPurpose;
 purposeOwners.set(purpose,owner);return purpose;
}
export function ownsDisposableSpeechPurpose(purpose:DisposableSpeechPurpose,owner:DisposableRulesSaveAuthority):boolean{
 return purposeOwners.get(purpose)===owner;
}
export interface DisposableSpeechHead {readonly worldId:string;readonly revision:number;readonly atUs:string;}
export function disposableSpeechHead(w:World):Readonly<DisposableSpeechHead>{
 return Object.freeze({worldId:w.id,revision:w.revision,atUs:minuteToClimateUs(w.minute)});
}
/** A fixed synthetic initial action, not a caller-controlled line or a fabricated receipt. */
export function stageDisposableSpeechScenario(w:World,scenario:DisposableSpeechCase):void {
 const [speaker,listener,...others]=w.residents;
 if(!speaker||!listener||w.mode!=='validation')throw Error('disposable_native_speech_setup');
 const at={...speaker.at};
 for(const r of w.residents){r.at={...at};r.inside=null;r.roomAt=null;}
 speaker.knownPeople=[listener.id];
 const put=(r:typeof speaker, action:Parameters<typeof submitPlan>[1]['actions'][number],id:string)=>{
  if(!submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],
   intention:'隔离开发演示',actions:[action]}).ok)throw Error('disposable_native_speech_setup');
 };
 for(const [index,r] of [listener,...others].entries())put(r,{type:'wait',minutes:12},`isolated-speech-wait-${index}`);
 put(speaker,{type:'talk',targetId:listener.id,tone:'neutral',text:'这句话只交给指定的听者。'},'isolated-addressed-talk');
 if(scenario==='recipient-cannot-perceive')listener.canDecide=false;
}
const TABLE='mvp_disposable_native_speech';
const DDL='CREATE TABLE mvp_disposable_native_speech(revision INTEGER PRIMARY KEY NOT NULL, body TEXT NOT NULL, seal TEXT NOT NULL)';
const DOMAIN='disposable-addressed-speech/v1';
const LIMIT=64, BYTES=8192;
const hex=/^[0-9a-f]{64}$/;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const sameSeal=(actual:unknown,expected:string)=>typeof actual==='string'&&hex.test(actual)&&timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
function exists(db:DatabaseSync):boolean {
 const row=db.prepare('SELECT type,sql FROM main.sqlite_schema WHERE name=?').get(TABLE);
 if(!row)return false;
 if(row.type!=='table'||row.sql!==DDL||db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='trigger' AND tbl_name=?").get(TABLE))
  throw Error('disposable_native_speech_schema');
 return true;
}
function read(db:DatabaseSync,authority:DisposableRulesSaveAuthority,head:Readonly<DisposableSpeechHead>,
 onlyCurrent=false,excludePendingBase=false):readonly ValleySpiritLifeReceipt[]{
 if(readDisposableRulesSaveMarker(db,authority)!==head.worldId)throw Error('disposable_native_speech_world');
 const world=readNativeValidationWeatherHead(db,head.worldId);
 if(!world||world.worldRevision!==head.revision||world.atUs!==head.atUs)throw Error('disposable_native_speech_head');
 const authoritative=latestValleySpiritSpeechCustodyKeys(db,head.worldId,head.revision,excludePendingBase);
 if(!exists(db)){
  if(authoritative)throw Error('disposable_native_speech_annex_missing');
  return [];
 }
 const count=db.prepare(`SELECT count(*) AS total FROM main.${TABLE}`).get()?.total;
 if(!positive(count)||count>LIMIT)throw Error('disposable_native_speech_count');
 const row=db.prepare(`SELECT revision,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body,
  CASE WHEN length(seal)=64 THEN seal END AS seal FROM main.${TABLE} ORDER BY revision DESC LIMIT 1`).get(BYTES);
 if(!row||!positive(row.revision)||row.revision>head.revision||typeof row.body!=='string'||
    !sameSeal(row.seal,authenticateDisposableRulesPayload(authority,DOMAIN,row.body)))throw Error('disposable_native_speech_auth');
 if(!authoritative||authoritative.revision!==row.revision)throw Error('disposable_native_speech_custody_revision');
 if(onlyCurrent&&row.revision!==head.revision)throw Error('disposable_native_speech_current_receipt');
 const data=JSON.parse(row.body) as {schemaVersion:unknown;worldId:unknown;revision:unknown;atUs:unknown;receipts:unknown};
 if(!data||Object.keys(data).length!==5||data.schemaVersion!==1||data.worldId!==head.worldId||data.revision!==row.revision||
    typeof data.atUs!=='string'||!(/^(0|[1-9][0-9]{0,15})$/.test(data.atUs))||BigInt(data.atUs)>BigInt(head.atUs)||
    onlyCurrent&&data.atUs!==head.atUs||!Array.isArray(data.receipts)||!data.receipts.length||data.receipts.length>16||
    new Set(data.receipts.map(r=>r?.receiptId)).size!==data.receipts.length||!data.receipts.every(r=>isValleySpiritLifeReceipt(r)&&
      r.worldId===head.worldId&&r.atUs===data.atUs&&r.kind==='conversation-completed'&&verifyValleySpiritSpeechCustody(db,r)))
  throw Error('disposable_native_speech_receipt');
 if(JSON.stringify(data.receipts.map(r=>r.receiptId).sort())!==JSON.stringify(authoritative.ids))throw Error('disposable_native_speech_custody_keys');
 return Object.freeze(data.receipts.map(r=>Object.freeze({...r})));
}
/** Store caller must still be in the exact native WorldStore transaction. */
export function appendDisposableNativeSpeech(db:DatabaseSync,authority:DisposableRulesSaveAuthority,w:World,receipts:readonly ValleySpiritLifeReceipt[]){
 if(!receipts.length)return;
 if(!db.isTransaction||w.mode!=='validation')throw Error('disposable_native_speech_transaction');
 const head=disposableSpeechHead(w);
 read(db,authority,head,false,true);
 if(!exists(db))db.exec(DDL);
 const body=JSON.stringify({schemaVersion:1,...head,receipts});
 if(Buffer.byteLength(body)>BYTES)throw Error('disposable_native_speech_limit');
 db.prepare(`INSERT INTO main.${TABLE} VALUES (?,?,?)`).run(head.revision,body,authenticateDisposableRulesPayload(authority,DOMAIN,body));
 if(JSON.stringify(read(db,authority,head,true))!==JSON.stringify(receipts))throw Error('disposable_native_speech_readback');
}
export function openDisposableNativeSpeechReader(database:string,authority:DisposableRulesSaveAuthority,purpose:DisposableSpeechPurpose,current:()=>World){
 if(!ownsDisposableSpeechPurpose(purpose,authority))throw Error('disposable_native_speech_purpose');
 assertDisposableRulesSavePath(authority,database);
 const db=new DatabaseSync(database,{readOnly:true});
 db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
 let closed=false;
 return Object.freeze({
  latest(expected:Readonly<DisposableSpeechHead>){
   if(closed)return null;
   try{
    assertDisposableRulesSavePath(authority,database);
    const w=current(),head=disposableSpeechHead(w);
    if(!expected||w.clock.paused||w.mode!=='validation'||expected.worldId!==head.worldId||expected.revision!==head.revision||expected.atUs!==head.atUs)return null;
    db.exec('BEGIN');
    try{
     const receipts=read(db,authority,head);
     assertDisposableRulesSavePath(authority,database);db.exec('COMMIT');
     return receipts.length?Object.freeze({status:'private-proof' as const,head,receipts}):null;
    }catch{db.exec('ROLLBACK');return null;}
   }catch{return null;}
  },
  close(){if(!closed){closed=true;db.close();}}
 });
}

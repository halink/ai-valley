import {createHash,createPublicKey,verify} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Vec} from '../shared/types.js';
import type {FormalBerryDetachedReceipt} from './valley-spirit-formal-berry-draft.js';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

const TABLE='formal_berry_fixture_effects';
export const FORMAL_BERRY_EFFECT_SCHEMA='CREATE TABLE '+TABLE+' (draft_id TEXT PRIMARY KEY NOT NULL, approval_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL)';
const VERSION='sealed-formal-berry-approval/v1';
const hex=/^[a-f0-9]{64}$/u;
const approvalId=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u;
const signature=/^[A-Za-z0-9_-]{86}$/u;
const nativeId=/^valley-formal-[A-Za-z0-9_-]{1,180}$/u;
const rainId=/^formal-rain:[a-f0-9]{64}$/u;
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const minute=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const pattern=(v:unknown,p:RegExp):v is string=>typeof v==='string'&&p.test(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const digest=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');

export interface FormalBerryFixtureAnchor {readonly version:1;readonly count:number;readonly digest:string;}
export interface FormalBerrySignedTerms {
 readonly schema:typeof VERSION;readonly item:'berry';readonly quantity:1;
 readonly fixtureScope:string;readonly worldId:string;readonly revision:number;readonly approvalId:string;
 readonly episodeId:string;readonly sourceId:string;readonly sourceBefore:number;readonly target:Vec;
 readonly maxAgeGameMinutes:number;readonly firstMinute:number;readonly expiresMinute:number;
}
export interface FormalBerrySignedApproval {readonly terms:FormalBerrySignedTerms;readonly signature:string;}
export interface FormalBerryFixtureEffect {
 readonly approval:FormalBerrySignedApproval;
 readonly receipt:FormalBerryDetachedReceipt;
 readonly committedRevision:number;
}
export const formalBerryFixtureScope=(owner:DeveloperMvpSpiritFixtureOwner)=>digest('sealed-formal-berry:'+owner.seal);
export function encodeFormalBerrySignedTerms(t:unknown):Buffer|null {
 if(!exact(t,['schema','item','quantity','fixtureScope','worldId','revision','approvalId','episodeId','sourceId','sourceBefore',
  'target','maxAgeGameMinutes','firstMinute','expiresMinute'])||t.schema!==VERSION||t.item!=='berry'||t.quantity!==1||
  !pattern(t.fixtureScope,hex)||!pattern(t.worldId,nativeId)||!nat(t.revision)||!pattern(t.approvalId,approvalId)||
  !pattern(t.episodeId,rainId)||!pattern(t.sourceId,/^bush-\d{1,8}-\d{1,8}$/u)||!nat(t.sourceBefore)||t.sourceBefore<1||
  !exact(t.target,['x','y'])||!nat(t.target.x)||!nat(t.target.y)||!nat(t.maxAgeGameMinutes)||t.maxAgeGameMinutes<1||
  t.maxAgeGameMinutes>40320||!minute(t.firstMinute)||!minute(t.expiresMinute)||t.firstMinute>=t.expiresMinute)return null;
 return Buffer.from(JSON.stringify([VERSION,t.item,t.quantity,t.fixtureScope,t.worldId,t.revision,t.approvalId,t.episodeId,t.sourceId,
  t.sourceBefore,t.target.x,t.target.y,t.maxAgeGameMinutes,t.firstMinute,t.expiresMinute]));
}

export function verifyFormalBerrySignedApproval(a:unknown,owner:DeveloperMvpSpiritFixtureOwner):a is FormalBerrySignedApproval {
 try{
  if(!owner.formalApprovalKeyPem||!exact(a,['terms','signature'])||!pattern(a.signature,signature))return false;
  const message=encodeFormalBerrySignedTerms(a.terms);
  if(!message||(a.terms as FormalBerrySignedTerms).fixtureScope!==formalBerryFixtureScope(owner))return false;
  const sig=Buffer.from(a.signature,'base64url'),key=createPublicKey(owner.formalApprovalKeyPem);
  return sig.length===64&&sig.toString('base64url')===a.signature&&key.asymmetricKeyType==='ed25519'&&verify(null,message,key,sig);
 }catch{return false;}
}

export function formalBerryEffectAnchor(rows:readonly FormalBerryFixtureEffect[]):FormalBerryFixtureAnchor {
 return {version:1,count:rows.length,digest:digest(JSON.stringify(rows))};
}
export function assertFormalBerryMirrorHeader(db:DatabaseSync,owner:DeveloperMvpSpiritFixtureOwner,
 worldId?:string,anchor?:unknown,revision?:number):readonly FormalBerryFixtureEffect[] {
 const table=db.prepare("SELECT sql,type FROM sqlite_schema WHERE name='formal_berry_fixture_effects' COLLATE NOCASE").get();
 const trigger=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name IN ('formal_berry_fixture_effects','mvp_spirit_developer_fixture') COLLATE NOCASE").get();
 if(!owner.formalApprovalKeyPem||table?.type!=='table'||table.sql!==FORMAL_BERRY_EFFECT_SCHEMA||trigger)
  throw Error('formal_berry_fixture_unknown_schema');
 const raw=db.prepare("SELECT draft_id,approval_id,length(CAST(body AS BLOB)) AS size,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body ELSE NULL END AS body FROM formal_berry_fixture_effects ORDER BY rowid LIMIT ?").all(owner.capacity.worldLots+1);
 if(raw.length>owner.capacity.worldLots)throw Error('formal_berry_fixture_archive_capacity');
 let floor=0;
 const rows=raw.map(value=>{
  if(typeof value.body!=='string')throw Error('formal_berry_fixture_archive_encoding');
  const saved:unknown=JSON.parse(value.body);
  if(!exact(saved,['approval','receipt','committedRevision'])||!verifyFormalBerrySignedApproval(saved.approval,owner)||
   !nat(saved.committedRevision)||saved.committedRevision<=floor||saved.committedRevision>Number(revision))
   throw Error('formal_berry_fixture_archive_approval');
  const t=saved.approval.terms,r=saved.receipt as FormalBerryDetachedReceipt;
  if(!r||t.worldId!==worldId||t.approvalId!==value.approval_id||r.draftId!==value.draft_id||t.revision+1!==saved.committedRevision||
   r.atRevision!==t.revision||r.item!=='berry'||r.sourceId!==t.sourceId||r.sourceBefore!==t.sourceBefore||
   r.rain?.episodeId!==t.episodeId||r.target?.x!==t.target.x||r.target?.y!==t.target.y||
   !minute(r.placedMinute)||r.placedMinute<t.firstMinute||r.placedMinute>=t.expiresMinute)
   throw Error('formal_berry_fixture_archive_binding');
  floor=saved.committedRevision;return saved as unknown as FormalBerryFixtureEffect;
 });
 if(rows.length){
  const expected=formalBerryEffectAnchor(rows);
  if(!exact(anchor,['version','count','digest'])||anchor.version!==expected.version||anchor.count!==expected.count||anchor.digest!==expected.digest)
   throw Error('formal_berry_fixture_archive_anchor');
 }else if(anchor!==undefined)throw Error('formal_berry_fixture_archive_missing');
 return rows;
}

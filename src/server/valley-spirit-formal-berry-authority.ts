import {createHash,createPublicKey,verify} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Vec,World} from '../shared/types.js';
import {DAY} from '../world/time.js';
import {pinNativeFormalBerryLot} from '../world/food.js';
import type {FormalBerryDetachedReceipt} from './valley-spirit-formal-berry-draft.js';
import type {DeveloperMvpSpiritFixtureOwner} from './valley-spirit-fixture-files.js';

const TABLE='formal_berry_fixture_effects';
export const FORMAL_BERRY_EFFECT_SCHEMA='CREATE TABLE '+TABLE+' (draft_id TEXT PRIMARY KEY NOT NULL, approval_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL)';
const LEGACY='sealed-formal-berry-approval/v1';
const VERSION='sealed-formal-berry-approval/v2';
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
 readonly schema:typeof VERSION|typeof LEGACY;readonly foodDefinition?:string;readonly foodLifeDays?:number;readonly item:'berry';readonly quantity:1;
 readonly fixtureScope:string;readonly worldId:string;readonly revision:number;readonly approvalId:string;
 readonly episodeId:string;readonly sourceId:string;readonly sourceBefore:number;readonly target:Vec;
 readonly maxAgeGameMinutes:number;readonly firstMinute:number;readonly expiresMinute:number;
}
export interface FormalBerrySignedApproval {readonly terms:FormalBerrySignedTerms;readonly signature:string;}
export interface FormalBerryGroundFoodBirth {
 readonly schemaVersion:1;readonly origin:'native-wild-berry-transfer';readonly item:'berry';
 readonly sourceId:string;readonly supplyReceiptId:string;readonly quantity:1;
 readonly producedAt:number;readonly expiresAt:number;readonly definition:string;
}
export interface FormalBerryFixtureEffect {
 readonly approval:FormalBerrySignedApproval;
 readonly receipt:FormalBerryDetachedReceipt;
 readonly committedRevision:number;
 readonly foodBirth?:FormalBerryGroundFoodBirth;
}
function foodBirthMatchesReceipt(food:unknown,r:FormalBerryDetachedReceipt):food is FormalBerryGroundFoodBirth {
 return exact(food,['schemaVersion','origin','item','sourceId','supplyReceiptId','quantity','producedAt','expiresAt','definition'])&&
  food.schemaVersion===1&&food.origin==='native-wild-berry-transfer'&&food.item==='berry'&&food.quantity===1&&
  food.sourceId===r.sourceId&&food.supplyReceiptId===r.draftId&&food.producedAt===r.placedMinute&&
  minute(food.producedAt)&&minute(food.expiresAt)&&food.expiresAt>food.producedAt&&
  pattern(food.definition,/^food\/life@[1-9][0-9]*$/u);
}

export function pinFormalGroundBerryFoodBirth(w:World,r:FormalBerryDetachedReceipt):FormalBerryGroundFoodBirth|null {
 const lot=pinNativeFormalBerryLot(w);
 if(!lot)return null;
 const birth:FormalBerryGroundFoodBirth={schemaVersion:1,origin:'native-wild-berry-transfer',item:'berry',
  sourceId:r.sourceId,supplyReceiptId:r.draftId,quantity:1,producedAt:lot.producedAt,expiresAt:lot.expiresAt,definition:lot.definition};
 return foodBirthMatchesReceipt(birth,r)&&validateFormalGroundBerryFoodBirth(w,{receipt:r,foodBirth:birth})?birth:null;
}

/** A version change may move the active pointer. It does not replace the
 * recorded definition or reset the clock of an old ground lot. */
export function validateFormalGroundBerryFoodBirth(w:World,effect:Pick<FormalBerryFixtureEffect,'receipt'|'foodBirth'>):boolean {
 const f=effect.foodBirth;
 if(!foodBirthMatchesReceipt(f,effect.receipt))return false;
 const definition=w.definitions[f.definition],days=(definition?.data.days as Record<string,unknown>|undefined)?.berry;
 return definition?.id==='food/life'&&definition.kind==='life'&&f.definition===`food/life@${definition.version}`&&
  typeof days==='number'&&Number.isFinite(days)&&days>0&&days<=448&&f.expiresAt===f.producedAt+days*DAY;
}
export const formalBerryFixtureScope=(owner:DeveloperMvpSpiritFixtureOwner)=>digest('sealed-formal-berry:'+owner.seal);
export function encodeFormalBerrySignedTerms(t:unknown):Buffer|null {
 const next=!!t&&typeof t==='object'&&'schema' in t&&t.schema===VERSION;
 if(!exact(t,['schema','item','quantity','fixtureScope','worldId','revision','approvalId','episodeId','sourceId','sourceBefore',
  'target','maxAgeGameMinutes','firstMinute','expiresMinute',...(next?['foodDefinition','foodLifeDays']:[])])||
  (t.schema!==VERSION&&t.schema!==LEGACY)||t.item!=='berry'||t.quantity!==1||
  !pattern(t.fixtureScope,hex)||!pattern(t.worldId,nativeId)||!nat(t.revision)||!pattern(t.approvalId,approvalId)||
  !pattern(t.episodeId,rainId)||!pattern(t.sourceId,/^bush-\d{1,8}-\d{1,8}$/u)||!nat(t.sourceBefore)||t.sourceBefore<1||
  !exact(t.target,['x','y'])||!nat(t.target.x)||!nat(t.target.y)||!nat(t.maxAgeGameMinutes)||t.maxAgeGameMinutes<1||
  t.maxAgeGameMinutes>40320||!minute(t.firstMinute)||!minute(t.expiresMinute)||t.firstMinute>=t.expiresMinute)return null;
 if(next&&(!pattern(t.foodDefinition,/^food\/life@[1-9][0-9]*$/u)||typeof t.foodLifeDays!=='number'||
  !Number.isFinite(t.foodLifeDays)||t.foodLifeDays<=0||t.foodLifeDays>448))return null;
 return Buffer.from(JSON.stringify([t.schema,t.item,t.quantity,t.fixtureScope,t.worldId,t.revision,t.approvalId,t.episodeId,t.sourceId,
  t.sourceBefore,t.target.x,t.target.y,t.maxAgeGameMinutes,t.firstMinute,t.expiresMinute,
  ...(next?[t.foodDefinition,t.foodLifeDays]:[])]));
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
  const keys=['approval','receipt','committedRevision',...(saved&&typeof saved==='object'&&Object.hasOwn(saved,'foodBirth')?['foodBirth']:[])];
  if(!exact(saved,keys)||!verifyFormalBerrySignedApproval(saved.approval,owner)||
   !nat(saved.committedRevision)||saved.committedRevision<=floor||saved.committedRevision>Number(revision))
   throw Error('formal_berry_fixture_archive_approval');
  const t=saved.approval.terms,r=saved.receipt as FormalBerryDetachedReceipt;
  if(!r||t.worldId!==worldId||t.approvalId!==value.approval_id||r.draftId!==value.draft_id||t.revision+1!==saved.committedRevision||
   r.atRevision!==t.revision||r.item!=='berry'||r.sourceId!==t.sourceId||r.sourceBefore!==t.sourceBefore||
   r.rain?.episodeId!==t.episodeId||r.target?.x!==t.target.x||r.target?.y!==t.target.y||
   !minute(r.placedMinute)||r.placedMinute<t.firstMinute||r.placedMinute>=t.expiresMinute||
   (t.schema===VERSION?(!foodBirthMatchesReceipt(saved.foodBirth,r)||saved.foodBirth.definition!==t.foodDefinition||
    saved.foodBirth.expiresAt!==saved.foodBirth.producedAt+t.foodLifeDays!*DAY):Object.hasOwn(saved,'foodBirth')))
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

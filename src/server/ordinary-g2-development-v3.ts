import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../shared/types.js';
import {minuteToClimateUs} from '../world/mvp-climate.js';
import {inspectMvpGroundFruitGeography} from '../world/mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {valleySpiritFruitFallOpportunityId} from './valley-spirit-proposal.js';
import {authenticateOrdinaryG2DevelopmentV3,type OrdinaryG2DevelopmentOrigin} from './ordinary-g2-development-origin.js';

const MODE='ordinary-g2-development-v3-one-unit/v1',SIGN='ordinary-g2-development-v3-exact-consent/v1';
const LATCH='ordinary_g2_development_v3_placed';
const GROUND='valley_spirit_ordinary_g2_dev_ground_v3',RECEIPT='valley_spirit_ordinary_g2_dev_receipt_v3';
const gddl='CREATE TABLE '+GROUND+' (slot INTEGER PRIMARY KEY NOT NULL CHECK(slot=1), body TEXT NOT NULL)';
const rddl='CREATE TABLE '+RECEIPT+' (opportunity TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, seal TEXT NOT NULL)';
const exact=(p:unknown,k:readonly string[]):p is Record<string,unknown>=>!!p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===k.length&&k.every(x=>Object.hasOwn(p,x));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hex=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const string=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=300;
const int=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const clock=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v);
const point=(v:unknown)=>exact(v,['x','y'])&&int(v.x)&&int(v.y);
const policy=hash([MODE,'one-unit','native-closed-rain','original-lot-age','commons','no-advance-while-ground','not-production']);
export type OrdinaryDevelopmentV3Options=Readonly<{mode:typeof MODE;reviewerPublicKeyPem:string}>;
type Pin=Readonly<{key:KeyObject;fingerprint:string}>;
const pins=new WeakSet<Pin>();
export type OrdinaryDevelopmentV3Pin=Pin;
export function pinOrdinaryDevelopmentV3(input:unknown):Pin|null{
 try{
  if(!exact(input,['mode','reviewerPublicKeyPem'])||input.mode!==MODE||typeof input.reviewerPublicKeyPem!=='string'||
   input.reviewerPublicKeyPem.length>256||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(input.reviewerPublicKeyPem))return null;
  const k=createPublicKey(input.reviewerPublicKeyPem);
  if(k.asymmetricKeyType!=='ed25519')return null;
  const p=Object.freeze({key:k,fingerprint:createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex')});
  pins.add(p);return p;
 }catch{return null;}
}
export const ownsOrdinaryDevelopmentV3Pin=(p:unknown)=>!!p&&typeof p==='object'&&pins.has(p as Pin);
const keys=['schema','policy','originScope','reviewer','reviewDigest','snapshot','headDigest','worldId','revision','permissionVersion','opportunityId',
 'rainEventId','sourceId','sourceInstanceId','targetId','atUs','eligibleUntilUs','lotId','bornUs','expiresUs','ownerId','quantity'] as const;
export type OrdinaryDevelopmentV3Terms=Readonly<{schema:typeof SIGN;policy:string;originScope:string;reviewer:string;reviewDigest:string;snapshot:string;headDigest:string;
 worldId:string;revision:number;permissionVersion:number;opportunityId:string;rainEventId:string;sourceId:string;sourceInstanceId:string;targetId:string;
 atUs:string;eligibleUntilUs:string;lotId:string;bornUs:string;expiresUs:string;ownerId:'commons';quantity:1}>;
export function ordinaryDevelopmentV3Terms(origin:OrdinaryG2DevelopmentOrigin,pin:Pin,input:Omit<OrdinaryDevelopmentV3Terms,'schema'|'policy'|'originScope'|'reviewer'>){
 if(!pins.has(pin))return null;
 const t={schema:SIGN,policy,originScope:authenticateOrdinaryG2DevelopmentV3(origin,'consent-scope',pin.fingerprint),
  reviewer:pin.fingerprint,...input};
 return encodeOrdinaryDevelopmentV3(t)?Object.freeze(t):null;
}
export function encodeOrdinaryDevelopmentV3(t:unknown){
 if(!exact(t,keys)||t.schema!==SIGN||t.policy!==policy||t.ownerId!=='commons'||t.quantity!==1||!int(t.revision)||!int(t.permissionVersion)||
  !['originScope','reviewer','reviewDigest','snapshot','headDigest'].every(k=>hex(t[k]))||
  !['worldId','opportunityId','rainEventId','sourceId','sourceInstanceId','targetId','lotId'].every(k=>string(t[k]))||
  !clock(t.atUs)||!clock(t.eligibleUntilUs)||!clock(t.bornUs)||!clock(t.expiresUs)||
  BigInt(t.bornUs)>BigInt(t.atUs)||BigInt(t.atUs)>=BigInt(t.eligibleUntilUs)||BigInt(t.eligibleUntilUs)>BigInt(t.expiresUs))return null;
 return Buffer.from(JSON.stringify([MODE,...keys.map(k=>t[k])]));
}
type Approval=Readonly<{terms:OrdinaryDevelopmentV3Terms;signature:string}>;
export function verifyOrdinaryDevelopmentV3(v:unknown,origin:OrdinaryG2DevelopmentOrigin,pin:Pin):Approval|null{
 try{
  if(!pins.has(pin)||!exact(v,['terms','signature'])||typeof v.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(v.signature))return null;
  const bytes=encodeOrdinaryDevelopmentV3(v.terms),sig=Buffer.from(v.signature,'base64url'),t=v.terms as OrdinaryDevelopmentV3Terms;
  if(!bytes||v.signature!==sig.toString('base64url')||t.reviewer!==pin.fingerprint||
   t.originScope!==authenticateOrdinaryG2DevelopmentV3(origin,'consent-scope',pin.fingerprint)||!verify(null,bytes,pin.key,sig))return null;
  return {terms:Object.fromEntries(keys.map(k=>[k,t[k]])) as OrdinaryDevelopmentV3Terms,signature:v.signature};
 }catch{return null;}
}
type Ground=Readonly<{schema:'ordinary-g2-development-ground/v3';effectId:string;sourceId:string;sourceInstanceId:string;sourceAt:{x:number;y:number};
 at:{x:number;y:number};targetId:string;ownerId:'commons';quantity:1;lotId:string;bornUs:string;expiresUs:string;placedUs:string}>;
type Archive=Readonly<{schema:'ordinary-g2-development-receipt/v3';approval:Approval;sourceBefore:number;sourceAfter:number;afterRevision:number;afterDigest:string;groundDigest:string}>;
function digestHead(db:DatabaseSync,w:World){
 const rows=db.prepare('SELECT id,revision,state FROM main.worlds LIMIT 2').all(),r=rows[0];
 return rows.length===1&&r.id===w.id&&r.revision===w.revision&&r.state instanceof Uint8Array?createHash('sha256').update(r.state).digest('hex'):null;
}
function latch(db:DatabaseSync,strict=false){
 const m=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name)='archive_meta'").get();
 if(!m&&!strict)return null;
 if(m?.type!=='table'||m.sql!=='CREATE TABLE archive_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)'||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name)='archive_meta' AND type='trigger'").get()||
   db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name)='archive_meta' OR lower(tbl_name)='archive_meta'").get())
  throw Error('ordinary_g2_dev_v3_anchor_schema');
 const r=db.prepare("SELECT CASE WHEN length(value)=64 THEN value END AS value FROM main.archive_meta WHERE key=?").get(LATCH);
 if(r&&!hex(r.value))throw Error('ordinary_g2_dev_v3_anchor_value');
 return r?r.value as string:null;
}
function tables(db:DatabaseSync){
 const names=[GROUND,RECEIPT];
 const actual=db.prepare("SELECT name,type,sql FROM main.sqlite_schema WHERE lower(name) IN (?,?)").all(...names);
 if(!actual.length){if(latch(db)!==null)throw Error('ordinary_g2_dev_v3_orphan_anchor');return false;}
 if(latch(db,true)===null)throw Error('ordinary_g2_dev_v3_missing_anchor');
 if(actual.length!==2||!actual.every(r=>r.type==='table'&&(r.name===GROUND&&r.sql===gddl||r.name===RECEIPT&&r.sql===rddl))||
   db.prepare("SELECT 1 FROM main.sqlite_schema WHERE lower(tbl_name) IN (?,?) AND (type='trigger' OR (type='index' AND sql IS NOT NULL))").get(...names)||
   db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE lower(name) IN (?,?,'worlds') OR lower(tbl_name) IN (?,?,'worlds')").get(...names,...names))
  throw Error('ordinary_g2_dev_v3_schema');
 return true;
}
export function readOrdinaryDevelopmentV3(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:Pin,w:World){
 if(!tables(db))return null;
 const gr=db.prepare('SELECT slot,CASE WHEN length(CAST(body AS BLOB))<=4096 THEN body END AS body FROM main.'+GROUND+' LIMIT 2').all();
 const rr=db.prepare('SELECT opportunity,CASE WHEN length(CAST(body AS BLOB))<=8192 THEN body END AS body,seal FROM main.'+RECEIPT+' LIMIT 2').all();
 const rg=gr[0],ar=rr[0];
 if(gr.length!==1||rr.length!==1||rg.slot!==1||typeof rg.body!=='string'||typeof ar.body!=='string'||
  ar.seal!==authenticateOrdinaryG2DevelopmentV3(origin,'v3-receipt',ar.body)||latch(db,true)!==ar.seal)throw Error('ordinary_g2_dev_v3_receipt');
 const g=JSON.parse(rg.body) as Ground,a=JSON.parse(ar.body) as Archive,c=verifyOrdinaryDevelopmentV3(a.approval,origin,pin);
 if(!c||!exact(a,['schema','approval','sourceBefore','sourceAfter','afterRevision','afterDigest','groundDigest'])||a.schema!=='ordinary-g2-development-receipt/v3'||
  !int(a.sourceBefore)||!int(a.sourceAfter)||a.sourceAfter!==a.sourceBefore-1||a.afterRevision!==c.terms.revision+1||
  w.revision!==a.afterRevision||w.id!==c.terms.worldId||minuteToClimateUs(w.minute)!==c.terms.atUs||
  a.afterDigest!==digestHead(db,w)||a.groundDigest!==hash(g)||ar.opportunity!==c.terms.opportunityId||
  !exact(g,['schema','effectId','sourceId','sourceInstanceId','sourceAt','at','targetId','ownerId','quantity','lotId','bornUs','expiresUs','placedUs'])||
  g.schema!=='ordinary-g2-development-ground/v3'||g.effectId!=='ordinary-g2-dev-v3:'+hash(c.terms.opportunityId)||
  g.sourceId!==c.terms.sourceId||g.sourceInstanceId!==c.terms.sourceInstanceId||g.ownerId!==c.terms.ownerId||
  g.targetId!==c.terms.targetId||g.lotId!==c.terms.lotId||g.quantity!==1||g.bornUs!==c.terms.bornUs||g.expiresUs!==c.terms.expiresUs||g.placedUs!==c.terms.atUs||
  !point(g.sourceAt)||!point(g.at)||g.targetId!=='ground:'+g.at.x+':'+g.at.y||
  valleySpiritFruitFallOpportunityId(w.id,c.terms.rainEventId,g.sourceInstanceId)!==c.terms.opportunityId||
  w.resources.filter(r=>r.id===g.sourceId&&r.amount===a.sourceAfter&&r.at.x===g.sourceAt.x&&r.at.y===g.sourceAt.y).length!==1||
  !resolveMvpRainEpisode(w,c.terms.rainEventId))throw Error('ordinary_g2_dev_v3_mismatch');
 return {ground:g,receipt:a,approval:c};
}
/** Invoke only from the original scoped WorldStore transaction after the actual debit. */
export function writeOrdinaryDevelopmentV3(db:DatabaseSync,origin:OrdinaryG2DevelopmentOrigin,pin:Pin,
 before:World,after:World,target:{x:number;y:number},signed:unknown){
 const approval=verifyOrdinaryDevelopmentV3(signed,origin,pin),h=digestHead(db,after);
 if(!db.isTransaction||!approval||!h||tables(db))throw Error('ordinary_g2_dev_v3_scope');
 const t=approval.terms,geo=inspectMvpGroundFruitGeography(before,t.sourceId,target),source=before.resources.find(r=>r.id===t.sourceId);
 if(!geo||geo.targetId!==t.targetId||geo.source.resourceInstanceId!==t.sourceInstanceId||geo.source.ownerId!==t.ownerId||
   before.revision!==t.revision||after.revision!==t.revision+1||t.atUs!==minuteToClimateUs(before.minute)||!source||source.amount<1||
   after.resources.find(r=>r.id===t.sourceId)?.amount!==source.amount-1)throw Error('ordinary_g2_dev_v3_ground');
 const g:Ground={schema:'ordinary-g2-development-ground/v3',effectId:'ordinary-g2-dev-v3:'+hash(t.opportunityId),
  sourceId:t.sourceId,sourceInstanceId:t.sourceInstanceId,sourceAt:{...source.at},at:{...target},targetId:t.targetId,
  ownerId:'commons',quantity:1,lotId:t.lotId,bornUs:t.bornUs,expiresUs:t.expiresUs,placedUs:t.atUs};
 const a:Archive={schema:'ordinary-g2-development-receipt/v3',approval,sourceBefore:source.amount,sourceAfter:source.amount-1,
  afterRevision:after.revision,afterDigest:h,groundDigest:hash(g)};
 const raw=JSON.stringify(a),seal=authenticateOrdinaryG2DevelopmentV3(origin,'v3-receipt',raw);
 if(latch(db,true)!==null)throw Error('ordinary_g2_dev_v3_anchor_exists');
 db.exec(gddl);db.exec(rddl);
 db.prepare('INSERT INTO main.'+GROUND+' VALUES(1,?)').run(JSON.stringify(g));
 db.prepare('INSERT INTO main.'+RECEIPT+' VALUES(?,?,?)').run(t.opportunityId,raw,seal);
 db.prepare('INSERT INTO main.archive_meta (key,value) VALUES(?,?)').run(LATCH,seal);
 if(!readOrdinaryDevelopmentV3(db,origin,pin,after))throw Error('ordinary_g2_dev_v3_readback');
 return {status:'development-v3-stored' as const,ground:g,sourceBefore:a.sourceBefore,sourceAfter:a.sourceAfter,approvalPresent:true as const,
  productionApproved:false as const,executionAuthorized:false as const};
}

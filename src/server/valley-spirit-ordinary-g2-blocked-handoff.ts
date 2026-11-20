import {createPublicKey,verify,type KeyObject} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {parseClimateUs} from '../world/mvp-climate.js';
import {ordinaryAgedG1DecisionSigningBytes,ordinaryG1DecisionDigest,ordinaryG1DecisionHash,
 type OrdinaryG1DecisionTerms} from './valley-spirit-ordinary-g1-decision.js';

export const ORDINARY_G2_HANDOFF_PURPOSE='ordinary-rules-g2-blocked-handoff-review/v1' as const;
export const ORDINARY_G2_HANDOFF_BLOCKERS=Object.freeze(['production-single-type-approval','ordinary-native-ground-custody','fresh-head-execution-policy'] as const);
const BLOCK_POLICY='ordinary-mvp-fruit-fall-no-production-approval/v1' as const;
const table='valley_spirit_ordinary_g2_blocked_handoff',anchor='valley_spirit_ordinary_g2_blocked_handoff/v1';
const shape=' (seq INTEGER PRIMARY KEY CHECK(seq=1),body TEXT NOT NULL)';
const maxBytes=8192;
const fields=['purpose','policy','effectType','outcome','approvalPresent','g1DecisionId','g1SignedRecordDigest','worldId',
 'saveScope','revision','atUs','untilUs','headDigest','permissionVersion','g1Epoch','g1ReviewerKeyId','effectReviewerKeyId',
 'proposalId','opportunityId','inputSnapshotId','sourceLotId','targetId'] as const;
type Bounds=Pick<OrdinaryG1DecisionTerms,'worldId'|'saveScope'|'revision'|'atUs'|'untilUs'|'headDigest'|'permissionVersion'|
 'proposalId'|'opportunityId'|'inputSnapshotId'|'sourceLotId'|'targetId'>;
export type OrdinaryG2BlockedHandoffTerms=Readonly<Bounds&{
 purpose:typeof ORDINARY_G2_HANDOFF_PURPOSE;policy:typeof BLOCK_POLICY;effectType:'fruit-fall';
 outcome:'execution-blocked';approvalPresent:false;g1DecisionId:string;g1SignedRecordDigest:string;
 g1Epoch:number;g1ReviewerKeyId:string;effectReviewerKeyId:string;
}>;
export interface OrdinaryG2BlockedHandoffOptions{
 readonly scope:typeof ORDINARY_G2_HANDOFF_PURPOSE;
 readonly effectReviewerPublicKeyPem:string;
}
const exact=(o:unknown,k:readonly string[]):o is Record<string,unknown>=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const integer=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const hex=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const token=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/u.test(v);
export function pinOrdinaryG2BlockedHandoff(value:unknown){
 try{
  const v:unknown=structuredClone(value);
  if(!exact(v,['scope','effectReviewerPublicKeyPem'])||v.scope!==ORDINARY_G2_HANDOFF_PURPOSE||
   typeof v.effectReviewerPublicKeyPem!=='string'||v.effectReviewerPublicKeyPem.length>256||
   !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/u.test(v.effectReviewerPublicKeyPem))return null;
  const key=createPublicKey(v.effectReviewerPublicKeyPem);
  return key.asymmetricKeyType==='ed25519'?Object.freeze({key,keyId:ordinaryG1DecisionHash(key.export({type:'spki',format:'der'}))}):null;
 }catch{return null;}
}
export function ordinaryG2BlockedHandoffSigningBytes(v:unknown):Buffer|null{
 try{
  if(!exact(v,fields)||v.purpose!==ORDINARY_G2_HANDOFF_PURPOSE||v.policy!==BLOCK_POLICY||v.effectType!=='fruit-fall'||
   v.outcome!=='execution-blocked'||v.approvalPresent!==false||typeof v.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u.test(v.worldId)||
   !integer(v.revision)||!integer(v.g1Epoch)||!integer(v.permissionVersion,1)||v.g1ReviewerKeyId===v.effectReviewerKeyId||
   ![v.g1DecisionId,v.g1SignedRecordDigest,v.saveScope,v.headDigest,v.g1ReviewerKeyId,v.effectReviewerKeyId].every(hex)||
   ![v.proposalId,v.opportunityId,v.inputSnapshotId,v.sourceLotId,v.targetId].every(token)||
   typeof v.atUs!=='string'||typeof v.untilUs!=='string')return null;
  const at=parseClimateUs(v.atUs),until=parseClimateUs(v.untilUs);
  if(until<=at||until-at>60_000_000n)return null;
  return Buffer.from(JSON.stringify(fields.map(k=>v[k])));
 }catch{return null;}
}
type Prior=Readonly<{terms:OrdinaryG1DecisionTerms;signature:string;review:unknown;reviewerDer:string}>;
/** Encoding only. The runtime exclusively invokes this on an actual current
 * signed G1 record read and revalidated under its ordinary file ownership. */
export function encodeOrdinaryG2BlockedHandoffTerms(g1:Prior,effectReviewerKeyId:string):OrdinaryG2BlockedHandoffTerms|null{
 const a=g1.terms,id=ordinaryAgedG1DecisionSigningBytes(a);
 if(!id)return null;
 const terms:OrdinaryG2BlockedHandoffTerms=Object.freeze({purpose:ORDINARY_G2_HANDOFF_PURPOSE,policy:BLOCK_POLICY,effectType:'fruit-fall',
  outcome:'execution-blocked',approvalPresent:false,g1DecisionId:ordinaryG1DecisionHash(id),g1SignedRecordDigest:ordinaryG1DecisionDigest(g1),
  worldId:a.worldId,saveScope:a.saveScope,revision:a.revision,atUs:a.atUs,untilUs:a.untilUs,headDigest:a.headDigest,
  permissionVersion:a.permissionVersion,g1Epoch:a.epoch,g1ReviewerKeyId:a.reviewerKeyId,effectReviewerKeyId,
  proposalId:a.proposalId,opportunityId:a.opportunityId,inputSnapshotId:a.inputSnapshotId,sourceLotId:a.sourceLotId,targetId:a.targetId});
 return ordinaryG2BlockedHandoffSigningBytes(terms)?terms:null;
}
function signatureBytes(v:unknown){
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(v))return null;
 const b=Buffer.from(v,'base64url');
 return b.length===64&&b.toString('base64url')===v?b:null;
}
type StoredHandoff=Readonly<{terms:OrdinaryG2BlockedHandoffTerms;signature:string;reviewerDer:string}>;
export function readOrdinaryG2HandoffRecord(db:DatabaseSync,owner:Pick<Bounds,'worldId'|'saveScope'>):StoredHandoff|null{
 const object=db.prepare('SELECT type,sql FROM main.sqlite_master WHERE name=?').get(table);
 const mark=db.prepare('SELECT CASE WHEN length(value)<=64 THEN value END AS value FROM main.archive_meta WHERE key=?').get(anchor);
 if(!object&&!mark)return null;
 if(object?.type!=='table'||object.sql!=='CREATE TABLE '+table+shape||!hex(mark?.value)||
  db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='trigger' AND tbl_name IN (?, 'archive_meta') LIMIT 1").get(table))
  throw Error('ordinary_g2_handoff_shape');
 const rows=db.prepare(`SELECT seq,CASE WHEN length(CAST(body AS BLOB))<=? THEN body END AS body FROM main.${table} LIMIT 2`).all(maxBytes);
 if(rows.length!==1||rows[0].seq!==1||typeof rows[0].body!=='string'||ordinaryG1DecisionHash(rows[0].body)!==mark?.value)
  throw Error('ordinary_g2_handoff_anchor');
 const data:unknown=JSON.parse(rows[0].body);
 if(!exact(data,['terms','signature','reviewerDer'])||typeof data.reviewerDer!=='string'||!/^[A-Za-z0-9_-]{59}$/u.test(data.reviewerDer)||
  JSON.stringify(data)!==rows[0].body)throw Error('ordinary_g2_handoff_record');
 const stored=data as StoredHandoff,bytes=ordinaryG2BlockedHandoffSigningBytes(stored.terms),signature=signatureBytes(stored.signature);
 const der=Buffer.from(stored.reviewerDer,'base64url'),key=createPublicKey({key:der,format:'der',type:'spki'});
 if(!bytes||!signature||der.toString('base64url')!==stored.reviewerDer||key.asymmetricKeyType!=='ed25519'||
  !key.export({type:'spki',format:'der'}).equals(der)||ordinaryG1DecisionHash(der)!==stored.terms.effectReviewerKeyId||
  stored.terms.worldId!==owner.worldId||stored.terms.saveScope!==owner.saveScope||!verify(null,bytes,key,signature))
  throw Error('ordinary_g2_handoff_signature');
 return stored;
}
export function sameOrdinaryG2HandoffTerms(a:OrdinaryG2BlockedHandoffTerms,b:OrdinaryG2BlockedHandoffTerms){
 const x=ordinaryG2BlockedHandoffSigningBytes(a),y=ordinaryG2BlockedHandoffSigningBytes(b);
 return !!x&&!!y&&x.equals(y);
}
/** One immutable pre-execution audit record. Never writes a world or creates
 * a reservation, release, approval or job. Requires an owning write transaction. */
export function appendOrdinaryG2BlockedHandoff(db:DatabaseSync,terms:OrdinaryG2BlockedHandoffTerms,review:unknown,key:KeyObject){
 if(!db.isTransaction||!exact(review,['terms','signature'])||typeof review.signature!=='string')return null;
 const bytes=ordinaryG2BlockedHandoffSigningBytes(terms),offered=ordinaryG2BlockedHandoffSigningBytes(review.terms);
 const sig=signatureBytes(review.signature),der=key.export({type:'spki',format:'der'});
 if(key.asymmetricKeyType!=='ed25519'||ordinaryG1DecisionHash(der)!==terms.effectReviewerKeyId||!bytes||!offered||!offered.equals(bytes)||
  !sig||!verify(null,bytes,key,sig))return null;
 const id=ordinaryG1DecisionHash(bytes),existing=readOrdinaryG2HandoffRecord(db,terms);
 if(existing)return sameOrdinaryG2HandoffTerms(existing.terms,terms)?{id,replay:true as const}:null;
 if(db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='trigger' AND tbl_name IN (?, 'archive_meta') LIMIT 1").get(table))
  throw Error('ordinary_g2_handoff_write_surface');
 const data=JSON.stringify({terms,signature:review.signature,reviewerDer:der.toString('base64url')});
 if(Buffer.byteLength(data)>maxBytes)return null;
 db.exec(`CREATE TABLE ${table}${shape}`);
 db.prepare(`INSERT INTO main.${table}(seq,body) VALUES(1,?)`).run(data);
 db.prepare('INSERT INTO main.archive_meta(key,value) VALUES(?,?)').run(anchor,ordinaryG1DecisionHash(data));
 const stored=readOrdinaryG2HandoffRecord(db,terms);
 if(!stored||JSON.stringify(stored)!==data)throw Error('ordinary_g2_handoff_readback');
 return {id,replay:false as const};
}

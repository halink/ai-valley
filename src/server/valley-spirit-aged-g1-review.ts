import {createPublicKey,verify} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {parseClimateUs} from '../world/mvp-climate.js';
import type {buildSealedMvpAgedG1Basis} from './valley-spirit-aged-g1.js';

const TABLE='sealed_aged_g1_review_epoch';
const SQL='CREATE TABLE '+TABLE+' (seal TEXT PRIMARY KEY NOT NULL, epoch INTEGER NOT NULL)';
const REVIEW='sealed-aged-mvp-g1-review-only/v1';
const REVOKE='sealed-aged-mvp-g1-revoke-prior-reviews/v1';
const REVIEW_FIELDS=['purpose','fixtureScopeId','worldId','worldRevision','atUs','proposalId','opportunityId',
 'permissionVersion','creditId','ageTermsDigest','assessmentDigest','epoch','untilUs'] as const;
const REVOKE_FIELDS=['purpose','fixtureScopeId','worldId','epoch','nextEpoch'] as const;
const exact=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

export function agedG1ReviewSigningBytes(value:unknown):Buffer|null {
 const fields=value&&typeof value==='object'&&'purpose' in value&&value.purpose===REVIEW?REVIEW_FIELDS:REVOKE_FIELDS;
 if(!exact(value,fields)||(value.purpose!==REVIEW&&value.purpose!==REVOKE)||
  typeof value.fixtureScopeId!=='string'||!/^[a-f0-9]{64}$/u.test(value.fixtureScopeId)||
  typeof value.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,180}$/u.test(value.worldId)||!nat(value.epoch))return null;
 if(value.purpose===REVIEW){
  if(!nat(value.worldRevision)||!nat(value.permissionVersion)||value.permissionVersion<1||
   !['creditId','ageTermsDigest','assessmentDigest'].every(k=>typeof value[k]==='string'&&/^[a-f0-9]{64}$/u.test(value[k] as string))||
   typeof value.proposalId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u.test(value.proposalId)||
   typeof value.opportunityId!=='string'||!/^fruit_fall:[a-f0-9]{64}$/u.test(value.opportunityId))return null;
  if(typeof value.untilUs!=='string'||typeof value.atUs!=='string')return null;
  try{if(parseClimateUs(value.untilUs)<=parseClimateUs(value.atUs))return null;}catch{return null;}
 }else if(!nat(value.nextEpoch)||value.nextEpoch!==value.epoch+1)return null;
 return Buffer.from(JSON.stringify(fields.map(k=>value[k])));
}
export function verifiesAgedG1Review(keyPem:string,expected:unknown,signed:unknown){
 try{
  if(!exact(signed,['terms','signature'])||typeof signed.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(signed.signature))return false;
  const actual=agedG1ReviewSigningBytes(signed.terms),wanted=agedG1ReviewSigningBytes(expected);
  const signature=Buffer.from(signed.signature,'base64url'),key=createPublicKey(keyPem);
  return !!actual&&!!wanted&&actual.equals(wanted)&&signature.length===64&&signature.toString('base64url')===signed.signature&&
   key.asymmetricKeyType==='ed25519'&&verify(null,wanted,key,signature);
 }catch{return false;}
}
export function agedG1ReviewTerms(result:NonNullable<ReturnType<typeof buildSealedMvpAgedG1Basis>>,epoch:number){
 const b=result.basis;
 return {purpose:REVIEW,fixtureScopeId:b.fixtureScopeId,worldId:b.worldId,worldRevision:b.worldRevision,atUs:b.atUs,
  proposalId:b.proposalId,opportunityId:b.opportunityId,permissionVersion:b.permissionVersion,creditId:b.creditId,
  ageTermsDigest:b.ageTermsDigest,assessmentDigest:result.assessmentDigest,epoch,untilUs:b.validUntilUs} as const;
}
export function agedG1RevokeTerms(fixtureScopeId:string,worldId:string,epoch:number){
 return {purpose:REVOKE,fixtureScopeId,worldId,epoch,nextEpoch:epoch+1} as const;
}
export function initializeAgedG1ReviewEpoch(db:DatabaseSync,seal:string){
 db.exec(SQL);
 db.prepare('INSERT INTO sealed_aged_g1_review_epoch VALUES (?,0)').run(seal);
}
export function readAgedG1ReviewEpoch(db:DatabaseSync,seal:string){
 const t=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE').get(TABLE);
 if(t?.type!=='table'||t.sql!==SQL||
  db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name=? COLLATE NOCASE").get(TABLE)||
  db.prepare("SELECT 1 FROM sqlite_temp_schema WHERE name=? COLLATE NOCASE OR tbl_name=? COLLATE NOCASE").get(TABLE,TABLE))throw Error('aged_g1_review_epoch_schema');
 const r=db.prepare('SELECT seal,epoch FROM sealed_aged_g1_review_epoch LIMIT 2').all();
 if(r.length!==1||r[0].seal!==seal||!nat(r[0].epoch))throw Error('aged_g1_review_epoch_missing');
 return r[0].epoch;
}
export function advanceAgedG1ReviewEpoch(db:DatabaseSync,seal:string,epoch:number){
 if(!nat(epoch+1)||db.prepare('UPDATE sealed_aged_g1_review_epoch SET epoch=? WHERE seal=? AND epoch=?')
  .run(epoch+1,seal,epoch).changes!==1)throw Error('aged_g1_review_epoch_changed');
}

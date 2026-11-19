import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import type {ValleySpiritShadowEntry} from './valley-spirit-shadow-queue.js';

const VERSION='valley-fixture-fruit-fall-approval/v1';
const HEX=/^[a-f0-9]{64}$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/u;
const SIG=/^[A-Za-z0-9_-]{86}$/u;
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const test=(v:unknown,p:RegExp):v is string=>typeof v==='string'&&p.test(v);

export interface DeveloperMvpFruitFallSignedTerms {
 readonly schema:typeof VERSION;
 readonly type:'fruit_fall';
 readonly fixtureScopeId:string;
 readonly assessmentDigest:string;
 readonly proposalId:string;
 readonly approvalId:string;
 readonly firstMicroMinute:number;
 readonly expiresMicroMinute:number;
 readonly maxCommittedEffects:number;
}
export interface DeveloperMvpFruitFallSignedApproval {
 readonly terms:DeveloperMvpFruitFallSignedTerms;
 readonly signature:string; // Ed25519 / canonical base64url
}
export interface DeveloperMvpFruitFallVerificationPolicy {
 readonly scope:'independent-sealed-fruit-fall';
 readonly verificationKeyPem:string;
 readonly maxCommittedEffects:number;
}
export function readDeveloperMvpFruitFallVerificationPolicy(value:unknown):{
 readonly key:KeyObject;readonly maxCommittedEffects:number;
}|null {
 try{
  if(!exact(value,['scope','verificationKeyPem','maxCommittedEffects'])||value.scope!=='independent-sealed-fruit-fall'||
   typeof value.verificationKeyPem!=='string'||value.verificationKeyPem.length>256||
   !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/u.test(value.verificationKeyPem)||
   !natural(value.maxCommittedEffects)||value.maxCommittedEffects<1||value.maxCommittedEffects>4096)return null;
  const key=createPublicKey(value.verificationKeyPem);
  return key.asymmetricKeyType==='ed25519'?{key,maxCommittedEffects:value.maxCommittedEffects}:null;
 }catch{return null;}
}

/** Canonical bytes for an independent offline signer. No signing key enters
 * the coordinator, and candidate assessment itself never produces approval. */
export function encodeDeveloperMvpFruitFallSignedTerms(v:unknown):Buffer|null {
 if(!exact(v,['schema','type','fixtureScopeId','assessmentDigest','proposalId','approvalId',
  'firstMicroMinute','expiresMicroMinute','maxCommittedEffects'])||v.schema!==VERSION||v.type!=='fruit_fall'||
  !test(v.fixtureScopeId,HEX)||!test(v.assessmentDigest,HEX)||!test(v.proposalId,ID)||!test(v.approvalId,ID)||
  !natural(v.firstMicroMinute)||!natural(v.expiresMicroMinute)||v.firstMicroMinute>=v.expiresMicroMinute||
  !natural(v.maxCommittedEffects)||v.maxCommittedEffects<1||v.maxCommittedEffects>4096)return null;
 return Buffer.from(JSON.stringify([VERSION,'sealed-developer-fixture-only','fruit_fall',v.fixtureScopeId,v.assessmentDigest,
  v.proposalId,v.approvalId,v.firstMicroMinute,v.expiresMicroMinute,v.maxCommittedEffects]),'utf8');
}
export function verifyDeveloperMvpFruitFallSignedApproval(
 value:unknown,key:KeyObject,
):DeveloperMvpFruitFallSignedTerms|null {
 try{
  if(!exact(value,['terms','signature'])||!test(value.signature,SIG))return null;
  const message=encodeDeveloperMvpFruitFallSignedTerms(value.terms);
  const signature=Buffer.from(value.signature,'base64url');
  if(!message||signature.length!==64||signature.toString('base64url')!==value.signature||!verify(null,message,key,signature))return null;
  return Object.freeze({...value.terms as DeveloperMvpFruitFallSignedTerms});
 }catch{return null;}
}

/** Hash only validated, exact persisted advisory data, never a user-crafted
 * proposal, revised note, or generic "passed" boolean. */
export function developerMvpFruitFallAssessmentDigest(entry:ValleySpiritShadowEntry):string|null {
 if(entry.assessment.status!=='validated_shadow')return null;
 const p=entry.proposal,v=entry.policy;
 return createHash('sha256').update(JSON.stringify([
  'sealed-shadow-assessment/v1',p.schema,p.type,p.worldId,p.proposalId,p.opportunityId,p.menuVersion,p.inputSnapshotId,
  p.permissionVersion,p.sourceRefs,p.rainEventId,p.sourceResourceInstanceId,p.targetId,p.quantity,
  p.validFromMicroMinute,p.validUntilMicroMinute,p.rationale,
  v.version,v.shadowEnabled,v.maxAgeGameMinutes,v.minimumCooldownGameMinutes,entry.appendedAtMicroMinute,
  entry.assessment.status,entry.assessment.checkedAtMicroMinute,
 ])).digest('hex');
}

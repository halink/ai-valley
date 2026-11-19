import {createHash,createPublicKey,verify} from 'node:crypto';
import {parseClimateUs} from '../world/mvp-climate.js';
import {valleySpiritFruitFallEffectId} from '../shared/valley-spirit-effects.js';
import {agedG1ReviewSigningBytes,agedG1ReviewTerms} from './valley-spirit-aged-g1-review.js';
import type {buildSealedMvpAgedG1Basis} from './valley-spirit-aged-g1.js';

const purpose='sealed-aged-mvp-birth-review-only/v2';
const fields=['purpose','fixtureScopeId','worldId','worldRevision','atUs','proposalId','opportunityId','effectId','approvalId',
 'permissionVersion','epoch','creditId','ageTermsDigest','assessmentDigest','g1ReviewDigest','bornUs','expiresUs','rainDigest',
 'sourceId','sourceInstanceId','targetId','quantity','firstUs','untilUs'] as const;
const exact=(v:unknown,k:readonly string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex');
const token=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u;
const dense=/^[0-9a-f]{64}$/u;
const sig=/^[A-Za-z0-9_-]{86}$/u;
const matches=(v:unknown,p:RegExp)=>typeof v==='string'&&p.test(v);
const nat=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const requestFields=['approvalId','firstUs','untilUs'] as const;

export function agedBirthReviewSigningBytes(v:unknown):Buffer|null {
 if(!exact(v,fields)||v.purpose!==purpose||v.quantity!==1||!nat(v.worldRevision)||v.worldRevision<1||
  !nat(v.permissionVersion)||v.permissionVersion<1||!nat(v.epoch)||
  !matches(v.worldId,/^godot-mvp-[A-Za-z0-9_-]{1,180}$/u)||
  !['fixtureScopeId','creditId','ageTermsDigest','assessmentDigest','g1ReviewDigest','rainDigest'].every(k=>matches(v[k],dense))||
  !['proposalId','approvalId','sourceId','sourceInstanceId','targetId'].every(k=>matches(v[k],token))||
  !matches(v.opportunityId,/^fruit_fall:[a-f0-9]{64}$/u)||v.effectId!==valleySpiritFruitFallEffectId(v.opportunityId as string))return null;
 try{
  const now=parseClimateUs(v.atUs),birth=parseClimateUs(v.bornUs),expiry=parseClimateUs(v.expiresUs);
  if(birth!==now||expiry<=birth||parseClimateUs(v.firstUs)>now||
   parseClimateUs(v.untilUs)<=now||parseClimateUs(v.untilUs)>expiry)return null;
  return Buffer.from(JSON.stringify(fields.map(k=>v[k])),'utf8');
 }catch{return null;}
}

/** Only a preflight identity. Deliberately not an execution-signature domain. */
export function makeAgedBirthReviewTerms(
 g1:NonNullable<ReturnType<typeof buildSealedMvpAgedG1Basis>>,epoch:number,verifiedReview:unknown,request:unknown,
){
 if(!exact(request,requestFields)||typeof request.approvalId!=='string'||typeof request.firstUs!=='string'||typeof request.untilUs!=='string'||
  !exact(verifiedReview,['terms','signature'])||!matches(verifiedReview.signature,sig))return null;
 const g1Bytes=agedG1ReviewSigningBytes(agedG1ReviewTerms(g1,epoch));
 if(!g1Bytes)return null;
 const b=g1.basis;
 try{
  if(parseClimateUs(request.untilUs)>parseClimateUs(b.validUntilUs)||
   parseClimateUs(request.firstUs)<parseClimateUs(b.proposalRecordedAtUs)||
   parseClimateUs(request.firstUs)<parseClimateUs(b.rain.endedUs))return null;
 }catch{return null;}
 const terms=Object.freeze({purpose,fixtureScopeId:b.fixtureScopeId,worldId:b.worldId,worldRevision:b.worldRevision,atUs:b.atUs,
  proposalId:b.proposalId,opportunityId:b.opportunityId,effectId:valleySpiritFruitFallEffectId(b.opportunityId),approvalId:request.approvalId,
  permissionVersion:b.permissionVersion,epoch,creditId:b.creditId,ageTermsDigest:b.ageTermsDigest,
  assessmentDigest:g1.assessmentDigest,g1ReviewDigest:hash([g1Bytes.toString('base64url'),verifiedReview.signature]),
  bornUs:b.bornUs,expiresUs:b.expiresUs,rainDigest:hash([b.rain.rainEventId,b.rain.startedUs,b.rain.firstRainUs,b.rain.endedUs]),
  sourceId:b.sourceId,sourceInstanceId:b.sourceInstanceId,targetId:b.targetId,quantity:1 as const,
  firstUs:request.firstUs,untilUs:request.untilUs});
 return agedBirthReviewSigningBytes(terms)?terms:null;
}

export function verifiesAgedBirthReview(keyPem:string,expected:unknown,signed:unknown):boolean {
 if(!exact(signed,['terms','signature'])||typeof signed.signature!=='string'||!sig.test(signed.signature))return false;
 try{
  const wanted=agedBirthReviewSigningBytes(expected),actual=agedBirthReviewSigningBytes(signed.terms);
  const signature=Buffer.from(signed.signature,'base64url'),key=createPublicKey(keyPem);
  return !!wanted&&!!actual&&wanted.equals(actual)&&signature.length===64&&signature.toString('base64url')===signed.signature&&
   key.asymmetricKeyType==='ed25519'&&verify(null,wanted,key,signature);
 }catch{return false;}
}

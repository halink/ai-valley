import {createHash,createPublicKey,verify} from 'node:crypto';
import {parseClimateUs} from '../world/mvp-climate.js';
import {sealedMvpSourceAgeSigningBytes,type SealedMvpSourceAgeTerms} from './valley-spirit-mvp-source-age.js';

const DOMAIN='valley-spirit-sealed-aged-placement/g1-unverified/v1';
const hex=/^[0-9a-f]{64}$/;
const id=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const fields=['purpose','fixtureScopeId','worldId','worldRevision','atUs','creditId','ageTermsDigest','bornUs','expiresUs',
 'sourceId','sourceInstanceId','rainEventId','targetId','proposalId','opportunityId','approvalId','claimedAssessmentDigest','quantity','firstUs','untilUs'] as const;
type Field=typeof fields[number];
export type SealedAgedPlacementTerms=Readonly<Record<Exclude<Field,'worldRevision'|'quantity'|'purpose'>,string>&
 {purpose:typeof DOMAIN;worldRevision:number;quantity:1}>;
const exact=(v:unknown,k:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const sealedAgedPlacementScope=(seal:string)=>hash(seal);
export const sealedAgedPlacementAgeDigest=(age:SealedMvpSourceAgeTerms)=>hash(sealedMvpSourceAgeSigningBytes(age));

export function sealedAgedPlacementSigningBytes(value:unknown):Buffer|null {
 if(!exact(value,fields))return null;
 const t=value as SealedAgedPlacementTerms;
 const named=['worldId','sourceId','sourceInstanceId','rainEventId','targetId','proposalId','opportunityId','approvalId'] as const;
 if(t.purpose!==DOMAIN||t.quantity!==1||!Number.isSafeInteger(t.worldRevision)||t.worldRevision<1||
  ![t.fixtureScopeId,t.creditId,t.ageTermsDigest,t.claimedAssessmentDigest].every(v=>typeof v==='string'&&hex.test(v))||
  !named.every(k=>typeof t[k]==='string'&&id.test(t[k])))return null;
 try{
  const now=parseClimateUs(t.atUs),birth=parseClimateUs(t.bornUs),expiry=parseClimateUs(t.expiresUs);
  const first=parseClimateUs(t.firstUs),until=parseClimateUs(t.untilUs);
  if(now!==birth||birth>=expiry||first>now||until<=now||until>expiry)return null;
  return Buffer.from(JSON.stringify(fields.map(k=>t[k])),'utf8');
 }catch{return null;}
}

/** Only verifies that an isolated reviewer signed these exact bytes.
 * No G1 assessment, permissions, or execution rights are verified. */
export function verifiesSealedAgedPlacementEncoding(keyPem:string,expected:SealedAgedPlacementTerms,value:unknown):boolean {
 if(!exact(value,['terms','signature']))return false;
 const {terms,signature}=value as {terms:unknown;signature:unknown};
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))return false;
 try{
  const expectedBytes=sealedAgedPlacementSigningBytes(expected),actual=sealedAgedPlacementSigningBytes(terms);
  const key=createPublicKey(keyPem),bytes=Buffer.from(signature,'base64url');
  return !!expectedBytes&&!!actual&&actual.equals(expectedBytes)&&key.asymmetricKeyType==='ed25519'&&
   bytes.length===64&&bytes.toString('base64url')===signature&&verify(null,expectedBytes,key,bytes);
 }catch{return false;}
}
export function makeSealedAgedPlacementTerms(basis:Omit<SealedAgedPlacementTerms,'purpose'|'quantity'>):SealedAgedPlacementTerms|null {
 const terms=Object.freeze({...basis,purpose:DOMAIN,quantity:1 as const});
 return sealedAgedPlacementSigningBytes(terms)?terms:null;
}

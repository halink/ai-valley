import {createPublicKey,verify} from 'node:crypto';
import {parseClimateUs} from '../world/mvp-climate.js';

export interface SealedMvpSourceAgePolicy {
 readonly policyId:string;
 readonly birthBasis:'native-mature-stock-credit';
 readonly shelfLifeUs:string;
}
export interface SealedMvpSourceAgeTerms {
 readonly purpose:'valley-spirit-sealed-source-age/v1';
 readonly worldId:string;
 readonly creditId:string;
 readonly bornUs:string;
 readonly expiresUs:string;
 readonly policy:SealedMvpSourceAgePolicy;
}
const exact=(v:unknown,k:readonly string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===k.length&&k.every(key=>Object.hasOwn(v,key));
export function validSealedMvpSourceAgePolicy(value:unknown):value is SealedMvpSourceAgePolicy {
 if(!exact(value,['policyId','birthBasis','shelfLifeUs']))return false;
 const p=value as SealedMvpSourceAgePolicy;
 try{return typeof p.policyId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(p.policyId)&&
  p.birthBasis==='native-mature-stock-credit'&&parseClimateUs(p.shelfLifeUs)>0n;}catch{return false;}
}
export function makeSealedMvpSourceAgeTerms(
 worldId:string,creditId:string,bornUs:string,policy:SealedMvpSourceAgePolicy,
):SealedMvpSourceAgeTerms|null {
 if(!validSealedMvpSourceAgePolicy(policy)||!/^godot-mvp-[A-Za-z0-9_-]{1,180}$/.test(worldId)||
  !/^[0-9a-f]{64}$/.test(creditId))return null;
 try{
  const born=parseClimateUs(bornUs);
  if(born<=0n)return null;
  const expiresUs=(born+parseClimateUs(policy.shelfLifeUs)).toString();
  parseClimateUs(expiresUs);
  const {policyId,birthBasis,shelfLifeUs}=policy;
  return Object.freeze({purpose:'valley-spirit-sealed-source-age/v1',worldId,creditId,bornUs,expiresUs,
   policy:Object.freeze({policyId,birthBasis,shelfLifeUs})});
 }catch{return null;}
}
/** Canonical offline signing bytes; no signing or execution in the fixture. */
export function sealedMvpSourceAgeSigningBytes(terms:SealedMvpSourceAgeTerms):Buffer {
 const p=terms.policy;
 return Buffer.from(JSON.stringify([terms.purpose,terms.worldId,terms.creditId,terms.bornUs,terms.expiresUs,
  p.policyId,p.birthBasis,p.shelfLifeUs]),'utf8');
}
export function verifySealedMvpSourceAge(
 keyPem:string,expected:SealedMvpSourceAgeTerms,proof:unknown,
):boolean {
 if(!exact(proof,['terms','signature']))return false;
 const {terms,signature}=proof as {terms:SealedMvpSourceAgeTerms;signature:unknown};
 if(!exact(terms,['purpose','worldId','creditId','bornUs','expiresUs','policy'])||
  terms.purpose!==expected.purpose||terms.worldId!==expected.worldId||terms.creditId!==expected.creditId||
  terms.bornUs!==expected.bornUs||terms.expiresUs!==expected.expiresUs||
  !validSealedMvpSourceAgePolicy(terms.policy)||typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))return false;
 try{
  const bytes=Buffer.from(signature,'base64url'),key=createPublicKey(keyPem);
  return bytes.length===64&&bytes.toString('base64url')===signature&&key.asymmetricKeyType==='ed25519'&&
   sealedMvpSourceAgeSigningBytes(terms).equals(sealedMvpSourceAgeSigningBytes(expected))&&
   verify(null,sealedMvpSourceAgeSigningBytes(expected),key,bytes);
 }catch{return false;}
}

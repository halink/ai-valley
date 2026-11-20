import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {parseClimateUs} from '../world/mvp-climate.js';
import type {inspectRulesAgedFruitBasis} from './valley-spirit-rules-aged-preflight.js';
import type {openEmptyOrdinaryAgedGround} from './valley-spirit-ordinary-aged-ground.js';

const purpose='ordinary-rules-aged-g1-review-only/v1';
const fields=['purpose','worldId','revision','atUs','untilUs','epoch','reviewerKeyId','basisDigest'] as const;
const exact=(o:unknown,k:readonly string[]):o is Record<string,unknown>=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const integer=(n:unknown,min=0,max=Number.MAX_SAFE_INTEGER):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const hex=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');

export interface OrdinaryAgedG1ReviewOptions {
 readonly scope:'ordinary-rules-aged-g1-review-only/v1';readonly epoch:number;
 readonly reviewerPublicKeyPem:string;readonly maxReviewGameMinutes:number;
}
export function pinOrdinaryAgedG1Review(v:unknown){
 try{
  if(!exact(v,['scope','epoch','reviewerPublicKeyPem','maxReviewGameMinutes'])||v.scope!==purpose||
   !integer(v.epoch)||!integer(v.maxReviewGameMinutes,1,60)||typeof v.reviewerPublicKeyPem!=='string'||
   !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/u.test(v.reviewerPublicKeyPem)||
   v.reviewerPublicKeyPem.length>256)return null;
  const key=createPublicKey(v.reviewerPublicKeyPem);
  if(key.asymmetricKeyType!=='ed25519')return null;
  return Object.freeze({key,keyId:hash(key.export({type:'spki',format:'der'})),epoch:v.epoch,maxReviewGameMinutes:v.maxReviewGameMinutes});
 }catch{return null;}
}
export function ordinaryAgedG1ReviewSigningBytes(v:unknown):Buffer|null {
 try{
  if(!exact(v,fields)||v.purpose!==purpose||typeof v.worldId!=='string'||!/^godot-mvp-[A-Za-z0-9_-]{1,160}$/u.test(v.worldId)||
   !integer(v.revision)||!integer(v.epoch)||!hex(v.reviewerKeyId)||!hex(v.basisDigest)||
   typeof v.atUs!=='string'||typeof v.untilUs!=='string')return null;
  const a=parseClimateUs(v.atUs),b=parseClimateUs(v.untilUs);
  if(b<=a||b-a>60_000_000n)return null;
  return Buffer.from(JSON.stringify(fields.map(k=>v[k])));
 }catch{return null;}
}
function verifies(key:KeyObject,terms:unknown,signed:unknown){
 try{
  if(!exact(signed,['terms','signature'])||typeof signed.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(signed.signature))return false;
  const a=ordinaryAgedG1ReviewSigningBytes(terms),b=ordinaryAgedG1ReviewSigningBytes(signed.terms);
  const signature=Buffer.from(signed.signature,'base64url');
  return !!a&&!!b&&a.equals(b)&&signature.length===64&&signature.toString('base64url')===signed.signature&&verify(null,a,key,signature);
 }catch{return false;}
}
type Basis=ReturnType<typeof inspectRulesAgedFruitBasis>;
type Ground=NonNullable<ReturnType<ReturnType<typeof openEmptyOrdinaryAgedGround>['review']>>;
export const unavailableOrdinaryAgedG1=()=>({status:'unavailable' as const,executionAuthorized:false as const});
/** Internal encodings, never an authority loader. A genuine review runtime
 * recaptures both proofs; providing terms is not providing their evidence. */
export function prepareOrdinaryAgedG1ReviewEncoding(pin:NonNullable<ReturnType<typeof pinOrdinaryAgedG1Review>>,basis:Basis,ground:Ground,signed?:unknown){
 if(basis.status!=='blocked'||ground.status!=='empty_ground_capacity_installed'||basis.worldId!==ground.worldId||
  basis.revision!==ground.revision||basis.atUs!==ground.atUs||basis.sourceResourceInstanceId!==ground.sourceResourceInstanceId||
  basis.targetId!==ground.targetId||ground.freeCapacity!==1||ground.occupied!==0||ground.placementAuthorized!==false||
  ground.discoveryInstalled!==false||ground.pickupInstalled!==false)return unavailableOrdinaryAgedG1();
 const deadline=[parseClimateUs(basis.proposalUntilUs),parseClimateUs(basis.sourceLot.expiresUs),
  parseClimateUs(basis.atUs)+BigInt(pin.maxReviewGameMinutes)*1_000_000n].sort((a,b)=>a<b?-1:a>b?1:0)[0];
 const terms=Object.freeze({purpose,worldId:basis.worldId,revision:basis.revision,atUs:basis.atUs,untilUs:deadline.toString(),
  epoch:pin.epoch,reviewerKeyId:pin.keyId,basisDigest:hash(JSON.stringify([purpose,basis,ground]))});
 if(!ordinaryAgedG1ReviewSigningBytes(terms)||signed!==undefined&&!verifies(pin.key,terms,signed))return unavailableOrdinaryAgedG1();
 const blockers=Object.freeze(['ordinary-aged-ground-placement','ordinary-aged-ground-discovery','ordinary-aged-ground-pickup','independent-g2-effect-authority'] as const);
 return Object.freeze({status:'encoding-only' as const,terms,blockers,
  proposalId:basis.proposalId,sourceLotId:basis.sourceLot.id,targetId:basis.targetId,
  placementEligible:false as const,executionAuthorized:false as const});
}

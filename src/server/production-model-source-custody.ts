/** Offline check of exact reviewer-signed source records; never a provider verifier. */
import {createHash,createPublicKey,verify,type KeyObject} from 'node:crypto';
import {evaluateProductionHttpAdmission} from './production-model-admission.js';
import {modelEvidenceHash,productionCandidateContract,productionGatedCandidateContract,type ProductionCandidateContract} from './production-model-journal.js';

const DOMAIN='ai-valley-provider-source-custody/v1';
export const PROVIDER_CUSTODY_ROLES=Object.freeze(['authorization','prior-request','outcome','billing','pricing'] as const);
type Role=(typeof PROVIDER_CUSTODY_ROLES)[number];
type Envelope=Readonly<{utf8:string;signature:string}>;
type Boot=Readonly<{accountIdentityDigest:string;contract:ProductionCandidateContract;admissionJson:string;
 launchRootSpkis:readonly [string,string];reviewerSpkis:Readonly<Record<Role,string>>;clock:()=>number}>;
const sha=(b:string)=>createHash('sha256').update(b).digest('hex');
const hash=(v:unknown)=>sha(JSON.stringify(v));
const hex=(v:unknown):v is string=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v);
const int=(v:unknown,n=Number.MAX_SAFE_INTEGER):v is number=>Number.isSafeInteger(v)&&!Object.is(v,-0)&&Number(v)>=0&&Number(v)<=n;
const tokens=(v:unknown):v is number=>int(v,1_000_000);
const reject=(reason:string)=>Object.freeze({status:'denied' as const,reason,liveAuthorized:false as const,providerIdentityVerified:false as const,actualProviderCostCny:null});
const fail=(reason:string):never=>{throw Error(reason);};
function snapshot(v:unknown,keys:readonly string[]){
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)return null;
 const out:Record<string,unknown>={};
 for(const k of keys){
  const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!('value' in d))return null;
  out[k]=d.value;
 }
 return out;
}
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>snapshot(v,keys)!==null;
function publicKey(spki:unknown){
 if(typeof spki!=='string'||spki.length!==59||/[^A-Za-z0-9_-]/.test(spki))return fail('custody_key_invalid');
 const der=Buffer.from(spki,'base64url');
 if(der.toString('base64url')!==spki||der.length!==44||der.subarray(0,12).toString('hex')!=='302a300506032b6570032100')return fail('custody_key_invalid');
 const y=Buffer.from(der.subarray(12));y[31]&=127;
 const yHex=y.toString('hex');
 if(BigInt('0x'+Buffer.from(y).reverse().toString('hex'))>=2n**255n-19n||[
  '00'.repeat(32),'01'+'00'.repeat(31),'ec'+'ff'.repeat(30)+'7f',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
 ].includes(yHex))return fail('custody_key_invalid');
 const key=createPublicKey({key:der,type:'spki',format:'der'});
 if(key.asymmetricKeyType!=='ed25519')return fail('custody_key_invalid');
 return {spki,key};
}
function json(s:unknown,max:number):unknown{
 if(typeof s!=='string'||s.length<1||s.length>max||/[^\x20-\x7e]/.test(s))return fail('custody_bytes_invalid');
 const value:unknown=JSON.parse(s);
 if(JSON.stringify(value)!==s)return fail('custody_bytes_invalid');
 return value;
}
function signed(v:unknown,expectedHash:string,role:Role,basis:string,key:KeyObject){
 const x=snapshot(v,['utf8','signature']);
 if(!x||typeof x.utf8!=='string'||x.utf8.length>1024||typeof x.signature!=='string'||x.signature.length!==86||
  /[^A-Za-z0-9_-]/.test(x.signature))return fail('custody_artifact_unavailable');
 const signature=Buffer.from(x.signature,'base64url');
 if(signature.length!==64||signature.toString('base64url')!==x.signature||sha(x.utf8)!==expectedHash||
  !verify(null,Buffer.from(x.utf8),key,signature))return fail('custody_artifact_integrity');
 const a=json(x.utf8,1024);
 if(!Array.isArray(a)||a.length!==4||a[0]!==DOMAIN||a[1]!==role||a[2]!==basis||!Array.isArray(a[3]))
  return fail('custody_artifact_scope');
 return a[3] as unknown[];
}
function bootAdmission(s:unknown){
 const r=json(s,4096);
 if(!exact(r,['schema','provider','model','endpoint','scope','authorization','previousRequest','pricing'])||
  !exact(r.scope,['runId','worldId','maxRequests','createdAtMs','deadlineAtMs','requestTimeoutMs'])||
  !exact(r.authorization,['sourceHash','dataScope','spendingLimitCny'])||
  !exact(r.previousRequest,['requestEvidenceHash','resolutionEvidenceHash','billingEvidenceHash','remoteOutcome','actualCostCny','reconciledAtMs'])||
  !exact(r.pricing,['sourceUrl','sourceHash','model','checkedAtMs','validUntilMs','inputCnyPerMillion','outputCnyPerMillion','otherApplicableChargesCny']))
  return fail('custody_admission_invalid');
 return r;
}
/** Trusted boot provides out-of-band reviewer public keys and actual launch roots
 * to exclude. Runtime receives only bounded exact records, not policy or roots.
 * This closed vocabulary is not a vendor format and is suitable for local test
 * fixtures or independently reviewed offline material, never a live permit. */
export function createProviderSourceCustodyDryCheck(boot?:Boot){
 const cfg=(()=>{
  try{
   if(!boot||!hex(boot.accountIdentityDigest)||typeof boot.clock!=='function'||!Array.isArray(boot.launchRootSpkis)||boot.launchRootSpkis.length!==2)return null;
   const b=structuredClone({contract:boot.contract,admissionJson:boot.admissionJson});
   const proposed=b.contract,canonical=productionGatedCandidateContract({...proposed,admissionHash:proposed.admissionHash!});
   if(modelEvidenceHash(proposed)!==modelEvidenceHash(canonical))return null;
   const admitted=bootAdmission(b.admissionJson),pins=snapshot(boot.reviewerSpkis,PROVIDER_CUSTODY_ROLES);
   if(!pins)return null;
   const launch=boot.launchRootSpkis.map(publicKey),reviewers=PROVIDER_CUSTODY_ROLES.map(role=>publicKey(pins[role]));
   const allKeys=[...launch,...reviewers].map(k=>k.spki);
   if(new Set(allKeys).size!==allKeys.length)return null;
   // Exclude the final admission hash from these source bytes to avoid a
   // circular hash. The existing evaluator still binds all bytes to that hash.
   const basis=hash([DOMAIN,'basis',boot.accountIdentityDigest,modelEvidenceHash(productionCandidateContract(canonical))]);
   return {canonical,admitted,basis,clock:boot.clock,reviewers};
  }catch{return null;}
 })();
 let clockFloor=-1,active=false;
 return Object.freeze({
  inspect(input:Readonly<Record<Role,Envelope>>){
   if(!cfg)return reject('custody_unconfigured');
   if(active)return reject('custody_reentrant');
   active=true;
   try{
    const now:unknown=cfg.clock();
    if(!int(now)||now<clockFloor)return reject('custody_clock_invalid');
    clockFloor=now;
    const checked=evaluateProductionHttpAdmission(cfg.canonical,cfg.admitted,now);
    if(!checked.allowed)return reject('custody_admission_denied');
    const a=checked.record,sources=snapshot(input,PROVIDER_CUSTODY_ROLES);
    if(!sources)return reject('custody_artifact_unavailable');
    const previous=a.previousRequest,pricing=a.pricing;
    const hashes=[a.authorization.sourceHash,previous.requestEvidenceHash,previous.resolutionEvidenceHash,previous.billingEvidenceHash,pricing.sourceHash];
    if(new Set(hashes).size!==hashes.length||!hashes.every(hex))return reject('custody_distinct_sources_required');
    const [permit,request,outcome,billing,price]=PROVIDER_CUSTODY_ROLES.map((role,i)=>
     signed(sources[role],hashes[i],role,cfg.basis,cfg.reviewers[i].key));
    // Closed payload schemas. No arbitrary vendor text, raw request/resident
    // contents, or caller claims of review can stand in for these bytes.
    const [grantFrom,grantUntil,dataScope,cap]=permit;
    if(permit.length!==4||!int(grantFrom)||!int(grantUntil)||grantFrom>cfg.canonical.createdAtMs||now>=grantUntil||
     grantUntil<cfg.canonical.deadlineAtMs||dataScope!==a.authorization.dataScope||cap!==0)return reject('custody_permission_mismatch');
    const [requestDigest,sentAt]=request;
    if(request.length!==2||!hex(requestDigest)||!int(sentAt)||sentAt>=cfg.canonical.createdAtMs)return reject('custody_prior_request_mismatch');
    const [outcomeRequest,disposition,observedAt,inTokens,outTokens]=outcome;
    if(outcome.length!==5||outcomeRequest!==requestDigest||disposition!==previous.remoteOutcome||!int(observedAt)||
     observedAt<sentAt||observedAt>previous.reconciledAtMs||!tokens(inTokens)||!tokens(outTokens)||
     (disposition==='not-executed'?inTokens+outTokens!==0:inTokens+outTokens===0))return reject('custody_outcome_mismatch');
    const [billRequest,billOutcome,billTime,billedInput,billedOutput,actualMicros,currency]=billing;
    if(billing.length!==7||billRequest!==requestDigest||billOutcome!==hashes[2]||billTime!==previous.reconciledAtMs||
     billedInput!==inTokens||billedOutput!==outTokens||actualMicros!==0||currency!=='CNY')return reject('custody_billing_mismatch');
    const [url,checkedAt,until,inputRate,outputRate,other,priceCurrency]=price;
    if(price.length!==7||url!==pricing.sourceUrl||checkedAt!==pricing.checkedAtMs||until!==pricing.validUntilMs||
     inputRate!==0||outputRate!==0||other!==0||priceCurrency!=='CNY')return reject('custody_pricing_mismatch');
    const finalNow:unknown=cfg.clock();
    if(!int(finalNow)||finalNow<clockFloor)return reject('custody_clock_invalid');
    clockFloor=finalNow;
    if(!evaluateProductionHttpAdmission(cfg.canonical,cfg.admitted,finalNow).allowed)return reject('custody_admission_denied');
    return Object.freeze({status:'reviewer-signed-source-records-matched' as const,
     checkedSources:5 as const,liveAuthorized:false as const,providerIdentityVerified:false as const,
     externalSourceAuthenticityVerified:false as const,actualProviderCostCny:null});
   }catch(e){
    const reason=e instanceof Error?e.message:'';
    return reject(/^custody_[a-z_]{1,48}$/.test(reason)?reason:'custody_artifact_invalid');
   }finally{active=false;}
  },
 });
}

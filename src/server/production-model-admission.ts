/** Offline validation of reviewed evidence, not a provider/account verifier.
 * The trusted launcher must inspect the referenced sources. Hashes bind those
 * records to a run; they do not authenticate claims or prove a zero bill. */
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
import {productionCandidateContract,modelEvidenceHash,type ProductionCandidateContract} from './production-model-journal.js';
import {RESUMABLE_PROTOCOL} from './acceptance-resumable-protocol.js';
export const PRODUCTION_HTTP_LIMITS=Object.freeze({maxRequests:RESUMABLE_PROTOCOL.maxRequests,
 maxWallMs:RESUMABLE_PROTOCOL.maxReservedWallMs,maxResponseBytes:128_000,priceFreshnessMs:15*60_000,
 redirect:'error',retries:0,fallback:null,modelSlots:1} as const);
type Scope=Pick<ProductionCandidateContract,'runId'|'worldId'|'maxRequests'|'createdAtMs'|'deadlineAtMs'|'requestTimeoutMs'>;
export type ProductionHttpAdmission=Readonly<{schema:1;provider:'siliconflow';model:typeof P.model;endpoint:typeof P.endpoint;
 scope:Scope;
 authorization:{sourceHash:string;dataScope:'fictional-resident-state-memory-relationships-actions';spendingLimitCny:0};
 previousRequest:{requestEvidenceHash:string;resolutionEvidenceHash:string;billingEvidenceHash:string;
  remoteOutcome:'completed'|'not-executed';actualCostCny:0;reconciledAtMs:number};
 pricing:{sourceUrl:'https://www.siliconflow.cn/pricing';sourceHash:string;model:typeof P.model;
  checkedAtMs:number;validUntilMs:number;inputCnyPerMillion:0;outputCnyPerMillion:0;otherApplicableChargesCny:0};
}>;
const digest=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
function plainSnapshot(value:unknown,depth=0):unknown{
 if(depth>8)throw new Error('admission_record_invalid');
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('admission_record_invalid');
 const result:Record<string,unknown>={};
 const keys=Reflect.ownKeys(value);if(keys.length>24)throw new Error('admission_record_invalid');
 for(const key of keys){
  if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))throw new Error('admission_record_invalid');
  const property=Object.getOwnPropertyDescriptor(value,key);
  if(!property||!('value'in property))throw new Error('admission_record_invalid');
  result[key]=plainSnapshot(property.value,depth+1);
 }
 return result;
}
function scope(contract:Scope):Scope{return {runId:contract.runId,worldId:contract.worldId,maxRequests:contract.maxRequests,
 createdAtMs:contract.createdAtMs,deadlineAtMs:contract.deadlineAtMs,requestTimeoutMs:contract.requestTimeoutMs};}
export type AdmissionResult={allowed:false;reason:string}|{allowed:true;record:ProductionHttpAdmission;hash:string};
/** No environment variables, credentials, URLs, billing endpoints or user saves
 * are read. Missing reconciliation is unknown, never inferred from silence. */
export function evaluateProductionHttpAdmission(contract:ProductionCandidateContract,input:unknown,now:number):AdmissionResult{
 try{
  productionCandidateContract(contract);
  if(contract.maxRequests>PRODUCTION_HTTP_LIMITS.maxRequests||contract.deadlineAtMs-contract.createdAtMs>PRODUCTION_HTTP_LIMITS.maxWallMs)throw new Error('admission_budget_invalid');
  if(!count(now)||now<contract.createdAtMs||now>=contract.deadlineAtMs)throw new Error('admission_time_invalid');
  const r=plainSnapshot(input) as ProductionHttpAdmission;
  if(!r||r.schema!==1||r.provider!==P.provider||r.model!==P.model||r.endpoint!==P.endpoint)throw new Error('admission_identity_invalid');
  if(!r.scope||Object.keys(r.scope).length!==6||modelEvidenceHash(scope(r.scope))!==modelEvidenceHash(scope(contract)))throw new Error('admission_scope_mismatch');
  if(!digest(r.authorization?.sourceHash)||r.authorization.dataScope!=='fictional-resident-state-memory-relationships-actions'
   ||r.authorization.spendingLimitCny!==0)throw new Error('authorization_evidence_missing');
  const old=r.previousRequest;
  if(!old||!digest(old.requestEvidenceHash)||!digest(old.resolutionEvidenceHash)||!digest(old.billingEvidenceHash)
   ||!['completed','not-executed'].includes(old.remoteOutcome)||old.actualCostCny!==0
   ||!count(old.reconciledAtMs)||old.reconciledAtMs>now)throw new Error('previous_request_unreconciled');
  const price=r.pricing;
  if(!price||price.sourceUrl!=='https://www.siliconflow.cn/pricing'||!digest(price.sourceHash)||price.model!==P.model
   ||price.inputCnyPerMillion!==0||price.outputCnyPerMillion!==0||price.otherApplicableChargesCny!==0)throw new Error('free_price_unverified');
  if(!count(price.checkedAtMs)||!count(price.validUntilMs)||price.checkedAtMs>now||now>=price.validUntilMs
   ||price.validUntilMs-price.checkedAtMs>PRODUCTION_HTTP_LIMITS.priceFreshnessMs)throw new Error('free_price_expired');
  const hash=modelEvidenceHash(r);
  if(contract.executionKind==='gated-production-http-candidate'&&contract.admissionHash!==hash)throw new Error('admission_hash_mismatch');
  return {allowed:true,record:r,hash};
 }catch(error){return {allowed:false,reason:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'admission_record_invalid'};}
}

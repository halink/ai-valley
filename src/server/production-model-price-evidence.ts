/** Synthetic fixtures only. No signing keys, trust roots, official-source
 * verification, fetch, credentials or live-admission capability exist here. */
import {createHash} from 'node:crypto';
import {PRODUCTION_MODEL_CANDIDATE as P} from './production-model-policy.js';
export const SYNTHETIC_PRICE_FRESHNESS_MS=900_000;
export const syntheticDigest=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export const syntheticCount=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
/** Reject accessors and extra fields without invoking them. Used only for the
 * small, closed schemas of this disconnected synthetic protocol. */
export function syntheticRecord(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('synthetic_record_invalid');
 const descriptors=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(descriptors);
 if(actual.length!==keys.length||actual.some(key=>typeof key!=='string'||!keys.includes(key)))throw new Error('synthetic_record_invalid');
 const copy:Record<string,unknown>={};
 for(const key of keys){const property=descriptors[key];if(!property||!('value'in property))throw new Error('synthetic_record_invalid');copy[key]=property.value;}
 return copy;
}
/** Call only on schema-checked records assembled in fixed field order. */
export const syntheticRecordHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type SyntheticPriceRecord=Readonly<{schema:1;executionKind:'synthetic-price-evidence';scopeHash:string;
 sequence:number;previousEvidenceHash:string|null;fixtureId:string;provider:typeof P.provider;model:typeof P.model;endpoint:typeof P.endpoint;
 observedAtMs:number;validUntilMs:number;inputCnyPerMillion:0;outputCnyPerMillion:0;otherApplicableChargesCny:0;
 provenance:'synthetic-memory-fixture';sourceAuthenticityVerified:false;liveExecutionEnabled:false}>;
type EvidenceInput=Pick<SyntheticPriceRecord,'scopeHash'|'sequence'|'previousEvidenceHash'|'fixtureId'|'observedAtMs'|'validUntilMs'>;
const inputKeys=['scopeHash','sequence','previousEvidenceHash','fixtureId','observedAtMs','validUntilMs'] as const;
const recordKeys=['schema','executionKind',...inputKeys.slice(0,4),'provider','model','endpoint','observedAtMs','validUntilMs',
 'inputCnyPerMillion','outputCnyPerMillion','otherApplicableChargesCny','provenance','sourceAuthenticityVerified','liveExecutionEnabled'];
function checkedInput(input:unknown):EvidenceInput{
 const r=syntheticRecord(input,inputKeys);
 if(!syntheticDigest(r.scopeHash)||!syntheticCount(r.sequence)||r.sequence<1||r.sequence>720
  ||r.previousEvidenceHash!==null&&!syntheticDigest(r.previousEvidenceHash)
  ||typeof r.fixtureId!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(r.fixtureId)
  ||!syntheticCount(r.observedAtMs)||!syntheticCount(r.validUntilMs)||r.validUntilMs<=r.observedAtMs
  ||r.validUntilMs-r.observedAtMs>SYNTHETIC_PRICE_FRESHNESS_MS)throw new Error('synthetic_price_invalid');
 return r as EvidenceInput;
}
function record(input:EvidenceInput):SyntheticPriceRecord{
 return Object.freeze({schema:1,executionKind:'synthetic-price-evidence',scopeHash:input.scopeHash,sequence:input.sequence,
  previousEvidenceHash:input.previousEvidenceHash,fixtureId:input.fixtureId,provider:P.provider,model:P.model,endpoint:P.endpoint,
  observedAtMs:input.observedAtMs,validUntilMs:input.validUntilMs,inputCnyPerMillion:0,outputCnyPerMillion:0,
  otherApplicableChargesCny:0,provenance:'synthetic-memory-fixture',sourceAuthenticityVerified:false,liveExecutionEnabled:false});
}
/** Parse persisted synthetic history, never turn a JSON record into authority. */
export function parseSyntheticPriceRecord(input:unknown):SyntheticPriceRecord{
 const r=syntheticRecord(input,recordKeys),data=checkedInput(Object.fromEntries(inputKeys.map(key=>[key,r[key]]))),expected=record(data);
 for(const key of recordKeys)if(r[key]!==expected[key as keyof SyntheticPriceRecord])throw new Error('synthetic_price_invalid');
 return expected;
}
export type SyntheticPriceEvidence=Readonly<{kind:'synthetic-price-evidence-capability'}>;
const fixtures=new WeakMap<SyntheticPriceEvidence,SyntheticPriceRecord>();
/** The brand prevents accidental forged/serialized inputs, not a malicious
 * caller. Anybody may create a synthetic fixture; it never proves a real price. */
export function createSyntheticPriceEvidence(input:EvidenceInput):SyntheticPriceEvidence{
 const value=record(checkedInput(input)),capability=Object.freeze({kind:'synthetic-price-evidence-capability'} as const);
 fixtures.set(capability,value);return capability;
}
export function inspectSyntheticPriceEvidence(capability:SyntheticPriceEvidence):SyntheticPriceRecord{
 const value=fixtures.get(capability);if(!value)throw new Error('synthetic_price_capability_required');return value;
}

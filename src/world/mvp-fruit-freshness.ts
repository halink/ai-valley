import {createHash} from 'node:crypto';
import {parseClimateUs} from './mvp-climate.js';
import {isNativeMvpFruitRenewalWitness,type MvpFruitRenewalWitness} from './mvp-resources.js';
import type {Vec} from '../shared/types.js';

export interface OfflineMvpFruitFreshnessPolicy {
 readonly version:1;
 readonly policyId:string;
 /** Explicit interpretation of the native mature-stock credit; not biological development. */
 readonly birthBasis:'native-mature-stock-credit';
 readonly shelfLifeUs:string;
}
export interface OfflineMvpFruitCohort {
 readonly schemaVersion:1;
 readonly cohortId:string;
 readonly worldId:string;
 readonly sourceId:string;
 readonly sourceAt:Readonly<Vec>;
 readonly birthRevision:number;
 /** Historical gross credit, never remaining stock or availability. */
 readonly originallyCredited:number;
 readonly bornUs:string;
 readonly expiresUs:string;
 readonly policy:OfflineMvpFruitFreshnessPolicy;
}
const policies=new WeakSet<OfflineMvpFruitFreshnessPolicy>();
const cohorts=new WeakSet<OfflineMvpFruitCohort>();
const pinned=new WeakMap<MvpFruitRenewalWitness,OfflineMvpFruitCohort>();

/** Offline policy only. No default lifetime or effect on ordinary gameplay. */
export function freezeOfflineMvpFruitFreshnessPolicy(
 policyId:string,shelfLifeUs:string,
):OfflineMvpFruitFreshnessPolicy|null {
 try{
  if(typeof policyId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(policyId)||parseClimateUs(shelfLifeUs)<=0n)return null;
  const policy=Object.freeze({version:1 as const,policyId,birthBasis:'native-mature-stock-credit' as const,shelfLifeUs});
  policies.add(policy);
  return policy;
 }catch{return null;}
}

/** Identifies age metadata only. No source balance, opening stock, stock
 * claim, ground item or transferable candidate is ever produced here. */
export function identifyOfflineMvpFruitCohort(
 evidence:unknown,policy:OfflineMvpFruitFreshnessPolicy,
):OfflineMvpFruitCohort|null {
 if(!isNativeMvpFruitRenewalWitness(evidence)||!policies.has(policy))return null;
 const old=pinned.get(evidence);
 if(old)return old.policy.policyId===policy.policyId&&old.policy.shelfLifeUs===policy.shelfLifeUs?old:null;
 try{
  const {worldId,sourceId,sourceAt,worldRevision,atUs,naturallyRenewed}=evidence;
  const expiresUs=(parseClimateUs(atUs)+parseClimateUs(policy.shelfLifeUs)).toString();
  parseClimateUs(expiresUs);
  const material=JSON.stringify(['native-mvp-fruit-cohort-v1',worldId,sourceId,sourceAt.x,sourceAt.y,atUs,worldRevision]);
  const cohort=Object.freeze({
   schemaVersion:1 as const,cohortId:'mvp-fruit-cohort:'+createHash('sha256').update(material).digest('hex'),
   worldId,sourceId,sourceAt,birthRevision:worldRevision,originallyCredited:naturallyRenewed,bornUs:atUs,expiresUs,policy,
  });
  cohorts.add(cohort);
  pinned.set(evidence,cohort);
  return cohort;
 }catch{return null;}
}

/** "Before expiry" says nothing about whether any units remain. Serialized
 * metadata is descriptive; no rehydration as evidence without a future custody. */
export function inspectOfflineMvpFruitCohortAge(
 cohort:unknown,atUs:string,
):'before-expiry'|'expired'|null {
 if(typeof cohort!=='object'||cohort===null||!cohorts.has(cohort as OfflineMvpFruitCohort))return null;
 try{
  const c=cohort as OfflineMvpFruitCohort,at=parseClimateUs(atUs);
  if(at<parseClimateUs(c.bornUs))return null;
  return at<parseClimateUs(c.expiresUs)?'before-expiry':'expired';
 }catch{return null;}
}

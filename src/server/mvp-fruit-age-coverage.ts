import {followsPostCommitMvpFruitFlow,isPostCommitMvpFruitFlow} from './godot-mvp.js';
import {identifyOfflineMvpFruitCohort,inspectOfflineMvpFruitCohortAge,
 type OfflineMvpFruitCohort,type OfflineMvpFruitFreshnessPolicy} from '../world/mvp-fruit-freshness.js';
import type {MvpFruitFlowBatch} from '../world/mvp-resources.js';

type Stock=MvpFruitFlowBatch['closing'][number];
interface CohortLowerBound {
 readonly cohort:OfflineMvpFruitCohort;
 readonly atLeast:number;
 readonly age:'before-expiry'|'expired';
}
interface SourceAgeCoverage {
 readonly stock:Stock;
 /** Opening scalar units not covered by any prior cohort lower bound. */
 readonly openingNotCovered:number;
 readonly closingNotCovered:number;
 readonly cohorts:readonly CohortLowerBound[];
}
export interface OfflineMvpFruitAgeCoverage {
 readonly version:1;
 readonly worldId:string;
 readonly worldRevision:number;
 readonly atUs:string;
 readonly sources:readonly SourceAgeCoverage[];
 readonly advisoryOnly:true;
}
const traced=new WeakMap<OfflineMvpFruitAgeCoverage,MvpFruitFlowBatch>();
const maxCohorts=4096; // Audit work bound, never gameplay or retention policy.
const identicalSource=(a:Stock,b:Stock)=>a.sourceId===b.sourceId&&a.sourceAt.x===b.sourceAt.x&&
 a.sourceAt.y===b.sourceAt.y&&a.max===b.max&&a.amount===b.amount;

/** Conservative per-cohort lower bounds for an audited ordinary scalar tick.
 * Any gather might have taken its full quantity from *each* individual cohort;
 * decrease each bound independently, never assert actual FIFO or selection.
 * Unknown opening stock and unallocated protection are not assigned an age.
 * Serialized values are descriptive only; there is no restart rehydration. */
export function auditOfflineMvpFruitAgeCoverage(
 batch:unknown,policy?:OfflineMvpFruitFreshnessPolicy,previous?:OfflineMvpFruitAgeCoverage,
):OfflineMvpFruitAgeCoverage|null {
 if(!isPostCommitMvpFruitFlow(batch))return null;
 if(previous!==undefined){
  const predecessor=traced.get(previous);
  if(!predecessor||!followsPostCommitMvpFruitFlow(predecessor,batch)||previous.worldId!==batch.worldId||
   previous.worldRevision!==batch.fromRevision||previous.atUs!==batch.fromUs||
   previous.sources.length!==batch.opening.length||
   previous.sources.some((s,i)=>!identicalSource(s.stock,batch.opening[i])))return null;
 }
 const gatheredBySource=new Map<string,number>(),renewedBySource=new Map<string,Extract<MvpFruitFlowBatch['operations'][number],{kind:'renewal'}>>();
 for(const operation of batch.operations){
  if(operation.kind==='gather')gatheredBySource.set(operation.sourceId,(gatheredBySource.get(operation.sourceId)??0)+operation.quantity);
  else renewedBySource.set(operation.witness.sourceId,operation);
 }
 const result:SourceAgeCoverage[]=[];
 let cohorts=0;
 for(const [i,open] of batch.opening.entries()){
  const prior=previous?.sources[i].cohorts??[];
  const openingNotCovered=open.amount-prior.reduce((sum,r)=>sum+r.atLeast,0);
  const close=batch.closing[i],rows:CohortLowerBound[]=[];
  const gathered=gatheredBySource.get(open.sourceId)??0;
  for(const {cohort,atLeast} of prior){
   const lower=Math.max(0,atLeast-gathered);
   if(!lower)continue;
   const age=inspectOfflineMvpFruitCohortAge(cohort,batch.toUs);
   if(!age)return null;
   rows.push(Object.freeze({cohort,atLeast:lower,age}));
  }
  // In the attested ordinary execution all native gathers precede native renewal.
  const renewal=renewedBySource.get(open.sourceId);
  if(policy&&renewal){
   const cohort=identifyOfflineMvpFruitCohort(renewal.witness,policy);
   // A missing/invalid policy or a conflicting prior pin leaves units not covered.
   if(cohort)rows.push(Object.freeze({cohort,atLeast:cohort.originallyCredited,age:'before-expiry'}));
  }
  cohorts+=rows.length;
  if(cohorts>maxCohorts)return null;
  const closingNotCovered=close.amount-rows.reduce((sum,row)=>sum+row.atLeast,0);
  if(openingNotCovered<0||closingNotCovered<0)return null;
  result.push(Object.freeze({stock:close,openingNotCovered,closingNotCovered,cohorts:Object.freeze(rows)}));
 }
 const summary=Object.freeze({
  version:1 as const,worldId:batch.worldId,worldRevision:batch.toRevision,atUs:batch.toUs,
  sources:Object.freeze(result),advisoryOnly:true as const,
 });
 traced.set(summary,batch);
 return summary;
}

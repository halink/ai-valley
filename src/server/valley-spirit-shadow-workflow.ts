import {createHash} from 'node:crypto';
import {
 isEnabledValleySpiritFruitFallPolicy,
 proposeValleySpiritFruitFall,
 type ValleySpiritFruitFallPolicy,
} from './valley-spirit-proposal.js';
import type {ValleySpiritShadowOffers} from './valley-spirit-shadow-offers.js';
import {inspectValleySpiritShadow,type ValleySpiritShadowQueue} from './valley-spirit-shadow-queue.js';

type Queue=Pick<ValleySpiritShadowQueue,'append'|'get'|'recordAssessment'|'expire'>;
type Ready=Extract<ValleySpiritShadowOffers,{status:'ready'}>;
interface Menu {
 readonly schemaVersion:1;
 readonly menuId:string;
 readonly options:readonly {readonly number:number;readonly kind:'fruit_fall'}[];
}
const unavailable={status:'unavailable'} as const;
const rejected={status:'rejected'} as const;
const safeTime=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>
 !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function pinned(ready:Ready){
 const options=ready.offers.filter(offer=>offer.availability==='shadow_preflight_only').map(offer=>offer.option);
 if(!options.length||options.length>16)return null;
 const first=options[0];
 if(options.some(option=>option.worldId!==first.worldId||option.permissionVersion!==first.permissionVersion||
  option.menuVersion!==first.menuVersion||option.sourceRefs.length!==first.sourceRefs.length||
  option.sourceRefs.some((ref,i)=>ref!==first.sourceRefs[i])))return null;
 const menuId='valley-shadow-'+createHash('sha256').update(JSON.stringify(options)).digest('hex');
 return {options,menu:Object.freeze({schemaVersion:1,menuId,
  options:Object.freeze(options.map((_option,i)=>Object.freeze({number:i+1,kind:'fruit_fall'} as const))),
 } as const)};
}

/** Internal G1 coordinator. Does not run transport or install a world writer.
 * The caller provides the current closed-world offer resolver. The only menu
 * payload is a stable identity with numbered allowlisted choices; underlying
 * site coordinates, authority, and raw source records stay in the resolver. */
export class ValleySpiritShadowWorkflow {
 constructor(
  private readonly capture:()=>ValleySpiritShadowOffers,
  private readonly queue:Queue,
  private readonly policy?:ValleySpiritFruitFallPolicy,
  private readonly readClock?:()=>{worldId:string;nowMicroMinute:number}|null,
 ){
  this.policy=policy?Object.freeze({...policy}):undefined;
 }
 preview():Menu|null {
  if(!isEnabledValleySpiritFruitFallPolicy(this.policy))return null;
  try{
   const ready=this.capture();
   return ready.status==='ready'?pinned(ready)?.menu??null:null;
  }catch{return null;}
 }
 /** Checks choice provenance again during enqueue. Not an approval. */
 enqueue(proposalId:string,answer:unknown){
  if(!isEnabledValleySpiritFruitFallPolicy(this.policy))return unavailable;
  if(!exact(answer,['menuId','optionNumber','rationale'])||typeof answer.menuId!=='string')return rejected;
  try{
   const ready=this.capture();
   if(ready.status!=='ready')return unavailable;
   const current=pinned(ready);
   if(!current||current.menu.menuId!==answer.menuId)return rejected;
   const selection=proposeValleySpiritFruitFall(proposalId,current.options,{optionNumber:answer.optionNumber,rationale:answer.rationale});
   if(selection.status!=='proposed')return rejected;
   const evidence=ready.reader.readFruitFallEvidence(selection.proposal);
   if(!evidence||evidence.worldId!==selection.proposal.worldId||!safeTime(evidence.nowMicroMinute)||
      evidence.nowMicroMinute<selection.proposal.validFromMicroMinute||
      evidence.nowMicroMinute>=selection.proposal.validUntilMicroMinute||
      evidence.approvedBasis?.inputSnapshotId!==selection.proposal.inputSnapshotId||
      evidence.approvedBasis.permissionVersion!==selection.proposal.permissionVersion||
      evidence.opportunityConsumed!==false||evidence.proposalQuotaAvailable!==true)return unavailable;
   return this.queue.append(selection.proposal,this.policy,evidence.nowMicroMinute);
  }catch{return unavailable;}
 }
 inspect(proposalId:string){
  if(!isEnabledValleySpiritFruitFallPolicy(this.policy))return unavailable;
  try{
   const entry=this.queue.get(proposalId),ready=this.capture();
   return entry.status==='found'&&ready.status==='ready'?inspectValleySpiritShadow(entry.entry,ready.reader,this.policy):unavailable;
  }catch{return unavailable;}
 }
 /** Advisory persistence is a separate explicitly invoked step. Even success
  * has no authorization, no effect ID and no world write. */
 assess(proposalId:string){
  if(!isEnabledValleySpiritFruitFallPolicy(this.policy))return unavailable;
  try{
   const entry=this.queue.get(proposalId),ready=this.capture();
   if(entry.status!=='found'||ready.status!=='ready')return unavailable;
   return this.queue.recordAssessment(proposalId,ready.reader.readFruitFallEvidence(entry.entry.proposal),this.policy);
  }catch{return unavailable;}
 }
 expire(proposalId:string){
  if(!isEnabledValleySpiritFruitFallPolicy(this.policy))return unavailable;
  try {
   const head=this.readClock?.();
   return head?this.queue.expire(proposalId,head,this.policy):unavailable;
  }catch{return unavailable;}
 }

}

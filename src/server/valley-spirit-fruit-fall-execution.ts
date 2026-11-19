import {
 validValleySpiritFruitFallReceipt,valleySpiritFruitFallEffectId,valleySpiritFruitFallOpportunityId,
 type ValleySpiritFruitFallReceipt,
} from '../shared/valley-spirit-effects.js';
export {validValleySpiritFruitFallReceipt,valleySpiritFruitFallEffectId,type ValleySpiritFruitFallReceipt} from '../shared/valley-spirit-effects.js';
import {
 preflightValleySpiritFruitFall,
 preflightValleySpiritFruitFallFixtureAttachment,
 type ValleySpiritFruitFallEvidence,
 type ValleySpiritFruitFallPolicy,
 type ValleySpiritFruitFallProposal,
} from './valley-spirit-proposal.js';

const FAMILY = 'fruit_fall' as const;
const VERSION = 1 as const;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(v);
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export type ValleySpiritReceiptLookup =
 | {readonly status:'missing'}
 | {readonly status:'unknown'}
 | {readonly status:'found';readonly receipt:unknown};
export interface ValleySpiritApprovedSchedule {
 readonly type: 'fruit_fall';
 readonly worldId: string;
 readonly proposalId: string;
 readonly opportunityId: string;
 readonly approvalId: string;
 readonly firstMicroMinute: number;
 readonly expiresMicroMinute: number;
}
type Plan =
 | {readonly status:'rejected'; readonly reason:'schedule'|'revalidation'|'cooldown-or-quota'}
 | {readonly status:'commit'; readonly receipt:ValleySpiritFruitFallReceipt};

/** Trusted integration capability, not an HTTP or model API.
 * commitOnce must provide freshly read authority from ONE world transaction,
 * durably store the receipt, debit, ground credit, event and final state
 * together, and enforce effect/opportunity uniqueness at the write boundary.
 * It may call the pure planner only against the current draft head. */
export interface ValleySpiritFruitFallAuthority {
 readReceipt(worldId:string,effectId:string):ValleySpiritReceiptLookup;
 commitOnce(effectId:string,plan:(head:{
  scheduled:ValleySpiritApprovedSchedule|null;
  evidence:ValleySpiritFruitFallEvidence|undefined;
  effectQuotaAvailable:boolean;
 })=>Plan): {readonly status:'unknown'|'recorded'} | Extract<Plan,{status:'rejected'}>;
}
export type ValleySpiritFruitFallExecution =
 | {readonly status:'disabled'}
 | {readonly status:'rejected'; readonly reason:'invalid-proposal'|Extract<Plan,{status:'rejected'}>['reason']}
 | {readonly status:'blocked';readonly reason:'unconfirmed-world-state'}
 | {readonly status:'duplicate';readonly receipt:ValleySpiritFruitFallReceipt}
 | {readonly status:'applied';readonly replay:boolean;readonly receipt:ValleySpiritFruitFallReceipt};

const blocked = {status:'blocked',reason:'unconfirmed-world-state'} as const;
type Recovery = Extract<ValleySpiritFruitFallExecution,{status:'blocked'|'duplicate'|'applied'}>;
/** Read-only reconciliation also works while generation/execution is off.
 * An alternate proposal for that opportunity may discover the receipt, but
 * must not claim that its own plan succeeded. */
export function recoverValleySpiritFruitFallReceipt(
 proposal:Pick<ValleySpiritFruitFallProposal,'worldId'|'opportunityId'|'proposalId'|'rainEventId'|'sourceResourceInstanceId'>,
 authority:Pick<ValleySpiritFruitFallAuthority,'readReceipt'>,
 replay=true,
):Recovery|null {
 try{
  if(!id(proposal.proposalId)||proposal.opportunityId!==valleySpiritFruitFallOpportunityId(proposal.worldId,proposal.rainEventId,proposal.sourceResourceInstanceId))return blocked;
  const effectId=valleySpiritFruitFallEffectId(proposal.opportunityId),known=authority.readReceipt(proposal.worldId,effectId);
  if(known.status==='missing')return null;
  if(known.status!=='found'||!validValleySpiritFruitFallReceipt(known.receipt)||known.receipt.effectId!==effectId||
     known.receipt.worldId!==proposal.worldId||known.receipt.opportunityId!==proposal.opportunityId)return blocked;
  const receipt=Object.freeze({...known.receipt});
  return receipt.proposalId===proposal.proposalId?{status:'applied',replay,receipt}:{status:'duplicate',receipt};
 }catch{return blocked;}
}
/** No runtime authority is installed here. Explicit off prevents effects,
 * including when G1 shadow mode is enabled. Any ambiguous write is checked
 * against the authoritative receipt without a second write attempt. */
export function executeValleySpiritFruitFall(
 proposal:ValleySpiritFruitFallProposal,
 activation:{type:'fruit_fall';enabled:boolean;policy:ValleySpiritFruitFallPolicy}|undefined,
 authority:ValleySpiritFruitFallAuthority,
):ValleySpiritFruitFallExecution {
 return coordinateFruitFall(proposal,activation,authority,preflightValleySpiritFruitFall);
}
/** Attachment-only developer path; never used by the live/default or G1 entry. */
export function executeValleySpiritFruitFallFixture(
 proposal:ValleySpiritFruitFallProposal,
 activation:{type:'fruit_fall';enabled:boolean;policy:ValleySpiritFruitFallPolicy}|undefined,
 authority:ValleySpiritFruitFallAuthority,
):ValleySpiritFruitFallExecution {
 return coordinateFruitFall(proposal,activation,authority,preflightValleySpiritFruitFallFixtureAttachment);
}
function coordinateFruitFall(
 proposal:ValleySpiritFruitFallProposal,
 activation:{type:'fruit_fall';enabled:boolean;policy:ValleySpiritFruitFallPolicy}|undefined,
 authority:ValleySpiritFruitFallAuthority,
 preflight:typeof preflightValleySpiritFruitFall,
):ValleySpiritFruitFallExecution {
 if(activation?.type!==FAMILY||activation.enabled!==true)return {status:'disabled'};
 let effectId:string;
 try{
  if(proposal.schema!=='valley-spirit-proposal/v1'||proposal.type!==FAMILY||!id(proposal.proposalId)||proposal.quantity!==1||
   proposal.opportunityId!==valleySpiritFruitFallOpportunityId(proposal.worldId,proposal.rainEventId,proposal.sourceResourceInstanceId))
   return {status:'rejected',reason:'invalid-proposal'};
  effectId=valleySpiritFruitFallEffectId(proposal.opportunityId);
 }catch{return {status:'rejected',reason:'invalid-proposal'};}
 const lookup=(replay:boolean)=>recoverValleySpiritFruitFallReceipt(proposal,authority,replay);
 const existing=lookup(true);
 if(existing)return existing;
 try{
  const result=authority.commitOnce(effectId,({scheduled,evidence,effectQuotaAvailable}):Plan=>{
   const now=evidence?.nowMicroMinute;
   if(!scheduled||scheduled.type!==FAMILY||scheduled.worldId!==proposal.worldId||scheduled.proposalId!==proposal.proposalId||
      scheduled.opportunityId!==proposal.opportunityId||!id(scheduled.approvalId)||!natural(now)||
      !natural(scheduled.firstMicroMinute)||!natural(scheduled.expiresMicroMinute)||
      now<scheduled.firstMicroMinute||now>=scheduled.expiresMicroMinute)
    return {status:'rejected',reason:'schedule'};
   if(effectQuotaAvailable!==true)return {status:'rejected',reason:'cooldown-or-quota'};
   const checked=preflight(proposal,evidence,activation.policy);
   if(checked.status!=='validated_shadow')return {status:'rejected',reason:'revalidation'};
   return {status:'commit',receipt:Object.freeze({
    schemaVersion:VERSION,family:FAMILY,worldId:proposal.worldId,effectId,opportunityId:proposal.opportunityId,
    proposalId:proposal.proposalId,approvalId:scheduled.approvalId,rainEventId:proposal.rainEventId,
    sourceResourceInstanceId:proposal.sourceResourceInstanceId,targetId:proposal.targetId,
    ownerId:checked.projection.ownerId,committedAtMicroMinute:now,debitRipeFruit:1,creditGroundFruit:1,
   })};
  });
  if(result.status==='rejected')return result;
 }catch{/* authority might have committed before acknowledgement */}
 return lookup(false)??blocked;
}

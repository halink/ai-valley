import type {MvpGroundFruit} from '../shared/mvp-ground-fruit.js';
import type {Vec,World} from '../shared/types.js';
import type {ValleySpiritFruitFallReceipt} from '../shared/valley-spirit-effects.js';
import {emitLedgerEvent} from '../world/events.js';
import {inspectMvpGroundFruitPlacement} from '../world/mvp-ground-fruit.js';
import {resolveMvpRainEpisode} from '../world/mvp-rain-provenance.js';
import {MVP_FRUIT_FALL_EVENT_TEXT,projectMvpSpiritActiveGround} from '../world/mvp-spirit-effects.js';
import type {WorldStore} from './store.js';
import {executeValleySpiritFruitFallFixture,recoverValleySpiritFruitFallReceipt,
 type ValleySpiritApprovedSchedule,type ValleySpiritFruitFallAuthority,type ValleySpiritFruitFallExecution,
} from './valley-spirit-fruit-fall-execution.js';
import {isEnabledValleySpiritFruitFallPolicy,type ValleySpiritFruitFallEvidence,
 type ValleySpiritFruitFallOption,type ValleySpiritFruitFallPolicy,type ValleySpiritFruitFallProposal,
} from './valley-spirit-proposal.js';

const SCOPE='isolated-sqlite-fruit-fall-fixture' as const;

/** Internal caller supplies its own pinned, manually approved option and test
 * quota. This is not a production approval, model output, or HTTP contract. */
export interface MvpFruitFallFixtureApproval {
 readonly scope:typeof SCOPE;
 readonly enabled:boolean;
 readonly policy:ValleySpiritFruitFallPolicy;
 readonly schedule:ValleySpiritApprovedSchedule;
 readonly pinnedOption:ValleySpiritFruitFallOption;
 readonly currentPermissionVersion:number;
 readonly sourceResourceId:string;
 readonly target:Vec;
 readonly maxCommittedEffects:number;
}
export interface MvpFruitFallFixtureMirror {
 writeConfirmed(receipt:ValleySpiritFruitFallReceipt):'recorded'|'unchanged';
}
export interface MvpFruitFallFixtureResult {
 readonly execution:ValleySpiritFruitFallExecution|null;
 readonly mirror:'not_requested'|'not_applied'|'recorded'|'deferred';
}
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const validApproval=(a:MvpFruitFallFixtureApproval)=>a.scope===SCOPE&&a.enabled===true&&
 isEnabledValleySpiritFruitFallPolicy(a.policy)&&a.schedule?.type==='fruit_fall'&&
 !!a.pinnedOption&&a.pinnedOption.worldId===a.schedule.worldId&&
 natural(a.currentPermissionVersion)&&a.currentPermissionVersion>0&&
 a.pinnedOption.permissionVersion===a.currentPermissionVersion&&
 natural(a.maxCommittedEffects)&&a.maxCommittedEffects<=4096&&
 natural(a.schedule.firstMicroMinute)&&natural(a.schedule.expiresMicroMinute)&&
 natural(a.pinnedOption.validFromMicroMinute)&&natural(a.pinnedOption.validUntilMicroMinute)&&
 a.schedule.firstMicroMinute>=a.pinnedOption.validFromMicroMinute&&
 a.schedule.expiresMicroMinute<=a.pinnedOption.validUntilMicroMinute&&
 a.schedule.firstMicroMinute<a.schedule.expiresMicroMinute;

function fixtureWorld(store:WorldStore,worldId:string):World {
 if(!store.hasMvpSpiritEffectFixture())throw Error('mvp_spirit_fixture_requires_disposable_memory');
 const current=store.load();
 if(!current||current.id!==worldId||current.mode!=='validation'||!current.mvpClimate?.rainProvenance)
  throw Error('mvp_spirit_fixture_invalid_world');
 return current;
}

/** Explicit empty fixture adoption; never run from normal rule or model startup. */
export function adoptMvpFruitFallAttachmentFixture(store:WorldStore,worldId:string):boolean {
 const current=fixtureWorld(store,worldId);
 if(current.mvpClimate!.spiritEffects)return false;
 const revision=current.revision++;
 current.mvpClimate!.spiritEffects={version:1,adoptedUs:current.mvpClimate!.lastUs,ground:{version:1,items:[]},applied:[]};
 store.commit(current,revision);return true;
}
function reader(store:WorldStore):Pick<ValleySpiritFruitFallAuthority,'readReceipt'> {
 return {readReceipt(worldId,effectId){
  try{
   const current=fixtureWorld(store,worldId),state=current.mvpClimate!.spiritEffects;
   if(!state)return {status:'unknown'};
   const found=state.applied.find(entry=>entry.receipt.effectId===effectId);
   return found?{status:'found',receipt:found.receipt}:{status:'missing'};
  }catch{return {status:'unknown'};}
 }};
}
function mirrorOwnReceipt(execution:ValleySpiritFruitFallExecution|null,mirror?:MvpFruitFallFixtureMirror):MvpFruitFallFixtureResult {
 if(!mirror)return {execution,mirror:'not_requested'};
 if(execution?.status!=='applied')return {execution,mirror:'not_applied'};
 try{
  const written=mirror.writeConfirmed(execution.receipt);
  if(written==='recorded'||written==='unchanged')return {execution,mirror:'recorded'};
 }catch{/* The mirror is not an authority; leave it for read-only reconciliation. */}
 return {execution,mirror:'deferred'};
}
/** No adoption, read, or write when approval is omitted or explicitly off. */
export function runMvpFruitFallAttachmentFixture(
 store:WorldStore,proposal:ValleySpiritFruitFallProposal,approval?:MvpFruitFallFixtureApproval,mirror?:MvpFruitFallFixtureMirror,
 requireCurrent?:(head:World)=>boolean,
):MvpFruitFallFixtureResult {
 if(!approval||approval.enabled!==true)return mirrorOwnReceipt({status:'disabled'},mirror);
 let approved:MvpFruitFallFixtureApproval;
 try{approved=structuredClone(approval);if(!validApproval(approved))throw Error('invalid_approval');}
 catch{return mirrorOwnReceipt({status:'rejected',reason:'schedule'},mirror);}
 type CommitResult=ReturnType<ValleySpiritFruitFallAuthority['commitOnce']>;
 const authority:ValleySpiritFruitFallAuthority={...reader(store),commitOnce(effectId,plan){
  return store.runMvpSpiritEffectFixture<CommitResult>(proposal.worldId,(current,capacity)=>{
   if(requireCurrent&&!requireCurrent(current))return {result:{status:'rejected',reason:'revalidation'}};
   const state=current.mvpClimate!.spiritEffects!;
   if(state.applied.some(entry=>entry.receipt.effectId===effectId))return {result:{status:'recorded'}};
   if(current.clock.paused)return {result:{status:'rejected',reason:'schedule'}};
   const now=Number(current.mvpClimate!.lastUs),pinned=approved.pinnedOption;
   const rain=resolveMvpRainEpisode(current,pinned.rainEventId);
   const activeGround=projectMvpSpiritActiveGround(current);
   const placement=activeGround&&inspectMvpGroundFruitPlacement(current,activeGround,approved.sourceResourceId,approved.target,capacity);
   const effectsAllowed=state.applied.length<approved.maxCommittedEffects;
   const evidence:ValleySpiritFruitFallEvidence={
    worldId:current.id,nowMicroMinute:now,
    approvedBasis:{inputSnapshotId:pinned.inputSnapshotId,menuVersion:pinned.menuVersion,
     permissionVersion:approved.currentPermissionVersion,sourceRefs:pinned.sourceRefs,
     offeredOption:{rainEventId:pinned.rainEventId,sourceResourceInstanceId:pinned.sourceResourceInstanceId,
      targetId:pinned.targetId,quantity:pinned.quantity,validFromMicroMinute:pinned.validFromMicroMinute,
      validUntilMicroMinute:pinned.validUntilMicroMinute}},
    ...(rain?{rain:{type:'committed_actual_rain',worldId:current.id,rainEventId:rain.rainEventId,endedUs:rain.endedUs}}:{}),
    ...(placement?{source:placement.source,target:{id:placement.target.id,freeCapacity:placement.target.freeCapacity,
     reachable:placement.target.reachable,preservesOwnerId:placement.target.preservesOwnerId,
     supportsGroundFood:true,supportsDiscovery:false,supportsPickup:false}}:{}),
    opportunityConsumed:state.applied.some(entry=>entry.receipt.opportunityId===proposal.opportunityId),
    proposalQuotaAvailable:!state.applied.some(entry=>entry.receipt.proposalId===approved.schedule.proposalId),
    lastCommittedFruitFallMicroMinute:state.applied.at(-1)?.receipt.committedAtMicroMinute??null,
   };
   const decision=plan({scheduled:approved.schedule,evidence,effectQuotaAvailable:effectsAllowed});
   if(decision.status==='rejected')return {result:decision};
   const receipt=decision.receipt;
   if(!rain||!placement||receipt.effectId!==effectId||receipt.ownerId!=='commons')
    throw Error('mvp_spirit_fixture_plan_inconsistent');
   const draft=structuredClone(current),source=draft.resources.find(r=>r.id===approved.sourceResourceId);
   if(!source)throw Error('mvp_spirit_fixture_source_missing');
   const sourceBefore=source.amount;source.amount--;
   const lot:MvpGroundFruit={effectId,kind:'fallen-fruit',amount:1,ownerId:'commons',sourceResourceId:source.id,
    sourceResourceInstanceId:receipt.sourceResourceInstanceId,sourceAt:{...source.at},rainEventId:receipt.rainEventId,
    at:{...approved.target},placedUs:current.mvpClimate!.lastUs};
   const event=emitLedgerEvent(draft,{kind:'system',actors:[],place:lot.at,text:MVP_FRUIT_FALL_EVENT_TEXT,
    mvpFruitFall:{version:1,effectId}});
   draft.mvpClimate!.spiritEffects={...state,ground:{...state.ground,items:[...state.ground.items,lot]},
    applied:[...state.applied,{receipt,rain,eventId:event.id,sourceBefore,sourceAfter:source.amount}]};
   return {result:{status:'recorded'},draft};
  });
 }};
 const execution=executeValleySpiritFruitFallFixture(proposal,{type:'fruit_fall',enabled:true,policy:approved.policy},authority);
 return mirrorOwnReceipt(execution,mirror);
}

/** Unfinished mirror callbacks are recoverable from the actual historical
 * effect, even with approval/execution no longer available. Never replays it. */
export function reconcileMvpFruitFallAttachmentFixture(
 store:WorldStore,proposal:ValleySpiritFruitFallProposal,mirror?:MvpFruitFallFixtureMirror,
):MvpFruitFallFixtureResult {
 return mirrorOwnReceipt(recoverValleySpiritFruitFallReceipt(proposal,reader(store)),mirror);
}

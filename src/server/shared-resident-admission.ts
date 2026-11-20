import {createHash} from 'node:crypto';
import {offlineSharedValleySpiritAccount} from './shared-model-account-offline.js';
import type {ValleySpiritSyntheticSchedulePolicy} from './valley-spirit-almanac-scheduler.js';
import {ownsProductionAccountQuotaRehearsal,type ProductionModelAccountOwnership,type ProductionAccountQuotaRehearsal} from './production-model-account-ownership.js';
import type {SharedModelAccountPolicy,SharedModelAccountLedger} from './shared-model-account.js';

/** Stable ID supplied by the decision-round owner, not by a server process,
 * retry counter, current tick, or identity derived from private prompt text. */
export interface ResidentAccountRound {worldId:string;residentId:string;roundId:string;}
interface Usage {inputTokens:number;outputTokens:number;}
type Results<T>={status:'complete';result:T}|{status:'deferred'|'complete-discarded'|'proven-unsent'|'recover-held'|'delivery-unresolved'|'already-terminal'|'account-blocked'};
const key=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,126}$/.test(v);
function roundKey(round:ResidentAccountRound):string {
 if(!key(round.worldId)||!key(round.residentId)||!key(round.roundId))throw Error('resident_account_round_invalid');
 return 'resident-round-'+createHash('sha256').update(JSON.stringify([round.worldId,round.residentId,round.roundId])).digest('hex');
}
type ResidentLedger=Pick<SharedModelAccountLedger,'requestState'|'requestStates'|'reserve'|'cancelProvenUnsent'|
 'setResidentWaiting'|'markHandoff'|'confirmCompletion'>;
export interface CanonicalSeasonalQuota {
 mode:'explicit-offline-seasonal-resident-quota';worldId:string;runId:string;
 ownership:ProductionModelAccountOwnership;quota:ProductionAccountQuotaRehearsal;policy:SharedModelAccountPolicy;
}
interface RoundOptions<T> {
 round:ResidentAccountRound;
 estimate:Usage;
 /** Must be current both before reserving and before the actual handoff. */
 authorize:()=>boolean;
 /** World owner persists the exact stable world-side intent after admission
  * and before any handoff. Throwing leaves the held reservation for recovery. */
 beforeHandoff?:()=>boolean;
 /** Offline local simulation only. A returned completion certifies that this
  * invocation has finished. Throwing is ambiguous and leaves quota held. */
 simulate:()=>Promise<{completion:'synthetic-complete';result:T;usage?:Usage}>;
}
/** Offline runtime-facing prerequisite. Use the exact same ledger instance
 * as offlineSharedValleySpiritAccount. An adapter that calls a real provider
 * must be independently implemented and authorized; this never enables one. */
export class OfflineResidentAccountAdmission {
 static claimCanonical(input:Readonly<CanonicalSeasonalQuota>,now:()=>number){
  if(!input||Object.keys(input).length!==6||input.mode!=='explicit-offline-seasonal-resident-quota'||
     !/^godot-mvp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.worldId))
   throw Error('seasonal_model_canonical_scope');
  const {ownership,quota,worldId,runId}=input,policy=structuredClone(input.policy);
  const assert=()=>{
   if(!ownsProductionAccountQuotaRehearsal(ownership,quota)||quota.runId!==runId||
      ownership.runId!==runId||quota.accountScope!==policy.accountId)
    throw Error('seasonal_model_canonical_scope');
   ownership.assertOwned();
   if(!quota.matchesPolicy(policy))throw Error('seasonal_model_canonical_policy');
  };
  assert();
  const binding=quota.seasonalResidentBinding();
  const mutate=<T>(f:()=>T)=>{assert();return f();};
  const shared:ResidentLedger={
   requestState:id=>mutate(()=>quota.seasonalResidentStates([id]).get(id)??null),
   requestStates:ids=>mutate(()=>quota.seasonalResidentStates(ids)),
   reserve:(r,t)=>mutate(()=>quota.reserve({requestId:r.requestId,purpose:'resident',inputTokens:r.inputTokens,outputTokens:r.outputTokens},t)),
   // Use a world sentinel only on canonical quota. A reserved resident still
   // owns actual admission; stale per-round waiters cannot wedge the account.
   setResidentWaiting:(id,value,t)=>{if(id.startsWith('resident-world-'))mutate(()=>quota.setResidentWaiting(id,value,t));},
   markHandoff:(id,t)=>mutate(()=>quota.markHandoff(id,t)),
   cancelProvenUnsent:(id,t)=>mutate(()=>quota.cancelProvenUnsent(id,t)),
   confirmCompletion:(id,t,usage)=>mutate(()=>quota.confirmCompletion(id,t,usage)),
  };
  return {worldId,quota,binding,admission:new ResidentAccountAdmissionCore(shared,now,worldId),
   assertFresh(){const s=mutate(()=>quota.summary(now()));if(s.held||s.unknown||s.waitingResidents)
    throw Error('seasonal_model_canonical_recovery_unresolved');}};
 }

 private readonly core:ResidentAccountAdmissionCore;
 constructor(private readonly ledger:SharedModelAccountLedger,private readonly now:()=>number){
  if(!/^offline-[A-Za-z0-9_-]{1,80}$/.test(ledger.accountIdentity()))throw Error('resident_account_offline_fixture_required');
  this.core=new ResidentAccountAdmissionCore(ledger,now);
 }
 fixtureYearbook(policy:ValleySpiritSyntheticSchedulePolicy,simulate:Parameters<typeof offlineSharedValleySpiritAccount>[1]['simulate']){
  if(policy.mode!=='offline-synthetic'||!this.ledger.matchesPolicy({accountId:policy.accountId,limit:policy.account,residentFloor:policy.residentFloor,almanacCap:policy.yearbookCap,almanacCooldownMs:policy.cooldownMs}))throw Error('seasonal_almanac_shared_policy_mismatch');
  return offlineSharedValleySpiritAccount(this.ledger,{now:this.now,simulate});
 }
 fixtureBinding():string{return this.ledger.offlineFixtureBinding();}
 verifyWorldRecovery(rounds:Parameters<ResidentAccountAdmissionCore['verifyWorldRecovery']>[0]){return this.core.verifyWorldRecovery(rounds);}
 setWorldWaiting(worldId:string,waiting:boolean){return this.core.setWorldWaiting(worldId,waiting);}
 queue(round:ResidentAccountRound){return this.core.queue(round);}
 abandonUnsent(round:ResidentAccountRound){return this.core.abandonUnsent(round);}
 attempt<T>(options:RoundOptions<T>){return this.core.attempt(options);}
}
class ResidentAccountAdmissionCore {
 constructor(private readonly ledger:ResidentLedger,private readonly now:()=>number,private readonly pinnedWorld?:string){}
 private checkWorld(worldId:string){if(this.pinnedWorld!==undefined&&worldId!==this.pinnedWorld)throw Error('seasonal_model_canonical_world');}
 verifyWorldRecovery(rounds:readonly {round:ResidentAccountRound;worldTerminal:boolean}[]):boolean {
  const ids=rounds.map(item=>{this.checkWorld(item.round.worldId);return roundKey(item.round);}),account=this.ledger.requestStates(ids);
  return rounds.every((item,index)=>{
   const stored=account.get(ids[index]);
   return stored?.purpose==='resident'&&(!item.worldTerminal||stored.phase==='complete');
  });
 }
 /** The bounded runtime holds this sentinel while any resident is ready (or
  * its decision unresolved). It has no relation to which request is charged. */
 setWorldWaiting(worldId:string,waiting:boolean):void {
  this.checkWorld(worldId);if(!key(worldId))throw Error('resident_account_world_invalid');
  this.ledger.setResidentWaiting('resident-world-'+createHash('sha256').update(worldId).digest('hex'),waiting,this.now());
 }
 queue(round:ResidentAccountRound):void {
  // All runnable decision rounds should register before optional work can ask
  // for a lease. Do not convert a persisted uncertainty into a fresh waiter.
  this.checkWorld(round.worldId);const id=roundKey(round);
  if(!this.ledger.requestState(id))this.ledger.setResidentWaiting(id,true,this.now());
 }
 abandonUnsent(round:ResidentAccountRound):boolean {
  this.checkWorld(round.worldId);const id=roundKey(round),state=this.ledger.requestState(id);
  if(state&&state.phase!=='held')return false;
  if(state&&!this.ledger.cancelProvenUnsent(id,this.now()))return false;
  this.ledger.setResidentWaiting(id,false,this.now());return true;
 }
 async attempt<T>(options:RoundOptions<T>):Promise<Results<T>>{
  this.checkWorld(options.round.worldId);const id=roundKey(options.round);
  let atHandoff=false,completed=false;
  try{
   const previous=this.ledger.requestState(id);
   if(previous?.phase==='sent-unknown')return {status:'delivery-unresolved'};
   if(previous?.phase==='held')return {status:'recover-held'};
   if(previous)return {status:'already-terminal'};
   if(!options.authorize())return {status:this.abandonUnsent(options.round)?'proven-unsent':'account-blocked'};
   const reserved=this.ledger.reserve({requestId:id,purpose:'resident',residentDecisionId:id,inputTokens:options.estimate.inputTokens,outputTokens:options.estimate.outputTokens},this.now());
   if(reserved.status!=='reserved')return {status:reserved.status==='account-capacity'?'deferred':'account-blocked'};
   if(!options.authorize())return {status:this.abandonUnsent(options.round)?'proven-unsent':'account-blocked'};
   if(options.beforeHandoff&&options.beforeHandoff()!==true)return {status:this.abandonUnsent(options.round)?'proven-unsent':'account-blocked'};
   if(!options.authorize())return {status:this.abandonUnsent(options.round)?'proven-unsent':'account-blocked'};
   // Before any transport call, persist the point of no safe retry. Should
   // cancellation/authorization change after that, err as possibly sent.
   if(!this.ledger.markHandoff(id,this.now()))return {status:'account-blocked'};
   atHandoff=true;
   if(!options.authorize())return {status:'delivery-unresolved'};
   const done=await options.simulate();
   if(done.completion!=='synthetic-complete'||!this.ledger.confirmCompletion(id,this.now(),done.usage))return {status:'delivery-unresolved'};
   completed=true;
   return options.authorize()?{status:'complete',result:done.result}:{status:'complete-discarded'};
  }catch{
   return {status:completed?'complete-discarded':atHandoff?'delivery-unresolved':'account-blocked'};
  }
 }
}

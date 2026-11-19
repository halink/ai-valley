import {createHash} from 'node:crypto';
import type {SharedModelAccountLedger} from './shared-model-account.js';

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
interface RoundOptions<T> {
 round:ResidentAccountRound;
 estimate:Usage;
 /** Must be current both before reserving and before the actual handoff. */
 authorize:()=>boolean;
 /** Offline local simulation only. A returned completion certifies that this
  * invocation has finished. Throwing is ambiguous and leaves quota held. */
 simulate:()=>Promise<{completion:'synthetic-complete';result:T;usage?:Usage}>;
}
/** Offline runtime-facing prerequisite. Use the exact same ledger instance
 * as offlineSharedValleySpiritAccount. An adapter that calls a real provider
 * must be independently implemented and authorized; this never enables one. */
export class OfflineResidentAccountAdmission {
 constructor(private readonly ledger:SharedModelAccountLedger,private readonly now:()=>number){
  if(!/^offline-[A-Za-z0-9_-]{1,80}$/.test(ledger.accountIdentity()))throw Error('resident_account_offline_fixture_required');
 }
 queue(round:ResidentAccountRound):void {
  // All runnable decision rounds should register before optional work can ask
  // for a lease. Do not convert a persisted uncertainty into a fresh waiter.
  const id=roundKey(round);
  if(!this.ledger.requestState(id))this.ledger.setResidentWaiting(id,true,this.now());
 }
 abandonUnsent(round:ResidentAccountRound):boolean {
  const id=roundKey(round),state=this.ledger.requestState(id);
  if(state&&state.phase!=='held')return false;
  if(state&&!this.ledger.cancelProvenUnsent(id,this.now()))return false;
  this.ledger.setResidentWaiting(id,false,this.now());return true;
 }
 async attempt<T>(options:RoundOptions<T>):Promise<Results<T>>{
  const id=roundKey(options.round);
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

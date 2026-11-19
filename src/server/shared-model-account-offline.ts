import type {ValleySpiritSyntheticSharedAccount} from './valley-spirit-almanac-scheduler.js';
import type {ValleySpiritAlmanacPacket} from './valley-spirit-almanac.js';
import type {SharedModelAccountLedger} from './shared-model-account.js';

/** Exercise the scheduler against durable common quota, not production. The
 * injected function is a local simulation only; no transport or model configs
 * are accepted by this module. Residents can share the same ledger directly. */
export function offlineSharedValleySpiritAccount(ledger:SharedModelAccountLedger,options:{
 now:()=>number;
 simulate:(packet:Readonly<ValleySpiritAlmanacPacket>)=>Promise<{result:unknown;usage?:{inputTokens:number;outputTokens:number}}>;
}):ValleySpiritSyntheticSharedAccount {
 return {
  kind:'offline-synthetic-shared-account',
  async requestLowPriority(req){
   if(!/^offline-[A-Za-z0-9_-]{1,80}$/.test(req.accountId)||req.purpose!=='valley-spirit-almanac'||req.promptVersion!==1||
    !ledger.matchesPolicy({accountId:req.accountId,limit:req.account,residentFloor:req.residentFloor,almanacCap:req.yearbookCap,almanacCooldownMs:req.cooldownMs}))return null;
   const admitted=ledger.reserve({requestId:req.requestId,purpose:req.purpose,inputTokens:req.maxInputTokens,outputTokens:req.maxOutputTokens},options.now());
   if(admitted.status!=='reserved')return null;
   let active=true;
   const cancelBeforeDispatch=()=>{
    if(active){active=false;if(!ledger.cancelProvenUnsent(req.requestId,options.now()))throw Error('offline_account_unsent_state');}
   };
   return {
    cancelBeforeDispatch,
    async dispatchOnce(packet,authorize){
     if(!active)throw Error('offline_account_dispatch_used');
     const at=options.now();
     if(!authorize()){cancelBeforeDispatch();throw Error('offline_account_permission_changed');}
     active=false;
     if(!ledger.markHandoff(req.requestId,at))throw Error('offline_account_handoff_state');
     if(!authorize())throw Error('offline_account_guard_after_handoff');
     // If the callback throws, uncertainty stays in the common durable ledger.
     const completion=await options.simulate(packet);
     if(!ledger.confirmCompletion(req.requestId,options.now(),completion.usage))throw Error('offline_account_completion_state');
     return completion.result;
    },
   };
  },
 };
}

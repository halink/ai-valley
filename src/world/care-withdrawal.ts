import {adultPresenceSelfStop,adultPresenceStops} from './adult-presence.js';
import {emergencyCareSelfWithdrawal,emergencyCareSelfWithdrawalOpportunities} from './emergency-care.js';
import type {Action,FormalOpportunity,Resident,World} from '../shared/types.js';
import {basicCareWithdrawalReason,basicCareWithdrawals,isBasicCareWithdrawal} from './social.js';
import {longCareSelfWithdrawal,longCareSelfWithdrawalOpportunities} from './long-care-withdrawal.js';

/** Only the authoritative, current participant can exercise a care stop. */
export function careSelfWithdrawal(w:World,r:Resident,a:Action):Action|null {
 if(isBasicCareWithdrawal(w,a))return basicCareWithdrawalReason(w,r,a)===null?a:null;
 return adultPresenceSelfStop(w,r,a)??longCareSelfWithdrawal(w,r,a)??emergencyCareSelfWithdrawal(w,r,a);
}
export function careWithdrawalOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal')return [];
 return [...adultPresenceStops(w,r),...emergencyCareSelfWithdrawalOpportunities(w,r).map(c=>({...c,id:'care.stop.'+c.id})),...basicCareWithdrawals(w,r).map(p=>({id:`care.stop.${p.id}`,label:p.targetId===r.id?`立即停止${w.residents.find(v=>v.id===p.actorId)?.name??'对方'}的这一次基础照护（${p.id}）`:`撤回我提出的这一次基础照护（${p.id}）`,action:{type:'respond' as const,proposalId:p.id,accept:false}})),...longCareSelfWithdrawalOpportunities(w,r).map(c=>({...c,id:'care.stop.'+c.id}))];
}
export function hasCareWithdrawal(w:World,r:Resident):boolean{return careWithdrawalOpportunities(w,r).length>0;}
/** A busy or decision-impaired recipient gets only expression controls, not a second work plan. */
export function careWithdrawalOnly(w:World,r:Resident):boolean{return (!r.canDecide||!!r.plan||!!r.activity)&&hasCareWithdrawal(w,r);}
export function careExpressionWait(w:World,r:Resident,a:Action):boolean{return careWithdrawalOnly(w,r)&&a.type==='wait'&&Object.keys(a).every(k=>['type','minutes'].includes(k))&&Number.isFinite(a.minutes)&&a.minutes>=1&&a.minutes<=15;}

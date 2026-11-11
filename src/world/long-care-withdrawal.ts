import type {Action,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {LongCareAction} from '../shared/long-care.js';
import {atPromiseSite,knownPromises} from './known-promises.js';

/** A shape check is for presentation only; authority always uses the world-bound helper below. */
export function isLongCareWithdrawal(a:Action):boolean {
 return a.type==='longCare'&&a.operation==='cancel'||a.type==='promise'&&a.operation==='withdraw'&&a.promiseId.startsWith('longCare:');
}

/** Expression permits only stopping this beneficiary's original agreement, never arranging care. */
export function longCareSelfWithdrawal(w:World,r:Resident,a:Action):LongCareAction|Extract<Action,{type:'promise'}>|null {
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside'||!r.canExpress)return null;
 let id:string|undefined;
 if(a.type==='longCare'&&a.operation==='cancel'){
  if(Object.keys(a).some(k=>!['type','operation','agreementId','definition'].includes(k)))return null;
  id=a.agreementId;
 }else if(a.type==='promise'&&a.operation==='withdraw'&&a.promiseId.startsWith('longCare:')){
  if(Object.keys(a).some(k=>!['type','operation','promiseId'].includes(k)))return null;
  if(!knownPromises(w,r).some(p=>p.id===a.promiseId))return null;
  id=a.promiseId.slice('longCare:'.length);
 }else return null;
 const c=w.longCare?.agreements.find(c=>c.id===id);
 if(!c||c.beneficiaryId!==r.id)return null;
 // A known remote promise remains withdrawable even after an internal settlement.
 // Preserve the original alias so completePromise records only the person's stop,
 // without revealing a remote reason or refunding the same agreement twice.
 if(a.type==='promise')return {type:'promise',operation:'withdraw',promiseId:a.promiseId};
 if(!['offered','awaitingChild','active'].includes(c.status))return null;
 return {type:'longCare',operation:'cancel',agreementId:c.id};
}

export function longCareSelfWithdrawalOpportunities(w:World,r:Resident):FormalOpportunity[] {
 const known=knownPromises(w,r);
 return (w.longCare?.agreements??[]).flatMap(c=>{
  const promise=known.find(p=>p.id==='longCare:'+c.id);
  const remote=!!promise&&!atPromiseSite(w,r,promise.buildingId);
  const action=longCareSelfWithdrawal(w,r,remote?{type:'promise',operation:'withdraw',promiseId:promise.id}:{type:'longCare',operation:'cancel',agreementId:c.id});
  return action?[{id:'care.selfStop.'+c.id,label:'本人立即停止这一份为自己提供的长期照护；尚未发生的服务不扣料、不收费，未用预付款退回原来源；不更改其他照护约定',action}]:[];
 });
}

export function expressiveLongCareBeneficiary(w:World,r:Resident):boolean {
 return !r.canDecide&&longCareSelfWithdrawalOpportunities(w,r).length>0;
}

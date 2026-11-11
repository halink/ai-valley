import type {LongCareAgreement} from '../shared/long-care.js';
import type {Resident,World} from '../shared/types.js';
import {ageYears,knownAgeYears,DAY} from './time.js';

/** Legacy true was also the under-six default. It is evidence only when the
 * offer itself was already after six and the signed agreement became active. */
function personalAssentAt(w:World,c:LongCareAgreement,p:Resident):number|null {
 if(c.childAssent!==true||c.acceptedAt===null||!Number.isFinite(c.acceptedAt))return null;
 const at=c.childAssentedAt===undefined||c.childAssentedAt===null&&c.legacyPersonalAssent===true
  ?c.status==='active'&&Number.isFinite(c.createdAt)&&ageYears(p.bornAt,c.createdAt)>=6?c.acceptedAt:null
  :c.childAssentedAt;
 return typeof at==='number'&&Number.isFinite(at)&&at>=c.createdAt&&at>=c.acceptedAt&&at<=w.minute&&ageYears(p.bornAt,at)>=6?at:null;
}
export function longCareHasPersonalAssent(w:World,c:LongCareAgreement):boolean {
 const p=w.residents.find(p=>p.id===c.beneficiaryId);
 return !!p&&personalAssentAt(w,c,p)!==null;
}
/** Pure guard: unknown age cannot create an under-six exemption. A birthday or
 * damaged birth record can precede the lifecycle pass or happen mid-service. */
export function longCareNeedsPersonalAssent(w:World,c:LongCareAgreement):boolean {
 const p=w.residents.find(p=>p.id===c.beneficiaryId);
 return !!p&&(knownAgeYears(p.bornAt,w.minute)===null||ageYears(p.bornAt,w.minute)>=6&&!longCareHasPersonalAssent(w,c));
}
export function longCareAwaitingPersonalAssent(w:World,c:LongCareAgreement):boolean {
 return c.acceptedAt!==null&&w.minute<c.endDay*DAY&&
  (c.status==='awaitingChild'||c.status==='active'&&longCareNeedsPersonalAssent(w,c));
}
/** Pause an existing promise; never treat silence as assent, refund, renew, or
 * erase a recorded refusal. Initial unsigned care still has its first-window deadline. */
export function normalizeLongCareConsent(w:World,c:LongCareAgreement):void {
 const p=w.residents.find(p=>p.id===c.beneficiaryId);if(!p)return;
 if(c.childAssentedAt===undefined){
  const legacy=personalAssentAt(w,c,p)!==null;
  // Old records prove a choice happened, but do not retain its exact time.
  c.childAssentedAt=null;c.childAssent=legacy;if(legacy)c.legacyPersonalAssent=true;
 }
 if(c.status==='active'&&longCareNeedsPersonalAssent(w,c)){
  c.status='awaitingChild';c.assentPausedAt??=w.minute;delete c.handoffWatch;
 }
}

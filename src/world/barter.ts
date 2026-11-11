import {sameBarterTerms,validBarterInventory} from '../shared/barter.js';
import type {Action,Resident,World} from '../shared/types.js';
import {knownAgeYears} from './time.js';

/** Ordinary barter keeps its formal adult-only rule, without changing the
 * validation sandbox or giving a proposal recipient any automatic consent. */
export function barterEligible(w:World,r:Resident,at=w.minute):boolean {
 const age=knownAgeYears(r.bornAt,at);
 return r.status==='alive'&&r.residency!=='outside'&&Number.isFinite(r.health)&&r.health>0&&r.canDecide&&r.canExpress
  &&(w.mode!=='formal'||age!==null&&age>=18);
}

/** Pure authorization check at start, throughout travel/work, and immediately
 * before settlement. It never expires, repairs or rewrites a signed offer.
 * Stock remains checked on actual contact, not probed from a remote address. */
export function barterActionReason(w:World,r:Resident,a:Extract<Action,{type:'offer'|'accept'}>,elapsed=0):string|null {
 // Preflight simulates work without advancing the clock. Never test a made-up
 // interval before the person's choice; real ticks still check their full span.
 const start=Math.min(w.minute,Math.max(w.minute-elapsed,r.plan?.createdAt??r.activity?.startedAt??w.minute-elapsed));
 if(!barterEligible(w,r)||!barterEligible(w,r,start))return '本人当前无法证明具备普通交换所需的成年身份、决定与表达能力';
 if(a.type==='offer')return validBarterInventory(a.give)&&validBarterInventory(a.want)?null:'报价物品或数量无效';
 const offer=w.offers.find(o=>o.id===a.offerId);
 if(!offer||offer.status!=='open'||offer.targetId!==r.id||!Number.isFinite(offer.expiresAt)||offer.expiresAt<=w.minute)return '报价已经失效或没有交给本人';
 if(!sameBarterTerms(a.offerTerms,offer))return '原报价内容无法核实或已经改变，须本人重新选择';
 const author=w.residents.find(p=>p.id===offer.actorId);
 if(!author||author.id===r.id||!barterEligible(w,author)||!barterEligible(w,author,start))return '原报价人当前无法证明具备普通交换所需的成年身份、决定与表达能力';
 return null;
}

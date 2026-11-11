import type {Resident,World} from '../shared/types.js';
import {knownAgeYears,DAY} from './time.js';

type GuardianOffer=NonNullable<Resident['guardianOffer']>;
/** Old offers had a fixed one-day lifetime, but no creation or signature time.
 * Keep those records unchanged; their exact personal signature time is unknown. */
const createdAt=(offer:GuardianOffer)=>offer.createdAt===undefined?offer.expiresAt-DAY:offer.createdAt;
export function guardianOfferIdentity(offer:GuardianOffer):string {
 return offer.id??'legacy-guardian:'+JSON.stringify([offer.volunteerId,offer.guardianId,offer.expiresAt]);
}
export function guardianOfferLive(w:World,offer:GuardianOffer):boolean {
 const start=createdAt(offer);
 return Number.isFinite(start)&&Number.isFinite(offer.expiresAt)&&offer.expiresAt===start+DAY&&start<=w.minute&&w.minute<offer.expiresAt;
}
/** Pure completion/menu guard: an under-six exemption is never personal consent.
 * Legacy true proves a choice only if the original proposal was already at six.
 * New records distinguish an actual completed choice from that historical default. */
export function guardianHasPersonalApproval(w:World,child:Resident,offer:GuardianOffer):boolean {
 if(offer.childApproved!==true||!guardianOfferLive(w,offer))return false;
 const legacy=offer.id===undefined&&offer.createdAt===undefined&&offer.childApprovedAt===undefined;
 const start=createdAt(offer),at=legacy?start:offer.childApprovedAt;
 const age=knownAgeYears(child.bornAt,at);
 return typeof at==='number'&&Number.isFinite(at)&&at>=start&&at<=w.minute&&at<offer.expiresAt&&
  age!==null&&age>=6&&age<18;
}

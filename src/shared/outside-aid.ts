import {ordinaryVisitorJourney} from './visitor-journey.js';
import type {Inventory,Item,Vec,Resident,World} from './types.js';
import type {CargoRoute} from './foreign-trade.js';
export type OutsideAidAction={type:'outsideAid';operation:'post'|'withdraw'|'accept'|'decline'|'dispatch'|'cancel'|'collect'|'carryMail'|'continueMail'|'returnMail'|'eatMail'|'restMail';journeyId?:string;noticeId?:string;deliveryId?:string;item?:Item;quantity?:number};
/** A request reports only its author's need, never an omniscient town census. */
export interface AidNotice {id:string;requesterId:string;requesterName:string;at:Vec;knownPeople:number;need:'food';postedAt:number;expiresAt:number;withdrawnAt:number|null;eventIds:string[];mail:null|{carrierKind?:'freight'|'visitor';journeyId?:string;courierId:string;merchantId:string;pickedAt:number;receivedAt:number|null;reply:'accepted'|'declined'|null};}
export interface AidDelivery {id:string;noticeId:string;merchantId:string;residentId:string;item:Item;quantity:number;inventory:Inventory;status:'reserved'|'travelling'|'arrived'|'returning'|'returned'|'collected';createdAt:number;departedAt:number|null;arrivedAt:number|null;collectedAt:number|null;collectedQuantity:number|null;stationAt:Vec;route?:CargoRoute;arrivesAt:number|null;blockedSince:number|null;nextCheckAt:number;eventIds:string[];}
export interface VisitorAidJourney {needsAt?:number;pause?:{kind:'eat'|'rest';item?:Item;remaining:number};id:string;personId:string;merchantId:string;noticeId:string;origin:string;duration:number;progress:number;direction:'outbound'|'return';status:'travelling'|'waiting'|'delivered'|'returned'|'interrupted';reason:string|null;leftAt:number;updatedAt:number;endedAt:number|null;eventIds:string[];}
export interface OutsideAidState {visitorJourneys?:VisitorAidJourney[];notices:AidNotice[];deliveries:AidDelivery[];nextSerial:number;}

/** A committed walk or self-care pause is not a technical wait for a new choice. */
export function regionalDecisionWait(w:World,r:Resident):boolean{const j=ordinaryVisitorJourney(w,r);return r.residency==='outside'&&(!!j&&j.status==='waiting'&&!j.pause&&!j.family?.ready||!!w.outsideAid?.visitorJourneys?.some(j=>j.personId===r.id&&j.status==='waiting'&&!j.pause));}

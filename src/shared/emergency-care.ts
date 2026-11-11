import type {Inventory,PersonObservation,Vec} from './types.js';
/** A finite permission to give one's own food, never custody, housing or public spending. */
export interface EmergencyCareAction {
 type:'emergencyCare';operation:'offer'|'accept'|'review'|'withdraw'|'feed'|'inspect'|'rescueMeal'|'requestHelp'|'postHelp'|'readHelp'|'withdrawHelp'|'visitHelp'|'sendHelp'|'travelHelp'|'declineHelp';
 childId?:string;reviewerId?:string;agreementId?:string;noticeId?:string;step?:number;
}
export interface EmergencyCareAgreement {
 id:string;providerId:string;childId:string;reviewerId:string;guardianIds:string[];
 location:PersonObservation;createdAt:number;expiresAt:number;reviewedAt:number|null;acceptedAt:number|null;
 mealLimit:number;meals:number;status:'offered'|'active'|'withdrawn'|'expired'|'invalid'|'completed';
 endedAt:number|null;reason:string|null;endKnownBy:string[];
 evidence:Array<{personId:string;at:number;facts:string[]}>;
 receipts:Array<{id:string;at:number;providerId:string;resources:Inventory;nutrition:number;eventId:string}>;
}
/** A historical message, not a care mandate or live tracking record. */
export interface ChildHelpNotice {
 id:string;reporterId:string;reporterName:string;childId:string;childName:string;
 location:PersonObservation;boardAt:Vec;evidence:string[];createdAt:number;expiresAt:number;
 postedAt:number|null;withdrawnAt:number|null;withdrawnBy:string|null;eventIds:string[];
 readers:Array<{personId:string;readAt:number;withdrawnAt:number|null;visitAt:number|null;outsideReceipt?:{shipmentId:string;origin:string};reply?:{choice:'visit'|'decline';at:number}}>;
 /** A separately entrusted paper. Transport history never renews its original deadline. */
 outbound?:{requestedAt:number;attempts:Array<{shipmentId:string;origin:string;pickedAt:number;arrivedAt:number|null;returnedAt:number|null;recipientId:string|null;status:'carried'|'delivered'|'unreceived'|'returned'}>};
}
export interface EmergencyCareState {
 nextSerial:number;agreements:EmergencyCareAgreement[];
 nextHelpSerial?:number;helpNotices?:ChildHelpNotice[];
}

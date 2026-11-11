import type {Action,Item,PersonObservation} from './types.js';
/** Frozen at the actual offer choice, never widened on a birthday. Missing = adult-only v1. */
export interface PersonalFoodGiftAgeTerms {
 version:2;decidedAt:number;giverBornAt:number;recipientBornAt:number;maxQuantity:1|3;
}
/** A finite gift of personal carried food. Never a care, feeding or public-stock mandate. */
export type PersonalFoodGiftAction=
 | {type:'personalFoodGift';operation:'offer';recipientId:string;item:Item;quantity:number;receiptId:string;ageTerms?:PersonalFoodGiftAgeTerms}
 | {type:'personalFoodGift';operation:'accept'|'deliver'|'cancel'|'decline';giftId:string};
export type PersonalFoodGiftStatus='offered'|'accepted'|'delivered'|'cancelled'|'declined'|'expired'|'invalid';
export interface PersonalFoodGift {
 id:string;giverId:string;recipientId:string;item:Item;quantity:number;receiptId:string;
 ageTerms?:PersonalFoodGiftAgeTerms;
 offeredAt:number;expiresAt:number;acceptedAt:number|null;location:PersonObservation;
 status:PersonalFoodGiftStatus;knownStatus:Record<string,PersonalFoodGiftStatus>;
 endedAt:number|null;reason:string|null;eventIds:string[];
}
export interface PersonalFoodGifts {nextSerial:number;gifts:PersonalFoodGift[];}
export const isPersonalFoodGiftStop=(a:Action):a is PersonalFoodGiftAction & {operation:'cancel'|'decline'}=>a.type==='personalFoodGift'&&(a.operation==='cancel'||a.operation==='decline');

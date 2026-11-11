import type {Vec} from './types.js';

/** A sale refers to one existing private parcel, never a new or finite commons grant. */
export interface PrivateLandParcel {x:number;y:number;width:number;height:number;ownerId:string;}
export interface PrivateLandSale {
 id:string;parcelIndex:number;parcel:PrivateLandParcel;access:Vec;sellerId:string;buyerId:string;price:number;
 offeredAt:number;expiresAt:number;endedAt:number|null;
 status:'offered'|'sold'|'cancelled'|'declined'|'expired'|'invalid';
 knownStatus:Record<string,PrivateLandSale['status']>;eventIds:string[];reason:string|null;
}
export interface PrivateLandTransfers {nextSerial:number;sales:PrivateLandSale[];}

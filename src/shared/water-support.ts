import type {Action} from './types.js';
export type WaterSupportAction={type:'waterSupply';receiptId:string}&(
 | {operation:'authorizeAssist';targetId:string}
 | {operation:'revokeAssist';authorizationId:string}
 | {operation:'assistDrink';authorizationId:string;vesselId:string}
 | {operation:'offerVessel';targetId:string;vesselId:string}
 | {operation:'acceptVessel'|'declineVessel'|'cancelVessel';giftId:string}
);
export interface WaterAssistanceAuthorization {
 id:string;beneficiaryId:string;providerId:string;createdAt:number;expiresAt:number;limit:2;used:number;revokedAt:number|null;revokedBy:string|null;
 /** Each party can record its own stop without learning a distant party's earlier decision. */
 stops?:{personId:string;at:number}[];
}
export interface WaterVesselGift {
 id:string;donorId:string;recipientId:string;vesselId:string;amount:number;quality:'safe'|'raw';createdAt:number;expiresAt:number;
 status:'offered'|'accepted'|'declined'|'cancelled';endedAt:number|null;
 stops?:{personId:string;at:number}[];
}
export function isWaterSupportAction(a:Action):a is WaterSupportAction{return a.type==='waterSupply'&&['authorizeAssist','revokeAssist','assistDrink','offerVessel','acceptVessel','declineVessel','cancelVessel'].includes(a.operation);}
/** Withdrawal changes only the actor's own pending permission, never physical transport or stock. */
export function isWaterSupportWithdrawal(a:Action){return a.type==='waterSupply'&&['revokeAssist','declineVessel','cancelVessel'].includes(a.operation);}

import type {Action} from './types.js';
/** In-world wishes only. A witness never becomes an executor or acquires assets. */
export interface LastWishAction {
 type:'lastWish';operation:'declare'|'witness'|'declineWitness'|'revoke'|'read'|'approveGift'|'refuseGift'|'acceptGift'|'declineGift';
 wishId?:string;buildingId?:string;witnessId?:string;beneficiaryId?:string;amount?:number;graveId?:string;text?:string;
}
export interface LastWish {
 id:string;personId:string;witnessId:string;buildingId:string;beneficiaryId:string|null;amount:number;graveId:string|null;epitaph:string;
 createdAt:number;expiresAt:number;signedAt:number|null;status:'draft'|'active'|'revoked'|'declined'|'expired'|'superseded';
 stops?:Record<string,number>;readers:Record<string,number>;readHeirs?:Record<string,string[]>;knownGiftStatus?:Record<string,LastWish['gift']['status']>;approvals:Record<string,number>;eventIds:string[];
 gift:{status:'pending'|'paid'|'declined'|'unfulfilled';amount:number;at:number|null;reason:string|null};
 burial?:{at:number;actorId:string;graveId:string;followed:boolean;reason:string};
}
export interface LastWishesState {records:LastWish[];nextSerial:number;}

export function isLastWishWithdrawal(a:Action):a is LastWishAction {return a.type==='lastWish'&&['revoke','declineWitness','refuseGift','declineGift'].includes(a.operation);}

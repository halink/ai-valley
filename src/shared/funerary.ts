import type {Vec} from './types.js';
export interface FuneraryAction {type:'funerary';operation:'store'|'notify'|'verify'|'maintain'|'epitaph'|'visit'|'registerDeath'|'readDeathRecord';targetId?:string;buildingId?:string;recipientId?:string;graveId?:string;text?:string;}
export interface DeathNotice {id:string;reporterId:string;recipientId:string;personId:string;sourceEventId:string;eventId:string;deliveredAt:number;claimedAt:Vec;claimedRoomId:string|null;}
export interface DeathCertificate {personId:string;registrarId:string;buildingId:string;proofEventId:string;registeredAt:number;registrationEventId:string;location:{at:Vec;roomId:string|null;roomAt?:Vec|null;atMinute:number;eventId:string}|null;}
export interface FuneraryState {certificates?:DeathCertificate[];notices:DeathNotice[];nextSerial:number;lastMinute:number;totals:{stored:number;notified:number;maintained:number;visits:number};}

import type {Action,Vec} from './types.js';
/** A two-adult, once-only public rendezvous, separate from a live group discussion. */
export type SocialAppointmentAction=
 | {type:'socialAppointment';operation:'offer';personId:string;buildingId:string;startsIn:number;windowMinutes:number;receiptId:string}
 | {type:'socialAppointment';operation:'accept'|'decline'|'withdraw'|'attend';appointmentId:string}
 | {type:'socialAppointment';operation:'wait';appointmentId:string;minutes:number};
export type AppointmentKnowledge='offered'|'accepted'|'declined'|'withdrawn'|'met';
export interface AppointmentVisit {personId:string;arrivedAt:number;leftAt:number|null;waitedMinutes:number;}
export interface SocialAppointment {
 id:string;proposerId:string;personId:string;buildingId:string;place:Vec;placeName:string;
 offeredAt:number;start:number;end:number;receiptId:string;births:[number,number];names:[string,string];
 acceptedAt:number|null;endedAt:number|null;status:'offered'|'accepted'|'declined'|'withdrawn'|'met'|'elapsed';
 known:Record<string,AppointmentKnowledge>;visits:AppointmentVisit[];metAt:number|null;eventIds:string[];
}
export interface SocialAppointments {nextSerial:number;records:SocialAppointment[];}
export const isSocialAppointmentStop=(a:Action):a is SocialAppointmentAction & {operation:'decline'|'withdraw'}=>a.type==='socialAppointment'&&(a.operation==='decline'||a.operation==='withdraw');

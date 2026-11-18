/** Limited MVP canning, independent of the formal food/industry bootstrap. */
export type PreservationAction={type:'mvpPreservation';operation:'install'|'preserve'};
export interface PreservationLot {id:string;producedAt:number;expiresAt:number;quantity:number;removed:number;spoiled:number;}
export interface PreservationAccount {unknown:number;lots:PreservationLot[];}
export interface MvpPreservation {
 schemaVersion:1;adoptedAt:number;lastMinute:number;nextSequence:number;
 installed:null|{executionId:string;actorId:string;at:number;eventId:string};
 accounts:Record<string,PreservationAccount>;
 attempts:Record<string,{actorId:string;operation:'install'|'preserve';at:number}>;
 receipts:Record<string,{actorId:string;operation:'install'|'preserve';at:number;workMinutes:number;eventId:string}>;
}
export const PRESERVATION_WORK={install:120,preserve:60} as const;
export const PRESERVATION_COST={install:{wood:6,stone:6},preserve:{fruit:2,water:1,wood:1}} as const;
export const PRESERVATION_LIFE=56*1440;

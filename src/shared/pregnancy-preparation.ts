import type {Action,Vec} from './types.js';
export type PregnancyPreparationAction={type:'pregnancyPreparation';receiptId:string}&(
 | {operation:'prepare';buildingId:string;providerId:string|null}
 | {operation:'accept'|'decline'|'withdraw'|'deliverMeal'|'attend';arrangementId:string}
);
export interface PregnancyPreparation {
 id:string;gestatorId:string;conceivedAt:number;dueAt:number;buildingId:string;bed:number;door:Vec;providerId:string|null;
 createdAt:number;expiresAt:number;acceptedAt:number|null;stops:{personId:string;at:number}[];
 deliveredMeals:number;restMinutes:number;attendanceMinutes:number;lastAttendedAt:number|null;eventIds:string[];
 birth:null|{at:number;childId:string;actualBuildingId:string|null;atPlannedBed:boolean;providerPresent:boolean};
}
export interface PregnancyPreparationState {arrangements:PregnancyPreparation[];receipts:{id:string;actorId:string;at:number;operation:PregnancyPreparationAction['operation']}[];}
export function isPregnancyWithdrawal(a:Action):a is Extract<PregnancyPreparationAction,{arrangementId:string}>&{operation:'withdraw'|'decline'} {return a.type==='pregnancyPreparation'&&(a.operation==='withdraw'||a.operation==='decline');}

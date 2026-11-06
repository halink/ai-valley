import type {Inventory,Item} from './types.js';

/** Public decisions and their finite mandates, separate from anybody's personal purse. */
export type CivicMeasure =
 | {kind:'fixtureRemoval';buildingId:string;stationId:string;wage:number;durationDays:number}
 | {kind:'salesTax';basisPoints:number;durationDays:number}
 | {kind:'careSupport';buildingId:string;agreementId:string;amount:number;durationDays:number}
 | {kind:'pension';buildingId:string;beneficiaryId:string;amountPerDay:number;durationDays:number}
 | {kind:'education';buildingId:string;lessonId:string;amount:number;durationDays:number}
 | {kind:'construction';buildingId:string;projectId:string;amount:number;durationDays:number}
 | {kind:'service';buildingId:string;wagePerService:number;wageBudget:number;suppliesBudget:number;durationDays:number;prices?:Inventory}
 | {kind:'repair';buildingId:string;wage:number;suppliesBudget:number;durationDays:number;prices?:Inventory};
export type CivicAction =
 | {type:'civic';operation:'donate';buildingId:string;amount:number}
 | {type:'civic';operation:'propose';buildingId:string;measure:CivicMeasure}
 | {type:'civic';operation:'vote';proposalId:string;accept:boolean}
 | {type:'civic';operation:'supply';budgetId:string;item:Item;quantity:number}
 | {type:'civic';operation:'repair';budgetId:string};
export interface CivicProposal {
 id:string;proposerId:string;buildingId:string;createdAt:number;closesAt:number;
 electorate:string[];votes:Record<string,boolean>;measure:CivicMeasure;
 status:'open'|'approved'|'rejected'|'unfunded';decidedAt:number|null;budgetId:string|null;
 executionError?:string;
}
export interface CivicBudget {
 id:string;proposalId:string;buildingId:string;kind:'service'|'repair';
 startsAt:number;expiresAt:number;status:'active'|'expired'|'completed';
 wage:number;wageLimit:number;suppliesLimit:number;paidWages:number;spentSupplies:number;
 wageAccount:string;supplyAccount:string;prices:Inventory;purchased:Inventory;
 repairWorkerId?:string;
}
export interface CivicState {
 proposals:CivicProposal[];budgets:CivicBudget[];
 /** Physical public stores by building; these sum to economy.treasuryStock. */
 stores:Record<string,Inventory>;
 salesTax:{basisPoints:number;expiresAt:number;proposalId:string}|null;
 nextSerial:number;
 totals:{donations:number;wages:number;procurement:number;repairs:number};
}

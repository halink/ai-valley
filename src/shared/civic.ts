import type {Inventory,Item} from './types.js';

/** Public decisions and their finite mandates, separate from anybody's personal purse. */
export interface PublicProcurementMandate {merchantId:string;handlerId:string;}
export type CivicMeasure =
 | {kind:'foodReserve';foreignProcurement?:PublicProcurementMandate;buildingId:string;item:Item;quantity:number;unitPrice:number;suppliesBudget:number;dailyNutrition:number;durationDays:number}
 | {kind:'fixtureRemoval';buildingId:string;stationId:string;wage:number;durationDays:number}
 | {kind:'salesTax';basisPoints:number;durationDays:number}
 | {kind:'careSupport';buildingId:string;agreementId:string;amount:number;durationDays:number}
 | {kind:'pension';buildingId:string;beneficiaryId:string;amountPerDay:number;durationDays:number}
 | {kind:'education';buildingId:string;lessonId:string;amount:number;durationDays:number}
 | {kind:'construction';buildingId:string;projectId:string;amount:number;durationDays:number}
 | {kind:'service';buildingId:string;wagePerService:number;wageBudget:number;suppliesBudget:number;durationDays:number;prices?:Inventory}
 | {kind:'repair';buildingId:string;wage:number;suppliesBudget:number;durationDays:number;prices?:Inventory};
export type CivicAction =
 | {type:'civic';operation:'deliverReserve';reserveId:string;shipmentId:string}
 | {type:'civic';operation:'supplyReserve';reserveId:string;quantity:number;receiptId:string}
 | {type:'civic';operation:'openReserve';reserveId:string;quantity:number;receiptId:string}
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
export interface PublicFoodReserve {
 foreignProcurement?:PublicProcurementMandate & {acquired:number;delivered:number};
 id:string;proposalId:string;buildingId:string;item:Item;quantityLimit:number;unitPrice:number;dailyNutrition:number;
 startsAt:number;expiresAt:number;status:'active'|'expired';
 supplyAccount:string;suppliesLimit:number;spent:number;refunded:number;
 /** Independent physical shelf, never available to service/repair or counted twice. */
 inventory:Inventory;stocked:number;purchased:number;opened:number;withdrawn:number;
 receipts:Array<{id:string;personId:string;operation:'supplyReserve'|'openReserve'|'deliverReserve';quantity:number;coins:number;at:number}>;
}
export interface CivicState {
 proposals:CivicProposal[];budgets:CivicBudget[];reserves?:PublicFoodReserve[];
 /** Uncommitted/service public stores by building; these plus reserve shelves sum to economy.treasuryStock. */
 stores:Record<string,Inventory>;
 salesTax:{basisPoints:number;expiresAt:number;proposalId:string}|null;
 nextSerial:number;
 totals:{donations:number;wages:number;procurement:number;repairs:number};
}

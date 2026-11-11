import type {EmploymentTerms} from './employment.js';
import type {World} from './types.js';

export interface BusinessRelocationAction {
 type:'businessRelocation'; operation:'propose'|'review'|'accept'|'decline'|'revoke'|'begin'|'finish'|'cancel';
 businessId?:string; fromBuildingId?:string; toBuildingId?:string; relocationId?:string; contractId?:string;
}
export interface RelocationEmployee {
 contractId:string; workerId:string; terms:EmploymentTerms; startDay:number; endDay:number;
 recipeDefinition?:string; account:string;
 reviewedAt:number|null; acceptedAt:number|null; declinedAt:number|null;
}
export interface BusinessRelocation {
 id:string; businessId:string; ownerId:string; fromBuildingId:string; toBuildingId:string;
 destinationOwnerId:string; destinationLeaseId:string|null;
 proposedAt:number; expiresAt:number; beganAt:number|null; endedAt:number|null;
 status:'preparing'|'moving'|'completed'|'cancelled'; reason:string|null;
 employees:RelocationEmployee[]; transferredContractIds:string[];
}
export function activeBusinessRelocation(w:World,businessId:string){return w.economy?.relocations?.find(m=>m.businessId===businessId&&(m.status==='preparing'||m.status==='moving'));}

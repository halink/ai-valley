import type {Inventory} from './types.js';

export type EmploymentRole='cook'|'seedkeeper'|'carpenter'|'smith'|'miller'|'dairyworker'|'weaver'|'preserver'|'herbalist';
export interface EmploymentTerms {
 role:EmploymentRole;
 /** Coins for one complete daily shift; partial attendance earns a proportional integer amount. */
 wage:number;
 startMinute:number;
 durationMinutes:number;
 days:number;
}
export interface EmploymentAction {
 type:'employment';
 operation:'post'|'apply'|'withdrawApplication'|'select'|'reject'|'accept'|'decline'|'cancelPost'|'work'|'quit'|'dismiss'|'renew';
 businessId?:string;
 postId?:string;
 contractId?:string;
 applicantId?:string;
 terms?:EmploymentTerms;
 minutes?:number;
}
export interface EmploymentApplication {residentId:string;appliedAt:number;status:'pending'|'withdrawn'|'rejected'|'selected'|'declined'|'expired'|'hired';}
export interface EmploymentPost {
 recipeDefinition?:string;recipe?:import('./industry.js').CraftRecipe;
 id:string;businessId:string;employerId:string;buildingId:string;terms:EmploymentTerms;
 postedAt:number;expiresAt:number;status:'open'|'offered'|'filled'|'closed';
 applications:EmploymentApplication[];
 offer:null|{workerId:string;offeredAt:number;expiresAt:number;account:string;serial:number;notifiedAt?:number};
 offerSerial:number;renewalOf?:string;
}
export interface EmploymentDay {
 day:number;worked:number;paid:number;produced:number;firstArrival:number|null;lastWork:number|null;
}
export interface EmploymentContract {endKnownBy?:string[];
 recipeDefinition?:string;recipe?:import('./industry.js').CraftRecipe;
 id:string;postId:string;businessId:string;employerId:string;workerId:string;buildingId:string;
 terms:EmploymentTerms;acceptedAt:number;startDay:number;endDay:number;
 account:string;reserved:number;paid:number;refunded:number;
 status:'active'|'completed'|'quit'|'dismissed'|'ended';endedAt:number|null;reason:string|null;
 attendance:EmploymentDay[];
 batch:null|{inventory:Inventory;progress:number;minutes:number;output:Inventory};
}
export interface EmploymentState {
 posts:EmploymentPost[];contracts:EmploymentContract[];nextSerial:number;
 totals:{paid:number;worked:number;produced:number;hired:number};
}

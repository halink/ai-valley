import type {Inventory,Vec} from './types.js';
export interface BuildingMigrationAction {type:'buildingMigration';operation:'propose'|'review'|'revoke'|'begin'|'accept'|'decline'|'work'|'cancel'|'collect';migrationId?:string;buildingId?:string;roof?:'wood'|'slate';minutes?:number;}
export interface ResidentUpgradeProposal {
 proposerId:string; stockAt:Vec; roof:'wood'|'slate'; rights:string; definitions:string; reason:string|null; consumed:Inventory;
 parties:Array<{residentId:string;roles:string[];reviewedAt:number|null;acceptedAt:number|null}>;
}
export interface BuildingUpgrade {residentProposal?:ResidentUpgradeProposal;id:string;buildingId:string;from:string;to:string;ownerId:string;offeredAt:number;expiresAt:number;acceptedAt:number|null;completedAt:number|null;status:'offered'|'accepted'|'declined'|'cancelled'|'expired'|'completed';charge:Inventory;refund:Inventory;stock:Inventory;minutes:number;worked:number;lastAt:number;}

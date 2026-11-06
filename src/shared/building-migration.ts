import type {Inventory} from './types.js';
export interface BuildingMigrationAction {type:'buildingMigration';operation:'accept'|'decline'|'work'|'cancel'|'collect';migrationId:string;minutes?:number;}
export interface BuildingUpgrade {id:string;buildingId:string;from:string;to:string;ownerId:string;offeredAt:number;expiresAt:number;acceptedAt:number|null;completedAt:number|null;status:'offered'|'accepted'|'declined'|'cancelled'|'expired'|'completed';charge:Inventory;refund:Inventory;stock:Inventory;minutes:number;worked:number;lastAt:number;}

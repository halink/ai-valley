import type {Building,BuildingKind,Inventory,Vec} from './types.js';

export type ConstructionKind=BuildingKind|import('./infrastructure.js').InfrastructureKind;
export interface ConstructionAction {
 type:'construction';
 operation:'propose'|'expand'|'convert'|'repairInfrastructure'|'fund'|'donateMaterials'|'supply'|'apply'|'withdraw'|'hire'|'reject'|'accept'|'decline'|'quit'|'release'|'work'|'pause'|'resume'|'cancel'|'collect'|'dismantle';
 assetId?:string;end?:Vec;projectId?:string;buildingId?:string;kind?:ConstructionKind;at?:Vec;scope?:'private'|'public';definition?:string;
 name?:string;wagePerHour?:number;prices?:Inventory;amount?:number;item?:'wood'|'stone';quantity?:number;
 applicantId?:string;minutes?:number;quotedPrice?:number;stage?:number;
 direction?:'north'|'east'|'west'|'south';
}
export interface ConstructionStage {
 name:string;materials:Inventory;minutes:number;worked:number;startedAt:number|null;finishedAt:number|null;
}
export interface ConstructionGrant {source:string;amount:number;remaining:number;refunded:number;}
export interface ConstructionMaterial {source:string;item:'wood'|'stone';quantity:number;}
export interface ConstructionWorker {
 id:string;workerId:string;status:'offered'|'active'|'declined'|'quit'|'released'|'finished'|'expired';
 account:string;offeredAt:number;expiresAt:number;notifiedAt:number|null;acceptedAt:number|null;
 wagePerHour:number;reserved:number;worked:number;paid:number;refunded:number;
}
export interface ConstructionProject {
 landRightId?:string;
 id:string;name:string;mode:'new'|'expansion'|'conversion'|'terrain';ownerId:string;managerId:string;kind:ConstructionKind;
 terrain?:import('./infrastructure.js').TerrainWork;
 definition:string;ruleVersion:number;at:Vec;width:number;height:number;door:Vec;
 base:Building|null;capacity:number;buildingId:string|null;boardId:string|null;
 createdAt:number;updatedAt:number;finishedAt:number|null;authorizedUntil:number|null;
 status:'proposed'|'planned'|'active'|'paused'|'abandoned'|'cancelled'|'completed'|'removed';
 reserved:boolean;reason:string|null;
 stages:ConstructionStage[];stage:number;incorporated:Inventory;stock:ConstructionMaterial[];
 claims:ConstructionMaterial[];grants:ConstructionGrant[];account:string;
 wagePerHour:number;prices:Inventory;spentWages:number;spentSupplies:number;
 applications:Array<{workerId:string;at:number;status:'pending'|'withdrawn'|'rejected'|'selected'|'declined'|'hired'}>;
 workers:ConstructionWorker[];nextWorker:number;
 labor:Array<{workerId:string;minutes:number;lastAt:number}>;
 demolitionMinutes:number;lastDemolitionAt:number|null;
}
export interface ConstructionState {
 projects:ConstructionProject[];nextSerial:number;
 /** Existing houses keep a narrow registered yard; existing roads, crops and other rights prevail. */
 yards:Record<string,{x:number;y:number;width:number;height:number}>;
 knownProjects:Record<string,string[]>;
 totals:{converted?:number;completed:number;expanded:number;labor:number;wages:number;procurement:number;demolished:number};
}

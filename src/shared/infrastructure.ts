import type {Tile,Vec,Inventory} from './types.js';
export const infrastructureNames={road:'铺设道路',bridge:'跨水桥梁',dock:'水岸码头',cemetery:'墓园扩建'} as const;
export type InfrastructureKind='road'|'bridge'|'dock'|'cemetery';
export interface TerrainWork {kind:InfrastructureKind;anchors:Vec[];tiles:Array<{at:Vec;before:Tile;after:Tile}>;graves:Vec[];repairOf:string|null;}
export interface InfrastructureAsset {lastHazardDamage?:{disasterId:string;eventId:string};id:string;name:string;projectId:string;kind:InfrastructureKind;definition:string;at:Vec;width:number;height:number;access:Vec;anchors:Vec[];tiles:TerrainWork['tiles'];graveIds:string[];condition:number;lastDay:number;createdAt:number;retiredAt:number|null;cost:Inventory;minutes:number;}
export interface InfrastructureState {assets:InfrastructureAsset[];lastDay:number;totals:{roads:number;bridges:number;docks:number;cemeteries:number;repairs:number};}

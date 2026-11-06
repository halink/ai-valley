import type {Inventory, Vec} from './types.js';

export interface ProductionAction {
  type:'production';
  operation:'saveSeed'|'plantCrop'|'clearPlot'|'claimPlot'|'repair'|'inherit'|'collectEstate'|'collectManure'|'fertilize';
  plotId?:string;
  cropId?:string;
  buildingId?:string;
  personId?:string;
  parcelId?:string;
  heapId?:string;
  at?:Vec;
}
export interface InheritanceShare {
  goodsClaims?:string[];
  creditClaims?:string[];
  id:string;
  heirId:string;
  inventory:Inventory;
  coins:number;
  plots:string[];
  buildings:string[];
  parcels:number[];
  industryAssets?:string[];
  claimedAt:number|null;
}
export interface ProductionState {
  lastMinute:number;
  lastDay:number;
  ecology:Record<string,{progress:number}>;
  inheritances:Record<string,{createdAt:number;shares:InheritanceShare[]}>;
  knownDeaths:Record<string,string[]>;
  lastEventRevision:number;
  parcelOwners:Record<number,string>;
  seedSaved:number;
  reclaimedPlots:number;
  repairs:number;
  nutrients?:FrontierNutrients;
}

export interface ManureHeap {id:string;at:Vec;ownerId:string;units:number;updatedAt:number;}
export interface FrontierNutrients {
 lastDay:number;
 digestion:Record<string,{remaining:number;readyAt:number}>;
 heaps:ManureHeap[];
 soil:Record<string,number>;
 deposited:number;
 collected:number;
 fertilized:number;
 harvested:number;
}

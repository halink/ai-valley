import type {Inventory, Item, Vec} from './types.js';

export interface ProductionAction {
  type:'production';
  operation:'saveSeed'|'plantCrop'|'clearPlot'|'claimPlot'|'repair'|'inherit'|'collectEstate'|'emergencyEstateRation'|'collectManure'|'fertilize'|'custodyOffer'|'custodyAccept'|'custodyReview'|'custodyObject'|'custodyEnd'|'custodyWater'|'custodyHarvest'|'custodyRepair'|'custodyFeedAnimal'|'custodyWaterAnimal'|'custodyCollectAnimal'|'custodySell'|'custodyBuy'|'custodyInspect';
  custodyId?:string;
  custodyAssetId?:string;
  custodyStep?:number;
  targetId?:string;
  reviewerId?:string;
  guardianIds?:string[];
  scope?:ProtectedCustodyScope;
  days?:number;
  expenseCap?:number;
  saleCap?:number;
  animalId?:string;
  saleId?:string;
  item?:Item;
  quantity?:number;
  maxTotal?:number;
  plotId?:string;
  cropId?:string;
  buildingId?:string;
  personId?:string;
  parcelId?:string;
  rationId?:string;
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
  protectedCustody?:ProtectedCustodyState;
  /** One cumulative emergency allowance per child, never reset by a day or restart. */
  emergencyFood?:Record<string,{limit:number;nutrition:number;receipts:Array<{id:string;at:number;estateId:string;parcelId:string;inventory:Inventory;nutrition:number}>}>;
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

/** This mandate grants work and bounded sales only, never guardianship or title. */
export interface ProtectedCustodyScope {plots:string[];buildings:string[];animals:string[];}
export interface ProtectedCustodyRecord {
 id:string;at:number;actorId:string;operation:ProductionAction['operation'];
 materials:Inventory;goods:Inventory;coins:number;targetId:string;
}
export interface ProtectedCustodyMandate {
 id:string;estateId:string;childId:string;providerId:string;reviewerId:string;
 guardianIds:string[];acceptedBy:string[];reviewedAt:number|null;
 createdAt:number;expiresAt:number;offerExpiresAt:number;scope:ProtectedCustodyScope;
 expenseCap:number;saleCap:number;spent:number;sold:number;revenue:number;workSerial:number;
 locations:Record<string,{at:Vec;inside:string|null;roomAt:Vec|null;label?:string}>;
 status:'offered'|'active'|'objected'|'ended'|'expired'|'adult'|'invalid';
 endedAt:number|null;reason:string|null;endKnownBy:string[];shareId:string|null;records:ProtectedCustodyRecord[];
 handback?:{at:number;coins:number;parcelIds:string[]};
}
export interface ProtectedCustodySale {
 id:string;custodyId:string;parcelId:string;item:Item;quantity:number;unitPrice:number;
 createdAt:number;expiresAt:number;status:'offered'|'sold'|'cancelled';buyerId:string|null;
}
export interface ProtectedCustodyState {nextSerial:number;mandates:ProtectedCustodyMandate[];sales:ProtectedCustodySale[];}

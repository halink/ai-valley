import type {Item} from './types.js';

/** A read-only nutritional estimate, not a promise to obtain or eat the food. */
export interface ReachableFoodLot {
  containerId:string;
  item:Item;
  lotIndex:number;
  /** Beginning of this entitlement within the original physical lot. */
  offset:number;
  quantity:number;
  nutrition:number;
  availableAt:number;
  expiresAt:number;
}
export interface ResidentFoodCoverage {
  residentId:string;
  dailyNeed:number;
  carriedNutrition:number;
  reachableNutrition:number;
  usableNutrition:number;
  days:number;
  lowFood:boolean;
  needsCare:boolean;
  accessBlocked?:'medicalTransport';
  unknownExpiry:boolean;
  sourceLabel:string|null;
  collectionMinutes:number|null;
  lots:ReachableFoodLot[];
}
export interface SettlementFoodCoverage {
  residents:ResidentFoodCoverage[];
  /** Union of physical lots, not the sum of overlapping personal estimates. */
  uniqueNutrition:number;
  dailyNeed:number;
  /** Collective stock equivalent only. It does not authorize sharing. */
  stockDays:number;
}

import type {Inventory,Item} from './types.js';

/** Personal observations only, not an authoritative batch or food ledger. */
export interface PersonalFoodProcessing {
 residentId:string;
 atMinute:number;
 rawIngredients:Item[];
 current:null|{
  batchId:string;buildingId:string;buildingName:string;recipeId:string;recipeName:string;
  required:Inventory|null;reserved:Inventory|null;output:Inventory|null;
  worked:number|null;minutes:number|null;remaining:number|null;
 };
}

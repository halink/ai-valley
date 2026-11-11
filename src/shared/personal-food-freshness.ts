import type {Item} from './types.js';

/** Carried stock only. No container identifiers or remote stock enter this view. */
export interface PersonalFoodFreshnessItem {
 item:Item;
 quantity:number;
 expiredQuantity:number;
 unknownQuantity:number;
 earliest:{expiresAt:number;quantity:number;nutrition:number|null}|null;
 later:{quantity:number;nutrition:number|null};
}
export interface PersonalFoodFreshness {
 residentId:string;
 atMinute:number;
 items:PersonalFoodFreshnessItem[];
}

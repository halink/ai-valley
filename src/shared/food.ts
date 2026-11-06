import type {Item} from './types.js';
export interface FoodLot {quantity:number;producedAt:number;expiresAt:number;definition:string;}
export interface FoodState {registeredAt:number;lots:Record<string,Partial<Record<Item,FoodLot[]>>>;spoiled:Partial<Record<Item,number>>;lastMinute:number;}

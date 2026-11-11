import type {Vec} from './types.js';

/** An immutable first personal sighting of an address, never a stock report. */
export interface FoodSourceSight {resourceId:string;at:Vec;observedAt:number;}
export interface FoodSourceClue extends FoodSourceSight {
 speakerId:string;speakerName:string;receivedAt:number;eventId:string;
}
export interface FoodSourceKnowledge {
 seen:Record<string,FoodSourceSight>;
 heard:FoodSourceClue[];
 shared:Array<{receiptId:string;targetId:string;resourceId:string;eventId:string}>;
}
export interface ShareFoodSourceAction {
 type:'shareFoodSource';targetId:string;source:FoodSourceSight;receiptId:string;
}

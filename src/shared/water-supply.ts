import type {Vec} from './types.js';
/** Supply-only rollout. There is deliberately no thirst meter or dehydration rule. */
export type WaterSupplyAction = import('./water-support.js').WaterSupportAction | {type:'waterSupply';receiptId:string} & (
 | {operation:'craft';buildingId:string}
 | {operation:'survey';at:Vec}
 | {operation:'fillSpring';vesselId:string;sourceId:string;quantity:number}
 | {operation:'fillSurface';vesselId:string;sourceId:string;quantity:number}
 | {operation:'load';vesselId:string;quantity:number}
 | {operation:'boil';vesselId:string;buildingId:string}
 | {operation:'decant'|'drink';vesselId:string}
 | {operation:'serveChild';vesselId:string;targetId:string}
 | {operation:'donate';vesselId:string;buildingId:string}
 | {operation:'refillPublic';vesselId:string;publicVesselId:string;buildingId:string;quantity:number}
 | {operation:'drinkPublic';vesselId:string;buildingId:string}
);
export interface WaterVessel {
 id:string;ownerId:string;buildingId:string|null;capacity:6;amount:number;quality:'safe'|'raw';createdAt:number;
 /** Public access is conferred by this owner's actual donation, not by nearby treasury stock. */
 donatedBy?:string;donatedAt?:number;
}
export interface SurfaceWaterSource {id:string;at:Vec;initial:24;amount:number;surveyedAt:number;surveyedBy:string;}
export interface WaterSupplyReceipt {action:WaterSupplyAction;id:string;actorId:string;recipientId?:string;at:number;operation:WaterSupplyAction['operation'];quantity:number;vesselId?:string;sourceId?:string;buildingId?:string;}
export interface WaterSupplyState {version:1;adoptedAt:number;geography:Array<{width:number;height:number}>;assistance?:import('./water-support.js').WaterAssistanceAuthorization[];gifts?:import('./water-support.js').WaterVesselGift[];vessels:WaterVessel[];surfaceSources:SurfaceWaterSource[];receipts:WaterSupplyReceipt[];}

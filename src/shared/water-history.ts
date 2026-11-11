import type {WaterSupplyAction,WaterVessel} from './water-supply.js';

/** Completion-time observations only. Never reconstruct these from today's inventory. */
export type WaterVesselSnapshot=Pick<WaterVessel,'ownerId'|'buildingId'|'capacity'|'amount'|'quality'>;
export interface WaterSupplyFact {
 version:1;
 receiptId:string;
 operation:WaterSupplyAction['operation'];
 actorId:string;
 /** Only a person who actually drank, not a proposed recipient or a bucket recipient. */
 recipientId?:string;
 counterpartyId?:string;
 quantity:number;
 vessels:Array<{id:string;before:WaterVesselSnapshot|null;after:WaterVesselSnapshot|null}>;
 inventory:Array<{personId:string;item:'wood'|'water';before:number;after:number}>;
 source?:{id:string;kind:'spring'|'surface';before:number|null;after:number|null};
 authorizationId?:string;
 giftId?:string;
}

export const waterOperationNames:Record<WaterSupplyAction['operation'],string>={
 craft:'制作空桶',survey:'登记原水点',fillSpring:'取泉水',fillSurface:'取原水',load:'旧清水装桶',boil:'煮沸净水',decant:'转回旧清水库存',drink:'本人饮用',serveChild:'监护人协助幼儿饮用',donate:'捐赠水桶及安全水',refillPublic:'补入公共水桶',drinkPublic:'饮用公共储备',authorizeAssist:'本人授权有限协助',revokeAssist:'停止有限协助',assistDrink:'本人授权的实际协助饮用',offerVessel:'提出赠桶',acceptVessel:'本人接受实物赠桶',cancelVessel:'撤回赠桶',declineVessel:'拒绝赠桶',
};

import type {Inventory,Item,Resident,Vec} from './types.js';

export type ForeignSide='import'|'export';
export type ForeignRecipe='drawWater'|'gatherWood'|'quarryStone'|'saveSeed'|'cook'|'growRoots'|'fiber'|'fodder'|'feedLivestock'|'waterLivestock';
export interface ForeignAction {
 type:'foreignTrade';animalId?:string;
 /** A freshly voted mandate, bound by the offered choice. */
 reserveId?:string;
 operation:'post'|'propose'|'accept'|'reject'|'cancelOffer'|'dispatch'|'collect'|'cancelShipment'|'produce'|'wait';
 merchantId?:string;offerId?:string;shipmentId?:string;
 side?:ForeignSide;item?:Item;quantity?:number;price?:number;
 minutes?:number;recipe?:ForeignRecipe;
 /** Quote authority is bound by the menu, never supplied or changed by model text. */
 quotedPrice?:number;maximumLevyBasisPoints?:number;
 /** Named existing doorstep or completed public dock; frozen by the offered choice. */
 deliveryId?:string;
}
export type ForeignTradeAction=ForeignAction;
export interface ForeignMerchant {
 id:string;name:string;origin:string;person:Resident;routeMinutes:number;
 resources:Record<'wood'|'stone'|'water',{amount:number;max:number;regrowthDays:number;progress:number}>;
 work:{animalId?:string;recipe:ForeignRecipe;quantity:number;finishesAt:number;output:Inventory}|null;
}
export interface ForeignOffer {
 publicReserveId?:string;
 stationAt?:Vec;deliveryId?:string;
 id:string;merchantId:string;residentId:string|null;initiatedBy:'merchant'|'resident';
 side:ForeignSide;item:Item;quantity:number;remaining:number;price:number;
 createdAt:number;noticeAt:number;expiresAt:number;
 delivered?:boolean;
 merchantKnownRemaining?:number;
 status:'open'|'accepted'|'rejected'|'cancelled'|'expired';
 escrowAccount:string|null;stock:number;
 taxPolicyId:string|null;taxRate:number;
}
export interface ForeignShipment {
 publicReserveId?:string;
 /** Goods stay in the public shipment container, never the handler inventory. */
 publicCarrier?:{at:Vec;inside:string|null;roomAt:Vec|null;sealed:boolean};
 stationAt?:Vec;deliveryId?:string;
 route?:CargoRoute;
 id:string;offerId:string;merchantId:string;residentId:string;side:ForeignSide;
 item:Item;quantity:number;price:number;goods:number;
 status:'ready'|'inTransit'|'returning'|'arrived'|'completed'|'cancelled';
 createdAt:number;readyAt:number;departedAt:number|null;arrivesAt:number|null;
 merchantNoticeAt?:number;merchantNotified?:boolean;deliveryAt?:number;
 blockedSince:number|null;nextCheckAt:number;collectedAt:number|null;
 escrowAccount:string;gross:number;maxTax:number;actualTax:number|null;taxPolicyId:string|null;taxRate:number;
 returned:boolean;
}
export interface CargoRoute {at:Vec|null;phase:'localIn'|'localOut'|'regionalIn'|'regionalOut'|'done';updatedAt:number;dueAt:number;progress:number;}
export interface ForeignTradeState {
 merchants:ForeignMerchant[];offers:ForeignOffer[];shipments:ForeignShipment[];
 station:Vec;knownStationIds:string[];nextSerial:number;lastMinute:number;
 openingCoins:number;
 totals:{imports:number;exports:number;importValue:number;exportValue:number;taxes:number;returned:number};
}

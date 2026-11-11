import type {Inventory, Item} from './types.js';

export interface EconomyAction {
  type:'economy';
  operation:'open'|'fund'|'withdraw'|'stock'|'retrieve'|'list'|'order'|'cancel'|'buy'|'fulfill'|'close';
  businessId?:string; buildingId?:string; listingId?:string;
  item?:Item; quantity?:number; price?:number; amount?:number; name?:string;
  /** Omitted minimumQuantity means exact fill; a lower value explicitly permits a shortage fill. */
  minimumQuantity?:number; maxTotal?:number; minTotal?:number; maximumLevyBasisPoints?:number;
}
export interface Business {
  id:string; ownerId:string; buildingId:string; name:string;
  openedAt:number; closedAt:number|null;
  coins:number; inventory:Inventory; sales:number; revenue:number;
}
/** Listed goods are physically reserved; inventory no longer contains these units. */
export interface MarketListing {
  id:string; businessId:string; item:Item; quantity:number; originalQuantity:number;
  side:'sale'|'purchase'; escrowId?:string; taxBasisPoints?:number;
  price:number; postedAt:number; expiresAt:number;
  status:'open'|'sold'|'cancelled'|'expired';
}
export interface MarketTrade {
  id:string; at:number; actorId:string; businessId:string; listingId:string; buildingId:string;
  operation:'buy'|'fulfill'; item:Item; requestedQuantity:number; minimumQuantity:number;
  quantity:number; unitPrice:number; gross:number; levy:number; maxTotal?:number; minTotal?:number;
}
export interface CoinEntry {id:string;at:number;from:string;to:string;amount:number;reason:string;reference:string;}
export interface EconomyState {
  relocations?:import('./business-relocation.js').BusinessRelocation[];
  leases?:import('./premises.js').PremisesLease[];
  treasury:number; treasuryStock:Inventory; escrows:Record<string,number>;
  businesses:Business[]; listings:MarketListing[]; ledger:CoinEntry[]; trades?:MarketTrade[];
  initialCoins:number; externalCoins:number; knownResidents:string[];
  transferCount:number; transferred:number; totals:Record<string,number>; nextSerial:number;
  taxRemainders?:Record<string,{policyId:string;remainder:number}>;
  levyCarries?:Record<string,Record<string,number>>;
}

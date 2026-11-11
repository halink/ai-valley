import type {Inventory,Vec} from './types.js';
export const ferryDefaults={buildMaterials:{wood:4,plank:8,cloth:2,bar:1} as Inventory,buildMinutes:180,seats:3,dryStepMinutes:2,rainStepMinutes:3,wearPerTile:.15,repairMaterials:{plank:1,cloth:1} as Inventory,repairMinutes:30,repairAmount:35};
export interface FerryAction {type:'ferry';definition?:string;operation:'build'|'repair'|'post'|'reserve'|'board'|'depart'|'cancel'|'disembark'|'hold'|'resume'|'return'|'unloadBody'|'proposeCargo'|'acceptCargo'|'rejectCargo'|'cancelCargo'|'loadCargo'|'unloadCargo'|'releaseCargo';dockId?:string;boatId?:string;tripId?:string;destinationId?:string;personId?:string;shipmentId?:string;cargoId?:string;fare?:number;departIn?:number;minutes?:number;}
/** The goods stay in the original shipment container, including food lots and sale escrow. */
export interface FerryCargo {id:string;shipmentId:string;ownerId:string;sourceAt:Vec;destinationAt:Vec;quantity:number;units:number;fee:number;account:string;status:'offered'|'accepted'|'aboard'|'unloaded'|'released'|'cancelled';createdAt:number;acceptedAt:number|null;loadedAt:number|null;unloadedAt:number|null;releasedAt:number|null;paid:number;refunded:number;reason:string|null;}
export interface Boat {id:string;definition:string;ownerId:string;at:Vec;dockId:string|null;condition:number;tripId:string|null;}
export interface BoatBuild {id:string;ownerId:string;dockId:string;at:Vec;definition:string;stock:Inventory;worked:number;minutes:number;lastAt:number;status:'building'|'completed'|'cancelled';}
export interface FerrySeat {personId:string;account:string;status:'reserved'|'aboard'|'landed'|'withdrawn';paid:number;refunded:number;}
export interface FerryTrip {id:string;boatId:string;operatorId:string;sourceId:string;destinationId:string;headingId:string;fare:number;departAt:number;expiresAt:number;capacity:number;phase:'posted'|'sailing'|'held'|'docked'|'completed'|'cancelled';seats:FerrySeat[];cargo?:FerryCargo[];aboard:string[];pilotId:string|null;path:Vec[];progress:number;returned:boolean;arrivedAt:number|null;reason:string|null;}
export interface FerryState {boats:Boat[];builds:BoatBuild[];trips:FerryTrip[];nextSerial:number;totals:{built:number;voyages:number;fares:number;refunds:number};}

/** Exact shore contact observed for one patient; never an open-water boarding permission. */
export interface DockedFerryContact {patientId:string;tripId:string;boatId:string;dockId:string;phase:'posted'|'docked';water:Vec;land:Vec;}

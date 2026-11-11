import {residentialLease} from './premises.js';
import {relocationBedClaims} from './family-relocation.js';
import type {Inventory,Item,Resident,World} from './types.js';
export type CommonsAction=
 | {type:'commons';operation:'inspectFood';buildingId:string;receiptId:string}
 | {type:'commons';operation:'takeFood';buildingId:string;item:Item;receiptId:string;reserveId?:string}
 | {type:'commons';operation:'donateFood';buildingId:string;item:Item;quantity:number;receiptId:string}
 | {type:'commons';operation:'borrowBed';buildingId:string;receiptId:string}
 | {type:'commons';operation:'releaseBed';buildingId:string;receiptId:string};
export interface CommonsStay {id:string;residentId:string;buildingId:string;bed:number;startedAt:number;expiresAt:number;endedAt:number|null;reason:string|null;}
export interface CommonsReceipt {id:string;residentId:string;buildingId:string;operation:Exclude<CommonsAction['operation'],'inspectFood'>;at:number;inventory:Inventory;nutrition:number;limit:number;reserveId?:string;}
export interface CommonsState {version:1;adoptedAt:number;stays:CommonsStay[];receipts:CommonsReceipt[];}
/** Rights are temporary. Neither physical presence nor an expired lease grants access. */
export function commonsStay(w:World,r:Resident,buildingId?:string):CommonsStay|undefined {
 return w.commons?.stays.find(s=>s.residentId===r.id&&(!buildingId||s.buildingId===buildingId)&&s.endedAt===null&&s.expiresAt>w.minute&&w.buildings.some(b=>b.id===s.buildingId&&b.ownerId==='commons'&&b.kind==='lodge'&&b.condition>0&&s.bed<b.capacity));
}
export function leasedBed(w:World,buildingId:string,bed:number,exceptId?:string):boolean {
 const rental=residentialLease(w,buildingId);
 // Only actual beds are reserved. Callers may probe capacity as the end of an allocation loop.
 const residential=!!rental&&rental.tenantId!==exceptId&&Number.isSafeInteger(bed)&&bed>=0&&bed<(w.buildings.find(b=>b.id===buildingId)?.capacity??0);
 return residential||relocationBedClaims(w,buildingId).some(c=>c.bed===bed&&c.personId!==exceptId)||(w.commons?.stays.some(s=>s.buildingId===buildingId&&s.bed===bed&&s.residentId!==exceptId&&s.endedAt===null&&s.expiresAt>w.minute&&w.residents.some(r=>r.id===s.residentId&&r.status==='alive'&&r.residency!=='outside'))??false);
}

/** A single-adult residential lease excludes new households, including on unused beds. */
export function commonsLeaseCount(w:World,buildingId:string,exceptId?:string){if(residentialLease(w,buildingId))return w.buildings.find(b=>b.id===buildingId)?.capacity??0;return new Set([...(w.commons?.stays.filter(s=>s.buildingId===buildingId&&s.residentId!==exceptId&&s.endedAt===null&&s.expiresAt>w.minute&&w.residents.some(r=>r.id===s.residentId&&r.status==='alive'&&r.residency!=='outside')&&!w.buildings.find(b=>b.id===buildingId)?.residents.includes(s.residentId)).map(s=>s.bed)??[]),...relocationBedClaims(w,buildingId).filter(c=>c.personId!==exceptId&&!w.buildings.find(b=>b.id===buildingId)?.residents.includes(c.personId)).map(c=>c.bed)]).size;}

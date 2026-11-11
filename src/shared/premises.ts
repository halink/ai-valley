import type {Building, World} from './types.js';
import type {StationKind} from './industry.js';

export type PremisesStation = StationKind|'table'|'kitchen'|'bed';
export interface PremisesTerms {
 days:number; rentPerDay:number; deposit:number;
 station:PremisesStation; startMinute:number; durationMinutes:number;
}
export interface PremisesAction {
 type:'premises'; operation:'offer'|'accept'|'decline'|'withdraw'|'surrender'|'collect';
 buildingId?:string; tenantId?:string; leaseId?:string; batchId?:string; terms?:PremisesTerms;
}
export interface PremisesLease {
 id:string; buildingId:string; ownerId:string; tenantId:string; terms:PremisesTerms;
 offeredAt:number; offerExpiresAt:number; acceptedAt:number|null; endsAt:number|null;
 status:'offered'|'active'|'declined'|'withdrawn'|'expired'|'ended';
 endedAt:number|null; reason:string|null; account:string; prepaid:number; paid:number; refunded:number;
}
export const premisesStationKey=(station:PremisesStation)=>station==='table'||station==='bench'?'table':station==='kitchen'?'kitchen':'station:'+station;
/** Current rights never follow a moved shop or survive a changed owner/site by implication. */
export function currentPremisesLease(w:World,buildingId:string,at=w.minute):PremisesLease|undefined {
 const b=w.buildings.find(b=>b.id===buildingId);
 return w.economy?.leases?.find(l=>l.buildingId===buildingId&&l.status==='active'&&l.endedAt===null&&l.acceptedAt!==null&&l.endsAt!==null&&at>=l.acceptedAt&&at<l.endsAt&&b?.ownerId===l.ownerId&&b.condition>0&&(l.terms.station==='bed'?b.kind==='home'&&b.capacity>0:['workshop','store'].includes(b.kind))&&w.residents.some(r=>r.id===l.tenantId&&r.status==='alive'&&r.residency!=='outside'));
}
export function premisesBusinessRight(w:World,personId:string,b:Building,at=w.minute):boolean {
 const lease=currentPremisesLease(w,b.id,at);
 return b.condition>0&&(lease?lease.terms.station!=='bed'&&lease.tenantId===personId:b.ownerId===personId);
}
/** All supplied times are real world minutes. A window is half-open and never crosses midnight. */
export function premisesWorkReason(w:World,principalId:string,buildingId:string,key:string,start:number,end:number):string|null {
 const lease=currentPremisesLease(w,buildingId)??currentPremisesLease(w,buildingId,start);if(!lease)return null;
 if(lease.terms.station==='bed')return '本址为有限单人住宅租约，不含厨房、经营或工位使用权';
 const reserved=premisesStationKey(lease.terms.station),slot=key==='station:bench'?'table':key,day=1440;
 if(principalId===lease.tenantId){
  const from=Math.floor(start/day)*day+lease.terms.startMinute,to=from+lease.terms.durationMinutes;
  return slot===reserved&&(!key.startsWith('station:')||lease.terms.station===key.slice(8))&&start>=lease.acceptedAt!&&end<=lease.endsAt!&&start>=from&&start<to&&end<=to?null:'本次劳动不在本人租约明确的工位、日时段或有效期限内';
 }
 if(slot!==reserved)return null;
 for(let date=Math.floor(start/day);date<=Math.floor(end/day);date++){
  const from=Math.max(lease.acceptedAt!,date*day+lease.terms.startMinute),to=Math.min(lease.endsAt!,date*day+lease.terms.startMinute+lease.terms.durationMinutes);
  if(start<to&&from<end)return '这处工位的本时段已按有效租约留给另一位经营者';
 }
 return null;
}

/** A residential lease reserves an otherwise empty home for one adult, at bed 0. */
export function residentialLease(w:World,buildingId:string){const l=currentPremisesLease(w,buildingId);return l?.terms.station==='bed'?l:undefined;}
export function residentialStay(w:World,personId:string,buildingId:string){const l=residentialLease(w,buildingId);return l?.tenantId===personId?l:undefined;}

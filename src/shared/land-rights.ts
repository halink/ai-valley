import type {BuildingKind,Vec,World} from './types.js';
export type LandPurpose=Extract<BuildingKind,'home'|'workshop'|'store'|'barn'|'greenhouse'>|'pasture';
export interface LandRightsAction {type:'landRights';operation:'survey'|'post'|'object'|'vote'|'register'|'withdraw'|'read'|'offerParcel'|'buyParcel'|'cancelParcel'|'declineParcel'|'inspectParcelSale';applicationId?:string;at?:Vec;purpose?:LandPurpose;days?:number;barnId?:string;pastureId?:string;accept?:boolean;parcelIndex?:number;parcel?:import('./land-transfers.js').PrivateLandParcel;buyerId?:string;price?:number;saleId?:string;}
export interface LandApplication {
 barnId?:string;pastureId?:string;springId?:string;
 id:string;applicantId:string;boardId:string;boardDoor:Vec;boardName:string;at:Vec;width:number;height:number;door:Vec;purpose:LandPurpose;definition:string;days:number;
 surveyedAt:number;postedAt:number|null;noticeUntil:number|null;closesAt:number|null;registerBefore?:number|null;registeredAt:number|null;expiresAt:number|null;
 status:'surveyed'|'notice'|'voting'|'approved'|'registered'|'objected'|'rejected'|'expired'|'review'|'cancelled';
 knownStatus?:Record<string,LandApplication['status']>;electorate:string[];votes:Record<string,boolean>;objections:Array<{personId:string;at:number;eventId:string}>;
 /** Survey evidence is historical, never a promise of current access or available water. */
 protectedAccess:{buildingIds:string[];springIds:string[];projectIds:string[]};eventIds:string[];reason:string|null;
}
export interface LandRightsState {nextSerial:number;applications:LandApplication[];transfers?:import('./land-transfers.js').PrivateLandTransfers;}
export const landPurposeNames:Record<LandPurpose,string>={home:'住宅',workshop:'工坊',store:'店铺',barn:'畜舍',greenhouse:'温室',pasture:'牧场'};
export const inLand=(p:{x:number;y:number;width:number;height:number},at:Vec)=>at.x>=p.x&&at.x<p.x+p.width&&at.y>=p.y&&at.y<p.y+p.height;
export const landOverlap=(a:{at:Vec;width:number;height:number},b:{at:Vec;width:number;height:number})=>a.at.x<b.at.x+b.width&&b.at.x<a.at.x+a.width&&a.at.y<b.at.y+b.height&&b.at.y<a.at.y+a.height;
export const reservedLandRights=(w:World)=>(w.landRights?.applications??[]).filter(a=>a.status==='review'||a.status==='registered'&&(a.expiresAt??0)>w.minute);
export const activeLandRights=(w:World)=>(w.landRights?.applications??[]).filter(a=>a.status==='registered'&&(a.expiresAt??0)>w.minute);
/** A finite right cannot be laundered through a completed building's permanent yard. */
export function landConstructionError(w:World,p:{at:Vec;width:number;height:number;ownerId:string;definition:string;landRightId?:string}):string|null {
 if(p.landRightId){const a=w.landRights?.applications.find(a=>a.id===p.landRightId);if(!a||a.status!=='registered'||(a.expiresAt??0)<=w.minute||a.applicantId!==p.ownerId)return '原有限用地已失效，停止新增施工；材料、工资与住户权利保留';}
 for(const a of w.landRights?.applications??[]){
  if(a.registeredAt===null||!landOverlap(a,p)||!['registered','review'].includes(a.status))continue;
  if(a.status!=='registered'||(a.expiresAt??0)<=w.minute)return '有限用地已到期，现场、住户和原约保留，须另行复核；不能继续施工';
  if(a.applicantId!==p.ownerId||a.definition!==p.definition)return '此处已有具体用途的有限建设权，不能改换权利人或用途';
 }
 return null;
}

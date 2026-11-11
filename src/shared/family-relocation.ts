import type {Vec,World} from './types.js';

export type FamilyRelocationAction =
 | {type:'familyRelocation';operation:'propose';buildingId:string;memberIds:string[];departAfter:number;departBefore:number}
 | {type:'familyRelocation';operation:'accept'|'decline'|'depart'|'resume'|'withdraw';relocationId:string}
 | {type:'familyRelocation';operation:'escort'|'returnChild';relocationId:string;personId:string;phase?:'delivery'}
 | {type:'familyRelocation';operation:'arrive';relocationId:string;personId:string};
export interface RelocationMember {
 personId:string;
 previousHomeId:string|null;
 previousResidency:'resident'|'visitor';
 guardianIds:string[];
 caregiverId:string|null;
 requiresAssent:boolean;
 providerId:string;
 bed:number;
 arrivedAt:number|null;
 arrivalEventId:string|null;
 escorting?:boolean;
}
/** Signed terms never change. A changed household, destination or guardian needs a new proposal. */
export interface FamilyRelocation {
 id:string;definition:'family/relocation@1';proposerId:string;buildingId:string;ownerId:string;
 assembly:Vec;destination:Vec;departAfter:number;departBefore:number;expiresAt:number;
 members:RelocationMember[];requiredSignerIds:string[];
 revocations?:Array<{personId:string;at:number;eventId:string}>;
 signatures:Array<{personId:string;at:number;eventId:string}>;
 rationsPerPerson:number;food:'meal';waterPerRation:1;
 status:'proposed'|'accepted'|'travelling'|'paused'|'arrived'|'completed'|'cancelled'|'expired';
 createdAt:number;startedAt:number|null;endedAt:number|null;reason:string|null;
 journey:null|{path:Vec[];progress:number;lastRationAt:number;rationsUsed:number};
}
export interface FamilyRelocationState {version:1;nextSerial:number;agreements:FamilyRelocation[];}
export function activeRelocation(c:FamilyRelocation,w:World){return ['accepted','travelling','paused','arrived'].includes(c.status)&&c.expiresAt>w.minute;}
export function relocationBedClaims(w:World,buildingId:string){
 return (w.familyRelocation?.agreements??[]).filter(c=>c.buildingId===buildingId&&activeRelocation(c,w)&&!c.revocations?.some(s=>s.personId===c.ownerId)).flatMap(c=>c.members.filter(m=>m.arrivedAt===null).map(m=>({bed:m.bed,personId:m.personId})));
}
export function travellingFamily(w:World,personId:string){return w.familyRelocation?.agreements.find(c=>c.status==='travelling'&&c.members.some(m=>m.personId===personId&&m.arrivedAt===null));}

export function familyPassenger(w:World,personId:string){return w.familyRelocation?.agreements.find(c=>c.members.some(m=>m.personId===personId&&m.escorting));}

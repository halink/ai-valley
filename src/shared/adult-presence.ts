import type {PersonObservation} from './types.js';
/** Non-invasive presence only. No consent, treatment, nutrition or substitute authority. */
export type AdultPresenceAction=
 | {type:'adultPresence';operation:'verify';transportId:string;eventId:string}
 | {type:'adultPresence';operation:'stay'|'stop';recordId:string}
 | {type:'adultPresence';operation:'stopVerification';transportId:string;eventId:string;providerId:string};
export interface AdultPresenceRecord {
 id:string;providerId:string;personId:string;transportId:string;eventId:string;sourceBinding:string;
 verifiedAt:number;expiresAt:number;providerLocation:PersonObservation;personLocation:PersonObservation;
 status:'verified'|'present'|'ended';startedAt:number|null;lastAt:number|null;minutes:number;
 endedAt:number|null;reason:string|null;stops:Array<{personId:string;at:number}>;eventIds:string[];
}
export interface AdultPresenceState {records:AdultPresenceRecord[];refusals:Array<{personId:string;transportId:string;eventId:string;at:number}>;}

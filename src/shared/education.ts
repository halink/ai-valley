import type {Inventory} from './types.js';
export type Subject='farming'|'building'|'care';
export interface EducationAction {
 type:'education';operation:'post'|'enroll'|'sponsor'|'withdrawSponsor'|'withdraw'|'cancel'|'teach'|'study';
 lessonId?:string;buildingId?:string;subject?:Subject;startsIn?:number;windowMinutes?:number;
 fee?:number;capacity?:number;learnerId?:string;fundingId?:string;minutes?:number;
}
export interface Enrollment {
 id:string;learnerId:string;seat:number;acceptedAt:number;endedAt:number|null;settled:boolean;
 status:'enrolled'|'completed'|'withdrawn'|'ended';reason:string|null;
 payer:string;account:string;reserved:number;paid:number;refunded:number;worked:number;gained:number;
}
export interface TuitionOffer {
 id:string;learnerId:string;payerId:string;account:string;amount:number;
 offeredAt:number;expiresAt:number;status:'offered'|'used'|'withdrawn'|'expired';
}
export interface Lesson {endKnownBy?:string[];
 id:string;teacherId:string;buildingId:string;subject:Subject;definition:string;
 postedAt:number;start:number;end:number;endedAt:number|null;status:'scheduled'|'cancelled'|'finished';reason:string|null;
 fee:number;capacity:number;teacherSkill:number;minutes:number;gain:number;materials:Inventory;materialsUsed:boolean;
 enrollments:Enrollment[];offers:TuitionOffer[];nextSerial:number;
 funding:null|{proposalId:string;account:string;allocated:number;remaining:number;refunded:number;expiresAt:number};
 taught:number;lastAt:number;pauseReason:string|null;
}
export interface EducationState {
 lessons:Lesson[];nextSerial:number;known:Record<string,string[]>;
 pulses:Array<{lessonId:string;personId:string;role:'teach'|'study';from:number;to:number}>;
 totals:{lessons:number;completed:number;minutes:number;paid:number;refunded:number};
}

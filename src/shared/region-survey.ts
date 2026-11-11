import type {Vec} from './types.js';
export type RegionEdge='east'|'south';
export type RegionSurveyAction={type:'regionSurvey'}&(
 |{operation:'survey';edge:RegionEdge;at:Vec;toolId:string}
 |{operation:'post'|'read'|'object'|'withdraw';surveyId:string}
 |{operation:'vote';surveyId:string;accept:boolean}
 |{operation:'open';surveyId:string;toolId:string});
export interface RegionSurvey {
 id:string;applicantId:string;edge:RegionEdge;at:Vec;access:Vec;mapWidth:number;mapHeight:number;
 boardId:string;boardDoor:Vec;boardName:string;surveyedAt:number;postedAt:number|null;noticeUntil:number|null;closesAt:number|null;expiresAt:number;
 status:'surveyed'|'notice'|'voting'|'approved'|'opened'|'objected'|'rejected'|'expired'|'cancelled';
 electorate:string[];votes:Record<string,boolean>;objections:string[];eventIds:string[];knownStatus:Record<string,RegionSurvey['status']>;
 supplies:{foodItem:string;water:number;toolId:string};openedAt:number|null;reason:string|null;
}
export interface RegionSurveyState {nextSerial:number;surveys:RegionSurvey[];}
export const REGION_DEPTH=8;
export const REGION_HALF_SPAN=3;

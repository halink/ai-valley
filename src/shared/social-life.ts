import type {Memory,Vec} from './types.js';
export interface SocialAction {type:'social';operation:'start'|'join'|'speak'|'leave'|'interpret';meetingId?:string;eventId?:string;targetId?:string;text?:string;minutes?:number;affection?:number;trust?:number;conflict?:number;}
export interface MeetingMember {personId:string;seat:number;joinedAt:number;leftAt:number|null;}
export interface Meeting {id:string;definition:string;hostId:string;topic:string;at:Vec;roomId:string|null;roomAt:Vec|null;createdAt:number;expiresAt:number;endedAt:number|null;status:'open'|'ended';members:MeetingMember[];}
export interface SocialLife {meetings:Meeting[];nextSerial:number;totals:{meetings:number;speeches:number;interpretations:number};}
export interface PersonalInterpretation {sourceEventId:string;source:Memory['source'];recordEventId:string;at:number;text:string;affection:number;trust:number;conflict:number;}

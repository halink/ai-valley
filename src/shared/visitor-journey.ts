import type {Item,Resident,World} from './types.js';

export interface VisitorJourneyAction {
 type:'visitorJourney';operation:'continue'|'continueAlone'|'turnBack'|'eat'|'rest';journeyId:string;item?:Item;minutes?:number;
}
/** Distance is measured from the valley gate, matching all other regional locations. */
export interface VisitorJourney {
 id:string;routeId?:string;origin:string;duration:number;progress:number;direction:'valley'|'home';
 status:'travelling'|'waiting'|'interrupted'|'returned';stageRemaining:number;
 updatedAt:number;needsAt:number;reason:string|null;eventIds:string[];
 pause?:{kind:'eat'|'rest';item?:Item;remaining:number};
 /** New adult pairs only. Each person's pending consent is finite and independently chosen. */
 family?:{id:string;companionId:string;ready?:{minutes:number;expiresAt:number}};
}
export function ordinaryVisitorJourney(w:World,r:Resident):VisitorJourney|undefined {
 const j=w.migration?.contacts.find(c=>c.id===r.id)?.journey?.staged;
 return r.residency==='outside'&&j&&['travelling','waiting'].includes(j.status)?j:undefined;
}
export const visitorStageMinutes=(duration:number)=>Math.min(30,duration/2);

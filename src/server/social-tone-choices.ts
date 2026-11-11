import type {DecisionContext} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';

export const MAX_TALK_TARGETS=3;
export const MAX_TALK_CHOICES=MAX_TALK_TARGETS*3;
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
/** Choose people, never a mood. The nearest visible person stays available;
 * every other eligible person gets two rotating slots, independent of focus,
 * kinship and relationship scores. Only observation-supplied facts are used. */
export function socialToneChoices(c:DecisionContext):ActionChoice[]{
 if(c.foreign||c.outside||c.formal&&(c.formal.age<6||c.formal.careWithdrawalOnly||c.formal.expressiveEvacuationOnly||c.formal.familyTravelling||c.formal.passenger))return [];
 const range=(p:DecisionContext['people'][number])=>p.talkDistance??distance(p.at,c.actor.at);
 const peers=[...c.people].filter(p=>p.id!==c.actor.id&&p.status==='alive'&&p.talkEligible!==false&&range(p)<=12)
  .sort((a,b)=>range(a)-range(b)||a.id.localeCompare(b.id));
 const nearest=peers.shift();if(!nearest)return [];
 const offset=Math.floor(c.minute/30)%Math.max(1,peers.length);
 const selected=[nearest,...Array.from({length:Math.min(MAX_TALK_TARGETS-1,peers.length)},(_,i)=>peers[(offset+i)%peers.length])];
 return selected.flatMap(peer=>([['neutral','平常地'],['friendly','友善地'],['hostile','表达不满地']] as const).map(([tone,label])=>({
  id:`talk.${peer.id}.${tone}`,label:`${label}向${peer.name}说一句自己的话（填写text）`,action:{type:'talk' as const,targetId:peer.id,text:'',tone},
 })));
}
/** Complete the same bounded person groups after BOTH row budgets. Preserve
 * existing non-reflection actions, including emergencies, refusals and stops.
 * No second rotation, no fabricated partner, no automatic speech or consent.
 * A fully saturated 59-row menu gains at most nine rows; live stops are separate. */
export function restoreSocialToneChoices(c:DecisionContext,rows:ActionChoice[]):ActionChoice[]{
 const result=[...rows];
 for(const choice of socialToneChoices(c)){
  const a=choice.action;if(a.type!=='talk')continue;
  if(result.some(row=>row.action.type==='talk'&&row.action.targetId===a.targetId&&row.action.tone===a.tone))continue;
  if(result.length<56){result.push(choice);continue;}
  const reflections=result.flatMap((row,index)=>row.action.type==='agency'&&row.action.operation==='reflect'?[index]:[]);
  if(reflections.length>1)result[reflections.at(-1)!]=choice;else result.push(choice);
 }
 return result;
}

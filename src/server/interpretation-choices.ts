import type {ActionChoice} from './affordances.js';
import {MAX_INTERPRETATION_MEMORIES,MAX_INTERPRETATION_TARGETS} from '../shared/interpretation-memory.js';

/** Restore the already rotated, personally authorized candidates after both
 * agenda caps. Never rotate them a second time or evict a non-reflection row.
 * Fully saturated ordinary menus add at most 5 * 2 rows; live stops stay extra.
 * Use buildChoices output so transport, age and ability restrictions survive. */
export function restoreInterpretationChoices(all:ActionChoice[],rows:ActionChoice[]):ActionChoice[]{
 const result=[...rows],events=new Map<string,Set<string>>();
 for(const choice of all){
  const a=choice.action;if(a.type!=='social'||a.operation!=='interpret'||!a.eventId||!a.targetId)continue;
  if(!events.has(a.eventId)){if(events.size>=MAX_INTERPRETATION_MEMORIES)continue;events.set(a.eventId,new Set());}
  const targets=events.get(a.eventId)!;if(targets.has(a.targetId)||targets.size>=MAX_INTERPRETATION_TARGETS)continue;targets.add(a.targetId);
  if(result.some(c=>c.action.type==='social'&&c.action.operation==='interpret'&&c.action.eventId===a.eventId&&c.action.targetId===a.targetId))continue;
  if(result.length<56){result.push(choice);continue;}
  const reflections=result.flatMap((c,index)=>c.action.type==='agency'&&c.action.operation==='reflect'?[index]:[]);
  if(reflections.length>1)result[reflections.at(-1)!]=choice;else result.push(choice);
 }
 return result;
}

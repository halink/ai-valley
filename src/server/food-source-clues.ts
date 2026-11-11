import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {ActionChoice} from './affordances.js';
import {ageAllowsAction} from '../world/family.js';
import {movementRate} from '../world/health.js';
import {findPath,distance} from '../world/navigation.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {validPoint} from '../world/outdoor-observation.js';

/** Heard addresses are deliberately separate from knownResources. Never look
 * up a live Resource by the heard identity, even to decide whether to offer it. */
export function foodSourceClueOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||!ageAllowsAction(w,r,{type:'move',to:r.at})||!(movementRate({...w,definitions:{...w.definitions}},r)>0))return [];
 if(r.inside){const b=w.buildings.find(b=>b.id===r.inside);if(!b||!r.roomAt||roomPath(roomLayout(w,b),r.roomAt,roomLayout(w,b).entry)===null)return [];}
 const clues=(r.foodSourceKnowledge?.heard??[]).filter(s=>validPoint(w,s.at)&&Number.isFinite(s.observedAt)&&s.observedAt<=s.receivedAt&&s.receivedAt<=w.minute&&!r.foodSourceKnowledge?.seen[s.resourceId])
  .sort((a,b)=>a.eventId.localeCompare(b.eventId));
 const offset=Math.floor(w.minute/30)%Math.max(1,clues.length);
 for(let i=0;i<clues.length;i++){
  const clue=clues[(offset+i)%clues.length];
  // Once at the reported address there is nothing to move to. Existing
  // observation may discover a patch; an empty address never manufactures one.
  if(!r.inside&&distance(r.at,clue.at)<=1)continue;
  const path=findPath(w,r.at,clue.at,true);if(path===null)continue;
  return [{id:'foodSource.heard.'+clue.eventId,label:`按${clue.speakerName}在游戏分钟${clue.receivedAt}当面告知的旧地址去（${clue.at.x},${clue.at.y}）旁核实浆果：其亲见时点为${clue.observedAt}，不是本人亲见，当前余量未知；到场后另选采集`,action:{type:'move',to:{...(path.at(-1)??r.at)}}}];
 }
 return [];
}

export const isFoodSourceSharingChoice=(c:ActionChoice)=>c.action.type==='shareFoodSource'||c.id.startsWith('foodSource.heard.');
/** Bypass agenda re-rotation without displacing any existing action. At most
 * two added rows; all came through the normal age/transport filters. */
export function restoreFoodSourceSharingChoices(all:ActionChoice[],rows:ActionChoice[]):ActionChoice[]{
 const selected=all.filter(isFoodSourceSharingChoice).slice(0,2);
 return [...rows,...selected.filter(c=>!rows.some(row=>row.id===c.id))];
}

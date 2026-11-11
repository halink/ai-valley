import type {Resident,Vec,World} from '../shared/types.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {canObserveBody} from './body-observation.js';
import {canObserve} from './knowledge.js';
import {canSeeOutdoorPoint,clearSightCorridor,validPoint} from './outdoor-observation.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {socialRoomAccess,socialSpace} from './relationships.js';

/** Visual identification is separate from event hearing and remembered names.
 * Keep the existing ten-tile local range, using real room positions and the
 * same conservative sight corridor. Missing coordinates are not an entrance. */
export function canSeeSocialTarget(w:World,actor:Resident,target:Resident):boolean {
 if(actor.id===target.id||target.status!=='alive'||target.residency==='outside'||actor.inside!==target.inside||!validPoint(w,actor.at)||!validPoint(w,target.at))return false;
 if(w.ferries?.trips.some(t=>t.aboard.includes(actor.id)||t.aboard.includes(target.id)))return false;
 if(target.inside!==null){
  const room=w.buildings.find(b=>b.id===target.inside),a=actor.roomAt,b=target.roomAt;
  if(!w.rooms||!room||room.condition<=0||!canObserve(w,actor)||!a||!b||!same(actor.at,room.door)||!same(target.at,room.door)
   ||actor.activity?.action.type==='sleep'&&!actor.activity.path.length&&!actor.activity.room?.path.length)return false;
  const layout=roomLayout(w,room),clear=(p:Vec)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=1&&p.y>=4&&p.x<layout.width-1&&p.y<layout.height-1&&!layout.blocked.some(q=>same(p,q));
  return clear(a)&&clear(b)&&distance(a,b)<=10&&clearSightCorridor(a,b,clear);
 }
 return target.roomAt==null&&validPoint(w,target.at)&&walkable(w,target.at,target.at)&&canSeeOutdoorPoint(w,actor,target.at,10);
}

/** Actual face-to-face contact, never a hearing radius or a distant identity.
 * Keep the existing two-step contact limit, but do not reach through fences,
 * opaque corners, invalid room positions or another person's private room. */
export function canContactSocialTarget(w:World,actor:Resident,target:Resident):boolean {
 return actor.knownPeople.includes(target.id)&&canSeeSocialTarget(w,actor,target)
  &&canObserveBody(w,actor,target)&&socialSpace(w,actor,target);
}

/** An adjacent path may finish across a closed fence. If so, use the actual
 * gate route onto the observed tile, stopping one step before it. The engine
 * uses the same rule on the saved observation, never the target's live place. */
export function socialApproachPath(w:World,from:Vec,to:Vec):Vec[]|null {
 const path=findPath(w,from,to,true);if(path===null)return null;
 if(walkable(w,to,path.at(-1)??from))return path;
 const approach=findPath(w,from,to);return approach===null?null:approach.slice(0,-1);
}

/** A view and a legal approach are both required. This read-only check does
 * not move, speak, acquire knowledge, or choose a relationship for anyone. */
export function canApproachSocialTarget(w:World,actor:Resident,target:Resident):boolean {
 if(!actor.canExpress||!actor.knownPeople.includes(target.id)||!canSeeSocialTarget(w,actor,target))return false;
 if(actor.inside!==null){
  const room=w.buildings.find(b=>b.id===actor.inside)!;
  return socialRoomAccess(w,actor,room)&&socialRoomAccess(w,target,room)&&roomPath(roomLayout(w,room),actor.roomAt!,target.roomAt!)!==null;
 }
 const path=socialApproachPath(w,actor.at,target.at);if(path===null)return false;
 const at=path.at(-1)??actor.at;
 return walkable(w,target.at,at)&&canContactSocialTarget(w,{...actor,at},target);
}

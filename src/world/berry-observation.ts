import type {Resident,Resource,Vec,World} from '../shared/types.js';
import {pastureEdgeOpen} from '../shared/pasture-access.js';
import {canObserveOutdoors,clearSight,validPoint} from './outdoor-observation.js';
import {distance,findPath,walkable} from './navigation.js';

/** Old known IDs supply addresses, not live fruit. Preserve the existing
 * twelve-cell Euclidean range while requiring actual unobstructed presence. */
export function canInspectBerry(w:World,r:Resident,s:Resource){
 return s.kind==='bush'&&r.knownResources.includes(s.id)&&Math.hypot(r.at.x-s.at.x,r.at.y-s.at.y)<=12
  &&validPoint(w,s.at)&&canObserveOutdoors(w,r)&&clearSight(w,r.at,s.at);
}
/** Fences are transparent but prevent physical reach across their closed
 * edges. The plant itself need not occupy a walkable tile. */
export function berryContactEdge(w:World,at:Vec,s:Resource){
 return distance(at,s.at)<=1&&pastureEdgeOpen(w,at,s.at);
}
export function canContactBerry(w:World,r:Resident,s:Resource){
 return canInspectBerry(w,r,s)&&berryContactEdge(w,r.at,s);
}
/** Ordinary adjacency may stop on the wrong side of a fence. Search actual
 * legal standing tiles instead; never require walking onto the plant. */
export function berryApproachPath(w:World,start:Vec,s:Resource):Vec[]|null {
 const path=findPath(w,start,s.at,true);
 if(path===null||berryContactEdge(w,path.at(-1)??start,s))return path;
 let best:Vec[]|null=null;
 for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
  const at={x:s.at.x+dx,y:s.at.y+dy};
  if(!walkable(w,at,at)||!berryContactEdge(w,at,s))continue;
  const candidate=findPath(w,start,at);
  if(candidate!==null&&(best===null||candidate.length<best.length))best=candidate;
 }
 return best;
}

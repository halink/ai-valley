import type {Resident,Resource,Vec,World} from '../shared/types.js';
import {canSeeOutdoorPoint} from './outdoor-observation.js';
import {distance,findPath,walkable} from './navigation.js';

/** A known id supplies only an address. Live spring state needs an unobstructed
 * twelve-step view, shared by hand gathering, bucket filling and flood cleanup. */
export function canInspectSpring(w:World,r:Resident,s:Resource){
 return s.kind==='spring'&&r.knownResources.includes(s.id)&&canSeeOutdoorPoint(w,r,s.at,12);
}
/** Transferring water also requires real, legal contact, not a doorway alias or
 * a one-tile reach across a newly closed fence/occupied source tile. */
export function canContactSpring(w:World,r:Resident,s:Resource){
 return canInspectSpring(w,r,s)&&distance(r.at,s.at)<=1&&walkable(w,s.at,r.at);
}

/** Match execution: approach a legal contact edge, routing through a gate
 * when ordinary adjacency lands behind a closed fence. */
export function springApproachPath(w:World,start:Vec,s:Resource):Vec[]|null {
 const path=findPath(w,start,s.at,true);
 if(path===null||walkable(w,s.at,path.at(-1)??start))return path;
 const approach=findPath(w,start,s.at);
 return approach===null?null:approach.slice(0,-1);
}

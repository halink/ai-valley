import type {Resident,Vec,World} from '../shared/types.js';
import {canObserve} from './knowledge.js';
import {distance,walkable} from './navigation.js';

export const validPoint=(w:World,p:Vec)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<w.map.width&&p.y<w.map.height;
/** Conservative grid corridor shared by outdoor and room observation. */
export function clearSightCorridor(a:Vec,b:Vec,clear:(p:Vec)=>boolean){
 const steps=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));
 let previous=a;
 for(let i=1;i<=steps;i++){
  const x=a.x+(b.x-a.x)*i/steps,y=a.y+(b.y-a.y)*i/steps;
  const current={x:Math.round(x),y:Math.round(y)};
  if(current.x!==previous.x&&current.y!==previous.y&&(!clear({x:current.x,y:previous.y})||!clear({x:previous.x,y:current.y})))return false;
  previous=current;
  for(const px of new Set([Math.floor(x),Math.ceil(x)]))for(const py of new Set([Math.floor(y),Math.ceil(y)]))if(!clear({x:px,y:py}))return false;
 }
 return true;
}
/** Conservative local sight corridor. Do not see through solid structures,
 * cliffs or standing trees/rocks, including either side of a diagonal corner. */
export function clearSight(w:World,a:Vec,b:Vec){
 const clear=(p:Vec)=>w.map.tiles[p.y*w.map.width+p.x]!=='cliff'
  &&!w.buildings.some(v=>p.x>=v.at.x&&p.x<v.at.x+v.width&&p.y>=v.at.y&&p.y<v.at.y+v.height)
  &&!w.construction?.projects.some(v=>v.reserved&&v.mode!=='terrain'&&p.x>=v.at.x&&p.x<v.at.x+v.width&&p.y>=v.at.y&&p.y<v.at.y+v.height)
  &&!w.resources.some(v=>(v.kind==='tree'||v.kind==='rock')&&v.amount>0&&v.at.x===p.x&&v.at.y===p.y);
 return clearSightCorridor(a,b,clear);
}

/** Real awake outdoor presence; an old shore or room doorway is not a view. */
export function canObserveOutdoors(w:World,r:Resident){
 return canObserve(w,r)&&r.inside===null&&r.roomAt==null&&validPoint(w,r.at)&&walkable(w,r.at,r.at)
  &&!(r.activity?.action.type==='sleep'&&!r.activity.path.length&&!r.activity.room?.path.length)
  &&!w.ferries?.trips.some(t=>t.aboard.includes(r.id));
}
export function canSeeOutdoorPoint(w:World,r:Resident,at:Vec,range:number){
 return canObserveOutdoors(w,r)&&validPoint(w,at)&&distance(r.at,at)<=range&&clearSight(w,r.at,at);
}

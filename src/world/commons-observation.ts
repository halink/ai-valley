import type {Building,Resident,Vec,World} from '../shared/types.js';
import {roomLayout,roomPath,type RoomLayout} from '../shared/rooms.js';
import {canObserve} from './knowledge.js';
import {canSeeOutdoorPoint,clearSightCorridor,validPoint} from './outdoor-observation.js';
import {distance,findPath,same} from './navigation.js';
import {movementRate} from './health.js';
import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';

export const clearRoomPoint=(layout:RoomLayout,p:Vec)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=1&&p.y>=4&&p.x<layout.width-1&&p.y<layout.height-1&&!layout.blocked.some(q=>same(p,q));
/** Shared live room geometry: never use the outdoor doorway alias for an
 * indoor observer, and never treat a walkable detour as a line of sight. */
export function canInspectRoomPoint(w:World,r:Resident,b:Building,target:Vec):boolean {
 if(!w.rooms||!canObserve(w,r)||aboardFerry(w,r.id)||passenger(w,r.id))return false;
 const layout=roomLayout(w,b);if(!clearRoomPoint(layout,target))return false;
 if(r.activity?.action.type==='sleep'&&!r.activity.path.length&&!r.activity.room?.path.length)return false;
 if(r.inside===b.id){
  const from=r.roomAt;
  return !!from&&same(r.at,b.door)&&clearRoomPoint(layout,from)&&distance(from,target)<=8&&clearSightCorridor(from,target,p=>clearRoomPoint(layout,p));
 }
 return r.inside===null&&canSeeOutdoorPoint(w,r,b.door,8)&&clearRoomPoint(layout,layout.entry)&&clearSightCorridor(layout.entry,target,p=>clearRoomPoint(layout,p));
}
/** Read-only route cost without stock, roster or occupancy queries. Missing
 * indoor positions cannot invent an exit. Entry and destination stay distinct. */
export function roomApproachCost(w:World,r:Resident,b:Building,target:Vec):number|null {
 if(!w.rooms||!validPoint(w,r.at)||!validPoint(w,b.door)||aboardFerry(w,r.id)||passenger(w,r.id)||!(movementRate({...w,definitions:{...w.definitions}},r)>0))return null;
 const layout=roomLayout(w,b);if(!clearRoomPoint(layout,target))return null;
 let cost=0;
 if(r.inside!==null){
  const current=w.buildings.find(p=>p.id===r.inside),from=r.roomAt;
  if(!current||!from||!same(r.at,current.door))return null;
  const origin=roomLayout(w,current);if(!clearRoomPoint(origin,from))return null;
  if(current.id===b.id)return roomPath(layout,from,target)?.length??null;
  if(!clearRoomPoint(origin,origin.entry))return null;
  const exit=roomPath(origin,from,origin.entry);if(exit===null)return null;cost+=exit.length;
 }else if(r.roomAt!=null)return null;
 if(!clearRoomPoint(layout,layout.entry))return null;
 const outside=findPath(w,r.at,b.door),inside=roomPath(layout,layout.entry,target);if(outside===null||inside===null)return null;
 return cost+outside.reduce((n,p)=>n+(w.map.tiles[p.y*w.map.width+p.x]==='road'?.75:1),0)+inside.length;
}
/** A remembered address or public notice is not a live inventory observation. */
export function canInspectCommonsFood(w:World,r:Resident,b:Building):boolean {
 if(b.kind!=='lodge'||b.ownerId!=='commons'||b.condition<=0||!r.knownBuildings.includes(b.id))return false;
 const table=roomLayout(w,b).slots.find(s=>s.key==='table')?.at;
 return !!table&&canInspectRoomPoint(w,r,b,table);
}
/** The common table keeps its existing exclusive occupancy rule. */
export function canReachCommonsTable(w:World,r:Resident,b:Building):boolean {
 const table=roomLayout(w,b).slots.find(s=>s.key==='table')?.at;if(!table)return false;
 if(w.rooms?.claims.some(c=>c.buildingId===b.id&&c.key==='table'&&c.group!==r.id&&c.people.some(id=>w.residents.some(p=>p.id===id&&p.activity&&p.inside===b.id))))return false;
 return roomApproachCost(w,r,b,table)!==null;
}

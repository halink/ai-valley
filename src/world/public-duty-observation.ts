import type {Building,Resident,World} from '../shared/types.js';
import type {PublicShift} from '../shared/public-duties.js';
import {roomLayout} from '../shared/rooms.js';
import {leasedBed} from '../shared/commons.js';
import {canInspectRoomPoint,roomApproachCost} from './commons-observation.js';
import {canSeeOutdoorPoint} from './outdoor-observation.js';
import {visibleStreetDirectory} from './street-directory.js';

export function knownDutyPlace(w:World,r:Resident,b:Building){
 return b.ownerId==='commons'&&(b.kind==='lodge'||b.kind==='clinic')
  &&(r.knownBuildings.includes(b.id)||visibleStreetDirectory(w,r)?.hall.id===b.id);
}
export function dutyInspectionPoint(w:World,b:Building){const at=dutyServicePoint(w,b);return at?(b.kind==='clinic'?{x:at.x+1,y:at.y}:{x:at.x,y:at.y+1}):undefined;}
export function dutyInspectionApproachCost(w:World,r:Resident,b:Building){
 const at=dutyInspectionPoint(w,b);return at&&!(b.kind==='clinic'&&leasedBed(w,b.id,0,r.id))?roomApproachCost(w,r,b,at):null;
}
export function dutyServicePoint(w:World,b:Building){return roomLayout(w,b).slots.find(s=>s.key===(b.kind==='clinic'?'bed:0':'table'))?.at;}
/** The public board is readable at its actual entrance. It is not a live
 * guarantee that the worker, materials or service seat are ready. */
export function canInspectDutyBoard(w:World,r:Resident,b:Building){return r.inside===null?canSeeOutdoorPoint(w,r,b.door,8):canInspectRoomPoint(w,r,b,roomLayout(w,b).entry);}
export function canInspectDutyService(w:World,r:Resident,b:Building){
 const at=dutyServicePoint(w,b);return knownDutyPlace(w,r,b)&&!!at&&canInspectRoomPoint(w,r,b,at);
}
/** Geometry and existing seat permissions only. Inspection must never query
 * hidden staffing, public funding or the provider's inventory. */
export function dutyServiceApproachCost(w:World,r:Resident,b:Building,shift?:PublicShift):number|null {
 const at=dutyServicePoint(w,b);if(!at)return null;
 if(b.kind==='clinic'&&leasedBed(w,b.id,0,r.id))return null;
 if(shift&&w.rooms?.claims.some(c=>c.buildingId===b.id&&(shift.role==='care'?['bed:0']:['kitchen','table']).includes(c.key)&&c.group!==shift.id&&c.people.some(id=>w.residents.some(p=>p.id===id&&p.activity&&p.inside===b.id))))return null;
 return roomApproachCost(w,r,b,at);
}

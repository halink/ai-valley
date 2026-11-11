import type {Action,Activity,Resident,World} from '../../src/shared/types.js';
import {actionRoom} from '../../src/shared/rooms.js';
import {initializeRooms} from '../../src/world/rooms.js';
/** Payroll/service tests start at a real workstation. Separate navigation tests cover the walk. */
export function atWorkstation(w:World,r:Resident,action:Action){
 initializeRooms(w);let buildingId:string|undefined,minute=w.minute;
 if(action.type==='health')buildingId=w.health?.appointments.find(c=>c.id===action.appointmentId)?.buildingId;
 if(action.type==='education')buildingId=w.education?.lessons.find(l=>l.id===action.lessonId)?.buildingId;
 if(action.type==='employment')buildingId=w.employment?.contracts.find(c=>c.id===action.contractId)?.buildingId;
 if(action.type==='industry')buildingId=action.buildingId;
 if(action.type==='publicDuty'){const s=w.duties?.shifts.find(s=>s.id===action.shiftId);buildingId=s?.buildingId;minute=Math.max(minute,s?.start??minute);}
 if(action.type==='sleep')buildingId=r.homeId??undefined;
 if(action.type==='cook')buildingId=action.buildingId??r.homeId??w.buildings.find(b=>b.ownerId==='commons'&&b.kind==='lodge'&&Math.abs(r.at.x-b.door.x)+Math.abs(r.at.y-b.door.y)<=1)?.id;
 const b=w.buildings.find(b=>b.id===buildingId);if(!b||Math.abs(r.at.x-b.door.x)+Math.abs(r.at.y-b.door.y)>1)return;
 const fixtureAction=action.type==='cook'?{...action,buildingId:b.id}:action;
 const activity:Activity={planId:'fixture-position',action:fixtureAction,startedAt:w.minute,remaining:1,path:[],target:{...b.door},definition:w.activeDefinitions['action/routine']};
 const room=actionRoom({...w,minute},r,activity);if(room){r.at={...b.door};r.inside=b.id;r.roomAt={...room.target};}
}

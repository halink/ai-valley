import {clearRoomPoint} from './commons-observation.js';
import {dutyReason} from './public-duties.js';
import {canReachCommonsTable} from './commons-observation.js';
import {isWaterSupportAction} from '../shared/water-support.js';
import {premisesWorkReason} from '../shared/premises.js';
import {custodyInspectionEntryProblem,noteCustodyInspectionFailure} from './protected-custody.js';
import {leasedBed} from '../shared/commons.js';
import {coLocated} from './proximity.js';
import {canApproachSocialTarget} from './social-observation.js';
import {movementRate} from './health.js';
import {knownAgeYears} from './time.js';
import {isSelfCareAction} from './self-care.js';
import type {Resident,Vec,World} from '../shared/types.js';
import {actionRoom,roomLayout,roomPath} from '../shared/rooms.js';
export function initializeRooms(w:World){if(w.mode==='formal')w.rooms??={tick:-1,claims:[],beds:{}};}
export function beginRoomTick(w:World){initializeRooms(w);if(!w.rooms)return;w.rooms.tick=w.minute;w.rooms.claims=[];
 for(const r of w.residents.filter(r=>r.status==='alive'&&r.activity&&r.activity.path.length===0&&!r.activity.room?.path.length).sort((a,b)=>a.activity!.startedAt-b.activity!.startedAt||a.id.localeCompare(b.id))){const slot=actionRoom(w,r,r.activity!);if(slot&&r.inside===slot.building.id&&r.roomAt?.x===slot.target.x&&r.roomAt?.y===slot.target.y){claim(w,r,slot.key,slot.group,slot.building.id);if(r.activity!.action.type==='publicDuty'&&r.activity!.action.operation==='receive'&&slot.key==='kitchen')claim(w,r,'table',slot.group,slot.building.id);}}
}
function claim(w:World,r:Resident,key:string,group:string,id:string,start=w.minute,end=w.minute+.000001):string|null {
 const a=r.activity?.action,principal=a?.type==='employment'&&a.operation==='work'?w.employment?.contracts.find(c=>c.id===a.contractId)?.employerId??r.id:r.id;
 if((key==='table'||key==='kitchen'||key.startsWith('station:'))&&!(a?.type==='premises'&&a.operation==='collect')){const error=premisesWorkReason(w,principal,id,key,start,end);if(error)return error;}
 const state=w.rooms!;if(key.startsWith('bed:')&&leasedBed(w,id,Number(key.slice(4)),r.id))return '这张床仍在他人的有限借住期限内';const prior=state.claims.find(c=>c.buildingId===id&&c.key===key);
 if(prior&&prior.group!==group)return '这处实际工位正在被另一项劳动占用';
 if(prior){if(!prior.people.includes(r.id))prior.people.push(r.id);}else state.claims.push({buildingId:id,key,group,people:[r.id]});return null;
}
/** Every interior step must remain physical, including ordinary sleep/work routes.
 * Specialized journeys retain their existing failure descriptions. */
function guardianRoomStepProblem(w:World,r:Resident,next:Vec):string|null {
 const a=r.activity?.action,unknownSelfCare=!!a&&isSelfCareAction(a)&&knownAgeYears(r.bornAt,w.minute)===null;
 const b=w.buildings.find(b=>b.id===r.inside),from=r.roomAt;
 if(!b||!from||!clearRoomPoint(roomLayout(w,b),from)||r.at.x!==b.door.x||r.at.y!==b.door.y||Math.abs(from.x-next.x)+Math.abs(from.y-next.y)!==1||roomPath(roomLayout(w,b),from,next)?.length!==1)return unknownSelfCare?'本人自理的实际室内路线已经阻断，须留在当前位置重新决定':a?.type==='commons'?'共屋实际室内路线已经阻断，须留在当前位置重新决定':a?.type==='publicDuty'?'公共服务实际室内路线已经阻断，须留在当前位置重新决定':a?.type==='health'&&a.operation==='rescue'&&a.evacuationDangerId?'原房间的实际护送路线已经阻断，须留在当前位置重新决定':'原房间的实际行走路线已经阻断，须留在当前位置重新决定';
 return null;
}
const exitUnavailable='原房间的实际出口或路线已失效，须留在当前位置重新决定';
type ExitPlan={error:string}|{buildingId:string;entry:Vec;path:Vec[]};
/** Physical exit planning only. It grants no entry/ownership rights and mutates nothing. */
function roomExitPlan(w:World,r:Resident):ExitPlan {
 const b=w.buildings.find(b=>b.id===r.inside),from=r.roomAt;
 if(!b||!from||r.at.x!==b.door.x||r.at.y!==b.door.y)return {error:exitUnavailable};
 const layout=roomLayout(w,b);
 if(!clearRoomPoint(layout,from)||!clearRoomPoint(layout,layout.entry))return {error:exitUnavailable};
 const path=roomPath(layout,from,layout.entry);
 return path===null?{error:exitUnavailable}:{buildingId:b.id,entry:{...layout.entry},path};
}
/** Phase-changing pickups call this before spending or moving either participant. */
export function roomExitReason(w:World,r:Resident):string|null {
 if(!w.rooms||!r.inside)return null;const plan=roomExitPlan(w,r);return 'error' in plan?plan.error:null;
}
function exitJourneyProblem(w:World,r:Resident,journey:NonNullable<Resident['activity']>['room']):string|null {
 const b=w.buildings.find(b=>b.id===r.inside),from=r.roomAt;
 if(!journey||!b||!from||journey.buildingId!==b.id||!journey.target||!Array.isArray(journey.path)||!Number.isFinite(journey.progress)||journey.progress<0||r.at.x!==b.door.x||r.at.y!==b.door.y)return exitUnavailable;
 const layout=roomLayout(w,b),entry=layout.entry,next=journey.path[0];
 if(journey.target.x!==entry.x||journey.target.y!==entry.y||!clearRoomPoint(layout,from)||!clearRoomPoint(layout,entry))return exitUnavailable;
 if(next){const prior=guardianRoomStepProblem(w,r,next);if(prior)return prior;if(!clearRoomPoint(layout,next)||Math.abs(from.x-next.x)+Math.abs(from.y-next.y)!==1||roomPath(layout,from,next)?.length!==1)return exitUnavailable;}
 else if(from.x!==entry.x||from.y!==entry.y)return exitUnavailable;
 return null;
}
/** Room movement consumes the same world minutes as outdoor walking. Work starts at the actual slot. */
export function moveInRoom(w:World,r:Resident,dt:number):{moving:boolean;error?:string}{
 if(!w.rooms||!r.activity)return {moving:false};const a=r.activity;
 // Older saved activities may lack an exit journey. Reconstruct a real one
 // instead of letting the outdoor path erase the resident's indoor position.
 if(r.inside&&(!a.room||a.room.mode!=='exit'&&a.path.length)){const error=prepareRoomExit(w,r);if(error)return {moving:false,error};}
 if(a.action.type==='publicDuty'&&(a.action.operation==='receive'||a.action.operation==='inspect')){const error=dutyReason(w,r,a.action);if(error)return {moving:false,error};}
 if(a.room?.mode==='exit'){
  const journey=a.room,problem=exitJourneyProblem(w,r,journey);if(problem)return {moving:false,error:problem};
  journey.progress+=dt*movementRate(w,r);while(journey.progress>=1&&journey.path.length){const error=exitJourneyProblem(w,r,journey);if(error)return {moving:false,error};r.roomAt=journey.path.shift()!;journey.progress--;}
  if(!journey.path.length){const error=exitJourneyProblem(w,r,journey);if(error)return {moving:false,error};r.inside=null;r.roomAt=null;delete a.room;}
  return {moving:true};
 }
 if(a.path.length)return {moving:false};
 if(a.action.type==='production'&&a.action.operation==='custodyInspect'){const error=custodyInspectionEntryProblem(w,r,a.action);if(error){noteCustodyInspectionFailure(w,r,a.action);return {moving:false,error};}}
 const remembered=a.action.observedTarget;if(remembered&&!(a.action.type==='emergencyCare'&&a.action.operation==='visitHelp')){const p=w.residents.find(p=>p.id===remembered.id);if(p&&coLocated(w,r,p,10)&&(!['talk','offer','accept'].includes(a.action.type)||canApproachSocialTarget(w,r,p)))a.action.observedTarget={id:p.id,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:w.minute};}const work=actionRoom(w,r,a);if(!work)return {moving:false};
 const {building:b,target,key,group}=work,layout=roomLayout(w,b);
 if(a.action.type==='commons'&&!canReachCommonsTable(w,r,b))return {moving:false,error:'共屋实际室内入口或桌台路线已经阻断，须留在当前位置重新决定'};
 if(a.action.type==='sleep'&&!a.action.buildingId){const assignments=w.rooms.beds[b.id]??={};assignments[r.id]=Number(key.slice(4));}
 if(r.inside!==b.id){if(r.at.x!==b.door.x||r.at.y!==b.door.y)return {moving:false,error:'对象的室内位置已经改变，须重新寻找实际入口'};r.inside=b.id;r.roomAt={...layout.entry};}
 r.roomAt??={...layout.entry};
 if(r.roomAt.x!==target.x||r.roomAt.y!==target.y){
  if(a.room&&(a.room.target.x!==target.x||a.room.target.y!==target.y))delete a.room;
  if(!a.room){const path=roomPath(layout,r.roomAt,target);if(path===null)return {moving:false,error:'室内入口至真实工位不可达'};a.room={buildingId:b.id,mode:'work',path,target,progress:0};}
  a.room.progress+=dt*movementRate(w,r);while(a.room.progress>=1&&a.room.path.length){const error=guardianRoomStepProblem(w,r,a.room.path[0]);if(error)return {moving:false,error};r.roomAt=a.room.path.shift()!;a.room.progress--;}
  if(a.room.path.length)return {moving:true};delete a.room;return {moving:true};
 }
 if(a.action.type==='sleep'&&!a.action.buildingId){const assignments=w.rooms.beds[b.id]??={};assignments[r.id]=Number(key.slice(4));}
 let error=claim(w,r,key,group,b.id,w.minute-dt,w.minute);
 if(!error&&a.action.type==='publicDuty'&&a.action.operation==='receive'&&key==='kitchen')error=claim(w,r,'table',group,b.id,w.minute-dt,w.minute);
 return error?{moving:false,error}:{moving:false};
}
export function prepareRoomExit(w:World,r:Resident,checkOnly=false):string|null{
 if(!w.rooms||!r.activity||!r.inside)return null;const work=actionRoom(w,r,r.activity);
 if(work?.building.id===r.inside&&r.activity.path.length===0)return null;
 if(r.activity.path.length===0&&['longCare','health','education','publicDuty','employment','civic','economy'].includes(r.activity.action.type)&&!work&&!(r.activity.action.type==='health'&&r.activity.action.phase==='delivery'&&r.activity.action.evacuationDestination==='safe-ground'))return null;
 if(r.activity.action.type==='socialAppointment'&&r.activity.action.operation!=='attend'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='pregnancyPreparation'&&r.activity.action.operation!=='attend'&&r.activity.path.length===0)return null;
 if(isWaterSupportAction(r.activity.action)&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='waterSupply'&&['load','drink','decant','serveChild'].includes(r.activity.action.operation)&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='production'&&['custodyOffer','custodyAccept','custodyReview','custodyObject','custodyEnd'].includes(r.activity.action.operation)&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='culture'&&r.activity.action.operation==='invite'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='social'&&['interpret','leave'].includes(r.activity.action.operation)&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='household'&&r.activity.action.operation==='notifyGift'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='funerary'&&r.activity.action.operation==='notify'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='familyRelocation'&&r.activity.action.operation!=='escort'&&r.activity.action.operation!=='returnChild'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='emergencyCare'&&r.activity.path.length===0){
  const action=r.activity.action;
  const boardWithdrawal=action.operation==='withdrawHelp'&&w.emergencyCare?.helpNotices?.some(n=>n.id===action.noticeId&&n.postedAt!==null);
  if(!['inspect','visitHelp','postHelp','sendHelp','readHelp'].includes(action.operation)&&!boardWithdrawal)return null;
 }
 if(r.activity.action.type==='adoption'&&r.activity.action.operation!=='register'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='design'&&r.activity.action.operation==='equip'&&r.activity.path.length===0)return null;
 if(r.activity.action.type==='personalFoodGift'&&r.activity.path.length===0&&(!['deliver','return'].includes(r.activity.action.operation)||w.personalFoodGifts?.gifts.find(c=>c.id===(r.activity!.action as Extract<import('../shared/types.js').Action,{giftId:string}>).giftId)?.location.inside===r.inside))return null;
 if(['shareFoodSource','adultPresence','agency','wait','eat','talk','propose','respond','separate','familyConsent','tendChild','care'].includes(r.activity.action.type)&&r.activity.path.length===0)return null;
 const plan=roomExitPlan(w,r);if('error' in plan)return plan.error;if(checkOnly)return null;
 if(plan.path.length)r.activity.room={buildingId:plan.buildingId,mode:'exit',target:plan.entry,path:plan.path,progress:0};
 else {r.inside=null;r.roomAt=null;delete r.activity.room;}
 return null;
}

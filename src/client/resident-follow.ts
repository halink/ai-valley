import {roomLayout} from '../shared/rooms.js';
import type {Resident,Vec,World} from '../shared/types.js';

export type FollowStopReason='missing'|'dead'|'outside'|'room-unavailable'|'position-unavailable';
export interface ResidentFollowState {
 worldId:string;
 personId:string;
 name:string;
 status:'following'|'stopped';
 roomId:string|null;
 roomName:string|null;
 precise:boolean;
 reason:FollowStopReason|null;
}
export type FollowTarget={roomId:string|null;roomName:string|null;precise:boolean}|{reason:FollowStopReason};
/** Optional viewing-space evidence. Ordinary 2D callers omit it and retain their original rules. */
export type ResidentFollowResolver=(world:World,id:string)=>FollowTarget|null;

export function roomPositionKnown(w:World,roomId:string|null|undefined,at:Vec|null|undefined):boolean {
 const b=roomId?w.buildings.find(b=>b.id===roomId):null;
 if(!w.rooms||!b||!at||!Number.isFinite(at.x)||!Number.isFinite(at.y))return false;
 const layout=roomLayout(w,b);
 return at.x>=0&&at.y>=0&&at.x<layout.width&&at.y<layout.height;
}
export function residentRoomPositionKnown(w:World,r:Resident):boolean {return roomPositionKnown(w,r.inside,r.roomAt);}

/** Resolve actual observer facts, never a plan, destination, home or outside journey. */
export function residentFollowTarget(w:World,id:string):FollowTarget {
 const r=w.residents.find(r=>r.id===id);
 if(!r)return {reason:'missing'};
 if(r.status==='dead')return {reason:'dead'};
 if(r.residency==='outside')return {reason:'outside'};
 if(r.inside){
  const b=w.buildings.find(b=>b.id===r.inside);
  if(!b)return {reason:'room-unavailable'};
  // Older worlds can identify a room without recording an exact indoor tile.
  const precise=residentRoomPositionKnown(w,r);
  return {roomId:b.id,roomName:b.name,precise};
 }
 if(!Number.isFinite(r.at.x)||!Number.isFinite(r.at.y)||r.at.x<0||r.at.y<0||r.at.x>=w.map.width||r.at.y>=w.map.height)return {reason:'position-unavailable'};
 return {roomId:null,roomName:null,precise:true};
}

/** Per-viewer state only. Losing a target requires another explicit follow to resume. */
export class ResidentFollow {
 state:ResidentFollowState|null=null;
 start(w:World,id:string,resolver?:ResidentFollowResolver|null){
  this.state={worldId:w.id,personId:id,name:w.residents.find(r=>r.id===id)?.name??id,status:'following',roomId:null,roomName:null,precise:false,reason:null};
  return this.observe(w,resolver);
 }
 clear(){this.state=null;}
 observe(w:World,resolver?:ResidentFollowResolver|null):Extract<FollowTarget,{roomId:string|null}>|null {
  const state=this.state;
  if(!state)return null;
  if(state.worldId!==w.id){this.clear();return null;}
  if(state.status==='stopped')return null;
  const r=w.residents.find(r=>r.id===state.personId);
  const target:FollowTarget=!r?{reason:'missing'}:r.status==='dead'?{reason:'dead'}:r.residency==='outside'?{reason:'outside'}:resolver?.(w,state.personId)??residentFollowTarget(w,state.personId);
  if('reason'in target){this.state={...state,name:r?.name??state.name,status:'stopped',reason:target.reason};return null;}
  this.state={...state,...target,name:r!.name};
  return target;
 }
}

export function residentFollowText(state:ResidentFollowState):string {
 if(state.status==='following')return state.roomId?`正在跟随 · ${state.roomName}${state.precise?'':' · 未记录室内精确位置，保留房间全景'}`:'正在跟随 · 室外';
 const reason={missing:'当前记录中找不到此人',dead:'此人已经离世',outside:'此人已离开谷内可观察区域','room-unavailable':'所在房间已不可观察','position-unavailable':'当前位置不在可观察地图内'}[state.reason??'missing'];
 return `跟随已停止：${reason}。镜头留在原处，可查阅记录或重新选择。`;
}

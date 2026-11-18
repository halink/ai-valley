import type {Resident,World} from '../shared/types.js';
import {mvpShelterRoom} from '../shared/rooms.js';
import {canObserveOutdoors} from './outdoor-observation.js';
import {findPath,same} from './navigation.js';
import {movementRate} from './health.js';
import {emitEvent} from './events.js';

export const SHELTER_WAIT=5;
// Shared with the ordinary idle fallback, not a new shelter tuning ceiling.
export const MVP_IDLE_WAIT_MINUTES=30;
const ENTRY_MINUTES=1;
export function shelterRoomWithinIdleTime(w:World,r:Resident,available=MVP_IDLE_WAIT_MINUTES){
 const room=mvpShelterRoom(w,r);const speed=movementRate(w,r);
 if(!room||!Number.isFinite(available)||available<ENTRY_MINUTES+SHELTER_WAIT||speed<=0)return null;
 const steps=Math.floor((available-ENTRY_MINUTES-SHELTER_WAIT)*speed+1e-9);
 return findPath(w,r.at,room.building.door,false,steps)!==null?room:null;
}
export function shelterPlanDeadline(w:World,r:Resident){
 const plan=r.plan;
 return plan&&Number.isFinite(plan.createdAt)&&plan.createdAt<=w.minute&&(!r.activity||r.activity.planId===plan.id)
  ?plan.createdAt+MVP_IDLE_WAIT_MINUTES:null;
}
export const SHELTER_UNAVAILABLE='共屋前室现在无法使用，避雨未完成';
export function validMvpShelter(a:object):boolean {return Object.keys(a).length===1&&Object.hasOwn(a,'type');}
export function personallyFeelsRain(w:World,r:Resident):boolean {
 const weather=w.mvpClimate;
 return !!weather&&weather.lastMinute===w.minute&&canObserveOutdoors(w,r)
  &&(weather.current.condition==='rain'||weather.current.condition==='mixed');
}
export function completeMvpShelter(w:World,r:Resident):string|null {
 const room=mvpShelterRoom(w,r),entered=r.activity?.mvpShelterEnteredAt;
 if(typeof entered!=='number'||!Number.isFinite(entered)||w.minute-entered+1e-8<SHELTER_WAIT||!room||r.inside!==room.building.id||!r.roomAt||!same(r.roomAt,room.target)||!same(r.at,room.building.door))return SHELTER_UNAVAILABLE;
 emitEvent(w,{kind:'action',actors:[r.id],roomId:room.building.id,roomAt:{...room.target},place:{...r.at},
  text:`${r.name}先前在户外察觉雨水，步行到达共屋前室，实际入内停留了${SHELTER_WAIT}游戏分钟。`});
 return null;
}

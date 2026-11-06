import {coLocated} from './proximity.js';
import {movementRate} from './health.js';
import type {Resident,World} from '../shared/types.js';
import {actionRoom,roomLayout,roomPath} from '../shared/rooms.js';
export function initializeRooms(w:World){if(w.mode==='formal')w.rooms??={tick:-1,claims:[],beds:{}};}
export function beginRoomTick(w:World){initializeRooms(w);if(!w.rooms)return;w.rooms.tick=w.minute;w.rooms.claims=[];
 for(const r of w.residents.filter(r=>r.status==='alive'&&r.activity&&r.activity.path.length===0&&!r.activity.room?.path.length).sort((a,b)=>a.activity!.startedAt-b.activity!.startedAt||a.id.localeCompare(b.id))){const slot=actionRoom(w,r,r.activity!);if(slot&&r.inside===slot.building.id&&r.roomAt?.x===slot.target.x&&r.roomAt?.y===slot.target.y)claim(w,r,slot.key,slot.group,slot.building.id);}
}
function claim(w:World,r:Resident,key:string,group:string,id:string):string|null {
 const state=w.rooms!;const prior=state.claims.find(c=>c.buildingId===id&&c.key===key);
 if(prior&&prior.group!==group)return '这处实际工位正在被另一项劳动占用';
 if(prior){if(!prior.people.includes(r.id))prior.people.push(r.id);}else state.claims.push({buildingId:id,key,group,people:[r.id]});return null;
}
/** Room movement consumes the same world minutes as outdoor walking. Work starts at the actual slot. */
export function moveInRoom(w:World,r:Resident,dt:number):{moving:boolean;error?:string}{
 if(!w.rooms||!r.activity)return {moving:false};const a=r.activity;
 if(a.room?.mode==='exit'){
  const journey=a.room;journey.progress+=dt*movementRate(w,r);while(journey.progress>=1&&journey.path.length){r.roomAt=journey.path.shift()!;journey.progress--;}
  if(!journey.path.length){r.inside=null;r.roomAt=null;delete a.room;}return {moving:true};
 }
 if(a.path.length)return {moving:false};const remembered=a.action.observedTarget;if(remembered){const p=w.residents.find(p=>p.id===remembered.id);if(p&&coLocated(w,r,p,10))a.action.observedTarget={id:p.id,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:w.minute};}const work=actionRoom(w,r,a);if(!work)return {moving:false};
 const {building:b,target,key,group}=work,layout=roomLayout(w,b);
 if(a.action.type==='sleep'){const assignments=w.rooms.beds[b.id]??={};assignments[r.id]=Number(key.slice(4));}
 if(r.inside!==b.id){if(r.at.x!==b.door.x||r.at.y!==b.door.y)return {moving:false,error:'对象的室内位置已经改变，须重新寻找实际入口'};r.inside=b.id;r.roomAt={...layout.entry};}
 r.roomAt??={...layout.entry};
 if(r.roomAt.x!==target.x||r.roomAt.y!==target.y){
  if(a.room&&(a.room.target.x!==target.x||a.room.target.y!==target.y))delete a.room;
  if(!a.room){const path=roomPath(layout,r.roomAt,target);if(path===null)return {moving:false,error:'室内入口至真实工位不可达'};a.room={buildingId:b.id,mode:'work',path,target,progress:0};}
  a.room.progress+=dt*movementRate(w,r);while(a.room.progress>=1&&a.room.path.length){r.roomAt=a.room.path.shift()!;a.room.progress--;}
  if(a.room.path.length)return {moving:true};delete a.room;return {moving:true};
 }
 if(a.action.type==='sleep'){const assignments=w.rooms.beds[b.id]??={};assignments[r.id]=Number(key.slice(4));}
 const error=claim(w,r,key,group,b.id);return error?{moving:false,error}:{moving:false};
}
export function prepareRoomExit(w:World,r:Resident){
 if(!w.rooms||!r.activity||!r.inside)return;const work=actionRoom(w,r,r.activity);
 if(work?.building.id===r.inside&&r.activity.path.length===0)return;
 if(r.activity.path.length===0&&['longCare','health','education','publicDuty','employment','civic','economy'].includes(r.activity.action.type)&&!work)return;
 if(r.activity.action.type==='culture'&&r.activity.action.operation==='invite'&&r.activity.path.length===0)return;
 if(r.activity.action.type==='social'&&['interpret','leave'].includes(r.activity.action.operation)&&r.activity.path.length===0)return;
 if(r.activity.action.type==='household'&&r.activity.action.operation==='notifyGift'&&r.activity.path.length===0)return;
 if(r.activity.action.type==='funerary'&&r.activity.action.operation==='notify'&&r.activity.path.length===0)return;
 if(r.activity.action.type==='adoption'&&r.activity.action.operation!=='register'&&r.activity.path.length===0)return;
 if(r.activity.action.type==='design'&&r.activity.action.operation==='equip'&&r.activity.path.length===0)return;
 if(['agency','wait','eat','talk','propose','respond','separate','familyConsent','tendChild','care'].includes(r.activity.action.type)&&r.activity.path.length===0)return;
 const b=w.buildings.find(b=>b.id===r.inside);if(!b){r.inside=null;r.roomAt=null;return;}
 const layout=roomLayout(w,b),path=roomPath(layout,r.roomAt??layout.entry,layout.entry);if(path?.length)r.activity.room={buildingId:b.id,mode:'exit',target:layout.entry,path,progress:0};else{r.inside=null;r.roomAt=null;}
}

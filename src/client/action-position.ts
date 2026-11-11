import type {Resident,Vec,World} from '../shared/types.js';
import {actionRoom} from '../shared/rooms.js';
import {waterAtShore} from '../world/fishing.js';

const point=(p:Vec|null|undefined):p is Vec=>!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y);
const same=(a:Vec,b:Vec)=>point(a)&&point(b)&&a.x===b.x&&a.y===b.y;
/** Read-only position evidence, not action validation or a claim of successful work. */
export function atActionPosition(w:World,r:Resident):boolean{
 const a=r.activity;
 if(!a||!point(r.at)||!point(a.target)||r.inside&&r.roomAt&&!point(r.roomAt)||a.path.length||a.room?.path.length||a.room?.mode==='exit')return false;
 const room=w.rooms?actionRoom(w,r,a):null;
 if(room)return r.inside===room.building.id&&!!r.roomAt&&same(r.roomAt,room.target);
 // Retained indoor journeys must never fall back to their outdoor doorway.
 if(a.room?.mode==='work')return r.inside===a.room.buildingId&&!!r.roomAt&&same(r.roomAt,a.room.target);
 if(w.rooms&&r.inside&&!r.roomAt)return false;
 if(a.action.type==='gather')return !r.inside&&Math.abs(r.at.x-a.target.x)+Math.abs(r.at.y-a.target.y)<=1;
 if(r.inside&&['plant','water','harvest','build','construction'].includes(a.action.type))return false;
 if(r.inside&&a.action.type==='industry'&&['fish','plantTree','tendTree','harvestFruit','cutTree','mine','deepen'].includes(a.action.operation))return false;
 return same(r.at,a.target);
}
/** Focus is expressed in the resident's current outdoor or room coordinate space. */
export function actionFocus(w:World,r:Resident):Vec|null{
 if(!atActionPosition(w,r))return null;
 const a=r.activity!,room=w.rooms?actionRoom(w,r,a):null;
 if(room)return {...room.target};
 if(a.room?.mode==='work')return {...a.room.target};
 if(a.action.type==='industry'&&a.action.operation==='fish'){
  const water=waterAtShore(w,a.target);return water?{...water}:null;
 }
 return {...(r.inside?r.roomAt??a.target:a.target)};
}

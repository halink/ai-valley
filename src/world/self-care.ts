import {goods} from '../shared/items.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import {residentBed,roomLayout,roomPath,sleepBuilding} from '../shared/rooms.js';
import type {Action,Resident,World} from '../shared/types.js';
import {findPath,same} from './navigation.js';

/** A narrow personal action vocabulary, not proof of any age or adult rights. */
export function isSelfCareAction(a:Action):boolean{return ['eat','sleep','wait','move'].includes(a.type);}

/** Current physical rights for an unknown-age person's own survival only.
 * Read-only: no bed allocation, food repair, birth-date or capacity inference.
 * Routes/work are still advanced by the ordinary engine, never teleported. */
export function selfCareReason(w:World,r:Resident,a:Action):string|null {
 if(r.status!=='alive'||r.residency==='outside'||!(r.health>0)||!r.canDecide||!r.canExpress)return '当前身体、决定或表达能力不支持本人自理';
 if(a.type==='eat')return Object.hasOwn(goods,a.item)&&goods[a.item].food>0&&Number.isFinite(r.inventory[a.item])&&(r.inventory[a.item]??0)>=1?null:'本人没有这份可食用的实际食品';
 if(a.type==='wait')return Number.isFinite(a.minutes)&&a.minutes>=1&&a.minutes<=720?null:'等待时长须在1–720分钟之间';
 if(a.type!=='sleep'&&a.type!=='move')return '年龄尚未核实，本人自理不授予其他行动权限';
 if(r.inside){
  const b=w.buildings.find(b=>b.id===r.inside);
  if(!b||!r.roomAt||!same(r.at,b.door))return '缺少本人当前真实室内位置';
  const layout=roomLayout(w,b);
  if(roomPath(layout,r.roomAt,r.roomAt)===null||layout.blocked.some(p=>same(p,r.roomAt!)))return '本人当前室内位置已阻断';
 }
 let target=a.type==='move'?a.to:r.at,bedBuilding:ReturnType<typeof sleepBuilding>;
 if(a.type==='sleep'){
  if(!Number.isFinite(a.minutes)||a.minutes<1||a.minutes>720)return '睡眠时长须在1–720分钟之间';
  const b=sleepBuilding(w,r,a);bedBuilding=b;
  if(!b||!r.knownBuildings.includes(b.id)||b.condition<=0)return '本人没有这处已知且仍有效的睡床使用权';
  const index=a.buildingId?commonsStay(w,r,b.id)?.bed??(residentialStay(w,r.id,b.id)?0:null):residentBed(w,r,b);
  if(index===null||index===undefined||!Number.isInteger(index)||index<0||index>=b.capacity)return '本人没有可使用的真实床位';
  const layout=roomLayout(w,b),slot=layout.slots.find(s=>s.key==='bed:'+index);
  if(!slot||roomPath(layout,r.inside===b.id?r.roomAt??{x:-1,y:-1}:layout.entry,slot.at)===null)return '本人当前位置至实际床位没有可达室内路线';
  target=b.door;
 }
 // An indoor position is not the outdoor door. Prove the exit before the
 // engine prepares a journey; a missing/blocked path must not become a teleport.
 if(r.inside&&r.inside!==bedBuilding?.id){
  const b=w.buildings.find(b=>b.id===r.inside);
  if(!b||!r.roomAt||!same(r.at,b.door))return '缺少本人当前真实室内位置';
  const layout=roomLayout(w,b);
  if(roomPath(layout,r.roomAt,layout.entry)===null)return '本人当前位置至房间出口没有可达路线';
 }
 if(!target||!Number.isInteger(target.x)||!Number.isInteger(target.y)||findPath(w,r.at,target)===null)return '目标目前没有实际可达路线';
 return null;
}

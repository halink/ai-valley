import {aboardFerry} from './ferry.js';
import type {Activity,Resident,World} from '../shared/types.js';import {coLocated} from './proximity.js';import {findPath} from './navigation.js';import {prepareRoomExit,roomExitReason} from './rooms.js';import {emitEvent} from './events.js';import {bodyBayAvailable} from './funerary.js';
/** Body and destination locks belong to actual arrangements; interruption never returns a body by teleport. */
export function reserveBody(w:World,r:Resident,a:Activity):string|null{
 const cargo=a.cargo;if(!cargo)return null;if(aboardFerry(w,cargo.bodyId))return '须先在实际靠泊码头卸下船上遗体';const p=w.residents.find(p=>p.id===cargo.bodyId),g=w.graves.find(g=>g.id===cargo.graveId);
 if(!p||p.status!=='dead'||w.graves.some(g=>g.personId===p.id))return '遗体状态已不适用';
 if(cargo.graveId&&(!g||g.personId)||!cargo.graveId&&(!cargo.storageId||!bodyBayAvailable(w,cargo.storageId,cargo.storageSlot!,p.id)))return '目的墓位或实际暂存位置已被占用';
 p.body??={reservedBy:null,carriedBy:null,storedAt:null};if(p.body.reservedBy&&p.body.reservedBy!==r.id||g?.reservedBy&&g.reservedBy!==r.id)return '已有另一位居民在实际办理这具遗体或墓位';
 p.body.reservedBy=r.id;if(g)g.reservedBy=r.id;cargo.pickupRemaining??=20;return null;
}
export function bodyPickup(w:World,r:Resident,dt:number):string|null{
 const a=r.activity,cargo=a?.cargo;if(!a||!cargo||cargo.pickedUp)return null;const p=w.residents.find(p=>p.id===cargo.bodyId),g=w.graves.find(g=>g.id===cargo.graveId),b=w.buildings.find(b=>b.id===cargo.storageId);
 if(!p||p.status!=='dead'||p.body?.reservedBy!==r.id||cargo.graveId&&(!g||g.personId||g.reservedBy!==r.id)||!cargo.graveId&&(!b||b.condition<=0||!bodyBayAvailable(w,b.id,cargo.storageSlot!,p.id))||!coLocated(w,r,p,1))return '须亲自进入遗体所在位置并继续持有本人实际搬运与接收安排';
 cargo.pickupRemaining=Math.max(0,(cargo.pickupRemaining??20)-dt);if(cargo.pickupRemaining>0)return null;const target=g?.at??b!.door,path=findPath(w,r.at,target,!!g);if(path===null)return '接收位置的通路已经阻断';
 // The legally picked-up body ceases to be an obstacle, but other bodies do not.
 if(r.inside&&(g||b?.id!==r.inside||path.length)){const view={...w,residents:w.residents.map(body=>body.id===p.id?{...body,body:{...body.body!,carriedBy:r.id,storedAt:null}}:body)};const error=roomExitReason(view,r);if(error)return error;}
 cargo.pickedUp=true;p.body!.carriedBy=r.id;p.body!.storedAt=null;p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;a.target={...target};a.path=path;a.travelProgress=0;const exitError=prepareRoomExit(w,r);if(exitError)return exitError;
 emitEvent(w,{kind:'burial',bodyLocation:{personId:p.id,at:{...p.at},roomId:p.inside,roomAt:p.roomAt?{...p.roomAt}:null},actors:[r.id,p.id],place:{...r.at},text:`${r.name}亲自走到${p.name}所在位置，完成20分钟搬运准备并接出遗体，尚未${g?'安葬':'送到暂存位置'}。`});return null;
}
export function syncBodies(w:World){for(const p of w.residents){const state=p.body;if(!state)continue;const r=w.residents.find(r=>r.id===state.reservedBy),a=r?.activity;
 if(state.reservedBy&&(!r||r.status!=='alive'||a?.cargo?.bodyId!==p.id)){const carried=!!state.carriedBy;state.reservedBy=null;state.carriedBy=null;if(carried)emitEvent(w,{kind:'burial',bodyLocation:{personId:p.id,at:{...p.at},roomId:p.inside,roomAt:p.roomAt?{...p.roomAt}:null},actors:[p.id,...(r?[r.id]:[])],place:{...p.at},text:`${p.name}的搬运中断，遗体保留在实际到达的位置，后续安置仍待办理。`});}
 if(state.carriedBy){if(r&&a?.cargo?.pickedUp){p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;}else state.carriedBy=null;}}
 for(const g of w.graves){if(!g.reservedBy)continue;const r=w.residents.find(r=>r.id===g.reservedBy);if(!r||r.status!=='alive'||r.activity?.cargo?.graveId!==g.id)g.reservedBy=null;}
}

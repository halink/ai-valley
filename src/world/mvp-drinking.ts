import type {World,Resident} from '../shared/types.js';
import {emitEvent} from './events.js';
/** Isolated MVP subset of design/world.md: 2 portions/day, no dehydration harm. */

export function isDrinkingMvp(w:World){return w.mode==='validation'&&w.id.startsWith('godot-mvp-')&&w.map.width===32&&w.map.height===24;}
/** Old MVP saves start hydrated at adoption; never invent pre-adoption debt/history. */
export function adoptMvpDrinking(w:World){
 if(!isDrinkingMvp(w))return;
 w.mvpDrinking??={version:1,adoptedAt:w.minute,thirst:{},consumed:{}};
 for(const r of w.residents){w.mvpDrinking.thirst[r.id]??=0;w.mvpDrinking.consumed[r.id]??=0;}
}
export function validateMvpDrinking(w:World){
 const state=w.mvpDrinking;if(state===undefined)return;
 if(!state||!isDrinkingMvp(w)||state.version!==1||!Number.isFinite(state.adoptedAt)||state.adoptedAt>w.minute||!state.thirst||!state.consumed||w.residents.some(r=>!Number.isFinite(state.thirst[r.id])||state.thirst[r.id]<0||state.thirst[r.id]>100||!Number.isSafeInteger(state.consumed[r.id])||state.consumed[r.id]<0))throw Error('godot_mvp_invalid_drinking_state');
}
export function mvpThirst(w:World,r:Resident){return isDrinkingMvp(w)?w.mvpDrinking?.thirst[r.id]:undefined;}
export function advanceMvpThirst(w:World,r:Resident,minutes:number){
 const value=mvpThirst(w,r);if(value!==undefined)w.mvpDrinking!.thirst[r.id]=Math.min(100,value+minutes*50/720);
}
export function mvpDrinkReason(w:World,r:Resident):string|null{
 const thirst=mvpThirst(w,r);
 if(thirst===undefined||!Number.isFinite(thirst)||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return '当前不支持本人自主饮水';
 if(thirst<50-1e-9)return '尚无一份饮水需求';
 if(!Number.isFinite(r.inventory.water)||(r.inventory.water??0)<1)return '没有携带一份实际清水';
 return null;
}
export function completeMvpDrink(w:World,r:Resident):string|null{
 const error=mvpDrinkReason(w,r);if(error)return error;
 const before=mvpThirst(w,r)!;r.inventory.water!-=1;
 w.mvpDrinking!.thirst[r.id]=Math.max(0,before-50);w.mvpDrinking!.consumed[r.id]++;
 emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},roomId:r.inside,roomAt:r.roomAt?{...r.roomAt}:null,text:`${r.name}自行饮用1份随身清水，库存实际扣减1份，口渴从${before.toFixed(2)}降至${w.mvpDrinking!.thirst[r.id].toFixed(2)}；MVP未启用缺水伤害。`});return null;
}

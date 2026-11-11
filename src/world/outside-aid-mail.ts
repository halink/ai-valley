import {carryChildHelpMail} from './child-help-mail.js';
import type {Resident,World} from '../shared/types.js';
import type {AidNotice} from '../shared/outside-aid.js';
import type {ForeignShipment} from '../shared/foreign-trade.js';
import {emitEvent,emitLedgerEvent} from './events.js';

export function initializeOutsideAid(w:World){if(w.mode==='formal')w.outsideAid??={notices:[],deliveries:[],nextSerial:1};}
/** Only a courier already executing an accepted outward shipment may carry the paper. */
export function carryAidMail(w:World,s:ForeignShipment,stage:'depart'|'arrive'|'return',crossedAt:number){
 carryChildHelpMail(w,s,stage,crossedAt);
 const state=w.outsideAid;if(!state)return;
 const merchant=w.foreignTrade?.merchants.find(m=>m.id===s.merchantId);if(!merchant)return;
 for(const n of state.notices){
  if(stage==='return'&&n.mail?.carrierKind!=='visitor'&&n.mail?.courierId===s.id&&n.mail.receivedAt===null){n.mail=null;n.eventIds.push(emitEvent(w,{kind:'care',actors:[],place:n.at,roomId:null,text:`货运 ${s.id} 的信使未到镇外便实际折返谷口，求助 ${n.id} 的原信退回交接点，仍需另一次既有信使路过。`}).id);}

  if(stage==='depart'&&!n.mail&&n.withdrawnAt===null&&n.postedAt<=crossedAt&&n.expiresAt>crossedAt){
   n.mail={courierId:s.id,merchantId:s.merchantId,pickedAt:crossedAt,receivedAt:null,reply:null};
   n.eventIds.push(emitEvent(w,{kind:'care',actors:[],place:n.at,roomId:null,text:`既有货运 ${s.id} 的信使实际经过谷口，带走${n.requesterName}的食品求助 ${n.id}，前往${merchant.origin}；镇外尚未收到。`}).id);
  }
  if(stage==='arrive'&&n.mail?.carrierKind!=='visitor'&&n.mail?.courierId===s.id&&n.mail.receivedAt===null){
   receiveAidMail(w,n,`货运 ${s.id} 信使`);
  }
 }
}

/** Called only after the bound carrier physically reaches this existing merchant's origin. */
export function receiveAidMail(w:World,n:AidNotice,source:string,carrier?:Resident){
 const mail=n.mail,m=mail&&w.foreignTrade?.merchants.find(m=>m.id===mail.merchantId);if(!mail||mail.receivedAt!==null||!m)return;
 mail.receivedAt=w.minute;const event=emitLedgerEvent(w,{kind:'care',actors:[m.id,...(carrier?[carrier.id]:[])],place:carrier?{...carrier.at}:n.at,...(carrier?.regionalLocation?{regionalLocation:{...carrier.regionalLocation}}:{}),text:`${m.name}实际收到由${source}带来的求助 ${n.id}：${n.requesterName}报告本人1人需要食品，交接地点为谷口（${n.at.x},${n.at.y}），联络截止第${n.expiresAt}分钟。是否应答须由商行自己决定。`});
 n.eventIds.push(event.id);m.person.memories.push({eventId:event.id,receivedAt:w.minute,source:'heard',text:event.text});m.person.revision++;m.person.decisionDue=Math.min(m.person.decisionDue,w.minute);
 if(carrier){carrier.memories.push({eventId:event.id,receivedAt:w.minute,source:'self',text:event.text});carrier.revision++;}
}

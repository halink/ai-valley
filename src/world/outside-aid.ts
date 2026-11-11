import {completeVisitorAid,visitorAidReason,visitorAidOpportunities} from './visitor-aid.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {AidDelivery,AidNotice,OutsideAidAction} from '../shared/outside-aid.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {foodTransaction} from './food.js';
import {outsideAidTransferAmount,recordFoodTransfer} from './food-consumption-evidence.js';
import {routeFood} from './food-routes.js';
import {advanceCargo} from './foreign-routing.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {distance,same,walkable} from './navigation.js';
import {ageYears,DAY} from './time.js';
import {initializeOutsideAid} from './outside-aid-mail.js';
export {initializeOutsideAid} from './outside-aid-mail.js';
const merchant=(w:World,id:string)=>w.foreignTrade?.merchants.find(m=>m.id===id);
const local=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=6;
const atGate=(w:World,r:Resident)=>!!w.foreignTrade&&!r.inside&&same(r.at,w.foreignTrade.station)&&walkable(w,r.at);
const nearGate=(w:World,r:Resident)=>!!w.foreignTrade&&!r.inside&&distance(r.at,w.foreignTrade.station)<=8;
const notice=(w:World,id?:string)=>w.outsideAid?.notices.find(n=>n.id===id);
const delivery=(w:World,id?:string)=>w.outsideAid?.deliveries.find(d=>d.id===id);
const validQuantity=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=1&&n<=4;
function remoteFact(w:World,n:AidNotice,d:AidDelivery|undefined,text:string){const m=merchant(w,d?.merchantId??n.mail!.merchantId)!,e=emitLedgerEvent(w,{kind:'care',actors:[m.id],place:n.at,text});(d??n).eventIds.push(e.id);m.person.memories.push({eventId:e.id,receivedAt:w.minute,source:'self',text});m.person.revision++;}
export function outsideAidReason(w:World,r:Resident,a:OutsideAidAction):string|null{
 if(['carryMail','continueMail','returnMail','eatMail','restMail'].includes(a.operation))return visitorAidReason(w,r,a);
 if(w.mode!=='formal'||!w.foreignTrade)return '当前没有既有驿路';
 const m=merchant(w,r.id),n=notice(w,a.noticeId),d=delivery(w,a.deliveryId);
 if(a.operation==='post'){
  if(!local(w,r)||!(nearGate(w,r)||w.foreignTrade.knownStationIds.includes(r.id)))return '须具备自主行动能力并知道谷口驿路';
  return w.outsideAid?.notices.some(n=>n.requesterId===r.id&&n.withdrawnAt===null&&n.expiresAt>w.minute)?'本人已有未结束的求助':null;
 }
 if(a.operation==='withdraw')return local(w,r)&&n?.requesterId===r.id&&n.withdrawnAt===null&&n.expiresAt>w.minute?null:'没有本人可撤回的求助';
 if(a.operation==='collect'){
  if(!local(w,r)||!d||d.residentId!==r.id||d.status!=='arrived'||!nearGate(w,r))return '本人尚未在谷口看到可领取的送达物资';
  const request=notice(w,d.noticeId)!;
  return request.withdrawnAt!==null||request.expiresAt<=w.minute?'原求助已经结束':(d.inventory[d.item]??0)<1?'实际送达食品已不足完整一份':null;
 }
 if(!m||m.person.status!=='alive'||!r.canDecide||!r.canExpress||m.work)return '须由当前能自主决定的商行本人应答';
 if(a.operation==='accept'||a.operation==='decline'){
  // The paper is immutable. A distant local withdrawal/death does not arrive by telepathy.
  if(!n||n.mail?.merchantId!==r.id||n.mail.receivedAt===null||n.mail.reply!==null||n.expiresAt<=w.minute)return '尚未收到可独立应答的求助信';
  if(a.operation==='decline')return null;
  return !a.item||!(goods[a.item]?.food>0)||!validQuantity(a.quantity)||(r.inventory[a.item]??0)<a.quantity?'本人原库没有这份完整可食物资':null;
 }
 if(!d||d.merchantId!==r.id||d.status!=='reserved')return '本人没有尚未发出的应援物资';
 if(a.operation==='cancel')return null;
 if(a.operation==='dispatch')return (d.inventory[d.item]??0)<d.quantity?'预留食品已损耗，须取消本次安排':notice(w,d.noticeId)!.expiresAt<=w.minute?'来信约定的联络时段已结束':null;
 return '未知求助行动';
}
export function outsideAidTarget(w:World,r:Resident,a:OutsideAidAction){const error=outsideAidReason(w,r,a);return {target:{...(w.foreignTrade?.station??r.at)},duration:5,...(error?{error}:{})};}
export function completeOutsideAid(w:World,r:Resident,a:OutsideAidAction):string|null{
 if(['carryMail','continueMail','returnMail','eatMail','restMail'].includes(a.operation))return completeVisitorAid(w,r,a);
 const error=outsideAidReason(w,r,a);if(error)return error;
 if(['post','withdraw','collect'].includes(a.operation)&&!atGate(w,r))return '须本人实际走到谷口交接点';
 initializeOutsideAid(w);const state=w.outsideAid!,n=notice(w,a.noticeId),d=delivery(w,a.deliveryId);
 const transferred=a.operation==='collect'?outsideAidTransferAmount(w,'aid:'+d!.id,d!.item,d!.inventory[d!.item]??0,d!.createdAt):undefined;
 return foodTransaction(w,()=>{
  if(a.operation==='post'){
   const id=`aid-notice:${w.id}:${state.nextSerial++}`,at={...w.foreignTrade!.station};
   const event=emitEvent(w,{kind:'care',actors:[r.id],place:at,text:`${r.name}在谷口张贴食品求助 ${id}：本人1人需要食品，未来三日可在此联系；只请求现物，不授予照护、住宿或监护权限。须有既有信使实际路过带走，再由镇外人独立应答。`});
   state.notices.push({id,requesterId:r.id,requesterName:r.name,at,knownPeople:1,need:'food',postedAt:w.minute,expiresAt:w.minute+3*DAY,withdrawnAt:null,eventIds:[event.id],mail:null});
  }else if(a.operation==='withdraw'){
   n!.withdrawnAt=w.minute;n!.eventIds.push(emitEvent(w,{kind:'care',actors:[r.id],place:n!.at,text:`${r.name}在谷口撤回求助 ${n!.id}；已带走的旧信不会被远程改写，之后到站的物资不再交付。`}).id);
  }else if(a.operation==='decline'){
   n!.mail!.reply='declined';remoteFact(w,n!,undefined,`${r.name}独立婉拒求助 ${n!.id}；没有发出物资，也没有向镇内瞬间传递答复。`);
  }else if(a.operation==='accept'){
   const id=`aid-delivery:${w.id}:${state.nextSerial++}`,inventory={[a.item!]:a.quantity!};
   routeFood(w,`person:${r.id}`,'aid:'+id,inventory);r.inventory[a.item!]!-=a.quantity!;
   const response:AidDelivery={id,noticeId:n!.id,merchantId:r.id,residentId:n!.requesterId,item:a.item!,quantity:a.quantity!,inventory,status:'reserved',createdAt:w.minute,departedAt:null,arrivedAt:null,collectedAt:null,collectedQuantity:null,stationAt:{...n!.at},arrivesAt:null,blockedSince:null,nextCheckAt:w.minute,eventIds:[]};
   state.deliveries.push(response);n!.mail!.reply='accepted';remoteFact(w,n!,response,`${r.name}自行应答求助 ${n!.id}，从本人原库预留${a.quantity}${itemLabels[a.item!]}；物资尚未发出，可另行选择发运或反悔取消。`);
  }else if(a.operation==='cancel'){
   returnStock(w,d!);remoteFact(w,notice(w,d!.noticeId)!,d,`${r.name}在发运前取消应援 ${d!.id}，原处剩余实物归回本人，不发生镇内交付。`);
  }else if(a.operation==='dispatch'){
   const minutes=merchant(w,r.id)!.routeMinutes;d!.status='travelling';d!.departedAt=w.minute;d!.arrivesAt=w.minute+minutes;d!.route={at:null,phase:'regionalIn',updatedAt:w.minute,dueAt:d!.arrivesAt,progress:0};
   remoteFact(w,notice(w,d!.noticeId)!,d,`${r.name}实际发出应援 ${d!.id} 的${d!.quantity}${itemLabels[d!.item]}，沿既有驿路约${minutes}分钟到谷口；断路会停留，原保质期继续。联络结束或交付被撤回时按原路退运，不授予照护、入住或监护。`);
  }else if(a.operation==='collect'){
   const amount=d!.inventory[d!.item]??0;routeFood(w,'aid:'+d!.id,'person:'+r.id,{[d!.item]:amount});r.inventory[d!.item]=(r.inventory[d!.item]??0)+amount;d!.inventory[d!.item]=0;d!.status='collected';d!.collectedAt=w.minute;d!.collectedQuantity=amount;
   const event=emitEvent(w,{kind:'care',actors:[r.id],place:d!.stationAt,text:`${r.name}亲自在谷口领取应援 ${d!.id} 剩余${amount}${itemLabels[d!.item]}（原发出${d!.quantity}份），原批次保质期不变；领取不等于进食，也不成立照护、定居或监护。`});
   d!.eventIds.push(event.id);
   if(transferred)recordFoodTransfer(w,{type:'transfer',action:'outsideAid',operation:'collect',at:w.minute,eventId:event.id,
    deliveryId:d!.id,noticeId:d!.noticeId,merchantId:d!.merchantId,recipientId:r.id,container:'aid:'+d!.id,destinationContainer:'person:'+r.id,amount:transferred});
  }
  return null;
 });
}
function returnStock(w:World,d:AidDelivery){const m=merchant(w,d.merchantId)!;routeFood(w,'aid:'+d.id,'person:'+m.id,d.inventory);for(const [key,n]of Object.entries(d.inventory)){const item=key as AidDelivery['item'];m.person.inventory[item]=(m.person.inventory[item]??0)+n!;}d.inventory={};d.status='returned';}
export function advanceOutsideAid(w:World){
 initializeOutsideAid(w);if(!w.outsideAid||w.clock.paused)return;
 for(const d of w.outsideAid.deliveries){
  const n=notice(w,d.noticeId)!,m=merchant(w,d.merchantId)!;
  if(d.status==='reserved'&&n.expiresAt<=w.minute){foodTransaction(w,()=>returnStock(w,d));remoteFact(w,n,d,`应援 ${d.id} 尚未发出而来信联络期已结束，原处剩余物资归回商行。`);}
  const blockedBefore=d.blockedSince;
  if(d.status==='travelling'&&advanceCargo(w,d)){
   d.status='arrived';d.arrivedAt=w.minute;d.eventIds.push(emitEvent(w,{kind:'care',actors:[],place:d.stationAt,roomId:null,text:`应援 ${d.id} 已实际到达谷口，剩余${d.inventory[d.item]??0}${itemLabels[d.item]}，等待求助本人亲自领取。`}).id);
  }
  if(d.status==='arrived'&&(n.withdrawnAt!==null||n.expiresAt<=w.minute)){
   d.status='returning';d.route={at:{...d.stationAt},phase:'localOut',updatedAt:w.minute,dueAt:w.minute,progress:0};
   d.eventIds.push(emitEvent(w,{kind:'care',actors:[],place:d.stationAt,roomId:null,text:`应援 ${d.id} 到站后发现求助已撤回或联络期结束，未领物资开始原路退运，不转移给其他人。`}).id);
  }
  if(d.status==='returning'&&advanceCargo(w,d)){foodTransaction(w,()=>returnStock(w,d));remoteFact(w,n,d,`应援 ${d.id} 退运实际抵达${m.origin}，仅剩余实物归回原库，途中损耗不补发。`);}
  if(blockedBefore===null&&d.blockedSince!==null)d.eventIds.push(emitLedgerEvent(w,{kind:'care',actors:[],place:d.stationAt,text:`应援 ${d.id} 在实际谷口通路受阻，当前货物停留在${d.route?.at?'谷口':'镇外驿路入口'}，不交付、不瞬间退库，保质期继续。`}).id);
  if(blockedBefore!==null&&d.blockedSince===null)d.eventIds.push(emitLedgerEvent(w,{kind:'care',actors:[],place:d.stationAt,text:`应援 ${d.id} 的谷口通路恢复，既定运输继续。`}).id);
 }
}
export function outsideAidOpportunities(w:World,r:Resident,suggestRequest=true):FormalOpportunity[]{
 if(!local(w,r)||!w.foreignTrade)return [];
 const choices:FormalOpportunity[]=[...visitorAidOpportunities(w,r)],add=(id:string,label:string,action:OutsideAidAction)=>{if(!outsideAidReason(w,r,action))choices.push({id:'aid.'+id,label,action});};
 // Distant requests are suggested for known food shortfalls; the gate keeps its physical posting option.
 if(nearGate(w,r)||suggestRequest&&w.foreignTrade.knownStationIds.includes(r.id))add('post','亲自到谷口发布本人一人的食品求助，三日联系期；只有既有信使路过才带走，镇外人可拒绝，不承诺救援',{type:'outsideAid',operation:'post'});
 for(const n of w.outsideAid?.notices??[])if(n.requesterId===r.id){add('withdraw.'+n.id,'亲自到谷口撤回自己的食品求助，已带走的旧信不会瞬间撤回',{type:'outsideAid',operation:'withdraw',noticeId:n.id});if(!nearGate(w,r)&&n.expiresAt>w.minute&&n.withdrawnAt===null)choices.push({id:'aid.visit.'+n.id,label:'回到自己公布的谷口交接点查看有无实际送达物资，不预知镇外答复或运输进度',action:{type:'move',to:{...n.at}}});}
 for(const d of w.outsideAid?.deliveries??[])add('collect.'+d.id,`到谷口亲自领取已送达本人名下的${d.inventory[d.item]??0}${itemLabels[d.item]}，随后须另选进食`,{type:'outsideAid',operation:'collect',deliveryId:d.id});
 return choices;
}
export function merchantAidOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const choices:FormalOpportunity[]=[],add=(id:string,label:string,action:OutsideAidAction)=>{if(!outsideAidReason(w,r,action))choices.push({id:'aid.'+id,label,action});};
 for(const n of (w.outsideAid?.notices??[]).filter(n=>n.mail?.merchantId===r.id&&n.mail.receivedAt!==null&&n.mail.reply===null&&n.expiresAt>w.minute).slice(0,4)){
  add('decline.'+n.id,`婉拒已收到的${n.requesterName}本人食品求助，不发出物资`,{type:'outsideAid',operation:'decline',noticeId:n.id});
  for(const item of itemKeys.filter(i=>goods[i].food>0&&(r.inventory[i]??0)>=1).slice(0,4))for(const quantity of [1,2,4])add(`accept.${n.id}.${item}.${quantity}`,`自愿预留本人${quantity}${itemLabels[item]}回应${n.requesterName}一人的来信；谷口（${n.at.x},${n.at.y}），截止第${n.expiresAt}分钟，尚须另选发运，不承担照护或监护`,{type:'outsideAid',operation:'accept',noticeId:n.id,item,quantity});
 }
 for(const d of w.outsideAid?.deliveries??[])if(d.merchantId===r.id&&d.status==='reserved'){
  add('dispatch.'+d.id,`实际发出已预留的${d.quantity}${itemLabels[d.item]}，沿既有驿路${merchant(w,r.id)!.routeMinutes}分钟到谷口，路阻会延误；到站联络结束则原路退运，保质期不重置`,{type:'outsideAid',operation:'dispatch',deliveryId:d.id});
  add('cancel.'+d.id,'反悔取消本人尚未发出的应援，保留原处实际剩余物资',{type:'outsideAid',operation:'cancel',deliveryId:d.id});
 }
 return choices;
}

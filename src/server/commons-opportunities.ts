import {canInspectCommonsFood,canReachCommonsTable} from '../world/commons-observation.js';
import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {CommonsAction} from '../shared/commons.js';
import {commonsStay} from '../shared/commons.js';
import {commonsFoodOptions,commonsWithdrawalLimit,commonsFoodRemaining,commonsReceiptId,commonsReason,canUseCommons} from '../world/commons.js';
import {itemKeys,itemLabels,goods} from '../shared/items.js';
export function commonsOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!canUseCommons(w,r))return [];
 const result:FormalOpportunity[]=[],receiptId=commonsReceiptId(w,r);
 const add=(a:CommonsAction,label:string)=>{if(!commonsReason(w,r,a))result.push({id:`commons.${a.operation}.${a.buildingId}.${'item'in a?a.item:''}${a.operation==='takeFood'&&a.reserveId?'.'+a.reserveId:''}`,label,action:a});};
 for(const a of commonsFoodOptions(w,r))if(a.operation==='takeFood')add(a,`按${a.reserveId?'已通过的储备议案':'开拓公约'}到${w.buildings.find(b=>b.id===a.buildingId)!.name}桌台自助领取1份现有${itemLabels[a.item]}，过去24小时剩余约${Math.floor(commonsFoodRemaining(w,r,commonsWithdrawalLimit(w,r,a)))}营养额度，路程另计，领后另选进食`);
 for(const b of w.buildings.filter(b=>b.kind==='lodge'&&b.ownerId==='commons'&&r.knownBuildings.includes(b.id))){
  if(!canReachCommonsTable(w,r,b))continue;
  if(!canInspectCommonsFood(w,r,b)){
   result.push({id:`commons.inspectFood.${b.id}`,label:`按自己记得的地址去${b.name}（${b.door.x},${b.door.y}）室内桌台核实口粮；当前库存、保质期和领取条件未知，告示不是现物，查看不领取，到场后另行决定，路况会变化`,action:{type:'commons',operation:'inspectFood',buildingId:b.id,receiptId}});continue;
  }
  add({type:'commons',operation:'borrowBed',buildingId:b.id,receiptId},`到${b.name}实际登记借用空床24小时；不改原家、监护或居留，睡眠须另选，无空床时失败`);
  add({type:'commons',operation:'releaseBed',buildingId:b.id,receiptId},`到${b.name}桌台交还本人的临时床位`);
  for(const item of itemKeys.filter(i=>goods[i].food>0&&(r.inventory[i]??0)>=1))add({type:'commons',operation:'donateFood',buildingId:b.id,item,quantity:1,receiptId},`自愿把1份自有${itemLabels[item]}亲自交入${b.name}公共库存，保留原保质期`);
 }
 const stay=commonsStay(w,r);if(stay)result.push({id:'commons.sleep.duration',label:`到本人在${w.buildings.find(b=>b.id===stay.buildingId)!.name}借用的第${stay.bed+1}张床睡觉，填写本人决定的 minutes（1–720分钟）；借床剩余${Math.ceil(stay.expiresAt-w.minute)}分钟，路程另计，到期停止`,action:{type:'sleep',buildingId:stay.buildingId,minutes:0},chooseDuration:true});
 return result;
}

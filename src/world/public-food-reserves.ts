import {reserveCommitted,procurementCapable} from './public-food-procurement.js';
import type {CivicAction,CivicMeasure,PublicFoodReserve} from '../shared/civic.js';
import type {Item,Resident,World} from '../shared/types.js';
import {goods,itemLabels} from '../shared/items.js';
import {roomLayout} from '../shared/rooms.js';
import {accountBalance,moveCoins} from './economy.js';
import {foodTransaction} from './food.js';
import {routeFood} from './food-routes.js';
import {emitEvent} from './events.js';
import {same} from './navigation.js';
import {DAY} from './time.js';

type ReserveMeasure=Extract<CivicMeasure,{kind:'foodReserve'}>;
type ReserveAction=Extract<CivicAction,{operation:'supplyReserve'|'openReserve'}>;
const integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export const reserveContainer=(id:string)=>'public-reserve:'+id;
export function reserveReceiptId(p:PublicFoodReserve){return `${p.id}:delivery:${p.receipts.length}`;}
export function publicStoresReserved(w:World,id:string){return !!w.civic?.budgets.some(b=>b.buildingId===id&&b.status==='active'&&b.expiresAt>w.minute)||!!w.duties?.shifts.some(s=>s.buildingId===id&&s.funding&&!s.funding.closed&&s.end>w.minute);}
/** The actual earliest lots must all survive, not just some later replacement lot. */
export function foodStockFresh(w:World,container:string,item:Item,quantity=1,at=w.minute){
 let left=quantity;for(const lot of [...(w.food?.lots[container]?.[item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt)){
  const n=Math.min(left,Math.max(0,lot.quantity));if(n>0&&(!Number.isFinite(lot.expiresAt)||lot.expiresAt<=at))return false;left-=n;if(left<=1e-9)return true;
 }return false;
}
export function reserveMeasureError(w:World,m:ReserveMeasure):string|null {
 if(!w.buildings.some(b=>b.id===m.buildingId&&b.ownerId==='commons'&&b.kind==='lodge'&&b.condition>0))return '储备须有真实、完好的公共共屋';
 if(!Object.hasOwn(goods,m.item)||goods[m.item].food<=0)return '储备限完整可食口粮，不得取用水、材料或种粮';
 if(!integer(m.quantity,1,200)||!integer(m.unitPrice,1,100)||!integer(m.suppliesBudget,0,1000)||!integer(m.dailyNutrition,1,200)||!integer(m.durationDays,1,28))return '储备入库上限1–200份、报价1–100钱、采购总额0–1000钱、个人24小时额度1–200营养，期限1–28日';
 if(m.foreignProcurement){const f=m.foreignProcurement;if(!f||typeof f!=='object'||Object.keys(f).some(k=>!['merchantId','handlerId'].includes(k))||!w.foreignTrade?.merchants.some(x=>x.id===f.merchantId&&x.person.status==='alive')||!procurementCapable(w,w.residents.find(r=>r.id===f.handlerId)))return '镇外采购须明确既有商人及有能力的成年经办人';}
 if(w.civic?.reserves?.some(p=>p.buildingId===m.buildingId&&p.status==='active'&&p.expiresAt>w.minute))return '本共屋已有仍有效的储备授权';
 return null;
}
export function authorizeFoodReserve(w:World,m:ReserveMeasure,proposalId:string):string|null {
 const error=reserveMeasureError(w,m);if(error)return error;
 if(accountBalance(w,'treasury')<m.suppliesBudget)return '公共金库没有足额未预留的钱款';
 const id=`food-reserve:${w.id}:${w.civic!.nextSerial++}`,supplyAccount=`escrow:${id}:supplies`;
 if(m.suppliesBudget>0&&!moveCoins(w,'treasury',supplyAccount,m.suppliesBudget,'公共储备采购授权',id+':authorize'))return '公共储备款未能预留';
 const p:PublicFoodReserve={...(m.foreignProcurement?{foreignProcurement:{...m.foreignProcurement,acquired:0,delivered:0}}:{}),id,proposalId,buildingId:m.buildingId,item:m.item,quantityLimit:m.quantity,unitPrice:m.unitPrice,dailyNutrition:m.dailyNutrition,startsAt:w.minute,expiresAt:w.minute+m.durationDays*DAY,status:'active',supplyAccount,suppliesLimit:m.suppliesBudget,spent:0,refunded:0,inventory:{},stocked:0,purchased:0,opened:0,withdrawn:0,receipts:[]};
 (w.civic!.reserves??=[]).push(p);return null;
}
export function reserveDeliveryReason(w:World,r:Resident,a:ReserveAction):string|null {
 const p=w.civic?.reserves?.find(p=>p.id===a.reserveId);
 if(!p||p.status!=='active'||p.startsAt>w.minute||p.expiresAt<=w.minute)return '储备采购与启用授权已失效';
 if(a.receiptId!==reserveReceiptId(p))return '这次储备交付选择已经完成或失效，请重新决定';
 if(!integer(a.quantity,1,12)||reserveCommitted(w,p)+a.quantity>p.quantityLimit)return '本次数量须为1–12份且不超过原累计入库上限';
 if(a.operation==='supplyReserve'){
  if((r.inventory[p.item]??0)<a.quantity||!foodStockFresh(w,'person:'+r.id,p.item,a.quantity))return '本人没有足额、未变质且已登记批次的口粮';
  return accountBalance(w,p.supplyAccount)>=a.quantity*p.unitPrice&&p.spent+a.quantity*p.unitPrice<=p.suppliesLimit?null:'储备采购余额不足';
 }
 if(publicStoresReserved(w,p.buildingId))return '原公共库存仍有有效预算或班次用途，不得移作储备';
 return (w.civic!.stores[p.buildingId]?.[p.item]??0)>=a.quantity&&foodStockFresh(w,'public:'+p.buildingId,p.item,a.quantity)?null:'原址没有足额、未变质的可启用现物';
}
/** Caller checks civic capability and locality; final settlement also requires the real indoor table. */
export function completeReserveDelivery(w:World,r:Resident,a:ReserveAction):string|null {
 const p=w.civic?.reserves?.find(p=>p.id===a.reserveId);
 const previous=p?.receipts.find(x=>x.id===a.receiptId);
 if(previous)return previous.personId===r.id&&previous.operation===a.operation&&previous.quantity===a.quantity?null:'原交付回执不属于本次行动';
 const error=reserveDeliveryReason(w,r,a);if(error)return error;
 const b=w.buildings.find(b=>b.id===p!.buildingId)!,table=roomLayout(w,b).slots.find(s=>s.key==='table')!;
 if(!same(r.at,b.door)||r.inside!==b.id||!r.roomAt||!same(r.roomAt,table.at))return '须亲自到共屋室内桌台交付或启用现物';
 const reserve=p!,coins=a.operation==='supplyReserve'?a.quantity*reserve.unitPrice:0,item=reserve.item;
 if(coins>0&&!moveCoins(w,reserve.supplyAccount,'resident:'+r.id,coins,'公共储备实物采购',a.receiptId))return '储备采购付款未能完成';
 const source=a.operation==='supplyReserve'?r.inventory:w.civic!.stores[b.id];source[item]!-=a.quantity;
 reserve.inventory[item]=(reserve.inventory[item]??0)+a.quantity;reserve.stocked+=a.quantity;
 if(a.operation==='supplyReserve'){reserve.purchased+=a.quantity;reserve.spent+=coins;w.civic!.totals.procurement+=coins;w.economy!.treasuryStock[item]=(w.economy!.treasuryStock[item]??0)+a.quantity;}
 else reserve.opened+=a.quantity;
 routeFood(w,a.operation==='supplyReserve'?'person:'+r.id:'public:'+b.id,reserveContainer(reserve.id),{[item]:a.quantity});
 reserve.receipts.push({id:a.receiptId,personId:r.id,operation:a.operation,quantity:a.quantity,coins,at:w.minute});
 emitEvent(w,{kind:'trade',actors:[r.id],place:{...b.door},roomId:b.id,roomAt:{...r.roomAt},text:`${r.name}在${b.name}桌台按已通过的储备议案${a.operation==='supplyReserve'?`实际交付自有${a.quantity}份${itemLabels[item]}，收到${coins}钱`:`将未承诺的公共${a.quantity}份${itemLabels[item]}原址分入储备` }；原批次期限不变，累计入库${reserve.stocked}/${reserve.quantityLimit}份。`});
 return null;
}
export function advanceFoodReserves(w:World):void {
 for(const p of w.civic?.reserves??[]){if(p.status!=='active'||p.expiresAt>w.minute)continue;
  foodTransaction(w,()=>{
   const balance=accountBalance(w,p.supplyAccount);
   if(balance>0&&!moveCoins(w,p.supplyAccount,'treasury',balance,'公共储备余款退回',p.id+':expiry-refund'))return;
   p.refunded+=balance;p.status='expired';
   const stock=w.civic!.stores[p.buildingId]??={},quantity=p.inventory[p.item]??0;
   if(quantity>0){stock[p.item]=(stock[p.item]??0)+quantity;w.civic!.stores[p.buildingId]=stock;routeFood(w,reserveContainer(p.id),'public:'+p.buildingId,{[p.item]:quantity});p.inventory[p.item]=0;}
   const b=w.buildings.find(b=>b.id===p.buildingId);
   emitEvent(w,{kind:'trade',actors:[],place:{...(b?.door??w.map.entrance)},text:`${b?.name??'原共屋'}的储备授权到期：未用${balance}钱退回金库，剩余${quantity}份${itemLabels[p.item]}按原议案解除专用、仍留原址公共库存，原保质期不变；再次采购仍须新表决。`});
  });
 }
}

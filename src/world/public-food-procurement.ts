import type {CivicAction,PublicFoodReserve} from '../shared/civic.js';
import type {ForeignAction,ForeignOffer,ForeignShipment} from '../shared/foreign-trade.js';
import type {Resident,World} from '../shared/types.js';
import {roomLayout} from '../shared/rooms.js';
import {accountBalance} from './economy.js';
import {foodStockFresh} from './public-food-reserves.js';
import {routeFood} from './food-routes.js';
import {same} from './navigation.js';
import {ageYears} from './time.js';
import {emitEvent} from './events.js';

export const procurementReserve=(w:World,id?:string)=>w.civic?.reserves?.find(p=>p.id===id);
export const procurementHandler=(w:World,p:PublicFoodReserve)=>w.residents.find(r=>r.id===p.foreignProcurement?.handlerId);
export function procurementCapable(w:World,r:Resident|undefined):boolean{return !!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;}
export function procurementLive(w:World,p:PublicFoodReserve|undefined):p is PublicFoodReserve {
 return !!p?.foreignProcurement&&p.status==='active'&&p.startsAt<=w.minute&&p.expiresAt>w.minute&&procurementCapable(w,procurementHandler(w,p))&&w.buildings.some(b=>b.id===p.buildingId&&b.ownerId==='commons'&&b.kind==='lodge'&&b.condition>0);
}
/** Bought cargo permanently consumes the mandate, even if it spoils before shelving. */
export function reserveCommitted(w:World,p:PublicFoodReserve){
 const f=p.foreignProcurement;
 return p.stocked+(f?f.acquired-f.delivered:0)+(w.foreignTrade?.offers.filter(o=>o.publicReserveId===p.id&&o.status==='open').reduce((n,o)=>n+o.remaining,0)??0)
  +(w.foreignTrade?.shipments.filter(s=>s.publicReserveId===p.id&&s.actualTax===null&&s.status!=='cancelled').reduce((n,s)=>n+s.quantity,0)??0);
}
/** Released public cash must never follow the handler into their purse or estate. */
export function procurementRefundAccount(w:World,id:string,n=0){
 const p=procurementReserve(w,id);
 if(p&&p.status==='active'&&p.expiresAt>w.minute)return p.supplyAccount;
 if(p)p.refunded+=n;
 return 'treasury';
}
export function procurementProposalReason(w:World,r:Resident,a:ForeignAction):string|null {
 const p=procurementReserve(w,a.reserveId),f=p?.foreignProcurement;
 if(!procurementLive(w,p)||!f||f.handlerId!==r.id||f.merchantId!==a.merchantId)return '没有交给本人的有效镇外公共储备采购授权';
 if(a.operation!=='propose'||a.side!=='import'||a.item!==p.item||a.deliveryId!==undefined||a.price!==p.unitPrice)return '公共采购仅限原食品、原商人、表决单价与谷口陆运交接，不得改约或另付运费';
 if(!Number.isSafeInteger(a.quantity)||a.quantity!<1||a.quantity!>12||reserveCommitted(w,p)+a.quantity!>p.quantityLimit)return '公共采购数量或含未完货单的累计额度不足';
 const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
 const gross=a.price!*a.quantity!,total=gross+Math.ceil(gross*rate/10000);
 return accountBalance(w,p.supplyAccount)>=total&&p.spent+total<=p.suppliesLimit?null:'公共采购实有余额不足以覆盖货款与税额';
}
export function publicOfferValid(w:World,o:ForeignOffer){const p=procurementReserve(w,o.publicReserveId);return procurementLive(w,p)&&p.foreignProcurement!.merchantId===o.merchantId&&p.foreignProcurement!.handlerId===o.residentId&&p.item===o.item&&p.unitPrice===o.price;}
export function publicShipmentValid(w:World,s:ForeignShipment){const p=procurementReserve(w,s.publicReserveId);return procurementLive(w,p)&&p.foreignProcurement!.merchantId===s.merchantId&&p.foreignProcurement!.handlerId===s.residentId&&p.item===s.item&&p.unitPrice===s.price;}
export function advancePublicCarrier(w:World,s:ForeignShipment){
 if(!s.publicReserveId||!s.publicCarrier||s.publicCarrier.sealed)return;
 const r=w.residents.find(r=>r.id===s.residentId);if(!r){s.publicCarrier.sealed=true;return;}
 s.publicCarrier={at:{...r.at},inside:r.inside,roomAt:r.roomAt?{...r.roomAt}:null,sealed:r.status==='dead'};
}
type Delivery=Extract<CivicAction,{operation:'deliverReserve'}>;
export function publicCargoDeliveryReason(w:World,r:Resident,a:Delivery):string|null {
 const p=procurementReserve(w,a.reserveId),s=w.foreignTrade?.shipments.find(s=>s.id===a.shipmentId);
 if(!p?.foreignProcurement||p.foreignProcurement.handlerId!==r.id||!procurementCapable(w,r))return '本人没有原公共货物的经办权';
 if(!s||s.publicReserveId!==p.id||s.residentId!==r.id||s.status!=='arrived'||s.actualTax===null||!s.publicCarrier||s.publicCarrier.sealed||s.goods<=0)return '没有本人实际携运且尚未入库的公共货物';
 if(!w.buildings.some(b=>b.id===p.buildingId&&b.ownerId==='commons'&&b.kind==='lodge'&&b.condition>0))return '原公共交付地点已不可用，公粮须继续原位保管';
 return foodStockFresh(w,'shipment:'+s.id,s.item,s.goods)?null:'携运公粮已变质，不能补发或重置保质期';
}
export function completePublicCargoDelivery(w:World,r:Resident,a:Delivery):string|null {
 const error=publicCargoDeliveryReason(w,r,a);if(error)return error;
 const p=procurementReserve(w,a.reserveId)!,s=w.foreignTrade!.shipments.find(s=>s.id===a.shipmentId)!,b=w.buildings.find(b=>b.id===p.buildingId)!,table=roomLayout(w,b).slots.find(s=>s.key==='table')!;
 if(!same(r.at,b.door)||r.inside!==b.id||!r.roomAt||!same(r.roomAt,table.at))return '须实际携带公粮到原共屋室内桌台交付';
 const q=s.goods,active=p.status==='active'&&p.expiresAt>w.minute;
 const bag=active?p.inventory:(w.civic!.stores[p.buildingId]??={});bag[s.item]=(bag[s.item]??0)+q;
 routeFood(w,'shipment:'+s.id,active?'public-reserve:'+p.id:'public:'+p.buildingId,{[s.item]:q});
 w.economy!.treasuryStock[s.item]=(w.economy!.treasuryStock[s.item]??0)+q;
 p.stocked+=q;p.foreignProcurement!.delivered+=q;s.goods=0;s.status='completed';
 p.receipts.push({id:'public-delivery:'+s.id,personId:r.id,operation:'deliverReserve',quantity:q,coins:0,at:w.minute});
 emitEvent(w,{kind:'trade',actors:[r.id],place:{...b.door},roomId:b.id,roomAt:{...r.roomAt},text:`${r.name}实际携运并交付${q}份镇外采购公粮至${b.name}${active?'独立储备货架':'原址一般公共库存'}，原批次、所有权与采购支出不变，不再次付款。`});
 return null;
}

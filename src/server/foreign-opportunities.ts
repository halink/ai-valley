import {reserveCommitted} from '../world/public-food-procurement.js';
import {accountBalance} from '../world/economy.js';
import {deliveryPoint,cargoStation,atCargoStation} from '../world/foreign-routing.js';
import type {FormalOpportunity,Item,Resident,World} from '../shared/types.js';
import type {ForeignAction} from '../shared/foreign-trade.js';
import {foreignItemNames,foreignReason,knowsForeignStation} from '../world/foreign-trade.js';
import {distance} from '../world/navigation.js';
import {ageYears} from '../world/time.js';

function local(w:World,r:Resident){return !!w.foreignTrade&&!r.inside&&distance(r.at,w.foreignTrade.station)<=8;}
export function foreignOpportunities(w:World,r:Resident):FormalOpportunity[]{
 const state=w.foreignTrade;if(!state||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<18)return [];
 const choices:FormalOpportunity[]=[];
 if(!local(w,r)&&knowsForeignStation(w,r))choices.push({id:'foreign.station',label:'去已知的谷口驿站看外地来信、报价和自己货物的运输记录',action:{type:'move',to:{...state.station}}});
 for(const shipment of state.shipments.filter(s=>!s.publicCarrier&&s.residentId===r.id&&s.readyAt<=w.minute&&!['completed','cancelled'].includes(s.status)))if(!atCargoStation(w,r,shipment))choices.push({id:'foreign.visit.'+shipment.id,label:'前往本人已签约的交接处查看这批货物的回执、办理发运或领取',action:{type:'move',to:{...cargoStation(w,shipment)}}});
 const add=(id:string,label:string,action:ForeignAction)=>{if(!foreignReason(w,r,action))choices.push({id:'foreign.'+id,label,action});};
 for(const s of state.shipments.filter(s=>s.residentId===r.id&&s.publicCarrier&&!s.publicCarrier.sealed&&s.goods>0)){const p=w.civic?.reserves?.find(p=>p.id===s.publicReserveId),b=w.buildings.find(b=>b.id===p?.buildingId);if(b)choices.push({id:'foreign.carryReserve.'+s.id,label:`实际携公粮前往${b.name}，仍须另选桌台交付，不能私人食用或出售`,action:{type:'move',to:{...b.door}}});}
 const rate=w.civic?.salesTax&&w.civic.salesTax.expiresAt>w.minute?w.civic.salesTax.basisPoints:0;
 for(const p of w.civic?.reserves??[]){const f=p.foreignProcurement;if(!f||f.handlerId!==r.id)continue;const quantity=Math.min(3,p.quantityLimit-reserveCommitted(w,p),Math.floor(accountBalance(w,p.supplyAccount)/(p.unitPrice*(1+rate/10000))));if(quantity<1)continue;const a:ForeignAction={type:'foreignTrade',operation:'propose',reserveId:p.id,merchantId:f.merchantId,side:'import',item:p.item,quantity,price:p.unitPrice,maximumLevyBasisPoints:rate};add('proposeReserve.'+p.id,`按原表决向指定商人协商采购${quantity}份${foreignItemNames[p.item]}公粮，固定每份${p.unitPrice}钱含既有陆运，另预留最高税额${Math.ceil(quantity*p.unitPrice*rate/10000)}钱；均只用原公共预算，商人另行接受，实际到站后自行携至原共屋。可填quantity 1–12，不得改价改商人`,a);}
 for(const s of state.shipments.filter(s=>s.residentId===r.id&&s.readyAt<=w.minute)){
  const m=state.merchants.find(m=>m.id===s.merchantId)!;
  add('dispatch.'+s.id,`亲自发出已协商的${s.quantity}份${foreignItemNames[s.item]}到${m.origin}，约${m.routeMinutes}分钟后结算${s.gross}钱货款，最高税额${s.maxTax}`,{type:'foreignTrade',operation:'dispatch',shipmentId:s.id});
  add('collect.'+s.id,`${s.publicReserveId?'作为原经办人领取并独立携运公粮，非私人库存；须另送原共屋后才可离谷。领取':'领取自己已经实际到站的'}${s.quantity}份${foreignItemNames[s.item]}${s.returned?'退货':''}`,{type:'foreignTrade',operation:'collect',shipmentId:s.id});
  add('recall.'+s.id,`撤回与${m.name}的${s.quantity}份${foreignItemNames[s.item]}运输，货物退回后按原归属退款`,{type:'foreignTrade',operation:'cancelShipment',shipmentId:s.id});
 }
 for(const o of state.offers.filter(o=>o.residentId===r.id&&o.status==='open'))add('cancel.'+o.id,`撤回自己${o.side==='import'?'进口':'出口'}${o.remaining}份${foreignItemNames[o.item]}、每份${o.price}钱的协商`,{type:'foreignTrade',operation:'cancelOffer',offerId:o.id});
 const visible=state.offers.filter(o=>local(w,r)&&o.initiatedBy==='merchant'&&o.status==='open'&&o.noticeAt<=w.minute&&o.expiresAt>w.minute);
 for(const o of visible.slice(0,12)){
  const m=state.merchants.find(m=>m.id===o.merchantId)!;
  add('accept.'+o.id,`${o.side==='import'?'向'+m.name+'订购':'按'+m.name+'的收购价出口'}${foreignItemNames[o.item]}（填写quantity 1–${o.remaining}，每份${o.price}钱，税率上限${rate/100}%，预留税额向上取整、实际交付按累计零头结算；${o.side==='import'?'实际到站后亲自领取':'先在驿站交货，回执确认后自行发货'}）`,{type:'foreignTrade',operation:'accept',offerId:o.id,quantity:1,quotedPrice:o.price,maximumLevyBasisPoints:rate});
 }
 // A proposal asks another autonomous person, and cannot reveal their unadvertised funds or stock.
 const proposals:FormalOpportunity[][]=[];
 const destinations=[undefined,...w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&b.ownerId===r.id).map(b=>b.id),...(w.infrastructure?.assets.filter(a=>a.kind==='dock').map(a=>a.id)??[])].filter(id=>{const d=deliveryPoint(w,r,id);return d&&atCargoStation(w,r,{stationAt:d.at});}).slice(0,2);
 for(const m of state.merchants)for(const deliveryId of destinations){
  const endpoint=deliveryPoint(w,r,deliveryId)!;
  const group:FormalOpportunity[]=[];
  for(const item of Object.keys(foreignItemNames) as Item[])for(const side of ['import','export'] as const){
   const action:ForeignAction={type:'foreignTrade',operation:'propose',merchantId:m.id,deliveryId,side,item,quantity:1,price:1,maximumLevyBasisPoints:rate};
   if(foreignReason(w,r,action))continue;
   group.push({id:`foreign.propose.${m.id}.${side}.${item}.${deliveryId??'gate'}`,label:`在${endpoint.name}向${m.name}提议${side==='import'?'购买':'出售'}${foreignItemNames[item]}（填写quantity 1–40、price每份1–1000；须对方另行同意，税率上限${rate/100}%，${side==='import'?'先预存自己的货款及最高税额':'先把自己的实物留在本交接处，镇内货物按实际陆路运送、封桥会延误'}）`,action});
  }
  proposals.push(group);
 }
 // Rotate items through a resident's successive visits without favoring one trade good forever.
 const offset=Math.floor(r.lastDecisionAt/120);
 for(let i=0;i<4;i++)for(const group of proposals)if(group.length)choices.push(group[((offset+i)%group.length+group.length)%group.length]);
 return choices;
}
export function foreignNotes(w:World,r:Resident):string {
 const state=w.foreignTrade;if(!state||!local(w,r)&&!state.shipments.some(s=>s.residentId===r.id&&atCargoStation(w,r,s)))return '';
 const own=state.shipments.filter(s=>s.residentId===r.id&&s.readyAt<=w.minute&&atCargoStation(w,r,s)&&!['completed','cancelled'].includes(s.status));
 const stages={ready:'回执已到，等待本人发货',inTransit:'正在运输',returning:'正在退运',arrived:'已经到站，等待本人领取',completed:'完成',cancelled:'已取消'};
 return `你在约定的交接处看到与${state.merchants.map(m=>m.name).join('、')}往来的信件。商行也独立决定报价、接受或拒绝，货物和钱款均为有限资产。${own.map(s=>`你登记的${s.quantity}份${foreignItemNames[s.item]}${s.publicCarrier?'仍由本人独立携运，非私人食品，须另送原共屋':stages[s.status]}${s.blockedSince!==null?'，沿途路口受阻，尚未结算':''}。`).join('')}`;
}
export function foreignChoiceFields(a:ForeignAction):string[]{
 if(a.operation==='propose'&&a.reserveId)return ['quantity'];
 if(a.operation==='post'||a.operation==='propose')return ['quantity','price'];
 if(a.operation==='produce')return ['feedLivestock','waterLivestock'].includes(a.recipe??'')?[]:['quantity'];
 if(a.operation==='accept'&&a.quotedPrice!==undefined)return ['quantity'];
 return [];
}
const aPublic=(a:ForeignAction)=>a.operation==='propose'&&!!a.reserveId;
export function parseForeignChoice(action:ForeignAction,data:Record<string,unknown>):ForeignAction {
 const result=structuredClone(action);
 for(const key of foreignChoiceFields(action)){
  const value=data[key],max=aPublic(action)?12:key==='price'?1000:action.operation==='produce'?12:40;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>max)throw new Error('invalid_foreign_quantity_or_price');
  if(key==='price')result.price=value;else result.quantity=value;
 }
 return result;
}

import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import type {FormalOpportunity,Resident,Vec,World} from '../shared/types.js';
import type {LandRightsAction} from '../shared/land-rights.js';
import type {PrivateLandParcel,PrivateLandSale} from '../shared/land-transfers.js';
import {inLand,landOverlap,reservedLandRights} from '../shared/land-rights.js';
import {retainedOutdoorSites} from '../shared/land-use.js';
import {productionParcels} from './production.js';
import {moveCoins} from './economy.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {distance,same,walkable} from './navigation.js';
import {ageYears,DAY} from './time.js';

export const isLandTransfer=(a:LandRightsAction)=>['offerParcel','buyParcel','cancelParcel','declineParcel','inspectParcelSale'].includes(a.operation);
const adult=(w:World,r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency==='resident'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const sales=(w:World)=>w.landRights?.transfers?.sales??[];
const access=(p:PrivateLandParcel):Vec=>({x:p.x+Math.floor(p.width/2),y:p.y+p.height});
const near=(w:World,r:Resident,at:Vec)=>!r.inside&&r.residency!=='outside'&&distance(r.at,at)<=1&&!w.ferries?.trips.some(t=>t.aboard.includes(r.id))&&!w.health?.transports.some(t=>t.patientId===r.id&&t.phase==='carrying')&&!travellingFamily(w,r.id)&&!familyPassenger(w,r.id);
const sameParcel=(a:PrivateLandParcel|undefined,b:PrivateLandParcel|undefined)=>!!a&&!!b&&a.ownerId===b.ownerId&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const footprint=(p:PrivateLandParcel)=>({at:{x:p.x,y:p.y},width:p.width,height:p.height});
const label=(s:Pick<PrivateLandSale,'parcelIndex'|'parcel'|'price'>)=>`私人地块#${s.parcelIndex+1} (${s.parcel.x},${s.parcel.y}) ${s.parcel.width}×${s.parcel.height}格，整块总价${s.price}钱`;
const statusNames={offered:'等待指定买方独立决定',sold:'已当面交款转移',cancelled:'卖方撤回',declined:'买方拒绝',expired:'报价到期',invalid:'原权利或空地条件变化，报价失效'};

export function initializeLandTransfers(w:World){
 if(w.mode!=='formal'||!w.landRights)return;
 w.landRights.transfers??={nextSerial:1,sales:[]};
 w.definitions['land/transfers@1']??={id:'land/transfers',version:1,kind:'action',dependencies:[],data:{offerMinutes:DAY,maxPrice:100000,scope:'已有空闲私人地块当面定向报价与独立接受；整块产权及有限价款交换，不含其他资产或劳动'}};
}

/** Refuse encumbrances instead of transferring somebody else's use, assets or commitments. */
export function privateParcelError(w:World,index:number,expected:PrivateLandParcel):string|null {
 const parcels=productionParcels(w),p=parcels[index];
 if(!Number.isSafeInteger(index)||index<0||!sameParcel(p,expected))return '原地块范围或唯一权利人已改变，须重新商议';
 if(![p.x,p.y,p.width,p.height].every(Number.isSafeInteger)||p.width<1||p.height<1||p.x<1||p.y<1||p.x+p.width>=w.map.width||p.y+p.height>=w.map.height)return '原私人地块边界无效';
 const rect=footprint(p),contains=(at:Vec)=>inLand(p,at);
 if(Object.values(w.production?.inheritances??{}).some(i=>i.shares.some(s=>s.claimedAt===null&&s.parcels.includes(index))))return '原地块仍有未领取的继承份额，不能替权利人出售';
 if(parcels.some((other,i)=>i!==index&&landOverlap(rect,footprint(other)))||reservedLandRights(w).some(a=>landOverlap(rect,a)))return '原地块与其他登记或有限权利重叠，不能出售';
 if(w.buildings.some(b=>landOverlap(rect,b)||contains(b.door))||Object.values(w.construction?.yards??{}).some(y=>landOverlap(rect,footprint({...y,ownerId:''}))))return '地块上有建筑、院落或住户出入口，不在空地出售范围';
 if(w.construction?.projects.some(c=>(landOverlap(rect,c)||c.door&&contains(c.door))&&(c.reserved||!['removed','cancelled'].includes(c.status)||c.stock.some(l=>l.quantity>0)||c.claims.some(l=>l.quantity>0)||Object.values(c.incorporated).some(n=>n!>0)))||w.industry?.pastureProjects?.some(c=>!['removed','completed'].includes(c.status)&&(landOverlap(rect,c)||contains(c.door))))return '地块仍有工程、材料或原约承诺，须先独立清结';
 if(w.industry?.pastures?.some(p=>p.status!=='retired'&&(p.tiles.some(contains)||p.gate&&[p.gate.inside,p.gate.outside].some(contains)))||w.plots.some(p=>contains(p.at)))return '地块已有牧场或农田，不能随空地转移';
 if(retainedOutdoorSites(w).some(contains)||w.graves.some(g=>contains(g.at)))return '地块仍有遗体、墓位或原址封存实物';
 if(w.infrastructure?.assets.some(s=>s.retiredAt===null&&[...s.tiles.map(t=>t.at),...(s.anchors??[s.access])].some(contains))||w.construction?.projects.some(c=>c.reserved&&c.terrain?.anchors.some(contains)))return '地块仍有公共通路或接入权';
 if(w.industry?.trees.some(t=>t.status!=='cut'&&contains(t.at))||w.industry?.animals.some(n=>n.status==='alive'&&!n.inside&&n.at&&contains(n.at)))return '地块仍有实际果树或牲畜，不在空地出售范围';
 if(w.resources.some(s=>contains(s.at)))return '地块含自然资源或水源，不在空地出售范围';
 for(let y=p.y;y<p.y+p.height;y++)for(let x=p.x;x<p.x+p.width;x++)if(w.map.tiles[y*w.map.width+x]!=='grass')return '地块含道路、水域或非空闲草地';
 if(!walkable(w,access(p)))return '原址办理入口不可达';
 return null;
}
function fact(w:World,s:PrivateLandSale,r:Resident,text:string){
 const e=emitEvent(w,{kind:'trade',actors:[r.id],place:{...s.access},text});s.eventIds.push(e.id);
 for(const id of [...e.witnesses,r.id])if(id===s.sellerId||id===s.buyerId)s.knownStatus[id]=s.status;
}
function invalidReason(w:World,s:PrivateLandSale):string|null {
 if(![s.sellerId,s.buyerId].every(id=>w.residents.some(r=>r.id===id&&r.status==='alive'&&r.residency==='resident')))return '原双方已无法继续这份当面约定；不向遗产、监护人或他人转约';
 return privateParcelError(w,s.parcelIndex,s.parcel);
}
export function advanceLandTransfers(w:World){
 initializeLandTransfers(w);
 for(const s of sales(w))if(s.status==='offered'){
  const expired=w.minute>=s.expiresAt,reason=expired?'原一日报价期限已到，不自动续约':invalidReason(w,s);if(!reason)continue;
  s.status=expired?'expired':'invalid';s.endedAt=w.minute;s.reason=reason;
  s.eventIds.push(emitLedgerEvent(w,{kind:'trade',actors:[],place:{...s.access},text:`${label(s)}：${reason}。没有扣款或转移地权；远方居民尚未获知现场变化。`}).id);
 }
}
export function landTransferReason(w:World,r:Resident,a:LandRightsAction):string|null {
 if(w.mode!=='formal'||!w.production||!adult(w,r))return '须由能自主决定的成年常住权利人亲自处理地块交易';
 if(a.operation==='offerParcel'){
  const p=a.parcel;if(!p||p.ownerId!==r.id||!Number.isSafeInteger(a.parcelIndex))return '只能报价本人原有的整块私人产权';
  const door=access(p);if(!near(w,r,door))return '须亲自到原私人地块入口当面报价';
  const buyer=w.residents.find(b=>b.id===a.buyerId);
  if(!adult(w,buyer)||buyer.id===r.id||!near(w,buyer,door))return '须有实际在场且能独立决定的指定成年常住买方';
  if(!Number.isSafeInteger(a.price)||a.price!<1||a.price!>100000)return '整块总价须为1–100000钱的整数';
  if(sales(w).some(s=>s.parcelIndex===a.parcelIndex&&s.status==='offered'&&w.minute<s.expiresAt))return '此地已有未结束的指定报价，请先撤回原报价';
  return privateParcelError(w,a.parcelIndex!,p);
 }
 const s=sales(w).find(s=>s.id===a.saleId);
 if(!s||![s.sellerId,s.buyerId].includes(r.id))return '没有发给本人的地块交易记录';
 if(!near(w,r,s.access))return '须本人回到记住的原地块入口办理；远方进展未知';
 if(a.operation==='inspectParcelSale')return null;
 if(s.status!=='offered'||w.minute>=s.expiresAt)return '原报价已结束或到期，旧选择不能成交';
 if(a.operation==='cancelParcel')return r.id===s.sellerId?null:'只有原卖方能撤回自己的报价';
 if(a.operation==='declineParcel')return r.id===s.buyerId?null:'只有指定买方能拒绝自己的报价';
 if(a.operation!=='buyParcel'||r.id!==s.buyerId)return '只有指定买方能独立接受原完整报价';
 const seller=w.residents.find(p=>p.id===s.sellerId);
 if(!adult(w,seller)||!near(w,seller,s.access))return '成交须原卖方仍能自主表达并实际在原址，不代替远方或失能者签约';
 const invalid=invalidReason(w,s);if(invalid)return invalid;
 if(!Number.isSafeInteger(r.coins)||r.coins<s.price)return '本人现款不足，不能负债或动用其他人的钱';
 if(!Number.isSafeInteger(seller.coins)||!Number.isSafeInteger(seller.coins+s.price))return '卖方钱账不能安全接收原价款';
 return null;
}
export function landTransferTarget(w:World,r:Resident,a:LandRightsAction){
 const error=landTransferReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 return {target:{...(a.operation==='offerParcel'?access(a.parcel!):sales(w).find(s=>s.id===a.saleId)!.access)},duration:a.operation==='offerParcel'||a.operation==='buyParcel'?10:5};
}
export function completeLandTransfer(w:World,r:Resident,a:LandRightsAction):string|null {
 initializeLandTransfers(w);const target=landTransferTarget(w,r,a);if(target.error)return target.error;
 if(r.inside||!same(r.at,target.target))return '须本人实际到达原地块入口完成办理';
 if(a.operation==='offerParcel'){
  const state=w.landRights!.transfers!,s:PrivateLandSale={id:`land-sale:${w.id}:${state.nextSerial++}`,parcelIndex:a.parcelIndex!,parcel:{...a.parcel!},access:{...target.target},sellerId:r.id,buyerId:a.buyerId!,price:a.price!,offeredAt:w.minute,expiresAt:w.minute+DAY,endedAt:null,status:'offered',knownStatus:{},eventIds:[],reason:null};
  state.sales.push(s);fact(w,s,r,`${r.name}在原址向${w.residents.find(b=>b.id===s.buyerId)!.name}提出${label(s)}的一日固定报价。报价不扣款、不预留或转移产权；买方须独立接受，双方须仍在原址，卖方可撤回。`);
 }else{
  const s=sales(w).find(s=>s.id===a.saleId)!;
  if(a.operation==='inspectParcelSale'){
   advanceLandTransfers(w);fact(w,s,r,`${r.name}亲自在原址核对${label(s)}：${statusNames[s.status]}。${s.reason??'原条款不变，接受不包含建筑、住户、库存或劳动。'}`);
  }else{
   if(a.operation==='buyParcel'){
    if(!moveCoins(w,`resident:${r.id}`,`resident:${s.sellerId}`,s.price,'private-land-sale',s.id))return '原价款未能结清，产权保持不变';
    w.production!.parcelOwners[s.parcelIndex]=r.id;s.status='sold';
   }else s.status=a.operation==='cancelParcel'?'cancelled':'declined';
   s.endedAt=w.minute;s.reason=a.operation==='buyParcel'?null:statusNames[s.status];
   fact(w,s,r,`${r.name}在原址${statusNames[s.status]}：${label(s)}。${s.status==='sold'?'原唯一产权转给买方，原开局定义不改；未转移房屋、农田、住户、其他资产或劳动。':'没有扣款或转移地权。'}`);
  }
 }
 r.revision++;w.revision++;return null;
}
export function landTransferOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!w.production||!adult(w,r))return [];
 const choices:FormalOpportunity[]=[],add=(id:string,text:string,a:LandRightsAction)=>{if(!landTransferReason(w,r,a))choices.push({id:'land.sale.'+id,label:text,action:a});};
 for(const s of sales(w).filter(s=>s.sellerId===r.id||s.buyerId===r.id)){
  if(!near(w,r,s.access)){
   if(s.knownStatus[r.id]==='offered'&&w.minute<s.expiresAt)choices.push({id:'land.sale.visit.'+s.id,label:`回到已约定地块入口(${s.access.x},${s.access.y})核对原${s.price}钱报价；不知远方进展或对方是否仍在`,action:{type:'move',to:{...s.access}}});
   continue;
  }
  if(s.knownStatus[r.id]!==s.status)add('inspect.'+s.id,`亲自核对原${label(s)}的记录，原价款及期限不变`,{type:'landRights',operation:'inspectParcelSale',saleId:s.id});
  add('buy.'+s.id,`本人接受${label(s)}；当面一次性付给原卖方，取得已有整块产权；不含建筑、农田、材料、住户或劳动`,{type:'landRights',operation:'buyParcel',saleId:s.id});
  add('decline.'+s.id,`拒绝原${label(s)}，不付款、不取得产权`,{type:'landRights',operation:'declineParcel',saleId:s.id});
  add('cancel.'+s.id,`撤回本人原${label(s)}的未成交报价，不扣款、不改变产权`,{type:'landRights',operation:'cancelParcel',saleId:s.id});
 }
 for(const [parcelIndex,p]of productionParcels(w).entries()){
  if(p.ownerId!==r.id||!near(w,r,access(p)))continue;
  for(const buyer of w.residents.filter(b=>b.id!==r.id&&adult(w,b)&&near(w,b,access(p))))add('offer.'+parcelIndex+'.'+buyer.id,`向在场的${buyer.name}提出本人私人地块#${parcelIndex+1} (${p.x},${p.y}) ${p.width}×${p.height}格的固定总价40钱（可填price 1–100000）；一日报价，不预扣款或代买方同意，成交须双方仍在原址`,{type:'landRights',operation:'offerParcel',parcelIndex,parcel:{...p},buyerId:buyer.id,price:40});
 }
 return choices;
}

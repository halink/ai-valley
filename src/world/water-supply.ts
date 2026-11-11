import {canInspectSpring,canContactSpring} from './spring-observation.js';
import {captureWaterSupplyFact} from './water-history.js';
import {isWaterSupportAction,isWaterSupportWithdrawal} from '../shared/water-support.js';
import {initializeWaterSupport,waterSupportReason,completeWaterSupport,waterSupportTogether} from './water-support.js';
import {fishingKey} from './fishing.js';
import type {Resident,Vec,World} from '../shared/types.js';
import type {WaterSupplyAction,WaterVessel} from '../shared/water-supply.js';
import {roomLayout} from '../shared/rooms.js';
import {currentPremisesLease,premisesWorkReason} from '../shared/premises.js';
import {publicKitchenReason} from './public-duties.js';
import {employmentKitchenReason} from './employment.js';
import {emitEvent} from './events.js';
import {distance,same,walkable} from './navigation.js';
import {ageYears,DAY} from './time.js';
import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';

export function initializeWaterSupply(w:World){if(w.mode!=='formal')return;w.waterSupply??={version:1,adoptedAt:w.minute,geography:[{width:w.map.width,height:w.map.height}],vessels:[],surfaceSources:[],receipts:[]};w.waterSupply.geography??=[{width:w.map.width,height:w.map.height}];initializeWaterSupport(w);}
export function waterReceiptId(w:World,r:Resident){return `water:${r.id}:${w.waterSupply?.receipts.filter(p=>p.actorId===r.id).length??0}`;}
export function waterDrunkToday(w:World,id:string){return w.waterSupply?.receipts.filter(p=>p.recipientId===id&&p.at>w.minute-DAY).reduce((n,p)=>n+p.quantity,0)??0;}
export const surfaceWaterId=(at:Vec)=>`surface:${at.x},${at.y}`;
/** Classify at the geography's original scale, never at a later enlarged map scale. */
export function isSurfaceWater(w:World,at:Vec){
 if(!Number.isInteger(at.x)||!Number.isInteger(at.y)||at.x<0||at.y<0||at.x>=w.map.width||at.y>=w.map.height||w.map.tiles[at.y*w.map.width+at.x]!=='water')return false;
 const habitat=w.industry?.fishing[fishingKey(at)]?.habitatBounds;
 const original=w.waterSupply?.geography.find(g=>at.x<g.width&&at.y<g.height);
 // Existing fishing records retain older boundaries when adopting an expanded legacy world.
 const candidates=[...(original?[original]:[]),...(habitat&&at.x<habitat.x&&at.y<habitat.y?[{width:habitat.x,height:habitat.y}]:[])].sort((a,b)=>a.width*a.height-b.width*b.height);
 const bounds=candidates[0];if(!bounds)return false;
 const {width,height}=bounds;
 if(width===undefined||height===undefined)return false; // Newly appended geography needs explicit registration.
 return !(at.y>=height*.7&&at.x>=width*.5);
}
/** Called only after an append-only region has passed its own proof and before commit. */
export function registerWaterGeography(w:World,width:number,height:number){
 if(w.waterSupply&&!w.waterSupply.geography.some(g=>g.width===width&&g.height===height))w.waterSupply.geography.push({width,height});
}
export function waterVessel(w:World,id:string){return w.waterSupply?.vessels.find(v=>v.id===id);}
const own=(r:Resident,v:WaterVessel|undefined)=>v?.ownerId===r.id&&v.buildingId===null;
const visibleSource=(r:Resident,at:Vec)=>r.inside===null&&distance(r.at,at)<=12;
const local=(r:Resident)=>r.status==='alive'&&r.residency!=='outside';
export function waterBuildingReason(w:World,r:Resident,id:string,kitchen=false,start=w.minute,end=w.minute+.000001):string|null {
 const b=w.buildings.find(b=>b.id===id);
 if(!w.rooms||!b||b.condition<=0||!r.knownBuildings.includes(id))return '尚无已知、完好且具备室内位置的用水场所';
 const home=b.residents.includes(r.id)&&r.homeId===b.id,common=b.ownerId==='commons'&&b.kind==='lodge',agreement=currentPremisesLease(w,id,start),lease=agreement?.tenantId===r.id&&(kitchen?agreement.terms.station==='kitchen':['table','bench'].includes(agreement.terms.station));
 if(!home&&!common&&!lease&&!(!kitchen&&b.ownerId===r.id))return '本人没有这处桌台或厨房的使用权';
 if(kitchen)return premisesWorkReason(w,r.id,id,'kitchen',start,end)??publicKitchenReason(w,r,id)??employmentKitchenReason(w,r,id);
 return premisesWorkReason(w,r.id,id,'table',start,end);
}
export function waterSupplyReason(w:World,r:Resident,a:WaterSupplyAction,start=w.minute,end=w.minute+.000001):string|null {
 if(w.mode!=='formal'||!w.waterSupply||!local(r)||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<6||!isWaterSupportWithdrawal(a)&&(aboardFerry(w,r.id)||passenger(w,r.id)||travellingFamily(w,r.id)||familyPassenger(w,r.id)))return '本人当前不能独立进行谷内供水行动';
 if(a.receiptId!==waterReceiptId(w,r))return '这次供水选择已经完成或失效，须重新决定';
 if(isWaterSupportAction(a))return waterSupportReason(w,r,a);
 if(!['craft','survey','fillSpring','fillSurface','load','boil','decant','drink','serveChild','donate','refillPublic','drinkPublic'].includes(a.operation))return '未知的供水行动';
 if(a.receiptId!==waterReceiptId(w,r))return '这次供水选择已经完成或失效，须重新决定';
 const adult=ageYears(r.bornAt,w.minute)>=18;
 if(!adult&&!['fillSpring','load','drink','drinkPublic'].includes(a.operation))return '这项制器、净水或供给行动需要成年人';
 if('quantity'in a&&(!Number.isSafeInteger(a.quantity)||a.quantity<1||a.quantity>(adult?6:3)))return '本次实际水量无效';
 if('buildingId'in a){const error=waterBuildingReason(w,r,a.buildingId,a.operation==='boil',start,end);if(error)return error;
  if(['donate','refillPublic','drinkPublic'].includes(a.operation)&&!w.buildings.some(b=>b.id===a.buildingId&&b.kind==='lodge'&&b.ownerId==='commons'))return '只有公共共屋可以接受这项自愿饮水供给';
 }
 if(a.operation==='craft')return (r.inventory.wood??0)<2?'本人缺少制桶所需的2份木材':(w.waterSupply.vessels.filter(v=>own(r,v)).length>=8?'本人已有8只随身水桶':null);
 if(a.operation==='survey'){
  if(r.inside!==null||!isSurfaceWater(w,a.at)||distance(r.at,a.at)>12)return '须在本人视野内找到真实水岸';
  return w.waterSupply.surfaceSources.some(s=>s.id===surfaceWaterId(a.at))?'这处原水点已经登记，不能重复增加水量':null;
 }
 const v=waterVessel(w,a.vesselId);
 if(a.operation==='drinkPublic'){
  if(!v||v.ownerId!=='commons'||v.buildingId!==a.buildingId||!v.donatedBy||v.quality!=='safe'||v.amount<1)return '本桌台没有实际捐赠的安全水';
  return waterDrunkToday(w,r.id)>=2?'本人过去24小时已饮用2份水，本阶段不重复消耗':null;
 }
 if(!own(r,v))return '本人没有携带这只自有水桶';
 if(a.operation==='fillSpring'||a.operation==='fillSurface'||a.operation==='load'){
  const quality=a.operation==='fillSurface'?'raw':'safe';
  if(v!.amount+a.quantity>v!.capacity||v!.amount>0&&v!.quality!==quality)return '水桶容量不足或不能混装原水和安全水';
  if(a.operation==='load')return (r.inventory.water??0)>=a.quantity?null:'本人旧有清水存量不足';
  if(a.operation==='fillSpring'){
   const s=w.resources.find(s=>s.id===a.sourceId&&s.kind==='spring');
   return !s||!canInspectSpring(w,r,s)?'尚未实际看到已知安全水源':s.floodDamage?.clearedAt===null?'泉水已淤塞，须退水后到场清理':s.amount<a.quantity?'本处有限泉水已经不足':null;
  }
  const s=w.waterSupply.surfaceSources.find(s=>s.id===a.sourceId);
  return !s||!visibleSource(r,s.at)||!isSurfaceWater(w,s.at)?'原水点已不在视野内或真实水域已改变':s.amount<a.quantity?'该原水点的已登记水量已经不足':null;
 }
 if(a.operation==='boil')return v!.quality!=='raw'||v!.amount<1?'桶内没有待煮沸的原水':(r.inventory.wood??0)<1?'煮沸一桶原水需要本人1份木材燃料':null;
 if(v!.quality!=='safe'||v!.amount<1)return '桶内没有足量安全水，原水须先煮沸';
 if(a.operation==='drink')return waterDrunkToday(w,r.id)>=2?'本人过去24小时已饮用2份水，本阶段不重复消耗':null;
 if(a.operation==='serveChild'){
  const p=w.residents.find(p=>p.id===a.targetId),age=p?ageYears(p.bornAt,w.minute):0;
  if(!p||!local(p)||age<1||age>=6||!p.guardianIds.includes(r.id)||p.refusesCare)return '没有对这名1至5岁幼儿仍有效且未被拒绝的监护照护权限';
  if(aboardFerry(w,p.id)||passenger(w,p.id)||travellingFamily(w,p.id)||familyPassenger(w,p.id))return '幼儿正在渡运或护送途中，须先实际结束运输再供水';
  // Share the same actual two-step reach as adult assistance and vessel delivery.
  // The menu, every work step and final transfer all recheck this live geometry.
  if(!waterSupportTogether(w,r,p))return '幼儿已不在现场可及位置，不能远程供水';
  return waterDrunkToday(w,p.id)>=2?'幼儿过去24小时已接受2份水，本阶段不重复消耗':null;
 }
 if(a.operation==='refillPublic'){
  const dest=waterVessel(w,a.publicVesselId);
  return !dest||dest.ownerId!=='commons'||dest.buildingId!==a.buildingId||!dest.donatedBy||dest.quality!=='safe'||dest.amount+a.quantity>dest.capacity||v!.amount<a.quantity?'原捐赠水桶不存在、容量不足或本人水量不足':null;
 }
 return null;
}
export function waterSupplyTarget(w:World,r:Resident,a:WaterSupplyAction){
 const error=waterSupplyReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 if(isWaterSupportWithdrawal(a))return {target:r.at,duration:0};
 if(a.operation==='survey')return {target:a.at,adjacent:true,duration:10};
 if(a.operation==='fillSpring')return {target:w.resources.find(s=>s.id===a.sourceId)!.at,adjacent:true,duration:2*a.quantity};
 if(a.operation==='fillSurface')return {target:w.waterSupply!.surfaceSources.find(s=>s.id===a.sourceId)!.at,adjacent:true,duration:3*a.quantity};
 if('buildingId'in a)return {target:w.buildings.find(b=>b.id===a.buildingId)!.door,duration:a.operation==='boil'?30:a.operation==='craft'?30:5};
 return {target:r.at,duration:5};
}
export function waterSupplyWorkReason(w:World,r:Resident,a:WaterSupplyAction,minutes:number){
 return waterSupplyReason(w,r,a,w.minute-minutes,w.minute);
}
/** Completion rechecks rights, quantities and actual standing place before one atomic transfer. */
export function completeWaterSupply(w:World,r:Resident,a:WaterSupplyAction,start=w.minute,end=w.minute+.000001):string|null {
 const prior=w.waterSupply?.receipts.find(p=>p.id===a.receiptId&&p.actorId===r.id);
 if(prior)return JSON.stringify(prior.action)===JSON.stringify(a)?null:'原供水回执不对应这项行动，不能复用';
 const error=waterSupplyReason(w,r,a,start,end);if(error)return error;
 const state=w.waterSupply!;
 if(isWaterSupportAction(a)){
  const finishFact=captureWaterSupplyFact(w,r,a);
  const result=completeWaterSupport(w,r,a);if(typeof result==='string')return result;
  state.receipts.push({action:structuredClone(a),id:a.receiptId,actorId:r.id,at:w.minute,operation:a.operation,quantity:result.quantity,...(result.recipientId?{recipientId:result.recipientId}:{}),...('vesselId'in a?{vesselId:a.vesselId}:{})});
  emitEvent(w,{waterSupply:finishFact(result.quantity,result.recipientId,result.counterpartyId),kind:result.audit?'care':'action',actors:[r.id,result.counterpartyId],place:{...r.at},roomId:r.inside,roomAt:r.roomAt?{...r.roomAt}:null,text:`${r.name}${result.text}。供水阶段未启用口渴或脱水。`,...(result.audit?{audit:result.audit}:{})});return null;
 }
 const target=waterSupplyTarget(w,r,a);
 if('buildingId'in a){
  const b=w.buildings.find(b=>b.id===a.buildingId)!,slot=roomLayout(w,b).slots.find(s=>s.key===(a.operation==='boil'?'kitchen':'table'));
  if(!slot||!same(r.at,b.door)||r.inside!==b.id||!r.roomAt||!same(r.roomAt,slot.at))return '须亲自到达有使用权的室内桌台或灶台';
 }else if(['survey','fillSpring','fillSurface'].includes(a.operation)){
  if(r.inside!==null||!walkable(w,r.at)||distance(r.at,target.target)>1||a.operation==='fillSpring'&&!canContactSpring(w,r,w.resources.find(s=>s.id===a.sourceId)!))return '须实际站在这处水源的可通行岸边';
 }
 const finishFact=captureWaterSupplyFact(w,r,a);
 const v='vesselId'in a?waterVessel(w,a.vesselId):undefined;let quantity=0,recipientId:string|undefined,text='';
 if(a.operation==='craft'){
  r.inventory.wood!-=2;state.vessels.push({id:a.receiptId,ownerId:r.id,buildingId:null,capacity:6,amount:0,quality:'safe',createdAt:w.minute});text='用2份自有木材制作了一只6份容量的空水桶';
 }else if(a.operation==='survey'){
  state.surfaceSources.push({id:surfaceWaterId(a.at),at:{...a.at},initial:24,amount:24,surveyedAt:w.minute,surveyedBy:r.id});text='在真实河岸登记一处24份原水的有限取水点；未抽取、未净化且不自动补水';
 }else if(a.operation==='fillSpring'||a.operation==='fillSurface'||a.operation==='load'){
  quantity=a.quantity;
  if(a.operation==='load')r.inventory.water!-=quantity;
  else if(a.operation==='fillSpring'){const s=w.resources.find(s=>s.id===a.sourceId)!;s.amount-=quantity;s.lastHarvest=w.minute;}
  else state.surfaceSources.find(s=>s.id===a.sourceId)!.amount-=quantity;
  v!.amount+=quantity;v!.quality=a.operation==='fillSurface'?'raw':'safe';text=`实际装入${quantity}份${v!.quality==='raw'?'尚不可饮的原水':'安全清水'}，桶内现有${v!.amount}/${v!.capacity}份`;
 }else if(a.operation==='boil'){
  quantity=v!.amount;r.inventory.wood!-=1;v!.quality='safe';text=`在有使用权的厨房用1份自有木材煮沸${quantity}份原水并冷却装回原桶，水量未增加`;
 }else if(a.operation==='decant'){
  quantity=v!.amount;r.inventory.water=(r.inventory.water??0)+quantity;v!.amount=0;text=`把桶内${quantity}份安全水转入本人原有清水库存，留作烹饪、灌溉或牲畜用水`;
 }else if(a.operation==='donate'){
  quantity=v!.amount;v!.ownerId='commons';v!.buildingId=a.buildingId;v!.donatedBy=r.id;v!.donatedAt=w.minute;text=`自愿把水桶及${quantity}份安全水放到共屋桌台，供到场者每日最多饮用2份；不改变其他公共物资权限`;
 }else if(a.operation==='refillPublic'){
  quantity=a.quantity;v!.amount-=quantity;waterVessel(w,a.publicVesselId)!.amount+=quantity;text=`把自有${quantity}份安全水实际补入共屋原捐赠水桶`;
 }else {
  quantity=1;recipientId=a.operation==='serveChild'?a.targetId:r.id;v!.amount--;text=a.operation==='serveChild'?`在场帮助受本人监护的幼儿${w.residents.find(p=>p.id===recipientId)!.name}饮用1份安全水`:`实际饮用1份${a.operation==='drinkPublic'?'自愿公共储备中的':'自有'}安全水`;
 }
 state.receipts.push({action:structuredClone(a),id:a.receiptId,actorId:r.id,at:w.minute,operation:a.operation,quantity,...(recipientId?{recipientId}:{}),...('vesselId'in a?{vesselId:a.vesselId}:{}),...('sourceId'in a?{sourceId:a.sourceId}:{}),...('buildingId'in a?{buildingId:a.buildingId}:{})});
 emitEvent(w,{waterSupply:finishFact(quantity,recipientId),kind:'action',actors:recipientId&&recipientId!==r.id?[r.id,recipientId]:[r.id],place:{...r.at},roomId:r.inside,roomAt:r.roomAt?{...r.roomAt}:null,text:`${r.name}${text}。供水阶段尚未启用口渴或脱水损耗。`});return null;
}

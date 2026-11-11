import {canInspectCommonsFood,canReachCommonsTable} from './commons-observation.js';
import {foodStockFresh,publicStoresReserved,reserveContainer} from './public-food-reserves.js';
import type {Activity,Building,Item,Resident,World} from '../shared/types.js';
import type {CommonsAction} from '../shared/commons.js';
import {commonsStay,leasedBed} from '../shared/commons.js';
import {goods,itemKeys,itemLabels} from '../shared/items.js';
import {actionRoom,roomLayout,roomPath,residentBed} from '../shared/rooms.js';
import {physiologyDefaults} from '../shared/physiology.js';
import {foodTransaction,foodValue} from './food.js';
import {routeFood} from './food-routes.js';
import {emitEvent} from './events.js';
import {ageYears,DAY} from './time.js';
import {distance,findPath,same} from './navigation.js';
import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';
import {movementRate} from './health.js';

export function initializeCommons(w:World){if(w.mode==='formal')w.commons??={version:1,adoptedAt:w.minute,stays:[],receipts:[]};}
export function advanceCommons(w:World){
 for(const s of w.commons?.stays??[]){if(s.endedAt!==null)continue;const r=w.residents.find(r=>r.id===s.residentId),b=w.buildings.find(b=>b.id===s.buildingId);
  const reason=s.expiresAt<=w.minute?'借床期限结束':!r||r.status!=='alive'||r.residency==='outside'?'借住人已离开或去世':!b||b.ownerId!=='commons'||b.kind!=='lodge'||b.condition<=0||s.bed>=b.capacity?'原床位或公共使用权已失效':null;
  if(reason){s.endedAt=w.minute;s.reason=reason;emitEvent(w,{kind:'action',actors:[s.residentId],place:{...(b?.door??r?.at??w.map.entrance)},text:`${r?.name??'原借住人'}在${b?.name??'原共屋'}的临时借床结束：${reason}；不改变原住处、财产或监护关系。`});}
 }
}
export function commonsReceiptId(w:World,r:Resident){return `commons:${r.id}:${w.commons?.receipts.filter(c=>c.residentId===r.id).length??0}`;}
export const canUseCommons=(w:World,r:Resident)=>w.mode==='formal'&&!!w.commons&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=6&&!aboardFerry(w,r.id)&&!passenger(w,r.id);
const lodge=(w:World,id:string)=>w.buildings.find(b=>b.id===id&&b.kind==='lodge'&&b.ownerId==='commons'&&b.condition>0);
/** Budget stores are not labelled by lot. Conservatively protect the whole place
 * while any current procurement or funded service can still use its supplies. */
export const commonsStockReserved=publicStoresReserved;
export function commonsFoodLimit(w:World,r:Resident){const rate=w.definitions[r.physiologyDefinition??'life/physiology@1']?.data.hungerPerMinute;return DAY*(typeof rate==='number'&&Number.isFinite(rate)&&rate>0?rate:physiologyDefaults.hungerPerMinute);}
export function commonsFoodRemaining(w:World,r:Resident,limit=commonsFoodLimit(w,r)){return Math.max(0,limit-(w.commons?.receipts.filter(c=>c.residentId===r.id&&c.operation==='takeFood'&&c.at>w.minute-DAY).reduce((n,c)=>n+c.nutrition,0)??0));}
export function commonsFoodFresh(w:World,id:string,item:Item,quantity=1,at=w.minute,reserveId?:string){return foodStockFresh(w,reserveId?reserveContainer(reserveId):'public:'+id,item,quantity,at);}
export function commonsFoodContainer(a:Extract<CommonsAction,{operation:'takeFood'}>){return a.reserveId?reserveContainer(a.reserveId):'public:'+a.buildingId;}
export function commonsWithdrawalLimit(w:World,r:Resident,a:Extract<CommonsAction,{operation:'takeFood'}>){return a.reserveId?w.civic?.reserves?.find(p=>p.id===a.reserveId)?.dailyNutrition??0:commonsFoodLimit(w,r);}
/** Reserve existing residents first, even if they have never slept. Do not take
 * beds promised to patients, physically occupied, or already leased. */
export function freeCommonsBed(w:World,r:Resident,b:Building):number|null {
 const taken=new Set<number>(),assigned=new Set<string>(),assignments=w.rooms?.beds[b.id]??{};
 for(const id of b.residents){const n=assignments[id];if(Number.isInteger(n)&&n>=0&&n<b.capacity&&!taken.has(n)){taken.add(n);assigned.add(id);}}
 for(const id of b.residents){if(assigned.has(id))continue;let n=0;while(taken.has(n))n++;taken.add(n);}
 const slots=roomLayout(w,b).slots.filter(s=>s.kind==='bed');
 for(const slot of slots){const n=Number(slot.key.slice(4));if(taken.has(n)||leasedBed(w,b.id,n))continue;
  if(w.rooms?.claims.some(c=>c.buildingId===b.id&&c.key===slot.key&&c.people.some(id=>id!==r.id)))continue;
  if(w.health?.transports.some(t=>t.buildingId===b.id&&t.bed===n&&t.phase==='carrying'))continue;
  if(n===0&&(w.health?.appointments.some(a=>a.buildingId===b.id&&a.status==='accepted'&&a.end>w.minute&&a.start<w.minute+DAY)||w.duties?.shifts.some(s=>s.buildingId===b.id&&s.role==='care'&&s.end>w.minute&&s.start<w.minute+DAY&&['booked','on-duty'].includes(s.status))))continue;
  if(w.residents.some(p=>p.id!==r.id&&(p.status==='alive'||!p.body?.carriedBy&&!w.graves.some(g=>g.personId===p.id))&&p.inside===b.id&&p.roomAt&&distance(p.roomAt,slot.at)<=1))continue;
  if(roomPath(roomLayout(w,b),roomLayout(w,b).entry,slot.at)===null)continue;return n;
 }return null;
}
export function commonsReason(w:World,r:Resident,a:CommonsAction):string|null {
 if(!canUseCommons(w,r))return '本人当前不能独立使用共屋自助入口';
 const b=lodge(w,a.buildingId);if(!b||!r.knownBuildings.includes(b.id))return '尚无已知、完好的公共共屋使用权';
 if(!w.rooms)return '共屋实际室内位置尚未登记';
 if(a.receiptId!==commonsReceiptId(w,r))return '这次自助选择已经失效或完成，请本人重新决定';
 if(a.operation==='inspectFood')return null;
 if(a.operation==='releaseBed')return commonsStay(w,r,b.id)?null:'本人没有仍有效的临时借床';
 if(a.operation==='borrowBed'){
  const home=w.buildings.find(p=>p.id===r.homeId&&p.condition>0&&p.residents.includes(r.id));
  if(commonsStay(w,r))return '本人已有尚未到期的临时借床';
  if(home){const bed=residentBed(w,r,home),layout=roomLayout(w,home),slot=layout.slots.find(s=>s.key==='bed:'+bed);if(slot&&findPath(w,r.at,home.door)!==null&&roomPath(layout,r.inside===home.id?r.roomAt??layout.entry:layout.entry,slot.at)!==null)return '本人已有可用自家床位，临时空床留给缺少床位的人';}
  return freeCommonsBed(w,r,b)===null?'共屋没有未被居住、医疗或其他借住占用的真实空床':null;
 }
 if(!Object.hasOwn(goods,a.item)||goods[a.item].food<=0)return '开拓公约只允许完整可食食品，不授予水、材料或种粮取用权';
 if(a.operation==='donateFood')return ageYears(r.bornAt,w.minute)<18?'未成年人不能通过本入口转让口粮':!Number.isSafeInteger(a.quantity)||a.quantity<1||a.quantity>20||(r.inventory[a.item]??0)<a.quantity?'本人实际捐赠食物不足或数量无效':null;
 if(a.reserveId){
  const p=w.civic?.reserves?.find(p=>p.id===a.reserveId&&p.buildingId===b.id&&p.item===a.item);
  if(!p||p.status!=='active'||p.startsAt>w.minute||p.expiresAt<=w.minute)return '该公共储备领取授权已失效';
  if((p.inventory[a.item]??0)<1||!commonsFoodFresh(w,b.id,a.item,1,w.minute,p.id))return '该储备没有已登记保质期的完整可食现物';
  return foodValue(w,reserveContainer(p.id),a.item)<=commonsFoodRemaining(w,r,p.dailyNutrition)+1e-9?null:'本人过去24小时的共同口粮额度不足这一完整份量';
 }
 if(commonsStockReserved(w,b.id))return '本处公共物资仍有有效预算或班次用途，不得改作自助口粮';
 if((w.civic?.stores[b.id]?.[a.item]??0)<1||!commonsFoodFresh(w,b.id,a.item))return '本处没有已登记保质期的完整可食现物';
 if(foodValue(w,'public:'+b.id,a.item)>commonsFoodRemaining(w,r)+1e-9)return '本人过去24小时的有限口粮额度不足这一完整份量';
 return null;
}
export function commonsTarget(w:World,r:Resident,a:CommonsAction){
 const b=lodge(w,a.buildingId);
 // A stale numbered choice is not a fresh remote inventory query.
 if(b&&!canReachCommonsTable(w,r,b))return {target:r.at,duration:0,error:'共屋实际室内桌台的路线不可达或正在被占用'};
 if(b&&a.operation==='takeFood'&&!canInspectCommonsFood(w,r,b))return {target:r.at,duration:0,error:'目前看不到共屋实际口粮，请先按已知地址到场核实'};
 const error=commonsReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 return {target:b!.door,duration:5};
}
/** Local inventory is only exposed where the actor can actually inspect it. */
export function commonsFoodOptions(w:World,r:Resident):CommonsAction[]{
 const out:CommonsAction[]=[];if(!canUseCommons(w,r))return out;
 for(const b of w.buildings){if(!canInspectCommonsFood(w,r,b)||!canReachCommonsTable(w,r,b))continue;
  for(const item of itemKeys.filter(i=>goods[i].food>0)){const a:CommonsAction={type:'commons',operation:'takeFood',buildingId:b.id,item,receiptId:commonsReceiptId(w,r)};if(!commonsReason(w,r,a))out.push(a);}
  for(const p of w.civic?.reserves?.filter(p=>p.buildingId===b.id)??[]){const a:CommonsAction={type:'commons',operation:'takeFood',buildingId:b.id,item:p.item,reserveId:p.id,receiptId:commonsReceiptId(w,r)};if(!commonsReason(w,r,a))out.push(a);}
 }return out;
}
export function completeCommons(w:World,r:Resident,a:CommonsAction):string|null {
 if(w.commons?.receipts.some(c=>c.id===a.receiptId&&c.residentId===r.id))return null;
 const error=commonsReason(w,r,a);if(error)return error;const b=lodge(w,a.buildingId)!,layout=roomLayout(w,b),table=layout.slots.find(s=>s.key==='table')!.at;
 if(!same(r.at,b.door)||r.inside!==b.id||!r.roomAt||!same(r.roomAt,table)||!canInspectCommonsFood(w,r,b)||!canReachCommonsTable(w,r,b))return '须实际走到共屋室内登记与取货桌台，位置和路线不能受阻';
 if(a.operation==='inspectFood'){
  emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},roomId:b.id,roomAt:{...r.roomAt},text:`${r.name}按已知地址实际走到${b.name}桌台查看；是否领取须按此刻看见的现物和本人额度另行决定，本次没有领取或进食。`});return null;
 }
 return foodTransaction(w,()=>{
  const current=commonsReason(w,r,a);if(current)return current;
  const reserve=a.operation==='takeFood'&&a.reserveId?w.civic!.reserves!.find(p=>p.id===a.reserveId):undefined;
  const stock=reserve?.inventory??(w.civic!.stores[b.id]??={}),inventory:Partial<Record<Item,number>>={};let nutrition=0,text='';
  if(a.operation==='takeFood'){
   nutrition=foodValue(w,commonsFoodContainer(a),a.item);if(reserve)reserve.withdrawn++;stock[a.item]=(stock[a.item]??0)-1;r.inventory[a.item]=(r.inventory[a.item]??0)+1;w.economy!.treasuryStock[a.item]=Math.max(0,(w.economy!.treasuryStock[a.item]??0)-1);inventory[a.item]=1;routeFood(w,commonsFoodContainer(a),'person:'+r.id,inventory);
   text=`${r.name}按${reserve?'已通过的储备议案':'开拓公约'}在${b.name}实际领取1份${itemLabels[a.item]}，记入个人滚动24小时口粮额度；领取不等于已经进食。`;
  }else if(a.operation==='donateFood'){
   r.inventory[a.item]!-=a.quantity;stock[a.item]=(stock[a.item]??0)+a.quantity;w.civic!.stores[b.id]=stock;w.economy!.treasuryStock[a.item]=(w.economy!.treasuryStock[a.item]??0)+a.quantity;inventory[a.item]=a.quantity;routeFood(w,'person:'+r.id,'public:'+b.id,inventory);
   text=`${r.name}自愿将自有${a.quantity}份${itemLabels[a.item]}实际交入${b.name}公共库存，保留原批次期限。`;
  }else if(a.operation==='borrowBed'){
   const bed=freeCommonsBed(w,r,b)!,expiresAt=Math.min(w.minute+DAY,...w.commons!.stays.filter(s=>s.residentId===r.id&&s.expiresAt>w.minute).map(s=>s.expiresAt));
   w.commons!.stays.push({id:a.receiptId,residentId:r.id,buildingId:b.id,bed,startedAt:w.minute,expiresAt,endedAt:null,reason:null});
   text=`${r.name}按开拓公约在${b.name}登记临时借用第${bed+1}张真实空床，${Math.ceil(expiresAt-w.minute)}分钟后结束（交还重借不延长原期限）；原住处、财产、居留与监护关系不变，睡眠仍须本人另选并走到床边。`;
  }else {const s=commonsStay(w,r,b.id)!;s.endedAt=w.minute;s.reason='本人交还临时床位';text=`${r.name}亲自到${b.name}交还临时床位。`;}
  w.commons!.receipts.push({id:a.receiptId,residentId:r.id,buildingId:b.id,operation:a.operation,at:w.minute,inventory,nutrition,limit:reserve?.dailyNutrition??commonsFoodLimit(w,r),...(reserve?{reserveId:reserve.id}:{})});
  emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},roomId:b.id,roomAt:{...r.roomAt!},text});return null;
 });
}
/** Read-only lower bound for the estate fallback: prove a local withdrawal and
 * subsequent meal can finish, retaining actual route, freshness and body loss. */
export function hasTimelyCommonsFood(w:World,r:Resident):boolean {
 const rate=movementRate({...w,definitions:{...w.definitions}},r);if(!(rate>0))return false;
 for(const a of commonsFoodOptions(w,r)){if(a.operation!=='takeFood')continue;const route=commonsTarget(w,r,a),path=findPath(w,r.at,route.target);if(path===null)continue;
  const activity:Activity={planId:'commons-preview',action:a,startedAt:w.minute,remaining:5,path,target:route.target,definition:w.activeDefinitions['action/routine']};
  const room=actionRoom(w,r,activity);if(!room)continue;const layout=roomLayout(w,room.building),inside=roomPath(layout,r.inside===room.building.id?r.roomAt??layout.entry:layout.entry,room.target);if(inside===null)continue;
  if(w.rooms?.claims.some(c=>c.buildingId===a.buildingId&&c.key===room.key&&c.group!==r.id))continue;
  if(w.residents.some(p=>p.id!==r.id&&[...(p.activity?[p.activity.action]:[]),...(p.plan?.actions??[])].some(q=>q.type==='commons'&&q.operation==='takeFood'&&q.buildingId===a.buildingId&&q.item===a.item)))continue;
  const minutes=Math.ceil((path.reduce((n,p)=>n+(w.map.tiles[p.y*w.map.width+p.x]==='road'?.75:1),0)+inside.length)/rate)+13;
  if(!commonsFoodFresh(w,a.buildingId,a.item,1,w.minute+minutes,a.reserveId)||a.reserveId&&w.civic!.reserves!.find(p=>p.id===a.reserveId)!.expiresAt<=w.minute+minutes)continue;
  const rules=w.definitions[r.physiologyDefinition??'life/physiology@1']?.data??physiologyDefaults;
  let hunger=r.hunger,energy=r.energy,health=r.health;
  for(let i=0;i<minutes;i++){hunger+=Number(rules.hungerPerMinute??physiologyDefaults.hungerPerMinute);energy-=Number(rules.energyPerMinute??physiologyDefaults.energyPerMinute);health-=(hunger>Number(rules.hungerDanger??physiologyDefaults.hungerDanger)?Number(rules.hungerHealthDrain??physiologyDefaults.hungerHealthDrain):0)+(energy<Number(rules.energyDanger??physiologyDefaults.energyDanger)?Number(rules.energyHealthDrain??physiologyDefaults.energyHealthDrain):0);}
  if(health>0)return true;
 }return false;
}

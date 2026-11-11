import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';
import {familyPassenger,travellingFamily} from '../shared/family-relocation.js';
import {roomPath} from '../shared/rooms.js';
import {roomLayout} from '../shared/rooms.js';
import type {Building,Resident,World} from '../shared/types.js';
import type {PremisesAction,PremisesLease,PremisesTerms} from '../shared/premises.js';
import {currentPremisesLease,premisesStationKey} from '../shared/premises.js';
import {accountBalance,initializeEconomy,moveCoins} from './economy.js';
import {hasReceipt} from './receipts.js';
import {ageYears,DAY} from './time.js';
import {distance,same} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {foodTransaction} from './food.js';

const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const adult=(w:World,r:Resident|undefined)=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=18;
const local=(r:Resident,b:Building)=>distance(r.at,b.door)<=8&&(r.inside===null||r.inside===b.id);
const stock=(bag:object)=>Object.values(bag).some(n=>typeof n==='number'&&n>0);
export function premisesTermsError(t:PremisesTerms|undefined):string|null {
 const money=t&&integer(t.days,2,28)&&integer(t.rentPerDay,1,100)&&integer(t.deposit,0,1000);
 if(money&&t.station==='bed'&&t.startMinute===0&&t.durationMinutes===DAY)return null;
 return money&&['table','kitchen','bench','forge','mill','dairy','loom','preserver'].includes(t.station)&&integer(t.startMinute,360,1200)&&integer(t.durationMinutes,30,720)&&t.startMinute+t.durationMinutes<=1380?null:'租期须2–28日、日租1–100钱、押金0–1000钱；住宅床位全天有效，经营工位每日须在06:00至23:00内且为30–720分钟';
}
export function premisesTermsLabel(t:PremisesTerms){return `${t.days}日，日租${t.rentPerDay}钱，押金${t.deposit}钱，共预存${t.days*t.rentPerDay+t.deposit}钱；${t.station==='bed'?'空屋单人住宿，固定第1张床全天可用；不含厨房、经营、永久入住或同住邀请':`${t.station}工位每天第${t.startMinute}至${t.startMinute+t.durationMinutes}分钟`}；只按已过租期计租，结束退还未挣租金和全部押金` ;}
function building(w:World,a:PremisesAction){const lease=w.economy?.leases?.find(l=>l.id===a.leaseId);return w.buildings.find(b=>b.id===(lease?.buildingId??a.buildingId));}
/** Empty private sites only: residential sleep or business labor, with no displaced promises. */
function siteError(w:World,b:Building,ownerId:string,terms:PremisesTerms,ignore?:string):string|null {
 // Death preserves homeId as history, not a living lodging right. Physical bodies and other claims are checked separately below.
 if(b.ownerId!==ownerId||b.ownerId==='commons'||b.condition<=0||!(terms.station==='bed'?b.kind==='home'&&b.capacity>0:['workshop','store'].includes(b.kind))||b.residents.length||w.residents.some(r=>r.status==='alive'&&r.homeId===b.id))return '只可出租本人完好的空住宅床位或非住宅工坊、店面，不能影响既有住户';
 if(terms.station==='bed'){
  const layout=roomLayout(w,b),bed=layout.slots.find(s=>s.key==='bed:0');
  if(!bed||roomPath(layout,layout.entry,bed.at)===null)return '原住宅第1张床实际不可达';
  if(w.residents.some(p=>p.inside===b.id)||w.rooms?.claims.some(c=>c.buildingId===b.id)||w.familyRelocation?.agreements.some(c=>c.buildingId===b.id&&!['completed','cancelled','expired'].includes(c.status))||w.commons?.stays.some(c=>c.buildingId===b.id&&c.endedAt===null&&c.expiresAt>w.minute))return '空屋仍有实际在场者、床位或家庭迁居约定，须先独立处理';
  if(w.health?.appointments.some(c=>c.buildingId===b.id&&['offered','accepted'].includes(c.status))||w.health?.transports.some(c=>c.buildingId===b.id&&c.phase==='carrying')||w.longCare?.agreements.some(c=>c.addressId===b.id&&['offered','awaitingChild','active'].includes(c.status))||w.household?.pools.some(c=>c.buildingId===b.id&&(['offered','open'].includes(c.status)||c.credits.some(credit=>credit.coins>0||stock(credit.inventory))||w.household!.gifts.some(g=>g.poolId===c.id&&['proposed','ready'].includes(g.status))))||w.production?.protectedCustody?.mandates.some(c=>c.scope.buildings.includes(b.id)&&['offered','active'].includes(c.status)))return '原住宅还有照护、共同财物或受保护财产权利，不能用租约替代';
 }
 if(w.economy?.relocations?.some(m=>m.toBuildingId===b.id&&['preparing','moving'].includes(m.status)))return '本址已有待完成的经营迁址承诺';
 if(w.economy?.leases?.some(l=>l.id!==ignore&&l.buildingId===b.id&&['offered','active'].includes(l.status)))return '本址已有尚未结束的租赁约定';
 if(!['table','kitchen','bed'].includes(terms.station)&&!w.industry?.stations.some(s=>s.buildingId===b.id&&s.kind===terms.station&&!(s.removalWorked!>0)))return '指定工位尚未实际安装或正在拆卸';
 if(w.economy?.businesses.some(s=>s.buildingId===b.id&&(s.closedAt===null||stock(s.inventory)))||w.industry?.batches.some(c=>c.buildingId===b.id&&c.status==='working')||w.employment?.contracts.some(c=>c.buildingId===b.id&&c.status==='active')||w.employment?.posts.some(p=>p.buildingId===b.id&&['open','offered'].includes(p.status)))return '原址还有经营、库存、在制品或聘用承诺，须由原当事人先处理';
 if(w.construction?.projects.some(p=>p.base?.id===b.id&&!['completed','cancelled','abandoned'].includes(p.status))||w.buildingMigrations?.some(m=>m.buildingId===b.id&&['offered','accepted'].includes(m.status)))return '原址还有建设或改版安排';
 if(w.education?.lessons.some(l=>l.buildingId===b.id&&l.status==='scheduled')||w.culture?.events.some(e=>e.buildingId===b.id&&['planned','held'].includes(e.status))||w.duties?.shifts.some(s=>s.buildingId===b.id&&['booked','on-duty'].includes(s.status))||w.residents.some(r=>r.activity&&r.activity.target&&same(r.activity.target,b.door)&&['industry','design','cook','build'].includes(r.activity.action.type)))return '原址仍有已承诺的课程、活动或正在进行的实际劳动';
 return null;
}
export function premisesReason(w:World,r:Resident,a:PremisesAction):string|null {
 if(w.mode!=='formal'||!w.economy||!adult(w,r)||aboardFerry(w,r.id)||passenger(w,r.id)||familyPassenger(w,r.id)||travellingFamily(w,r.id))return '本人当前不能签订或办理场所租赁';
 const l=w.economy.leases?.find(l=>l.id===a.leaseId),b=building(w,a);
 if(a.operation==='collect'){
  const batch=w.industry?.batches.find(c=>c.id===a.batchId&&c.ownerId===r.id&&c.status==='working');
  return batch&&r.knownBuildings.includes(batch.buildingId)&&w.buildings.some(b=>b.id===batch.buildingId)&&w.economy.leases?.some(l=>l.buildingId===batch.buildingId&&l.tenantId===r.id&&l.acceptedAt!==null)?null:'没有本人留在原租赁工位的未完批次';
 }
 if(!b||!r.knownBuildings.includes(b.id))return '没有本人已知的原租赁场所';
 if(a.operation==='offer'){
  const invalid=premisesTermsError(a.terms);if(invalid)return invalid;
  const tenant=w.residents.find(p=>p.id===a.tenantId);
  if(b.ownerId!==r.id||!adult(w,tenant)||tenant!.id===r.id||!r.knownPeople.includes(tenant!.id)||!local(r,b))return '产权人须亲自在已知场所向已知成年人提出具体租约';
  return siteError(w,b,r.id,a.terms!);
 }
 if(!l)return '没有这份原租约';
 if(premisesTermsError(l.terms))return '原租约条款无效，不能办理新确认';
 if(a.operation==='withdraw')return l.ownerId===r.id&&l.status==='offered'?null:'只能撤回本人尚未接受的租赁报价';
 if(a.operation==='decline')return l.tenantId===r.id&&l.status==='offered'&&local(r,b)?null:'须到原址查看并拒绝给本人的报价';
 if(a.operation==='surrender')return l.tenantId===r.id&&l.status==='active'?null:'只有承租人能提前交还本人有效租约';
 if(a.operation!=='accept'||l.status!=='offered'||l.tenantId!==r.id||l.offerExpiresAt<=w.minute||!local(r,b))return '须在原址独立接受给本人的未过期租赁报价';
 if(!adult(w,w.residents.find(p=>p.id===l.ownerId)))return '原出租人已不能履行这份尚未签订的报价';
 if(l.terms.station==='bed'&&w.economy.leases?.some(c=>c.id!==l.id&&c.tenantId===r.id&&c.terms.station==='bed'&&c.status==='active'))return '本人已有未结清的住宅租约';
 const invalid=siteError(w,b,l.ownerId,l.terms,l.id);if(invalid)return invalid;
 return r.coins>=l.terms.days*l.terms.rentPerDay+l.terms.deposit?null:'本人钱款不足以预存全期有限租金和押金';
}
export function premisesTarget(w:World,r:Resident,a:PremisesAction){
 const error=premisesReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const b=a.operation==='collect'?w.buildings.find(b=>b.id===w.industry?.batches.find(c=>c.id===a.batchId)?.buildingId):building(w,a);
 return {target:{...b!.door},duration:a.operation==='offer'?5:3};
}
function recipient(w:World,id:string){const r=w.residents.find(r=>r.id===id);return r?.status==='dead'?(w.estates.some(e=>e.personId===id)?`estate:${id}`:null):r?`resident:${id}`:null;}
function settle(w:World,l:PremisesLease,at:number):boolean {
 if(l.acceptedAt===null)return true;
 const elapsed=Math.max(0,Math.min(at,l.endsAt!)-l.acceptedAt),earned=Math.min(l.terms.days*l.terms.rentPerDay,Math.floor(elapsed*l.terms.rentPerDay/DAY+1e-8)),due=earned-l.paid;
 if(due){const target=recipient(w,l.ownerId);if(!target||!moveCoins(w,l.account,target,due,'有限场所租金',`${l.id}:rent:${earned}`))return false;l.paid=earned;}
 return true;
}
function end(w:World,l:PremisesLease,reason:string,at=w.minute){
 if(l.status!=='active')return;
 // Remember the boundary even if an estate account is not ready yet. No extra rent accrues.
 l.endedAt??=Math.min(at,l.endsAt!);l.reason??=reason;
 if(!settle(w,l,l.endedAt))return;
 const balance=accountBalance(w,l.account),target=recipient(w,l.tenantId);
 if(balance&&(!target||!moveCoins(w,l.account,target,balance,'租约未挣租金与押金退回',l.id+':refund')))return;
 l.refunded+=balance;l.status=l.endedAt>=l.endsAt!?'expired':'ended';
 emitLedgerEvent(w,{kind:'trade',actors:[l.ownerId,l.tenantId],place:w.buildings.find(b=>b.id===l.buildingId)?.door??{x:0,y:0},text:`场所租约结束：${reason}。实付租金${l.paid}钱，退还${l.refunded}钱，原址物资与已挣工资仍归各自权利人。`});
}
export function advancePremises(w:World){
 initializeEconomy(w);if(!w.economy)return;w.economy.leases??=[];
 for(const l of w.economy.leases){
  if(l.status==='offered'&&w.minute>=l.offerExpiresAt){l.status='expired';l.endedAt=l.offerExpiresAt;l.reason='报价到期，双方未签约';}
  if(l.status!=='active')continue;
  if(l.endedAt!==null)end(w,l,l.reason!,l.endedAt);
  else if(w.minute>=l.endsAt!)end(w,l,'约定租期届满',l.endsAt!);
  else if(!currentPremisesLease(w,l.buildingId))end(w,l,'原产权、建筑或承租人履约条件改变');
  else settle(w,l,w.minute);
 }
}
export function completePremises(w:World,r:Resident,a:PremisesAction):string|null {
 const mark=`premises:${r.activity?.planId??`${r.id}:${r.revision}:${w.revision}`}:${r.activity?.startedAt??w.minute}:${a.operation}`;
 if(hasReceipt(w,mark))return null;
 const target=premisesTarget(w,r,a);if(target.error)return target.error;if(!same(r.at,target.target))return '须亲自到原址办理或领取，不能远程转移实物';
 if(a.operation==='collect'){const c=w.industry!.batches.find(c=>c.id===a.batchId)!,b=w.buildings.find(b=>b.id===c.buildingId)!,key=c.recipe.station?'station:'+c.recipe.station:'table',slot=roomLayout(w,b).slots.find(s=>s.key===key);if(!slot||r.inside!==b.id||!r.roomAt||!same(r.roomAt,slot.at))return '须亲自走到原批次的真实室内工位领取';}
 const e=w.economy!;e.leases??=[];const l=e.leases.find(l=>l.id===a.leaseId);
 if(a.operation==='offer'){
  const id=`premises:${e.nextSerial++}`;e.leases.push({id,buildingId:a.buildingId!,ownerId:r.id,tenantId:a.tenantId!,terms:structuredClone(a.terms!),offeredAt:w.minute,offerExpiresAt:w.minute+2*DAY,acceptedAt:null,endsAt:null,status:'offered',endedAt:null,reason:null,account:'escrow:'+id,prepaid:0,paid:0,refunded:0});
 }else if(a.operation==='accept'){
  const total=l!.terms.days*l!.terms.rentPerDay+l!.terms.deposit;
  if(!moveCoins(w,`resident:${r.id}`,l!.account,total,'预存有限租金与押金',l!.id+':accept'))return '租金和押金未足额预存';
  l!.acceptedAt=w.minute;l!.endsAt=w.minute+l!.terms.days*DAY;l!.prepaid=total;l!.status='active';
 }else if(a.operation==='decline'||a.operation==='withdraw'){l!.status=a.operation==='decline'?'declined':'withdrawn';l!.endedAt=w.minute;}
 else if(a.operation==='surrender')end(w,l!,'承租人自行提前交还');
 else if(a.operation==='collect')foodTransaction(w,()=>{
  const batch=w.industry!.batches.find(c=>c.id===a.batchId)!;
  for(const [item,n]of Object.entries(batch.input))r.inventory[item as keyof typeof r.inventory]=(r.inventory[item as keyof typeof r.inventory]??0)+n!;
  batch.input={};batch.status='cancelled';
 });
 w.processed.push(mark);r.revision++;
 emitEvent(w,{kind:'trade',actors:[r.id],place:{...target.target},text:`${r.name}亲自在原址${({offer:'提出待对方独立确认的有限租约',accept:'接受租约并预存有限租金与押金',decline:'拒绝租赁报价',withdraw:'撤回未签订租赁报价',surrender:'提前交还租赁使用权',collect:'取回本人未完批次原料，原进度结束'} as const)[a.operation]}。${a.operation==='offer'?premisesTermsLabel(a.terms!):''}产权和他人的财物不变。`});
 return null;
}

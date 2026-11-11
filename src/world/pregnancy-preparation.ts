import type {Action,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {PregnancyPreparation,PregnancyPreparationAction} from '../shared/pregnancy-preparation.js';
import {isPregnancyWithdrawal} from '../shared/pregnancy-preparation.js';
import {residentBed,roomLayout,roomPath} from '../shared/rooms.js';
import {commonsStay,leasedBed} from '../shared/commons.js';
import {canObserve} from './knowledge.js';
import {socialSpace} from './relationships.js';
import {same,distance} from './navigation.js';
import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {advanceFood,foodTransaction} from './food.js';
import {routeFood} from './food-routes.js';
import {ageYears,DAY} from './time.js';

const person=(w:World,id:string)=>w.residents.find(r=>r.id===id);
const local=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside';
const capable=(w:World,r:Resident|undefined):r is Resident=>local(r)&&r.canDecide&&r.canExpress&&canObserve(w,r)&&ageYears(r.bornAt,w.minute)>=18;
const moving=(w:World,r:Resident)=>!!aboardFerry(w,r.id)||!!passenger(w,r.id)||!!travellingFamily(w,r.id)||!!familyPassenger(w,r.id);
const stopped=(c:PregnancyPreparation,id:string)=>c.stops.some(s=>s.personId===id);
const current=(w:World,c:PregnancyPreparation)=>{const p=person(w,c.gestatorId);return local(p)&&p.pregnancy?.conceivedAt===c.conceivedAt&&p.pregnancy.dueAt===c.dueAt&&!c.birth&&c.expiresAt>w.minute;};
const access=(w:World,r:Resident,id:string)=>{const b=w.buildings.find(b=>b.id===id);return !!b&&b.condition>0&&(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id)||!!commonsStay(w,r,id));};
const home=(w:World,p:Resident,id:string)=>w.buildings.find(b=>b.id===id&&p.homeId===id&&b.residents.includes(p.id)&&b.condition>0&&['home','lodge'].includes(b.kind));
export function initializePregnancyPreparation(w:World){if(w.mode==='formal')w.pregnancyPreparation??={arrangements:[],receipts:[]};}
export function pregnancyReceiptId(w:World,r:Resident){return `pregnancy:${r.id}:${w.pregnancyPreparation?.receipts.filter(a=>a.actorId===r.id).length??0}`;}
function arrangement(w:World,a:PregnancyPreparationAction){return 'arrangementId'in a?w.pregnancyPreparation?.arrangements.find(c=>c.id===a.arrangementId):undefined;}
export function pregnancyPlace(w:World,c:PregnancyPreparation){
 const p=person(w,c.gestatorId),b=p&&home(w,p,c.buildingId);if(!p||!b||!same(b.door,c.door)||residentBed(w,p,b)!==c.bed||leasedBed(w,b.id,c.bed,p.id))return null;
 const layout=roomLayout(w,b),bed=layout.slots.find(s=>s.key==='bed:'+c.bed);if(!bed||roomPath(layout,layout.entry,bed.at)===null)return null;
 // An accepted plan never overrides a medical reservation or another body occupying the bed.
 if(w.health?.transports.some(t=>t.buildingId===b.id&&t.bed===c.bed&&t.phase==='carrying'))return null;
 if(w.rooms?.tick===w.minute&&w.rooms.claims.some(s=>s.buildingId===b.id&&s.key==='bed:'+c.bed&&s.group!==p.id))return null;
 if(w.residents.some(r=>r.id!==p.id&&r.inside===b.id&&r.roomAt&&same(r.roomAt,bed.at)))return null;
 return {building:b,bed:bed.at,care:{x:bed.at.x+1,y:bed.at.y}};
}
function together(w:World,a:Resident,b:Resident,id:string){return a.inside===id&&!!a.roomAt&&!!b.roomAt&&!moving(w,a)&&!moving(w,b)&&socialSpace(w,a,b);}
function active(c:PregnancyPreparation){return c.acceptedAt!==null&&c.providerId!==null&&!stopped(c,c.providerId)&&!stopped(c,c.gestatorId);}
export function pregnancyReason(w:World,r:Resident,a:PregnancyPreparationAction,physical=true):string|null {
 if(!w.pregnancyPreparation)return '孕期准备登记尚未接通';
 if(isPregnancyWithdrawal(a)){
  const c=arrangement(w,a);return c&&[c.gestatorId,c.providerId].includes(r.id)&&!stopped(c,r.id)&&c.expiresAt>w.minute&&(a.operation!=='decline'||c.providerId===r.id&&c.acceptedAt===null)?null:'没有本人尚可停止的孕期安排';
 }
 if(!capable(w,r)||moving(w,r))return '本人须清醒、成年并具完整决定与表达能力，不能在护送或同行途中办理';
 if(a.operation==='prepare'){
  const b=home(w,r,a.buildingId),p=a.providerId?person(w,a.providerId):undefined;
  if(!r.pregnancy||r.pregnancy.dueAt<=w.minute||r.refusesCare||!b||r.inside!==b.id||!r.roomAt)return '孕育者须在本人有登记居住权的完好住房内，亲自选择已有床位';
  const bed=residentBed(w,r,b);if(bed===null)return '本人没有实际可用的床位';
  if(w.pregnancyPreparation.arrangements.some(c=>c.gestatorId===r.id&&c.conceivedAt===r.pregnancy!.conceivedAt&&!stopped(c,r.id)&&c.expiresAt>w.minute&&!c.birth))return '请先本人撤回原安排，再重新选择地点或照护者';
  if(a.providerId&&(!capable(w,p)||p.id===r.id||p.skills.care<1||p.health<=30||p.energy<10||!access(w,p,b.id)||!together(w,r,p,b.id)))return '指定照护者须成年、清醒、有基础照护能力且在有权使用的同一现场；提议不替其同意';
  const c={gestatorId:r.id,buildingId:b.id,bed,door:b.door} as PregnancyPreparation;
  return pregnancyPlace(w,c)?null:'该床位被占用、预留或实际不可达';
 }
 const c=arrangement(w,a);
 if(a.operation==='attend'&&!physical){
  if(!c||c.providerId!==r.id||c.acceptedAt===null||stopped(c,r.id)||c.expiresAt<=w.minute||r.skills.care<1||r.health<=30||r.energy<10)return '没有本人仍愿意履行的已接受陪伴安排';
  if((r.inside===c.buildingId||same(r.at,c.door))&&(!access(w,r,c.buildingId)||!pregnancyPlace(w,c)))return '现场原住房、进入权或床位条件已经改变';
  return null;
 }
 if(!c||!current(w,c)||stopped(c,c.gestatorId))return '原孕育、固定24小时期限或本人授权已经结束';
 const p=person(w,c.gestatorId)!,provider=c.providerId?person(w,c.providerId):undefined;
 if(!local(p)||!p.canDecide||!p.canExpress||ageYears(p.bornAt,w.minute)<18||a.operation!=='attend'&&!canObserve(w,p)||p.refusesCare)return '孕育者当前不能独立配合或已拒绝，不产生紧急替代权限';
 if(c.providerId!==r.id||stopped(c,r.id)||r.skills.care<1||r.health<=30||r.energy<10)return '本人不是仍愿意参与且有基础能力的指定提供者';
 const place=pregnancyPlace(w,c);if(!place||!access(w,r,c.buildingId))return '原住房权利、床位或提供者进入权已经改变';
 if(a.operation==='accept')return provider&&together(w,r,p,c.buildingId)&&c.acceptedAt===null?null:'须双方在原住所实际会面，由提供者独立接受';
 if(!active(c))return '指定提供者尚未独立接受或已经停止参与';
 if(a.operation==='deliverMeal'){
  if(c.deliveredMeals>=2||(r.inventory.meal??0)<1)return '限额为两份餐食，须使用提供者随身现有餐食';
  return together(w,r,p,c.buildingId)?null:'餐食交接须双方清醒并在原住所真实相遇，不能远程交付';
 }
 if(physical&&(p.inside!==c.buildingId||!p.roomAt||!same(p.roomAt,place.bed)||r.inside!==c.buildingId||!r.roomAt||!same(r.roomAt,place.care)||!socialSpace(w,r,p)))return '须孕育者实际在原床、提供者实际走到床旁，不能把到场意向视为照护';
 return null;
}
export function pregnancyTarget(w:World,r:Resident,a:PregnancyPreparationAction){
 initializePregnancyPreparation(w);const error=pregnancyReason(w,r,a,a.operation!=='attend');
 if(error)return {target:r.at,duration:0,error};
 const c=arrangement(w,a);
 return {target:a.operation==='attend'?{...c!.door}:{...r.at},duration:a.operation==='attend'?60:a.operation==='deliverMeal'?5:1};
}
export function pregnancyWork(w:World,r:Resident,a:PregnancyPreparationAction,minutes:number):string|null {
 const error=pregnancyReason(w,r,a);if(error)return error;
 if(a.operation==='attend'){const c=arrangement(w,a)!;c.attendanceMinutes+=Math.min(minutes,r.activity?.remaining??minutes);c.lastAttendedAt=w.minute;}
 return null;
}
function fact(w:World,r:Resident,c:PregnancyPreparation,text:string){const e=emitEvent(w,{kind:'care',actors:[r.id,...[c.gestatorId,c.providerId].filter((id):id is string=>id!==null&&id!==r.id)],place:{...r.at},text:`${r.name}${text}`});c.eventIds.push(e.id);}
export function completePregnancyPreparation(w:World,r:Resident,a:PregnancyPreparationAction):string|null {
 initializePregnancyPreparation(w);const s=w.pregnancyPreparation!;
 if(s.receipts.some(p=>p.id===a.receiptId))return null;
 if(a.receiptId!==pregnancyReceiptId(w,r))return '孕期准备选择的回执已经失效';
 if(a.operation==='deliverMeal')advanceFood(w);
 const error=pregnancyReason(w,r,a);if(error)return error;
 let c=arrangement(w,a);
 if(a.operation==='prepare'){
  const p=r.pregnancy!,b=home(w,r,a.buildingId)!;
  c={id:a.receiptId,gestatorId:r.id,conceivedAt:p.conceivedAt,dueAt:p.dueAt,buildingId:b.id,bed:residentBed(w,r,b)!,door:{...b.door},providerId:a.providerId,createdAt:w.minute,expiresAt:Math.min(w.minute+DAY,p.dueAt+1),acceptedAt:null,stops:[],deliveredMeals:0,restMinutes:0,attendanceMinutes:0,lastAttendedAt:null,eventIds:[],birth:null};s.arrangements.push(c);
  fact(w,r,c,`选择在${b.name}本人的现有床位准备休息和分娩，固定最多24小时${a.providerId?'；向指定照护者提出最多两份自有餐食交付及自愿床旁陪伴，等待其独立接受':'；暂不指定照护者'}。不预留额外床位，不改变健康风险或监护权。`);
 }else if(a.operation==='accept'){c!.acceptedAt=w.minute;fact(w,r,c!,'独立接受有限孕期准备；送餐与床旁陪伴仍须另行自愿行动，不保证到场，也无医疗或财产权利。');}
 else if(isPregnancyWithdrawal(a)){c!.stops.push({personId:r.id,at:w.minute});fact(w,r,c!,a.operation==='decline'?'拒绝了本人参与的孕期准备。':'撤回了本人的孕期准备参与或授权；远处的人不会自动收到通知，已经交付的餐食不追回。');}
 else if(a.operation==='deliverMeal'){
  const p=person(w,c!.gestatorId)!;
  foodTransaction(w,()=>{routeFood(w,'person:'+r.id,'person:'+p.id,{meal:1});r.inventory.meal!--;p.inventory.meal=(p.inventory.meal??0)+1;});c!.deliveredMeals++;
  fact(w,r,c!,'在场交付1份本人现有餐食，保留原批次与保质期；孕育者自行决定何时进食。');
 }else fact(w,r,c!,'完成了本次自愿床旁陪伴；只记实际在场时间，不代表医疗处理或安全保证。');
 s.receipts.push({id:a.receiptId,actorId:r.id,at:w.minute,operation:a.operation});return null;
}
/** Existing voluntary sleep is the only recovery mechanism; a plan creates no rest benefit itself. */
export function recordPregnancyRest(w:World,r:Resident,minutes:number){
 for(const c of w.pregnancyPreparation?.arrangements??[]){if(c.gestatorId!==r.id||!current(w,c)||stopped(c,r.id))continue;const place=pregnancyPlace(w,c);if(place&&r.inside===c.buildingId&&r.roomAt&&same(r.roomAt,place.bed))c.restMinutes+=minutes;}
}
export function recordPreparedBirth(w:World,p:Resident,childId:string){
 const c=[...(w.pregnancyPreparation?.arrangements??[])].reverse().find(c=>c.gestatorId===p.id&&c.conceivedAt===p.pregnancy?.conceivedAt&&!c.birth);
 if(!c)return;
 const place=pregnancyPlace(w,c),provider=c.providerId?person(w,c.providerId):undefined;
 const atPlannedBed=!!place&&p.inside===c.buildingId&&!!p.roomAt&&same(p.roomAt,place.bed);
 const providerPresent=current(w,c)&&active(c)&&atPlannedBed&&p.canDecide&&p.canExpress&&!!provider&&capable(w,provider)&&!moving(w,provider)&&provider.skills.care>=1&&provider.health>30&&provider.energy>=10&&access(w,provider,c.buildingId)&&c.lastAttendedAt===w.minute&&!!provider.roomAt&&same(provider.roomAt,place!.care)&&socialSpace(w,provider,p)&&!p.refusesCare;
 c.birth={at:w.minute,childId,actualBuildingId:p.inside,atPlannedBed,providerPresent};
 const e=emitLedgerEvent(w,{kind:'care',actors:[p.id,childId],place:{...p.at},roomId:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,text:`${p.name}的出生准备核对：${atPlannedBed?'实际在原选床位':'实际未在原选床位'}，${providerPresent?'指定提供者正在实际床旁陪伴':'无有效约定的实际床旁陪伴'}；只记录处境，不改变出生或健康规则。`});c.eventIds.push(e.id);
}
/** Menu visibility uses own decisions and local meetings, never a distant party's hidden withdrawal. */
export function pregnancyOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!capable(w,r))return [];initializePregnancyPreparation(w);
 const out:FormalOpportunity[]=[],receiptId=pregnancyReceiptId(w,r),add=(id:string,label:string,a:Omit<PregnancyPreparationAction,'type'|'receiptId'>|Action)=>out.push({id:'pregnancy.'+id,label,action:'type'in a?a as Action:{type:'pregnancyPreparation',receiptId,...a} as PregnancyPreparationAction});
 const propose=(providerId:string|null)=>{const a:PregnancyPreparationAction={type:'pregnancyPreparation',receiptId,operation:'prepare',buildingId:r.homeId??'',providerId};if(!pregnancyReason(w,r,a))add('prepare.'+(providerId??'self'),providerId?'向在场的'+person(w,providerId)!.name+'提出24小时孕期准备（最多两份餐食和自愿陪伴，须另行接受）':'选择自己的现有床位作24小时孕期休息与分娩准备（暂不指定照护者）',a);};
 if(r.pregnancy){propose(null);for(const p of w.residents)if(p.id!==r.id&&p.inside===r.inside&&r.inside&&p.roomAt&&r.roomAt&&distance(p.roomAt,r.roomAt)<=2)propose(p.id);}
 for(const c of w.pregnancyPreparation!.arrangements){
  const knowsBirth=!!c.birth&&(r.id===c.gestatorId||r.memories.some(m=>m.source!=='heard'&&w.events.some(e=>e.id===m.eventId&&e.kind==='birth'&&e.actors.includes(c.birth!.childId))));
  if(knowsBirth||![c.gestatorId,c.providerId].includes(r.id)||stopped(c,r.id)||c.expiresAt<=w.minute)continue;
  add('withdraw.'+c.id,'立即停止本人参与这项孕期准备（不追回已交付物品）',{operation:'withdraw',arrangementId:c.id} as Omit<PregnancyPreparationAction,'type'|'receiptId'>);
  if(c.gestatorId===r.id){if(r.pregnancy?.conceivedAt===c.conceivedAt&&r.homeId===c.buildingId)add('rest.'+c.id,'自愿按现有居住权睡1小时，仅实际原选床位睡眠计入本项准备',{type:'sleep',minutes:60});continue;}
  if(c.acceptedAt!==null)add('attend.'+c.id,'按原约定地点尝试到床旁陪伴1小时，是否仍可履行须到场核实',{operation:'attend',arrangementId:c.id} as Omit<PregnancyPreparationAction,'type'|'receiptId'>);
  const p=person(w,c.gestatorId);if(!p||!together(w,r,p,c.buildingId))continue;
  for(const operation of ['accept','decline','deliverMeal'] as const){const a:PregnancyPreparationAction={type:'pregnancyPreparation',receiptId,operation,arrangementId:c.id};if(!pregnancyReason(w,r,a))add(operation+'.'+c.id,{accept:'独立接受这项孕期准备',decline:'独立拒绝这项孕期准备',deliverMeal:'在场交付1份自有餐食（原批次；对方另行决定进食）',attend:'自愿到原选床旁陪伴1小时（须本人实际在床，无医疗效果）'}[operation],a);}
 }
 return out;
}

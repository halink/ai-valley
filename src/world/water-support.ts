import type {Resident,World,WorldEvent} from '../shared/types.js';
import type {WaterSupportAction} from '../shared/water-support.js';
import {isWaterSupportWithdrawal} from '../shared/water-support.js';
import {socialSpace} from './relationships.js';
import {canObserve} from './knowledge.js';
import {activeCases} from './health.js';
import {healthDefinition} from './process-definitions.js';
import {findPath,walkable} from './navigation.js';
import {aboardFerry} from './ferry.js';
import {passenger} from './medical-transport.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {ageYears,DAY} from './time.js';

const person=(w:World,id:string)=>w.residents.find(p=>p.id===id);
const local=(p:Resident|undefined):p is Resident=>!!p&&p.status==='alive'&&p.residency!=='outside';
const capable=(w:World,p:Resident|undefined):p is Resident=>local(p)&&p.canDecide&&p.canExpress&&!asleep(p)&&canObserve(w,p);
const adult=(w:World,p:Resident|undefined):p is Resident=>capable(w,p)&&ageYears(p.bornAt,w.minute)>=18;
const moving=(w:World,p:Resident)=>!!aboardFerry(w,p.id)||!!passenger(w,p.id)||!!travellingFamily(w,p.id)||!!familyPassenger(w,p.id);
const asleep=(p:Resident)=>p.activity?.action.type==='sleep'&&!p.activity.path.length&&!p.activity.room?.path.length;
const vessel=(w:World,id:string)=>w.waterSupply?.vessels.find(v=>v.id===id);
const own=(p:Resident,v:ReturnType<typeof vessel>)=>!!v&&v.ownerId===p.id&&v.buildingId===null;
const ownedCount=(w:World,p:Resident)=>w.waterSupply?.vessels.filter(v=>own(p,v)).length??0;
const drunk=(w:World,id:string)=>w.waterSupply?.receipts.filter(p=>p.recipientId===id&&p.at>w.minute-DAY).reduce((n,p)=>n+p.quantity,0)??0;
export function initializeWaterSupport(w:World){if(w.waterSupply){w.waterSupply.assistance??=[];w.waterSupply.gifts??=[];}}
/** No doorway substitution or reaching through a blocked tile/wall, and no new room-entry right. */
export function waterSupportTogether(w:World,a:Resident,b:Resident){
 if(moving(w,a)||moving(w,b)||!socialSpace(w,a,b))return false;
 if(a.inside)return !!a.roomAt&&!!b.roomAt;
 return walkable(w,a.at)&&walkable(w,b.at)&&findPath(w,a.at,b.at,false,2)!==null;
}
/** Supply-only assistance cannot infer swallowing safety from incapacity or an emergency label. */
export function assistedWaterNeed(w:World,p:Resident):string|null {
 if(!local(p)||ageYears(p.bornAt,w.minute)<18||!p.canDecide||!p.canExpress||p.refusesCare||asleep(p))return '成年人须在世、清醒、仍有完整决定与表达能力且没有拒绝；不能向无法自主撤回或配合者强行喂水';
 const cases=activeCases(w,p.id).map(c=>({c,rules:c.rules??healthDefinition(w,c.definition??'health/rules@1').rules}));
 if(p.health<=20||cases.some(({c,rules})=>c.stage==='critical'||p.health<=rules.criticalHealth||c.severity>=rules.severeSeverity))return '当前重症或危急状况不适用本项有限口服供水，须先处理医疗与安全配合';
 if(!cases.some(({c,rules})=>c.severity>=rules.slowSeverity))return '本人当前没有已观察到的伤病导致的行动受限';
 return null;
}
export function waterSupportReason(w:World,r:Resident,a:WaterSupportAction):string|null {
 const state=w.waterSupply;if(!state)return '供水登记尚未接通';
 if(!isWaterSupportWithdrawal(a)&&(!canObserve(w,r)||asleep(r)))return '本人须清醒并能实际理解现场事项';
 if(a.operation==='authorizeAssist'){
  const p=person(w,a.targetId);
  if(!adult(w,r)||!adult(w,p)||r.id===p.id||r.refusesCare||p.skills.care<1||!waterSupportTogether(w,r,p))return '须本人清醒具备完整能力，与指定的成年基础照护者在有权使用的现场明确授权';
  return state.assistance?.some(c=>c.beneficiaryId===r.id&&c.providerId===p.id&&c.revokedBy!==r.id&&!c.stops?.some(s=>s.personId===r.id)&&c.expiresAt>w.minute&&c.used<c.limit)?'这名照护者已有本人尚未停止或用尽的同项授权':null;
 }
 if(a.operation==='revokeAssist'){
  const c=state.assistance?.find(c=>c.id===a.authorizationId);
  // The actor knows its own decision, expiry and jointly completed drinks, not
  // whether the distant other party has already stopped. Keep that private.
  return c&&[c.beneficiaryId,c.providerId].includes(r.id)&&c.revokedBy!==r.id&&!c.stops?.some(s=>s.personId===r.id)&&c.expiresAt>w.minute&&c.used<c.limit?null:'没有本人尚可停止参与的协助饮水安排';
 }
 if(a.operation==='assistDrink'){
  const c=state.assistance?.find(c=>c.id===a.authorizationId),p=c&&person(w,c.beneficiaryId),v=vessel(w,a.vesselId);
  if(!c||c.providerId!==r.id||c.revokedAt!==null||c.expiresAt<=w.minute||c.used>=c.limit)return '没有指定给本人、仍有效且有剩余次数的明确饮水授权';
  if(!adult(w,r)||r.skills.care<1||r.health<=30||r.energy<10||!local(p)||!waterSupportTogether(w,r,p))return '有基础能力的照护者与受助者须在同一真实可及且有权使用的地点，不能远程或途中供水';
  const reason=assistedWaterNeed(w,p);if(reason)return reason;
  if(!own(r,v)||v!.quality!=='safe'||v!.amount<1)return '只能使用本人随身桶内实际存在的安全水';
  return drunk(w,p.id)>=2?'受助者过去24小时已饮用2份水，本阶段不重复消耗':null;
 }
 if(a.operation==='offerVessel'){
  const p=person(w,a.targetId),v=vessel(w,a.vesselId);
  if(!adult(w,r)||!capable(w,p)||ageYears(p.bornAt,w.minute)<6||ageYears(p.bornAt,w.minute)>=18||!waterSupportTogether(w,r,p))return '赠桶须成年桶主与能独立决定和表达的6至17岁本人在场';
  if(!own(r,v)||v!.amount>0&&v!.quality!=='safe')return '只能提议赠出本人携带的空桶或安全水桶';
  if(ownedCount(w,p)>=8)return '对方已携带8只水桶，不能再转入';
  return state.gifts?.some(g=>g.vesselId===v!.id&&g.status!=='accepted'&&g.status!=='cancelled'&&!g.stops?.some(s=>s.personId===r.id)&&g.expiresAt>w.minute)?'这只水桶已有本人尚未停止的赠送提议':null;
 }
 const g=state.gifts?.find(g=>g.id===a.giftId);
 if(!g||g.expiresAt<=w.minute||g.status==='accepted')return '没有仍有效的这项具体赠桶提议';
 if(a.operation==='cancelVessel')return g.donorId===r.id&&g.status!=='cancelled'&&!g.stops?.some(s=>s.personId===r.id)?null:'只有原桶主可停止本人尚未停止的赠送提议';
 if(a.operation==='declineVessel')return g.recipientId===r.id&&g.status!=='declined'&&!g.stops?.some(s=>s.personId===r.id)?null:'只有收受人本人可拒绝本人尚未拒绝的赠桶';
 if(g.status!=='offered')return '没有仍有效的这项具体赠桶提议';
 const donor=person(w,g.donorId),v=vessel(w,g.vesselId),age=ageYears(r.bornAt,w.minute);
 if(g.recipientId!==r.id||age<6||age>=18||!capable(w,r)||!adult(w,donor)||!waterSupportTogether(w,r,donor))return '收受人须仍为能自主决定的未成年人，与清醒成年桶主实际共同在场后独立接受';
 if(!own(donor,v)||v!.amount!==g.amount||v!.quality!==g.quality)return '桶的归属、携带位置或约定水量/水质已经改变，请先撤回再另行提出';
 if(v!.amount>0&&v!.quality!=='safe'||ownedCount(w,r)>=8)return '水质或本人真实携桶容量不允许接受';
 return null;
}
/** All checks are repeated immediately before effects; authorizations themselves never transfer water. */
export function completeWaterSupport(w:World,r:Resident,a:WaterSupportAction):{quantity:number;recipientId?:string;counterpartyId:string;text:string;audit?:WorldEvent['audit']}|string {
 const error=waterSupportReason(w,r,a);if(error)return error;
 const state=w.waterSupply!;
 if(a.operation==='authorizeAssist'){
  state.assistance!.push({id:a.receiptId,beneficiaryId:r.id,providerId:a.targetId,createdAt:w.minute,expiresAt:w.minute+DAY,limit:2,used:0,revokedAt:null,revokedBy:null});
  return {quantity:0,counterpartyId:a.targetId,text:`本人明确授权${person(w,a.targetId)!.name}在未来24小时内、最多2次，在本人行动受限且仍能安全配合时用照护者自有安全水协助饮用；本人可撤回，当前拒绝立即停止，不要求照护者履约`};
 }
 if(a.operation==='revokeAssist'){
  const c=state.assistance!.find(c=>c.id===a.authorizationId)!;
  if(c.revokedAt===null){c.revokedAt=w.minute;c.revokedBy=r.id;}
  (c.stops??=[]).push({personId:r.id,at:w.minute});
  return {quantity:0,counterpartyId:r.id===c.beneficiaryId?c.providerId:c.beneficiaryId,text:'记录本人撤回原有有限协助饮水授权或停止自愿参与，不改监护、财产、住处或医疗安排，也不自动告知远处的人'};
 }
 if(a.operation==='assistDrink'){
  const c=state.assistance!.find(c=>c.id===a.authorizationId)!,p=person(w,c.beneficiaryId)!;vessel(w,a.vesselId)!.amount--;c.used++;
  return {quantity:1,recipientId:p.id,counterpartyId:p.id,text:`按${p.name}本人原先的明确限时授权，在场用1份自有安全桶水帮助其饮用；仍能表达配合，无健康恢复或新的监护权`,audit:{rule:'water/assistance@1',authority:'prior-explicit-consent',evidence:c.id,scope:['one-assisted-safe-drink','own-water','no-emergency-override','no-guardianship','no-health-recovery'],resources:{water:1},providerId:r.id,termination:'本次饮用结束；当前拒绝、授权撤回/到期、次数用尽、地点或安全配合条件变化立即停止'}};
 }
 if(a.operation==='offerVessel'){
  const v=vessel(w,a.vesselId)!;state.gifts!.push({id:a.receiptId,donorId:r.id,recipientId:a.targetId,vesselId:v.id,amount:v.amount,quality:v.quality,createdAt:w.minute,expiresAt:w.minute+DAY,status:'offered',endedAt:null});
  return {quantity:0,counterpartyId:a.targetId,text:`向${person(w,a.targetId)!.name}提出赠送这只6份容量水桶及其中${v.amount}份${v.amount?'安全水':'水'}，等待本人在24小时内独立接受；此时没有转移任何水或桶`};
 }
 const g=state.gifts!.find(g=>g.id===a.giftId)!;
 if(a.operation==='cancelVessel'||a.operation==='declineVessel'){
  if(g.status==='offered'){g.status=a.operation==='cancelVessel'?'cancelled':'declined';g.endedAt=w.minute;}
  (g.stops??=[]).push({personId:r.id,at:w.minute});
  return {quantity:0,counterpartyId:a.operation==='cancelVessel'?g.recipientId:g.donorId,text:a.operation==='cancelVessel'?'撤回了赠桶提议，未转移水桶或其中的水':'独立拒绝了赠桶提议，未转移水桶或其中的水'};
 }
 const v=vessel(w,g.vesselId)!;v.ownerId=r.id;g.status='accepted';g.endedAt=w.minute;
 return {quantity:v.amount,counterpartyId:g.donorId,text:`本人独立接受${person(w,g.donorId)!.name}先前的具体赠桶提议，在现场接过原有水桶及其中${v.amount}份安全水；桶的身份、水量及容量不变，不改变监护与住处`};
}

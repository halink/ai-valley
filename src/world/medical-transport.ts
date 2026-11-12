import {transportOfferOpen,transportPersonalConsent,transportNeedsPersonalConsent,transportConsentUsable} from './medical-transport-consent.js';
import {presenceArrivalAudit} from './adult-presence.js';
import {adultEvacuationReason} from './adult-emergency-evacuation.js';
import {frontierRetreatStepAllowed} from './frontier-hazards.js';
import {guardianEvacuationReason,guardianKnownAddressPath,guardianGroundReason,guardianGroundRoute,guardianGroundLimit,guardianGroundPatientReason} from './guardian-evacuation.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {buildingSheltersFrom,medicalDestinationReason} from './building-safety.js';
import {canInspectBuilding} from './building-knowledge.js';
import {isRescueDecision} from '../shared/health.js';
import {aboardFerry,dockedFerryContact,sameFerryContact,releaseRescuedFerryPassenger} from './ferry.js';
import {leasedBed} from '../shared/commons.js';
import type {Action,Resident,Vec,World} from '../shared/types.js';import type {HealthAction,MedicalTransport} from '../shared/health.js';import {activeCases,initializeHealth} from './health.js';import {coLocated} from './proximity.js';import {ageYears,knownAgeYears,DAY} from './time.js';import {findPath,distance,same} from './navigation.js';import {roomLayout,residentBed} from '../shared/rooms.js';import {prepareRoomExit,roomExitReason} from './rooms.js';import {emitEvent} from './events.js';
export const isTransportAction=(a:HealthAction)=>['rescueOffer','acceptRescue','declineRescue','cancelRescue','rescue','stabilize'].includes(a.operation);
const person=(w:World,id?:string)=>w.residents.find(r=>r.id===id),place=(w:World,id?:string|null)=>w.buildings.find(b=>b.id===id);
const capable=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const adult=(w:World,r:Resident|undefined):r is Resident=>capable(r)&&ageYears(r.bornAt,w.minute)>=18;
const carrier=(w:World,r:Resident)=>adult(w,r)&&r.energy>=10&&r.health>30;
export function passenger(w:World,id:string){return w.health?.transports.find(t=>t.patientId===id&&t.phase==='carrying');}
/** Expression permits only one's own refusal/stop, even during another plan.
 * It never grants consent, treatment, work, movement, or proxy powers. */
export function expressiveTransportControl(w:World,r:Resident):boolean {
 const t=passenger(w,r.id),current=t&&(t.evacuationDestination==='safe-ground'?!!t.evacuationDangerId&&(t.basis==='guardian'||t.evacuationAuthority==='incapacitated-adult'&&t.basis==='emergency'):t.buildingId!==null);
 return r.status==='alive'&&r.residency!=='outside'&&r.canExpress&&(!r.canDecide||!!r.plan||!!r.activity)&&
  (!!current||!!w.health?.transportOffers.some(o=>o.patientId===r.id&&transportOfferOpen(w,o)));
}
export function expressiveTransportChoice(w:World,r:Resident,a:Action):boolean {
 if(!expressiveTransportControl(w,r))return false;
 if(a.type==='wait')return Object.keys(a).every(k=>['type','minutes'].includes(k))&&Number.isFinite(a.minutes)&&a.minutes>=1&&a.minutes<=15;
 return a.type==='health'&&['cancelRescue','declineRescue'].includes(a.operation)&&
  (a.transportId!==undefined&&a.operation==='cancelRescue'&&a.transportId===passenger(w,r.id)?.id||a.offerId!==undefined&&!!w.health?.transportOffers.some(o=>o.id===a.offerId&&o.patientId===r.id&&transportOfferOpen(w,o)));
}
function consent(w:World,r:Resident,p:Resident,id?:string){return w.health?.transportOffers.find(o=>o.carrierId===r.id&&o.patientId===p.id&&o.buildingId===id&&transportConsentUsable(w,o,p));}
/** Shores and boats are distinct physical places even when stale coordinates coincide. */
function medicalContact(w:World,r:Resident,p:Resident,range:number){
 const on=aboardFerry(w,p.id),other=aboardFerry(w,r.id);if(!on&&!other)return coLocated(w,r,p,range);
 if(on&&other)return on.id===other.id&&!!dockedFerryContact(w,r)&&!!dockedFerryContact(w,p)&&coLocated(w,r,p,range);
 if(other)return false;
 const site=dockedFerryContact(w,p);return !!site&&!r.inside&&distance(r.at,site.land)<=range&&findPath(w,r.at,site.land)!==null;
}
export function bindFerryContact(w:World,a:HealthAction){if(!['rescueOffer','rescue','stabilize'].includes(a.operation)||a.phase==='delivery'||a.ferryContact)return;const p=person(w,a.targetId),site=p&&dockedFerryContact(w,p);if(site)a.ferryContact=site;}
function ferryContactProblem(w:World,r:Resident,p:Resident,a:HealthAction){
 const on=aboardFerry(w,p.id);if(!on&&!a.ferryContact)return null;
 const site=dockedFerryContact(w,p);if(!site||a.ferryContact&&!sameFerryContact(site,a.ferryContact))return '患者所在船程、船只或原靠泊接触位置已经变化，不能从水上接出';
 if(aboardFerry(w,r.id)||r.inside||findPath(w,r.at,site.land)===null)return '须从陆地亲自抵达该船紧邻的真实码头位置';
 if(r.activity?.action===a&&!r.activity.path.length&&!same(r.at,site.land))return '须在原船紧邻的实际码头位置完成接触劳动';
 return null;
}
/** Fresh authority is required for every new emergency movement or stabilization step. */
export function rescueAuthority(w:World,r:Resident,p:Resident,id?:string,transport=true,range=2):{basis:'consent'|'guardian'|'emergency';evidence:string}|null{
 if(!carrier(w,r)||r.id===p.id||p.status!=='alive'||p.residency==='outside'||p.refusesCare||!medicalContact(w,r,p,range))return null;
 if(transport){const offer=consent(w,r,p,id);if(offer)return {basis:'consent',evidence:offer.id};}
 const age=knownAgeYears(p.bornAt,w.minute);
 if(age!==null&&age<6&&p.guardianIds.includes(r.id))return {basis:'guardian',evidence:`guardian:${r.id}:${p.id}`};
 if(p.canDecide&&p.canExpress)return null;
 if(p.health>20&&!activeCases(w,p.id).some(c=>c.stage==='critical'||c.severity>=85))return null;
 // Only a minor has current guardian authority; retained adult IDs are history.
 if(age!==null&&age<18&&p.guardianIds.some(id=>{const g=person(w,id);return adult(w,g)&&medicalContact(w,g,p,2);}))return null;
 return {basis:'emergency',evidence:`observed:${r.id}:${p.id}:${w.minute}:health=${p.health}:incapacity=${!p.canDecide||!p.canExpress}`};
}
function bedAvailable(w:World,id:string,index:number,patientId:string,carrierId?:string){
 const b=place(w,id),s=b&&roomLayout(w,b).slots.find(s=>s.key==='bed:'+index);if(!s||leasedBed(w,id,index,patientId))return false;
 // An assigned residential bed is not free merely because its holder is out.
 if(b&&w.residents.some(p=>p.id!==patientId&&p.status==='alive'&&p.residency!=='outside'&&p.homeId===id&&b.residents.includes(p.id)&&residentBed(w,p,b)===index))return false;
 if(w.health?.transports.some(t=>t.phase==='carrying'&&t.buildingId===id&&t.bed===index&&t.patientId!==patientId))return false;
 if(index===0&&(w.health?.appointments.some(a=>a.status==='accepted'&&a.buildingId===id&&a.start<=w.minute+120&&a.end>w.minute&&a.patientId!==patientId)||w.duties?.shifts.some(a=>a.buildingId===id&&a.role==='care'&&a.status==='on-duty'&&a.clientId&&a.clientId!==patientId)))return false;
 return !w.residents.some(p=>p.id!==patientId&&p.id!==carrierId&&p.status==='alive'&&p.inside===id&&p.roomAt&&distance(p.roomAt,s.at)<=1);
}
export function medicalBed(w:World,id:string,patientId:string):number|null{
 const b=place(w,id);if(!b)return null;for(const s of roomLayout(w,b).slots.filter(s=>s.kind==='bed')){const index=Number(s.key.slice(4));if(bedAvailable(w,id,index,patientId))return index;}return null;
}
const validPoint=(p:Vec|undefined):p is Vec=>!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y);
const sameOptionalPoint=(a:Vec|undefined,b:Vec|undefined)=>a===undefined?b===undefined:validPoint(a)&&validPoint(b)&&same(a,b);
function groundDeliveryProblem(w:World,r:Resident,p:Resident,t:MedicalTransport):string|null {
 const a=r.activity?.action;
 if(t.buildingId!==null||t.bed!==null||t.offerId!==null||(t.evacuationAuthority==='incapacitated-adult'?t.basis!=='emergency':t.basis!=='guardian')||!t.evacuationDangerId||!validPoint(t.evacuationOrigin)||!validPoint(r.activity?.target)||!Array.isArray(r.activity?.path)||t.evacuationGround!==undefined&&!validPoint(t.evacuationGround)||t.evacuationExitId!==undefined&&typeof t.evacuationExitId!=='string'||a?.type!=='health'||a.buildingId!==undefined||a.ferryContact!==undefined||a.offerId!==undefined||a.evacuationExitId!==t.evacuationExitId||!sameOptionalPoint(a.evacuationGround,t.evacuationGround))return '干地撤险的原范围或实际目标已经变化';
 if(t.evacuationAuthority!=='incapacitated-adult'){const injury=guardianGroundPatientReason(w,p);if(injury)return injury;}
 if(t.evacuationAuthority!=='incapacitated-adult'&&!rescueAuthority(w,r,p))return '幼儿意愿、当前监护或护送人体力已经改变，须在实际位置停止';
 if(t.evacuationAuthority==='incapacitated-adult'&&(!t.evacuationGround||!same(r.at,t.evacuationGround))){
  // Once the actual current position is safe, continued coercive movement is unnecessary.
  const d=w.frontierHazards?.disasters.find(d=>d.id===t.evacuationDangerId),b=r.inside?place(w,r.inside):undefined;
  if(!d||d.phase!=='active'||d.startsAt>w.minute||d.endsAt<=w.minute||!(d.intensity>0)||!disasterContains(d,r.at)||b&&buildingSheltersFrom(b,d))return '原危险已不再实际威胁当前位置，有限撤险在真实位置结束，不能继续替成人决定去向';
 }
 if(!Number.isInteger(t.evacuationSteps)||t.evacuationSteps!<0||t.evacuationSteps!>guardianGroundLimit||distance(r.at,t.evacuationOrigin)>t.evacuationSteps!)return '原干地撤险的实际步数或当前位置记录已经失效';
 if(!t.evacuationGround){
  if(t.evacuationSteps!==0)return '尚未核验干地的室内阶段不能已有户外步数';
  if(!t.evacuationExitId||r.inside!==null&&r.inside!==t.evacuationExitId||!same(r.at,t.evacuationOrigin)||r.activity!.path.length||!same(r.activity!.target,t.evacuationOrigin))return '出门前不能指定、跳转或移动到未经现场核验的干地';
  return null;
 }
 if(r.inside||distance(t.evacuationOrigin,t.evacuationGround)>guardianGroundLimit||!same(r.activity!.target,t.evacuationGround))return '干地撤险须在原出口附近按已绑定目标实际步行';
 const path=r.activity!.path;let from=r.at;
 if(t.evacuationSteps!+path.length>guardianGroundLimit)return '原干地撤险不能延伸到八个实际步以外';
 for(const to of path){if(!to||!Number.isInteger(to.x)||!Number.isInteger(to.y)||distance(from,to)!==1)return '原干地撤险路线不是实际相邻格';from=to;}
 if(!same(from,t.evacuationGround))return '原干地撤险路线没有在已绑定落脚点结束';
 return guardianGroundReason(w,r,t.evacuationGround);
}
function deliveryProblem(w:World,r:Resident,p:Resident,t:MedicalTransport){
 if(t.evacuationAuthority!==undefined&&t.evacuationAuthority!=='incapacitated-adult'||t.evacuationAuthority==='incapacitated-adult'&&t.evacuationDestination!=='safe-ground')return '成人撤险不能变为其他护送权限';
 if(t.evacuationDangerId){const error=t.evacuationAuthority==='incapacitated-adult'?adultEvacuationReason(w,r,p,t.evacuationDangerId,false):guardianEvacuationReason(w,r,p,t.evacuationDangerId,false);if(error)return error;}
 if(t.evacuationDestination==='safe-ground')return groundDeliveryProblem(w,r,p,t);
 const b=place(w,t.buildingId),unverified=t.evacuationDestination==='known-address',unsafe=medicalDestinationReason(w,r,b,{menu:unverified});if(unsafe)return unsafe;
 if(!b)return '原接收地址已经不存在';
 if(t.bed===null){
  if(!unverified||!t.evacuationDangerId)return '未核验床位不能用于普通医疗护送';
  // A remembered address is not a reservation or a live remote capacity query.
  if(r.inside===b.id)return '尚未在门口核验接收床位，不能进入房间';
  if(r.inside===null&&same(r.at,b.door)&&medicalBed(w,b.id,p.id)===null)return '到场核验后没有可用接收床位，护送在实际门口停止';
 }else if(!bedAvailable(w,b.id,t.bed,p.id,r.id))return '原接收场所、使用权或保留床位已经变化，护送在实际位置停止';
 return rescueAuthority(w,r,p,t.buildingId??undefined)?null:'患者意愿、能力或及时代理已经改变，须立即停止例外移动';
}
function recipient(w:World,p:Resident){const age=knownAgeYears(p.bornAt,w.minute);if(age===null)return undefined;if(capable(p)&&age>=6)return p;if(age>=18)return undefined;return p.guardianIds.map(id=>person(w,id)).find(g=>adult(w,g)&&medicalContact(w,g,p,2));}
const fact=(w:World,r:Resident,p:Resident,text:string,audit?:import('../shared/types.js').WorldEvent['audit'])=>emitEvent(w,{kind:'care',actors:[r.id,p.id],place:{...r.at},text,...(audit?{audit}:{})});
export function transportReason(w:World,r:Resident,a:HealthAction,mode:'execution'|'menu'='execution'):string|null{
 if(!w.health||!capable(r)&&!expressiveTransportChoice(w,r,a))return '本人当前不能安排救助与护送';
 if(a.evacuationAuthority!==undefined&&(a.evacuationAuthority!=='incapacitated-adult'||a.operation!=='rescue'||a.evacuationDestination!=='safe-ground'||!a.evacuationDangerId))return '成人紧急权限只能用于绑定迫近危险的短程干地撤离';
 if(a.evacuationDestination!==undefined&&(!['known-address','safe-ground'].includes(a.evacuationDestination)||a.operation!=='rescue'||!a.evacuationDangerId))return '已知地址尝试仅适用于绑定现场危险的监护幼儿护送';
 if((a.evacuationGround!==undefined||a.evacuationExitId!==undefined)&&a.evacuationDestination!=='safe-ground')return '干地位置与出口只能用于有限监护灾害撤险';
 if(a.evacuationDestination==='safe-ground'&&(a.buildingId!==undefined||a.offerId!==undefined||a.ferryContact!==undefined))return '干地撤险不能附带接收建筑、同意提议或船上接出';
 if(a.evacuationDangerId!==undefined&&(a.operation!=='rescue'||typeof a.evacuationDangerId!=='string'||!a.evacuationDangerId.trim()))return '灾害护送须绑定一项原先亲见的危险和当前监护行动';
 if(isRescueDecision(a)&&(a.targetId!==undefined||a.buildingId!==undefined||a.ferryContact!==undefined||a.phase!==undefined||a.operation!=='cancelRescue'&&a.transportId!==undefined||a.operation==='cancelRescue'&&Number(a.offerId!==undefined)+Number(a.transportId!==undefined)!==1))return '护送答复或停止决定只能指定一项本人安排，不能附带移动目标';
 if(['acceptRescue','declineRescue'].includes(a.operation)){
  const o=w.health.transportOffers.find(o=>o.id===a.offerId),p=o&&person(w,o.patientId);
  if(!o||!p||!transportOfferOpen(w,o))return '没有仍有效且交由本人决定的护送提议';
  if(a.operation==='declineRescue'&&r.id===p.id&&r.canExpress)return null;
  const personal=r.id===p.id&&ageYears(p.bornAt,w.minute)>=6&&capable(p);
  const pending=o.status==='offered'||o.status==='awaitingPatient'||o.status==='accepted'&&transportNeedsPersonalConsent(w,o,p);
  if(!pending||(!personal&&(o.status!=='offered'||o.respondentId!==r.id||recipient(w,p)?.id!==r.id||transportNeedsPersonalConsent(w,o,p))))return '没有仍有效且交由本人决定的护送提议';
  if(a.operation==='declineRescue')return null;
  if(p.refusesCare)return '本人已有拒绝，不能用护送同意覆盖';
  const provider=person(w,o.carrierId);return provider?medicalDestinationReason(w,r,place(w,o.buildingId),{provider,menu:mode==='menu'}):'原护送人已经不在';
 }
 if(a.operation==='cancelRescue'){const t=w.health.transports.find(t=>t.id===a.transportId),o=w.health.transportOffers.find(o=>o.id===a.offerId),p=t&&person(w,t.patientId);if(t?.phase==='carrying'&&(r.id===t.patientId||r.id===t.carrierId||t.evacuationAuthority!=='incapacitated-adult'&&p&&knownAgeYears(p.bornAt,w.minute)!==null&&ageYears(p.bornAt,w.minute)<18&&p.guardianIds.includes(r.id)))return null;return o&&transportOfferOpen(w,o)&&[o.carrierId,o.respondentId,o.patientId].includes(r.id)?null:'没有本人可终止的护送安排';}
 const p=person(w,a.targetId);if(!p||p.status!=='alive'||p.residency==='outside'||p.id===r.id||!carrier(w,r))return '施救人须有能力，患者须仍在本地存活';
 const t=a.transportId?w.health.transports.find(t=>t.id===a.transportId):undefined;
 if(a.phase==='delivery'){if(a.operation!=='rescue'||!t||t.phase!=='carrying'||t.carrierId!==r.id||t.patientId!==p.id||(a.buildingId??null)!==t.buildingId||a.evacuationDangerId!==t.evacuationDangerId||a.evacuationDestination!==t.evacuationDestination||a.evacuationAuthority!==t.evacuationAuthority)return '本人护送已经停止';return deliveryProblem(w,r,p,t);}
 if(aboardFerry(w,r.id)||passenger(w,r.id)||w.health.transports.some(t=>t.carrierId===r.id&&t.phase==='carrying'))return '施救人须在岸上，且未占用另一项实际护送';
 if(passenger(w,p.id))return '患者已由另一项实际护送接出';
 const ferryProblem=ferryContactProblem(w,r,p,a);if(ferryProblem)return ferryProblem;
 if(!medicalContact(w,r,p,12))return '患者目前不在本人实际可接触范围';
 if(a.evacuationDangerId){const error=a.evacuationAuthority==='incapacitated-adult'?adultEvacuationReason(w,r,p,a.evacuationDangerId):guardianEvacuationReason(w,r,p,a.evacuationDangerId);if(error)return error;}
 if(a.evacuationDestination==='known-address'&&(!r.inside||r.inside!==p.inside||a.buildingId===r.inside))return '按已知地址的尝试须从幼儿所在的同一房间接出，不能改成一般远方护送';
 if(a.evacuationDangerId&&!r.inside&&findPath(w,r.at,p.at,false,Infinity,frontierRetreatStepAllowed(w,r))===null)return '不能跨入另一项已见危险接近幼儿，须重新决定安全路线';
 if(a.evacuationDestination==='safe-ground'){
  if(a.evacuationAuthority!=='incapacitated-adult'){const injury=guardianGroundPatientReason(w,p);if(injury)return injury;}
  if(r.inside){if(a.evacuationExitId!==r.inside||a.evacuationGround!==undefined)return '须先完成本人所在灾屋的真实出口，不能在室内指定外面干地';}
  else if(a.evacuationExitId!==undefined||!a.evacuationGround||!guardianGroundRoute(w,r,p.at,a.evacuationGround))return '附近未找到本人可见且实际八步内可达的干地';
  return (r.inventory.cloth??0)>=1&&(r.inventory.water??0)>=1&&(a.evacuationAuthority==='incapacitated-adult'?!adultEvacuationReason(w,r,p,a.evacuationDangerId!):rescueAuthority(w,r,p,undefined,true,12))?null:'干地接出需要本人1布料、1清水与当前现场监护权限';
 }
 if(a.operation==='stabilize')return r.skills.care>=1&&(r.inventory.medicine??0)>=1&&(r.inventory.water??0)>=1?rescueAuthority(w,r,p,undefined,false,12)?null:'没有当前有效的有限紧急照护权限':'基本稳定处理需要本人照护技能、1药剂和1清水';
 const b=place(w,a.buildingId),knownAddress=a.evacuationDestination==='known-address',unsafe=medicalDestinationReason(w,r,b,{menu:mode==='menu'||knownAddress});if(unsafe)return unsafe;if(!b||(!knownAddress&&(mode!=='menu'||canInspectBuilding(w,r,b))&&(medicalBed(w,b.id,p.id)===null||findPath(w,dockedFerryContact(w,p)?.land??p.at,b.door,false,Infinity,a.evacuationDangerId?frontierRetreatStepAllowed(w,r):undefined)===null)))return '没有真实可达、有使用权且仍有空床的接收场所';
 if(a.operation==='rescueOffer'){if(w.health.transportOffers.filter(o=>o.carrierId===r.id&&transportOfferOpen(w,o)).length>=4)return '请先处理本人已有的四项护送提议';if(!recipient(w,p)||p.refusesCare)return '没有可及时自行回应的患者或监护人';if(w.health.transportOffers.some(o=>o.carrierId===r.id&&o.patientId===p.id&&transportOfferOpen(w,o)))return '已有待处理的护送约定';return null;}
 if(a.operation==='rescue')return (r.inventory.cloth??0)>=1&&(r.inventory.water??0)>=1?(rescueAuthority(w,r,p,b.id,true,12)?null:'尚无患者同意、监护职责或当前有限紧急权限'):'接出患者需要本人1布料和1清水';
 return '没有这项救助行动';
}
export function transportTarget(w:World,r:Resident,a:HealthAction):{target:Vec;duration:number;error?:string}{bindFerryContact(w,a);const error=transportReason(w,r,a);if(error)return {target:r.at,duration:0,error};const p=person(w,a.targetId);return {target:isRescueDecision(a)?{...r.at}:a.operation==='rescue'&&a.phase==='delivery'?(a.evacuationDestination==='safe-ground'?a.evacuationGround??r.at:place(w,a.buildingId)!.door):a.ferryContact?.land??p?.at??r.at,duration:a.operation==='stabilize'?30:a.operation==='rescue'?15:5};}
function interrupt(w:World,t:MedicalTransport,reason:string){if(t.phase!=='carrying')return;t.phase='interrupted';t.endedAt=w.minute;t.reason=reason;const r=person(w,t.carrierId),p=person(w,t.patientId);if(r?.activity?.action.type==='health'&&r.activity.action.transportId===t.id){r.activity=null;r.plan=null;r.decisionDue=w.minute;r.revision++;}if(p){p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;}if(r&&p)fact(w,r,p,`${r.name}与${p.name}的护送在实际当前位置停止：${reason}。`);}
export function completeTransport(w:World,r:Resident,a:HealthAction):string|null{
 const problem=transportReason(w,r,a);if(problem)return problem;
 if(['acceptRescue','declineRescue'].includes(a.operation)){const o=w.health!.transportOffers.find(o=>o.id===a.offerId)!;o.status=a.operation==='acceptRescue'?'accepted':'declined';if(a.operation==='acceptRescue'){if(r.id===o.patientId)o.personalAcceptedAt=w.minute;else o.proxyAcceptedAt=w.minute;}else for(const t of w.health!.transports)if(t.offerId===o.id)interrupt(w,t,'本人明确拒绝原护送安排');const p=person(w,o.patientId)!;fact(w,r,p,`${r.name}${o.status==='accepted'?'接受':'婉拒'}了将${p.name}亲自护送到${place(w,o.buildingId)!.name}的具体安排；尚未发生搬运。`);return null;}
 if(a.operation==='cancelRescue'){const t=w.health!.transports.find(t=>t.id===a.transportId),o=w.health!.transportOffers.find(o=>o.id===a.offerId);if(o){o.status='cancelled';for(const current of w.health!.transports)if(current.offerId===o.id)interrupt(w,current,'当事人明确撤回原护送安排');}if(t){if(t.evacuationAuthority==='incapacitated-adult'&&r.id===t.patientId&&t.evacuationDangerId){w.health!.evacuationRefusals??=[];if(!w.health!.evacuationRefusals.some(x=>x.patientId===r.id&&x.dangerId===t.evacuationDangerId))w.health!.evacuationRefusals.push({patientId:r.id,dangerId:t.evacuationDangerId,at:w.minute});}if(t.offerId){const offer=w.health!.transportOffers.find(o=>o.id===t.offerId);if(offer)offer.status='cancelled';}interrupt(w,t,'当事人明确停止护送');}return null;}
 const p=person(w,a.targetId)!;
 if(a.phase!=='delivery'&&(aboardFerry(w,p.id)||a.ferryContact)){if(!a.ferryContact||!r.activity||r.activity.action!==a||r.activity.path.length||r.activity.remaining>1e-8||r.inside||!same(r.at,a.ferryContact.land))return '靠泊救助须亲自在原船相邻码头完成实际接触工时';}
 if(a.operation==='rescueOffer'){const respondent=recipient(w,p)!;const id=`transport-offer:${w.id}:${w.health!.nextSerial++}`;w.health!.transportOffers.push({id,carrierId:r.id,patientId:p.id,respondentId:respondent.id,buildingId:a.buildingId!,createdAt:w.minute,expiresAt:w.minute+DAY,status:'offered',personalAcceptedAt:null,proxyAcceptedAt:null});fact(w,r,p,`${r.name}向${respondent.name}提出将${p.name}护送到${place(w,a.buildingId)!.name}，等待本人或当前监护人自行决定。`);return null;}
 if(a.operation==='stabilize'){const authority=rescueAuthority(w,r,p,undefined,false);if(!authority)return '有限紧急权限已经失效';r.inventory.medicine!--;r.inventory.water!--;const c=activeCases(w,p.id).sort((a,b)=>b.severity-a.severity)[0];if(c){c.treatment+=35;c.severity=Math.max(0,c.severity-35);}p.health=Math.min(100,p.health+8);fact(w,r,p,`${r.name}实际使用本人1药剂、1水为${p.name}完成一次有限稳定处理；之后的治疗和决定权须重新核验。`,{rule:'health/emergency@1',authority:authority.basis,evidence:authority.evidence,scope:['basic-stabilization'],resources:{medicine:1,water:1},providerId:r.id,termination:'本次基本处理已完成，不延续概括权限'});return null;}
 if(!r.activity||r.activity.action!==a||r.activity.path.length||r.activity.room?.path.length||r.activity.remaining>1e-8)return '护送须完成本人实际路线与接触工时';
 if(a.evacuationDestination==='safe-ground')return completeGroundTransport(w,r,p,a);
 const b=place(w,a.buildingId)!;
 if(a.phase==='delivery'){
  const unsafe=medicalDestinationReason(w,r,b,{physical:true});if(unsafe)return unsafe;
  const t=w.health!.transports.find(t=>t.id===a.transportId)!;if(t.bed===null)return '接收床位仍未在门口实际核验';const slot=roomLayout(w,b).slots.find(s=>s.key==='bed:'+t.bed)!;if(r.inside!==b.id||!r.roomAt||distance(r.roomAt,slot.at)>1)return '尚未亲自走到接收床位';
  p.at={...r.at};p.inside=b.id;p.roomAt={...slot.at};p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;t.phase='delivered';t.endedAt=w.minute;t.reason='实际送入接收床位';if(t.offerId){const o=w.health!.transportOffers.find(o=>o.id===t.offerId);if(o)o.status='expired';}t.arrivalEventId=fact(w,r,p,`${r.name}沿实际路线把${p.name}送入${b.name}的第${t.bed+1}张床位；到达不等于已有人接班或已经治愈。`,presenceArrivalAudit(w,r,p,t)).id;return null;
 }
 const authority=rescueAuthority(w,r,p,b.id);if(!authority)return '实际接出时已无有效权限';const knownAddress=a.evacuationDestination==='known-address',bed=knownAddress?null:medicalBed(w,b.id,p.id),path=knownAddress?guardianKnownAddressPath(w,r,b.door):findPath(w,r.at,b.door,false,Infinity,a.evacuationDangerId?frontierRetreatStepAllowed(w,r):undefined);if(!knownAddress&&bed===null||path===null)return '接收床位或真实通路已经变化';
 if(r.inside&&(r.inside!==b.id||path.length)){const exitError=roomExitReason(w,r);if(exitError)return exitError;}
 if(a.ferryContact){const error=releaseRescuedFerryPassenger(w,p,a.ferryContact);if(error)return error;fact(w,r,p,`${r.name}在原靠泊点将${p.name}从${a.ferryContact.boatId}跨相邻一格接到码头；原船位已释放，未完成船程费用原路退回。`);}
 r.inventory.cloth!--;r.inventory.water!--;const id=`medical-transport:${w.id}:${w.health!.nextSerial++}`,offer=consent(w,r,p,b.id);w.health!.transports.push({id,carrierId:r.id,patientId:p.id,buildingId:b.id,bed,basis:authority.basis,offerId:offer?.id??null,...(a.evacuationDangerId?{evacuationDangerId:a.evacuationDangerId}:{}),...(a.evacuationDestination?{evacuationDestination:a.evacuationDestination}:{}),phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});p.plan=null;p.activity=null;p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;p.revision++;p.decisionDue=w.minute;
 a.phase='delivery';a.transportId=id;r.activity.path=path;r.activity.target={...b.door};r.activity.remaining=15;r.activity.travelProgress=0;const preparedExit=prepareRoomExit(w,r);if(preparedExit)return preparedExit;
 fact(w,r,p,`${r.name}实际用自己的布料和水接出${p.name}，开始护送到${b.name}，${knownAddress?'仅按已知地址尝试，床位尚未核验或保留':'接收床位已保留'}。`,{rule:'health/transport@1',authority:authority.basis,evidence:authority.evidence,scope:['transport-to:'+b.id],resources:{cloth:1,water:1},providerId:r.id,termination:'送达、当事人停止、能力恢复或及时代理出现即重新核验'});return null;
}
function completeGroundTransport(w:World,r:Resident,p:Resident,a:HealthAction):string|null {
 if(a.phase==='delivery'){
  const t=w.health!.transports.find(t=>t.id===a.transportId)!;
  if(!t.evacuationGround||r.inside||!same(r.at,t.evacuationGround)||r.activity!.room)return '尚未完成真实出门和逐格抵达干地';
  const unsafe=guardianGroundReason(w,r,t.evacuationGround);if(unsafe)return unsafe;
  t.phase='delivered';t.endedAt=w.minute;t.reason='实际临时落脚在附近干地；未安排床位、医疗或后续照护';p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;
  t.arrivalEventId=emitEvent(w,{kind:'care',actors:[r.id,p.id],place:{...r.at},audit:presenceArrivalAudit(w,r,p,t),text:`${r.name}沿实际路线将${p.name}临时带到附近干地（${r.at.x}，${r.at.y}）；仅完成这次撤险，不表示取得床位、住所、医疗或后续照护。`,hazardFact:{disasterId:t.evacuationDangerId!,phase:'retreat',targetId:p.id}}).id;return null;
 }
 const adult=a.evacuationAuthority==='incapacitated-adult',authority=adult?(!adultEvacuationReason(w,r,p,a.evacuationDangerId!)?{basis:'emergency' as const,evidence:`observed:${a.evacuationDangerId}:${p.id}:${w.minute}:cannot-decide`}:null):rescueAuthority(w,r,p);if(!authority||!adult&&authority.basis!=='guardian')return '实际接出时已无当前有限撤险权限';
 const route=r.inside?null:guardianGroundRoute(w,r,r.at,a.evacuationGround);
 if(!r.inside&&!route)return '实际接出时原干地或八步内真实通路已经变化';
 const exitError=roomExitReason(w,r);if(exitError)return exitError;
 const origin={...r.at},id=`medical-transport:${w.id}:${w.health!.nextSerial++}`;
 r.inventory.cloth!--;r.inventory.water!--;
 w.health!.transports.push({id,carrierId:r.id,patientId:p.id,buildingId:null,bed:null,basis:authority.basis,offerId:null,...(adult?{evacuationAuthority:'incapacitated-adult' as const}:{}),evacuationDangerId:a.evacuationDangerId,evacuationDestination:'safe-ground',evacuationOrigin:origin,evacuationSteps:0,...(a.evacuationExitId?{evacuationExitId:a.evacuationExitId}:{}),...(a.evacuationGround?{evacuationGround:{...a.evacuationGround}}:{}),phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});
 p.plan=null;p.activity=null;p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;p.revision++;p.decisionDue=w.minute;
 a.phase='delivery';a.transportId=id;r.activity!.path=route?.path??[];r.activity!.target=route?.to??origin;r.activity!.remaining=1;r.activity!.travelProgress=0;const preparedExit=prepareRoomExit(w,r);if(preparedExit)return preparedExit;
 fact(w,r,p,`${r.name}实际用本人1布料、1清水接出${p.name}，${a.evacuationExitId?'先逐格走出房间，出门后现场寻找八步内干地':'开始逐格前往已经选定的附近干地'}；未预占床位或安排医疗。`,{rule:adult?'health/adult-emergency-ground@1':'health/guardian-ground@1',authority:authority.basis,evidence:authority.evidence,scope:['temporary-ground-evacuation'],resources:{cloth:1,water:1},providerId:r.id,termination:adult?'本人恢复决定能力、异议、危险解除、实际落脚或通路失效即结束；不授予药物、财产、住房或长期照护':'实际落脚、本人停止、拒绝或监护及通路失效即结束；不附带后续照护'});return null;
}
export function syncMedicalTransport(w:World){for(const o of w.health?.transportOffers??[]){
 if(['offered','accepted','awaitingPatient'].includes(o.status)&&o.expiresAt<=w.minute){o.status='expired';continue;}
 const p=person(w,o.patientId);
 if(p&&transportOfferOpen(w,o)&&o.status!=='awaitingPatient'&&(o.status!=='offered'||o.respondentId!==p.id)&&transportNeedsPersonalConsent(w,o,p)&&!transportPersonalConsent(w,o,p)){
  o.status='awaitingPatient';p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;
 }
 }for(const t of w.health?.transports??[]){if(t.phase!=='carrying')continue;const r=person(w,t.carrierId),p=person(w,t.patientId);if(!r||!p||r.status!=='alive'||p.status!=='alive'||r.activity?.action.type!=='health'||r.activity.action.transportId!==t.id){interrupt(w,t,'护送人、患者或实际安排无法继续');continue;}if((r.activity.action.buildingId??null)!==t.buildingId||r.activity.action.targetId!==p.id||r.activity.action.evacuationDangerId!==t.evacuationDangerId||r.activity.action.evacuationDestination!==t.evacuationDestination||r.activity.action.evacuationAuthority!==t.evacuationAuthority){interrupt(w,t,'原护送目标已经变化');continue;}p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;const error=deliveryProblem(w,r,p,t);if(error){interrupt(w,t,error);continue;}
 if(t.evacuationDestination==='safe-ground'&&!t.evacuationGround&&!r.inside){
  const route=guardianGroundRoute(w,r);if(!route){interrupt(w,t,'实际出门后未找到八步内可见且可达的干地，停在真实门口重新决定');continue;}
  t.evacuationGround={...route.to};r.activity.action.evacuationGround={...route.to};r.activity.target={...route.to};r.activity.path=route.path;r.activity.travelProgress=0;
  fact(w,r,p,`${r.name}实际走到门外，现场选定八步内干地（${route.to.x}，${route.to.y}）；仍须沿途重验并实际抵达。`);
 }
 // Reserving here (never in menu validation) serializes actual arrivals before room entry.
 const b=place(w,t.buildingId);if(t.bed===null&&t.evacuationDestination==='known-address'&&b&&!r.inside&&same(r.at,b.door)&&!r.activity.path.length){
  const bed=medicalBed(w,b.id,p.id);if(bed===null){interrupt(w,t,'到场核验后没有可用接收床位');continue;}t.bed=bed;fact(w,r,p,`${r.name}实际到达${b.name}门口并核验接收权、屋况与第${bed+1}张空床，现为${p.name}保留；仍须实际走入床位。`);
 }
}}

export function transportContinues(w:World,r:Resident){return w.health?.transports.some(t=>t.carrierId===r.id&&t.phase==='carrying'&&r.activity?.action.type==='health'&&r.activity.action.transportId===t.id)??false;}

export function pruneTransportRecords(w:World){const s=w.health;if(!s)return;if(s.transportOffers.length>160)s.transportOffers=s.transportOffers.filter((o,i)=>transportOfferOpen(w,o)||i>=s.transportOffers.length-80);if(s.transports.length>160)s.transports=s.transports.filter((t,i)=>t.phase==='carrying'||i>=s.transports.length-80);}

export function noteGroundTransportStep(w:World,r:Resident){const a=r.activity?.action;if(a?.type!=='health'||a.evacuationDestination!=='safe-ground'||a.phase!=='delivery')return;const t=w.health?.transports.find(t=>t.id===a.transportId&&t.phase==='carrying');if(t)t.evacuationSteps=(t.evacuationSteps??0)+1;}

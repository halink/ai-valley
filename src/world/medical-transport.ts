import type {Resident,Vec,World} from '../shared/types.js';import type {HealthAction,MedicalTransport} from '../shared/health.js';import {activeCases,initializeHealth} from './health.js';import {coLocated} from './proximity.js';import {ageYears,DAY} from './time.js';import {findPath,distance,same} from './navigation.js';import {roomLayout} from '../shared/rooms.js';import {prepareRoomExit} from './rooms.js';import {emitEvent} from './events.js';
export const isTransportAction=(a:HealthAction)=>['rescueOffer','acceptRescue','declineRescue','cancelRescue','rescue','stabilize'].includes(a.operation);
const person=(w:World,id?:string)=>w.residents.find(r=>r.id===id),place=(w:World,id?:string)=>w.buildings.find(b=>b.id===id);
const capable=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const carrier=(w:World,r:Resident)=>capable(r)&&ageYears(r.bornAt,w.minute)>=18&&r.energy>=10&&r.health>30;
export function passenger(w:World,id:string){return w.health?.transports.find(t=>t.patientId===id&&t.phase==='carrying');}
function consent(w:World,r:Resident,p:Resident,id?:string){return w.health?.transportOffers.find(o=>o.carrierId===r.id&&o.patientId===p.id&&o.buildingId===id&&o.status==='accepted'&&o.expiresAt>w.minute);}
/** Fresh authority is required for every new emergency movement or stabilization step. */
export function rescueAuthority(w:World,r:Resident,p:Resident,id?:string,transport=true,range=2):{basis:'consent'|'guardian'|'emergency';evidence:string}|null{
 if(!carrier(w,r)||r.id===p.id||p.status!=='alive'||p.residency==='outside'||p.refusesCare||!coLocated(w,r,p,range))return null;
 if(transport){const offer=consent(w,r,p,id);if(offer)return {basis:'consent',evidence:offer.id};}
 if(ageYears(p.bornAt,w.minute)<6&&p.guardianIds.includes(r.id))return {basis:'guardian',evidence:`guardian:${r.id}:${p.id}`};
 if(p.canDecide&&p.canExpress)return null;
 if(p.health>20&&!activeCases(w,p.id).some(c=>c.stage==='critical'||c.severity>=85))return null;
 if(p.guardianIds.some(id=>{const g=person(w,id);return capable(g)&&coLocated(w,g,p,2);}))return null;
 return {basis:'emergency',evidence:`observed:${r.id}:${p.id}:${w.minute}:health=${p.health}:incapacity=${!p.canDecide||!p.canExpress}`};
}
export function medicalBed(w:World,id:string,patientId:string):number|null{
 const b=place(w,id);if(!b)return null;const slots=roomLayout(w,b).slots.filter(s=>s.kind==='bed');
 for(const s of slots){const index=Number(s.key.slice(4));if(w.health?.transports.some(t=>t.phase==='carrying'&&t.buildingId===id&&t.bed===index&&t.patientId!==patientId))continue;
  if(index===0&&(w.health?.appointments.some(a=>a.status==='accepted'&&a.buildingId===id&&a.start<=w.minute+120&&a.end>w.minute&&a.patientId!==patientId)||w.duties?.shifts.some(a=>a.buildingId===id&&a.role==='care'&&a.status==='on-duty'&&a.clientId&&a.clientId!==patientId)))continue;
  if(w.residents.some(p=>p.id!==patientId&&p.status==='alive'&&p.inside===id&&p.roomAt&&distance(p.roomAt,s.at)<=1))continue;return index;
 }return null;
}
function recipient(w:World,p:Resident){if(capable(p)&&ageYears(p.bornAt,w.minute)>=6)return p;return p.guardianIds.map(id=>person(w,id)).find(g=>capable(g)&&coLocated(w,g,p,2));}
const fact=(w:World,r:Resident,p:Resident,text:string,audit?:import('../shared/types.js').WorldEvent['audit'])=>emitEvent(w,{kind:'care',actors:[r.id,p.id],place:{...r.at},text,...(audit?{audit}:{})});
export function transportReason(w:World,r:Resident,a:HealthAction):string|null{
 if(!w.health||!capable(r))return '本人当前不能安排救助与护送';
 if(['acceptRescue','declineRescue'].includes(a.operation)){const o=w.health.transportOffers.find(o=>o.id===a.offerId),p=o&&person(w,o.patientId);return o&&o.status==='offered'&&o.respondentId===r.id&&o.expiresAt>w.minute&&p&&recipient(w,p)?.id===r.id?null:'没有仍有效且交由本人决定的护送提议';}
 if(a.operation==='cancelRescue'){const t=w.health.transports.find(t=>t.id===a.transportId),o=w.health.transportOffers.find(o=>o.id===a.offerId);if(t?.phase==='carrying'&&(r.id===t.patientId||r.id===t.carrierId||person(w,t.patientId)?.guardianIds.includes(r.id)))return null;return o&&['offered','accepted'].includes(o.status)&&[o.carrierId,o.respondentId].includes(r.id)?null:'没有本人可终止的护送安排';}
 const p=person(w,a.targetId);if(!p||p.status!=='alive'||p.residency==='outside'||p.id===r.id||!carrier(w,r))return '施救人须有能力，患者须仍在本地存活';
 const t=a.transportId?w.health.transports.find(t=>t.id===a.transportId):undefined;
 if(a.phase==='delivery'){if(!t||t.phase!=='carrying'||t.carrierId!==r.id||t.patientId!==p.id)return '本人护送已经停止';return rescueAuthority(w,r,p,t.buildingId)?null:'患者意愿、能力或及时代理已经改变，须立即停止例外移动';}
 if(passenger(w,p.id))return '患者已由另一项实际护送接出';
 if(!coLocated(w,r,p,12))return '患者目前不在本人实际可接触范围';
 if(a.operation==='stabilize')return r.skills.care>=1&&(r.inventory.medicine??0)>=1&&(r.inventory.water??0)>=1?rescueAuthority(w,r,p,undefined,false,12)?null:'没有当前有效的有限紧急照护权限':'基本稳定处理需要本人照护技能、1药剂和1清水';
 const b=place(w,a.buildingId);if(!b||!['clinic','lodge'].includes(b.kind)||b.condition<=0||!r.knownBuildings.includes(b.id)||b.ownerId!=='commons'&&b.ownerId!==r.id||medicalBed(w,b.id,p.id)===null||findPath(w,p.at,b.door)===null)return '没有真实可达、有使用权且仍有空床的接收场所';
 if(a.operation==='rescueOffer'){if(w.health.transportOffers.filter(o=>o.carrierId===r.id&&['offered','accepted'].includes(o.status)&&o.expiresAt>w.minute).length>=4)return '请先处理本人已有的四项护送提议';if(!recipient(w,p)||p.refusesCare)return '没有可及时自行回应的患者或监护人';if(w.health.transportOffers.some(o=>o.carrierId===r.id&&o.patientId===p.id&&['offered','accepted'].includes(o.status)&&o.expiresAt>w.minute))return '已有待处理的护送约定';return null;}
 if(a.operation==='rescue')return (r.inventory.cloth??0)>=1&&(r.inventory.water??0)>=1?(consent(w,r,p,b.id)||rescueAuthority(w,r,p,b.id,true,12)?null:'尚无患者同意、监护职责或当前有限紧急权限'):'接出患者需要本人1布料和1清水';
 return '没有这项救助行动';
}
export function transportTarget(w:World,r:Resident,a:HealthAction):{target:Vec;duration:number;error?:string}{const error=transportReason(w,r,a);if(error)return {target:r.at,duration:0,error};const p=person(w,a.targetId);return {target:a.operation==='rescue'&&a.phase==='delivery'?place(w,a.buildingId)!.door:p?.at??r.at,duration:a.operation==='stabilize'?30:a.operation==='rescue'?15:5};}
function interrupt(w:World,t:MedicalTransport,reason:string){if(t.phase!=='carrying')return;t.phase='interrupted';t.endedAt=w.minute;t.reason=reason;const r=person(w,t.carrierId),p=person(w,t.patientId);if(r?.activity?.action.type==='health'&&r.activity.action.transportId===t.id){r.activity=null;r.plan=null;r.decisionDue=w.minute;r.revision++;}if(p){p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;}if(r&&p)fact(w,r,p,`${r.name}与${p.name}的护送在实际当前位置停止：${reason}。`);}
export function completeTransport(w:World,r:Resident,a:HealthAction):string|null{
 const problem=transportReason(w,r,a);if(problem)return problem;
 if(['acceptRescue','declineRescue'].includes(a.operation)){const o=w.health!.transportOffers.find(o=>o.id===a.offerId)!;o.status=a.operation==='acceptRescue'?'accepted':'declined';const p=person(w,o.patientId)!;fact(w,r,p,`${r.name}${o.status==='accepted'?'接受':'婉拒'}了将${p.name}亲自护送到${place(w,o.buildingId)!.name}的具体安排；尚未发生搬运。`);return null;}
 if(a.operation==='cancelRescue'){const t=w.health!.transports.find(t=>t.id===a.transportId),o=w.health!.transportOffers.find(o=>o.id===a.offerId);if(o)o.status='cancelled';if(t){if(t.offerId){const offer=w.health!.transportOffers.find(o=>o.id===t.offerId);if(offer)offer.status='cancelled';}interrupt(w,t,'当事人明确停止护送');}return null;}
 const p=person(w,a.targetId)!;
 if(a.operation==='rescueOffer'){const respondent=recipient(w,p)!;const id=`transport-offer:${w.id}:${w.health!.nextSerial++}`;w.health!.transportOffers.push({id,carrierId:r.id,patientId:p.id,respondentId:respondent.id,buildingId:a.buildingId!,createdAt:w.minute,expiresAt:w.minute+DAY,status:'offered'});fact(w,r,p,`${r.name}向${respondent.name}提出将${p.name}护送到${place(w,a.buildingId)!.name}，等待本人或当前监护人自行决定。`);return null;}
 if(a.operation==='stabilize'){const authority=rescueAuthority(w,r,p,undefined,false);if(!authority)return '有限紧急权限已经失效';r.inventory.medicine!--;r.inventory.water!--;const c=activeCases(w,p.id).sort((a,b)=>b.severity-a.severity)[0];if(c){c.treatment+=35;c.severity=Math.max(0,c.severity-35);}p.health=Math.min(100,p.health+8);fact(w,r,p,`${r.name}实际使用本人1药剂、1水为${p.name}完成一次有限稳定处理；之后的治疗和决定权须重新核验。`,{rule:'health/emergency@1',authority:authority.basis,evidence:authority.evidence,scope:['basic-stabilization'],resources:{medicine:1,water:1},providerId:r.id,termination:'本次基本处理已完成，不延续概括权限'});return null;}
 if(!r.activity||r.activity.action!==a)return '护送须有本人实际执行的安排';
 const b=place(w,a.buildingId)!;
 if(a.phase==='delivery'){
  const t=w.health!.transports.find(t=>t.id===a.transportId)!,slot=roomLayout(w,b).slots.find(s=>s.key==='bed:'+t.bed)!;if(r.inside!==b.id||!r.roomAt||distance(r.roomAt,slot.at)>1)return '尚未亲自走到接收床位';
  p.at={...r.at};p.inside=b.id;p.roomAt={...slot.at};p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;t.phase='delivered';t.endedAt=w.minute;t.reason='实际送入接收床位';if(t.offerId){const o=w.health!.transportOffers.find(o=>o.id===t.offerId);if(o)o.status='expired';}fact(w,r,p,`${r.name}沿实际路线把${p.name}送入${b.name}的第${t.bed+1}张床位；到达不等于已有人接班或已经治愈。`);return null;
 }
 const authority=rescueAuthority(w,r,p,b.id);if(!authority)return '实际接出时已无有效权限';const bed=medicalBed(w,b.id,p.id),path=findPath(w,r.at,b.door);if(bed===null||path===null)return '接收床位或真实通路已经变化';
 r.inventory.cloth!--;r.inventory.water!--;const id=`medical-transport:${w.id}:${w.health!.nextSerial++}`,offer=consent(w,r,p,b.id);w.health!.transports.push({id,carrierId:r.id,patientId:p.id,buildingId:b.id,bed,basis:authority.basis,offerId:offer?.id??null,phase:'carrying',startedAt:w.minute,endedAt:null,reason:null});p.plan=null;p.activity=null;p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;p.revision++;p.decisionDue=w.minute;
 a.phase='delivery';a.transportId=id;r.activity.path=path;r.activity.target={...b.door};r.activity.remaining=15;r.activity.travelProgress=0;prepareRoomExit(w,r);
 fact(w,r,p,`${r.name}实际用自己的布料和水接出${p.name}，开始护送到${b.name}，接收床位已保留。`,{rule:'health/transport@1',authority:authority.basis,evidence:authority.evidence,scope:['transport-to:'+b.id],resources:{cloth:1,water:1},providerId:r.id,termination:'送达、当事人停止、能力恢复或及时代理出现即重新核验'});return null;
}
export function syncMedicalTransport(w:World){for(const o of w.health?.transportOffers??[])if(['offered','accepted'].includes(o.status)&&o.expiresAt<=w.minute)o.status='expired';for(const t of w.health?.transports??[]){if(t.phase!=='carrying')continue;const r=person(w,t.carrierId),p=person(w,t.patientId);if(!r||!p||r.status!=='alive'||p.status!=='alive'||r.activity?.action.type!=='health'||r.activity.action.transportId!==t.id){interrupt(w,t,'护送人、患者或实际安排无法继续');continue;}p.at={...r.at};p.inside=r.inside;p.roomAt=r.roomAt?{...r.roomAt}:null;if(!rescueAuthority(w,r,p,t.buildingId))interrupt(w,t,'患者当前意愿、完整能力或可及时决定的代理已经改变');}}

export function transportContinues(w:World,r:Resident){return w.health?.transports.some(t=>t.carrierId===r.id&&t.phase==='carrying'&&r.activity?.action.type==='health'&&r.activity.action.transportId===t.id)??false;}

export function pruneTransportRecords(w:World){const s=w.health;if(!s)return;if(s.transportOffers.length>160)s.transportOffers=s.transportOffers.filter((o,i)=>['offered','accepted'].includes(o.status)&&o.expiresAt>w.minute||i>=s.transportOffers.length-80);if(s.transports.length>160)s.transports=s.transports.filter((t,i)=>t.phase==='carrying'||i>=s.transports.length-80);}

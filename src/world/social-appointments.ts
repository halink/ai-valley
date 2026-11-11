import type {FormalOpportunity,Resident,World,Vec} from '../shared/types.js';
import type {SocialAppointment,SocialAppointmentAction,AppointmentKnowledge} from '../shared/social-appointments.js';
import {isSocialAppointmentStop} from '../shared/social-appointments.js';
import {knownAgeYears} from './time.js';
import {canObserve} from './knowledge.js';
import {canContactSocialTarget} from './social-observation.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {socialRoomAccess} from './relationships.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {hasReceipt} from './receipts.js';

const records=(w:World)=>w.socialAppointments?.records??[];
const person=(w:World,id:string)=>w.residents.find(r=>r.id===id);
const parties=(c:SocialAppointment)=>[c.proposerId,c.personId];
const point=(p:Vec)=>p&&Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y);
const receipt=(id:string)=>'social-appointment:offer:'+id;
const active=(s:AppointmentKnowledge|undefined)=>s==='offered'||s==='accepted';
const adult=(w:World,r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&r.health>0&&(knownAgeYears(r.bornAt,w.minute)??-1)>=18;
const carried=(w:World,r:Resident)=>!!travellingFamily(w,r.id)||!!familyPassenger(w,r.id)||!!w.ferries?.trips.some(t=>t.aboard.includes(r.id))||!!w.health?.transports.some(t=>t.phase==='carrying'&&(t.patientId===r.id||t.carrierId===r.id));
const contact=(w:World,a:Resident,b:Resident)=>adult(w,a)&&adult(w,b)&&!carried(w,a)&&!carried(w,b)&&canContactSocialTarget(w,a,b)&&canContactSocialTarget(w,b,a);
const unavailable='本人未能在此办理原约见；远方情况、原因和位置仍未知';
export const socialAppointmentReceiptId=(r:Resident)=>`appointment:${r.id}:${r.revision}`;
export function initializeSocialAppointments(w:World){if(w.mode==='formal')w.socialAppointments??={nextSerial:1,records:[]};}
function binding(c:SocialAppointment){return JSON.stringify([c.id,c.proposerId,c.personId,c.buildingId,c.place,c.placeName,c.offeredAt,c.start,c.end,c.receiptId,c.births,c.names]);}
function valid(w:World,c:SocialAppointment){
 if(!c||!c.known||!Array.isArray(c.visits)||!Array.isArray(c.eventIds)||c.proposerId===c.personId||!point(c.place)||!Array.isArray(c.names)||c.names.length!==2||!c.names.every(n=>typeof n==='string'&&n.length>0&&n.length<=100)||!Array.isArray(c.births)||c.births.length!==2||!c.births.every(b=>(knownAgeYears(b,c.offeredAt)??-1)>=18)||!Number.isFinite(c.offeredAt)||c.offeredAt>w.minute||!Number.isFinite(c.start)||!Number.isFinite(c.end))return false;
 // Reconstruct the original integer offsets rather than comparing a rounded
 // floating-point subtraction with the bounds (e.g. 631.2-511.2 > 120).
 const delay=Math.round(c.start-c.offeredAt),window=Math.round(c.end-c.start);
 if(delay<30||delay>2880||window<15||window>120||c.start!==c.offeredAt+delay||c.end!==c.start+window)return false;
 const proofMatches=(e:World['events'][number]|undefined,actors:string[])=>!!e&&Array.isArray(e.actors)&&e.actors.length===2&&e.actors.every((id,i)=>id===actors[i])&&Array.isArray(e.witnesses)&&parties(c).every(id=>e.witnesses.includes(id))&&e.audit?.authority==='independent-adult-social-choice'&&e.audit.providerId===c.proposerId&&e.audit.evidence===binding(c)&&JSON.stringify(e.audit.scope)===JSON.stringify(['public-rendezvous-only'])&&Object.keys(e.audit.resources??{}).length===0;
 const proof=w.events.find(e=>c.eventIds.includes(e.id)&&e.audit?.rule==='social-appointment/offer@1');
 if(!proofMatches(proof,parties(c))||proof!.at!==c.offeredAt||!hasReceipt(w,receipt(c.receiptId)))return false;
 if(c.acceptedAt!==null){const accepted=w.events.find(e=>c.eventIds.includes(e.id)&&e.audit?.rule==='social-appointment/accept@1');if(!Number.isFinite(c.acceptedAt)||c.acceptedAt<c.offeredAt||c.acceptedAt>w.minute||c.acceptedAt>=c.start||!proofMatches(accepted,[c.personId,c.proposerId])||accepted!.at!==c.acceptedAt)return false;}
 return true;
}
function personal(w:World,r:Resident){return records(w).filter(c=>parties(c).includes(r.id)&&valid(w,c));}
function physical(w:World,r:Resident){
 if(!point(r.at))return false;
 if(r.inside===null)return r.roomAt==null&&walkable(w,r.at);
 const b=w.buildings.find(b=>b.id===r.inside);return !!w.rooms&&!!b&&b.condition>0&&!!r.roomAt&&point(r.roomAt)&&same(r.at,b.door)&&socialRoomAccess(w,r,b)&&roomPath(roomLayout(w,b),r.roomAt,r.roomAt)!==null;
}
function sameIdentity(c:SocialAppointment,r:Resident){return r.bornAt===c.births[r.id===c.proposerId?0:1];}
function atSite(c:SocialAppointment,r:Resident){return r.inside===null&&r.roomAt==null&&same(r.at,c.place);}
function legalSite(w:World,c:SocialAppointment){const b=w.buildings.find(b=>b.id===c.buildingId);return !!b&&b.kind==='lodge'&&b.ownerId==='commons'&&b.condition>0&&same(b.door,c.place)&&walkable(w,c.place);}
function here(w:World,c:SocialAppointment,r:Resident){return adult(w,r)&&sameIdentity(c,r)&&canObserve(w,r)&&!carried(w,r)&&atSite(c,r)&&legalSite(w,c);}
function visit(c:SocialAppointment,id:string){return [...c.visits].reverse().find(v=>v.personId===id&&v.leftAt===null);}
function event(w:World,c:SocialAppointment,r:Resident,text:string,witnesses:string[],rule?:string){
 const e=emitEvent(w,{kind:'action',actors:rule==='social-appointment/offer@1'?parties(c):[r.id,...witnesses.filter(id=>id!==r.id)],place:{...r.at},witnesses,text,...(rule?{audit:{rule,authority:'independent-adult-social-choice',evidence:binding(c),scope:['public-rendezvous-only'],resources:{},providerId:c.proposerId,termination:'不强制赴约、不代言、不加关系、不扩使用权'}}:{})});
 c.eventIds.push(e.id);return e;
}
function notice(w:World,c:SocialAppointment,r:Resident,status:AppointmentKnowledge,text:string,rule?:string){
 const other=person(w,r.id===c.proposerId?c.personId:c.proposerId),listeners=[r.id,...(other&&contact(w,r,other)?[other.id]:[])];
 const e=event(w,c,r,text,listeners,rule);c.known[r.id]=status;
 for(const id of e.witnesses){c.known[id]=status;const p=person(w,id)!;p.revision++;/* No activity or decision timer is interrupted. */}
}
function shape(a:SocialAppointmentAction){
 const fields=a.operation==='offer'?['type','operation','personId','buildingId','startsIn','windowMinutes','receiptId']:a.operation==='wait'?['type','operation','appointmentId','minutes']:['type','operation','appointmentId'];
 return ['offer','accept','decline','withdraw','attend','wait'].includes(a.operation)&&Object.keys(a).length===fields.length&&fields.every(k=>Object.hasOwn(a,k));
}
export function socialAppointmentReason(w:World,r:Resident,a:SocialAppointmentAction,working=false):string|null {
 if(w.mode!=='formal'||!shape(a)||!adult(w,r))return '日常约见仅由年龄已知且能独立决定和表达的成年人办理';
 if(!isSocialAppointmentStop(a)&&!physical(w,r))return '本人真实位置或合法通路待核实，不能据约见转移位置';
 if(a.operation==='offer'){
  const p=person(w,a.personId),b=w.buildings.find(b=>b.id===a.buildingId);
  if(!Number.isSafeInteger(a.startsIn)||a.startsIn<30||a.startsIn>2880||!Number.isSafeInteger(a.windowMinutes)||a.windowMinutes<15||a.windowMinutes>120||typeof a.receiptId!=='string'||hasReceipt(w,receipt(a.receiptId)))return '约见限30–2880分钟后开始、15–120分钟窗口，旧提议不能重复';
  if(!p||p.id===r.id||!contact(w,r,p)||!b||b.kind!=='lodge'||b.ownerId!=='commons'||b.condition<=0||!r.knownBuildings.includes(b.id)||!walkable(w,b.door)||findPath(w,r.at,b.door)===null)return '须与对方实际当面联系，并提出本人已知、可达的公共共屋门前地点';
  if(personal(w,r).some(c=>active(c.known[r.id])&&w.minute<c.end))return '本人须先处理尚未结束的原约见，再提出新的约见';
  return null;
 }
 const c=records(w).find(c=>c.id===a.appointmentId);
 if(!c||!valid(w,c)||!parties(c).includes(r.id)||!sameIdentity(c,r))return '本人没有这份完整、原身份一致的约见记录';
 const finishingWait=working&&a.operation==='wait'&&r.activity?.action.type==='socialAppointment'&&r.activity.action.operation==='wait'&&r.activity.action.appointmentId===c.id;
 const stoppingWait=isSocialAppointmentStop(a)&&r.activity?.action.type==='socialAppointment'&&r.activity.action.operation==='wait'&&r.activity.action.appointmentId===c.id;
 if(!active(c.known[r.id])&&!finishingWait&&!stoppingWait||w.minute>c.end||w.minute===c.end&&!working)return '本人已知的原约见已经结束或超过固定窗口';
 if(isSocialAppointmentStop(a))return a.operation==='decline'&&(r.id!==c.personId||c.known[r.id]!=='offered')?'只能拒绝本人收到但尚未接受的原提议':null;
 if(carried(w,r))return '须先实际结束乘船、同行或护送，才能独立赴约';
 if(a.operation==='accept'){
  const p=person(w,c.proposerId);return r.id===c.personId&&c.known[r.id]==='offered'&&c.status==='offered'&&w.minute<c.start&&p&&sameIdentity(c,p)&&contact(w,r,p)?null:unavailable;
 }
 if(c.known[r.id]!=='accepted'&&!finishingWait||c.acceptedAt===null)return '本人尚未当面接受这份原约见';
 if(a.operation==='wait'){
  if(!Number.isSafeInteger(a.minutes)||a.minutes<1||a.minutes>120||!here(w,c,r)||!visit(c,r.id))return '须本人已实际赴约并在原地点，才能选择1–120分钟实际等候';
  if(!working&&w.minute+a.minutes>c.end)return '本人选择的等候不能超出原固定窗口';
 }else if(working&&!here(w,c,r))return unavailable;
 return null;
}
export function socialAppointmentTarget(w:World,r:Resident,a:SocialAppointmentAction){
 const error=socialAppointmentReason(w,r,a,a.operation==='wait');if(error)return {target:r.at,duration:0,error};
 const c=a.operation==='attend'?records(w).find(c=>c.id===a.appointmentId):undefined;
 return {target:c?{...c.place}:{...r.at},duration:a.operation==='wait'?a.minutes:1};
}
export function socialAppointmentTravelReason(w:World,r:Resident,a:SocialAppointmentAction){
 const error=socialAppointmentReason(w,r,a,true);if(error&&!(a.operation==='attend'&&error===unavailable))return error;
 const activity=r.activity;if(!activity)return unavailable;
 if(a.operation==='attend'){
  const c=records(w).find(c=>c.id===a.appointmentId)!;
  if(!same(activity.target,c.place)||activity.path.length&&distance(r.at,activity.path[0])!==1)return '原赴约路线不是连续实际步行';
  if(activity.room){const b=w.buildings.find(b=>b.id===r.inside),next=activity.room.path[0];if(!b||!r.roomAt||!socialRoomAccess(w,r,b)||!same(r.at,b.door)||next&&(distance(r.roomAt,next)!==1||roomPath(roomLayout(w,b),r.roomAt,next)?.length!==1))return '本人室内出口或使用权已失效';}
 }else if(activity.path.length||activity.room?.path.length)return unavailable;
 return null;
}
export function socialAppointmentWork(w:World,r:Resident,a:SocialAppointmentAction,minutes:number){
 const error=socialAppointmentReason(w,r,a,true);if(error)return error;
 const activity=r.activity;if(!activity||activity.path.length||activity.room?.path.length||minutes<=0||minutes>1)return unavailable;
 if(!Number.isFinite(activity.appointmentStartedAt)||w.minute-minutes<activity.appointmentStartedAt!-1e-7)return unavailable;
 const work=activity.appointmentWork??={from:w.minute-minutes,through:w.minute-minutes,minutes:0};
 if(![work.from,work.through,work.minutes].every(Number.isFinite)||work.from<activity.appointmentStartedAt!-1e-7||Math.abs(work.through-(w.minute-minutes))>1e-7||Math.abs(work.through-work.from-work.minutes)>1e-7||!Number.isFinite(work.minutes)||work.minutes<0)return unavailable;
 work.through=w.minute;work.minutes+=minutes;
 if(a.operation==='wait'){const c=records(w).find(c=>c.id===a.appointmentId)!;visit(c,r.id)!.waitedMinutes+=minutes;}
 return null;
}
export function completeSocialAppointment(w:World,r:Resident,a:SocialAppointmentAction):string|null {
 const error=socialAppointmentReason(w,r,a,!isSocialAppointmentStop(a));if(error)return error;
 if(isSocialAppointmentStop(a)){
  const c=records(w).find(c=>c.id===a.appointmentId)!;
  if(c.status==='offered'||c.status==='accepted'){c.status=a.operation==='decline'?'declined':'withdrawn';c.endedAt=w.minute;}
  notice(w,c,r,a.operation==='decline'?'declined':'withdrawn',`${r.name}${a.operation==='decline'?'独立拒绝':'撤回本人参与'}日常约见${c.id}；远方当事人不会自动获知，不替另一方改变安排。`);
  const v=visit(c,r.id);if(v)v.leftAt=w.minute;
  const matches=(v:typeof a|import('../shared/types.js').Action)=>v.type==='socialAppointment'&&v.operation!=='offer'&&v.appointmentId===c.id;
  if(r.activity&&matches(r.activity.action)||r.plan?.actions.some(matches)){r.activity=null;r.plan=null;r.decisionDue=w.minute;}return null;
 }
 const work=r.activity?.appointmentWork;
 if(!work||!Number.isFinite(r.activity?.appointmentStartedAt)||work.from<r.activity!.appointmentStartedAt!-1e-7||r.activity!.remaining>0||r.activity!.path.length||r.activity!.room?.path.length||![work.from,work.through,work.minutes].every(Number.isFinite)||work.minutes<=0||work.minutes>121||work.through!==w.minute||Math.abs(work.through-work.from-work.minutes)>1e-7||work.minutes<(a.operation==='wait'?a.minutes:1)||JSON.stringify(r.activity!.action)!==JSON.stringify(a))return '须完成本人实际办理或等候时间，不能直接写入到场';
 initializeSocialAppointments(w);
 if(a.operation==='offer'){
  const b=w.buildings.find(b=>b.id===a.buildingId)!,p=person(w,a.personId)!,state=w.socialAppointments!;
  const c:SocialAppointment={id:`appointment:${w.id}:${state.nextSerial++}`,proposerId:r.id,personId:p.id,buildingId:b.id,place:{...b.door},placeName:b.name+'门前',offeredAt:w.minute,start:w.minute+a.startsIn,end:w.minute+a.startsIn+a.windowMinutes,receiptId:a.receiptId,births:[r.bornAt,p.bornAt],names:[r.name,p.name],acceptedAt:null,endedAt:null,status:'offered',known:{},visits:[],metAt:null,eventIds:[]};
  state.records.push(c);w.processed.push(receipt(a.receiptId));notice(w,c,r,'offered',`${r.name}当面向${p.name}提出日常约见：${c.placeName}(${c.place.x},${c.place.y})，${c.start}至${c.end}分钟；对方须独立答复，之后双方仍须各自选择赴约。`,'social-appointment/offer@1');return null;
 }
 const c=records(w).find(c=>c.id===a.appointmentId)!;
 if(a.operation==='accept'){c.acceptedAt=w.minute;c.status='accepted';notice(w,c,r,'accepted',`${r.name}当面独立接受日常约见${c.id}：${c.placeName}，${c.start}至${c.end}分钟。未开始赴约，不打断任何人的生活安排。`,'social-appointment/accept@1');return null;}
 if(a.operation==='attend'){
  if(!visit(c,r.id))c.visits.push({personId:r.id,arrivedAt:w.minute,leftAt:null,waitedMinutes:0});
  const other=person(w,r.id===c.proposerId?c.personId:c.proposerId),seen=!!other&&atSite(c,other)&&contact(w,r,other);
  event(w,c,r,`${r.name}实际走到日常约见${c.id}的${c.placeName}，${w.minute<c.start?'尚未到约定开始时刻':'已在原约见窗口内'}；此刻${seen?'在这里见到原当事人':'在这里没有见到原当事人，缺席原因未知'}。等候、交谈或离开仍须本人决定。`,[r.id]);
 }else event(w,c,r,`${r.name}在日常约见${c.id}的原地点实际等候${work.minutes}分钟；这不说明另一方在远处发生了什么。`,[r.id]);
 return null;
}
export function recordSocialAppointmentFailure(w:World,r:Resident,a:SocialAppointmentAction,reason:string){
 if(a.operation==='offer')return;const c=records(w).find(c=>c.id===a.appointmentId);if(!c||!parties(c).includes(r.id)||!valid(w,c))return;
 event(w,c,r,`${r.name}本次日常约见${c.id}的${a.operation==='attend'?'赴约':a.operation==='wait'?'等候':'办理'}未完成：${reason}。未替另一方改动安排，也未推断其远方状况。`,[r.id]);
}
/** Passive fact recognition never schedules a trip, wait, speech or relationship change. */
export function advanceSocialAppointments(w:World){
 initializeSocialAppointments(w);
 for(const c of records(w)){
  if(!valid(w,c))continue;
  for(const v of c.visits.filter(v=>v.leftAt===null)){const r=person(w,v.personId);if(!r||!here(w,c,r)||w.minute>=c.end){v.leftAt=w.minute;if(r)event(w,c,r,`${r.name}结束日常约见${c.id}这次在场；累计实际选择等候${v.waitedMinutes}分钟。`,[r.id]);}}
  if(c.status==='accepted'&&c.metAt===null&&w.minute>=c.start&&w.minute<c.end){
   const a=person(w,c.proposerId),b=person(w,c.personId);
   if(a&&b&&here(w,c,a)&&here(w,c,b)&&visit(c,a.id)&&visit(c,b.id)&&contact(w,a,b)){
    c.metAt=w.minute;c.status='met';c.endedAt=w.minute;notice(w,c,a,'met',`${a.name}与${b.name}在日常约见${c.id}的约定窗口内实际共同到场；约见相遇已发生，尚未交谈，不自动改变关系或代替后续选择。`);
   }
  }
  if((c.status==='offered'||c.status==='accepted')&&w.minute>=c.end){c.status='elapsed';c.endedAt=w.minute;c.eventIds.push(emitLedgerEvent(w,{kind:'action',actors:parties(c),place:{...c.place},text:`日常约见${c.id}原窗口已结束；${c.acceptedAt===null?'未有双方接受':'未记录双方在窗口内共同赴约'}。这不说明缺席原因，也不向远方居民递送消息。`}).id);}
 }
}
export function socialAppointmentNotes(w:World,r:Resident){
 const all=personal(w,r).filter(c=>w.minute<c.end||w.minute-c.end<1440).sort((a,b)=>Number(active(b.known[r.id]))-Number(active(a.known[r.id]))||a.start-b.start);
 return all.slice(0,6).map(c=>`${c.id}：与${c.names[r.id===c.proposerId?1:0]}约在${c.placeName}(${c.place.x},${c.place.y})，固定${c.start}至${c.end}分钟；本人最后获知${({offered:'提议待答复',accepted:'双方当面接受',declined:'拒绝',withdrawn:'撤回',met:'真实相遇'})[c.known[r.id]]??'未知'}${w.minute>=c.end?'，原窗口已过':''}；本人累计实际选择等候${c.visits.filter(v=>v.personId===r.id).reduce((n,v)=>n+v.waitedMinutes,0)}分钟。远方状态和缺席原因未知。`).join('\n')+(all.length>6?`\n另有${all.length-6}条本人约见记录未展开。`:'');
}
export function socialAppointmentOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!adult(w,r))return [];
 const out:FormalOpportunity[]=[],add=(key:string,label:string,a:SocialAppointmentAction)=>out.push({id:'socialAppointment.'+key,label,action:a});
 const own=personal(w,r).filter(c=>w.minute<c.end&&(active(c.known[r.id])||r.activity?.action.type==='socialAppointment'&&r.activity.action.operation==='wait'&&r.activity.action.appointmentId===c.id));
 // One complete group per turn; active journey first, remaining records rotate.
 const busy=r.activity?.action,selected=own.find(c=>busy?.type==='socialAppointment'&&busy.operation!=='offer'&&busy.appointmentId===c.id)??own.sort((a,b)=>a.start-b.start)[Math.floor(w.minute/30)%Math.max(1,own.length)];
 if(selected){const c=selected,term=`${c.placeName}(${c.place.x},${c.place.y})，固定${c.start}至${c.end}分钟`;
  add('stop.'+c.id,`本人${c.known[r.id]==='offered'&&r.id===c.personId?'拒绝':'撤回参与'}日常约见：${term}；不代另一方决定或远程通知`,{type:'socialAppointment',operation:c.known[r.id]==='offered'&&r.id===c.personId?'decline':'withdraw',appointmentId:c.id});
  const accept:SocialAppointmentAction={type:'socialAppointment',operation:'accept',appointmentId:c.id};
  if(!socialAppointmentReason(w,r,accept))add('accept.'+c.id,`独立当面接受日常约见：${term}；不自动赴约`,accept);
  if(c.known[r.id]==='accepted'&&!carried(w,r)){
   if(!atSite(c,r)||!visit(c,r.id))add('attend.'+c.id,`本人沿实际路线赴日常约见：${term}；现场再核实，不追踪对方，也不自动等待或交谈`,{type:'socialAppointment',operation:'attend',appointmentId:c.id});
   else if(here(w,c,r)&&c.end-w.minute>=1)add('wait.'+c.id,`本人在原约见地点选择实际等候（填写 minutes，1–${Math.min(120,Math.floor(c.end-w.minute))}）；${term}，身体照常消耗，可另选离开`,{type:'socialAppointment',operation:'wait',appointmentId:c.id,minutes:Math.min(15,Math.floor(c.end-w.minute))});
  }
 }
 if(!own.length&&!carried(w,r)){
  const peers=w.residents.filter(p=>p.id!==r.id&&contact(w,r,p)).sort((a,b)=>a.id.localeCompare(b.id));
  const p=peers[Math.floor(w.minute/30)%Math.max(1,peers.length)],b=w.buildings.filter(b=>b.kind==='lodge'&&b.ownerId==='commons'&&r.knownBuildings.includes(b.id)).sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(p&&b){const a:SocialAppointmentAction={type:'socialAppointment',operation:'offer',personId:p.id,buildingId:b.id,startsIn:60,windowMinutes:30,receiptId:socialAppointmentReceiptId(r)};if(!socialAppointmentReason(w,r,a))add('offer.'+p.id,`当面约${p.name}以后在${b.name}门前(${b.door.x},${b.door.y})见面（填写 startsIn：30–2880分钟后，windowMinutes：15–120分钟窗口）；须对方独立答复，不强迫任何人赴约`,a);}
 }
 return out;
}

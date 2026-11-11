import type {Action,FormalOpportunity,PersonObservation,Resident,World} from '../shared/types.js';
import type {AdultPresenceAction,AdultPresenceRecord} from '../shared/adult-presence.js';
import type {MedicalTransport} from '../shared/health.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {canObserveBody} from './body-observation.js';
import {buildingSheltersFrom} from './building-safety.js';
import {same,distance} from './navigation.js';
import {ageYears} from './time.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {hasReceipt} from './receipts.js';

export const ADULT_PRESENCE_MINUTES=15;
export const ADULT_PRESENCE_SOURCE_WINDOW=60;
const unavailable='原现场核实、本人意愿或有限在场条件已失效；未完成后续照护，不追踪远处情况';
const person=(w:World,id:string)=>w.residents.find(p=>p.id===id);
const alive=(p:Resident|undefined|null):p is Resident=>!!p&&p.status==='alive'&&p.residency!=='outside';
const record=(w:World,id:string)=>w.adultPresence?.records.find(c=>c.id===id);
const receipt=(id:string)=>`adult-presence:source:${id}`;
const binding=(t:MedicalTransport)=>JSON.stringify([t.id,t.carrierId,t.patientId,t.startedAt,t.endedAt,t.arrivalEventId,t.phase,t.buildingId,t.bed,t.evacuationDestination??null,t.evacuationDangerId??null]);
const location=(w:World,p:Resident):PersonObservation=>({id:p.id,at:{...p.at},inside:p.inside,roomAt:p.roomAt?{...p.roomAt}:null,atMinute:w.minute});
const validLocation=(l:PersonObservation|undefined):l is PersonObservation=>!!l&&typeof l.id==='string'&&!!l.at&&Number.isFinite(l.at.x)&&Number.isFinite(l.at.y)&&(l.inside===null||typeof l.inside==='string')&&(l.roomAt===null||!!l.roomAt&&Number.isFinite(l.roomAt.x)&&Number.isFinite(l.roomAt.y));
const atLocation=(p:Resident,l:PersonObservation)=>validLocation(l)&&p.id===l.id&&same(p.at,l.at)&&p.inside===l.inside&&(p.roomAt===null&&l.roomAt===null||!!p.roomAt&&!!l.roomAt&&same(p.roomAt,l.roomAt));
const travelling=(w:World,p:Resident)=>!!travellingFamily(w,p.id)||!!familyPassenger(w,p.id)||!!w.ferries?.trips.some(t=>t.aboard.includes(p.id))||!!w.health?.transports.some(t=>t.phase==='carrying'&&(t.patientId===p.id||t.carrierId===p.id));
export function initializeAdultPresence(w:World){if(w.mode==='formal')w.adultPresence??={records:[],refusals:[]};}
function shape(a:AdultPresenceAction){const keys=a.operation==='verify'?['type','operation','transportId','eventId']:a.operation==='stopVerification'?['type','operation','transportId','eventId','providerId']:['type','operation','recordId'];return ['verify','stay','stop','stopVerification'].includes(a.operation)&&Object.keys(a).every(k=>keys.includes(k))&&keys.every(k=>typeof (a as unknown as Record<string,unknown>)[k]==='string'&&(a as unknown as Record<string,string>)[k].length>0);}
function access(w:World,p:Resident){
 if(p.inside===null)return true;
 const b=w.buildings.find(b=>b.id===p.inside);
 return !!b&&b.condition>0&&(b.ownerId==='commons'||b.ownerId===p.id||b.residents.includes(p.id)||!!commonsStay(w,p,b.id)||!!residentialStay(w,p.id,b.id));
}
function safe(w:World,p:Resident){
 const b=p.inside?w.buildings.find(b=>b.id===p.inside):undefined;
 return !w.frontierHazards?.disasters.some(d=>d.phase!=='ended'&&d.endsAt>w.minute&&disasterContains(d,p.at)&&(!b||!buildingSheltersFrom(b,d)))&&
  !(!p.inside&&w.frontierHazards?.beasts.some(n=>n.status==='alive'&&['wolf','boar'].includes(n.species)&&distance(n.at,p.at)<=3));
}
function localReason(w:World,r:Resident,p:Resident|undefined):string|null {
 if(w.mode!=='formal'||!alive(r)||!alive(p)||r.id===p.id||!r.canDecide||!r.canExpress||!Number.isFinite(ageYears(r.bornAt,w.minute))||!Number.isFinite(ageYears(p.bornAt,w.minute))||ageYears(r.bornAt,w.minute)<18||ageYears(p.bornAt,w.minute)<18||p.canDecide!==false||p.refusesCare||!Number.isFinite(r.health)||r.health<=30||!Number.isFinite(r.energy)||r.energy<10||!Number.isFinite(p.health)||p.health<=20||p.plan||p.activity||travelling(w,r)||travelling(w,p))return unavailable;
 // Always establish real legal contact before consulting any target condition.
 if(!canObserveBody(w,r,p)||!access(w,r)||!access(w,p)||!safe(w,r)||!safe(w,p))return unavailable;
 if(w.health?.cases.some(c=>c.personId===p.id&&c.stage!=='resolved'&&(c.stage==='critical'||!Number.isFinite(c.severity)||c.severity>=Math.min(85,c.rules?.criticalSeverity??85)||p.health<=(c.rules?.criticalHealth??20))))return unavailable;
 return null;
}
export function presenceArrivalAudit(w:World,r:Resident,p:Resident,t:MedicalTransport):NonNullable<import('../shared/types.js').WorldEvent['audit']>{
 return {rule:'health/arrival@1',authority:t.basis,evidence:t.id,scope:['actual-arrival',...w.residents.filter(q=>canObserveBody(w,q,p)&&access(w,q)&&access(w,p)).map(q=>'presence-witness:'+q.id)],resources:{},providerId:r.id,termination:'仅记录送达，不授予后续照护'};
}
function source(w:World,transportId:string,eventId:string){
 const t=w.health?.transports.find(t=>t.id===transportId),e=w.events.find(e=>e.id===eventId);
 if(!t||t.phase!=='delivered'||!Number.isFinite(t.startedAt)||typeof t.endedAt!=='number'||!Number.isFinite(t.endedAt)||t.endedAt<t.startedAt||t.endedAt>w.minute||t.arrivalEventId!==eventId||!e||e.at!==t.endedAt||e.kind!=='care'||e.audit?.rule!=='health/arrival@1'||!Array.isArray(e.witnesses)||!Array.isArray(e.audit.scope)||!Array.isArray(e.actors)||e.audit.evidence!==t.id||e.actors[0]!==t.carrierId||e.actors[1]!==t.patientId)return null;
 return {t,e};
}
function validRecord(c:AdultPresenceRecord){return !!c&&validLocation(c.providerLocation)&&validLocation(c.personLocation)&&Array.isArray(c.stops)&&c.stops.every(s=>!!s&&typeof s.personId==='string'&&Number.isFinite(s.at))&&Array.isArray(c.eventIds)&&Number.isFinite(c.verifiedAt)&&Number.isFinite(c.expiresAt)&&Number.isFinite(c.minutes)&&c.minutes>=0&&c.minutes<=ADULT_PRESENCE_MINUTES&&(c.startedAt===null||Number.isFinite(c.startedAt))&&(c.lastAt===null||Number.isFinite(c.lastAt))&&['verified','present','ended'].includes(c.status);}
function currentReason(w:World,c:AdultPresenceRecord,throughDeadline=false):string|null {
 if(!validRecord(c))return unavailable;
 const r=person(w,c.providerId),p=person(w,c.personId);
 if(!alive(r)||!alive(p)||!Number.isFinite(c.verifiedAt)||!Number.isFinite(c.expiresAt)||c.expiresAt<=c.verifiedAt||c.expiresAt>c.verifiedAt+ADULT_PRESENCE_MINUTES||c.verifiedAt>w.minute||(throughDeadline?w.minute>c.expiresAt:w.minute>=c.expiresAt)||c.status==='ended'||c.stops.length||!atLocation(r,c.providerLocation)||!atLocation(p,c.personLocation)||localReason(w,r,p))return unavailable;
 const s=source(w,c.transportId,c.eventId);
 const proof=w.events.find(e=>c.eventIds.includes(e.id)&&e.audit?.rule==='adult/non-invasive-presence@1'&&e.audit.evidence===c.eventId);
 if(!proof||proof.at!==c.verifiedAt||proof.actors[0]!==c.providerId||proof.actors[1]!==c.personId||!s||c.expiresAt!==Math.min(proof.at+ADULT_PRESENCE_MINUTES,s.t.endedAt!+ADULT_PRESENCE_SOURCE_WINDOW)||binding(s.t)!==c.sourceBinding||s.t.patientId!==c.personId||(!s.e.witnesses.includes(c.providerId)||!s.e.audit?.scope.includes('presence-witness:'+c.providerId))||c.expiresAt>s.t.endedAt!+ADULT_PRESENCE_SOURCE_WINDOW||w.adultPresence?.refusals.some(x=>x.personId===p.id&&x.transportId===c.transportId))return unavailable;
 return null;
}
/** Stop is an expression right tied only to one's own fixed record. Its menu
 * does not disclose an unseen remote invalidation or require a capable helper. */
export function adultPresenceSelfStop(w:World,r:Resident,a:Action):AdultPresenceAction|null {
 if(a.type!=='adultPresence'||!['stop','stopVerification'].includes(a.operation)||!shape(a)||w.mode!=='formal'||!alive(r)||!r.canExpress)return null;
 if(a.operation==='stopVerification'){
  const s=source(w,a.transportId,a.eventId),provider=person(w,a.providerId),p=s&&person(w,s.t.patientId);
  if(!s||!alive(provider)||!alive(p)||!s.e.witnesses.includes(provider.id)||!s.e.audit!.scope.includes('presence-witness:'+provider.id)||![provider.id,p.id].includes(r.id)||hasReceipt(w,receipt(s.t.id))||w.minute>=s.t.endedAt!+ADULT_PRESENCE_SOURCE_WINDOW)return null;
  const queued=[...(provider.plan?.actions??[]),...(provider.activity?[provider.activity.action]:[])].some(v=>v.type==='adultPresence'&&v.operation==='verify'&&v.transportId===a.transportId&&v.eventId===a.eventId&&shape(v));
  // The recipient can reject only a real, nearby verification, not discover remote plans.
  return queued&&(r.id===provider.id||canObserveBody(w,provider,p)&&access(w,provider)&&access(w,p))?a:null;
 }
 if(a.operation!=='stop')return null;
 const c=record(w,a.recordId);
 return c&&validRecord(c)&&[c.personId,c.providerId].includes(r.id)&&c.expiresAt>w.minute&&!c.stops.some(s=>s.personId===r.id)?a:null;
}
export function adultPresenceReason(w:World,r:Resident,a:AdultPresenceAction,working=false):string|null {
 if(!shape(a))return unavailable;
 if(a.operation==='stop'||a.operation==='stopVerification')return adultPresenceSelfStop(w,r,a)?null:unavailable;
 if(working&&(!r.activity||r.activity.action!==a||r.activity.path.length||r.activity.room||!same(r.activity.target,r.at)))return unavailable;
 if(a.operation==='verify'){
  const s=source(w,a.transportId,a.eventId),p=s&&person(w,s.t.patientId);
  if(!s||!p||localReason(w,r,p)||(!s.e.witnesses.includes(r.id)||!s.e.audit?.scope.includes('presence-witness:'+r.id))||w.minute>=s.t.endedAt!+ADULT_PRESENCE_SOURCE_WINDOW||hasReceipt(w,receipt(s.t.id))||w.adultPresence?.records.some(c=>c.transportId===s.t.id)||w.adultPresence?.refusals.some(x=>x.personId===p.id&&x.transportId===s.t.id))return unavailable;
  return null;
 }
 const c=record(w,a.recordId);
 if(!c||c.providerId!==r.id||currentReason(w,c,working)||!working&&c.status!=='verified')return unavailable;
 if(working&&(!r.activity||r.activity.action.type!=='adultPresence'||r.activity.action.operation!=='stay'||r.activity.action.recordId!==c.id||r.activity.path.length||r.activity.room||!same(r.activity.target,r.at)))return unavailable;
 return null;
}
export function adultPresenceTarget(w:World,r:Resident,a:AdultPresenceAction,elapsed=0){
 const error=adultPresenceReason(w,r,a);
 return {target:{...r.at},duration:a.operation==='stay'?Math.max(0,(record(w,a.recordId)?.expiresAt??w.minute)-w.minute+elapsed):2,...(error?{error}: {})};
}
function end(w:World,c:AdultPresenceRecord,reason:string){
 if(c.status==='ended')return;const valid=validRecord(c);c.status='ended';c.endedAt=w.minute;c.reason=reason;
 if(!valid)return;
 const e=emitLedgerEvent(w,{kind:'care',actors:[c.providerId,c.personId],place:{...c.personLocation.at},roomId:c.personLocation.inside,roomAt:c.personLocation.roomAt,text:`原救援${c.transportId}的有限在场结束：${reason}。仅记录实际核实与${c.minutes.toFixed(2)}分钟在场；后续照护仍未解决，不表示进食、饮水、治疗、接班或恢复。`});c.eventIds.push(e.id);
 const r=person(w,c.providerId);
 if(r?.activity?.action.type==='adultPresence'&&r.activity.action.operation==='stay'&&r.activity.action.recordId===c.id){r.activity=null;r.plan=null;r.decisionDue=w.minute;r.revision++;}
}
/** Count only contiguous, physically revalidated world time. Replayed ticks,
 * injected paths and a shortened remaining timer never manufacture presence. */
export function adultPresenceWork(w:World,r:Resident,a:AdultPresenceAction,minutes:number):string|null {
 const error=adultPresenceReason(w,r,a,true);if(error)return error;
 if(!Number.isFinite(minutes)||minutes<=0||!r.activity||r.activity.path.length||r.activity.room||!same(r.activity.target,r.at))return unavailable;
 if(a.operation==='verify'){
  const s=source(w,a.transportId,a.eventId)!,p=person(w,s.t.patientId)!,from=w.minute-minutes,work=r.activity.presenceWork;
  if(r.activity.action!==a)return unavailable;
  if(work&&(!Number.isFinite(work.from)||!Number.isFinite(work.through)||!Number.isFinite(work.minutes)||work.minutes<=0||work.from>work.through||Math.abs(work.minutes-(work.through-work.from))>1e-8||work.through!==from||!atLocation(r,work.provider)||!atLocation(p,work.person)))return unavailable;
  r.activity.presenceWork=work?{...work,through:w.minute,minutes:work.minutes+minutes}:{from,through:w.minute,minutes,provider:location(w,r),person:location(w,p)};return null;
 }
 if(a.operation!=='stay')return unavailable;
 const c=record(w,a.recordId)!,from=w.minute-minutes;
 if(!Number.isFinite(minutes)||minutes<=0||from<c.verifiedAt||c.lastAt!==null&&c.lastAt!==from||!Number.isFinite(c.minutes)||c.minutes<0)return unavailable;
 if(c.startedAt===null){c.startedAt=from;c.status='present';}
 c.lastAt=w.minute;c.minutes+=minutes;
 return null;
}
export function completeAdultPresence(w:World,r:Resident,a:AdultPresenceAction):string|null {
 const error=adultPresenceReason(w,r,a,a.operation==='stay');if(error)return error;
 initializeAdultPresence(w);
 if(a.operation==='stopVerification'){
  const s=source(w,a.transportId,a.eventId)!,provider=person(w,a.providerId)!;
  w.processed.push(receipt(s.t.id));
  if(r.id===s.t.patientId)w.adultPresence!.refusals.push({personId:r.id,transportId:s.t.id,eventId:s.e.id,at:w.minute});
  const matches=(v:Action)=>v.type==='adultPresence'&&v.operation==='verify'&&v.transportId===s.t.id&&v.eventId===s.e.id;
  if(provider.activity&&matches(provider.activity.action))provider.activity=null;
  if(provider.plan){provider.plan.actions=provider.plan.actions.filter(v=>!matches(v));if(!provider.plan.actions.length&&!provider.activity)provider.plan=null;}
  provider.revision++;provider.decisionDue=w.minute;
  emitEvent(w,{kind:'care',actors:[r.id],place:{...r.at},text:`${r.name}停止原救援${s.t.id}下本次现场核实；核实未完成，后续照护仍未解决，不自动续期或换人。`});return null;
 }
 if(a.operation==='stop'){
  const c=record(w,a.recordId)!;c.stops.push({personId:r.id,at:w.minute});
  if(c.personId===r.id&&!w.adultPresence!.refusals.some(x=>x.personId===r.id&&x.transportId===c.transportId))w.adultPresence!.refusals.push({personId:r.id,transportId:c.transportId,eventId:c.eventId,at:w.minute});
  end(w,c,'参与者明确停止本回合');
  const e=emitEvent(w,{kind:'care',actors:[r.id],place:{...r.at},text:`${r.name}明确停止原救援${c.transportId}下这一次有限在场；这不是接受照护或授权其他行动。`});c.eventIds.push(e.id);return null;
 }
 if(a.operation==='verify'){
  const s=source(w,a.transportId,a.eventId)!,p=person(w,s.t.patientId)!,work=r.activity?.presenceWork;
  if(!work||!Number.isFinite(work.from)||!Number.isFinite(work.through)||!Number.isFinite(work.minutes)||work.from>work.through||r.activity?.action!==a||work.through!==w.minute||work.minutes<2||Math.abs(work.minutes-(work.through-work.from))>1e-8||!atLocation(r,work.provider)||!atLocation(p,work.person))return unavailable;
  const c:AdultPresenceRecord={id:`adult-presence:${s.t.id}`,providerId:r.id,personId:p.id,transportId:s.t.id,eventId:s.e.id,sourceBinding:binding(s.t),verifiedAt:w.minute,expiresAt:Math.min(w.minute+ADULT_PRESENCE_MINUTES,s.t.endedAt!+ADULT_PRESENCE_SOURCE_WINDOW),providerLocation:location(w,r),personLocation:location(w,p),status:'verified',startedAt:null,lastAt:null,minutes:0,endedAt:null,reason:null,stops:[],eventIds:[s.e.id]};
  w.adultPresence!.records.push(c);w.processed.push(receipt(s.t.id));
  const e=emitEvent(w,{kind:'care',actors:[r.id,p.id],place:{...r.at},text:`${r.name}实际在合法近身位置核实${p.name}仍需选择支持；仅可另行自愿在此停留至第${c.expiresAt.toFixed(2)}游戏分钟。本人可表达即能停止，施助者可退出；沉默不是同意，后续照护仍未解决。`,audit:{rule:'adult/non-invasive-presence@1',authority:'voluntary-non-invasive-presence',evidence:s.e.id,scope:['local-verification','no-touch','no-food-water-medicine','no-movement','no-proxy','no-handoff'],resources:{},providerId:r.id,termination:'固定期限、本人或施助者停止、离场、风险或权利及能力变化'}});c.eventIds.push(e.id);p.decisionDue=Math.min(p.decisionDue,w.minute);p.revision++;return null;
 }
 const c=record(w,a.recordId)!;
 if(c.lastAt!==w.minute||c.minutes<=0||c.startedAt===null||Math.abs(c.minutes-(c.lastAt-c.startedAt))>1e-8)return unavailable;
 end(w,c,'本次自愿在场工作结束，原期限不续期');return null;
}
export function advanceAdultPresence(w:World){
 for(const c of w.adultPresence?.records??[]){
  if(c.status==='ended')continue;
  if(w.minute>=c.expiresAt){end(w,c,'固定期限届满，不续期、不自动接班');continue;}
  const r=person(w,c.providerId),a=r?.activity?.action;
  if(currentReason(w,c)||c.status==='present'&&(a?.type!=='adultPresence'||a.operation!=='stay'||a.recordId!==c.id||c.lastAt!==w.minute))end(w,c,'原现场、意愿、权利、风险或能力条件变化');
 }
}
export function adultPresenceStops(w:World,r:Resident):FormalOpportunity[]{
 const out:FormalOpportunity[]=(w.adultPresence?.records??[]).flatMap(c=>{
  const action:AdultPresenceAction={type:'adultPresence',operation:'stop',recordId:c.id};
  return adultPresenceSelfStop(w,r,action)?[{id:`care.stop.presence.${c.id}`,label:`立即停止原救援${c.transportId}下本次非侵入式在场（原截止第${c.expiresAt.toFixed(2)}分钟）；不接受其他照护`,action}]:[];
 });
 for(const provider of w.residents)for(const a of [...(provider.plan?.actions??[]),...(provider.activity?[provider.activity.action]:[])]){
  if(a.type!=='adultPresence'||a.operation!=='verify')continue;
  const action:AdultPresenceAction={type:'adultPresence',operation:'stopVerification',transportId:a.transportId,eventId:a.eventId,providerId:provider.id},id=`care.stop.presence.verify.${a.transportId}.${provider.id}`;
  if(!out.some(c=>c.id===id)&&adultPresenceSelfStop(w,r,action))out.push({id,label:`立即停止原救援${a.transportId}下这次现场核实；不接受在场或其他照护`,action});
 }
 return out;
}
export function adultPresenceOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!alive(r)||!r.canDecide||!r.canExpress)return [];
 const out:FormalOpportunity[]=[];
 for(const c of w.adultPresence?.records??[]){const action:AdultPresenceAction={type:'adultPresence',operation:'stay',recordId:c.id};if(!adultPresenceReason(w,r,action))out.push({id:`presence.stay.${c.id}`,label:`自愿在原地不接触地陪伴至第${c.expiresAt.toFixed(2)}分钟，最多15分钟；可随时停止，不喂食饮水给药或接班`,action});}
 for(const t of w.health?.transports??[]){if(!t.arrivalEventId)continue;const action:AdultPresenceAction={type:'adultPresence',operation:'verify',transportId:t.id,eventId:t.arrivalEventId};if(!adultPresenceReason(w,r,action))out.push({id:`presence.verify.${t.id}`,label:`用2分钟当场核实${person(w,t.patientId)!.name}的救援后处境（原救援${t.id}）；只核实，不接触身体或代决`,action});}
 return out;
}

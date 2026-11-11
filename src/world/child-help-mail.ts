import {knownStationDuration} from './migration.js';
import type {Action,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {ChildHelpNotice,EmergencyCareAction} from '../shared/emergency-care.js';
import type {ForeignShipment} from '../shared/foreign-trade.js';
import {emitEvent,emitLedgerEvent} from './events.js';
import {knownAgeYears} from './time.js';
import {same} from './navigation.js';

const notices=(w:World)=>w.emergencyCare?.helpNotices??[];
const reader=(n:ChildHelpNotice,r:Resident)=>n.readers.find(k=>k.personId===r.id);
/** A stored regional identity is not proof of presence: no travelling, dead or absent recipient. */
export function childHelpAtOrigin(w:World,r:Resident,origin:string):boolean {
 const c=w.migration?.contacts.find(c=>c.id===r.id);
 return knownStationDuration(w,origin)!==null&&!!c&&c.origin===origin&&['home','offered'].includes(c.phase)&&!c.journey&&r.residency==='outside'
  &&r.status==='alive'&&r.health>0&&r.canDecide&&r.canExpress&&(knownAgeYears(r.bornAt,w.minute)??-1)>=18
  &&(!r.regionalLocation||r.regionalLocation.origin===origin&&r.regionalLocation.progress===r.regionalLocation.duration);
}
function remoteFact(w:World,n:ChildHelpNotice,origin:string,text:string,r?:Resident){
 const event=emitLedgerEvent(w,{kind:'care',actors:r?[r.id]:[],place:{x:-1,y:-1},text,
  audit:{rule:'child/help-mail@1',authority:'既有货运实际到达与本人独立答复',evidence:n.id,scope:['historical-help-message','no-care-consent','no-room-entry','no-guardianship'],resources:{},providerId:r?.id??n.reporterId,termination:'原观察起24小时届满；不远程通知新情况'}});
 n.eventIds.push(event.id);
 if(r){r.memories.push({eventId:event.id,receivedAt:w.minute,source:'heard',text});if(r.memories.length>80)r.memories.splice(0,r.memories.length-80);}
 return event;
}
/** Only invoked by real outward freight crossings, never by a timer that invents a messenger. */
export function carryChildHelpMail(w:World,s:ForeignShipment,stage:'depart'|'arrive'|'return',crossedAt:number):void {
 const merchant=w.foreignTrade?.merchants.find(m=>m.id===s.merchantId);if(!merchant)return;
 for(const n of notices(w)){
  const out=n.outbound;if(!out)continue;
  if(stage==='depart'&&n.postedAt!==null&&n.postedAt<=crossedAt&&out.requestedAt<=crossedAt&&n.expiresAt>crossedAt&&(n.withdrawnAt===null||n.withdrawnAt>crossedAt)
   &&same(n.boardAt,w.foreignTrade!.station)&&!out.attempts.some(a=>a.status!=='returned'||a.shipmentId===s.id||a.returnedAt===null||a.returnedAt>crossedAt)){
   out.attempts.push({shipmentId:s.id,origin:merchant.origin,pickedAt:crossedAt,arrivedAt:null,returnedAt:null,recipientId:null,status:'carried'});
   n.eventIds.push(emitEvent(w,{kind:'care',actors:[],place:{...n.boardAt},roomId:null,text:`既有货运 ${s.id} 的信使实际经过谷口，捎走另行交托的儿童求助 ${n.id} 前往${merchant.origin}；尚未送达，不新增旅人或照护权限。`}).id);
  }
  const mail=out.attempts.find(a=>a.shipmentId===s.id&&a.status==='carried');if(!mail)continue;
  if(stage==='return'){
   mail.status='returned';mail.returnedAt=w.minute;
   n.eventIds.push(emitEvent(w,{kind:'care',actors:[],place:{...n.boardAt},roomId:null,text:`既有货运 ${s.id} 未到原居地便实际折返谷口，儿童求助 ${n.id} 原信退回；只可等待之后另一趟既有外运，期限不刷新。`}).id);
  }
  if(stage!=='arrive')continue;
  mail.arrivedAt=w.minute;
  // Do not initialize migration or create a contact in response to a child's need.
  const recipient=(w.migration?.contacts??[]).filter(c=>c.origin===mail.origin).map(c=>c.person??w.residents.find(r=>r.id===c.id))
   .find((p):p is Resident=>!!p&&childHelpAtOrigin(w,p,mail.origin)&&!reader(n,p));
  if(!recipient){mail.status='unreceived';remoteFact(w,n,mail.origin,`货运 ${s.id} 实际到达${mail.origin}，但没有可核实在场且能接信的既有人物；儿童求助 ${n.id} 留在该处，未制造读信人、转送或返程。`);continue;}
  mail.status='delivered';mail.recipientId=recipient.id;
  n.readers.push({personId:recipient.id,readAt:w.minute,withdrawnAt:null,visitAt:null,outsideReceipt:{shipmentId:s.id,origin:mail.origin}});
  remoteFact(w,n,mail.origin,`${recipient.name}在${mail.origin}实际收到既有货运 ${s.id} 捎来的儿童求助 ${n.id}：${n.reporterName}于第${n.createdAt}分钟记录${n.childName}的监护缺口，旧址（${n.location.at.x},${n.location.at.y}）${n.location.inside?'室内':'室外'}，截止第${n.expiresAt}分钟。${w.minute>=n.expiresAt?'原信已经到期，不能据此启程或探访。':'是否启程须本人另选；不能证明孩子现状、死亡事实、入屋或照护权限。'}`,recipient);
  recipient.revision++;recipient.decisionDue=Math.min(recipient.decisionDue,w.minute);
 }
}
export function childHelpPending(w:World,r:Resident):ChildHelpNotice[]{
 return notices(w).filter(n=>{const k=reader(n,r);return !!k?.outsideReceipt&&!k.reply&&k.withdrawnAt===null&&k.visitAt===null&&w.minute<n.expiresAt&&childHelpAtOrigin(w,r,k.outsideReceipt.origin);});
}
export function childHelpOutsideChoices(w:World,r:Resident):FormalOpportunity[]{
 return childHelpPending(w,r).slice(0,4).flatMap(n=>[
  {id:'child-help.decline.'+n.id,label:`本人婉拒按已送达的${n.childName}旧信专程来访，不远程通知报告人`,action:{type:'emergencyCare' as const,operation:'declineHelp' as const,noticeId:n.id}},
  {id:'child-help.travel.'+n.id,label:`本人决定为已送达的${n.childName}旧信分段入谷，之后另选按旧址探访；第${n.expiresAt}分钟到期，不承诺照护、入屋或住宿`,action:{type:'emergencyCare' as const,operation:'travelHelp' as const,noticeId:n.id}},
 ]);
}
export const isChildHelpReply=(a:Action):a is Action&EmergencyCareAction=>a.type==='emergencyCare'&&['travelHelp','declineHelp'].includes(a.operation);
export function childHelpReplyNotice(w:World,r:Resident,a:EmergencyCareAction):ChildHelpNotice|undefined {
 if(a.childId||a.agreementId||a.reviewerId||a.step!==undefined)return;
 return childHelpPending(w,r).find(n=>n.id===a.noticeId);
}
export function recordChildHelpReply(w:World,r:Resident,n:ChildHelpNotice,choice:'visit'|'decline'):void {
 const k=reader(n,r)!;k.reply={choice,at:w.minute};
 const event=remoteFact(w,n,k.outsideReceipt!.origin,`${r.name}独立${choice==='visit'?'选择按已收到的历史求助分段入谷，抵达后仍须另选探访和现场核实':'婉拒为这份旧信专程来访'}（${n.id}）；不远程告知报告人，不成立照护约定或取得入屋、监护与住房权限。`,r);
 const memory=r.memories.find(m=>m.eventId===event.id);if(memory)memory.source='self';
}

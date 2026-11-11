import type {Action,FormalOpportunity,Resident,World} from '../shared/types.js';
import type {ChildHelpNotice,EmergencyCareAction} from '../shared/emergency-care.js';
import {roomLayout} from '../shared/rooms.js';
import {careChildVisible,childCareGapEvidence} from './child-care-evidence.js';
import {canObserve} from './knowledge.js';
import {distance,same,walkable} from './navigation.js';
import {knownAgeYears,DAY} from './time.js';
import {emitEvent} from './events.js';

const operations=['requestHelp','postHelp','readHelp','withdrawHelp','visitHelp','sendHelp'];
export const isChildHelpAction=(a:EmergencyCareAction)=>operations.includes(a.operation);
const local=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&(knownAgeYears(r.bornAt,w.minute)??-1)>=6;
const infant=(w:World,r:Resident)=>{const age=knownAgeYears(r.bornAt,w.minute);return age!==null&&age<6;};
const notices=(w:World)=>w.emergencyCare?.helpNotices??[];
const notice=(w:World,id?:string)=>notices(w).find(n=>n.id===id);
const reader=(n:ChildHelpNotice,r:Resident)=>n.readers.find(k=>k.personId===r.id);
const nearBoard=(w:World,r:Resident,n?:ChildHelpNotice)=>canObserve(w,r)&&!r.inside&&distance(r.at,n?.boardAt??w.foreignTrade!.station)<=2;
const atBoard=(w:World,r:Resident,n:ChildHelpNotice)=>!r.inside&&same(r.at,n.boardAt)&&walkable(w,r.at);
const knowsGate=(w:World,r:Resident)=>!!w.foreignTrade&&(nearBoard(w,r)||w.foreignTrade.knownStationIds.includes(r.id));

export function childHelpReason(w:World,r:Resident,a:EmergencyCareAction):string|null {
 if(w.mode!=='formal'||!w.foreignTrade||!local(w,r))return '本人须有自主决定、表达与行动能力，且已有谷口联络处';
 if(a.agreementId||a.reviewerId)return '求助消息不是照护约定，不能混用复核或监护权限';
 if(a.operation==='requestHelp'){
  if(a.noticeId||!knowsGate(w,r))return '须知道实际谷口公示处，不能改写已有求助';
  const child=w.residents.find(p=>p.id===a.childId),age=child?knownAgeYears(child.bornAt,w.minute):null;
  if(age===null)return '孩子年龄无法核实，不能代用幼儿公开求助豁免';
  if(!child||child.status!=='alive'||child.residency==='outside'||age>=18||child.refusesCare||!childCareGapEvidence(w,r,child))return '须在合法现场亲见孩子并由本人核实监护缺口；未知缺席不能当作证据';
  if(child.id!==r.id&&age>=6)return '有独立答复年龄的孩子须自行决定发布求助，不能替其公开照护需求';
  if(a.step!==(w.emergencyCare?.nextHelpSerial??1)||notices(w).some(n=>n.childId===child.id&&n.reporterId===r.id&&n.expiresAt>w.minute&&(n.withdrawnAt===null||reader(n,r)?.withdrawnAt===null)))return '本人已有这位孩子尚未结束的记录，或记录版本已变化';
  return null;
 }
 const n=notice(w,a.noticeId);if(!n||a.childId!==undefined&&a.childId!==n.childId)return '不能替换求助记录中的孩子';
 if(w.minute>=n.expiresAt)return '原观察起24小时已到，不自动刷新求助或探访期限';
 const known=reader(n,r);
 if(a.operation==='sendHelp')return n.reporterId===r.id&&n.postedAt!==null&&known?.withdrawnAt===null&&!n.outbound&&knowsGate(w,r)?null:'只有原报告人可另行交托已张贴的原信；不重复交托或授予照护';
 if(a.operation==='postHelp')return n.reporterId===r.id&&n.postedAt===null&&n.withdrawnAt===null&&knowsGate(w,r)?null:'本人没有仍可亲自张贴的原始记录';
 if(a.operation==='readHelp')return n.postedAt!==null&&nearBoard(w,r,n)&&(!known||known.withdrawnAt!==n.withdrawnAt)?null:'须在谷口亲见尚未读过的公示或现场撤回更正';
 if(a.operation==='withdrawHelp')return (n.reporterId===r.id||n.childId===r.id)&&!!known&&known.withdrawnAt===null?null:'只有原报告人或已知情孩子可撤回这份消息';
 if(a.operation==='visitHelp')return known&&known.withdrawnAt===null&&known.visitAt===null&&n.postedAt!==null?null:'本人没有尚未探访、仍在原期限内的已读求助线索';
 return '未知儿童求助行动';
}

export function childHelpTarget(w:World,r:Resident,a:EmergencyCareAction){
 const error=childHelpReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const n=notice(w,a.noticeId);
 if(a.operation==='visitHelp'){
  // Pin the historical address. Neither this route nor room movement follows a distant child.
  (a as Action).observedTarget=structuredClone(n!.location);
  return {target:{...n!.location.at},adjacent:!n!.location.inside,duration:3};
 }
 if(a.operation==='postHelp'||a.operation==='sendHelp'||a.operation==='readHelp'||a.operation==='withdrawHelp'&&n!.postedAt!==null)return {target:{...n!.boardAt},duration:5};
 return {target:{...r.at},duration:3};
}

function fact(w:World,r:Resident,n:ChildHelpNotice,text:string){
 // A historical child's name is text, not a co-present actor or proof of their current state.
 const event=emitEvent(w,{kind:'care',actors:[r.id],place:{...r.at},text,
  audit:{rule:'child/help-notice@1',authority:'本人亲见记录或实际读到的历史求助',evidence:n.id,scope:['historical-help-message','no-care-consent','no-room-entry','no-guardianship','no-property-transfer'],resources:{},providerId:r.id,termination:'原观察起24小时届满；新照护须另行核实与分别决定'}});
 n.eventIds.push(event.id);return event;
}

export function completeChildHelp(w:World,r:Resident,a:EmergencyCareAction):string|null {
 const error=childHelpReason(w,r,a);if(error)return error;
 if(a.operation==='requestHelp'){
  const child=w.residents.find(p=>p.id===a.childId)!;
  w.emergencyCare??={nextSerial:1,agreements:[]};const state=w.emergencyCare;
  const serial=state.nextHelpSerial??1;state.nextHelpSerial=serial+1;
  const room=child.inside?w.buildings.find(b=>b.id===child.inside):undefined;
  const n:ChildHelpNotice={id:`child-help:${w.id}:${serial}`,reporterId:r.id,reporterName:r.name,childId:child.id,childName:child.name,
   location:{id:child.id,at:{...child.at},inside:child.inside,roomAt:child.roomAt?{...child.roomAt}:room?{...roomLayout(w,room).entry}:null,atMinute:w.minute},boardAt:{...w.foreignTrade!.station},
   evidence:childCareGapEvidence(w,r,child)!,createdAt:w.minute,expiresAt:w.minute+DAY,postedAt:null,withdrawnAt:null,withdrawnBy:null,eventIds:[],
   readers:[{personId:r.id,readAt:w.minute,withdrawnAt:null,visitAt:null}]};
  (state.helpNotices??=[]).push(n);
  fact(w,r,n,`${r.name}在现场记录${child.name}的监护缺口与求助原址；有效期为本次观察起24小时。记录尚由本人持有，须另选亲自到谷口张贴，不承诺来人，也不授予照护、入屋、住宿或监护权限。`);
  return null;
 }
 const n=notice(w,a.noticeId)!;
 if((a.operation==='postHelp'||a.operation==='sendHelp'||a.operation==='readHelp'||a.operation==='withdrawHelp'&&n.postedAt!==null)&&!atBoard(w,r,n))return '须本人实际走到原谷口公示处，不可远程张贴、阅读或撤回';
 if(a.operation==='sendHelp'){
  if(n.withdrawnAt!==null)return '眼前原公示已经撤回，不能交托出信';
  n.outbound={requestedAt:w.minute,attempts:[]};
  fact(w,r,n,`${r.name}另行在原谷口交托求助 ${n.id} 的历史原信，等待之后实际出谷的既有货运信使捎往同源居地；只交给实际在场的既有人物。没有承诺送达、来人或照护，原期限不变。`);
 }else if(a.operation==='postHelp'){
  n.postedAt=w.minute;
  fact(w,r,n,`${r.name}亲自到谷口张贴求助 ${n.id}：${n.childName}在第${n.createdAt}分钟的现场记录中需要照护，最后位置（${n.location.at.x},${n.location.at.y}）${n.location.inside?'的室内':'的室外'}。仅到第${n.expiresAt}分钟有效；当前位置、当前需要与合法接触须来访者自己核实。`);
 }else if(a.operation==='readHelp'){
  const known=reader(n,r);if(known)known.withdrawnAt=n.withdrawnAt;else n.readers.push({personId:r.id,readAt:w.minute,withdrawnAt:n.withdrawnAt,visitAt:null});
  const event=fact(w,r,n,`${r.name}亲自在谷口读到${n.reporterName}于第${n.createdAt}分钟记录的${n.childName}求助：原址（${n.location.at.x},${n.location.at.y}）${n.location.inside?'的室内':'的室外'}，第${n.expiresAt}分钟到期。${n.withdrawnAt===null?'可自愿按旧址探访，但原信不证明孩子现状，不转交死亡证据或任何照护与入屋权限。':'原消息已在此撤回，不再据此安排探访。'}`);
  const memory=r.memories.find(m=>m.eventId===event.id);if(memory)memory.source='heard';
 }else if(a.operation==='withdrawHelp'){
  if(n.withdrawnAt!==null){reader(n,r)!.withdrawnAt=n.withdrawnAt;fact(w,r,n,`${r.name}亲自到谷口发现求助 ${n.id} 已经撤回，不再次登记撤回或改写原日期。`);return null;}
  n.withdrawnAt=w.minute;n.withdrawnBy=r.id;
  reader(n,r)!.withdrawnAt=w.minute;
  fact(w,r,n,`${r.name}${n.postedAt===null?'撤回本人尚未张贴的':'亲自到谷口撤回'}求助 ${n.id}；不远程通知已经离开的读信人，也不改变既有独立照护约定。`);
 }else if(a.operation==='visitHelp'){
  // Completion requires the recorded physical place, even when called without the plan engine.
  const atOriginal=n.location.inside?r.inside===n.location.inside&&same(r.at,n.location.at)&&!!r.roomAt&&!!n.location.roomAt&&distance(r.roomAt,n.location.roomAt)<=2:!r.inside&&distance(r.at,n.location.at)<=1;
  const atClosedDoor=!!n.location.inside&&!r.inside&&same(r.at,n.location.at);
  if(!atOriginal&&!atClosedDoor)return '尚未实际到达原信所记地点，未取得孩子的新位置';
  const child=w.residents.find(p=>p.id===n.childId),found=!!child&&child.status==='alive'&&child.residency!=='outside'&&careChildVisible(w,r,child);
  reader(n,r)!.visitAt=w.minute;
  fact(w,r,n,`${r.name}按求助 ${n.id} 的原址实际探访，${found?'亲见并可合法接触到孩子；当前需要与任何照护仍须分别核验和另行决定':'没有找到可合法接触的孩子；未获知新的远处位置、监护状态或屋内情况'}。没有自动喂养、搬运、入住或监护交接。`);
 }
 return null;
}

export function childHelpOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||!w.foreignTrade||!local(w,r))return [];
 const rows:FormalOpportunity[]=[];
 const add=(label:string,a:EmergencyCareAction)=>{if(!childHelpReason(w,r,a))rows.push({id:`child-help.${a.operation}.${a.childId??a.noticeId}`,label,action:a});};
 for(const child of w.residents)if(child.id===r.id||infant(w,child)&&careChildVisible(w,r,child))add(child.id===r.id?'本人记录监护缺口与求助原址，之后可另选到谷口张贴；不保证来人':`为亲见的幼儿${child.name}记录已核实的监护缺口和原址，之后须另选亲自去谷口张贴`,{type:'emergencyCare',operation:'requestHelp',childId:child.id,step:w.emergencyCare?.nextHelpSerial??1});
 for(const n of notices(w)){
  add(`亲自将本人持有的${n.childName}求助记录张贴到谷口，仅余原观察起24小时期限，不传递当前位置`,{type:'emergencyCare',operation:'postHelp',noticeId:n.id});
  add('亲自到原谷口另行交托这份求助，由之后实际出谷的既有货运捎向同源居地；不保证有人接信或来访',{type:'emergencyCare',operation:'sendHelp',noticeId:n.id});
  add('亲自阅读眼前谷口的一份儿童照护求助或撤回更正，不接受任何照护义务',{type:'emergencyCare',operation:'readHelp',noticeId:n.id});
  add('撤回本人发布或关于本人的照护求助；已张贴的须亲自到谷口更正，不远程通知读信人',{type:'emergencyCare',operation:'withdrawHelp',noticeId:n.id});
  add(`自愿按已读求助旧址（${n.location.at.x},${n.location.at.y}）探访${n.childName}；原观察在第${n.createdAt}分钟，第${n.expiresAt}分钟到期，须自行核实、无入屋或照护权限`,{type:'emergencyCare',operation:'visitHelp',noticeId:n.id});
 }
 return rows;
}

import {hasReceipt} from './receipts.js';
import type {FormalOpportunity,Resident,Vec,World} from '../shared/types.js';import type {Meeting,SocialAction} from '../shared/social-life.js';import {ageYears} from './time.js';import {distance,walkable} from './navigation.js';import {roomLayout,roomPath} from '../shared/rooms.js';import {emitEvent} from './events.js';import {canObserve} from './knowledge.js';import {coLocated} from './proximity.js';
const person=(w:World,id?:string)=>w.residents.find(r=>r.id===id),meeting=(w:World,id?:string)=>w.social?.meetings.find(m=>m.id===id);
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=6;
const member=(m:Meeting,id:string)=>m.members.find(p=>p.personId===id&&p.leftAt===null);
export function initializeSocial(w:World){if(w.mode!=='formal')return;w.social??={meetings:[],nextSerial:1,totals:{meetings:0,speeches:0,interpretations:0}};w.definitions['social/meeting@1']??={id:'social/meeting',version:1,kind:'action',dependencies:[],data:{capacity:8,minimumMinutes:30,maximumMinutes:180,roster:false}};w.definitions['social/interpretation@1']??={id:'social/interpretation',version:1,kind:'action',dependencies:[],data:{deltaLimit:5,scope:'仅本人已实际获知经历的个人理解，不是对世界事实或他人感受的重写'}};}
export function atMeeting(w:World,r:Resident,m:Meeting,range=m.roomId?6:2){if(r.inside!==m.roomId||r.residency==='outside')return false;if(m.roomId){const b=w.buildings.find(b=>b.id===m.roomId);return !!b&&distance(r.roomAt??roomLayout(w,b).entry,m.roomAt??roomLayout(w,b).entry)<=range;}return distance(r.at,m.at)<=range;}
function visible(w:World,r:Resident,m:Meeting){return m.status==='open'&&m.expiresAt>w.minute&&canObserve(w,r)&&atMeeting(w,r,m,10)&&m.members.some(p=>p.leftAt===null&&person(w,p.personId)?.status==='alive'&&atMeeting(w,person(w,p.personId)!,m));}
function source(w:World,r:Resident,id?:string){const memory=r.memories.find(m=>m.eventId===id),fact=memory&&w.events.find(e=>e.id===memory.eventId);return memory&&fact?{memory,fact}:null;}
export function meetingSeat(w:World,m:Meeting,r:Resident):Vec|null {
 if(!m.roomId)return {...m.at};const b=w.buildings.find(b=>b.id===m.roomId);if(!b)return null;const layout=roomLayout(w,b),taken=new Set(m.members.filter(p=>p.leftAt===null&&p.personId!==r.id).map(p=>p.seat)),current=member(m,r.id),index=current?.seat??[0,1,2,3,4,5,6,7].find(i=>!taken.has(i));if(index===undefined)return null;
 const [x,y]=[[0,0],[-2,0],[2,0],[0,2],[-2,2],[2,2],[-3,1],[3,1]][index],origin=m.roomAt??layout.entry,at={x:origin.x+x,y:origin.y+y};return roomPath(layout,r.inside===b.id?r.roomAt??layout.entry:layout.entry,at)!==null?at:null;
}
export function socialReason(w:World,r:Resident,a:SocialAction):string|null {
 if(!w.social||!capable(w,r))return '本人当前不能自主交谈或理解经历';
 if(a.operation==='interpret'){
  const s=source(w,r,a.eventId);if(!s||!a.targetId||a.targetId===r.id||!r.knownPeople.includes(a.targetId)||!s.fact.actors.includes(a.targetId))return '只能理解本人实际经历或收到、且涉及已认识人物的具体记录';
  if(hasReceipt(w,`interpret:${r.id}:${a.eventId}:${a.targetId}`))return '本人已经就这条经历形成过理解，新的变化需要新的经历';
  return typeof a.text==='string'&&!!a.text.trim()&&a.text.length<=240&&[a.affection,a.trust,a.conflict].every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=-5&&n<=5)?null:'请本人写1–240字理解，好感、信任、矛盾各自变化须为-5至5';
 }
 if(a.operation==='start'){
  if(typeof a.text!=='string'||!a.text.trim()||a.text.length>80||!Number.isSafeInteger(a.minutes)||a.minutes!<30||a.minutes!>180)return '需要本人提出1–80字话题和30–180分钟的有限讨论时段';
  if(w.social.meetings.some(m=>m.status==='open'&&member(m,r.id)))return '本人已经参与一场尚未离开的讨论';
  if(r.inside){const b=w.buildings.find(b=>b.id===r.inside);return b&&b.condition>0&&(b.ownerId==='commons'||b.ownerId===r.id||b.residents.includes(r.id))?null:'本人当前没有使用这处室内空间发起讨论的权限';}
  return walkable(w,r.at)?null:'当前不在实际可停留的位置';
 }
 const m=meeting(w,a.meetingId);if(!m||m.status!=='open'||m.expiresAt<=w.minute)return '这场讨论已经结束';
 if(a.operation==='leave')return member(m,r.id)?null:'本人没有参加这场讨论';
 if(a.operation==='join')return !member(m,r.id)&&!w.social.meetings.some(p=>p.status==='open'&&member(p,r.id))&&m.members.filter(p=>p.leftAt===null).length<8&&visible(w,r,m)&&!!meetingSeat(w,m,r)?null:'需要本人实际看到这场讨论、有空位且尚未参加另一场讨论';
 if(a.operation==='speak')return member(m,r.id)&&atMeeting(w,r,m)&&m.members.some(p=>p.leftAt===null&&p.personId!==r.id&&person(w,p.personId)&&canObserve(w,person(w,p.personId)!)&&atMeeting(w,person(w,p.personId)!,m)&&coLocated(w,r,person(w,p.personId)!,6))&&typeof a.text==='string'&&!!a.text.trim()&&a.text.length<=240?null:'需要本人已加入、确实在场，并向听得到的实际参与者表达自己的1–240字话语';
 return '没有这项相处安排';
}
export function socialTarget(w:World,r:Resident,a:SocialAction){const error=socialReason(w,r,a);if(error)return {target:r.at,duration:0,error};const m=meeting(w,a.meetingId);return {target:{...(['join','speak'].includes(a.operation)?m!.at:r.at)},duration:a.operation==='start'?5:a.operation==='speak'?3:a.operation==='join'?3:1};}
function rememberRelation(r:Resident,id:string,eventId:string){let relation=r.relations.find(p=>p.targetId===id);if(!relation){relation={targetId:id,affection:0,trust:0,conflict:0,evidence:[]};r.relations.push(relation);}if(!relation.evidence.includes(eventId))relation.evidence.push(eventId);if(relation.evidence.length>80)relation.evidence=relation.evidence.slice(-80);return relation;}
export function completeSocial(w:World,r:Resident,a:SocialAction):string|null {
 const error=socialReason(w,r,a);if(error)return error;const s=w.social!;
 if(a.operation==='interpret'){
  const known=source(w,r,a.eventId)!,target=person(w,a.targetId)!,relation=rememberRelation(r,target.id,a.eventId!);
  relation.affection=Math.max(-100,Math.min(100,relation.affection+a.affection!));relation.trust=Math.max(-100,Math.min(100,relation.trust+a.trust!));relation.conflict=Math.max(0,Math.min(100,relation.conflict+a.conflict!));
  const e=emitEvent(w,{kind:'relationship',actors:[r.id],place:{...r.at},witnesses:[r.id],interpretation:{observerId:r.id,targetId:target.id,sourceEventId:a.eventId!,source:known.memory.source},text:`${r.name}根据${known.memory.source==='heard'?'自己收到的消息':'自己的实际经历'}，对${target.name}形成自己的理解：“${a.text!.trim()}”。这是个人看法，不代表对方也这样想或消息已经核实。`});
  relation.lastInterpretation={sourceEventId:a.eventId!,source:known.memory.source,recordEventId:e.id,at:w.minute,text:a.text!.trim(),affection:a.affection!,trust:a.trust!,conflict:a.conflict!};w.processed.push(`interpret:${r.id}:${a.eventId}:${a.targetId}`);s.totals.interpretations++;
 }else if(a.operation==='start'){
  const id='discussion:'+s.nextSerial++,b=w.buildings.find(b=>b.id===r.inside),m:Meeting={id,definition:'social/meeting@1',hostId:r.id,topic:a.text!.trim(),at:{...r.at},roomId:r.inside,roomAt:r.inside?{...(r.roomAt??roomLayout(w,b!).entry)}:null,createdAt:w.minute,expiresAt:w.minute+a.minutes!,endedAt:null,status:'open',members:[{personId:r.id,seat:0,joinedAt:w.minute,leftAt:null}]};s.meetings.push(m);s.totals.meetings++;
  emitEvent(w,{kind:'conversation',actors:[r.id],place:{...r.at},conversationId:id,text:`${r.name}发起临时讨论：“${m.topic}”。想加入、回应或离开的人分别决定，不按名单轮流发言。`});
 }else {
  const m=meeting(w,a.meetingId)!;
  if(a.operation==='join'){
   if(!atMeeting(w,r,m))return '本人尚未实际走到讨论地点';const taken=new Set(m.members.filter(p=>p.leftAt===null).map(p=>p.seat)),seat=[0,1,2,3,4,5,6,7].find(i=>!taken.has(i))!;m.members.push({personId:r.id,seat,joinedAt:w.minute,leftAt:null});emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},conversationId:m.id,text:`${r.name}自己来到“${m.topic}”的讨论地点并加入，没有替其他人作出参加决定。`});
  }else if(a.operation==='leave'){member(m,r.id)!.leftAt=w.minute;emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},conversationId:m.id,text:`${r.name}自己退出“${m.topic}”的讨论，仍可继续自己的其他安排。`});}
  else {
   const others=m.members.filter(p=>p.leftAt===null&&p.personId!==r.id).map(p=>person(w,p.personId)).filter((p):p is Resident=>!!p&&canObserve(w,p)&&atMeeting(w,p,m)&&coLocated(w,r,p,6));
   const e=emitEvent(w,{kind:'conversation',actors:[r.id,...others.map(p=>p.id)],place:{...r.at},conversationId:m.id,text:`${r.name}：${a.text!.trim()}`});s.totals.speeches++;
   for(const p of others){rememberRelation(r,p.id,e.id);rememberRelation(p,r.id,e.id);if(!p.plan&&!p.activity)p.decisionDue=Math.min(p.decisionDue,w.minute);}
  }
 }r.revision++;return null;
}
export function advanceSocial(w:World){initializeSocial(w);const s=w.social;if(!s)return;for(const m of s.meetings)if(m.status==='open'){
 for(const p of m.members.filter(p=>p.leftAt===null)){const r=person(w,p.personId);if(!r||r.status!=='alive'||!atMeeting(w,r,m))p.leftAt=w.minute;}
 if(m.expiresAt<=w.minute||!m.members.some(p=>p.leftAt===null)){m.status='ended';m.endedAt=w.minute;for(const p of m.members)if(p.leftAt===null)p.leftAt=w.minute;}}
 if(s.meetings.length>160)s.meetings=s.meetings.filter((m,i)=>m.status==='open'||i>=s.meetings.length-80);
}
export function socialOpportunities(w:World,r:Resident):FormalOpportunity[]{const result:FormalOpportunity[]=[],add=(id:string,label:string,a:SocialAction)=>{if(!socialReason(w,r,a))result.push({id:'social.'+id,label,action:a});};
 add('start','本人发起一场临时讨论，填写text话题（1–80字）和minutes 30–180；其他人各自决定是否加入、何时说话或离开',{type:'social',operation:'start',text:'我想同在场的人谈一谈',minutes:60});
 for(const m of w.social?.meetings??[]){add('join.'+m.id,`本人走到眼前“${m.topic}”的讨论地点并自愿加入；没人替本人发言`,{type:'social',operation:'join',meetingId:m.id});add('speak.'+m.id,`在本人参加的“${m.topic}”讨论中说自己的话，填写text（1–240字）；只向实际在场并听得到的人说，不必等固定顺序`,{type:'social',operation:'speak',meetingId:m.id,text:'我想表达自己的看法'});add('leave.'+m.id,`本人退出“${m.topic}”的讨论，继续自己的生活`,{type:'social',operation:'leave',meetingId:m.id});}
 for(const memory of r.memories.slice(-5).reverse()){const event=w.events.find(e=>e.id===memory.eventId);if(!event)continue;for(const id of event.actors.filter(id=>id!==r.id&&r.knownPeople.includes(id)).slice(0,2))add('interpret.'+event.id+'.'+id,`根据本人${memory.source==='heard'?'收到的消息（不等于已经核实）':'实际经历'}“${memory.text.slice(0,140)}”，对${person(w,id)?.name??'这位人物'}形成自己的理解；填写text（1–240字）、affection好感变化、trust信任变化、conflict矛盾变化各-5至5，只改本人的感受`,{type:'social',operation:'interpret',eventId:event.id,targetId:id,text:'我有自己的理解',affection:0,trust:0,conflict:0});}
 return result;
}

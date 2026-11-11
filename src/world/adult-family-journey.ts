import type {DecisionContext,ModelDecision,Resident,World} from '../shared/types.js';
import type {VisitorJourney,VisitorJourneyAction} from '../shared/visitor-journey.js';
import {ordinaryVisitorJourney,visitorStageMinutes} from '../shared/visitor-journey.js';
import {emitLedgerEvent} from './events.js';
import {movementRate} from './health.js';
import {endDecisionProtection} from './decision-protection.js';
import {advanceVisitorJourney,applyVisitorJourneyDecision,startVisitorJourney,visitorJourneyCandidate,visitorJourneyCapable,visitorJourneyContext,visitorJourneyLocation,waitVisitorJourney} from './visitor-journey.js';

const person=(w:World,id:string)=>w.residents.find(r=>r.id===id)??w.migration?.contacts.find(c=>c.id===id)?.person;
const contact=(w:World,r:Resident)=>w.migration!.contacts.find(c=>c.id===r.id)!;
function companion(w:World,r:Resident,j:VisitorJourney){
 const other=j.family&&person(w,j.family.companionId),trip=other&&contact(w,other)?.journey?.staged;
 return other&&trip&&trip.family?.id===j.family?.id&&trip.family?.companionId===r.id&&other.residency==='outside'&&trip.origin===j.origin&&trip.duration===j.duration&&trip.progress===j.progress&&trip.direction===j.direction?{r:other,j:trip}:undefined;
}
function fact(w:World,members:{r:Resident;j:VisitorJourney}[],text:string){
 const first=members[0],e=emitLedgerEvent(w,{kind:'action',actors:members.map(p=>p.r.id),place:{...first.r.at},regionalLocation:{...first.r.regionalLocation!},text});
 for(const {r,j}of members){j.eventIds.push(e.id);if(r.status==='alive'&&r.canDecide&&r.canExpress){r.memories.push({eventId:e.id,receivedAt:w.minute,source:'self',text});if(r.memories.length>80)r.memories.splice(0,r.memories.length-80);}}
}
function stop(w:World,r:Resident,j:VisitorJourney,reason:string){
 const pending=!!j.family?.ready;delete j.family?.ready;j.updatedAt=w.minute;
 if(j.status==='travelling'||pending)waitVisitorJourney(w,r,j,reason);
}
export function startAdultFamilyJourney(w:World,a:Resident,b:Resident,origin:string,duration:number):void {
 const id=`adult-family:${a.id}:${b.id}:${w.minute}`;
 for(const [r,other]of [[a,b],[b,a]]){
  const c=contact(w,r);c.phase='travelling';delete c.familyConsentUntil;
  c.journey={leftAt:w.minute,arriveAt:w.minute+duration,nextCheckAt:w.minute+visitorStageMinutes(duration),blocked:false,staged:startVisitorJourney(w,r,origin,duration,{id,companionId:other.id})};
 }
 fact(w,[{r:a,j:contact(w,a).journey!.staged!},{r:b,j:contact(w,b).journey!.staged!}],`${a.name}与${b.name}分别同意本次成人亲属同行，只走第一段${visitorStageMinutes(duration)}分钟；按两人当前较慢速度同地前进，不共用钱物，不代替照护、监护或住宿安排。`);
}
export function adultFamilyJourneyContext(w:World,r:Resident):DecisionContext {
 const context=visitorJourneyContext(w,r),j=ordinaryVisitorJourney(w,r)!,other=companion(w,r,j),choices=context.outside!.choices;
 const move=choices.find(c=>c.action.type==='visitorJourney'&&c.action.operation==='continue')!;
 move.label=`本人同意与${other?.r.name??'原亲属'}再同行至多${(move.action as VisitorJourneyAction).minutes}分钟，双方30分钟内分别确认才出发；按较慢速度，本段后另选`;
 if(!other||!visitorJourneyCapable(w,other.r)||other.j.status==='interrupted')choices.splice(choices.indexOf(move),1);
 choices.push({id:'visit.alone.'+j.id,label:`本人结束本次同行，独自沿已选方向再走至多${(move.action as VisitorJourneyAction).minutes}分钟；不带走亲属、不替其安排照护、运输或交接`,action:{type:'visitorJourney',operation:'continueAlone',journeyId:j.id,minutes:(move.action as VisitorJourneyAction).minutes}});
 const turn=choices.find(c=>c.action.type==='visitorJourney'&&c.action.operation==='turnBack');if(turn)turn.label='本人结束本次同行并独自原路返回，按已经走过的实际距离分段返家；不带走亲属、不替其安排照护';
 context.outside!.notice+=` 当前仅有两位成年亲属的同行约定。${other?`眼前同行者${other.r.name}${other.r.status==='dead'?'已在共同驿路原址离世，遗体和财物尚无回谷运输':!visitorJourneyCapable(w,other.r)?'当前不能自主行走，同行暂停；这里没有自动照护或救援':other.j.pause?'正在自行进食或休息':other.j.family?.ready?'已同意下一段，等待本人独立选择':'尚未同意下一段'}。`:'原同行者不在本次核实的共同位置，不能继续共同旅程。'}自己进食和休息只用本人物资，不自动喂养、恢复或搬运对方。`;
 return context;
}
/** A reply from one adult can never move, feed or turn around the other. */
export function applyAdultFamilyJourneyDecision(w:World,r:Resident,revision:number,d:ModelDecision):{ok:boolean;error?:string} {
 const j=ordinaryVisitorJourney(w,r),a=d.actions[0];
 if(!j?.family||!visitorJourneyCandidate(w,r)||r.revision!==revision||d.actions.length!==1||a?.type!=='visitorJourney'||a.journeyId!==j.id)return {ok:false,error:'本人实际同行或独立选择已变化'};
 const other=companion(w,r,j);
 if(a.operation==='continue'){
  if(!other||!visitorJourneyCapable(w,other.r)||other.j.status!=='waiting')return {ok:false,error:'亲属当前不能在同一实际位置确认下一段同行'};
  if(!Number.isFinite(a.minutes)||a.minutes!<=0||a.minutes!>(j.progress===0?30:visitorStageMinutes(j.duration)))return {ok:false,error:'本段同行时长无效或超过本人同意的上限'};
  endDecisionProtection(w,r,'decision');r.intention=d.intention.slice(0,160);r.lastDecisionAt=w.minute;r.revision++;r.lastFailure=null;contact(w,r).lastDecisionAt=w.minute;
  j.family.ready={minutes:a.minutes!,expiresAt:w.minute+30};r.decisionDue=w.minute+30;
  fact(w,[{r,j},other],`${r.name}本人同意再同行至多${a.minutes}分钟，本次同意仅保留30分钟；尚未获得另一人的有效同意时不前进。`);
  const ready=other.j.family!.ready;
  if(ready&&ready.expiresAt>w.minute&&!other.j.pause){
   const minutes=Math.min(a.minutes!,ready.minutes);
   for(const member of [{r,j},other]){delete member.j.family!.ready;member.j.status='travelling';member.j.stageRemaining=minutes;member.j.updatedAt=w.minute;member.j.reason=null;member.r.decisionDue=w.minute+minutes;const c=contact(w,member.r);c.phase='travelling';c.journey!.blocked=false;c.journey!.nextCheckAt=member.r.decisionDue;}
   other.r.revision++;
   fact(w,[{r,j},other],`${r.name}与${other.r.name}已分别同意，实际开始共同下一段${minutes}分钟；只按较慢速度走这一段。`);
  }
  return {ok:true};
 }
 if(a.operation==='continueAlone'||a.operation==='turnBack'){
  // Validate the independent action first, so a bad/stale reply cannot dissolve a party.
  const action:VisitorJourneyAction={...a,operation:a.operation==='continueAlone'?'continue':'turnBack'};
  const result=applyVisitorJourneyDecision(w,r,revision,{...d,actions:[action]});if(!result.ok)return result;
  fact(w,[{r,j},...(other?[other]:[])],`${r.name}本人结束本次同行，按实际位置独自${a.operation==='turnBack'?'原路返回':'继续访谷'}。${other?other.r.status==='dead'?`${other.r.name}的遗体及已封存财产仍在原址；`:!visitorJourneyCapable(w,other.r)?`${other.r.name}仍停在原处，当前不能自主行动；`:`${other.r.name}仍留在原处，自己的进食或休息继续，下一步须本人决定；`:'原同行者未被移动；'}没有自动照护、接班或救援。`);
  delete j.family;visitorJourneyLocation(r,j);
  if(other){delete other.j.family;other.j.updatedAt=w.minute;other.r.revision++;if(!other.j.pause&&other.r.status==='alive'){other.r.decisionDue=w.minute;other.j.reason='亲属已明确结束同行，自己仍在实际位置，下一步须本人决定';}visitorJourneyLocation(other.r,other.j);}
  return result;
 }
 const result=applyVisitorJourneyDecision(w,r,revision,d);
 if(result.ok)delete j.family.ready;
 return result;
}
/** Advance each pair once, using a shared distance and the slower current mobility. */
export function advanceAdultFamilyJourneys(w:World,enter:(id:string)=>void):Set<string> {
 const handled=new Set<string>();
 for(const c of w.migration?.contacts??[]){
  const r=person(w,c.id),j=c.journey?.staged;if(!r||!j?.family||handled.has(r.id))continue;
  const other=companion(w,r,j),members=[{r,j},...(other?[other]:[])];for(const p of members)handled.add(p.r.id);
  for(const member of members){
   const ready=member.j.family?.ready;
   if(ready&&ready.expiresAt<=w.minute){delete member.j.family!.ready;member.r.decisionDue=w.minute;member.r.revision++;member.j.reason='本人上一段同行同意已到期，需另行选择';}
  }
  if(!other||members.some(p=>!visitorJourneyCapable(w,p.r)||p.j.status==='interrupted')){
   for(const member of members){stop(w,member.r,member.j,!other?'原同行者不在可核实的共同位置，本人停在实际原址；没有自动接班':members.some(p=>p.r.status==='dead')?'所在的同行中有人离世，旅程停在实际原址；遗体和财物没有自动运输':'眼前亲属不能继续自主同行，双方停在实际原址；照护与运输没有自动接班');advanceVisitorJourney(w,member.r,()=>{});}
   continue;
  }
  if(members.some(p=>p.j.status!=='travelling'||p.j.pause)){
   for(const member of members){if(member.j.status==='travelling')stop(w,member.r,member.j,'同行者尚未同意或正在自行照料，本段停止，下一段须分别选择');member.j.updatedAt=w.minute;}
   continue;
  }
  const elapsed=Math.min(...members.map(p=>Math.max(0,w.minute-p.j.updatedAt))),spent=Math.min(elapsed,...members.map(p=>p.j.stageRemaining)),walked=Math.min(j.progress,spent*Math.min(...members.map(p=>movementRate(w,p.r))));
  const progress=Math.max(0,j.progress-walked);const remaining=Math.max(0,Math.min(...members.map(p=>p.j.stageRemaining))-spent);
  for(const member of members){member.j.updatedAt=w.minute;member.j.progress=progress<=1e-9?0:progress;member.j.stageRemaining=member.j.progress===0&&walked>0?0:remaining;visitorJourneyLocation(member.r,member.j);}
  if(members.some(p=>p.j.stageRemaining>1e-9))continue;
  if(j.progress===0){for(const member of members)enter(member.r.id);}
  for(const member of members)if(member.r.residency==='outside')waitVisitorJourney(w,member.r,member.j,j.progress===0?'双方到达谷口外遇到实际路阻，须各自再选查路、离队或返家':'双方已走完各自同意的本段，停在共同实际位置，下一段须分别选择');
 }
 return handled;
}

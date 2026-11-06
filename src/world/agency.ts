import type {Plan,Resident,World} from '../shared/types.js';import type {AgencyAction,PersonalRoutine} from '../shared/agency.js';import {focusNames,repeatsActiveGoal} from '../shared/agency.js';import {goods} from '../shared/items.js';import {ageYears,DAY} from './time.js';import {findPath} from './navigation.js';import {residentBed} from '../shared/rooms.js';import {passenger} from './medical-transport.js';import {emitEvent} from './events.js';import {educationConflict} from './education.js';
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const capable=(w:World,r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress&&ageYears(r.bornAt,w.minute)>=6;
export function initializeAgency(w:World){if(w.mode!=='formal')return;w.definitions['agency/rules@1']??={id:'agency/rules',version:1,kind:'action',dependencies:[],data:{maxDays:7,maxUses:14,minCooldown:60,scope:['eat-own-item','sleep-own-bed']}};}
function available(w:World,r:Resident,a:PersonalRoutine['action']):string|null {
 if(a.type==='eat')return goods[a.item]?.food>0&&(r.inventory[a.item]??0)>=1?null:'原先选定的自有食物已经不足';
 const home=w.buildings.find(b=>b.id===r.homeId);return home&&home.condition>0&&home.residents.includes(r.id)&&residentBed(w,r,home)!==null&&findPath(w,r.at,home.door)!==null?null:'原先同意使用的本人床位或实际通路已不可用';
}
export function agencyReason(w:World,r:Resident,a:AgencyAction):string|null {
 if(w.mode!=='formal'||!capable(w,r))return '本人目前不能自主安排自己的长期打算';
 if(a.operation==='reflect'){
  if(!a.focus||!Object.hasOwn(focusNames,a.focus)||typeof a.text!=='string'||!a.text.trim()||a.text.length>240)return '请本人写下1–240字目标，并选择关注领域';
  return repeatsActiveGoal(r.agency,a)?'这个目标已经生效，可以按原目标行动，或本人另写不同的目标':null;
 }
 if(a.operation==='conclude')return r.agency?.goals.some(g=>g.status==='active')&&typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=240?null:'本人需要一个已有目标和1–240字自己的回顾';
 if(a.operation==='disarm')return r.agency?.routines.some(p=>p.id===a.routineId&&p.status==='active')?null:'没有本人仍然生效的日常安排';
 if(a.operation!=='arm'||!a.routineAction||!['eat','sleep'].includes(a.routineAction.type)||!integer(a.threshold,1,95)||!integer(a.days,1,7)||!integer(a.uses,1,14)||!integer(a.cooldown,60,DAY))return '只可有限授权本人选定的进食或睡眠，阈值1–95、1–7日、1–14次、间隔60–1440分钟';
 if(a.routineAction.type==='sleep'&&![120,360].includes(a.routineAction.minutes))return '本人只能选择已提供的两小时或六小时睡眠';
 if(r.agency?.routines.some(p=>p.status==='active'&&p.action.type===a.routineAction!.type))return '同一种日常分支已经生效，请先自行撤销';
 return available(w,r,a.routineAction);
}
export function completeAgency(w:World,r:Resident,a:AgencyAction):string|null {
 const error=agencyReason(w,r,a);if(error)return error;initializeAgency(w);
 r.agency??={focus:a.focus??null,goals:[],routines:[],nextSerial:1};const s=r.agency;
 if(a.operation==='reflect'){
  for(const g of s.goals)if(g.status==='active'){g.status='revised';g.endedAt=w.minute;}
  s.focus=a.focus!;s.goals.push({id:`goal:${r.id}:${s.nextSerial++}`,text:a.text!.trim(),focus:a.focus!,createdAt:w.minute,endedAt:null,outcome:null,status:'active',evidence:r.memories.slice(-8).map(m=>m.eventId)});
 }else if(a.operation==='conclude'){const g=s.goals.find(g=>g.status==='active')!;g.status='concluded';g.endedAt=w.minute;g.outcome=a.text!.trim();g.evidence=[...new Set([...g.evidence,...r.memories.slice(-8).map(m=>m.eventId)])];}
 else if(a.operation==='arm')s.routines.push({id:`routine:${r.id}:${s.nextSerial++}`,action:structuredClone(a.routineAction!),homeId:a.routineAction!.type==='sleep'?r.homeId:null,definition:w.activeDefinitions['action/routine'],ruleDefinition:'agency/rules@1',armedAt:w.minute,expiresAt:w.minute+a.days!*DAY,threshold:a.threshold!,cooldown:a.cooldown!,remaining:a.uses!,attempted:0,succeeded:0,lastAt:w.minute-a.cooldown!,pendingPlanId:null,status:'active',reason:null});
 else {const p=s.routines.find(p=>p.id===a.routineId)!;p.status='disarmed';p.reason='本人自主撤销后续分支';}
 emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},witnesses:[r.id],text:a.operation==='reflect'?`${r.name}为自己写下目标：“${a.text!.trim()}”，近期关注${focusNames[a.focus!]}。`:a.operation==='conclude'?`${r.name}对自己先前的目标作了回顾：“${a.text!.trim()}”；这是本人理解，不代表世界已替其完成目标。`:a.operation==='arm'?`${r.name}自行接受有限日常安排：${a.routineAction!.type==='eat'?'饥饿达到'+a.threshold+'时吃选定的自有食物':'体力低于'+a.threshold+'时回本人实际床位睡'+(a.routineAction as {minutes:number}).minutes+'分钟'}，${a.days}日内至多${a.uses}次、间隔至少${a.cooldown}分钟；不改价、不代替别人同意、不保证物资与通路；不占用已接受的工作、学习、照护或活动窗口，多分支同时触发时需要本人重新协调。`:`${r.name}自行撤销了后续日常分支，当前已经进行的动作仍保留实际后果。`});
 if(s.goals.length>40)s.goals=s.goals.slice(-20);if(s.routines.length>40)s.routines=s.routines.filter(p=>p.status==='active'||p.pendingPlanId||s.routines.indexOf(p)>=s.routines.length-20);
 r.revision++;return null;
}
function idle(r:Resident){return !r.plan&&!r.activity;}
function freeWindow(w:World,r:Resident,p:PersonalRoutine){
 const home=w.buildings.find(b=>b.id===p.homeId),travel=home?findPath(w,r.at,home.door)?.length??0:0;
 const start=w.minute,end=start+(p.action.type==='sleep'?p.action.minutes+travel+(home?home.width+home.height+16:0):5);
 if(educationConflict(w,r.id,start,end))return false;
 if(w.duties?.shifts.some(s=>s.workerId===r.id&&['booked','on-duty'].includes(s.status)&&start<s.end&&s.start<end))return false;
 for(const c of w.employment?.contracts??[])if(c.workerId===r.id&&c.status==='active')for(let day=Math.floor(start/DAY);day<=Math.floor(end/DAY);day++)if(day>=c.startDay&&day<c.endDay&&start<day*DAY+c.terms.startMinute+c.terms.durationMinutes&&day*DAY+c.terms.startMinute<end)return false;
 return true;
}
function due(w:World,r:Resident,p:PersonalRoutine){return capable(w,r)&&!passenger(w,r.id)&&idle(r)&&p.status==='active'&&p.remaining>0&&w.minute<p.expiresAt&&w.minute-p.lastAt>=p.cooldown&&(p.action.type==='eat'?r.hunger>=p.threshold:r.energy<=p.threshold)&&freeWindow(w,r,p);}
export function agencyReady(w:World){return w.residents.some(r=>r.agency?.routines.some(p=>p.pendingPlanId&&idle(r)||p.status==='active'&&(w.minute>=p.expiresAt||due(w,r,p))));}
export function settleAgencyAction(r:Resident,planId:string,error?:string){const p=r.agency?.routines.find(p=>p.pendingPlanId===planId);if(!p)return;p.pendingPlanId=null;if(error){p.status='failed';p.reason=error;}else {p.succeeded++;if(p.remaining<=0)p.status='exhausted';}}
/** These plans are the person's finite prior decision, never a system survival policy or a failed-model fallback. */
export function advanceAgency(w:World):Plan[]{
 const plans:Plan[]=[];for(const r of w.residents){
  const competing=(r.agency?.routines??[]).filter(p=>due(w,r,p));if(competing.length>1){for(const p of competing){p.status='failed';p.reason='本人先前接受的多个分支同时触发，需要本人重新协调';}emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},witnesses:[r.id],text:`${r.name}的多个日常安排同时触发，尚未替本人决定先做哪一项，需要本人重新协调。`});}
  for(const p of r.agency?.routines??[]){
  if(p.pendingPlanId&&idle(r)){p.status='failed';p.reason=r.status==='dead'?'本人已经离世，尚未完成的分支停止':'该次实际安排已中断，不能记为完成';p.pendingPlanId=null;}
  if(p.status!=='active')continue;if(w.minute>=p.expiresAt||p.remaining<=0||r.status==='dead'){p.status=p.remaining<=0?'exhausted':'expired';continue;}
  if(!due(w,r,p)||plans.some(plan=>plan.actorId===r.id))continue;
  const error=p.action.type==='sleep'&&r.homeId!==p.homeId?'本人原来选定的住处已经改变':available(w,r,p.action);if(error){p.status='failed';p.reason=error;emitEvent(w,{kind:'action',actors:[r.id],place:{...r.at},witnesses:[r.id],text:`${r.name}此前同意的日常分支中止：${error}。需要本人重新决定，系统没有替换物品或床位。`});continue;}
  const id=`agency:${p.id}:${p.attempted+1}`;p.attempted++;p.remaining--;p.lastAt=w.minute;p.pendingPlanId=id;
  plans.push({id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:p.definition,intention:'按本人先前接受的有限日常安排行动',actions:[structuredClone(p.action)]});
 }}return plans;
}

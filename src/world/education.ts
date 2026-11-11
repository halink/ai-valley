import {currentPremisesLease} from '../shared/premises.js';
import {hasReceipt} from './receipts.js';
import {markPromiseEnd} from './known-promises.js';
import {cultureConflict} from './culture.js';
import {longCareConflict} from './long-care.js';
import {healthConflict} from './health.js';
import {foodTransaction} from './food.js';
import type {Building,Inventory,Resident,World} from '../shared/types.js';
import type {EducationAction,Enrollment,Lesson,Subject} from '../shared/education.js';
import {accountBalance,initializeEconomy,moveCoins} from './economy.js';
import {ageYears,DAY} from './time.js';
import {distance,findPath,same} from './navigation.js';
import {emitEvent,emitLedgerEvent} from './events.js';

export const subjects:Record<Subject,string>={farming:'农事',building:'建造',care:'基础照护'};
const validInt=(n:unknown,a:number,b:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=a&&n<=b;
const capable=(r:Resident)=>r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const adult=(w:World,r:Resident)=>capable(r)&&ageYears(r.bornAt,w.minute)>=18;
const person=(w:World,id:string)=>w.residents.find(r=>r.id===id);
const lesson=(w:World,id?:string)=>w.education?.lessons.find(l=>l.id===id);
const place=(w:World,l:Lesson)=>w.buildings.find(b=>b.id===l.buildingId);
const near=(r:Resident,b:Building)=>distance(r.at,b.door)<=8&&(!r.inside||r.inside===b.id);
const entry=(w:World,r:Resident,l:Lesson)=>w.education!.known[r.id]?.includes(l.id)||l.teacherId===r.id||l.enrollments.some(e=>e.learnerId===r.id)||!!place(w,l)&&near(r,place(w,l)!);
const has=(r:Resident,materials:Inventory)=>Object.entries(materials).every(([i,n])=>(r.inventory[i as keyof Inventory]??0)>=n!);
const ownerAccount=(w:World,id:string)=>person(w,id)?.status==='dead'?`estate:${id}`:`resident:${id}`;
function pay(w:World,from:string,to:string,n:number,reason:string,ref:string){if(n>0&&!moveCoins(w,from,to,n,reason,ref))throw new Error('education_transfer_failed:'+reason);}
function announce(w:World,l:Lesson,text:string,actors=[l.teacherId]){const b=place(w,l);if(b)emitEvent(w,{kind:'education',actors,place:{...b.door},text});}
export function initializeEducation(w:World){
 if(w.mode!=='formal')return;initializeEconomy(w);
 w.education??={lessons:[],nextSerial:1,known:{},pulses:[],totals:{lessons:0,completed:0,minutes:0,paid:0,refunded:0}};
 w.definitions['education/rules@1']??={id:'education/rules',version:1,kind:'action',dependencies:[],data:{minutes:60,gain:.25,materials:{farming:{seed:1,water:1},building:{wood:1,stone:1},care:{meal:1,water:1}}}};
 w.activeDefinitions['education/rules']??='education/rules@1';
}
/** One shared teaching table. Beds are independent; kitchen/workshop uses must not overlap. */
export function educationConflict(w:World,id:string,start:number,end:number,buildingId?:string,except?:string):string|null {
 const cultural=cultureConflict(w,id,start,end,buildingId,except);if(cultural)return cultural;
 const care=longCareConflict(w,id,start,end);if(care)return care;
 const medical=healthConflict(w,id,start,end,buildingId);if(medical)return medical;
 const reservations=w.education?.lessons.filter(l=>l.id!==except&&l.status==='scheduled'&&(l.teacherId===id||l.enrollments.some(e=>e.learnerId===id&&e.status==='enrolled')||!!buildingId&&l.buildingId===buildingId))??[];
 for(const l of reservations){
  const overlap=start<l.end&&l.start<end,participant=l.teacherId===id||l.enrollments.some(e=>e.learnerId===id&&e.status==='enrolled');
  if(overlap&&buildingId&&l.buildingId===buildingId)return '这处共用教学或生产空间已有课堂预留';
  if(participant&&overlap)return '本人已接受相同时段的授课或学习安排';
  if(participant&&buildingId){const b=place(w,l),other=w.buildings.find(b=>b.id===buildingId),gap=end<=l.start?l.start-end:start-l.end;if(!b||!other)continue;const path=findPath(w,b.door,other.door);if(path===null||path.length>gap)return '课堂与已有安排之间的通勤时间不足';}
 }
 return null;
}
function otherWork(w:World,r:Resident,b:Building,start:number,end:number,except?:string):string|null {
 const prior=educationConflict(w,r.id,start,end,b.id,except);if(prior)return prior;
 const shifts=(w.duties?.shifts??[]).filter(s=>['booked','on-duty'].includes(s.status)&&(s.workerId===r.id||s.buildingId===b.id)).map(s=>({start:s.start,end:s.end,buildingId:s.buildingId}));
 for(const c of w.employment?.contracts??[])if(c.status==='active'&&(c.workerId===r.id||c.buildingId===b.id))for(let day=Math.floor(start/DAY)-1;day<=Math.floor(end/DAY)+1;day++)if(day>=c.startDay&&day<c.endDay)shifts.push({start:day*DAY+c.terms.startMinute,end:day*DAY+c.terms.startMinute+c.terms.durationMinutes,buildingId:c.buildingId});
 for(const s of shifts){
  if(start<s.end&&s.start<end)return '课堂与已接受的岗位或共用空间时段冲突';
  const other=w.buildings.find(b=>b.id===s.buildingId);if(!other)continue;
  const gap=end<=s.start?s.start-end:start-s.end;if(gap>DAY)continue;const path=findPath(w,b.door,other.door);if(path===null||path.length>gap)return '已有岗位与课堂之间的通勤时间不足';
 }
 return null;
}
function classroom(w:World,r:Resident,b:Building){return b.condition>0&&(b.ownerId==='commons'&&['school','lodge'].includes(b.kind)||b.ownerId===r.id&&['school','workshop','store'].includes(b.kind));}
function refundEnrollment(w:World,l:Lesson,e:Enrollment){
 if(e.settled)return;const n=accountBalance(w,e.account);
 const dest=e.payer==='treasury'?l.funding&&l.funding.expiresAt>w.minute&&l.status==='scheduled'?l.funding.account:'treasury':ownerAccount(w,e.payer);
 pay(w,e.account,dest,n,'未发生教学的学费退还',`${e.id}:refund`);
 if(e.payer==='treasury'&&dest!=='treasury')l.funding!.remaining+=n;
 e.refunded+=n;e.settled=true;w.education!.totals.refunded+=n;
}
function stopClassAction(w:World,l:Lesson,id:string){
 const r=person(w,id),a=r?.activity?.action;if(!r||a?.type!=='education'||a.lessonId!==l.id||!['teach','study'].includes(a.operation))return;
 if(r.activity!.path.length||r.activity!.room?.path.length||r.inside!==l.buildingId)return;
 r.activity=null;r.revision++;if(!r.plan?.actions.length){r.plan=null;r.decisionDue=w.minute;}
}
function returnOffer(w:World,l:Lesson,o:Lesson['offers'][number],status:'expired'|'withdrawn'){
 if(o.status!=='offered')return;pay(w,o.account,ownerAccount(w,o.payerId),accountBalance(w,o.account),'未接受的代付学费退还',`${o.id}:refund`);o.status=status;
}
export function hasEducationAssets(w:World,id:string){return !!w.education?.lessons.some(l=>l.offers.some(o=>o.payerId===id&&o.status==='offered')||l.enrollments.some(e=>e.payer===id&&!e.settled));}
export function educationDeadline(w:World,id:string){return Math.min(Infinity,...(w.education?.lessons.filter(l=>l.status==='scheduled'&&(l.teacherId===id||l.enrollments.some(e=>e.learnerId===id&&e.status==='enrolled'))).map(l=>w.minute<l.start?l.start:l.end)??[]));}
export function educationReason(w:World,r:Resident,a:EducationAction):string|null {
 if(!w.education||!capable(r)||ageYears(r.bornAt,w.minute)<6)return '本人目前不能自主参加教学';
 if(a.operation==='post'){
  const d=w.definitions[w.activeDefinitions['education/rules']];if(!d||d.id!=='education/rules'||!validInt(d.data.minutes,1,360)||typeof d.data.gain!=='number'||d.data.gain<=0||d.data.gain>1)return '当前没有有效教学规则';
  const b=w.buildings.find(b=>b.id===a.buildingId);
  if(b&&currentPremisesLease(w,b.id))return '原址仍有经营租约，不能另行承诺课堂';
  if(!adult(w,r)||!a.subject||!Object.hasOwn(subjects,a.subject)||r.skills[a.subject]<1||!b||!r.knownBuildings.includes(b.id)||!classroom(w,r,b)||!near(r,b))return '授课需要成年、相应技能至少1级，并在有使用权的教学场所公告板附近';
  if(!validInt(a.startsIn,30,7*DAY)||!validInt(a.windowMinutes,60,360)||!validInt(a.fee,0,30)||!validInt(a.capacity,1,4))return '课程须提前30分钟至7日，窗口60–360分钟，学费0–30钱，席位1–4';
  if(w.education.lessons.filter(l=>l.teacherId===r.id&&l.status==='scheduled').length>=3)return '本人已有三场尚未结束的授课安排';
  return otherWork(w,r,b,w.minute+a.startsIn,w.minute+a.startsIn+a.windowMinutes);
 }
 const l=lesson(w,a.lessonId),b=l&&place(w,l);if(!l||!b||!entry(w,r,l))return '本人尚未获知这场课程';
 const e=l.enrollments.find(e=>e.learnerId===r.id&&e.status==='enrolled');
 if(a.operation==='withdrawSponsor')return l.offers.some(o=>o.id===a.fundingId&&o.payerId===r.id&&o.status==='offered')?null:'只有尚未接受的本人代付提议可以撤回';
 if(a.operation==='withdraw')return e?null:'本人没有本场有效报名';
 if(a.operation==='cancel')return l.teacherId===r.id&&l.status==='scheduled'?null:'本人没有可以取消的授课安排';
 if(l.status!=='scheduled'||w.minute>=l.end||b.condition<=0)return '本场课程已经结束或场所不可用';
 if(a.operation==='sponsor'){
  const learner=person(w,a.learnerId??'');
  return adult(w,r)&&l.fee>0&&r.coins>=l.fee&&learner&&capable(learner)&&learner.id!==l.teacherId&&ageYears(learner.bornAt,w.minute)>=6&&r.knownPeople.includes(learner.id)&&learner.skills[l.subject]<l.teacherSkill&&!l.offers.some(o=>o.status==='offered'&&o.learnerId===learner.id)&&!l.enrollments.some(e=>e.learnerId===learner.id)?null:'代付需要本人钱款、已认识的适龄学习者，且没有重复报名或待接受代付';
 }
 if(a.operation==='enroll'){
  if(l.teacherId===r.id||r.skills[l.subject]>=l.teacherSkill||l.enrollments.some(e=>e.learnerId===r.id)||l.enrollments.filter(e=>e.status==='enrolled').length>=l.capacity)return '本人已报名、无需该层次教学或没有空席';
  if(w.minute>l.end-l.minutes)return '剩余窗口不足以完成本场学习';
  const conflict=otherWork(w,r,b,Math.max(w.minute,l.start),l.end,l.id);if(conflict)return conflict;
  const path=findPath(w,r.at,b.door);if(path===null||w.minute+path.length>l.end-l.minutes)return '实际路程使本场学习来不及完成';
  if(l.fee===0)return a.fundingId?'免费课程不需要助学或代付名额':null;
  if(a.fundingId==='public')return l.funding&&l.funding.expiresAt>=l.end&&accountBalance(w,l.funding.account)>=l.fee?null:'公共助学预算没有有效足额余款';
  if(a.fundingId)return l.offers.some(o=>o.id===a.fundingId&&o.learnerId===r.id&&o.status==='offered'&&o.expiresAt>w.minute)?null:'本人没有这项有效代付邀请';
  return adult(w,r)&&r.coins>=l.fee?null:'未成年学习者须选择免费、本人接受的代付或获议决助学名额';
 }
 if(a.operation==='teach'||a.operation==='study'){
  if(!validInt(a.minutes,1,120)||w.minute<l.start||r.health<35||r.energy<5)return '须在课堂窗口内，身体适合，选择1–120分钟';
  if(a.operation==='teach'&&(!adult(w,r)||l.teacherId!==r.id||r.skills[l.subject]<1||!classroom(w,r,b)))return '只有具备当前能力和场所权限的原授课人能开课';
  if(a.operation==='study'&&!e)return '须本人先独立报名';
  const path=findPath(w,r.at,b.door);if(path===null||w.minute+path.length>=l.end)return '课堂不可达或路程超过本场窗口';
  const conflict=otherWork(w,r,b,w.minute+path.length,Math.min(l.end,w.minute+path.length+a.minutes),l.id);if(conflict)return conflict;
  if(a.operation==='teach'&&!l.materialsUsed&&!has(r,l.materials))return '本人尚未带齐教学所需的真实示范材料';
  return null;
 }
 return '没有这项教学安排';
}
export function educationTarget(w:World,r:Resident,a:EducationAction){
 const error=educationReason(w,r,a);if(error)return {target:r.at,duration:0,error};
 const l=lesson(w,a.lessonId),b=a.operation==='post'?w.buildings.find(b=>b.id===a.buildingId)!:place(w,l!)!;
 return {target:{...b.door},duration:a.operation==='teach'||a.operation==='study'?Math.min(a.minutes!,l!.end-w.minute):5};
}
export function educationWorkError(w:World,r:Resident,a:EducationAction,dt:number):string|null {
 if(a.operation!=='teach'&&a.operation!=='study')return null;
 const l=lesson(w,a.lessonId),b=l&&place(w,l);if(!l||!b)return '教学场所不存在';
 const e=l.enrollments.find(e=>e.learnerId===r.id&&e.status==='enrolled');
 if(a.operation==='study'&&l.enrollments.some(e=>e.learnerId===r.id&&e.status==='completed')){if(r.activity?.action===a)r.activity.remaining=0;return null;}
 if(l.status!=='scheduled'||l.endedAt!==null||r.health<35||r.energy<5||w.minute-dt>=l.end||a.operation==='study'&&!e)return '本场教学或本人报名已不再有效';
 if(a.operation==='teach'&&(!adult(w,r)||r.id!==l.teacherId||!classroom(w,r,b)))return '授课者当前能力或场所权限已改变';
 if(!same(r.at,b.door))return '须本人实际抵达课堂';
 r.inside=b.id;
 const from=Math.max(w.minute-dt,l.start),to=Math.min(w.minute,l.end,from+(r.activity?.remaining??dt));
 if(to>from)w.education!.pulses.push({lessonId:l.id,personId:r.id,role:a.operation==='teach'?'teach':'study',from,to});
 if(w.minute>=l.end-1e-8&&r.activity?.action===a)r.activity.remaining=0;
 return null;
}
export function authorizeEducation(w:World,id:string,amount:number,days:number,proposalId:string):string|null {
 const l=lesson(w,id),teacher=l&&person(w,l.teacherId),b=l&&place(w,l);
 if(!l||!teacher||!b||b.ownerId!=='commons'||l.status!=='scheduled'||l.end<=w.minute||!adult(w,teacher)||!classroom(w,teacher,b)||l.fee===0)return '这项公共课堂当前不能取得助学授权';
 if(!validInt(amount,1,1000)||!validInt(days,1,28)||w.minute+days*DAY<l.end||accountBalance(w,'treasury')<amount||l.funding)return '本场助学预算不足、期限不足或已经获批';
 const account=`escrow:education:${l.id}:public`;pay(w,'treasury',account,amount,'居民表决的教学资助',`${proposalId}:education`);
 l.funding={proposalId,account,allocated:amount,remaining:amount,refunded:0,expiresAt:w.minute+days*DAY};announce(w,l,`居民独立表决为本场${subjects[l.subject]}课预留 ${amount} 钱助学金。每名学生仍须本人决定报名与到场，按实际教学付款。`);return null;
}
export function completeEducation(w:World,r:Resident,a:EducationAction):string|null {
 if(a.operation==='teach'||a.operation==='study')return null;
 const ref=r.activity?`education:${r.activity.planId}:${r.activity.startedAt}:${a.operation}`:`education:${r.id}:${r.revision}:${w.revision}`;if(hasReceipt(w,ref))return null;
 const error=educationReason(w,r,a);if(error)return error;
 const l=lesson(w,a.lessonId),b=a.operation==='post'?w.buildings.find(b=>b.id===a.buildingId)!:place(w,l!)!;if(!same(r.at,b.door))return '须亲自到课堂公告板办理';
 if(a.operation==='post'){
  const definition=w.activeDefinitions['education/rules'],d=w.definitions[definition];
  const id=`lesson:${w.id}:${w.education!.nextSerial++}`;
  const course:Lesson={id,teacherId:r.id,buildingId:b.id,subject:a.subject!,definition,postedAt:w.minute,start:w.minute+a.startsIn!,end:w.minute+a.startsIn!+a.windowMinutes!,endedAt:null,status:'scheduled',reason:null,
   fee:a.fee!,capacity:a.capacity!,teacherSkill:r.skills[a.subject!],minutes:Number(d.data.minutes),gain:Number(d.data.gain),materials:structuredClone((d.data.materials as Record<string,Inventory>)[a.subject!]),materialsUsed:false,
   enrollments:[],offers:[],nextSerial:1,funding:null,taught:0,lastAt:-1,pauseReason:null};
  w.education!.lessons.push(course);(w.education!.known[r.id]??=[]).push(id);w.education!.totals.lessons++;
  announce(w,course,`${r.name}自主发布${subjects[a.subject!]}课堂，${a.startsIn}分钟后开课，窗口${a.windowMinutes}分钟，${a.capacity}席，每位完整60分钟学费${a.fee}钱，最多增长${course.gain}级。报名、代付和每次到场均需各人决定。`);
 }else if(a.operation==='sponsor'){
  const id=`${l!.id}:sponsor:${l!.nextSerial++}`,account=`escrow:${id}`;pay(w,`resident:${r.id}`,account,l!.fee,'自主提出代付学费',ref);
  l!.offers.push({id,learnerId:a.learnerId!,payerId:r.id,account,amount:l!.fee,offeredAt:w.minute,expiresAt:Math.min(l!.end-l!.minutes,w.minute+2*DAY),status:'offered'});
  announce(w,l!,`${r.name}愿意为${person(w,a.learnerId!)?.name}代付${l!.fee}钱学费，学习者尚未接受，不会被自动安排上课。`,[r.id,a.learnerId!]);
 }else if(a.operation==='withdrawSponsor')returnOffer(w,l!,l!.offers.find(o=>o.id===a.fundingId)!,'withdrawn');
 else if(a.operation==='enroll'){
  const id=`${l!.id}:enrollment:${l!.nextSerial++}`,account=`escrow:${id}`;let payer=r.id;
  if(l!.fee){
   if(a.fundingId==='public'){payer='treasury';pay(w,l!.funding!.account,account,l!.fee,'本人接受助学名额',ref);l!.funding!.remaining-=l!.fee;}
   else if(a.fundingId){const o=l!.offers.find(o=>o.id===a.fundingId)!;payer=o.payerId;pay(w,o.account,account,l!.fee,'本人接受学费代付',ref);o.status='used';}
   else pay(w,`resident:${r.id}`,account,l!.fee,'本人预存已同意学费',ref);
  }
  const seats=new Set(l!.enrollments.filter(e=>e.status==='enrolled').map(e=>e.seat));let seat=0;while(seats.has(seat))seat++;
  l!.enrollments.push({id,learnerId:r.id,seat,acceptedAt:w.minute,endedAt:null,settled:false,status:'enrolled',reason:null,payer,account,reserved:l!.fee,paid:0,refunded:0,worked:0,gained:0});
  (w.education!.known[r.id]??=[]).push(l!.id);announce(w,l!,`${r.name}独立报名${subjects[l!.subject]}课${l!.fee?`，预存 ${l!.fee} 钱`:'，本场免费'}。是否按时到场仍由本人决定，未发生的教学不收费。`,[r.id,l!.teacherId]);
 }else if(a.operation==='withdraw'){
  const e=l!.enrollments.find(e=>e.learnerId===r.id&&e.status==='enrolled')!;e.status='withdrawn';e.endedAt=w.minute;e.reason='本人退出学习';
  announce(w,l!,`${r.name}决定退出本场学习，实际学到的技能保留，未发生的学费将退回原付款人。`,[r.id]);
 }else if(a.operation==='cancel'){markPromiseEnd(w,l!,r);l!.endedAt=w.minute;l!.reason='教师自主取消本场教学';announce(w,l!,`${r.name}取消本场教学，已有学习与劳动记录保留，未履行部分原路结清。`);}
 w.processed.push(ref);r.revision++;w.revision++;return null;
}
/** Settlement follows all actors' movement/work, so list order cannot create attendance. */
export function advanceEducation(w:World){
 initializeEducation(w);const state=w.education;if(!state)return;
 for(const l of state.lessons){
  const b=place(w,l),teacher=person(w,l.teacherId),pulses=state.pulses.filter(p=>p.lessonId===l.id),teaching=pulses.find(p=>p.role==='teach'&&p.personId===l.teacherId);
  if(b)for(const r of w.residents)if(capable(r)&&near(r,b)){const ids=state.known[r.id]??=[];if(!ids.includes(l.id))ids.push(l.id);}
  const eligible=teacher&&adult(w,teacher)&&b&&classroom(w,teacher,b)&&teacher.skills[l.subject]>=1&&l.status==='scheduled';
  l.pauseReason=eligible?null:'教师或场所当前不可用';
  let consumed=false,taught=0;
  for(const e of l.enrollments){
   const student=person(w,e.learnerId),study=pulses.find(p=>p.personId===e.learnerId&&p.role==='study');
   const until=Math.min(l.end,l.endedAt??Infinity,e.endedAt??Infinity);
   if(eligible&&teaching&&study&&student&&capable(student)&&student.skills[l.subject]<Math.min(l.teacherSkill,teacher!.skills[l.subject])){
    const from=Math.max(teaching.from,study.from,l.start,e.acceptedAt),to=Math.min(teaching.to,study.to,until);
    let dt=Math.min(Math.max(0,to-from),l.minutes-e.worked);
    // One durable lastAt per class guards repeated fractional settlement without a receipt per tick.
    if(l.lastAt>=to-1e-9)dt=0;
    if(dt>0&&!l.materialsUsed){if(!has(teacher!,l.materials)){l.pauseReason='教师示范材料不足';dt=0;}else foodTransaction(w,()=>{for(const [i,n]of Object.entries(l.materials))teacher!.inventory[i as keyof Inventory]=(teacher!.inventory[i as keyof Inventory]??0)-n!;l.materialsUsed=true;teacher!.revision++;consumed=true;});}
    if(dt>0){
     const gain=Math.max(0,Math.min(l.gain*dt/l.minutes,l.teacherSkill-student.skills[l.subject],teacher!.skills[l.subject]-student.skills[l.subject]));
     student.skills[l.subject]+=gain;student.revision++;e.worked+=dt;e.gained+=gain;taught=Math.max(taught,dt);state.totals.minutes+=dt;
     const due=Math.floor(e.reserved*e.worked/l.minutes+1e-8)-e.paid;if(due){pay(w,e.account,ownerAccount(w,l.teacherId),due,'实际共同在场的教学报酬',`${e.id}:paid:${e.paid+due}`);e.paid+=due;state.totals.paid+=due;}
     if(e.worked>=l.minutes-1e-8||student.skills[l.subject]>=l.teacherSkill-1e-8){e.worked=Math.min(e.worked,l.minutes);student.skills[l.subject]=Number(student.skills[l.subject].toFixed(9));e.gained=Number(e.gained.toFixed(9));e.status='completed';e.endedAt=w.minute;state.totals.completed++;announce(w,l,`${student.name}完成本场${subjects[l.subject]}学习，实际共同学习${Math.round(e.worked)}分钟，增长${e.gained.toFixed(2)}级；教师实得${e.paid}钱。`,[l.teacherId,student.id]);}
    }
   }else if(study&&!teaching)l.pauseReason='学生已到场，教师尚未实际授课';
   if(e.status==='enrolled'&&(!student||!capable(student)||!eligible||l.endedAt!==null||w.minute>=l.end)){e.status='ended';e.endedAt=w.minute;e.reason='课程、学习者或付款安排已结束';}
  }
  l.taught+=taught;if(consumed)announce(w,l,`${teacher!.name}开始实际传授${subjects[l.subject]}，本场示范材料已投入；仅同时在场的学生获得学习进度。`);
  for(const o of l.offers)if(o.status==='offered'&&(o.expiresAt<=w.minute||l.endedAt!==null||w.minute>=l.end||!eligible||person(w,o.payerId)?.status==='dead'||!person(w,o.learnerId)||!capable(person(w,o.learnerId)!)))returnOffer(w,l,o,'expired');
  for(const e of l.enrollments)if(e.status!=='enrolled'){refundEnrollment(w,l,e);stopClassAction(w,l,e.learnerId);}
  if(l.status==='scheduled'&&(!eligible||l.endedAt!==null||w.minute>=l.end)){l.status=l.endedAt!==null||!eligible?'cancelled':'finished';l.endedAt??=w.minute;l.reason??=eligible?'课堂窗口结束':'教师离开、失去能力或场所不可用';emitLedgerEvent(w,{kind:'education',actors:[l.teacherId,...l.enrollments.map(e=>e.learnerId)],place:{...place(w,l)!.door},text:`本场${subjects[l.subject]}课堂结束，已学技能保留，未履行的预存学费退回，未用公共助学款归还金库。`});}
  if(l.status!=='scheduled')stopClassAction(w,l,l.teacherId);
  if(l.funding&&(l.status!=='scheduled'||l.funding.expiresAt<=w.minute)){const n=accountBalance(w,l.funding.account);pay(w,l.funding.account,'treasury',n,'未使用助学预算退回',`${l.id}:public-refund:${l.funding.refunded+n}`);l.funding.refunded+=n;l.funding.remaining=0;}
  if(pulses.length)l.lastAt=Math.max(l.lastAt,...pulses.map(p=>p.to));
 }
 state.pulses=[];
 if(state.lessons.length>100)state.lessons=state.lessons.filter((l,i)=>l.status==='scheduled'||l.end>w.minute||i>=state.lessons.length-60||l.enrollments.some(e=>!e.settled)||l.offers.some(o=>o.status==='offered'));
 const retained=new Set(state.lessons.map(l=>l.id));for(const ids of Object.values(state.known))for(let i=ids.length-1;i>=0;i--)if(!retained.has(ids[i]))ids.splice(i,1);
}
/** Fixed real teaching positions in the currently illustrated room, shared by renderer and observers. */
export function teachingPosition(w:World,id:string):{x:number;y:number}|null {
 const r=person(w,id);if(!r?.inside)return null;
 for(const l of w.education?.lessons??[])if(l.status==='scheduled'&&l.buildingId===r.inside){
  const a=r.activity?.action;if(a?.type!=='education'||a.lessonId!==l.id)continue;
  if(a.operation==='teach')return {x:128,y:96};
  const e=l.enrollments.find(e=>e.learnerId===id&&e.status==='enrolled');if(e&&a.operation==='study')return [{x:96,y:130},{x:128,y:130},{x:160,y:130},{x:128,y:158}][e.seat];
 }
 return null;
}

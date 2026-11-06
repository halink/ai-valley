import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import type {EducationAction,Subject} from '../shared/education.js';
import {educationReason,subjects} from '../world/education.js';
import {distance} from '../world/navigation.js';
import {ageYears} from '../world/time.js';

export function educationNotes(w:World,r:Resident){
 const courses=w.education?.lessons.filter(l=>w.buildings.some(b=>b.id===l.buildingId&&distance(r.at,b.door)<=8&&(!r.inside||r.inside===b.id))&&l.status==='scheduled'&&(w.education?.known[r.id]?.includes(l.id)||l.teacherId===r.id||l.enrollments.some(e=>e.learnerId===r.id)))??[];
 return courses.slice(0,3).map(l=>`${w.residents.find(p=>p.id===l.teacherId)?.name}的${subjects[l.subject]}课：${l.start>w.minute?'距开课'+Math.ceil(l.start-w.minute)+'分钟':'窗口内'}，距结束${Math.ceil(l.end-w.minute)}分钟；完整60分钟学费${l.fee}钱，${l.capacity}席。${r.inside===l.buildingId?l.pauseReason??'进度须师生实际同时到场':'是否开课与实际到场情况须本人前往核实'}。`).join(' ');
}
export function educationOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(!w.education||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<6)return [];
 const result:FormalOpportunity[]=[];const add=(id:string,label:string,action:EducationAction)=>{if(!educationReason(w,r,action))result.push({id:'education.'+id,label,action});};
 for(const b of w.buildings.filter(b=>r.knownBuildings.includes(b.id)&&(b.ownerId==='commons'&&['school','lodge'].includes(b.kind)||b.ownerId===r.id&&['school','workshop','store'].includes(b.kind)))){
  if(distance(r.at,b.door)>8||r.inside&&r.inside!==b.id){if(ageYears(r.bornAt,w.minute)>=18&&Object.values(r.skills).some(n=>n>=1))result.push({id:'education.board.'+b.id,label:`去${b.name}公告板查看教学或自行发布课程`,action:{type:'move',to:{...b.door}}});continue;}
  for(const subject of Object.keys(subjects) as Subject[])for(const fee of [0,6])add(`post.${b.id}.${subject}.${fee}`,`在${b.name}自行发布${subjects[subject]}课：60分钟学习，60分钟后开课、开放180分钟、最多4席，完整学费${fee}钱。可另填startsIn（30–10080）、windowMinutes（60–360）、capacity（1–4）、fee（0–30）；需本人示范材料和实际到场，不会自动招学生`,{type:'education',operation:'post',buildingId:b.id,subject,startsIn:60,windowMinutes:180,fee,capacity:4});
 }
 const known=w.education.lessons.filter(l=>l.status==='scheduled'&&(w.education!.known[r.id]?.includes(l.id)||l.teacherId===r.id||l.enrollments.some(e=>e.learnerId===r.id)||w.buildings.some(b=>b.id===l.buildingId&&distance(r.at,b.door)<=8))).slice(0,8);
 for(const l of known){
  const name=`${w.residents.find(p=>p.id===l.teacherId)?.name}的${subjects[l.subject]}课`,b=w.buildings.find(b=>b.id===l.buildingId);if(!b)continue;
  if(distance(r.at,b.door)>8||r.inside&&r.inside!==b.id){result.push({id:'education.visit.'+l.id,label:`去已知的${name}现场了解报名或上课`,action:{type:'move',to:{...b.door}}});continue;}
  add('enroll.'+l.id,`本人报名${name}：${l.fee?'自费预存'+l.fee+'钱':'免费'}，实际共同学习60分钟最多增长0.25级；报名不替本人决定到场`,{type:'education',operation:'enroll',lessonId:l.id});
  add('public.'+l.id,`本人接受${name}获居民表决的公共助学名额，按实际共同上课向教师付费`,{type:'education',operation:'enroll',lessonId:l.id,fundingId:'public'});
  for(const o of l.offers.filter(o=>o.status==='offered')){
   if(o.learnerId===r.id)add('accept.'+o.id,`自行接受${w.residents.find(p=>p.id===o.payerId)?.name}代付${o.amount}钱的提议，报名${name}，自己仍决定是否上课`,{type:'education',operation:'enroll',lessonId:l.id,fundingId:o.id});
   add('withdrawSponsor.'+o.id,`撤回尚未接受的本人代付提议：${name}`,{type:'education',operation:'withdrawSponsor',lessonId:l.id,fundingId:o.id});
  }
  for(const child of w.residents.filter(p=>r.knownPeople.includes(p.id)&&p.status==='alive'&&ageYears(p.bornAt,w.minute)>=6&&ageYears(p.bornAt,w.minute)<18).slice(0,4))add('sponsor.'+l.id+child.id,`自愿从本人钱款预存${l.fee}钱，提出为${child.name}代付${name}学费；孩子须自行接受，未接受可以撤回`,{type:'education',operation:'sponsor',lessonId:l.id,learnerId:child.id});
  for(const [operation,label]of [['teach','亲自到教学桌授课'],['study','亲自到本人报名的课堂学习']] as const)add(operation+l.id,`${label}30分钟：${name}。可填minutes（1–120），只有师生实际同时在场且有示范材料才增长技能与结薪，缺席不补课不补进度`,{type:'education',operation,lessonId:l.id,minutes:30});
  add('withdraw.'+l.id,`本人退出${name}，已学技能保留，未发生学费退回原付款人`,{type:'education',operation:'withdraw',lessonId:l.id});
  add('cancel.'+l.id,`本人取消所发布的${name}，已完成教学保留，未履行的学费和资助结清`,{type:'education',operation:'cancel',lessonId:l.id});
 }
 return result;
}
export function educationChoiceFields(a:EducationAction){return a.operation==='post'?['startsIn','windowMinutes','fee','capacity']:a.operation==='teach'||a.operation==='study'?['minutes']:[];}
export function parseEducationChoice(action:EducationAction,data:Record<string,unknown>):EducationAction {
 const a=structuredClone(action);for(const key of educationChoiceFields(a)){
  const n=data[key];if(n===undefined)continue;
  const [min,max]=key==='startsIn'?[30,10080]:key==='windowMinutes'?[60,360]:key==='fee'?[0,30]:key==='capacity'?[1,4]:[1,120];
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<min||n>max)throw new Error('invalid_education_term');
  if(key==='startsIn')a.startsIn=n;else if(key==='windowMinutes')a.windowMinutes=n;else if(key==='fee')a.fee=n;else if(key==='capacity')a.capacity=n;else a.minutes=n;
 }return a;
}

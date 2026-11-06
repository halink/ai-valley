import {markPromiseEnd} from './known-promises.js';
import {healthDefinition} from './process-definitions.js';
import {estateStock,estateLocation} from './estate-custody.js';
import {isTransportAction,transportReason,transportTarget,completeTransport,syncMedicalTransport,pruneTransportRecords} from './medical-transport.js';
import type {Resident,World,Vec} from '../shared/types.js';import type {HealthAction,Appointment,HealthCase} from '../shared/health.js';
import {ageYears,DAY} from './time.js';import {distance,findPath,same} from './navigation.js';import {coLocated} from './proximity.js';import {emitEvent} from './events.js';import {accountBalance,initializeEconomy,moveCoins} from './economy.js';import {employmentConflict} from './employment.js';import {educationConflict} from './education.js';
const person=(w:World,id?:string)=>w.residents.find(r=>r.id===id),site=(w:World,id?:string)=>w.buildings.find(b=>b.id===id);
const capable=(r:Resident|undefined):r is Resident=>!!r&&r.status==='alive'&&r.residency!=='outside'&&r.canDecide&&r.canExpress;
const adult=(w:World,r:Resident)=>capable(r)&&ageYears(r.bornAt,w.minute)>=18;
const valid=(n:unknown,a:number,b:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=a&&n<=b;
const account=(w:World,id:string)=>person(w,id)?.status==='dead'?`estate:${id}`:`resident:${id}`;
const bag=(w:World,id:string,source:string)=>{const p=person(w,id);return p?.status==='dead'?estateStock(w,id,source,w.estates.find(e=>e.personId===id)?.location??estateLocation(p.at,p.inside,p.roomAt??null,'医生随身保留药剂')):p?.inventory;};
function payment(w:World,from:string,to:string,n:number,why:string,ref:string){if(n>0&&!moveCoins(w,from,to,n,why,ref))throw new Error('medical_payment_unfunded');}
function fact(w:World,r:Resident,text:string,actors=[r.id]){emitEvent(w,{kind:'care',actors,place:{...r.at},text});}
export function initializeHealth(w:World){if(w.mode!=='formal')return;initializeEconomy(w);w.health??={transportOffers:[],transports:[],cases:[],appointments:[],pulses:[],nextSerial:1,lastDay:Math.floor(w.minute/DAY),totals:{injuries:0,illnesses:0,recovered:0,treated:0,paid:0,refunded:0}};w.health.transportOffers??=[];w.health.transports??=[];healthDefinition(w);for(const c of [...w.health.cases,...w.health.appointments]){c.definition??='health/rules@1';c.rules??=healthDefinition(w,c.definition).rules;}}
export function activeCases(w:World,id:string){return w.health?.cases.filter(c=>c.personId===id&&c.stage!=='resolved')??[];}
export function addHealthCase(w:World,r:Resident,kind:HealthCase['kind'],severity:number,source:string){initializeHealth(w);if(!w.health||r.status!=='alive'||!Number.isFinite(severity)||severity<=0)return null;
 const prior=activeCases(w,r.id).find(c=>c.kind===kind);if(prior){prior.severity=Math.min(100,prior.severity+severity/4);return prior;}
 const binding=healthDefinition(w),c:HealthCase={definition:binding.definition,rules:binding.rules,id:`health:${w.id}:${w.health.nextSerial++}`,personId:r.id,kind,source,severity:Math.min(100,severity),stage:'acute',startedAt:w.minute,lastAt:w.minute,resolvedAt:null,treatment:0,capacity:null};w.health.cases.push(c);w.health.totals[kind==='injury'?'injuries':'illnesses']++;r.revision++;r.decisionDue=Math.min(r.decisionDue,w.minute);fact(w,r,`${r.name}出现了${kind==='injury'?'实际损伤':'生病症状'}，身体恢复与是否求医需要分别记录。`);return c;
}
export function movementRate(w:World,r:Resident){return Math.min(1,...activeCases(w,r.id).map(c=>{const rules=c.rules??healthDefinition(w,c.definition??'health/rules@1').rules;return c.severity>=rules.criticalSeverity?0:c.severity>=rules.severeSeverity?rules.severeRate:c.severity>=rules.slowSeverity?rules.slowRate:1;}));}
export function healthConflict(w:World,id:string,start:number,end:number,buildingId?:string,except?:string):string|null{
 for(const a of w.health?.appointments??[])if(a.id!==except&&a.status==='accepted'&&(a.doctorId===id||a.patientId===id||a.buildingId===buildingId)){
  if(start<a.end&&a.start<end)return '已有本人接受的诊疗预约或实际照护工位预留';
  if(a.doctorId===id||a.patientId===id){const b=site(w,a.buildingId),other=site(w,buildingId);if(b&&other){const path=findPath(w,b.door,other.door),gap=end<=a.start?a.start-end:start-a.end;if(path===null||gap<path.length)return '诊疗和既有安排之间没有足够通勤时间';}}
 }return null;
}
const appointment=(w:World,id?:string)=>w.health?.appointments.find(a=>a.id===id);
function scheduling(w:World,r:Resident,start:number,end:number,id:string,except?:string){return healthConflict(w,r.id,start,end,id,except)??educationConflict(w,r.id,start,end,id)??employmentConflict(w,r,start,end,id)??(w.duties?.shifts.some(s=>(s.workerId===r.id||s.buildingId===id&&s.role==='care')&&['booked','on-duty'].includes(s.status)&&start<s.end&&s.start<end)?'与本人公共班次重叠':null);}
export function healthReason(w:World,r:Resident,a:HealthAction):string|null{
 if(isTransportAction(a))return transportReason(w,r,a);
 if(!w.health||!capable(r))return '本人当前无法安排诊疗';
 const binding=healthDefinition(w,a.definition);if(['offer','selfTreat'].includes(a.operation))a.definition=binding.definition;const rules=binding.rules;
 if(a.operation==='selfTreat')return ageYears(r.bornAt,w.minute)>=6&&activeCases(w,r.id).length&&(r.inventory.medicine??0)>=rules.medicine&&(r.inventory.water??0)>=rules.water?null:'自我用药需要已有伤病及本人1药剂、1清水';
 if(a.operation==='offer'){
  const p=person(w,a.targetId),b=site(w,a.buildingId);if(!adult(w,r)||r.skills.care<rules.minimumCare||!p||p.id===r.id||!capable(p)||!coLocated(w,r,p,12))return '需要本人照护能力以及当前可接触、有能力自行同意的患者';
  if(!b||!r.knownBuildings.includes(b.id)||!['clinic','lodge'].includes(b.kind)||b.condition<=0||b.ownerId!=='commons'&&b.ownerId!==r.id)return '没有实际可用且有使用权的诊疗场所';
  if(!valid(a.fee,0,30)||!valid(a.startsIn,30,2*DAY)||(r.inventory.medicine??0)<rules.medicine||(r.inventory.water??0)<rules.water)return '预约需要有效价格、起始时间和医生本人实际药剂与水';
  if(w.health.appointments.filter(c=>c.doctorId===r.id&&['offered','accepted'].includes(c.status)).length>=4)return '请先处理本人已有的四项诊疗安排';
  return scheduling(w,r,w.minute+a.startsIn,w.minute+a.startsIn+rules.bookingWindow,b.id);
 }
 const c=appointment(w,a.appointmentId);if(!c)return '没有这份诊疗预约';
 if(a.operation==='cancel')return (r.id===c.doctorId||r.id===c.patientId)&&['offered','accepted'].includes(c.status)?null:'只能终止本人参与的有效预约';
 if(a.operation==='decline')return c.patientId===r.id&&c.status==='offered'?null:'没有待本人回应的就诊邀请';
 if(a.operation==='accept'){
  if(c.patientId!==r.id||c.status!=='offered'||c.start<=w.minute||!capable(person(w,c.doctorId))||r.coins<c.fee||!activeCases(w,r.id).length)return '待本人同意的预约、伤病或实际诊疗费用已不适用';
  return scheduling(w,r,c.start,c.end,c.buildingId,c.id)??scheduling(w,person(w,c.doctorId)!,c.start,c.end,c.buildingId,c.id);
 }
 if(c.status!=='accepted'||w.minute>=c.end||!site(w,c.buildingId)||!capable(person(w,c.doctorId))||!capable(person(w,c.patientId))||person(w,c.patientId)!.refusesCare||person(w,c.doctorId)!.skills.care<(c.rules?.minimumCare??1))return '预约、患者或医生当前不能继续这次诊疗';
 if(a.operation==='treat'&&c.doctorId!==r.id||a.operation==='receive'&&c.patientId!==r.id)return '只能履行本人一方的诊疗承诺';
 if(!valid(a.minutes,1,120))return '实际诊疗时长无效';return null;
}
export function healthTarget(w:World,r:Resident,a:HealthAction):{target:Vec;duration:number;error?:string}{if(isTransportAction(a))return transportTarget(w,r,a);const error=healthReason(w,r,a);if(error)return {target:r.at,duration:0,error};const c=appointment(w,a.appointmentId);return {target:c&&['treat','receive'].includes(a.operation)?site(w,c.buildingId)!.door:r.at,duration:c&&['treat','receive'].includes(a.operation)?a.minutes!:a.operation==='selfTreat'?healthDefinition(w,a.definition).rules.selfMinutes:5};}
function finish(w:World,c:Appointment,status:Appointment['status'],reason:string){if(!['offered','accepted'].includes(c.status))return;const balance=accountBalance(w,c.account);payment(w,c.account,account(w,c.patientId),balance,'未进行诊疗的费用退回',`${c.id}:refund:${balance}`);c.refunded+=balance;w.health!.totals.refunded+=balance;const stock=bag(w,c.doctorId,c.id);if(stock)for(const [i,n]of Object.entries(c.stock))stock[i as keyof typeof stock]=(stock[i as keyof typeof stock]??0)+n!;c.stock={};c.status=status;c.reason=reason;for(const id of [c.doctorId,c.patientId]){const p=person(w,id);if(p?.activity?.action.type==='health'&&p.activity.action.appointmentId===c.id&&!p.activity.path.length&&!p.activity.room?.path.length&&p.inside===c.buildingId){p.activity=null;p.plan=null;p.decisionDue=w.minute;p.revision++;}}}
function applyMedicine(w:World,r:Resident,amount:number){const c=activeCases(w,r.id).sort((a,b)=>b.severity-a.severity)[0];if(!c)return;c.treatment+=amount;c.severity=Math.max(0,c.severity-amount);if(c.severity<(c.rules?.criticalSeverity??85))c.stage='recovering';w.health!.totals.treated+=amount/35;}
export function completeHealth(w:World,r:Resident,a:HealthAction):string|null{if(isTransportAction(a))return completeTransport(w,r,a);const error=healthReason(w,r,a);if(error)return error;
 const binding=healthDefinition(w,a.definition),rules=binding.rules;
 if(a.operation==='selfTreat'){r.inventory.medicine!-=rules.medicine;r.inventory.water!-=rules.water;applyMedicine(w,r,rules.medicineEffect);fact(w,r,`${r.name}自主用本人${rules.medicine}份照护药剂与${rules.water}份清水处理伤病，仍需实际康复。`);return null;}
 if(a.operation==='offer'){const id=`appointment:${w.id}:${w.health!.nextSerial++}`;r.inventory.medicine!-=rules.medicine;r.inventory.water!-=rules.water;w.health!.appointments.push({definition:binding.definition,rules:structuredClone(rules),id,doctorId:r.id,patientId:a.targetId!,buildingId:a.buildingId!,createdAt:w.minute,start:w.minute+a.startsIn!,end:w.minute+a.startsIn!+rules.bookingWindow,minutes:rules.appointmentMinutes,fee:a.fee!,account:'escrow:'+id,stock:{medicine:rules.medicine,water:rules.water},status:'offered',acceptedAt:null,worked:0,paid:0,refunded:0,materialsUsed:false,lastAt:-1,reason:null});fact(w,r,`${r.name}提出一次诊疗预约并预留自己的药剂与水，等待患者另行决定。`,[r.id,a.targetId!]);return null;}
 const c=appointment(w,a.appointmentId)!;if(['cancel','decline'].includes(a.operation))markPromiseEnd(w,c,r);
 if(a.operation==='accept'){payment(w,`resident:${r.id}`,c.account,c.fee,'本人接受并预付诊疗费用',c.id+':reserve');c.status='accepted';c.acceptedAt=w.minute;if(!r.knownBuildings.includes(c.buildingId))r.knownBuildings.push(c.buildingId);fact(w,r,`${r.name}自行接受了${person(w,c.doctorId)!.name}的诊疗预约，预存${c.fee}钱，报酬按双方实际到场的治疗时间结算。`,[r.id,c.doctorId]);}
 else if(a.operation==='decline'||a.operation==='cancel')finish(w,c,'cancelled',a.operation==='decline'?'患者婉拒':'当事人终止预约');
 return null;
}
export function healthWorkError(w:World,r:Resident,a:HealthAction,dt:number):string|null{if(isTransportAction(a))return transportReason(w,r,a);if(!['treat','receive'].includes(a.operation))return null;const problem=healthReason(w,r,a);if(problem)return problem;const c=appointment(w,a.appointmentId)!;if(w.minute<=c.start)return null;const b=site(w,c.buildingId)!;if(!same(r.at,b.door)||r.inside!==b.id)return '须亲自抵达预约的诊疗位置';w.health!.pulses.push({appointmentId:c.id,personId:r.id,from:Math.max(c.start,w.minute-dt),to:Math.min(c.end,w.minute)});return null;}
export function advanceHealth(w:World,dt:number){initializeHealth(w);const s=w.health;if(!s)return;
 for(const c of s.cases){if(c.stage==='resolved')continue;const r=person(w,c.personId);if(!r||r.status!=='alive')continue;const elapsed=Math.max(0,w.minute-c.lastAt),rules=c.rules!;c.lastAt=w.minute;
  const resting=r.activity?.action.type==='sleep'&&!r.activity.path.length&&!r.activity.room?.path.length,wellFed=r.hunger<80&&r.energy>15;
  const recovery=(c.treatment>0?rules.treatedDaily:0)+(wellFed?(c.kind==='injury'?rules.fedInjuryDaily:rules.fedIllnessDaily):0)+(resting?rules.sleepDaily:0);c.severity=Math.max(0,Math.min(100,c.severity+(wellFed?0:rules.badDaySeverity)*elapsed/DAY-recovery*elapsed/DAY));
  if(c.severity>=rules.criticalSeverity||r.health<=rules.criticalHealth){c.stage='critical';if(!c.capacity&&r.canDecide&&r.canExpress){c.capacity={decide:true,express:true};r.canDecide=false;r.canExpress=false;r.plan=null;r.activity=null;r.revision++;}r.health=Math.max(0,r.health-elapsed*rules.criticalDrain);}
  else {if(c.treatment>0)c.stage='recovering';if(c.capacity&&c.severity<rules.regainSeverity&&r.health>rules.regainHealth&&activeCases(w,r.id).every(other=>other.severity<(other.rules?.regainSeverity??60))){r.canDecide=c.capacity.decide;r.canExpress=c.capacity.express;c.capacity=null;r.decisionDue=w.minute;r.revision++;fact(w,r,`${r.name}恢复了对当下事项作决定和表达意愿的能力。`);}}
  if(c.severity<=.001&&!c.capacity){c.stage='resolved';c.resolvedAt=w.minute;s.totals.recovered++;fact(w,r,`${r.name}的这次${c.kind==='injury'?'损伤':'疾病'}完成了实际康复。`);}
 }
 // Shared attendance is settled after all actors, avoiding iteration-order treatment.
 const pulses=s.pulses;s.pulses=[];
 for(const c of s.appointments){if(c.status!=='accepted'){if(c.status==='offered'&&c.start<=w.minute)finish(w,c,'expired','未获患者同意便到期');continue;}const doctor=person(w,c.doctorId),patient=person(w,c.patientId),b=site(w,c.buildingId);
  if(!capable(doctor)||!capable(patient)||patient.refusesCare||doctor.skills.care<(c.rules?.minimumCare??1)||!b||b.condition<=0){finish(w,c,'cancelled','医生、患者或场所无法继续');continue;}
  const d=pulses.find(p=>p.appointmentId===c.id&&p.personId===c.doctorId),p=pulses.find(p=>p.appointmentId===c.id&&p.personId===c.patientId);let shared=d&&p?Math.min(c.minutes-c.worked,Math.max(0,Math.min(d.to,p.to,c.end)-Math.max(d.from,p.from,c.start))):0;
  if(c.lastAt>=w.minute-1e-9)shared=0;if(shared>0){if(!c.materialsUsed){if((c.stock.medicine??0)<c.rules!.medicine||(c.stock.water??0)<c.rules!.water){finish(w,c,'cancelled','预留治疗材料不足');continue;}c.stock={};c.materialsUsed=true;}c.lastAt=w.minute;c.worked+=shared;applyMedicine(w,patient,c.rules!.medicineEffect*shared/c.minutes);const earned=Math.floor(c.fee*c.worked/c.minutes+1e-8),due=earned-c.paid;payment(w,c.account,account(w,c.doctorId),due,'实际共同到场的诊疗报酬',`${c.id}:earned:${earned}`);c.paid=earned;s.totals.paid+=due;doctor.skills.care+=shared/6000;}
  if(c.worked>=c.minutes-1e-8){fact(w,patient,`${doctor.name}与${patient.name}实际共同完成${c.minutes}分钟诊疗，实付${c.paid}钱；治疗不代替后续康复。`,[doctor.id,patient.id]);finish(w,c,'completed','实际完成本次诊疗');}else if(c.end<=w.minute)finish(w,c,'expired','预约窗口已结束，只按实际治疗时间结算');
 }
 syncMedicalTransport(w);pruneTransportRecords(w);
 const day=Math.floor(w.minute/DAY);if(day>s.lastDay){s.lastDay=day;for(const r of w.residents)if(r.status==='alive'&&r.residency!=='outside'&&r.hunger>90&&r.energy<20&&!activeCases(w,r.id).some(c=>c.kind==='illness'))addHealthCase(w,r,'illness',25,'持续营养不足与过劳的实际身体暴露');}
 if(s.appointments.length>160)s.appointments=s.appointments.filter((a,i)=>['accepted','offered'].includes(a.status)||a.end>w.minute||i>=s.appointments.length-80);
}
export function hasHealthAssets(w:World,id:string){return !!w.health?.appointments.some(c=>['offered','accepted'].includes(c.status)&&(c.doctorId===id||c.patientId===id));}

export function healthDeadline(w:World,id:string){return Math.min(Infinity,...(w.health?.appointments??[]).filter(c=>c.status==='accepted'&&(c.doctorId===id||c.patientId===id)).map(c=>c.start));}

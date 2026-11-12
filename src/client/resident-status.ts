import {ordinaryVisitorJourney} from '../shared/visitor-journey.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import type {Action,Resident,World,WorldEvent} from '../shared/types.js';
import type {DecisionProtection} from '../shared/decision-protection.js';
import {actionRoom,sleepBuilding} from '../shared/rooms.js';
import {calendar} from '../world/time.js';
import {atActionPosition as atWork} from './action-position.js';

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const minutes=(value:number)=>Math.max(0,Math.ceil(value));
const number=(value:number)=>value.toFixed(2);
const actions:Record<Action['type'],string>={socialAppointment:'日常约见',shareFoodSource:'当面分享亲见浆果地址',personalFoodGift:'个人赠粮',adultPresence:'有限非侵入式在场',visitorJourney:'分段访谷行程',lastWish:'生前遗嘱与安葬意愿',pregnancyPreparation:'孕期准备与陪伴',regionSurvey:'边界勘察与接入',waterSupply:'安全水供给',landRights:'勘察与用地议决',businessRelocation:'经营迁址',premises:'场所租赁',emergencyCare:'限时儿童照护',outsideAid:'驿路食品求助',commons:'共屋自助',move:'行走',wait:'自选停留',gather:'采集',plant:'播种',water:'浇水',harvest:'收获',eat:'进食',sleep:'睡眠',cook:'烹饪',talk:'交谈',build:'施工',construction:'建设工程',industry:'产业劳作',health:'诊疗与救援',longCare:'托育与长期照护',funerary:'安置与纪念',education:'教学与学习',offer:'商谈交易',accept:'确认交易',care:'照料',learn:'学习',propose:'提出约定',respond:'回应约定',separate:'结束伴侣关系',bury:'安葬',leave:'离开山谷',settle:'登记定居',lodge:'借住',employment:'雇佣工作',foreignTrade:'镇外贸易',economy:'经营交易',civic:'公共事务',production:'生产与家业',publicDuty:'公共岗位',tendChild:'照料孩子',fosterChild:'接任监护',familyConsent:'确认监护',inviteHome:'邀请同住',homeReply:'回应同住',travelWithFamily:'结伴迁居',travelToValley:'前往山谷',stayOutside:'留在镇外',promise:'查看或撤回承诺',culture:'节庆与纪念',social:'相处与交流',household:'共同生活钱物',debt:'借款与清算',adoption:'收养安排',familyRelocation:'家庭迁居',agency:'自主生活安排',buildingMigration:'房屋改建',ferry:'渡运',frontierHazard:'应对野外险情',design:'构想与试作'};
export function actionLabel(action:Action):string{
 if(action.type==='socialAppointment')return {offer:'当面提出日常约见',accept:'独立接受约见',decline:'独立拒绝约见',withdraw:'撤回本人约见',attend:'亲自赴约',wait:'自主等待约见'}[action.operation];
 if(action.type==='personalFoodGift')return {offer:'提出个人赠粮',accept:'独立接受赠粮',deliver:'亲自送交食物',return:'自主返回赠粮交接点',cancel:'撤回个人赠粮',decline:'拒绝或撤回接受赠粮'}[action.operation];
 if(action.type==='adultPresence')return {verify:'救援后现场核实',stay:'限时非侵入式在场',stop:'停止本次在场',stopVerification:'停止本次现场核实'}[action.operation];
 if(action.type==='industry')return ({cutTree:'砍伐果树',plantTree:'种植果树',tendTree:'浇护果树',harvestFruit:'采收水果',plantHouse:'温室播种',tendHouse:'温室浇水',harvestHouse:'温室收获',mine:'采矿',deepen:'开凿矿井',fish:'垂钓',hunt:'持矛打猎',tameAnimal:'驯养野鸭',shoreRest:'河岸休息',feedAnimal:'喂养动物',waterAnimal:'给动物饮水',collectAnimal:'收取畜产',moveAnimal:'带领动物'} as Record<string,string>)[action.operation]??actions.industry;
 if(action.type==='production')return ({plantCrop:'播种作物',clearPlot:'清理田地',claimPlot:'认领田地',fertilize:'施肥',collectManure:'收集肥料',custodyWater:'代管浇水',custodyHarvest:'代管收获',repair:'修缮房屋',custodyRepair:'代管修缮'} as Record<string,string>)[action.operation]??actions.production;
 if(action.type==='frontierHazard')return {shelter:'入屋避险',retreat:'退避野外险情',repair:'修护受损房屋',clearSpring:'清理淤塞泉水'}[action.operation];
 return actions[action.type];
}
export type ResidentActivityKind='dead'|'outside'|'travelling'|'sleeping'|'voluntary-wait'|'fulfillment-wait'|'active'|'ready'|'decision-wait'|'scheduled'|'incapable';
export interface ResidentActivityStatus {kind:ResidentActivityKind;label:string;detail:string;startedAt?:number;remaining?:number;}
/** A recorded pause takes precedence over inferring work from co-presence alone. */
function recordedWait(w:World,r:Resident):{label:string;detail:string}|null{
 const a=r.activity!.action;
 if(a.type==='education'&&(a.operation==='teach'||a.operation==='study')){
  const lesson=w.education?.lessons.find(l=>l.id===a.lessonId&&l.status==='scheduled');
  if(lesson?.pauseReason)return {label:'等待教学条件恢复',detail:`课程已记录暂停：${lesson.pauseReason}。实际在场不等于已经产生教学进度。`};
 }
 if(a.type==='construction'&&a.operation==='work'){
  const project=w.construction?.projects.find(p=>p.id===a.projectId&&p.status==='paused');
  if(project)return {label:'等待复工',detail:`工程已暂停：${project.reason??'等待负责人重新决定施工'}。已有行动安排不等于工程仍在推进。`};
 }
 return null;
}
function fulfillmentWait(w:World,r:Resident):string|null{
 const a=r.activity!.action;
 if(a.type==='health'&&(a.operation==='treat'||a.operation==='receive')){
  const appointment=w.health?.appointments.find(c=>c.id===a.appointmentId&&c.status==='accepted');
  if(!appointment)return null;
  if(w.minute<appointment.start)return `已到诊疗位置，距预约开始还有 ${minutes(appointment.start-w.minute)} 游戏分钟。`;
  const otherId=a.operation==='treat'?appointment.patientId:appointment.doctorId;
  const other=w.residents.find(p=>p.id===otherId),otherAction=other?.activity?.action;
  if(!other||!atWork(w,other)||otherAction?.type!=='health'||otherAction.appointmentId!==appointment.id||otherAction.operation!==(a.operation==='treat'?'receive':'treat'))return `已到诊疗位置，等待${other?.name??'另一方'}实际参与本次诊疗；尚不能计作共同治疗。`;
 }
 if(a.type==='education'&&(a.operation==='teach'||a.operation==='study')){
  const lesson=w.education?.lessons.find(l=>l.id===a.lessonId&&l.status==='scheduled');
  if(!lesson)return null;
  if(w.minute<lesson.start)return `已到课堂，距开课还有 ${minutes(lesson.start-w.minute)} 游戏分钟。`;
  const participants=w.residents.filter(p=>a.operation==='study'?p.id===lesson.teacherId:lesson.enrollments.some(e=>e.learnerId===p.id&&e.status==='enrolled'));
  if(!participants.some(p=>{const other=p.activity?.action;return atWork(w,p)&&other?.type==='education'&&other.lessonId===lesson.id&&other.operation===(a.operation==='study'?'teach':'study');}))return a.operation==='study'?'已到课堂，等待教师实际授课。':'已到课堂，等待已报名的学生实际参与。';
 }
 if(a.type==='publicDuty'&&a.operation==='attend'){
  const shift=w.duties?.shifts.find(s=>s.id===a.shiftId);
  if(shift&&w.minute<shift.start)return `已到岗位，距班次开始还有 ${minutes(shift.start-w.minute)} 游戏分钟。`;
 }
 return null;
}
/** Global pause is deliberately separate from this resident's individual activity. */
export function residentActivity(w:World,r:Resident):ResidentActivityStatus{
 if(r.status==='dead')return {kind:'dead',label:'已故',detail:'保留人物生平与已经发生的记录。'};
 if(r.residency==='outside'){const visit=ordinaryVisitorJourney(w,r);if(visit)return {kind:!r.canDecide||!r.canExpress||r.health<=0?'incapable':visit.pause?visit.pause.kind==='rest'?'voluntary-wait':'active':visit.family?.ready?'voluntary-wait':visit.status==='waiting'?'decision-wait':'travelling',label:!r.canDecide||!r.canExpress||r.health<=0?'驿路失能停步，尚无照护接班':visit.pause?visit.pause.kind==='rest'?'镇外原地休息':'镇外停步进食':visit.family?.ready?'已同意下一段，限时等待亲属':visit.status==='waiting'?'驿路等待本人决定':visit.direction==='valley'?'分段前往谷口':'原路返回居地',detail:`${visit.family?'成人亲属同行。':''}离谷口 ${Number(visit.progress.toFixed(1))} / ${visit.duration} 分钟路程，本段剩余 ${minutes(visit.pause?.remaining??visit.stageRemaining)} 游戏分钟。${visit.reason??'只执行本人选择的一段，不自动续程。'}`};const mail=w.outsideAid?.visitorJourneys?.find(j=>j.personId===r.id&&['travelling','waiting'].includes(j.status));if(mail?.pause)return {kind:mail.pause.kind==='rest'?'voluntary-wait':'active',label:mail.pause.kind==='rest'?'镇外原地休息':'镇外停步进食',detail:`实际位置不变，还需 ${minutes(mail.pause.remaining)} 游戏分钟。${mail.reason??''}`,remaining:minutes(mail.pause.remaining)};if(mail)return {kind:mail.status==='waiting'?'fulfillment-wait':'travelling',label:mail.status==='waiting'?'捎信旅程暂停':mail.direction==='return'?'携信折返谷口':'捎信返回原居地',detail:`离谷口已有 ${Number(mail.progress.toFixed(1))} / ${mail.duration} 游戏分钟路程。${mail.reason??'原信随本人在途中，尚未交付；住宿与援助须另行决定。'}`};return {kind:'outside',label:'镇外生活',detail:'当前不在山谷内。'};}
 const escort=familyPassenger(w,r.id);
 if(escort)return {kind:'travelling',label:'家人接送途中',detail:'监护人正沿实际室内外路线接送；原住宿未因此改变。'};
 const family=travellingFamily(w,r.id);
 if(family)return {kind:'travelling',label:'家庭同行途中',detail:'按各方分别接受的安排沿实际道路同行；原住宿保留到本人实际入住。',startedAt:family.startedAt??family.createdAt};
 const paused=w.familyRelocation?.agreements.find(c=>c.status==='paused'&&c.members.some(m=>m.personId===r.id)&&c.expiresAt>w.minute);
 if(paused&&!r.activity&&!r.plan)return {kind:'fulfillment-wait',label:'家庭同行已暂停',detail:paused.reason??'等待当事人重新决定；不自动换路或搬家。'};
 const transport=w.health?.transports.find(t=>t.patientId===r.id&&t.phase==='carrying');
 if(transport)return {kind:'travelling',label:'护送途中',detail:transport.evacuationDestination==='safe-ground'?'正在逐格撤向附近干地；没有预留床位或安排后续照护。':'正在被实际护送，尚未送达接收床位。',startedAt:transport.startedAt};
 const trip=w.ferries?.trips.find(t=>t.aboard.includes(r.id)&&['posted','sailing','held','docked'].includes(t.phase));
 if(trip){
  if(trip.phase==='sailing')return {kind:'travelling',label:'赶路 · 渡船航行中',detail:'本人仍在船上，随渡船沿实际水路前进。'};
  return {kind:'fulfillment-wait',label:trip.phase==='held'?'渡船停航等待':trip.phase==='docked'?'已靠泊，尚未下船':'在船上等待开航',detail:trip.reason??'尚未完成这段渡运；船上位置与已发生的航程保持原记录。'};
 }
 const a=r.activity;
 if(a){
  const remaining=minutes(a.remaining),base={startedAt:a.startedAt,remaining};
  if(a.action.type==='sleep'&&!a.path.length&&!a.room?.path.length&&a.room?.mode!=='exit'){
   const home=sleepBuilding(w,r,a.action);
   if(!home||w.rooms&&!actionRoom(w,r,a))return {...base,kind:'ready',label:'睡眠位置待核验',detail:'已有睡眠安排，但当前记录没有可确认的可用床位；不记作实际睡眠。'};
   if(!w.rooms&&r.inside!==home.id)return {...base,kind:'travelling',label:'赶路 · 前往床位',detail:'尚未记录实际进入可用睡眠位置。'};
  }
  if(!atWork(w,r))return {...base,kind:'travelling',label:a.room?.mode==='exit'?'赶路 · 正离开室内':a.action.type==='sleep'?'赶路 · 前往床位':`赶路 · 前往${actionLabel(a.action)}地点`,detail:'正在沿实际路线到达行动位置；尚未计作现场行动。'};
  if(a.action.type==='sleep')return {...base,kind:'sleeping',label:`实际睡眠 · 还有 ${remaining} 游戏分钟`,detail:'已经到达可用睡眠位置，按本人选择的睡眠时长休息。'};
  const recorded=recordedWait(w,r);
  if(recorded)return {...base,kind:'fulfillment-wait',...recorded};
  const wait=fulfillmentWait(w,r);
  if(wait)return {...base,kind:'fulfillment-wait',label:'等待履约',detail:wait};
  if(a.action.type==='socialAppointment'&&a.action.operation==='wait')return {...base,kind:'voluntary-wait',label:`自主等候约见 · 还有 ${remaining} 游戏分钟`,detail:'本人已实际到场，按选择的时长等候；身体照常消耗。未见到不说明对方的远方情况，相遇也不会自动结束本段等待。'};
  if(a.action.type==='wait')return {...base,kind:'voluntary-wait',label:`自选停留 · 还有 ${remaining} 游戏分钟`,detail:'这是本人选择的等待，照常承担生理消耗，不属于等待模型决定的保护。'};
  return {...base,kind:'active',label:`正在${actionLabel(a.action)}`,detail:`已到行动位置；本段还需 ${remaining} 游戏分钟。共同进度仍以实际结算记录为准。`};
 }
 if(!r.canDecide||!r.canExpress)return {kind:'incapable',label:'当前无法自主决定',detail:'决定或表达能力受限，不记为等待模型回复。'};
 if(r.plan)return {kind:'ready',label:'准备行动',detail:'已有自主安排，下一项行动尚未开始。'};
 if(r.decisionDue>w.minute)return {kind:'scheduled',label:'尚未到下次决定时刻',detail:`距下次决定时刻还有 ${minutes(r.decisionDue-w.minute)} 游戏分钟；没有据此推定为自选停留。`};
 return {kind:'decision-wait',label:'等待自主决定',detail:w.metrics.inFlight.includes(r.id)?'正在等待有效决定回复。':'尚未获得可执行的新决定，等待调度或重试。'};
}
export function worldClockStatus(w:World):{label:string;detail:string}{
 return w.clock.paused?{label:'全镇停表',detail:w.clock.reason??'等待自主决策恢复，世界时间暂不推进。'}:{label:'世界继续推进',detail:'个人等待不等于全镇停表，其他居民与世界仍按实际规则推进。'};
}
function dateTime(at:number){const t=calendar(at);return `第 ${t.year} 年 ${{spring:'春',summer:'夏',autumn:'秋',winter:'冬'}[t.season]}${t.day}日 ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`;}
const reasons:Record<NonNullable<DecisionProtection['reason']>,string>={decision:'自主行动已开始',expired:'原保护期限已到',unavailable:'已无及时自救路径',incapable:'已无法自主行动',recovered:'实际补给或休息后脱离危急'};
function facts(rows:Array<[string,string]>){return `<dl class="status-facts">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;}
function bodyValues(value:DecisionProtection['before']){return `健康 ${number(value.health)} · 饥饿 ${number(value.hunger)} · 体力 ${number(value.energy)}`;}
function protectionFacts(state:DecisionProtection){return facts([
 ['保护开始',dateTime(state.startedAt)],['原定截止',dateTime(state.expiresAt)],
 ...(state.endedAt===null?[]:[['实际结束',`${dateTime(state.endedAt)} · ${state.reason?reasons[state.reason]:'原因未记录'}`] as [string,string]]),
 ['开始前',bodyValues(state.before)],
 ['暂缓健康损失',`饥饿 ${number(state.prevented.hunger)} · 耗竭 ${number(state.prevented.exhaustion)}`],
 ['期间记录的健康损失',`饥饿 ${number(state.losses.hunger)} · 耗竭 ${number(state.losses.exhaustion)} · 伤病 ${number(state.losses.illnessOrInjury)} · 野兽与灾害 ${number(state.losses.hazard)}`],
 ...(state.recoveredAt===null?[]:[['危机解除',dateTime(state.recoveredAt)] as [string,string]]),
 ]);}
export function protectionSummary(w:World,r:Resident):string{
 const state=r.decisionProtection;if(!state)return '';
 return state.endedAt===null&&state.expiresAt>w.minute?`决策保护中 · 还余 ${minutes(state.expiresAt-w.minute)} 游戏分钟`:state.endedAt===null?'决策保护期限已到':`决策保护已结束 · ${state.reason?reasons[state.reason]:'原因未记录'}`;
}
export function protectionEventDetails(event:WorldEvent):string{
 const record=event.decisionProtection;if(!record)return '';
 return `<section class="protection-record" aria-label="这次决策保护的记录">${protectionFacts(record.state)}${facts([[record.phase==='ended'?'结束时':'开始时',bodyValues(record.after)]])}<p class="footnote">仅列这次保护期间记录的损失；不是完整健康账目，也不据此推断死因。</p></section>`;
}
export function socialAppointmentProfile(w:World,r:Resident):string{
 const records=(w.socialAppointments?.records??[]).filter(c=>c.proposerId===r.id||c.personId===r.id).slice(-6).reverse();
 if(!records.length)return '';
 const labels={offered:'提议待答复',accepted:'双方已接受',declined:'已拒绝',withdrawn:'已撤回',met:'真实相遇',elapsed:'原窗口已过'};
 return `<section class="social-appointments" aria-label="日常约见"><h3 class="section-label">日常约见</h3><p class="footnote">观察者记录。本人仅知道自己实际收到的消息；远方撤回和缺席原因不会自动传知。</p>${records.map(c=>{
  const other=w.residents.find(p=>p.id===(r.id===c.proposerId?c.personId:c.proposerId));
  const visits=c.visits.filter(v=>v.personId===r.id),last=visits.at(-1);
  return `<article>${facts([['约见对象',other?.name??'原当事人'],['固定地点',`${c.placeName} (${c.place.x},${c.place.y})`],['约见窗口',`${dateTime(c.start)} 至 ${dateTime(c.end)}`],['世界记录',labels[c.status]],['本人最后获知',labels[c.known[r.id]]??'未知'],['本人实际赴约',last?`${dateTime(last.arrivedAt)} 到场${last.leftAt===null?'，这次在场尚未结束':`，${dateTime(last.leftAt)}结束在场`}`:'尚无实际赴约记录'],['本人实际选择等候',`${visits.reduce((n,v)=>n+v.waitedMinutes,0)} 游戏分钟`],['实际共同到场',c.metAt===null?'未记录双方在窗口内共同赴约':dateTime(c.metAt)]])}</article>`;
 }).join('')}</section>`;
}
export function residentStatusProfile(w:World,r:Resident):string{
 const status=residentActivity(w,r),clock=worldClockStatus(w),state=r.decisionProtection;
 const endRecord=state&&w.events.find(e=>e.actors.includes(r.id)&&e.decisionProtection?.phase==='ended'&&e.decisionProtection.state.startedAt===state.startedAt);
 return `${socialAppointmentProfile(w,r)}<section class="resident-status" aria-label="活动与决策保护"><h3 class="section-label">活动与世界时钟</h3><p><b>${esc(status.label)}</b><br>${esc(status.detail)}</p>${status.startedAt===undefined?'':facts([['本段安排开始',dateTime(status.startedAt)]])}<p class="clock-scope"><b>${esc(clock.label)}</b> · ${esc(clock.detail)}</p><h3 class="section-label">紧急决策保护</h3>${state?`<p><b>${esc(protectionSummary(w,r))}</b></p>${protectionFacts(state)}${endRecord?.decisionProtection?facts([['结束时',bodyValues(endRecord.decisionProtection.after)]]):state.endedAt===null?'':'<p class="footnote">结束时身体状态请查阅完整生平中的对应年表记录。</p>'}${facts([['当前身体',bodyValues(r)]])}<p class="footnote">仅暂缓饥饿与耗竭造成的新增健康损失，不补扣已暂缓量。伤病、野兽与灾害仍照常产生后果。以上损失仅限本次保护期间已记录的部分，不是完整健康账目或死因判断。剩余时间按游戏时钟计算，全镇停表时不减少。</p>`:'<p class="panel-intro">没有这位居民的决策保护记录；不据此推断过往损失。等待决定也不代表一定满足保护条件。</p>'}</section>`;
}

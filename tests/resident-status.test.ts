import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceEducation} from '../src/world/education.js';
import {advanceConstruction} from '../src/world/construction.js';
import {createWorld} from '../src/world/seed.js';
import {actionRoom,roomLayout} from '../src/shared/rooms.js';
import {residentActivity,residentStatusProfile,protectionSummary,protectionEventDetails,worldClockStatus} from '../src/client/resident-status.js';
import {archiveTimeline} from '../src/client/history.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import type {Action,Resident,Snapshot,World,WorldEvent} from '../src/shared/types.js';

function fixture(){const w=createWorld();w.clock.paused=false;return {w,r:w.residents[0]};}
function act(w:World,r:Resident,action:Action){r.activity={action,planId:'test-plan',startedAt:w.minute-10,remaining:20.2,path:[],target:{...r.at},definition:w.activeDefinitions['action/routine']};}
function protect(w:World,r:Resident){return r.decisionProtection={startedAt:w.minute-60,expiresAt:w.minute+120,endedAt:null,reason:null,recoveredAt:null,localDecisionsAtStart:1,before:{health:3,hunger:98,energy:5},prevented:{hunger:2.7,exhaustion:1.8},losses:{hunger:0,exhaustion:0,illnessOrInjury:.5,hazard:.25}};}
function endedEvent(w:World,r:Resident):WorldEvent{return {id:'protection-ended',at:w.minute,kind:'system',actors:[r.id],witnesses:[],place:{...r.at},text:'保护已结束',observerOnly:true,decisionProtection:{phase:'ended',state:structuredClone(r.decisionProtection!),after:{health:2.25,hunger:100,energy:3}}};}

test('decision waiting, queued plans, later decisions and incapacity are distinct',()=>{
 const {w,r}=fixture();
 assert.equal(residentActivity(w,r).kind,'decision-wait');
 w.metrics.inFlight=[r.id];assert.match(residentActivity(w,r).detail,/等待有效决定回复/);
 r.decisionDue=w.minute+30;assert.equal(residentActivity(w,r).kind,'scheduled');
 r.plan={id:'p',actorId:r.id,actorRevision:0,createdAt:w.minute,definition:'test',intention:'休息',actions:[{type:'wait',minutes:20}]};
 assert.equal(residentActivity(w,r).kind,'ready');
 r.canDecide=false;assert.equal(residentActivity(w,r).kind,'incapable');
 r.residency='outside';assert.equal(residentActivity(w,r).kind,'outside');
 r.status='dead';assert.equal(residentActivity(w,r).kind,'dead');
});

test('chosen waits retain their own remaining time and do not imply technical protection',()=>{
 const {w,r}=fixture();act(w,r,{type:'wait',minutes:30});w.metrics.inFlight=[r.id];
 assert.equal(residentActivity(w,r).kind,'voluntary-wait');assert.match(residentActivity(w,r).label,/还有 21 游戏分钟/);
 assert.equal(residentActivity(w,r).startedAt,w.minute-10);
 w.clock.paused=true;w.clock.reason='全镇未获得有效决定';
 assert.equal(residentActivity(w,r).kind,'voluntary-wait');
 assert.match(residentStatusProfile(w,r),/全镇停表/);assert.match(residentStatusProfile(w,r),/本人选择的等待/);
 assert.match(residentStatusProfile(w,r),/没有这位居民的决策保护记录/);
 r.activity!.remaining=-.1;assert.equal(residentActivity(w,r).remaining,0);
});

test('sleep navigation includes outdoor route, room entry and exit before actual sleep',()=>{
 const {w,r}=fixture(),home=w.buildings.find(b=>b.id===r.homeId)!;
 w.rooms={tick:w.minute,claims:[],beds:{}};
 act(w,r,{type:'sleep',minutes:60});r.activity!.target={...home.door};r.activity!.path=[{...home.door}];
 assert.equal(residentActivity(w,r).kind,'travelling');assert.match(residentActivity(w,r).label,/前往床位/);
 r.activity!.path=[];r.at={...home.door};
 assert.equal(residentActivity(w,r).kind,'travelling','standing at the door is not sleeping');
 r.inside=home.id;r.roomAt=roomLayout(w,home).entry;
 assert.equal(residentActivity(w,r).kind,'travelling','room entry is not the bed');
 r.roomAt={...actionRoom(w,r,r.activity!)!.target};
 const before=structuredClone(w);
 assert.equal(residentActivity(w,r).kind,'sleeping');
 assert.deepEqual(w,before,'reading a bed must not allocate or claim it');
 r.activity!.room={buildingId:home.id,mode:'exit',path:[],progress:0,target:{...r.roomAt}};
 assert.equal(residentActivity(w,r).kind,'travelling');assert.match(residentActivity(w,r).label,/离开室内/);
 delete r.activity!.room;home.capacity=0;
 assert.equal(residentActivity(w,r).kind,'ready');assert.match(residentActivity(w,r).label,/待核验/);
});

test('active work is separate from approaching an indoor work position',()=>{
 const {w,r}=fixture(),home=w.buildings.find(b=>b.id===r.homeId)!;w.rooms={tick:w.minute,claims:[],beds:{}};
 act(w,r,{type:'cook',quantity:1});r.activity!.target={...home.door};r.at={...home.door};
 assert.equal(residentActivity(w,r).kind,'travelling');
 r.inside=home.id;r.roomAt={...actionRoom(w,r,r.activity!)!.target};
 assert.equal(residentActivity(w,r).kind,'active');assert.equal(residentActivity(w,r).label,'正在烹饪');
});

test('actual appointment attendance waits for the other participant, not for a model',()=>{
 const {w,r}=fixture(),doctor=w.residents[1],home=w.buildings[0];
 r.at={...home.door};doctor.at={...home.door};
 w.health={cases:[],transportOffers:[],transports:[],pulses:[],nextSerial:1,lastDay:0,totals:{injuries:0,illnesses:0,recovered:0,treated:0,paid:0,refunded:0},appointments:[{id:'a',doctorId:doctor.id,patientId:r.id,buildingId:home.id,createdAt:w.minute-60,start:w.minute-30,end:w.minute+90,minutes:60,fee:0,account:'test',stock:{},status:'accepted',acceptedAt:w.minute-50,worked:0,paid:0,refunded:0,materialsUsed:false,lastAt:-1,reason:null}]};
 act(w,r,{type:'health',operation:'receive',appointmentId:'a'});
 assert.equal(residentActivity(w,r).kind,'fulfillment-wait');
 act(w,doctor,{type:'health',operation:'treat',appointmentId:'a'});
 assert.equal(residentActivity(w,r).kind,'active');
 doctor.activity!.path=[{...home.door}];assert.equal(residentActivity(w,r).kind,'fulfillment-wait');
 r.activity!.path=[{...home.door}];assert.equal(residentActivity(w,r).kind,'travelling');
});

test('early duty arrival is waiting for the agreed time, not already working',()=>{
 const {w,r}=fixture();act(w,r,{type:'publicDuty',operation:'attend',shiftId:'s'});
 w.duties={publishedThroughDay:0,shifts:[{id:'s',role:'care',buildingId:w.buildings[0].id,start:w.minute+30,end:w.minute+60,workerId:r.id,status:'booked',assignments:[],declinedBy:[],served:0,clientId:null}]};
 assert.equal(residentActivity(w,r).kind,'fulfillment-wait');assert.match(residentActivity(w,r).detail,/还有 30 游戏分钟/);
 w.minute+=30;assert.equal(residentActivity(w,r).kind,'active');
});

function classroomFixture(){
 const {w,r}=fixture(),teacher=w.residents[1];
 w.education={known:{},pulses:[],nextSerial:1,totals:{lessons:0,completed:0,minutes:0,paid:0,refunded:0},lessons:[{id:'lesson',teacherId:teacher.id,buildingId:w.buildings[0].id,subject:'farming',definition:'test',postedAt:w.minute-60,start:w.minute-10,end:w.minute+60,endedAt:null,status:'scheduled',reason:null,fee:0,capacity:4,teacherSkill:2,minutes:60,gain:.1,materials:{},materialsUsed:false,offers:[],nextSerial:1,funding:null,taught:0,lastAt:-1,pauseReason:null,enrollments:[{id:'seat',learnerId:r.id,seat:0,acceptedAt:w.minute-30,endedAt:null,settled:false,status:'enrolled',reason:null,payer:r.id,account:'test',reserved:0,paid:0,refunded:0,worked:0,gained:0}]}]};
 return {w,r,teacher,lesson:w.education.lessons[0]};
}

test('teaching requires an actual counterpart at the same lesson',()=>{
 const {w,r,teacher}=classroomFixture();
 act(w,r,{type:'education',operation:'study',lessonId:'lesson'});
 assert.equal(residentActivity(w,r).kind,'fulfillment-wait');
 act(w,teacher,{type:'education',operation:'teach',lessonId:'other'});assert.equal(residentActivity(w,r).kind,'fulfillment-wait');
 act(w,teacher,{type:'education',operation:'teach',lessonId:'lesson'});assert.equal(residentActivity(w,r).kind,'active');
 r.activity=null;assert.equal(residentActivity(w,teacher).kind,'fulfillment-wait');
});

test('settled teaching-material pauses override co-presence and clear only when the lesson resumes',()=>{
 const {w,r,teacher,lesson}=classroomFixture(),hall=w.buildings.find(b=>b.kind==='lodge')!;
 w.mode='formal';lesson.buildingId=hall.id;lesson.materials={seed:1};
 teacher.at={...hall.door};r.at={...hall.door};teacher.inside=r.inside=hall.id;
 teacher.skills.farming=2;r.skills.farming=0;teacher.inventory.seed=0;
 act(w,teacher,{type:'education',operation:'teach',lessonId:lesson.id});
 act(w,r,{type:'education',operation:'study',lessonId:lesson.id});
 const settle=()=>{w.education!.pulses=[{lessonId:lesson.id,personId:teacher.id,role:'teach',from:w.minute-1,to:w.minute},{lessonId:lesson.id,personId:r.id,role:'study',from:w.minute-1,to:w.minute}];advanceEducation(w);};
 settle();assert.equal(lesson.pauseReason,'教师示范材料不足');assert.equal(lesson.taught,0);
 const before=structuredClone(w);
 for(const person of [teacher,r]){
  assert.equal(residentActivity(w,person).kind,'fulfillment-wait');
  assert.equal(residentActivity(w,person).label,'等待教学条件恢复');
  assert.match(residentActivity(w,person).detail,/教师示范材料不足/);
  assert.match(residentStatusProfile(w,person),/教师示范材料不足/);
 }
 assert.deepEqual(w,before,'rendering must not clear the recorded pause');
 r.activity!.path=[{...hall.door}];assert.equal(residentActivity(w,r).kind,'travelling');r.activity!.path=[];
 lesson.pauseReason='<img src=x onerror=alert(1)>';assert.match(residentStatusProfile(w,r),/&lt;img/);assert.doesNotMatch(residentStatusProfile(w,r),/<img/);
 teacher.inventory.seed=1;w.minute++;settle();assert.equal(lesson.pauseReason,null);assert.equal(lesson.taught,1);
 for(const person of [teacher,r])assert.equal(residentActivity(w,person).kind,'active');
});

test('a project paused after this ticks work is shown as waiting for restart, not active work',()=>{
 const {w,r}=fixture();act(w,r,{type:'construction',operation:'work',projectId:'project',minutes:30});
 w.construction={projects:[{id:'project',name:'测试工程',mode:'new',ownerId:r.id,managerId:r.id,kind:'home',definition:'test',ruleVersion:1,at:{...r.at},width:4,height:4,door:{...r.at},base:null,capacity:2,buildingId:null,boardId:null,createdAt:w.minute-60,updatedAt:w.minute,finishedAt:null,authorizedUntil:null,status:'paused',reserved:true,reason:'公共授权到期，等待重新表决',stages:[],stage:0,incorporated:{},stock:[],claims:[],grants:[],account:'test',wagePerHour:0,prices:{},spentWages:0,spentSupplies:0,applications:[],workers:[],nextWorker:1,labor:[],demolitionMinutes:0,lastDemolitionAt:null}],nextSerial:1,yards:{},knownProjects:{},totals:{completed:0,expanded:0,labor:0,wages:0,procurement:0,demolished:0}};
 const project=w.construction.projects[0];w.mode='formal';project.status='active';project.reason=null;project.ownerId='commons';project.authorizedUntil=w.minute;
 advanceConstruction(w);assert.equal(project.status,'paused');assert.ok(r.activity,'world settlement leaves the old action until its next validation');
 assert.equal(residentActivity(w,r).kind,'fulfillment-wait');assert.equal(residentActivity(w,r).label,'等待复工');assert.match(residentActivity(w,r).detail,/公共授权到期/);
 r.activity!.path=[{...r.at}];assert.equal(residentActivity(w,r).kind,'travelling');r.activity!.path=[];
 w.construction.projects[0].status='active';w.construction.projects[0].reason=null;assert.equal(residentActivity(w,r).kind,'active');
});

test('carried residents and ferry passengers are in transit even during a chosen wait',()=>{
 const {w,r}=fixture();act(w,r,{type:'wait',minutes:30});
 w.ferries={boats:[],builds:[],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0},trips:[{id:'trip',boatId:'boat',operatorId:w.residents[1].id,sourceId:'a',destinationId:'b',headingId:'b',fare:0,departAt:w.minute-10,expiresAt:w.minute+60,capacity:3,phase:'sailing',seats:[],aboard:[r.id],pilotId:w.residents[1].id,path:[],progress:0,returned:false,arrivedAt:null,reason:null}]};
 assert.equal(residentActivity(w,r).kind,'travelling');assert.match(residentActivity(w,r).label,/渡船航行/);
 w.ferries.trips[0].phase='held';assert.equal(residentActivity(w,r).label,'渡船停航等待');
 w.ferries.trips[0].aboard=[];assert.equal(residentActivity(w,r).kind,'voluntary-wait');
 w.health={cases:[],appointments:[],transportOffers:[],pulses:[],nextSerial:1,lastDay:0,totals:{injuries:0,illnesses:0,recovered:0,treated:0,paid:0,refunded:0},transports:[{id:'rescue',carrierId:w.residents[1].id,patientId:r.id,buildingId:w.buildings[0].id,bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:w.minute-10,endedAt:null,reason:null}]};
 assert.equal(residentActivity(w,r).kind,'travelling');assert.equal(residentActivity(w,r).label,'护送途中');
});

test('protection has an original deadline, source attribution and separate global clock',()=>{
 const {w,r}=fixture();protect(w,r);r.health=2.25;
 const before=structuredClone(w),html=residentStatusProfile(w,r);
 assert.match(html,/还余 120 游戏分钟/);assert.match(html,/世界继续推进/);assert.match(html,/伤病 0.50/);assert.match(html,/野兽与灾害 0.25/);
 assert.match(html,/饥饿 2.70 · 耗竭 1.80/);assert.match(html,/开始前/);assert.match(html,/当前身体/);assert.match(html,/不是完整健康账目或死因判断/);
 assert.deepEqual(w,before,'the observer never mutates protection, routes or room claims');
 w.clock.paused=true;w.clock.reason='<img src=x onerror=alert(1)>';
 assert.match(residentStatusProfile(w,r),/全镇停表/);assert.match(residentStatusProfile(w,r),/&lt;img/);assert.doesNotMatch(residentStatusProfile(w,r),/<img/);
 assert.match(protectionSummary(w,r),/120/);w.minute+=120;assert.equal(protectionSummary(w,r),'决策保护期限已到');
});

test('ended records preserve the end snapshot, reason and original deadline in history',()=>{
 const {w,r}=fixture();protect(w,r);const state=r.decisionProtection!;
 state.endedAt=w.minute;state.reason='decision';state.recoveredAt=w.minute+5;
 const event=endedEvent(w,r);w.events.push(event);r.health=50;
 const html=residentStatusProfile(w,r);
 assert.match(html,/自主行动已开始/);assert.match(html,/结束时<\/dt><dd>健康 2.25/);assert.match(html,/当前身体<\/dt><dd>健康 50.00/);
 assert.match(protectionEventDetails(event),/伤病 0.50/);assert.match(archiveTimeline([event],w),/这次决策保护的记录/);
 for(const reason of ['expired','unavailable','incapable','recovered'] as const){state.reason=reason;assert.doesNotMatch(protectionSummary(w,r),/undefined|原因未记录/);}
 w.events=[];assert.match(residentStatusProfile(w,r),/结束时身体状态请查阅完整生平/);
});

test('reconnect and streamed protection updates render the same read-only status',()=>{
 const {w,r}=fixture();protect(w,r);
 const first:Snapshot={world:w,mapRevision:'map',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}};
 const next=structuredClone(first);next.world.revision++;next.world.minute+=30;next.world.residents[0].decisionProtection!.prevented.hunger=4;
 const combined=applyObserverUpdate(first,observerFrame(next,first))!;
 assert.equal(residentStatusProfile(combined.world,combined.world.residents[0]),residentStatusProfile(next.world,next.world.residents[0]));
 assert.equal(protectionSummary(combined.world,combined.world.residents[0]),'决策保护中 · 还余 90 游戏分钟');
 assert.deepEqual(worldClockStatus(combined.world),worldClockStatus(structuredClone(next.world)));
});

import {atWorkstation} from './helpers/workspaces.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Resident,World} from '../src/shared/types.js';
import type {EducationAction,Lesson} from '../src/shared/education.js';
import {initializeEducation,advanceEducation,educationReason,educationTarget,completeEducation,educationWorkError,educationConflict,authorizeEducation,teachingPosition,hasEducationAssets} from '../src/world/education.js';
import {educationOpportunities} from '../src/server/education-opportunities.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import {initializeCivic,completeCivic} from '../src/world/civic.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {recordDeath} from '../src/world/life.js';
import {educationPanel} from '../src/client/education.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {YEAR,DAY} from '../src/world/time.js';
function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;const [teacher,student,child]=w.residents;
 const hall=w.buildings.find(b=>b.kind==='lodge')!;
 for(const r of w.residents){r.at={...hall.door};r.inside=null;r.coins=100;r.skills={farming:0,building:0,care:0};r.inventory={wood:20,stone:20,seed:20,meal:20,water:20};r.bornAt=w.minute-25*YEAR;r.health=r.energy=100;r.hunger=0;r.knownBuildings=w.buildings.map(b=>b.id);r.knownPeople=w.residents.filter(p=>p.id!==r.id).map(p=>p.id);}
 teacher.skills={farming:2,building:2,care:2};child.bornAt=w.minute-9*YEAR;child.parents=[teacher.id];child.guardianIds=[teacher.id];
 initializeEducation(w);initializeCivic(w);initializeForeignTrade(w);return {w,teacher,student,child,hall};
}
function act(w:World,r:Resident,body:Omit<EducationAction,'type'>){const a:EducationAction={type:'education',...body};const route=educationTarget(w,r,a);assert.equal(route.error,undefined);r.at={...route.target};assert.equal(completeEducation(w,r,a),null);}
function course(f:ReturnType<typeof fixture>,extra:Partial<EducationAction>={}){
 act(f.w,f.teacher,{operation:'post',buildingId:f.hall.id,subject:'care',startsIn:60,windowMinutes:180,capacity:4,fee:6,...extra});return f.w.education!.lessons.at(-1)!;
}
function plan(w:World,r:Resident,action:EducationAction){assert.ok(submitPlan(w,{id:`class:${w.revision}:${r.id}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人明确的教学或学习选择',actions:[action]}).ok);}
function together(f:ReturnType<typeof fixture>,l:Lesson,minutes:number,who=[f.student]){const {w,teacher}=f;w.minute=Math.max(w.minute,l.start);atWorkstation(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes});for(const r of who)atWorkstation(w,r,{type:'education',operation:'study',lessonId:l.id,minutes});plan(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes});for(const r of who)plan(w,r,{type:'education',operation:'study',lessonId:l.id,minutes});stepWorld(w,minutes);}
test('publishing and enrollment cannot create learning or a teacher payment without independent attendance',()=>{
 const f=fixture(),{w,teacher,student}=f,l=course(f),money=totalCoins(w);act(w,student,{operation:'enroll',lessonId:l.id});assert.equal(student.coins,94);assert.equal(teacher.coins,100);
 w.minute=l.start;stepWorld(w,30);assert.equal(student.skills.care,0);assert.equal(l.enrollments[0].worked,0);assert.equal(totalCoins(w),money);
 plan(w,student,{type:'education',operation:'study',lessonId:l.id,minutes:30});stepWorld(w,30);assert.equal(student.skills.care,0);assert.equal(teacher.coins,100);assert.match(l.pauseReason!,/教师/);assert.equal(l.materialsUsed,false);
});
test('real co-presence transfers skill, spends demonstration materials once and pays proportionally',()=>{
 const f=fixture(),{w,teacher,student}=f,l=course(f),money=totalCoins(w);act(w,student,{operation:'enroll',lessonId:l.id});together(f,l,30);
 assert.ok(Math.abs(student.skills.care-.125)<1e-7);assert.equal(l.enrollments[0].paid,3);assert.equal(teacher.coins,103);assert.equal(teacher.inventory.meal,19);assert.equal(teacher.inventory.water,19);assert.equal(totalCoins(w),money);
 together(f,l,30);assert.equal(l.enrollments[0].status,'completed');assert.ok(Math.abs(student.skills.care-.25)<1e-7);assert.equal(teacher.coins,106);assert.equal(teacher.inventory.meal,19);assert.equal(accountBalance(w,l.enrollments[0].account),0);assert.equal(student.lastFailure,null);
});
test('children accept paid tuition sponsorship themselves and can leave without a debt or lost learning',()=>{
 const f=fixture(),{w,teacher,child}=f,l=course(f),money=totalCoins(w);
 assert.ok(educationReason(w,child,{type:'education',operation:'enroll',lessonId:l.id}));act(w,teacher,{operation:'sponsor',lessonId:l.id,learnerId:child.id});assert.equal(l.enrollments.length,0);const o=l.offers[0];assert.equal(teacher.coins,94);
 act(w,child,{operation:'enroll',lessonId:l.id,fundingId:o.id});assert.equal(child.coins,100);together(f,l,10,[child]);assert.equal(l.enrollments[0].paid,1);
 act(w,child,{operation:'withdraw',lessonId:l.id});advanceEducation(w);assert.equal(teacher.coins,100);assert.equal(l.enrollments[0].refunded,5);assert.ok(child.skills.care>0);assert.equal(totalCoins(w),money);
});
test('unaccepted tuition gifts can be refused by inaction or withdrawn; neither enrolls the learner',()=>{
 const f=fixture(),{w,teacher,child}=f,l=course(f);act(w,teacher,{operation:'sponsor',lessonId:l.id,learnerId:child.id});const o=l.offers[0];
 act(w,teacher,{operation:'withdrawSponsor',lessonId:l.id,fundingId:o.id});assert.equal(teacher.coins,100);assert.equal(l.enrollments.length,0);
 act(w,teacher,{operation:'sponsor',lessonId:l.id,learnerId:child.id});w.minute=l.offers[1].expiresAt;advanceEducation(w);assert.equal(l.offers[1].status,'expired');assert.equal(teacher.coins,100);
});
test('group learning, including the final tick, is independent of resident iteration order',()=>{
 const run=(reverse:boolean)=>{const f=fixture(),{w,student,child}=f,l=course(f,{fee:0});act(w,student,{operation:'enroll',lessonId:l.id});act(w,child,{operation:'enroll',lessonId:l.id});if(reverse)w.residents.reverse();together(f,l,60,[student,child]);return [student.skills.care,child.skills.care,l.taught,...l.enrollments.map(e=>e.worked)];};
 const a=run(false),b=run(true);assert.deepEqual(a,b);assert.ok(Math.abs(a[0]-.25)<1e-7);assert.equal(a[2],60);assert.equal(a[3],60);assert.equal(a[4],60);
});
test('missing teaching materials, different locations and mere teacher waiting cannot fabricate skill',()=>{
 const f=fixture(),{w,teacher,student}=f,l=course(f,{fee:0});act(w,student,{operation:'enroll',lessonId:l.id});teacher.inventory.meal=0;w.minute=l.start;
 assert.match(educationReason(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes:30})!,/材料/);
 const a:EducationAction={type:'education',operation:'study',lessonId:l.id,minutes:30};student.at={x:1,y:1};assert.match(educationWorkError(w,student,a,1)!,/抵达/);assert.equal(student.skills.care,0);
});
test('travel is not attendance and teacher absence pauses actual earning',()=>{
 const f=fixture(),{w,teacher,student,hall}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});student.at={x:hall.door.x+1,y:hall.door.y};w.minute=l.start;
 plan(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes:30});plan(w,student,{type:'education',operation:'study',lessonId:l.id,minutes:30});stepWorld(w,1);assert.equal(l.enrollments[0].worked,0);stepWorld(w,29);assert.ok(l.enrollments[0].worked>0&&l.enrollments[0].worked<29);assert.equal(l.enrollments[0].paid,Math.floor(l.enrollments[0].worked/10));
});
test('teacher cancellation and death refund only unearned fees and protect accumulated skills',()=>{
 for(const death of [false,true]){const f=fixture(),{w,teacher,student}=f,l=course(f),money=totalCoins(w);act(w,student,{operation:'enroll',lessonId:l.id});together(f,l,10);if(death)recordDeath(w,teacher);else act(w,teacher,{operation:'cancel',lessonId:l.id});advanceEducation(w);advanceEducation(w);assert.equal(l.enrollments[0].refunded,5);assert.equal(student.coins,99);assert.ok(student.skills.care>0);assert.equal(totalCoins(w),money);assert.equal(l.status,'cancelled');}
});
test('accepted child tuition survives sponsor death and only the learners withdrawal refunds the unused fee to the estate',()=>{
 const f=fixture(),{w,teacher,student,child}=f,l=course(f);act(w,student,{operation:'sponsor',lessonId:l.id,learnerId:child.id});act(w,child,{operation:'enroll',lessonId:l.id,fundingId:l.offers[0].id});together(f,l,10,[child]);recordDeath(w,student);assert.ok(hasEducationAssets(w,student.id));advanceEducation(w);assert.equal(l.enrollments[0].status,'enrolled');together(f,l,20,[child]);assert.equal(l.enrollments[0].paid,3);act(w,child,{operation:'withdraw',lessonId:l.id});advanceEducation(w);advanceEducation(w);assert.equal(hasEducationAssets(w,student.id),false);assert.equal(w.estates.find(e=>e.personId===student.id)!.coins,97);assert.equal(l.enrollments[0].refunded,3);assert.equal(teacher.coins,103);
});
test('classroom windows and jobs cannot reserve the same teacher, learner or shared workstation',()=>{
 const f=fixture(),{w,teacher,student,hall}=f,l=course(f);assert.ok(educationConflict(w,teacher.id,l.start,l.end));assert.ok(educationConflict(w,student.id,l.start,l.end,hall.id));act(w,student,{operation:'enroll',lessonId:l.id});assert.ok(educationConflict(w,student.id,l.start,l.end));
 assert.ok(educationReason(w,teacher,{type:'education',operation:'post',buildingId:hall.id,subject:'farming',startsIn:60,windowMinutes:180,fee:0,capacity:4}));
});
test('public tuition needs independent votes, real treasury cash and each students own enrollment',()=>{
 const f=fixture(),{w,teacher,student,child,hall}=f,l=course(f),money=totalCoins(w);assert.equal(completeCivic(w,teacher,{type:'civic',operation:'donate',buildingId:hall.id,amount:30}),null);
 assert.equal(completeCivic(w,teacher,{type:'civic',operation:'propose',buildingId:hall.id,measure:{kind:'education',buildingId:hall.id,lessonId:l.id,amount:24,durationDays:1}}),null);const p=w.civic!.proposals.at(-1)!;assert.equal(l.funding,null);
 for(const r of [teacher,student])assert.equal(completeCivic(w,r,{type:'civic',operation:'vote',proposalId:p.id,accept:true}),null);
 assert.equal(l.funding!.allocated,24);assert.equal(l.enrollments.length,0);act(w,child,{operation:'enroll',lessonId:l.id,fundingId:'public'});together(f,l,30,[child]);act(w,teacher,{operation:'cancel',lessonId:l.id});advanceEducation(w);assert.equal(w.economy!.treasury,27);assert.equal(teacher.coins,73);assert.equal(child.coins,100);assert.equal(totalCoins(w),money);
 assert.ok(authorizeEducation(w,l.id,24,1,'duplicate'));
});
test('course seats and 6-year minimum prevent forged capacity and inappropriate enrollment',()=>{
 const f=fixture(),{w,teacher,student,child}=f,l=course(f,{fee:0,capacity:1});act(w,student,{operation:'enroll',lessonId:l.id});assert.ok(educationReason(w,child,{type:'education',operation:'enroll',lessonId:l.id}));
 child.bornAt=w.minute-5*YEAR;assert.deepEqual(educationOpportunities(w,child),[]);assert.ok(educationReason(w,child,{type:'education',operation:'post',subject:'care'}));
 assert.ok(educationReason(w,teacher,{type:'education',operation:'enroll',lessonId:l.id}));
});
test('accepted courses freeze their content; restart preserves fees and actual progress',()=>{
 const f=fixture(),{w,teacher,student}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});together(f,l,20);const store=new WorldStore(':memory:');store.commit(w,null);const saved=store.load()!;store.close();
 saved.definitions['education/rules@2']={id:'education/rules',version:2,kind:'action',dependencies:[],data:{minutes:120,gain:.5,materials:{care:{meal:4}}}};saved.activeDefinitions['education/rules']='education/rules@2';initializeEducation(saved);assert.equal(saved.education!.lessons[0].minutes,60);assert.equal(saved.education!.lessons[0].enrollments[0].worked,20);assert.equal(saved.education!.lessons[0].enrollments[0].paid,2);assert.equal(saved.education!.pulses.length,0);
});
test('fractional simultaneous classroom attendance is replay safe and stops at completion',()=>{
 const f=fixture(),{w,teacher,student}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});w.minute=l.start;atWorkstation(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes:120});atWorkstation(w,student,{type:'education',operation:'study',lessonId:l.id,minutes:120});
 plan(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes:120});plan(w,student,{type:'education',operation:'study',lessonId:l.id,minutes:120});for(let i=0;i<601;i++)stepWorld(w,.1);
 assert.equal(l.enrollments[0].status,'completed');assert.equal(l.enrollments[0].paid,6);assert.equal(student.lastFailure,null);assert.equal(student.activity,null);const skill=student.skills.care;advanceEducation(w);assert.equal(student.skills.care,skill);
});
test('teacher skills are not inherited, but successive real courses can qualify a new care provider',()=>{
 const f=fixture(),{w,student}=f;for(let i=0;i<4;i++){const l=course(f,{fee:0});act(w,student,{operation:'enroll',lessonId:l.id});together(f,l,60);w.minute=l.end;advanceEducation(w);}
 assert.ok(student.skills.care>=1);assert.equal(w.education!.totals.completed,4);
});
test('actual model choices can set course terms but cannot substitute a teacher or student consent',()=>{
 const f=fixture(),{w,teacher}=f,menu=decisionChoices(decisionContext(w,teacher)),c=menu.find(c=>c.action.type==='education'&&c.action.operation==='post')!;assert.ok(c);
 const result=parseChoice(JSON.stringify({choice:c.id,fee:12,capacity:2,startsIn:240,windowMinutes:120}),menu);const a=result.actions[0] as EducationAction;assert.equal(a.fee,12);assert.equal(a.startsIn,240);
 assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,learnerId:f.child.id}),menu));assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,fee:-1}),menu));
});
test('teaching positions are tied to accepted work, and observer pages cannot enroll or pay',()=>{
 const f=fixture(),{w,teacher,student}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});w.minute=l.start;plan(w,teacher,{type:'education',operation:'teach',lessonId:l.id,minutes:30});plan(w,student,{type:'education',operation:'study',lessonId:l.id,minutes:30});stepWorld(w,1);
 assert.deepEqual(teachingPosition(w,teacher.id),{x:128,y:96});assert.deepEqual(teachingPosition(w,student.id),{x:96,y:130});teacher.name='<img src=x onerror=x>';
 const html=educationPanel(w);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(!/<form|<input|<select|data-action=/.test(html));
});
test('upgrading an existing save adds no classes or skills without a model choice',()=>{
 const f=fixture(),{w}=f,skills=structuredClone(w.residents.map(r=>r.skills)),money=totalCoins(w);const store=new WorldStore(':memory:');store.commit(w,null);const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
 try{assert.deepEqual(runtime.world.residents.map(r=>r.skills),skills);assert.equal(runtime.world.education!.lessons.length,0);assert.equal(totalCoins(runtime.world),money);}finally{runtime.stop();store.close();}
});

test('an unobserved teacher death refunds tuition without canceling a distant students existing walk or announcing the remote cause at the school',()=>{const f=fixture(),{w,teacher,student,hall}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});w.resources=[];w.minute=l.start;student.at={...w.map.entrance};student.inside=null;student.roomAt=null;teacher.at={...hall.door};teacher.inside=hall.id;teacher.roomAt={x:2,y:2};plan(w,student,{type:'education',operation:'study',lessonId:l.id,minutes:30});stepWorld(w,.01);assert.ok(student.activity!.path.length>5);const before=structuredClone(student.activity),planId=student.plan!.id;teacher.at={x:w.map.width-2,y:w.map.height-2};teacher.inside=null;teacher.roomAt=null;recordDeath(w,teacher);advanceEducation(w);assert.equal(l.status,'cancelled');assert.equal(l.enrollments[0].refunded,6);assert.deepEqual(student.activity,before);assert.equal(student.plan!.id,planId);const e=[...w.events].reverse().find(e=>e.kind==='education')!;assert.equal(e.observerOnly,true);assert.deepEqual(e.witnesses,[]);assert.ok(!student.memories.some(m=>m.eventId===e.id));});

import {knownPromises,promiseOpportunities} from '../src/world/known-promises.js';
test('a remote student retains original accepted class terms and the same check-or-withdraw choices after an unknown teacher death',()=>{const f=fixture(),{w,teacher,student,hall}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});student.at={...w.map.entrance};student.inside=null;teacher.at={...hall.door};teacher.inside=hall.id;const before=promiseOpportunities(w,student);assert.equal(before.length,2);recordDeath(w,teacher);advanceEducation(w);assert.equal(l.status,'cancelled');assert.deepEqual(promiseOpportunities(w,student),before);assert.equal(knownPromises(w,student)[0].until,l.end);w.minute=l.end;assert.equal(knownPromises(w,student).length,0);});

test('a teacher who actually leaves the town stops lessons and returns unearned tuition without advancing absent students',()=>{const f=fixture(),{w,teacher,student}=f,l=course(f);act(w,student,{operation:'enroll',lessonId:l.id});teacher.residency='outside';teacher.homeId=null;w.minute=l.start;advanceEducation(w);assert.equal(l.status,'cancelled');assert.equal(l.taught,0);assert.equal(student.skills.care,0);assert.equal(l.enrollments[0].refunded,6);assert.equal(student.coins,100);});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceEducation} from '../src/world/education.js';
import {advanceConstruction} from '../src/world/construction.js';
import {createWorld} from '../src/world/seed.js';
import type {Action,Resident,World} from '../src/shared/types.js';
function fixture(){const w=createWorld();w.clock.paused=false;return {w,r:w.residents[0]};}
function act(w:World,r:Resident,action:Action){r.activity={action,planId:'test-plan',startedAt:w.minute-10,remaining:20.2,path:[],target:{...r.at},definition:w.activeDefinitions['action/routine']};}
function classroomFixture(){
 const {w,r}=fixture(),teacher=w.residents[1];
 w.education={known:{},pulses:[],nextSerial:1,totals:{lessons:0,completed:0,minutes:0,paid:0,refunded:0},lessons:[{id:'lesson',teacherId:teacher.id,buildingId:w.buildings[0].id,subject:'farming',definition:'test',postedAt:w.minute-60,start:w.minute-10,end:w.minute+60,endedAt:null,status:'scheduled',reason:null,fee:0,capacity:4,teacherSkill:2,minutes:60,gain:.1,materials:{},materialsUsed:false,offers:[],nextSerial:1,funding:null,taught:0,lastAt:-1,pauseReason:null,enrollments:[{id:'seat',learnerId:r.id,seat:0,acceptedAt:w.minute-30,endedAt:null,settled:false,status:'enrolled',reason:null,payer:r.id,account:'test',reserved:0,paid:0,refunded:0,worked:0,gained:0}]}]};
 return {w,r,teacher,lesson:w.education.lessons[0]};
}


test('teaching materials pause actual settlement and resume only after replenishment',()=>{
 const {w,r,teacher,lesson}=classroomFixture(),hall=w.buildings.find(b=>b.kind==='lodge')!;
 w.mode='formal';lesson.buildingId=hall.id;lesson.materials={seed:1};
 teacher.at={...hall.door};r.at={...hall.door};teacher.inside=r.inside=hall.id;
 teacher.skills.farming=2;r.skills.farming=0;teacher.inventory.seed=0;
 act(w,teacher,{type:'education',operation:'teach',lessonId:lesson.id});
 act(w,r,{type:'education',operation:'study',lessonId:lesson.id});
 const settle=()=>{w.education!.pulses=[{lessonId:lesson.id,personId:teacher.id,role:'teach',from:w.minute-1,to:w.minute},{lessonId:lesson.id,personId:r.id,role:'study',from:w.minute-1,to:w.minute}];advanceEducation(w);};
 settle();assert.equal(lesson.pauseReason,'教师示范材料不足');assert.equal(lesson.taught,0);
 teacher.inventory.seed=1;w.minute++;settle();assert.equal(lesson.pauseReason,null);assert.equal(lesson.taught,1);
});

test('expired public authorization pauses actual construction before the next resident validation',()=>{
 const {w,r}=fixture();act(w,r,{type:'construction',operation:'work',projectId:'project',minutes:30});
 w.construction={projects:[{id:'project',name:'测试工程',mode:'new',ownerId:r.id,managerId:r.id,kind:'home',definition:'test',ruleVersion:1,at:{...r.at},width:4,height:4,door:{...r.at},base:null,capacity:2,buildingId:null,boardId:null,createdAt:w.minute-60,updatedAt:w.minute,finishedAt:null,authorizedUntil:null,status:'paused',reserved:true,reason:'公共授权到期，等待重新表决',stages:[],stage:0,incorporated:{},stock:[],claims:[],grants:[],account:'test',wagePerHour:0,prices:{},spentWages:0,spentSupplies:0,applications:[],workers:[],nextWorker:1,labor:[],demolitionMinutes:0,lastDemolitionAt:null}],nextSerial:1,yards:{},knownProjects:{},totals:{completed:0,expanded:0,labor:0,wages:0,procurement:0,demolished:0}};
 const project=w.construction.projects[0];w.mode='formal';project.status='active';project.reason=null;project.ownerId='commons';project.authorizedUntil=w.minute;
 advanceConstruction(w);assert.equal(project.status,'paused');assert.ok(r.activity,'world settlement leaves the old action until its next validation');
});

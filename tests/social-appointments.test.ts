import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action} from '../src/shared/types.js';
import {parseChoice} from '../src/server/affordances.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {YEAR} from '../src/world/time.js';
import {accepted,choice,finish,fixture,menu,offered,queue,record,rows,run,seed,select} from './helpers/social-appointments.js';

test('formal seed5401: complete numbered choices, independent life, actual walking, wait, meet and separately chosen speech',()=>{
 const f=seed(),{w,r}=f,c=accepted(f,60,90),peer=w.residents.find(p=>p.id===c.personId)!;
 const relations=structuredClone(w.residents.map(p=>p.relations)),conversations=w.events.filter(e=>e.kind==='conversation').length;
 assert.equal(r.activity,null);assert.equal(peer.activity,null);assert.equal(c.visits.length,0);
 run(w,r,select(w,r,a=>a.type==='wait',{minutes:5}));run(w,peer,select(w,peer,a=>a.type==='wait',{minutes:5}));
 const start={...r.at};assert.equal(queue(w,r,choice(w,r,'attend')).ok,true);stepWorld(w,1);assert.ok(r.activity);assert.notDeepEqual(r.at,c.place);assert.ok(Math.abs(r.at.x-start.x)+Math.abs(r.at.y-start.y)<=1);finish(w,r);assert.deepEqual(r.at,c.place);
 run(w,peer,choice(w,peer,'attend'));assert.equal(c.status,'accepted');
 const minutes=Math.max(1,c.start-w.minute+5);assert.equal(queue(w,r,choice(w,r,'wait',{minutes})).ok,true);finish(w,r);
 assert.equal(c.status,'met');assert.equal(c.visits.find(v=>v.personId===r.id)!.waitedMinutes,minutes);assert.equal(r.lastFailure,null);
 assert.deepEqual(w.residents.map(p=>p.relations),relations);assert.equal(w.events.filter(e=>e.kind==='conversation').length,conversations);
 run(w,r,select(w,r,a=>a.type==='talk'&&a.targetId===peer.id&&a.tone==='neutral',{text:'现在我们各自走到了这里。'}));assert.equal(w.events.filter(e=>e.kind==='conversation'&&e.text.includes('现在我们各自走到了这里。')).length,1);assert.equal(w.metrics.requests,0);
});

test('offer timing is mandatory and safe-integer bounded at the final parser',()=>{
 const {w,r}=fixture(),p=menu(w,r),c=p.choices.find(c=>c.action.type==='socialAppointment'&&c.action.operation==='offer')!;assert.ok(c);
 for(const fields of [{},{startsIn:30},{windowMinutes:15},{startsIn:29,windowMinutes:15},{startsIn:2881,windowMinutes:15},{startsIn:30,windowMinutes:14},{startsIn:30,windowMinutes:121},{startsIn:30.5,windowMinutes:15}])assert.throws(()=>parseChoice(JSON.stringify({choice:c.id,...fields}),p.choices));
 for(const fields of [{startsIn:30,windowMinutes:15},{startsIn:2880,windowMinutes:120}])assert.equal(parseChoice(JSON.stringify({choice:c.id,...fields}),p.choices).actions[0].type,'socialAppointment');
});

test('explicit refusal and unanswered proposals do not create attendance or speech',()=>{
 for(const decline of [true,false]){const f=fixture(),c=offered(f);if(decline)run(f.w,f.peer,choice(f.w,f.peer,'decline'));else stepWorld(f.w,c.end-f.w.minute);assert.equal(c.status,decline?'declined':'elapsed');assert.equal(c.visits.length,0);assert.equal(c.metAt,null);assert.equal(f.w.events.filter(e=>e.kind==='conversation').length,0);}
});

test('accepted no-show expires without pretending absence causes or remote knowledge',()=>{
 const f=fixture(),c=accepted(f);run(f.w,f.r,choice(f.w,f.r,'attend'));stepWorld(f.w,c.end-f.w.minute);assert.equal(c.status,'elapsed');assert.equal(c.metAt,null);assert.equal(c.known[f.r.id],'accepted');assert.equal(c.known[f.peer.id],'accepted');assert.equal(c.visits.length,1);assert.equal(rows(f.w,f.peer).some(c=>c.action.type==='socialAppointment'&&c.action.operation==='attend'),false);
});

test('remote withdrawal preserves the other participant knowledge, memories, and numbered options',()=>{
 const f=fixture(),c=accepted(f);run(f.w,f.r,choice(f.w,f.r,'attend'));const before=rows(f.w,f.peer),memories=structuredClone(f.peer.memories),notes=decisionContext(f.w,f.peer).formal!.socialAppointmentNotes;
 run(f.w,f.r,choice(f.w,f.r,'withdraw'));assert.equal(c.status,'withdrawn');assert.equal(c.known[f.peer.id],'accepted');assert.deepEqual(rows(f.w,f.peer),before);assert.deepEqual(f.peer.memories,memories);assert.equal(decisionContext(f.w,f.peer).formal!.socialAppointmentNotes,notes);
});

test('blocked route cannot teleport or record a visit',()=>{
 const f=fixture(),c=accepted(f);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,1);for(let y=0;y<f.w.map.height;y++)f.w.map.tiles[y*f.w.map.width+15]='water';finish(f.w,f.r);assert.ok(f.r.lastFailure);assert.equal(c.visits.length,0);assert.ok(f.r.at.x<15);assert.equal(c.metAt,null);
});

test('wait requires its own bounded duration and accumulates actual work only',()=>{
 const f=fixture(),c=accepted(f);run(f.w,f.r,choice(f.w,f.r,'attend'));const p=menu(f.w,f.r),row=p.choices.find(c=>c.action.type==='socialAppointment'&&c.action.operation==='wait')!;assert.ok(row);for(const minutes of [undefined,0,121,1.2])assert.throws(()=>parseChoice(JSON.stringify({choice:row.id,minutes}),p.choices));
 assert.equal(queue(f.w,f.r,choice(f.w,f.r,'wait',{minutes:10})).ok,true);stepWorld(f.w,3);assert.equal(c.visits[0].waitedMinutes,3);finish(f.w,f.r);assert.equal(c.visits[0].waitedMinutes,10);
});

test('short memories and SQLite reload preserve the original appointment, walk and deadline',()=>{
 const f=fixture(),c=accepted(f);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,2);f.r.memories=[];f.peer.memories=[];const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,r=w.residents.find(p=>p.id===f.r.id)!;assert.deepEqual(record(w),c);assert.deepEqual(r.activity,f.r.activity);assert.ok(decisionContext(w,r).formal!.socialAppointmentNotes!.includes(c.id));finish(w,r);assert.equal(record(w).visits.length,1);assert.equal(record(w).start,c.start);assert.deepEqual(r.at,c.place);}finally{store.close();}
});

test('unknown-age and minor adults cannot offer or accept saved choices',()=>{
 for(const age of [NaN,17]){const f=fixture();f.peer.bornAt=Number.isNaN(age)?NaN:f.w.minute-age*YEAR;assert.equal(rows(f.w,f.r).length,0);assert.equal(rows(f.w,f.peer).length,0);}
 for(const age of [NaN,17]){const f=fixture(),c=offered(f),d=choice(f.w,f.peer,'accept');f.peer.bornAt=Number.isNaN(age)?NaN:f.w.minute-age*YEAR;const result=queue(f.w,f.peer,d);if(result.ok)finish(f.w,f.peer);assert.equal(c.status,'offered');}
});

test('acceptance does not interrupt an independently chosen ongoing activity',()=>{
 const f=fixture(),c=offered(f);assert.equal(queue(f.w,f.r,select(f.w,f.r,a=>a.type==='wait',{minutes:20})).ok,true);stepWorld(f.w,1);const action=structuredClone(f.r.activity!.action);run(f.w,f.peer,choice(f.w,f.peer,'accept'));assert.equal(c.status,'accepted');assert.deepEqual(f.r.activity!.action,action);assert.equal(c.visits.length,0);
});

test('saturated final menu retains complete bounded appointment response plus self-care',()=>{
 const f=fixture();offered(f);const context=decisionContext(f.w,f.peer);for(let n=0;n<200;n++)context.formal!.opportunities.push({id:'synthetic-'+n,label:'Synthetic work '+n,action:{type:'employment',operation:'work',contractId:'synthetic-'+n}});const p=prepareModelDecision(context,undefined,GLM_MODEL),appointments=p.choices.filter(c=>c.action.type==='socialAppointment');assert.deepEqual(appointments.map(c=>c.action.type==='socialAppointment'&&c.action.operation).sort(),['accept','decline']);assert.ok(p.choices.some(c=>c.action.type==='wait'));assert.ok(p.choices.length<80);assert.equal(new Set(p.choices.map(c=>c.id)).size,p.choices.length);
});

test('proposer cannot add a second unsettled offer, and unrelated actors cannot accept',()=>{
 const f=fixture(),c=offered(f);assert.equal(rows(f.w,f.r).some(c=>c.action.type==='socialAppointment'&&c.action.operation==='offer'),false);const d=choice(f.w,f.peer,'accept');assert.equal(queue(f.w,f.third,d).ok,false);assert.equal(c.status,'offered');
});

test('recipient may receive multiple offers while one complete record group rotates fairly',()=>{
 const f=fixture();f.third.at={...f.peer.at};const first=offered(f,300,90),recipient=f.w.residents.find(p=>p.id===first.personId)!,other=f.w.residents.find(p=>p!==f.r&&p!==recipient)!;
 run(f.w,f.r,select(f.w,f.r,a=>a.type==='move'&&a.to.x===25&&a.to.y===14));
 run(f.w,other,choice(f.w,other,'offer',{startsIn:300,windowMinutes:90}));assert.equal(record(f.w).personId,recipient.id);assert.equal(f.w.socialAppointments!.records.length,2);
 const seen=new Set<string>();for(let n=0;n<2;n++){const group=rows(f.w,recipient).map(c=>c.action).filter(a=>a.type==='socialAppointment');assert.ok(group.length>=1&&group.length<=2);const ids=group.map(a=>a.operation==='offer'?'unexpected':a.appointmentId);assert.equal(new Set(ids).size,1);ids.forEach(id=>seen.add(id));assert.ok(group.some(a=>a.operation==='decline'));assert.equal(group.some(a=>a.operation==='offer'),false);stepWorld(f.w,30);}assert.equal(seen.size,2);
});

test('leaving is a separately chosen ordinary walk, closes presence, and never schedules a return',()=>{
 const f=fixture(),c=accepted(f);run(f.w,f.r,choice(f.w,f.r,'attend'));run(f.w,f.r,select(f.w,f.r,a=>a.type==='move'&&(a.to.x!==c.place.x||a.to.y!==c.place.y)));assert.notDeepEqual(f.r.at,c.place);assert.notEqual(c.visits[0].leftAt,null);assert.equal(c.visits[0].waitedMinutes,0);assert.equal(f.r.activity,null);assert.equal(f.r.plan,null);assert.equal(c.metAt,null);
});

test('saved late attendance cannot create a meeting after the fixed window',()=>{
 const f=fixture(),c=accepted(f,30,15),d=choice(f.w,f.peer,'attend');stepWorld(f.w,c.end-f.w.minute);const before={...f.peer.at},result=queue(f.w,f.peer,d);if(result.ok)finish(f.w,f.peer);assert.equal(c.status,'elapsed');assert.equal(c.metAt,null);assert.equal(c.visits.length,0);assert.deepEqual(f.peer.at,before);
});

import {focusNames} from '../src/shared/agency.js';
import type {DecisionContext} from '../src/shared/types.js';
import {DEEPSEEK_MODEL,QWEN_MODEL} from '../src/server/model-completion.js';

/** Menu-only pressure: synthetic opportunities are never submitted as actions. */
function deepAppointmentPressure(c:DecisionContext){
 c.formal!.opportunities=c.formal!.opportunities.filter(row=>!(row.action.type==='social'&&row.action.operation==='interpret'));
 const add=(id:string,action:Action)=>c.formal!.opportunities.push({id,label:id,action});
 for(let n=0;n<160;n++){add(`pressure.work.${n}`,{type:'employment',operation:'work',contractId:`work-${n}`});add(`pressure.refusal.${n}`,{type:'respond',proposalId:`refusal-${n}`,accept:false});}
 for(let n=0;n<2;n++)add(`waterSource.pressure.${n}`,{type:'move',to:{x:n+1,y:1}});
 add('pressure.cooking',{type:'cook',quantity:1});
 for(let event=0;event<5;event++)for(let target=0;target<2;target++)add(`pressure.interpret.${event}.${target}`,{type:'social',operation:'interpret',eventId:`pressure-event-${event}`,targetId:`pressure-person-${target}`,text:'菜单压力测试，本人尚未选择理解',affection:0,trust:0,conflict:0});
 for(let n=0;n<2;n++)add(`foodSource.heard.pressure.${n}`,{type:'move',to:{x:n+2,y:2}});
 add('care.stop.pressure',{type:'health',operation:'cancelRescue',transportId:'pressure-transport'});
 add('personalFoodGift.stop.pressure',{type:'personalFoodGift',operation:'cancel',giftId:'pressure-gift'});
 const sample:DecisionContext['people'][number]=c.people[0]??{id:'pressure-template',name:'附近居民',at:{...c.actor.at},intention:'尚未选择',status:'alive',relation:null};for(let n=0;c.people.length<3;n++)c.people.push({...structuredClone(sample),id:`pressure-neighbor-${n}`,name:`附近居民${n}`,at:{...c.actor.at},talkEligible:true,talkDistance:1});
}

for(const stage of ['offer','reply','attend','wait'] as const)test(`deep saturation: ${stage} complete appointment group survives every focus with all restoration layers`,()=>{
 const f=fixture();let actor=f.r;
 if(stage==='reply'){offered(f,120,90);actor=f.peer;}else if(stage==='attend'||stage==='wait'){accepted(f,120,90);if(stage==='wait')run(f.w,f.r,choice(f.w,f.r,'attend'));}
 const expected=stage==='offer'?['offer']:stage==='reply'?['accept','decline']:stage==='attend'?['attend','withdraw']:['wait','withdraw'];
 // Existing context providers lazily initialize unrelated rule definitions once.
 decisionContext(f.w,actor);const worldBefore=structuredClone(f.w);
 for(const focus of [undefined,...Object.keys(focusNames)] as Array<keyof typeof focusNames|undefined>){
  const c=decisionContext(f.w,actor);c.actor.agency=focus?{focus,goals:[],routines:[],nextSerial:1}:undefined;deepAppointmentPressure(c);const before=structuredClone(c),p=prepareModelDecision(c,undefined,GLM_MODEL),again=prepareModelDecision(c,undefined,GLM_MODEL);
  assert.deepEqual(p,again,`${stage}/${focus}: same fixed clock is stable`);assert.deepEqual(c,before,'menu preparation is read-only');
  const appointment=p.choices.filter(row=>row.action.type==='socialAppointment');assert.deepEqual(appointment.map(row=>row.action.type==='socialAppointment'&&row.action.operation).sort(),expected,`${stage}/${focus}`);
  for(const label of ['care.stop.pressure','personalFoodGift.stop.pressure'])assert.ok(p.choices.some(row=>row.label===label),`${focus}: ${label}`);
  const ordinary=p.choices.filter(row=>!['care.stop.pressure','personalFoodGift.stop.pressure'].includes(row.label));assert.ok(ordinary.length<=82,`${stage}/${focus}: ordinary ${ordinary.length}`);
  assert.ok(p.choices.some(row=>row.action.type==='wait'));assert.ok(p.choices.some(row=>row.action.type==='eat'));
  assert.equal(p.choices.filter(row=>row.label.startsWith('waterSource.pressure.')).length,2);assert.equal(p.choices.filter(row=>row.action.type==='cook').length,1);assert.equal(p.choices.filter(row=>row.label.startsWith('foodSource.heard.pressure.')).length,2);
  assert.equal(p.choices.filter(row=>row.action.type==='social'&&row.action.operation==='interpret').length,10);
  const talks=p.choices.filter(row=>row.action.type==='talk');assert.equal(talks.length,9);for(const id of new Set(talks.map(row=>row.action.type==='talk'&&row.action.targetId)))assert.deepEqual(talks.filter(row=>row.action.type==='talk'&&row.action.targetId===id).map(row=>row.action.type==='talk'&&row.action.tone).sort(),['friendly','hostile','neutral']);
  assert.equal(new Set(p.choices.map(row=>row.id)).size,p.choices.length);
 }
 assert.deepEqual(f.w,worldBefore,'no menu read submits decisions or mutates the world');
});

test('all three local model prompts retain personal appointment summary independently of family-note clipping',()=>{
 const f=fixture(),record=accepted(f),c=decisionContext(f.w,f.r);c.formal!.familyNotes='家庭记录'.repeat(20000)+'FAMILY_TAIL_SHOULD_BE_CLIPPED';const notes=c.formal!.socialAppointmentNotes!;assert.ok(notes.includes(record.id));const before=structuredClone(c);
 for(const model of [QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL] as const){const p=prepareModelDecision(c,undefined,model),text=p.messages.map(m=>m.content).join('\n');assert.ok(text.includes('本人持久记得的日常约见（不是远程事实）'));assert.ok(text.includes(notes));assert.ok(!text.includes('FAMILY_TAIL_SHOULD_BE_CLIPPED'));assert.ok(p.choices.some(row=>row.action.type==='socialAppointment'&&row.action.operation==='attend'));}
 assert.deepEqual(c,before);assert.equal(f.w.metrics.requests,0);
});

test('tomorrow appointment survives actual overnight life and reload without automatic departure',()=>{
 const f=fixture();accepted(f,1440,90);let w=f.w,r=f.r,peer=f.peer;const original={start:record(w).start,end:record(w).end,place:{...record(w).place}};
 assert.equal(queue(w,r,select(w,r,a=>a.type==='wait',{minutes:720})).ok,true);stepWorld(w,720);assert.equal(r.activity,null);assert.equal(record(w).visits.length,0);
 const store=new WorldStore(':memory:');try{store.commit(w,null);w=store.load()!;r=w.residents.find(p=>p.id===r.id)!;peer=w.residents.find(p=>p.id===peer.id)!;}finally{store.close();}
 run(w,r,select(w,r,a=>a.type==='eat'&&a.item==='berry'));
 assert.equal(queue(w,peer,select(w,peer,a=>a.type==='wait',{minutes:700})).ok,true);stepWorld(w,700);assert.equal(peer.activity,null);assert.equal(record(w).visits.length,0);
 assert.deepEqual({start:record(w).start,end:record(w).end,place:record(w).place},original);assert.equal(r.status,'alive');assert.equal(peer.status,'alive');
 run(w,r,choice(w,r,'attend'));run(w,peer,choice(w,peer,'attend'));assert.equal(record(w).status,'met');assert.ok(record(w).metAt!>=original.start);assert.ok(record(w).metAt!<original.end);assert.equal(w.metrics.requests,0);
});


test('fractional clock preserves exact minimum and maximum original windows across binary rounding boundaries',()=>{
 for(const [minute,windowMinutes] of [[480.2,120],[480.3,15]]){
  const f=fixture();f.w.minute=minute;const c=offered(f,30,windowMinutes),terms={start:c.start,end:c.end};
  assert.notEqual(c.end-c.start,windowMinutes,'the fixture must exercise floating-point subtraction drift');
  assert.ok(rows(f.w,f.peer).some(row=>row.action.type==='socialAppointment'&&row.action.operation==='accept'));
  run(f.w,f.peer,choice(f.w,f.peer,'accept'));run(f.w,f.r,choice(f.w,f.r,'attend'));run(f.w,f.peer,choice(f.w,f.peer,'attend'));
  assert.equal(c.status,'met');assert.deepEqual({start:c.start,end:c.end},terms,'validation must not move or extend either original deadline');
 }
});

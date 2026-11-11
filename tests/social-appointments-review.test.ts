import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {emitEvent} from '../src/world/events.js';
import {YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import type {SocialAppointmentAction} from '../src/shared/social-appointments.js';
import {socialAppointmentOpportunities,socialAppointmentNotes,completeSocialAppointment,advanceSocialAppointments} from '../src/world/social-appointments.js';

function fixture(){
 const w=createWorld(5401);w.mode='formal';w.minute=600;w.clock.paused=false;w.weather='sun';
 w.map={width:80,height:80,tiles:Array(6400).fill('grass'),entrance:{x:0,y:0},name:'Independent synthetic appointment review'};
 w.buildings=[{id:'review-lodge',kind:'lodge',name:'Review public lodge',at:{x:30,y:20},width:4,height:4,door:{x:31,y:24},ownerId:'commons',definition:'building/lodge@1',capacity:8,residents:[],condition:100}];
 w.plots=[];w.graves=[];w.events=[];w.resources=[];w.residents=w.residents.slice(0,3);
 for(const [i,r] of w.residents.entries())Object.assign(r,{at:{x:40+i,y:40},inside:null,roomAt:null,homeId:null,knownResources:[],knownBuildings:['review-lodge'],knownPeople:w.residents.filter(p=>p!==r).map(p=>p.id),inventory:{meal:10,water:10},memories:[],relations:[],plan:null,activity:null,lastFailure:null,bornAt:600-25*YEAR,canDecide:true,canExpress:true,hunger:20,energy:100,health:100});
 const [a,b,c]=w.residents;c.at={x:60,y:60};for(const r of w.residents)decisionContext(w,r);
 const action=socialAppointmentOpportunities(w,a).find(v=>v.action.type==='socialAppointment'&&v.action.operation==='offer')?.action;assert.ok(action);
 return {w,a,b,c,action:action as SocialAppointmentAction};
}
let serial=0;
function queue(w:World,r:Resident,action:Action){return submitPlan(w,{id:'independent-appointment-'+ ++serial,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Independent explicit review choice',actions:[action]});}
function finish(w:World,r:Resident){let remaining=400;while(r.plan||r.activity){assert.ok(remaining--);stepWorld(w,.25);}assert.equal(r.lastFailure,null);}
function offered(){const f=fixture();assert.equal(queue(f.w,f.a,f.action).ok,true);finish(f.w,f.a);assert.equal(f.w.socialAppointments?.records.length,1);return {...f,record:f.w.socialAppointments!.records[0]};}
function accepted(){const f=offered();assert.equal(queue(f.w,f.b,{type:'socialAppointment',operation:'accept',appointmentId:f.record.id}).ok,true);finish(f.w,f.b);assert.equal(f.record.status,'accepted');return f;}
function attend(w:World,r:Resident,id:string){assert.equal(queue(w,r,{type:'socialAppointment',operation:'attend',appointmentId:id}).ok,true);finish(w,r);}

test('appointment independent review: non-finite forged work cannot create an offer',()=>{
 for(const bad of [NaN,Infinity,-Infinity]){const {w,a,action}=fixture();a.activity={action,planId:'forged',startedAt:w.minute,remaining:0,path:[],target:{...a.at},definition:w.activeDefinitions['action/routine'],appointmentStartedAt:w.minute-1,appointmentWork:{from:bad,through:w.minute,minutes:bad}};
 assert.ok(completeSocialAppointment(w,a,action));assert.equal(w.socialAppointments?.records.length??0,0);}
});
test('appointment independent review: shortening remaining work cannot complete early',()=>{
 const {w,a,action}=fixture();assert.equal(queue(w,a,action).ok,true);stepWorld(w,.25);assert.ok(a.activity);a.activity.remaining=0;stepWorld(w,.25);assert.ok(a.lastFailure);assert.equal(w.socialAppointments?.records.length??0,0);
});
test('appointment independent review: remote withdrawal leaves personal choices and notes unchanged',()=>{
 const {w,a,b,record}=accepted();a.at={x:70,y:70};const beforeChoices=socialAppointmentOpportunities(w,b),beforeNotes=socialAppointmentNotes(w,b),beforeRevision=b.revision;
 assert.equal(queue(w,a,{type:'socialAppointment',operation:'withdraw',appointmentId:record.id}).ok,true);assert.deepEqual(socialAppointmentOpportunities(w,b),beforeChoices);assert.equal(socialAppointmentNotes(w,b),beforeNotes);assert.equal(b.revision,beforeRevision);assert.equal(record.known[b.id],'accepted');
});
test('appointment independent review: remote cancellation cannot shorten personal note retention',()=>{
 const {w,a,b,record}=accepted();a.at={x:70,y:70};const unchanged=structuredClone(w);
 assert.equal(queue(w,a,{type:'socialAppointment',operation:'withdraw',appointmentId:record.id}).ok,true);
 w.minute=record.end+1439;unchanged.minute=w.minute;advanceSocialAppointments(w);advanceSocialAppointments(unchanged);
 assert.equal(socialAppointmentNotes(w,b),socialAppointmentNotes(unchanged,unchanged.residents.find(r=>r.id===b.id)!));assert.ok(socialAppointmentNotes(w,b).includes(record.id));
});
test('appointment independent review: nearby third party receives no private invitation or acceptance memory',()=>{
 const {w,a,b,c,action}=fixture();c.at={x:40,y:41};assert.equal(queue(w,a,action).ok,true);finish(w,a);const record=w.socialAppointments!.records[0];assert.equal(queue(w,b,{type:'socialAppointment',operation:'accept',appointmentId:record.id}).ok,true);finish(w,b);
 for(const id of record.eventIds){assert.ok(!w.events.find(e=>e.id===id)!.witnesses.includes(c.id));assert.ok(!c.memories.some(m=>m.eventId===id));}assert.equal(socialAppointmentNotes(w,c),'');
});
test('appointment independent review: separate visits without overlap never become a meeting',()=>{
 const {w,a,b,record}=accepted();a.at={x:30,y:24};b.at={x:32,y:24};w.minute=record.start;attend(w,a,record.id);a.at={x:55,y:55};advanceSocialAppointments(w);attend(w,b,record.id);assert.equal(record.metAt,null);assert.equal(record.status,'accepted');assert.ok(record.visits.find(v=>v.personId===a.id)?.leftAt);
});
test('appointment independent review: bare physical presence is not independent attendance',()=>{
 const {w,a,b,record}=accepted();w.minute=record.start;a.at={...record.place};b.at={...record.place};advanceSocialAppointments(w);assert.equal(record.metAt,null);assert.equal(record.visits.length,0);attend(w,a,record.id);assert.equal(record.metAt,null);
});
test('appointment independent review: cancelling does not destroy unrelated chosen wait',()=>{
 const {w,a,b,record}=accepted();a.at={x:70,y:70};assert.equal(queue(w,a,{type:'wait',minutes:15}).ok,true);stepWorld(w,.25);const activity=structuredClone(a.activity),plan=structuredClone(a.plan),otherRevision=b.revision;
 const menu=decisionChoices(decisionContext(w,a));assert.ok(menu.some(c=>c.action.type==='socialAppointment'&&c.action.operation==='withdraw'));
 assert.equal(queue(w,a,{type:'socialAppointment',operation:'withdraw',appointmentId:record.id}).ok,true);assert.deepEqual(a.activity,activity);assert.deepEqual(a.plan,plan);assert.equal(b.revision,otherRevision);assert.equal(record.known[a.id],'withdrawn');
});
test('appointment independent review: changed offer proof or missing receipt cannot authorize acceptance',()=>{
 for(const alter of [(w:World)=>w.processed=w.processed.filter(x=>!x.startsWith('social-appointment:offer:')),(w:World)=>{w.socialAppointments!.records[0].end++;},(w:World)=>{const r=w.socialAppointments!.records[0];w.events.find(e=>e.id===r.eventIds[0])!.witnesses=[];}]){const {w,b,record}=offered();alter(w);assert.equal(queue(w,b,{type:'socialAppointment',operation:'accept',appointmentId:record.id}).ok,false);assert.equal(record.acceptedAt,null);}
});
test('appointment independent review: SQLite preserves personal terms after short-memory eviction',()=>{
 const {w,a,b,record}=accepted();a.at={x:70,y:70};for(let i=0;i<100;i++)emitEvent(w,{kind:'action',actors:[b.id],place:b.at,witnesses:[b.id],text:'Unrelated synthetic review event '+i});assert.ok(!b.memories.some(m=>record.eventIds.includes(m.eventId)));const notes=socialAppointmentNotes(w,b);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.loadForRuntime()!,bb=loaded.residents.find(r=>r.id===b.id)!;assert.equal(socialAppointmentNotes(loaded,bb),notes);assert.ok(socialAppointmentOpportunities(loaded,bb).some(c=>c.action.type==='socialAppointment'&&c.action.operation==='attend'));assert.equal(queue(loaded,loaded.residents.find(r=>r.id===a.id)!,record.receiptId?{...fixture().action,receiptId:record.receiptId} as Action:fixture().action).ok,false);}finally{store.close();}
});
test('appointment independent review: internally consistent forged elapsed work before activity start is rejected',()=>{
 const {w,a,action}=fixture();assert.equal(queue(w,a,action).ok,true);stepWorld(w,.25);assert.ok(a.activity);a.activity.appointmentWork={from:w.minute-1,through:w.minute,minutes:1};a.activity.remaining=0;
 assert.ok(completeSocialAppointment(w,a,a.activity.action as SocialAppointmentAction));assert.equal(w.socialAppointments?.records.length??0,0);
});
test('appointment independent review: changing a remote counterpart name cannot rewrite remembered invitation',()=>{
 const {w,a,b}=accepted();a.at={x:70,y:70};const before=socialAppointmentNotes(w,b);a.name='Changed privately elsewhere';assert.equal(socialAppointmentNotes(w,b),before);
});
test('appointment independent review: cancelling on the actual walking path ends only own journey',()=>{
 const {w,a,b,record}=accepted();b.at={x:70,y:70};assert.equal(queue(w,a,{type:'socialAppointment',operation:'attend',appointmentId:record.id}).ok,true);stepWorld(w,.25);assert.ok(a.activity?.path.length);const stoppedAt={...a.at},otherRevision=b.revision;
 assert.equal(queue(w,a,{type:'socialAppointment',operation:'withdraw',appointmentId:record.id}).ok,true);assert.equal(a.activity,null);assert.equal(a.plan,null);assert.equal(b.revision,otherRevision);stepWorld(w,2);assert.deepEqual(a.at,stoppedAt);assert.equal(record.known[b.id],'accepted');assert.equal(record.metAt,null);
});
test('appointment independent review: real encounter never interrupts either chosen appointment wait',()=>{
 const {w,a,b,record}=accepted();a.at={x:30,y:24};b.at={x:32,y:24};attend(w,a,record.id);attend(w,b,record.id);w.minute=record.start-1;
 for(const r of [a,b])assert.equal(queue(w,r,{type:'socialAppointment',operation:'wait',appointmentId:record.id,minutes:5}).ok,true);
 const relations=structuredClone([a.relations,b.relations]);stepWorld(w,1);assert.equal(record.status,'met');assert.ok(a.activity);assert.ok(b.activity);assert.equal(a.activity.action.type,'socialAppointment');assert.equal(b.activity.action.type,'socialAppointment');assert.deepEqual([a.relations,b.relations],relations);
 stepWorld(w,4);assert.equal(a.lastFailure,null);assert.equal(b.lastFailure,null);assert.equal(a.activity,null);assert.equal(b.activity,null);assert.equal(record.visits.find(v=>v.personId===a.id)!.waitedMinutes,5);assert.equal(record.visits.find(v=>v.personId===b.id)!.waitedMinutes,5);assert.equal(w.events.filter(e=>e.text.includes('尚未交谈')).length,1);
});
test('appointment independent review: chosen wait completing on the exact window end retains its last quarter minute',()=>{
 const {w,a,record}=accepted();a.at={x:30,y:24};attend(w,a,record.id);w.minute=record.end-1;assert.equal(queue(w,a,{type:'socialAppointment',operation:'wait',appointmentId:record.id,minutes:1}).ok,true);
 for(let i=0;i<4;i++)stepWorld(w,.25);assert.equal(w.minute,record.end);assert.equal(a.lastFailure,null);assert.equal(a.activity,null);assert.equal(record.visits.find(v=>v.personId===a.id)!.waitedMinutes,1);assert.equal(record.metAt,null);assert.equal(record.status,'elapsed');
});
test('appointment independent review: acceptance requires recipient first and proposer second, not mere witnesses',()=>{
 for(const actors of ['proposer','stranger','none','reversed','extra']){
  const {w,a,b,c,record}=accepted(),proof=w.events.find(e=>e.audit?.rule==='social-appointment/accept@1')!;
  proof.actors=actors==='proposer'?[a.id]:actors==='stranger'?[c.id]:actors==='none'?[]:actors==='reversed'?[a.id,b.id]:[b.id,a.id,c.id];
  assert.equal(queue(w,b,{type:'socialAppointment',operation:'attend',appointmentId:record.id}).ok,false,actors);assert.equal(socialAppointmentNotes(w,b),'',actors);assert.equal(record.metAt,null);
 }
});
test('appointment independent review: copied offer evidence is not an independent acceptance',()=>{
 const {w,a,b,record}=offered(),offer=w.events.find(e=>e.audit?.rule==='social-appointment/offer@1')!,fake=structuredClone(offer);fake.id+=':forged-accept';fake.audit!.rule='social-appointment/accept@1';w.events.push(fake);record.eventIds.push(fake.id);record.acceptedAt=record.offeredAt;record.status='accepted';record.known[a.id]='accepted';record.known[b.id]='accepted';
 assert.equal(queue(w,b,{type:'socialAppointment',operation:'attend',appointmentId:record.id}).ok,false);assert.equal(socialAppointmentNotes(w,b),'');
});
test('appointment independent review: offer and acceptance audit metadata remain bound to the original authority',()=>{
 for(const rule of ['offer','accept'])for(const field of ['authority','provider','scope','resources']){
  const {w,b,c,record}=accepted(),proof=w.events.find(e=>e.audit?.rule===`social-appointment/${rule}@1`)!;
  if(field==='authority')proof.audit!.authority='other-authority';if(field==='provider')proof.audit!.providerId=c.id;if(field==='scope')proof.audit!.scope=['private-home-access'];if(field==='resources')proof.audit!.resources={meal:1};
  assert.equal(queue(w,b,{type:'socialAppointment',operation:'attend',appointmentId:record.id}).ok,false,rule+':'+field);
 }
});
test('appointment independent review: acceptance cannot predate offer or originate in the future',()=>{
 for(const when of ['before','future','nan','infinity']){
  const {w,b,record}=accepted(),proof=w.events.find(e=>e.audit?.rule==='social-appointment/accept@1')!;
  const at=when==='before'?record.offeredAt-.25:when==='future'?w.minute+.25:when==='nan'?NaN:Infinity;record.acceptedAt=at;proof.at=at;
  assert.equal(queue(w,b,{type:'socialAppointment',operation:'attend',appointmentId:record.id}).ok,false,when);
 }
});

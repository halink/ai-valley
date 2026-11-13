import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Action,Resident,Snapshot,Tile,World} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {initializeHealth,healthReason} from '../src/world/health.js';
import {initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeRooms} from '../src/world/rooms.js';
import {observeBody} from '../src/world/body-observation.js';
import {decisionContext,decisionChoices,prompt} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';

import {personalObservations} from '../src/server/personal-observations.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld(271);w.mode='formal';w.scenario='frontier';w.clock.paused=false;w.weather='sun';
 w.map={name:'救援后观察隔离世界',width:24,height:18,tiles:Array<Tile>(432).fill('grass'),entrance:{x:1,y:8},settlement:{x:6,y:8}};
 w.buildings=[];w.resources=[];w.plots=[];w.graves=[];
 for(const r of w.residents){Object.assign(r,{at:{x:11,y:8},inside:null,roomAt:null,homeId:null,bornAt:w.minute-30*YEAR,status:'alive',residency:'resident',health:100,energy:100,hunger:0,canDecide:true,canExpress:true,refusesCare:false,inventory:{water:9,cloth:3,medicine:2,meal:10},knownBuildings:[],knownResources:[],guardianIds:[],plan:null,activity:null,lastFailure:null});}
 const [actor,patient,remote]=w.residents;patient.name='待接续成人';patient.canDecide=patient.canExpress=false;patient.hunger=90;remote.at={x:1,y:16};
 initializeHealth(w);initializeRooms(w);initializeFrontierHazards(w);w.frontierHazards!.beasts=[];
 w.frontierHazards!.disasters=[{id:'care-observation-flood',kind:'flashFlood',at:{...patient.at},radius:2,phase:'active',warningAt:w.minute-60,startsAt:w.minute-1,endsAt:w.minute+1000,intensity:1,warned:w.residents.map(p=>p.id),exposure:{},footprint:[{...patient.at}]}];
 return {w,actor,patient,remote};
}
function run(w:World,r:Resident,a:Action){
 const result=submitPlan(w,{id:'care-observation:'+w.revision+':'+w.minute,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'自主选择眼前的有限行动',actions:[a]});assert.equal(result.ok,true,result.error);
 let budget=1500;while(r.activity||r.plan){assert.ok(budget-->0);stepWorld(w,.25);}
 assert.equal(r.lastFailure,null);
}
function evacuate(f:ReturnType<typeof fixture>){
 const menu=decisionChoices(decisionContext(f.w,f.actor)),choice=menu.find(c=>c.action.type==='health'&&c.action.operation==='rescue'&&c.action.evacuationAuthority==='incapacitated-adult');assert.ok(choice);
 run(f.w,f.actor,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);
 const transport=f.w.health!.transports[0];assert.equal(transport.phase,'delivered');assert.equal(transport.evacuationDestination,'safe-ground');return transport;
}
const snapshot=(w:World):Snapshot=>({world:structuredClone(w),mapRevision:'care-observation-test',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}});

test('care observation: actual evacuation leaves the hungry incapacitated adult visible in context and final prompt',()=>{
 const f=fixture(),transport=evacuate(f);assert.equal(f.w.health!.cases.length,0);assert.equal(f.patient.canDecide,false);assert.ok(f.patient.hunger>=90);
 const context=decisionContext(f.w,f.actor),view=context.people.find(p=>p.id===f.patient.id)!.bodyObservation!;
 assert.equal(view.atMinute,f.w.minute);assert.ok(view.signs.includes('choice-support'));assert.ok(view.signs.includes('expression-support'));assert.ok(view.signs.includes('hunger'));
 const text=prompt(context).map(m=>m.content).join('\n');assert.match(text,/待接续成人：自主应对受限/);assert.match(text,/明显饥饿迹象/);assert.match(text,/救援送达不等于恢复、进食或后续照护已完成/);
 assert.equal(transport.bed,null);assert.equal(f.patient.homeId,null);assert.deepEqual(f.patient.guardianIds,[]);assert.equal(f.actor.inventory.medicine,2);assert.equal(f.w.frontierHazards!.weather!.enabled,false);

});

test('care observation: observation data never grants care, food, water or general decision authority',()=>{
 const f=fixture();evacuate(f);decisionContext(f.w,f.actor);const before=structuredClone(f.w);
 const context=decisionContext(f.w,f.actor),without=structuredClone(context);for(const p of without.people)delete p.bodyObservation;
 assert.deepEqual(decisionChoices(context),decisionChoices(without));prompt(context);assert.deepEqual(f.w,before);
 assert.ok(healthReason(f.w,f.actor,{type:'health',operation:'stabilize',targetId:f.patient.id}));
 const unauthorized=submitPlan(f.w,{id:'incapable-self-feeding',actorId:f.patient.id,actorRevision:f.patient.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'观察不授予自主行动能力',actions:[{type:'eat',item:'meal'}]});assert.equal(unauthorized.ok,false);
 assert.deepEqual(f.patient.guardianIds,[]);assert.equal(f.w.health!.appointments.length,0);assert.equal(f.w.longCare?.agreements.length??0,0);
});

test('care observation: a rescuer leaving, a distant acquaintance and heard memories do not receive live signs',()=>{
 const f=fixture();evacuate(f);assert.ok(observeBody(f.w,f.actor,f.patient));
 const known=structuredClone(f.actor.memories);f.actor.at={x:f.patient.at.x+3,y:f.patient.at.y};
 assert.equal(decisionContext(f.w,f.actor).people.find(p=>p.id===f.patient.id)?.bodyObservation,undefined);
 f.remote.knownPeople.push(f.patient.id);f.remote.memories.push({eventId:'synthetic-heard',receivedAt:f.w.minute,source:'heard',text:'先前听说对方曾被接出'});
 assert.equal(decisionContext(f.w,f.remote).people.find(p=>p.id===f.patient.id),undefined);
 assert.doesNotMatch(prompt(decisionContext(f.w,f.remote),[]).map(m=>m.content).join(''),/你此刻近身所见/);
 assert.deepEqual(f.actor.memories,known,'old witnessed rescue facts are retained, not refreshed from a remote body');
});

test('care observation: expression limits do not claim lack of decision, and recovery clears the live warning',()=>{
 const f=fixture();evacuate(f);f.patient.canDecide=true;f.patient.hunger=0;
 assert.deepEqual(observeBody(f.w,f.actor,f.patient)!.signs,['expression-support']);
 assert.match(prompt(decisionContext(f.w,f.actor),[])[0].content,/不能据此认定没有决定能力或已经同意/);
 f.patient.canExpress=true;assert.equal(observeBody(f.w,f.actor,f.patient),undefined);

});

test('care observation: guardian notes use the same close, coarse boundary instead of precise private body values',()=>{
 const f=fixture();f.w.frontierHazards!.disasters=[];f.patient.bornAt=f.w.minute-4*YEAR;f.patient.guardianIds=[f.actor.id];f.patient.hunger=93.123;f.patient.health=17.345;
 const close=personalObservations(f.w,f.actor);assert.match(close,/明显饥饿迹象/);assert.doesNotMatch(close,/93|17|\/100/);
 const offered=decisionContext(f.w,f.actor);assert.ok(offered.formal!.opportunities.some(o=>o.action.type==='tendChild'&&o.action.targetId===f.patient.id));
 assert.doesNotMatch(JSON.stringify(offered.formal!.opportunities),/饥饿 93\/100|健康 17\/100/,'a feeding label must not reintroduce the exact values removed from personal notes');
 assert.doesNotMatch(prompt(offered)[0].content,/饥饿 93\/100|健康 17\/100/);
 f.patient.at={x:f.actor.at.x+3,y:f.actor.at.y};const away=personalObservations(f.w,f.actor);assert.doesNotMatch(away,/明显饥饿|身体显得虚弱/);assert.match(away,/不能从登记或亲属关系推断远处情况/);
});

test('care observation: sleeping bodies are not diagnosed, and sleeping observers gain no signs',()=>{
 const f=fixture();f.w.frontierHazards!.disasters=[];
 f.patient.activity={action:{type:'sleep',minutes:60},path:[],remaining:60,startedAt:f.w.minute,planId:'synthetic-sleep',target:{...f.patient.at},definition:'action/routine@1'};
 assert.deepEqual(observeBody(f.w,f.actor,f.patient)!.signs,['sleeping']);
 f.actor.activity=structuredClone(f.patient.activity);assert.equal(observeBody(f.w,f.actor,f.patient),undefined);
});

test('care observation: in-memory reload preserves old rescue facts and recomputes rather than stores observations',()=>{
 const f=fixture();evacuate(f);const transports=structuredClone(f.w.health!.transports),events=structuredClone(f.w.events),before=structuredClone(f.w);const store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const restored=store.load()!,actor=restored.residents.find(r=>r.id===f.actor.id)!,patient=restored.residents.find(r=>r.id===f.patient.id)!;
  assert.deepEqual(restored.health!.transports,transports);assert.deepEqual(restored.events,events);assert.ok(observeBody(restored,actor,patient));assert.equal('bodyObservation' in patient,false);assert.deepEqual(f.w,before);
  patient.canDecide=patient.canExpress=true;patient.hunger=0;assert.equal(observeBody(restored,actor,patient),undefined);assert.deepEqual(restored.health!.transports,transports);assert.deepEqual(restored.events,events);
 }finally{store.close();}
});

test('care observation: observer baseline, delta and reconnect clear current support while retaining the old arrival',()=>{
 const f=fixture();evacuate(f);const first=snapshot(f.w);
 f.patient.canDecide=f.patient.canExpress=true;f.patient.hunger=0;f.w.revision++;const next=snapshot(f.w),combined=applyObserverUpdate(first,observerFrame(next,first))!;
 assert.deepEqual(combined.world,next.world);
 assert.deepEqual(applyObserverUpdate(first,observerFrame(next)),next);
 f.patient.status='dead';f.w.revision++;const departed=applyObserverUpdate(next,observerFrame(snapshot(f.w),next))!;
});

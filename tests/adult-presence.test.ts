import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Snapshot} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {adultPresenceReason,completeAdultPresence} from '../src/world/adult-presence.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext,prompt} from '../src/server/decisions.js';

import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {presenceFixture,evacuatePresence,verifyPresence,choosePresence,presenceMenu,runPresence,submitPresence,reloadPresence} from './helpers/adult-presence.js';

const noPresence=(f:ReturnType<typeof presenceFixture>,who=f.actor)=>!presenceMenu(f.w,who).some(c=>c.action.type==='adultPresence'&&c.action.operation!=='stop');

test('adult presence: real menu, arrival, verification, finite voluntary stay leave unresolved needs without material benefits',()=>{
 const f=presenceFixture(),t=evacuatePresence(f),before={inventory:structuredClone(f.actor.inventory),patientInventory:structuredClone(f.patient.inventory),coins:f.actor.coins,patientCoins:f.patient.coins,at:{...f.patient.at},health:f.patient.health,hunger:f.patient.hunger};
 const context=decisionContext(f.w,f.actor);assert.match(prompt(context)[0].content,/用2分钟当场核实/);assert.equal(f.w.adultPresence?.records.length,0);
 runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));const c=f.w.adultPresence!.records[0];assert.equal(c.transportId,t.id);assert.equal(c.status,'verified');assert.equal(c.minutes,0);
 runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));assert.equal(c.status,'ended');assert.equal(c.minutes,15);assert.equal(c.expiresAt,c.verifiedAt+15);assert.ok(noPresence(f));
 assert.deepEqual(f.actor.inventory,before.inventory);assert.deepEqual(f.patient.inventory,before.patientInventory);assert.equal(f.actor.coins,before.coins);assert.equal(f.patient.coins,before.patientCoins);assert.deepEqual(f.patient.at,before.at);assert.ok(f.patient.hunger>=before.hunger);assert.ok(f.patient.health<=before.health);assert.equal(f.patient.canDecide,false);assert.equal(f.patient.canExpress,false);assert.deepEqual(f.patient.guardianIds,[]);assert.equal(f.patient.homeId,null);assert.equal(f.w.longCare?.agreements.length,0);assert.equal(f.w.frontierHazards!.weather!.enabled,false);
 assert.match(f.w.events.at(-1)!.text,/后续照护仍未解决/);
});

test('adult presence: all read paths are non-mutating and distant bystanders receive no new live choice',()=>{
 const f=presenceFixture();evacuatePresence(f);const before=structuredClone(f.w);presenceMenu(f.w,f.actor);presenceMenu(f.w,f.remote);prompt(decisionContext(f.w,f.actor));assert.deepEqual(f.w,before);assert.ok(noPresence(f,f.remote));
 f.remote.at={...f.patient.at};assert.ok(noPresence(f,f.remote),'arriving later does not become a witness of the original arrival');
 f.actor.at={x:f.patient.at.x+3,y:f.patient.at.y};assert.ok(noPresence(f));
});

test('adult presence: expression alone offers stop and non-consent wait, but no food, proxy or mixed plan',()=>{
 const f=presenceFixture(),c=verifyPresence(f);f.patient.canExpress=true;
 const menu=presenceMenu(f.w,f.patient);assert.ok(menu.some(c=>c.action.type==='adultPresence'&&c.action.operation==='stop'));assert.ok(menu.every(c=>c.action.type==='adultPresence'||c.action.type==='wait'));
 const stop=choosePresence(f.w,f.patient,'stop');assert.equal(submitPlan(f.w,{id:'mixed-presence',actorId:f.patient.id,actorRevision:f.patient.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'not allowed',actions:[stop,{type:'eat',item:'meal'}]}).ok,false);
 assert.equal(submitPresence(f.w,f.patient,{type:'eat',item:'meal'}).ok,false);
 assert.equal(submitPresence(f.w,f.patient,stop).ok,true);assert.equal(c.status,'ended');assert.equal(c.minutes,0);assert.equal(f.w.adultPresence!.refusals.length,1);assert.ok(noPresence(f));
 assert.equal(f.patient.refusesCare,false,'scoped refusal does not become a permanent global care refusal');
});

test('adult presence: provider can immediately withdraw while busy without finishing the remaining work',()=>{
 const f=presenceFixture(),c=verifyPresence(f);assert.equal(submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay')).ok,true);stepWorld(f.w,1);assert.equal(c.minutes,1);
 const stop=choosePresence(f.w,f.actor,'stop');assert.equal(submitPresence(f.w,f.actor,stop).ok,true);assert.equal(f.actor.activity,null);assert.equal(c.status,'ended');stepWorld(f.w,1);assert.equal(c.minutes,1);assert.equal(f.w.adultPresence!.refusals.length,0);
});

test('adult presence: recipient stop wins the final quarter minute and survives reload, record trimming and substitute helpers',()=>{
 let f=presenceFixture();const c=verifyPresence(f),stay=choosePresence(f.w,f.actor,'stay');assert.equal(submitPresence(f.w,f.actor,stay).ok,true);stepWorld(f.w,14.75);f.patient.canExpress=true;
 const stop=choosePresence(f.w,f.patient,'stop');assert.equal(submitPresence(f.w,f.patient,stop).ok,true);assert.equal(c.minutes,14.75);assert.equal(f.actor.activity,null);
 f=reloadPresence(f);const saved=f.w.adultPresence!.records[0];stepWorld(f.w,.25);assert.equal(saved.minutes,14.75);assert.ok(noPresence(f));assert.equal(submitPresence(f.w,f.actor,stay).ok,true);stepWorld(f.w,.25);assert.ok(f.actor.lastFailure);assert.equal(saved.minutes,14.75);
 const t=f.w.health!.transports[0];f.w.adultPresence!.records=[];f.remote.at={...f.patient.at};assert.ok(adultPresenceReason(f.w,f.actor,{type:'adultPresence',operation:'verify',transportId:t.id,eventId:t.arrivalEventId!}));assert.ok(noPresence(f,f.remote));
});

test('adult presence: authority, threat and body changes are rechecked at the last tick without movement or nutrition',()=>{
 for(const change of ['recovery','expressionOnly','refusal','helperIncapable','helperEnergy','critical','hazard','departure'] as const){
  const f=presenceFixture(),c=verifyPresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));stepWorld(f.w,14.75);const at={...f.patient.at},hunger=f.patient.hunger;
  if(change==='recovery')f.patient.canDecide=true;
  if(change==='expressionOnly')f.patient.canExpress=true;
  if(change==='refusal')f.patient.refusesCare=true;
  if(change==='helperIncapable')f.actor.canDecide=false;
  if(change==='helperEnergy')f.actor.energy=0;
  if(change==='critical')f.patient.health=19;
  if(change==='hazard')f.w.frontierHazards!.disasters[0].footprint!.push({...f.patient.at});
  if(change==='departure')f.patient.at={x:f.patient.at.x+3,y:f.patient.at.y};
  stepWorld(f.w,.25);assert.equal(c.status,'ended',change);assert.equal(c.minutes,change==='expressionOnly'?15:14.75,change);assert.ok(f.patient.hunger>=hunger);if(change!=='departure')assert.deepEqual(f.patient.at,at);
 }
});

test('adult presence: SQLite reload at arrival, verification work, verified and presence stages retains original expiry and evidence',()=>{
 let f=presenceFixture();evacuatePresence(f);f=reloadPresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,1);f=reloadPresence(f);stepWorld(f.w,1);
 const end=f.w.adultPresence!.records[0].expiresAt;f=reloadPresence(f);runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));assert.equal(f.w.adultPresence!.records[0].expiresAt,end);assert.equal(f.w.adultPresence!.records[0].minutes,15);
 const g=presenceFixture();verifyPresence(g);submitPresence(g.w,g.actor,choosePresence(g.w,g.actor,'stay'));stepWorld(g.w,4);const h=reloadPresence(g);stepWorld(h.w,11);assert.equal(h.w.adultPresence!.records[0].minutes,15);assert.equal(h.w.adultPresence!.records[0].status,'ended');
});

test('adult presence: no backfilled old arrival, expiry renewal, full-capacity adult exception or direct synthetic verification',()=>{
 for(const mode of ['legacy','capacity','expiry'] as const){const f=presenceFixture(),t=evacuatePresence(f);if(mode==='legacy')delete t.arrivalEventId;if(mode==='capacity')f.patient.canDecide=true;if(mode==='expiry')f.w.minute=t.endedAt!+60;assert.ok(noPresence(f));}
 const f=presenceFixture(),t=evacuatePresence(f);assert.ok(completeAdultPresence(f.w,f.actor,{type:'adultPresence',operation:'verify',transportId:t.id,eventId:t.arrivalEventId!}));assert.equal(f.w.adultPresence!.records.length,0);
 runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));const c=f.w.adultPresence!.records[0];stepWorld(f.w,15);assert.equal(c.status,'ended');assert.equal(c.minutes,0);assert.ok(noPresence(f));
});

test('adult presence: a distant participant stop does not tell others a remote location or reason',()=>{
 const f=presenceFixture(),c=verifyPresence(f);f.patient.canExpress=true;f.actor.at={x:1,y:1};stepWorld(f.w,.25);const before=structuredClone(f.patient.memories),menu=presenceMenu(f.w,f.patient);assert.ok(menu.some(c=>c.action.type==='adultPresence'&&c.action.operation==='stop'));
 f.actor.canDecide=false;f.actor.health=0;assert.deepEqual(presenceMenu(f.w,f.patient),menu);assert.deepEqual(f.patient.memories,before);
 assert.equal(submitPresence(f.w,f.patient,choosePresence(f.w,f.patient,'stop')).ok,true);assert.equal(c.stops.length,1);assert.ok(f.actor.memories.every(m=>!m.text.includes('明确停止原救援')));
});

test('adult presence: observer baseline, delta and reconnect expose finite facts and unresolved outcome',()=>{
 const f=presenceFixture(),c=verifyPresence(f);
 const snapshot=():Snapshot=>({world:structuredClone(f.w),mapRevision:'presence-test',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}});
 const first=snapshot();
 submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));stepWorld(f.w,1);const next=snapshot(),combined=applyObserverUpdate(first,observerFrame(next,first))!;assert.equal(combined.world.adultPresence!.records[0].minutes,1);
 f.patient.canExpress=true;submitPresence(f.w,f.patient,choosePresence(f.w,f.patient,'stop'));const ended=snapshot(),reconnected=applyObserverUpdate(next,observerFrame(ended))!;assert.equal(reconnected.world.adultPresence!.records[0].status,'ended');assert.equal(c.minutes,1);
});

test('adult presence: crowded focused menu keeps bounded verification, stay and immediate stop beside self-care',()=>{
 const f=presenceFixture();evacuatePresence(f);const context=decisionContext(f.w,f.actor);context.actor.agency={focus:'construction',goals:[],routines:[],nextSerial:1};
 for(let i=0;i<100;i++)context.formal!.opportunities.push({id:'noise.'+i,label:'ordinary unrelated opportunity',action:{type:'move',to:{x:1,y:1}}});
 const menu=decisionChoices(context);assert.ok(menu.some(c=>c.action.type==='adultPresence'&&c.action.operation==='verify'));assert.ok(menu.some(c=>c.action.type==='wait'));assert.ok(menu.some(c=>c.action.type==='eat'));assert.ok(menu.length<=56);
 runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));f.actor.agency=context.actor.agency;assert.ok(presenceMenu(f.w,f.actor).some(c=>c.action.type==='adultPresence'&&c.action.operation==='stay'));
});

test('adult presence: real offline runtime dispatches an expressive stop and does not grant general capacity',async()=>{
 const f=presenceFixture(),c=verifyPresence(f);f.patient.canExpress=true;f.patient.decisionDue=f.w.minute;for(const p of f.w.residents)if(p.id!==f.patient.id)p.decisionDue=f.w.minute+1000;
 const store=new WorldStore(':memory:');store.commit(f.w,null);let calls=0;
 const runtime=new ValleyRuntime(store,'synthetic-offline-placeholder',async(_key,context)=>{
  calls++;assert.equal(context.actor.id,f.patient.id);const menu=decisionChoices(context),choice=menu.find(c=>c.action.type==='adultPresence'&&c.action.operation==='stop');assert.ok(choice);assert.ok(menu.every(c=>c.action.type==='adultPresence'||c.action.type==='wait'));return {decision:parseChoice(JSON.stringify({choice:choice.id}),menu),inputTokens:1,outputTokens:1,latencyMs:1};
 });
 try{runtime.start();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(runtime.world.adultPresence!.records.find(r=>r.id===c.id)!.status,'ended');assert.equal(runtime.world.residents.find(p=>p.id===f.patient.id)!.canDecide,false);assert.equal(runtime.world.adultPresence!.refusals.length,1);}finally{runtime.stop();store.close();}
});

test('adult presence: injected verification routes never move either body before failure',()=>{
 for(const mode of ['path','room'] as const){const f=presenceFixture();evacuatePresence(f);submitPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));stepWorld(f.w,1.75);const at={...f.actor.at},patientAt={...f.patient.at};
  if(mode==='path')f.actor.activity!.path=[{x:at.x+1,y:at.y}];else f.actor.activity!.room={buildingId:'forged',mode:'exit',path:[{x:2,y:2}],target:{x:2,y:2},progress:0};
  stepWorld(f.w,.25);assert.deepEqual(f.actor.at,at);assert.deepEqual(f.patient.at,patientAt);assert.equal(f.w.adultPresence!.records.length,0);assert.ok(f.actor.lastFailure);
 }
});

test('adult presence: real medical bed arrival supports only later noncritical lawful indoor presence',()=>{
 const f=presenceFixture();f.w.frontierHazards!.disasters=[];const prototype=createWorld().buildings.find(b=>b.kind==='lodge')!;
 const b={...structuredClone(prototype),id:'presence-clinic',ownerId:'commons',at:{x:15,y:4},width:4,height:4,door:{x:17,y:8},residents:[],capacity:4,condition:100};f.w.buildings=[b];f.actor.knownBuildings=[b.id];f.actor.skills.care=3;f.patient.health=19;
 const menu=presenceMenu(f.w,f.actor),choice=menu.find(c=>c.action.type==='health'&&c.action.operation==='rescue'&&c.action.buildingId===b.id);assert.ok(choice);runPresence(f.w,f.actor,parseChoice(JSON.stringify({choice:choice.id}),menu).actions[0]);
 const t=f.w.health!.transports[0];assert.equal(t.phase,'delivered');assert.equal(t.buildingId,b.id);assert.ok(t.arrivalEventId);assert.ok(noPresence(f),'still critical: no presence exception');
 f.patient.health=40;const room={...f.patient.roomAt!},actorRoom={...f.actor.roomAt!},bed=t.bed,stocks=structuredClone(f.actor.inventory);runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'verify'));runPresence(f.w,f.actor,choosePresence(f.w,f.actor,'stay'));
 assert.equal(f.w.adultPresence!.records[0].minutes,15);assert.equal(f.patient.inside,b.id);assert.equal(f.actor.inside,b.id);assert.deepEqual(f.patient.roomAt,room);assert.deepEqual(f.actor.roomAt,actorRoom);assert.equal(t.bed,bed);assert.deepEqual(f.actor.inventory,stocks);assert.equal(f.patient.canDecide,false);assert.equal(f.w.health!.appointments.length,0);
});

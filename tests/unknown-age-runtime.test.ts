import assert from 'node:assert/strict';
import {beforeEach,test,type TestContext} from 'node:test';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DecisionError,decisionChoices,decisionContext,type ModelResult} from '../src/server/decisions.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {knownAgeYears,YEAR} from '../src/world/time.js';
import {hasTimelySelfRescue} from '../src/world/engine.js';
import type {Resident,World} from '../src/shared/types.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const pending=()=>new Promise<ModelResult>(()=>{});
const reply:ModelResult={decision:{intention:'自己的安排',actions:[{type:'wait',minutes:100}]},inputTokens:1,outputTokens:1,latencyMs:1};
beforeEach(t=>{
 const context=t as TestContext;
 context.mock.timers.enable({apis:['setInterval']});
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline runtime tests forbid network');});
});
const invalid:Array<[string,(w:World)=>unknown]>=[
 ['null',()=>null],['missing',()=>undefined],['NaN',()=>NaN],['positive infinity',()=>Infinity],['negative infinity',()=>-Infinity],
 ['numeric string',()=>'-100'],['future',w=>w.minute+100],['unsafe',()=>-Number.MAX_SAFE_INTEGER-1],
];
function setBirth(person:Resident,birth:unknown){person.bornAt=birth as number;}
function fixture(){
 const w=createFrontierWorld(5401),[guardian,rival,child]=w.residents;
 w.scenario=undefined;w.frontierHazards=undefined;
 for(const p of w.residents){
  p.lastDecisionAt=w.minute;p.decisionDue=w.minute+1000;p.hunger=20;p.energy=p.health=100;
  p.plan=p.activity=null;p.guardianIds=[];
 }
 guardian.decisionDue=rival.decisionDue=w.minute;rival.hunger=90;
 child.bornAt=w.minute;child.guardianIds=[guardian.id];child.canDecide=child.canExpress=false;
 child.at={...guardian.at};child.inside=guardian.inside;child.roomAt=guardian.roomAt;
 child.hunger=99;child.health=80;
 const store=new WorldStore(':memory:');store.commit(w,null);
 return {w,store,guardian,rival,child};
}

for(const [label,bad] of invalid)test(`unknown age runtime: ${label} cannot displace a genuinely hungry queued resident`,()=>{
 const {store,guardian,rival,child}=fixture(),calls:string[]=[];
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{calls.push(c.actor.id);return pending();},{modelSlots:1});
 try{
  const person=runtime.world.residents.find(p=>p.id===child.id)!;setBirth(person,bad(runtime.world));
  const authority={stage:person.lifeStage,decide:person.canDecide,express:person.canExpress,guardians:[...person.guardianIds]};
  runtime.start();assert.deepEqual(calls,[rival.id]);assert.ok(!calls.includes(guardian.id));
  const current=runtime.world.residents.find(p=>p.id===child.id)!;
  assert.equal(knownAgeYears(current.bornAt,runtime.world.minute),null);
  assert.deepEqual({stage:current.lifeStage,decide:current.canDecide,express:current.canExpress,guardians:current.guardianIds},authority);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: false dependent need does not stop a slow clock',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,child}=fixture();
 const runtime=new ValleyRuntime(store,'test-key',pending,{dayMinutes:180,modelSlots:1});
 try{
  setBirth(runtime.world.residents.find(p=>p.id===child.id)!,null);
  runtime.start();const minute=runtime.world.minute;runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.paused,false);assert.ok(runtime.world.minute>minute);
  assert.equal(runtime.world.residents[0].decisionProtection,undefined,'another person’s needs cannot create personal protection');
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: real zero-year dependent keeps queue priority and slow-clock hold',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian}=fixture(),calls:string[]=[];
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{calls.push(c.actor.id);return pending();},{dayMinutes:180,modelSlots:1});
 try{
  runtime.start();assert.deepEqual(calls,[guardian.id]);const minute=runtime.world.minute;runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.paused,true);assert.equal(runtime.world.minute,minute);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: a guardian of an unknown-age dependent keeps verified personal hunger protection',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,child}=fixture();
 const runtime=new ValleyRuntime(store,'test-key',pending,{modelSlots:1});
 try{
  const actor=runtime.world.residents.find(p=>p.id===guardian.id)!;
  actor.health=1;actor.hunger=98;actor.energy=80;actor.inventory={meal:2};
  setBirth(runtime.world.residents.find(p=>p.id===child.id)!,null);
  runtime.start();runtime.tick(now+=1000);
  const current=runtime.world.residents.find(p=>p.id===actor.id)!;
  assert.equal(current.health,1);assert.equal(current.decisionProtection?.endedAt,null);
  assert.ok(current.decisionProtection!.prevented.hunger>0);assert.equal(runtime.world.clock.paused,false);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: real critical needs outrank false infant urgency with concurrent slots',()=>{
 for(const unknown of [false,true]){
  const {store,guardian,rival,child}=fixture(),calls:string[]=[];
  const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{calls.push(c.actor.id);return pending();},{modelSlots:2});
  try{
   runtime.world.migration!.contacts=[];runtime.world.foreignTrade!.merchants=[];
   const dependent=runtime.world.residents.find(p=>p.id===child.id)!;
   dependent.health=19;if(unknown)setBirth(dependent,null);
   runtime.world.residents.find(p=>p.id===rival.id)!.health=19;
   runtime.start();assert.deepEqual(calls,unknown?[rival.id,guardian.id]:[guardian.id,rival.id]);
   assert.deepEqual(runtime.world.metrics.inFlight,calls);
   assert.ok(!calls.includes(child.id),'infant pressure never gives an incapable infant a model slot');
  }finally{runtime.stop();store.close();}
 }
});

for(const transition of ['sixth birthday','birth record removed','birth record verified'] as const)test(`unknown age runtime: ${transition} is rechecked when a competing request frees its slot`,async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,rival,child}=fixture(),calls:string[]=[];
 let finish!: (result:ModelResult)=>void;
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{
  calls.push(c.actor.id);return calls.length===1?new Promise<ModelResult>(resolve=>{finish=resolve;}):pending();
 },{modelSlots:1});
 try{
  const blocker=runtime.world.residents[3];blocker.decisionDue=runtime.world.minute;blocker.hunger=99;blocker.health=19;
  const dependent=runtime.world.residents.find(p=>p.id===child.id)!;
  if(transition==='sixth birthday')dependent.bornAt=runtime.world.minute-6*YEAR+.25;
  if(transition==='birth record verified')setBirth(dependent,null);
  runtime.start();assert.deepEqual(calls,[blocker.id]);
  if(transition==='sixth birthday'){
   runtime.tick(now+=1000);assert.ok(knownAgeYears(runtime.world.residents.find(p=>p.id===child.id)!.bornAt,runtime.world.minute)!>=6);
  }else setBirth(runtime.world.residents.find(p=>p.id===child.id)!,transition==='birth record removed'?undefined:runtime.world.minute);
  finish(reply);await flush();
  assert.deepEqual(calls,[blocker.id,transition==='birth record verified'?guardian.id:transition==='sixth birthday'?child.id:rival.id]);
  if(transition==='sixth birthday')assert.equal(runtime.world.residents.find(p=>p.id===child.id)!.canDecide,true,'the real birthday grants the child their existing first independent decision');
 }finally{runtime.stop();store.close();}
});

for(const need of ['hunger','exhaustion'] as const)test(`unknown age runtime: unknown resident's own ${need} still gets the existing slow-clock grace`,t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,child}=fixture();
 const runtime=new ValleyRuntime(store,'test-key',pending,{dayMinutes:180,modelSlots:1});
 try{
  const actor=runtime.world.residents.find(p=>p.id===guardian.id)!;
  setBirth(actor,null);if(need==='hunger')actor.hunger=85;else actor.energy=5;
  setBirth(runtime.world.residents.find(p=>p.id===child.id)!,null);
  runtime.start();runtime.tick(now+=1000);assert.equal(runtime.world.clock.paused,false);
  runtime.tick(now+=29_999);assert.equal(runtime.world.clock.paused,false);
  const minute=runtime.world.minute;runtime.tick(now+=1);
  assert.equal(runtime.world.clock.paused,true);assert.equal(runtime.world.minute,minute);
  assert.equal(knownAgeYears(runtime.world.residents.find(p=>p.id===guardian.id)!.bornAt,runtime.world.minute),null);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: current personal selfcare proves a real rescue without granting adult rights',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,child}=fixture();
 const runtime=new ValleyRuntime(store,'test-key',pending,{modelSlots:1});
 try{
  const actor=runtime.world.residents.find(p=>p.id===guardian.id)!;
  setBirth(actor,null);actor.health=1;actor.hunger=98;actor.energy=80;actor.inventory={meal:2};
  setBirth(runtime.world.residents.find(p=>p.id===child.id)!,null);
  const menu=decisionChoices(decisionContext(runtime.world,actor)).map(c=>c.action);
  assert.ok(menu.some(a=>a.type==='eat'));
  assert.ok(menu.every(a=>['eat','sleep','wait','move'].includes(a.type)));
  assert.equal(hasTimelySelfRescue(runtime.world,actor,menu),true);
  runtime.start();runtime.tick(now+=1000);
  const current=runtime.world.residents.find(p=>p.id===guardian.id)!;
  assert.equal(current.decisionProtection?.endedAt,null);assert.equal(current.health,1);
  assert.equal(current.canDecide,true);assert.equal(current.canExpress,true);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: missing birth data stays missing across SQLite restart without a false hold',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,rival,child}=fixture(),calls:string[]=[];
 let runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{calls.push(c.actor.id);return pending();},{dayMinutes:180,modelSlots:1});
 try{
  const dependent=runtime.world.residents.find(p=>p.id===child.id)!;
  setBirth(dependent,undefined);const stage=dependent.lifeStage;
  runtime.start();runtime.tick(now+=1000);runtime.stop();
  const saved=store.load()!.residents.find(p=>p.id===child.id)!;
  assert.equal(Object.hasOwn(saved,'bornAt'),false);assert.equal(saved.lifeStage,stage);assert.deepEqual(saved.guardianIds,[guardian.id]);
  calls.length=0;
  runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{calls.push(c.actor.id);return pending();},{dayMinutes:180,modelSlots:1});
  const minute=runtime.world.minute;runtime.start();runtime.tick(now+=1000);
  assert.deepEqual(calls,[rival.id]);assert.equal(runtime.world.clock.paused,false);assert.ok(runtime.world.minute>minute);
  assert.equal(Object.hasOwn(runtime.world.residents.find(p=>p.id===child.id)!,'bornAt'),false);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: invalid replies requeue by current facts and stop ignores a late decision',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,rival,child}=fixture(),calls:string[]=[];
 let finish!: (result:ModelResult)=>void;
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{
  calls.push(c.actor.id);
  if(calls.length===1)throw new DecisionError('invalid_decision',{inputTokens:1,outputTokens:1,latencyMs:1},'请重新选择');
  return new Promise<ModelResult>(resolve=>{finish=resolve;});
 },{modelSlots:1});
 try{
  runtime.world.migration!.contacts=[];runtime.world.foreignTrade!.merchants=[];
  setBirth(runtime.world.residents.find(p=>p.id===child.id)!,null);
  runtime.start();await flush();assert.deepEqual(calls,[rival.id,guardian.id]);
  runtime.stop();const stopped=structuredClone(runtime.world);
  finish(reply);await flush();runtime.tick(now+=10_000);
  assert.deepEqual(runtime.world,stopped);assert.deepEqual(runtime.world.metrics.inFlight,[]);
  assert.equal(runtime.world.residents.find(p=>p.id===guardian.id)!.plan,null);
 }finally{runtime.stop();store.close();}
});

test('unknown age runtime: actual hunger protection survives age-unrelated restart and retains its original outage deadline',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {store,guardian,child}=fixture();
 let runtime=new ValleyRuntime(store,'test-key',pending,{modelSlots:1});
 try{
  const actor=runtime.world.residents.find(p=>p.id===guardian.id)!;
  actor.health=1;actor.hunger=98;actor.energy=80;actor.inventory={meal:2};
  setBirth(runtime.world.residents.find(p=>p.id===child.id)!,null);
  runtime.start();runtime.tick(now+=1000);
  const initial=structuredClone(runtime.world.residents.find(p=>p.id===guardian.id)!.decisionProtection!);
  assert.equal(initial.expiresAt-initial.startedAt,180);runtime.stop();
  runtime=new ValleyRuntime(store,'test-key',pending,{modelSlots:1});runtime.start();
  assert.deepEqual(runtime.world.residents.find(p=>p.id===guardian.id)!.decisionProtection,initial);
  for(let i=0;i<151;i++)runtime.tick(now+=1000);
  const current=runtime.world.residents.find(p=>p.id===guardian.id)!;
  assert.equal(runtime.world.clock.paused,true);assert.match(runtime.world.clock.reason!,/持续未提供/);
  assert.equal(current.health,1);assert.equal(current.decisionProtection?.expiresAt,initial.expiresAt);
  assert.equal(runtime.world.events.filter(e=>e.decisionProtection?.phase==='started'&&e.actors.includes(guardian.id)).length,1);
  assert.ok(runtime.world.minute<initial.expiresAt,'the separate total-outage guard pauses before personal protection is lost');
 }finally{runtime.stop();store.close();}
});

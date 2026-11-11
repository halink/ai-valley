import assert from 'node:assert/strict';
import {beforeEach,test,type TestContext} from 'node:test';
import {decisionChoices,decisionContext,type ModelResult} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {hasTimelySelfRescue,stepWorld,submitPlan} from '../src/world/engine.js';
import {residentBed,roomLayout} from '../src/shared/rooms.js';
import {initializeFood} from '../src/world/food.js';
import {knownAgeYears,YEAR} from '../src/world/time.js';
import type {Action,Resident,World} from '../src/shared/types.js';

beforeEach(t=>{const context=t as TestContext;context.mock.timers.enable({apis:['setInterval']});context.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline selfcare tests forbid network');});});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const pending=()=>new Promise<ModelResult>(()=>{});
const badBirths:Array<[string,(w:World)=>unknown]>=[['missing',()=>undefined],['null',()=>null],['NaN',()=>NaN],['Infinity',()=>Infinity],['-Infinity',()=>-Infinity],['string',()=>'-100'],['future',w=>w.minute+1000],['unsafe',()=>-Number.MAX_SAFE_INTEGER-1]];
function birth(r:Resident,value:unknown){r.bornAt=value as number;}
function fixture(){
 const w=createFrontierWorld(5401),r=w.residents[0];w.clock.paused=false;w.scenario=undefined;w.frontierHazards=undefined;
 for(const p of w.residents){p.lastDecisionAt=w.minute;p.decisionDue=w.minute+1000;p.hunger=10;p.health=p.energy=100;p.plan=p.activity=null;}
 r.decisionDue=w.minute;r.inventory={meal:2};initializeFood(w);birth(r,null);
 return {w,r};
}
const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r));
const actions=(w:World,r:Resident)=>menu(w,r).map(c=>c.action);
function choose(w:World,r:Resident,type:Action['type'],minutes=5){
 const choices=menu(w,r),entry=choices.find(c=>c.action.type===type);assert.ok(entry,`${type} exists in final numbered menu`);
 const d=parseChoice(JSON.stringify({choice:entry.id,...(entry.chooseDuration?{minutes}:{})}),choices);
 const result=submitPlan(w,{id:`selfcare:${type}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d});
 assert.equal(result.ok,true,result.error);return entry.action;
}
function bed(w:World,r:Resident){const b=w.buildings.find(b=>b.id===r.homeId)!;r.at={...b.door};r.inside=b.id;r.roomAt={...roomLayout(w,b).slots.find(s=>s.key==='bed:'+residentBed(w,r,b))!.at};return b;}

for(const [label,bad] of badBirths)test(`selfcare: ${label} birth permits only genuine personal survival from final menu to execution`,()=>{
 const {w,r}=fixture();birth(r,bad(w));const original={birth:r.bornAt,stage:r.lifeStage,canDecide:r.canDecide,canExpress:r.canExpress};
 const choices=actions(w,r);for(const type of ['eat','sleep','wait','move'])assert.ok(choices.some(a=>a.type===type),type);
 assert.ok(choices.every(a=>['eat','sleep','wait','move'].includes(a.type)),JSON.stringify(choices));
 r.hunger=80;choose(w,r,'eat');stepWorld(w,5);assert.equal(r.inventory.meal,1);assert.ok(r.hunger<80);
 bed(w,r);r.energy=20;choose(w,r,'sleep',5);stepWorld(w,5);assert.ok(r.energy>20);assert.equal(r.recentActions?.at(-1)?.type,'sleep');
 choose(w,r,'wait',2);stepWorld(w,2);assert.equal(r.recentActions?.at(-1)?.type,'wait');
 const start={...r.at},move=choose(w,r,'move');let limit=150;while(r.plan||r.activity){assert.ok(limit--);stepWorld(w,1);}assert.equal(move.type,'move');assert.notDeepEqual(r.at,start);assert.deepEqual(r.at,(move as Extract<Action,{type:'move'}>).to);
 assert.deepEqual({birth:r.bornAt,stage:r.lifeStage,canDecide:r.canDecide,canExpress:r.canExpress},original);assert.equal(knownAgeYears(r.bornAt,w.minute),null);
});

test('selfcare: absent own food, lost bed and blocked route cannot substitute other people or public assets',()=>{
 const {w,r}=fixture();r.inventory={};const home=bed(w,r);home.residents=home.residents.filter(id=>id!==r.id);
 const choices=actions(w,r);assert.ok(!choices.some(a=>a.type==='eat'||a.type==='sleep'));
 assert.ok(!choices.some(a=>['commons','publicDuty','household','agency','industry','economy','gather','cook'].includes(a.type)));
 r.inside=null;r.roomAt=null;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(r.at.y+dy)*w.map.width+r.at.x+dx]='cliff';
 assert.ok(!actions(w,r).some(a=>a.type==='move'));
 r.health=1;r.hunger=98;assert.equal(hasTimelySelfRescue(w,r,actions(w,r)),false);
});

test('selfcare: unknown to valid under-six rejects an old menu and an active final fraction',()=>{
 for(const stage of ['before submission','last fraction'] as const){const {w,r}=fixture();const choices=menu(w,r),eat=choices.find(c=>c.action.type==='eat')!;assert.ok(eat);
  const d=parseChoice(JSON.stringify({choice:eat.id}),choices);
  if(stage==='last fraction'){choose(w,r,'eat');stepWorld(w,4.75);}
  r.bornAt=w.minute-5*YEAR;
  assert.equal(hasTimelySelfRescue(w,r,[eat.action]),false);
  if(stage==='before submission')assert.equal(submitPlan(w,{id:'late',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],...d}).ok,false);
  else {stepWorld(w,.25);assert.equal(r.inventory.meal,2);assert.ok(r.lastFailure);}
  assert.ok(!actions(w,r).some(a=>['eat','sleep','move','wait'].includes(a.type)));
 }
 const {w,r}=fixture();r.bornAt=w.minute-6*YEAR;choose(w,r,'eat');stepWorld(w,5);assert.equal(r.inventory.meal,1);
});

for(const need of ['hunger','exhaustion'] as const)test(`selfcare: default runtime competition protects real ${need} rescue and executes the actual numbered reply`,async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const {w,r}=fixture();r.health=need==='hunger'?1:.5;r.hunger=need==='hunger'?98:10;r.energy=need==='hunger'?80:0;if(need==='exhaustion')bed(w,r);
 const rival=w.residents[1];rival.health=10;rival.hunger=99;rival.decisionDue=w.minute;
 const store=new WorldStore(':memory:');store.commit(w,null);let finish!: (result:ModelResult)=>void;const calls:string[]=[];
 const runtime=new ValleyRuntime(store,'offline-selfcare',async(_key,c)=>{calls.push(c.actor.id);return c.actor.id===r.id?new Promise(resolve=>{finish=resolve;}):pending();});
 try{runtime.start();assert.ok(calls.includes(r.id));assert.ok(calls.includes(rival.id));const initial=runtime.world.residents[0].health;
  for(let i=0;i<30;i++)runtime.tick(now+=1000);
  const p=runtime.world.residents[0];assert.equal(p.health,initial);assert.equal(p.status,'alive');assert.equal(runtime.world.clock.paused,false);assert.ok(p.decisionProtection!.prevented[need]>0);assert.equal(p.decisionProtection!.expiresAt-p.decisionProtection!.startedAt,180);
  const choices=menu(runtime.world,p),choice=choices.find(c=>c.action.type===(need==='hunger'?'eat':'sleep'))!;
  finish({decision:parseChoice(JSON.stringify({choice:choice.id,...(choice.chooseDuration?{minutes:30}:{})}),choices),inputTokens:1,outputTokens:1,latencyMs:30_000});await flush();
  for(let i=0;i<7;i++)runtime.tick(now+=1000);
  const result=runtime.world.residents[0];assert.equal(result.status,'alive');assert.ok(need==='hunger'?result.inventory.meal===1:result.energy>0);assert.equal(result.decisionProtection?.reason,'decision');
 }finally{runtime.stop();store.close();}
});

test('selfcare: SQLite restart preserves unknown birth and original protection deadline',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const {w,r}=fixture();birth(r,undefined);r.health=1;r.hunger=98;r.energy=80;
 const store=new WorldStore(':memory:');store.commit(w,null);let runtime=new ValleyRuntime(store,'offline-selfcare',pending);
 try{runtime.start();runtime.tick(now+=1000);const expiresAt=runtime.world.residents[0].decisionProtection?.expiresAt;assert.ok(expiresAt);runtime.stop();
  runtime=new ValleyRuntime(store,'offline-selfcare',pending);runtime.start();runtime.tick(now+=1000);const p=runtime.world.residents[0];assert.equal(Object.hasOwn(p,'bornAt'),false);assert.equal(p.decisionProtection?.expiresAt,expiresAt);assert.ok(actions(runtime.world,p).some(a=>a.type==='eat'));
 }finally{runtime.stop();store.close();}
});

for(const cause of ['no personal food','too little time','spoils before completion'] as const)test(`selfcare: ${cause} gives no false hunger protection`,()=>{
 const {w,r}=fixture();r.health=cause==='too little time'?.1:1;r.hunger=98;r.energy=80;
 if(cause==='no personal food')r.inventory={};
 if(cause==='spoils before completion')for(const lot of w.food!.lots['person:'+r.id].meal??[])lot.expiresAt=w.minute+2;
 assert.equal(hasTimelySelfRescue(w,r,actions(w,r)),false);
 stepWorld(w,30,{decisionChoices:actions});assert.equal(r.decisionProtection,undefined);assert.equal(r.status,'dead');
});

test('selfcare: a real bed alone supports exhaustion rescue, but a lost bed stops current protection',()=>{
 const {w,r}=fixture(),b=bed(w,r);r.inventory={};r.hunger=10;r.energy=0;r.health=.5;
 assert.equal(hasTimelySelfRescue(w,r,actions(w,r)),true);
 stepWorld(w,1,{decisionChoices:actions});const state=r.decisionProtection!;assert.equal(r.health,.5);assert.equal(state.endedAt,null);
 const stale=actions(w,r);b.capacity=0;stepWorld(w,1,{decisionChoices:()=>stale});assert.equal(r.decisionProtection?.reason,'unavailable');assert.ok(r.health<.5);assert.equal(r.decisionProtection?.expiresAt,state.expiresAt);
});

test('selfcare: unknown to a verified adult or six-year-old uses current rights without rewriting birth',()=>{
 for(const age of [6,18]){const {w,r}=fixture();choose(w,r,'eat');stepWorld(w,4.75);r.bornAt=w.minute-age*YEAR;const value=r.bornAt;stepWorld(w,.25);assert.equal(r.inventory.meal,1);assert.equal(r.bornAt,value);}
});

test('selfcare: saturated default slots still protect a queued capable unknown and reject a stale reply after loss of expression',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const {w,r}=fixture();r.decisionDue=w.minute+2;r.health=1;r.hunger=98;r.energy=80;
 for(const p of w.residents.slice(1,5)){p.health=10;p.hunger=99;p.decisionDue=w.minute;}
 const store=new WorldStore(':memory:');store.commit(w,null);const calls:string[]=[],finish=new Map<string,(m:ModelResult)=>void>();
 const runtime=new ValleyRuntime(store,'offline-selfcare',async(_key,c)=>{calls.push(c.actor.id);return new Promise(resolve=>finish.set(c.actor.id,resolve));});
 try{runtime.world.migration!.contacts=[];runtime.world.foreignTrade!.merchants=[];runtime.start();assert.equal(calls.length,4);assert.ok(!calls.includes(r.id));for(let i=0;i<10;i++)runtime.tick(now+=1000);
  const p=runtime.world.residents[0];assert.equal(p.status,'alive');assert.ok(p.decisionProtection!.prevented.hunger>0);const deadline=p.decisionProtection!.expiresAt;
  const blocker=runtime.world.residents.find(p=>p.id===calls[0])!,choices=menu(runtime.world,blocker),wait=choices.find(c=>c.action.type==='wait')!;
  finish.get(blocker.id)!({decision:parseChoice(JSON.stringify({choice:wait.id,minutes:100}),choices),inputTokens:1,outputTokens:1,latencyMs:1});await flush();assert.ok(calls.includes(r.id));
  const current=runtime.world.residents[0],oldChoices=menu(runtime.world,current),eat=oldChoices.find(c=>c.action.type==='eat')!;current.canExpress=false;
  finish.get(r.id)!({decision:parseChoice(JSON.stringify({choice:eat.id}),oldChoices),inputTokens:1,outputTokens:1,latencyMs:1});await flush();runtime.tick(now+=1000);
  const after=runtime.world.residents[0];assert.equal(after.inventory.meal,2);assert.equal(after.plan,null);assert.equal(after.activity,null);assert.equal(after.decisionProtection?.reason,'incapable');assert.equal(after.decisionProtection?.expiresAt,deadline);
 }finally{runtime.stop();store.close();}
});

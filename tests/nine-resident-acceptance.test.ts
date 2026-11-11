import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {submitPlan} from '../src/world/engine.js';
import {DecisionWaitEvidence,type DecisionWaitEvent} from '../src/server/decision-wait-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {NINE_RESIDENT_PLAN,prepareNineResidentAcceptance,auditRuntimeFoodEvidence,auditDecisionWaitEvidence,observedEatingByDay} from '../src/server/nine-resident-acceptance.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import type {ModelResult} from '../src/server/decisions.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function offline(t:TestContext){
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('External calls are forbidden');});
 return {advance(ms=1000){return now+=ms;},now:()=>now};
}
function fixture(t:TestContext,observe?:(event:RuntimeFoodEvent)=>void){
 const clock=offline(t),world=createFrontierWorld();
 for(const r of world.residents){r.lastDecisionAt=world.minute;r.decisionDue=world.minute+1000;}
 const actor=world.residents[0];
 assert.equal(submitPlan(world,{id:'offline-meal',actorId:actor.id,actorRevision:actor.revision,createdAt:world.minute,
  definition:world.activeDefinitions['action/routine'],intention:'Offline test',actions:[{type:'eat',item:'meal'},{type:'wait',minutes:30}]}).ok,true);
 const store=new WorldStore(':memory:');store.commit(world,null);
 const events:RuntimeFoodEvent[]=[];
 const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('No model call expected');},
  {mode:'formal',modelSlots:16,directEatingEvidence:{observe:observe??(e=>{events.push(e);})}});
 t.after(()=>{runtime.stop();store.close();});runtime.start();
 return {clock,store,runtime,events,advance(){runtime.tick(clock.advance());}};
}

test('preparation pins the formal nine-person seed and 15 elapsed game days without running a model',()=>{
 const a=prepareNineResidentAcceptance('a'.repeat(64)),b=prepareNineResidentAcceptance('a'.repeat(64));
 assert.deepEqual(a,b);assert.equal(a.realModelExecuted,false);assert.equal(a.acceptancePassed,null);assert.equal(a.readyForRealRun,false);
 assert.equal(a.initial.residentIds.length,9);assert.equal(a.initial.minute,480);
 assert.deepEqual(a.initial.residentIds,NINE_RESIDENT_PLAN.residentIds);assert.equal(Object.isFrozen(NINE_RESIDENT_PLAN.residentIds),true);
 assert.equal(a.plan.expectedEndMinute-a.initial.minute,21600);assert.equal(a.plan.modelSlots,16);
 assert.equal(a.coverage.foodProduction.value,null);assert.equal(a.coverage.foodConsumption.value,null);
 assert.equal(Object.isFrozen(NINE_RESIDENT_PLAN),true);assert.throws(()=>prepareNineResidentAcceptance('not-a-hash'));
});

test('preparation CLI has no run mode and repeats identical source and seed fingerprints',()=>{
 const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx','scripts/prepare-nine-resident-acceptance.mjs',...args],{encoding:'utf8'});
 const a=run(['--prepare']),b=run(['--prepare']);assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);
 assert.equal(a.stdout,b.stdout);const result=JSON.parse(a.stdout);
 assert.ok(result.sourceFiles.length>100);assert.ok(result.sourceFiles.every((file:{path:string})=>!/(^|\/)(runtime|\.env|secrets)(\/|$)/.test(file.path)));
 for(const args of [[],['--run'],['--prepare','--run'],['--prepare','--database','runtime/world.sqlite']]){
  const blocked=run(args);assert.equal(blocked.status,2);assert.equal(blocked.stdout,'');
 }
});

test('committed runtime meals have exact fractional coverage and are absent from world and save',t=>{
 const f=fixture(t);for(let i=0;i<6;i++)f.advance();f.runtime.stop();
 const report=auditRuntimeFoodEvidence(f.events,f.runtime.directEatingEvidenceStatus());
 assert.equal(report.complete,true);assert.equal(report.totals!.completedActions,1);assert.deepEqual(report.totals!.units,{meal:1});
 assert.equal(report.observedGameMinutes,f.runtime.world.minute-480);assert.equal(report.foodConsumption,null);
 const step=f.events.find((e):e is Extract<RuntimeFoodEvent,{type:'food_step_committed'}>=>e.type==='food_step_committed'&&e.receipts.length>0)!;
 assert.equal(f.store.loadForRuntime()!.residents[0].inventory.meal,0);
 assert.ok(f.store.history(f.runtime.world.id,Number.MAX_SAFE_INTEGER).some(e=>e.id===step.receipts[0].eventId));
 assert.equal(Object.isFrozen(step),true);assert.equal(Object.isFrozen(step.receipts),true);assert.equal(Object.isFrozen(step.receipts[0]),true);
 assert.throws(()=>{(step.receipts[0] as {quantity:number}).quantity=10;},TypeError);
 assert.equal(JSON.stringify(f.runtime.world).includes('food_session_'),false);assert.equal(JSON.stringify(f.runtime.snapshot()).includes('food_step_committed'),false);
 assert.equal(JSON.stringify(f.events).includes('OFFLINE_DUMMY'),false);
});

test('missing observation is unknown while a fully observed zero-advance paused session has no meals',t=>{
 offline(t);const store=new WorldStore(':memory:'),events:RuntimeFoodEvent[]=[];
 const plain=new ValleyRuntime(store,null);assert.equal(plain.directEatingEvidenceStatus(),null);plain.stop();
 const runtime=new ValleyRuntime(store,null,async()=>{throw new Error('No model');},{directEatingEvidence:{observe:e=>{events.push(e);}}});
 try{runtime.start();runtime.tick(Date.now()+2000);runtime.stop();
  const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());assert.equal(report.complete,true);
  assert.equal(report.observedGameMinutes,0);assert.equal(report.totals!.completedActions,0);
  assert.equal(auditRuntimeFoodEvidence([],null).totals,null);
 }finally{runtime.stop();store.close();}
});

test('store commit failure cannot publish draft-only eating',t=>{
 const f=fixture(t);for(let i=0;i<4;i++)f.advance();
 const before=structuredClone(f.runtime.world),length=f.events.length;
 t.mock.method(f.store,'commit',()=>{throw new Error('Offline injected storage failure');});
 assert.throws(()=>f.advance(),/storage failure/);assert.deepEqual(f.runtime.world,before);assert.equal(f.events.length,length);
 f.runtime.stop();assert.equal(auditRuntimeFoodEvidence(f.events,f.runtime.directEatingEvidenceStatus()).totals!.completedActions,0);
});

test('committed receipts precede subscriber errors and remain exactly once',t=>{
 const f=fixture(t);for(let i=0;i<4;i++)f.advance();
 const unsubscribe=f.runtime.subscribe(()=>{throw new Error('Offline listener failure');});
 assert.throws(()=>f.advance(),/listener failure/);unsubscribe();f.advance();f.runtime.stop();
 const report=auditRuntimeFoodEvidence(f.events,f.runtime.directEatingEvidenceStatus());
 assert.equal(report.complete,true);assert.equal(report.totals!.completedActions,1);assert.equal(f.runtime.world.residents[0].inventory.meal,0);
});

test('throwing and async food sinks fail closed without aborting simulation',async t=>{
 const f=fixture(t,event=>{if(event.type==='food_step_committed')throw new Error('PRIVATE_ERROR');});
 for(let i=0;i<6;i++)f.advance();assert.equal(f.runtime.world.residents[0].inventory.meal,0);
 assert.equal(f.runtime.directEatingEvidenceStatus()!.failure,'observer_threw');
 assert.equal(auditRuntimeFoodEvidence([],f.runtime.directEatingEvidenceStatus()).totals,null);
 const recorder=new RuntimeFoodEvidence({observe:async()=>{throw new Error('PRIVATE_ASYNC');}});recorder.start('fixture',0);await flush();
 assert.equal(recorder.status().failure,'async_observer');assert.equal(JSON.stringify(recorder.status()).includes('PRIVATE_'),false);
});

test('lost rows, duplicate receipts, wrong session, bad receipt time and missing close invalidate totals',t=>{
 const f=fixture(t);for(let i=0;i<6;i++)f.advance();f.runtime.stop();const status=f.runtime.directEatingEvidenceStatus();
 const bad:RuntimeFoodEvent[][]=[f.events.slice(0,-1),f.events.filter((_,i)=>i!==1)];
 for(const kind of ['session','duplicate','time','endpoint'] as const){
  const events=structuredClone(f.events) as RuntimeFoodEvent[];
  const meal=events.find((e):e is Extract<RuntimeFoodEvent,{type:'food_step_committed'}>=>e.type==='food_step_committed'&&e.receipts.length>0)!;
  if(kind==='session')(meal as {sessionId:string}).sessionId='other-session';
  if(kind==='duplicate')(meal.receipts as unknown[]).push({...meal.receipts[0]});
  if(kind==='time')(meal.receipts[0] as {at:number}).at=meal.fromMinute;
  if(kind==='endpoint')(meal as {toMinute:number}).toMinute++;
  bad.push(events);
 }
 for(const rows of bad){const report=auditRuntimeFoodEvidence(rows,status);assert.equal(report.complete,false);assert.equal(report.totals,null);}
});

test('midnight uses receipt timestamp without pretending fractional step snapshots are minute samples',()=>{
 const events:RuntimeFoodEvent[]=[];const recorder=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});recorder.start('fixture',1439.5);
 const receipt={at:1440,residentId:'a',eventId:'one',planId:'p',container:'person:a',item:'meal' as const,quantity:1,nutrition:10,hungerRelief:2};
 recorder.committed({worldId:'fixture',fromMinute:1439.5,toMinute:1441.25,receipts:[receipt,{...receipt,at:1441,eventId:'two'}]},7);recorder.stop('fixture',1441.25);
 assert.deepEqual(observedEatingByDay(events).map(d=>[d.calendarDay,d.receipts.length]),[[0,1],[1,1]]);
 assert.equal(auditRuntimeFoodEvidence(events,recorder.status()).observedGameMinutes,1.75);
});

test('wait audit preserves censored waits and unknown durations on incomplete output',()=>{
 const events:DecisionWaitEvent[]=[],recorder=new DecisionWaitEvidence({observe:e=>{events.push(e);},monotonicNow:()=>1});
 recorder.start(480);recorder.reconcile([{actorId:'a',actorKind:'resident'}],480);recorder.stop(480);
 const report=auditDecisionWaitEvidence(events,recorder.status());assert.equal(report.complete,true);assert.equal(report.counts!.censoredWaits,1);
 assert.equal(report.counts!.acceptedWaits,0);assert.equal(report.aggregateWorldWaitMs,null);
 assert.equal(auditDecisionWaitEvidence(events.slice(1),recorder.status()).counts,null);assert.equal(auditDecisionWaitEvidence([],null).counts,null);
});

test('both evidence channels preserve formal nine-person runtime, model calls, contexts and memory reload',async t=>{
 const clock=offline(t),base=createFrontierWorld(),stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];
 for(const store of stores)store.commit(structuredClone(base),null);
 const food:RuntimeFoodEvent[]=[],wait:DecisionWaitEvent[]=[],calls:unknown[][]=[[],[]];
 const result:ModelResult={decision:{intention:'Offline fake model only',actions:[{type:'eat',item:'meal'},{type:'wait',minutes:60}]},inputTokens:1,outputTokens:1,latencyMs:1};
 const runtimes=stores.map((store,i)=>new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async(_key,context)=>{
  calls[i].push(structuredClone(context));return result;
 },{mode:'formal',dayMinutes:20,modelSlots:16,...(i?{directEatingEvidence:{observe:(e:RuntimeFoodEvent)=>{food.push(e);}},
  decisionWaitEvidence:{observe:(e:DecisionWaitEvent)=>{wait.push(e);},monotonicNow:clock.now}}:{})}));
 try{
  for(const runtime of runtimes)runtime.start();await flush();await flush();
  for(let i=0;i<6;i++){const now=clock.advance();for(const runtime of runtimes)runtime.tick(now);await flush();}
  for(const runtime of runtimes)runtime.stop();
  assert.deepEqual(calls[0],calls[1]);assert.deepEqual(runtimes[0].world,runtimes[1].world);
  assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
  assert.equal(auditRuntimeFoodEvidence(food,runtimes[1].directEatingEvidenceStatus()).totals!.completedActions,9);
  assert.equal(auditDecisionWaitEvidence(wait,runtimes[1].decisionWaitEvidenceStatus()).complete,true);
  const oldSession=runtimes[1].directEatingEvidenceStatus()!.sessionId,newEvents:RuntimeFoodEvent[]=[];
  const next=new ValleyRuntime(stores[1],null,async()=>{throw new Error('No model');},{directEatingEvidence:{observe:e=>{newEvents.push(e);}}});
  next.start();next.stop();assert.notEqual(next.directEatingEvidenceStatus()!.sessionId,oldSession);
  assert.equal(auditRuntimeFoodEvidence(newEvents,next.directEatingEvidenceStatus()).totals!.completedActions,0);
 }finally{for(const runtime of runtimes)runtime.stop();for(const store of stores)store.close();}
});

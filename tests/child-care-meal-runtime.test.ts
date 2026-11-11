import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync,fsyncSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditRuntimeFoodEvidence,observedChildCareMealsByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import type {ChildCareMealReceipt,DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {childCareFixture,originalChildLots,queueChildCare} from './helpers/child-care-meal-evidence.js';

function actual(){const f=childCareFixture();originalChildLots(f);queueChildCare(f);return {f,observation:stepWorldWithFoodEvidence(f.w,20)};}
function session(childCareMeals:ChildCareMealReceipt[]|undefined,extra:Partial<DirectEatingObservation>={}){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('child-runtime',480);
 food.committed({worldId:'child-runtime',fromMinute:480,toMinute:510,receipts:[],foodFlows:[],careMeals:[],...(childCareMeals===undefined?{}:{childCareMeals}),...extra},1);
 food.stop('child-runtime',510);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}

test('child meals runtime: actual operation emits independent deeply frozen facts, distinct from ordinary care and eat',()=>{
 const {observation}=actual(),source=observation.childCareMeals![0],f=session([source]);
 const step=f.events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 assert.ok(Object.isFrozen(step.childCareMeals));assert.ok(Object.isFrozen(step.childCareMeals![0].inputs));assert.ok(Object.isFrozen(step.childCareMeals![0].inputs[0].lots![0]));
 source.inputs[0].quantity=99;source.inputs[0].lots![0].nutrition=99;
 assert.equal(step.childCareMeals![0].inputs[0].quantity,1);assert.equal(step.childCareMeals![0].inputs[0].lots![0].nutrition,2.5);
 assert.equal(f.report.childCareMeals.complete,true);assert.deepEqual(f.report.childCareMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:48,completedActions:1});
 assert.equal(f.report.totals!.completedActions,0);assert.equal(f.report.careMeals.totals!.completedActions,0);assert.equal(f.report.foodConsumption,null);assert.equal(f.report.foodProduction,null);
});

test('child meals runtime: legacy absence is unknown, explicit empty is zero, lost boundaries and zero steps remain unknown',()=>{
 const f=session([]),legacy=session(undefined);assert.equal(f.report.childCareMeals.complete,true);assert.equal(f.report.childCareMeals.totals!.completedActions,0);
 assert.equal(legacy.report.complete,true);assert.equal(legacy.report.childCareMeals.totals,null);assert.deepEqual(checkedFoodEvent(legacy.events[1]),legacy.events[1]);
 for(const events of [f.events.slice(1),f.events.slice(0,-1)])assert.equal(auditRuntimeFoodEvidence(events,f.food.status()).childCareMeals.totals,null);
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start('child-runtime',480);food.stop('child-runtime',480);
 assert.equal(auditRuntimeFoodEvidence(events,food.status()).childCareMeals.totals,null);
 const old={...legacy.events[1]} as any;delete old.foodFlows;delete old.careMeals;assert.deepEqual(checkedFoodEvent(old),old);
});

test('child meals runtime: strict writer schema rejects extras, getters, symbols, sparse arrays and nonfinite values at every new level',()=>{
 const valid=session(actual().observation.childCareMeals).events[1];assert.deepEqual(checkedFoodEvent(valid),valid);
 const targets=(e:any)=>[e.childCareMeals[0],e.childCareMeals[0].inputs[0],e.childCareMeals[0].inputs[0].lots[0]];
 for(let level=0;level<3;level++)for(const kind of ['extra','getter','symbol'] as const){
  const bad=structuredClone(valid);let calls=0;const target=targets(bad)[level];
  if(kind==='extra')target.prompt='SYNTHETIC_PRIVATE';
  if(kind==='symbol')target[Symbol('extra')]=true;
  if(kind==='getter'){const key=level===0?'hungerBefore':'quantity';Object.defineProperty(target,key,{get(){calls++;return 1;}});}
  assert.throws(()=>checkedFoodEvent(bad),/invalid_evidence_schema/);assert.equal(calls,0);
 }
 for(let level=0;level<3;level++)for(const kind of ['sparse','getter','extra'] as const){
  const bad:any=structuredClone(valid),array=[bad.childCareMeals,bad.childCareMeals[0].inputs,bad.childCareMeals[0].inputs[0].lots][level];let calls=0;
  if(kind==='sparse')delete array[0];if(kind==='getter')Object.defineProperty(array,'0',{get(){calls++;return {};}});if(kind==='extra')array.note='PRIVATE';
  assert.throws(()=>checkedFoodEvent(bad));assert.equal(calls,0);
 }
 for(const value of [Infinity,NaN,-1,'1',null]){const bad:any=structuredClone(valid);bad.childCareMeals[0].inputs[0].quantity=value;assert.throws(()=>checkedFoodEvent(bad));}
 for(const patch of [{proposalId:null},{authority:'emergency'},{action:'care'}]){const bad:any=structuredClone(valid);Object.assign(bad.childCareMeals[0],patch);assert.throws(()=>checkedFoodEvent(bad));}
});

test('child meals runtime: original unknown nutrition stays null and invalid amounts, identities, batches or fixed relief never yield totals',()=>{
 const original=actual().observation.childCareMeals![0];
 for(const lots of [null,[{...original.inputs[0].lots![0],quantity:1,nutrition:null}]]){
  const r=structuredClone(original);r.inputs[0].lots=lots;r.inputs[0].nutrition=null;
  const result=session([r]).report.childCareMeals;assert.equal(result.complete,true);assert.equal(result.totals!.nutrition,null);assert.equal(result.totals!.hungerRelief,48);
 }
 const edits:Array<(r:ChildCareMealReceipt)=>void>=[
  r=>{r.inputs[0].lots=null;},r=>{r.inputs[0].lots=[];},r=>{r.inputs[0].lots![0].quantity=3;},r=>{r.inputs[0].lots![0].nutrition=null;},
  r=>{r.inputs[0].lots![0].nutrition=999;},r=>{r.inputs[0].lots![0].producedAt=r.at+1;},r=>{r.inputs[0].lots![0].expiresAt=r.at;},
  r=>{r.inputs[0].quantity=0;},r=>{r.inputs[0].item='berry';},r=>{r.inputs[1].item='meal';},r=>{r.inputs[1].nutrition=1;},r=>{r.inputs[1].lots=null;},
  r=>{r.beneficiaryId=r.providerId;},r=>{r.container='vessel:water';},r=>{r.container='person:'+r.beneficiaryId;},
  r=>{r.hungerAfter=r.hungerBefore;r.hungerRelief=0;},r=>{r.hungerAfter=r.hungerBefore-22;r.hungerRelief=22;},r=>{r.hungerAfter=0;r.hungerRelief=r.hungerBefore;},
  r=>{r.hungerBefore=11;r.hungerAfter=0;r.hungerRelief=11;},r=>{r.at=480;},r=>{r.at=511;},
 ];
 for(const edit of edits){const bad=structuredClone(original);edit(bad);assert.equal(session([bad]).report.childCareMeals.totals,null);}
 for(const before of [12,20,48]){const r=structuredClone(original);r.hungerBefore=before;r.hungerAfter=0;r.hungerRelief=before;assert.equal(session([r]).report.childCareMeals.complete,true);}
 const turnip=structuredClone(original);turnip.inputs[0].item='turnip';assert.equal(session([turnip]).report.childCareMeals.totals!.units.turnip,1);
 const invalid=structuredClone(original);invalid.inputs[0].quantity=NaN;assert.equal(session([invalid]).food.status().phase,'failed');
});

test('child meals runtime: duplicate event IDs within child tending or across food evidence slices invalidate its totals',()=>{
 const r=actual().observation.childCareMeals![0];assert.equal(session([r,r]).report.childCareMeals.totals,null);
 const eat={at:r.at,residentId:r.providerId,eventId:r.eventId,planId:r.planId,container:r.container,item:'meal' as const,quantity:1,nutrition:25,hungerRelief:25};
 assert.equal(session([r],{receipts:[eat]}).report.childCareMeals.totals,null);
 const flow={type:'processed' as const,action:'cook' as const,at:r.at,residentId:r.providerId,eventId:r.eventId,planId:r.planId,container:r.container,definition:r.definition,inputs:r.inputs,outputs:r.inputs};
 assert.equal(session([r],{foodFlows:[flow]}).report.childCareMeals.totals,null);
 const care={...r,action:'care' as const,proposalId:null,hungerAfter:r.hungerBefore-22,hungerRelief:22};
 const report=session([r],{careMeals:[care]}).report;assert.equal(report.childCareMeals.totals,null);assert.equal(report.careMeals.totals,null);
});

test('child meals runtime: exact midnight belongs to ending day and fractional later receipt does not fabricate empty days',()=>{
 const first=actual().observation.childCareMeals![0],second=structuredClone(first);first.at=1440;second.at=1440.25;second.eventId='child-next';
 const event={...session([]).events[1],fromMinute:1439.75,toMinute:1440.5,childCareMeals:[first,second]} as RuntimeFoodEvent;
 assert.deepEqual(observedChildCareMealsByDay([event]).map(d=>[d.calendarDay,d.receipts.map(r=>r.at)]),[[0,[1440]],[1,[1440.25]]]);
 assert.deepEqual(observedChildCareMealsByDay([]),[]);assert.deepEqual(observedChildCareMealsByDay(session(undefined).events),[]);
});

function persist(directory:string,observation:DirectEatingObservation){
 const fingerprint='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:observation.worldId,fromMinute:observation.fromMinute});
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(observation.fromMinute);food.start(observation.worldId,observation.fromMinute);food.committed(observation,1);wait.stop(observation.toMinute);food.stop(observation.worldId,observation.toMinute);
 const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});return {writer,report};
}
test('child meals writer: sealed real facts roundtrip; legacy omission survives roundtrip as unknown',t=>{
 const root=mkdtempSync(join(testTmpdir(),'child-meal-roundtrip-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const {observation}=actual();
 const {writer,report}=persist(join(root,'new'),observation);t.after(()=>writer.abort());assert.equal(report.complete,true);assert.equal(report.childCareMeals.totals!.nutrition,25);assert.equal(report.childCareMeals.totals!.hungerRelief,48);assert.deepEqual(readAcceptanceEvidence(join(root,'new')),report);
 delete observation.childCareMeals;const old=persist(join(root,'old'),observation);t.after(()=>old.writer.abort());assert.equal(old.report.complete,true);assert.equal(old.report.childCareMeals.totals,null);assert.equal(old.report.directEating.childCareMeals.totals,null);
});

test('child meals writer: corruption or missing close seal clears both exposed child totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'child-meal-broken-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const mode of ['corrupt','missing'] as const){const directory=join(root,mode),{writer}=persist(directory,actual().observation);t.after(()=>writer.abort());
  if(mode==='missing')unlinkSync(join(directory,'run-close.json'));else{const path=join(directory,'evidence.jsonl');writeFileSync(path,readFileSync(path,'utf8').replace('"hungerRelief":48','"hungerRelief":47'));}
  const broken=readAcceptanceEvidence(directory);assert.equal(broken.complete,false);assert.equal(broken.childCareMeals.totals,null);assert.equal(broken.directEating.childCareMeals.totals,null);
 }
});

test('child meals writer: journal sync failure after real world completion never claims durable evidence',t=>{
 const root=mkdtempSync(join(testTmpdir(),'child-meal-sync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const {f,observation}=actual(),before=structuredClone(f.w);let fail=false;
 const directory=join(root,'run'),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:observation.worldId,fromMinute:observation.fromMinute,io:{fsyncSync(fd){if(fail)throw new Error('Offline sync failure');fsyncSync(fd);}}});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});food.start(observation.worldId,observation.fromMinute);fail=true;food.committed(observation,1);
 assert.equal(food.status().phase,'failed');assert.equal(writer.status().failure,'sync_failed');assert.deepEqual(f.w,before);
 const broken=readAcceptanceEvidence(directory);assert.equal(broken.complete,false);assert.equal(broken.childCareMeals.totals,null);assert.equal(broken.directEating.childCareMeals.totals,null);
});

test('child meals runtime: failed durable commit leaves world and personal debit unchanged, then retry publishes exactly one actual receipt',async t=>{
 const {ValleyRuntime}=await import('../src/server/runtime.js');const {WorldStore}=await import('../src/server/store.js');const {QWEN_MODEL}=await import('../src/server/model-completion.js');
 t.mock.timers.enable({apis:['setInterval']});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Offline test forbids network');});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=childCareFixture();originalChildLots(f);queueChildCare(f);stepWorld(f.w,1);f.provider.activity!.remaining=1;
 for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+1000;}
 const store=new WorldStore(':memory:');store.commit(f.w,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[],runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('Offline injected decision stub');},{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 let attempted=false;const original=store.commit.bind(store),mock=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  if(args[0].events.some(e=>e.audit?.scope.includes('feed-child'))){attempted=true;throw new Error('Synthetic child meal commit failure');}return original(...args);
 });
 for(let i=0;i<20&&!attempted;i++){const before=structuredClone(runtime.world),count=events.length;try{runtime.tick(now+=1000);}catch(error){assert.match(String(error),/child meal commit failure/);assert.equal(events.length,count);assert.deepEqual(runtime.world,before);}}
 assert.equal(attempted,true);assert.equal(store.loadForRuntime()!.residents.find(r=>r.id===f.provider.id)!.inventory.meal,10);
 assert.equal(events.flatMap(e=>e.type==='food_step_committed'?e.childCareMeals??[]:[]).length,0);
 mock.mock.restore();runtime.tick(now+=1000);runtime.stop();const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());
 assert.equal(report.childCareMeals.complete,true);assert.deepEqual(report.childCareMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:48,completedActions:1});
 const loaded=store.loadForRuntime()!;assert.equal(loaded.residents.find(r=>r.id===f.provider.id)!.inventory.meal,9);assert.equal(loaded.events.filter(e=>e.audit?.scope.includes('feed-child')).length,1);assert.equal(calls,0);
});

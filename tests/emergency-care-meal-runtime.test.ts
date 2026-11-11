import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync,fsyncSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditRuntimeFoodEvidence,observedEmergencyCareMealsByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {auditEmergencyCareMeals} from '../src/server/emergency-care-meal-evidence.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import type {EmergencyCareMealReceipt,DirectEatingObservation} from '../src/world/food-consumption-evidence.js';

function synthetic(){
 const receipt:EmergencyCareMealReceipt={action:'emergencyCare',operation:'feed',at:500,providerId:'provider',beneficiaryId:'beneficiary',
  eventId:'visit-1',planId:'plan-1',container:'person:provider',definition:'care@1',agreementId:'agreement-1',mealNumber:1,
  inputs:[{item:'meal',quantity:1,nutrition:25,lots:[{quantity:1,producedAt:480,expiresAt:2000,definition:'food@1',nutrition:25}]},
   {item:'water',quantity:1,nutrition:0,lots:[]}],hungerBefore:80,hungerAfter:55,hungerRelief:25};
 const observation:DirectEatingObservation={worldId:'emergency-runtime',fromMinute:480,toMinute:510,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[],emergencyCareMeals:[receipt]};
 return {observation};
}
function session(emergencyCareMeals:EmergencyCareMealReceipt[]|undefined,extra:Partial<DirectEatingObservation>={}){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('emergency-runtime',480);
 food.committed({worldId:'emergency-runtime',fromMinute:480,toMinute:510,receipts:[],foodFlows:[],careMeals:[],childCareMeals:[],...(emergencyCareMeals===undefined?{}:{emergencyCareMeals}),...extra},1);
 food.stop('emergency-runtime',510);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}

test('emergency meals runtime: synthetic receipt emits independent deeply frozen facts, distinct from ordinary care and eat',()=>{
 const {observation}=synthetic(),source=observation.emergencyCareMeals![0],f=session([source]);
 const step=f.events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 assert.ok(Object.isFrozen(step.emergencyCareMeals));assert.ok(Object.isFrozen(step.emergencyCareMeals![0].inputs));assert.ok(Object.isFrozen(step.emergencyCareMeals![0].inputs[0].lots![0]));
 source.inputs[0].quantity=99;source.inputs[0].lots![0].nutrition=99;
 assert.equal(step.emergencyCareMeals![0].inputs[0].quantity,1);assert.equal(step.emergencyCareMeals![0].inputs[0].lots![0].nutrition,25);
 assert.equal(f.report.emergencyCareMeals.complete,true);assert.deepEqual(f.report.emergencyCareMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:25,completedActions:1});
 assert.equal(f.report.totals!.completedActions,0);assert.equal(f.report.careMeals.totals!.completedActions,0);assert.equal(f.report.foodConsumption,null);assert.equal(f.report.foodProduction,null);
});

test('emergency meals runtime: legacy absence is unknown, explicit empty is zero, lost boundaries and zero steps remain unknown',()=>{
 const f=session([]),legacy=session(undefined);assert.equal(f.report.emergencyCareMeals.complete,true);assert.equal(f.report.emergencyCareMeals.totals!.completedActions,0);
 assert.equal(legacy.report.complete,true);assert.equal(legacy.report.emergencyCareMeals.totals,null);assert.deepEqual(checkedFoodEvent(legacy.events[1]),legacy.events[1]);
 for(const events of [f.events.slice(1),f.events.slice(0,-1)])assert.equal(auditRuntimeFoodEvidence(events,f.food.status()).emergencyCareMeals.totals,null);
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start('emergency-runtime',480);food.stop('emergency-runtime',480);
 assert.equal(auditRuntimeFoodEvidence(events,food.status()).emergencyCareMeals.totals,null);
 const old={...legacy.events[1]} as any;delete old.foodFlows;delete old.careMeals;assert.deepEqual(checkedFoodEvent(old),old);
});

test('emergency meals runtime: strict writer schema rejects extras, getters, symbols, sparse arrays and nonfinite values at every new level',()=>{
 const valid=session(synthetic().observation.emergencyCareMeals).events[1];assert.deepEqual(checkedFoodEvent(valid),valid);
 const targets=(e:any)=>[e.emergencyCareMeals[0],e.emergencyCareMeals[0].inputs[0],e.emergencyCareMeals[0].inputs[0].lots[0]];
 for(let level=0;level<3;level++)for(const kind of ['extra','getter','symbol'] as const){
  const bad=structuredClone(valid);let calls=0;const target=targets(bad)[level];
  if(kind==='extra')target.prompt='SYNTHETIC_PRIVATE';
  if(kind==='symbol')target[Symbol('extra')]=true;
  if(kind==='getter'){const key=level===0?'hungerBefore':'quantity';Object.defineProperty(target,key,{get(){calls++;return 1;}});}
  assert.throws(()=>checkedFoodEvent(bad),/invalid_evidence_schema/);assert.equal(calls,0);
 }
 for(let level=0;level<3;level++)for(const kind of ['sparse','getter','extra'] as const){
  const bad:any=structuredClone(valid),array=[bad.emergencyCareMeals,bad.emergencyCareMeals[0].inputs,bad.emergencyCareMeals[0].inputs[0].lots][level];let calls=0;
  if(kind==='sparse')delete array[0];if(kind==='getter')Object.defineProperty(array,'0',{get(){calls++;return {};}});if(kind==='extra')array.note='PRIVATE';
  assert.throws(()=>checkedFoodEvent(bad));assert.equal(calls,0);
 }
 for(const value of [Infinity,NaN,-1,'1',null]){const bad:any=structuredClone(valid);bad.emergencyCareMeals[0].inputs[0].quantity=value;assert.throws(()=>checkedFoodEvent(bad));}
 for(const patch of [{proposalId:null},{authority:'emergency'},{action:'care'},{operation:'offer'},{mealNumber:Infinity},{agreementId:''},{mealNumber:'1'}]){const bad:any=structuredClone(valid);Object.assign(bad.emergencyCareMeals[0],patch);assert.throws(()=>checkedFoodEvent(bad));}
});

test('emergency meals runtime: unknown nutrition, bounded coherent deltas and finite totals',()=>{
 const original=synthetic().observation.emergencyCareMeals![0];
 const unknown=structuredClone(original);unknown.inputs[0].nutrition=null;unknown.inputs[0].lots=null;
 assert.equal(session([unknown]).report.emergencyCareMeals.totals!.nutrition,null);
 const changed=structuredClone(original);
 const edits:Array<(r:EmergencyCareMealReceipt)=>void>=[
  r=>{r.inputs[0].lots=null;},r=>{r.inputs[0].lots=[];},r=>{r.inputs[0].lots![0].quantity=3;},
  r=>{r.inputs[0].lots![0].nutrition=null;},r=>{r.inputs[0].lots![0].nutrition=999;},
  r=>{r.inputs[0].lots![0].producedAt=r.at+1;},r=>{r.inputs[0].lots![0].expiresAt=r.at;},
  r=>{r.inputs[0].quantity=0;},r=>{r.inputs.push(r.inputs[0]);},r=>{r.inputs[1].nutrition=1;},
  r=>{r.beneficiaryId=r.providerId;},r=>{r.container='vessel:water';},
  r=>{r.hungerAfter=99;},r=>{r.hungerBefore=101;},r=>{r.hungerRelief=0;},
  r=>{r.at=480;},r=>{r.at=511;},
 ];
 for(const edit of edits){const bad=structuredClone(original);edit(bad);assert.equal(session([bad]).report.emergencyCareMeals.totals,null);}
 const huge=structuredClone(changed);huge.inputs[0].quantity=Number.MAX_VALUE;
 assert.equal(session([huge,{...huge,eventId:'another',mealNumber:2}]).report.emergencyCareMeals.totals,null);
 const invalid=structuredClone(original);invalid.inputs[0].quantity=NaN;assert.equal(session([invalid]).food.status().phase,'failed');
});

test('emergency meals runtime: duplicate event IDs within emergency care or across food evidence slices invalidate its totals',()=>{
 const r=synthetic().observation.emergencyCareMeals![0];assert.equal(session([r,r]).report.emergencyCareMeals.totals,null);
 assert.equal(session([r,{...r,eventId:'different-event'}]).report.emergencyCareMeals.totals,null);
 const eat={at:r.at,residentId:r.providerId,eventId:r.eventId,planId:r.planId,container:r.container,item:'meal' as const,quantity:1,nutrition:25,hungerRelief:25};
 assert.equal(session([r],{receipts:[eat]}).report.emergencyCareMeals.totals,null);
 const flow={type:'processed' as const,action:'cook' as const,at:r.at,residentId:r.providerId,eventId:r.eventId,planId:r.planId,container:r.container,definition:r.definition,inputs:r.inputs,outputs:r.inputs};
 assert.equal(session([r],{foodFlows:[flow]}).report.emergencyCareMeals.totals,null);
 const {operation,agreementId,mealNumber,...base}=r;
 const care={...base,action:'care' as const,authority:'consent' as const,proposalId:null,hungerAfter:r.hungerBefore-22,hungerRelief:22};
 const report=session([r],{careMeals:[care]}).report;assert.equal(report.emergencyCareMeals.totals,null);assert.equal(report.careMeals.totals,null);
 const child={...base,action:'tendChild' as const,authority:'guardian' as const,hungerAfter:r.hungerBefore-48,hungerRelief:48};
 const childReport=session([r],{childCareMeals:[child]}).report;assert.equal(childReport.emergencyCareMeals.totals,null);assert.equal(childReport.childCareMeals.totals,null);

});

test('emergency meals runtime: exact midnight belongs to ending day and fractional later receipt does not fabricate empty days',()=>{
 const first=synthetic().observation.emergencyCareMeals![0],second=structuredClone(first);first.at=1440;second.at=1440.25;second.eventId='child-next';
 const event={...session([]).events[1],fromMinute:1439.75,toMinute:1440.5,emergencyCareMeals:[first,second]} as RuntimeFoodEvent;
 assert.deepEqual(observedEmergencyCareMealsByDay([event]).map(d=>[d.calendarDay,d.receipts.map(r=>r.at)]),[[0,[1440]],[1,[1440.25]]]);
 assert.deepEqual(observedEmergencyCareMealsByDay([]),[]);assert.deepEqual(observedEmergencyCareMealsByDay(session(undefined).events),[]);
});

function persist(directory:string,observation:DirectEatingObservation){
 const fingerprint='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:observation.worldId,fromMinute:observation.fromMinute});
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(observation.fromMinute);food.start(observation.worldId,observation.fromMinute);food.committed(observation,1);wait.stop(observation.toMinute);food.stop(observation.worldId,observation.toMinute);
 const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});return {writer,report};
}
test('emergency meals writer: sealed synthetic facts roundtrip; legacy omission survives roundtrip as unknown',t=>{
 const root=mkdtempSync(join(testTmpdir(),'emergency-meal-roundtrip-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const {observation}=synthetic();
 const {writer,report}=persist(join(root,'new'),observation);t.after(()=>writer.abort());assert.equal(report.complete,true);assert.equal(report.emergencyCareMeals.totals!.nutrition,25);assert.equal(report.emergencyCareMeals.totals!.hungerRelief,25);assert.deepEqual(readAcceptanceEvidence(join(root,'new')),report);
 delete observation.emergencyCareMeals;const old=persist(join(root,'old'),observation);t.after(()=>old.writer.abort());assert.equal(old.report.complete,true);assert.equal(old.report.emergencyCareMeals.totals,null);assert.equal(old.report.directEating.emergencyCareMeals.totals,null);
});

test('emergency meals writer: corruption or missing close seal clears both exposed emergency-care totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'emergency-meal-broken-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const mode of ['corrupt','missing'] as const){const directory=join(root,mode),{writer}=persist(directory,synthetic().observation);t.after(()=>writer.abort());
  if(mode==='missing')unlinkSync(join(directory,'run-close.json'));else{const path=join(directory,'evidence.jsonl');writeFileSync(path,readFileSync(path,'utf8').replace('"hungerRelief":25','"hungerRelief":24'));}
  const broken=readAcceptanceEvidence(directory);assert.equal(broken.complete,false);assert.equal(broken.emergencyCareMeals.totals,null);assert.equal(broken.directEating.emergencyCareMeals.totals,null);
 }
});

test('emergency meals writer: journal sync failure during receipt publication never claims durable evidence',t=>{
 const root=mkdtempSync(join(testTmpdir(),'emergency-meal-sync-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const {observation}=synthetic(),before=structuredClone(observation);let fail=false;
 const directory=join(root,'run'),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:'a'.repeat(64),worldId:observation.worldId,fromMinute:observation.fromMinute,io:{fsyncSync(fd){if(fail)throw new Error('Offline sync failure');fsyncSync(fd);}}});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});food.start(observation.worldId,observation.fromMinute);fail=true;food.committed(observation,1);
 assert.equal(food.status().phase,'failed');assert.equal(writer.status().failure,'sync_failed');assert.deepEqual(observation,before);
 const broken=readAcceptanceEvidence(directory);assert.equal(broken.complete,false);assert.equal(broken.emergencyCareMeals.totals,null);assert.equal(broken.directEating.emergencyCareMeals.totals,null);
});



test('emergency meals runtime: strict publication rejects malformed arrays without invoking getters or observers',()=>{
 for(const kind of ['getter','sparse','extra','symbol'] as const){
  const observation=synthetic().observation;let getters=0,observed=0;
  const food=new RuntimeFoodEvidence({observe:e=>{if(e.type==='food_step_committed')observed++;}});
  food.start(observation.worldId,observation.fromMinute);
  const a=observation.emergencyCareMeals!;
  if(kind==='getter')Object.defineProperty(a,'0',{get(){getters++;return {};}});if(kind==='sparse')delete a[0];
  if(kind==='extra')(a as any).secret='PRIVATE';if(kind==='symbol')(a as any)[Symbol('private')]=1;
  food.committed(observation,1);assert.equal(getters,0);assert.equal(observed,0);assert.equal(food.status().phase,'failed');
 }
});
test('emergency meals runtime: observer throws or returns promise without changing receipt source',()=>{
 for(const async of [false,true]){
  const observation=synthetic().observation,before=structuredClone(observation);
  const food=new RuntimeFoodEvidence({observe:e=>{
   if(e.type==='food_step_committed'){if(async)return Promise.reject(new Error('offline observer'));throw new Error('offline observer');}
  }});
  food.start(observation.worldId,observation.fromMinute);food.committed(observation,1);
  assert.equal(food.status().failure,async?'async_observer':'observer_threw');assert.deepEqual(observation,before);
  assert.equal(auditRuntimeFoodEvidence([],food.status()).emergencyCareMeals.totals,null);
 }
});


test('emergency meals runtime: actual reviewed feed roundtrips through runtime and durable writer',async t=>{
 const {activeEmergencyCare,queueEmergencyCare}=await import('./helpers/emergency-care-meal-evidence.js');
 const {stepWorldWithFoodEvidence}=await import('../src/world/engine.js');
 const f=activeEmergencyCare();queueEmergencyCare(f);const observation=stepWorldWithFoodEvidence(f.w,20);
 assert.equal(observation.emergencyCareMeals!.length,1);
 const root=mkdtempSync(join(testTmpdir(),'long-actual-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const {writer,report}=persist(join(root,'run'),observation);t.after(()=>writer.abort());
 assert.equal(report.complete,true);assert.equal(report.emergencyCareMeals.complete,true);
 assert.deepEqual(report.emergencyCareMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:25,completedActions:1});
 assert.deepEqual(readAcceptanceEvidence(join(root,'run')),report);
});
test('emergency meals runtime: failed durable commit leaves world and personal debit unchanged, then retry publishes exactly one actual receipt',async t=>{
 const {activeEmergencyCare,queueEmergencyCare}=await import('./helpers/emergency-care-meal-evidence.js');
 const {stepWorld}=await import('../src/world/engine.js');
 const {ValleyRuntime}=await import('../src/server/runtime.js');const {WorldStore}=await import('../src/server/store.js');const {QWEN_MODEL}=await import('../src/server/model-completion.js');
 t.mock.timers.enable({apis:['setInterval']});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Offline test forbids network');});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=activeEmergencyCare();queueEmergencyCare(f);stepWorld(f.w,1);f.provider.activity!.remaining=1;
 for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+1000;}
 const store=new WorldStore(':memory:');store.commit(f.w,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[],runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('Offline injected decision stub');},{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 let attempted=false;const original=store.commit.bind(store),mock=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  if(args[0].emergencyCare!.agreements.find(c=>c.id===f.c.id)!.meals>0){attempted=true;throw new Error('Synthetic emergency meal commit failure');}return original(...args);
 });
 for(let i=0;i<20&&!attempted;i++){const before=structuredClone(runtime.world),count=events.length;try{runtime.tick(now+=1000);}catch(error){assert.match(String(error),/emergency meal commit failure/);assert.equal(events.length,count);assert.deepEqual(runtime.world,before);}}
 assert.equal(attempted,true);assert.equal(store.loadForRuntime()!.residents.find(r=>r.id===f.provider.id)!.inventory.meal,10);
 assert.equal(events.flatMap(e=>e.type==='food_step_committed'?e.emergencyCareMeals??[]:[]).length,0);
 mock.mock.restore();runtime.tick(now+=1000);runtime.stop();const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());
 assert.equal(report.emergencyCareMeals.complete,true);assert.deepEqual(report.emergencyCareMeals.totals,{units:{meal:1,water:1},nutrition:25,hungerRelief:25,completedActions:1});
 const loaded=store.loadForRuntime()!;assert.equal(loaded.residents.find(r=>r.id===f.provider.id)!.inventory.meal,9);assert.equal(loaded.emergencyCare!.agreements.find(c=>c.id===f.c.id)!.meals,1);assert.equal(calls,0);
});

 test('emergency meals runtime: feed identity and one-off rescue authority are distinct',()=>{
 const feed=synthetic().observation.emergencyCareMeals![0],rescue={...feed,operation:'rescueMeal' as const,agreementId:null,mealNumber:null};
 assert.equal(session([rescue]).report.emergencyCareMeals.complete,true);
 const f=session([feed]);assert.deepEqual(auditEmergencyCareMeals(f.events,true),f.report.emergencyCareMeals);
 for(const patch of [{operation:'feed',agreementId:null},{operation:'feed',mealNumber:null},{operation:'feed',mealNumber:0},{operation:'feed',mealNumber:5},{operation:'feed',mealNumber:1.5},{operation:'rescueMeal',agreementId:'agreement-1'},{operation:'rescueMeal',mealNumber:1}]){
 const bad={...feed,...patch} as EmergencyCareMealReceipt;assert.equal(session([bad]).report.emergencyCareMeals.totals,null);
 }
 const second={...rescue,eventId:'second-rescue',planId:'second-plan'};assert.equal(session([rescue,second]).report.emergencyCareMeals.totals!.completedActions,2);
 });

test('emergency meals runtime: fixed personal recipe and coherent capped relief cannot be rewritten',()=>{
 const source=synthetic().observation.emergencyCareMeals![0];
 const edits:Array<(r:EmergencyCareMealReceipt)=>void>=[r=>{r.inputs.pop();},r=>{r.inputs[0].item='herb';},r=>{r.inputs[1].quantity=2;},r=>{r.hungerBefore=10;r.hungerAfter=0;r.hungerRelief=10;},r=>{r.hungerAfter=60;r.hungerRelief=20;}];
 for(const edit of edits){const bad=structuredClone(source);edit(bad);assert.equal(session([bad]).report.emergencyCareMeals.totals,null);}
 const capped={...source,hungerBefore:12,hungerAfter:0,hungerRelief:12};assert.equal(session([capped]).report.emergencyCareMeals.totals!.hungerRelief,12);
});

test('emergency meals runtime: agreement sequence accepts resumed sessions but rejects skips, regressions and changed identities',()=>{
 const source=synthetic().observation.emergencyCareMeals![0];
 for(const number of [2,3,4])assert.equal(session([{...source,mealNumber:number}]).report.emergencyCareMeals.complete,true);
 const second={...source,eventId:'second',mealNumber:2};assert.equal(session([source,second]).report.emergencyCareMeals.totals!.completedActions,2);
 for(const patch of [{mealNumber:3},{mealNumber:1},{providerId:'other',container:'person:other'},{beneficiaryId:'another-child'}])assert.equal(session([source,{...second,...patch}]).report.emergencyCareMeals.totals,null);
});

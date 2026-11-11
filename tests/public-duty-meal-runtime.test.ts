import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {publicMealFixture,queuePublicMeal} from './helpers/public-duty-meal-evidence.js';

for(const funded of [false,true])test(`public meals runtime: actual ${funded?'funded':'personal'} receive produces independent frozen facts and separate audit totals`,()=>{
 const f=publicMealFixture('care',funded);queuePublicMeal(f);const observation=stepWorldWithFoodEvidence(f.w,30),source=observation.publicDutyMeals![0];assert.ok(source);
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start(f.w.id,observation.fromMinute);food.committed(observation,1);food.stop(f.w.id,observation.toMinute);
 const step=events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 assert.ok(Object.isFrozen(step.publicDutyMeals));assert.ok(Object.isFrozen(step.publicDutyMeals![0].inputs[0].lots![0]));if(funded)assert.ok(Object.isFrozen(step.publicDutyMeals![0].funding));
 source.inputs[0].quantity=99;source.inputs[0].lots![0].nutrition=99;if(source.funding)source.funding.paidAfter=99;
 assert.equal(step.publicDutyMeals![0].inputs[0].quantity,1);assert.equal(step.publicDutyMeals![0].inputs[0].lots![0].nutrition,2.5);if(funded)assert.equal(step.publicDutyMeals![0].funding!.paidAfter,3);
 const report=auditRuntimeFoodEvidence(events,food.status());assert.equal(report.publicDutyMeals.complete,true);const totals=report.publicDutyMeals.totals!;
 assert.equal(totals.completedActions,1);assert.deepEqual(totals.units,{meal:1,water:1});assert.equal(totals.nutrition,25);assert.equal(totals.hungerRelief,20);assert.equal(totals.healthGain,8);assert.equal(totals.wages,funded?3:0);
 assert.equal(totals.sources[funded?'public':'personal'].completedActions,1);assert.equal(totals.sources[funded?'personal':'public'].completedActions,0);
 assert.equal(report.totals!.completedActions,0);assert.equal(report.careMeals.totals!.completedActions,0);assert.equal(report.longCareMeals.totals!.completedActions,0);assert.equal(report.foodConsumption,null);
});

test('public meals runtime: observer throws or returns a promise without mutating the completed physical source',()=>{
 for(const async of [false,true]){
  const f=publicMealFixture('kitchen',true);queuePublicMeal(f);const observation=stepWorldWithFoodEvidence(f.w,20),before=structuredClone(observation),world=structuredClone(f.w);
  const food=new RuntimeFoodEvidence({observe:e=>{if(e.type==='food_step_committed'){if(async)return Promise.reject(new Error('Offline observer'));throw new Error('Offline observer');}}});
  food.start(f.w.id,observation.fromMinute);food.committed(observation,1);assert.equal(food.status().failure,async?'async_observer':'observer_threw');assert.deepEqual(observation,before);assert.deepEqual(f.w,world);assert.equal(auditRuntimeFoodEvidence([],food.status()).publicDutyMeals.totals,null);
 }
});

for(const funded of [false,true])test(`public meals runtime: failed ${funded?'public-funded':'personal'} durable commit rolls back service, food and wage; retry publishes once`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Offline test forbids network');});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=publicMealFixture('care',funded);queuePublicMeal(f);stepWorld(f.w,1);f.beneficiary.activity!.remaining=1;
 for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+1000;}
 const store=new WorldStore(':memory:');store.commit(f.w,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[],runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('Offline injected decision stub');},{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 let attempted=false;const original=store.commit.bind(store),mock=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  if(args[0].duties!.shifts.find(s=>s.id===f.shift.id)!.served>0){attempted=true;throw new Error('Synthetic public meal commit failure');}return original(...args);
 });
 const stock=structuredClone(f.inventory),providerCoins=f.provider.coins;
 for(let i=0;i<20&&!attempted;i++){const before=structuredClone(runtime.world),count=events.length;try{runtime.tick(now+=1000);}catch(error){assert.match(String(error),/public meal commit failure/);assert.equal(events.length,count);assert.deepEqual(runtime.world,before);}}
 assert.equal(attempted,true);assert.equal(events.flatMap(e=>e.type==='food_step_committed'?e.publicDutyMeals??[]:[]).length,0);
 const failed=store.loadForRuntime()!,failedProvider=failed.residents.find(r=>r.id===f.provider.id)!;assert.equal(failedProvider.coins,providerCoins);assert.deepEqual(funded?failed.civic!.stores[f.building.id]:failedProvider.inventory,stock);
 mock.mock.restore();runtime.tick(now+=1000);runtime.stop();const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());assert.equal(report.publicDutyMeals.complete,true);assert.equal(report.publicDutyMeals.totals!.completedActions,1);assert.equal(report.publicDutyMeals.totals!.wages,funded?3:0);
 const loaded=store.loadForRuntime()!,provider=loaded.residents.find(r=>r.id===f.provider.id)!;assert.equal((funded?loaded.civic!.stores[f.building.id]:provider.inventory).meal,stock.meal!-1);assert.equal(provider.coins,providerCoins!+(funded?3:0));assert.equal(loaded.duties!.shifts.find(s=>s.id===f.shift.id)!.served,1);assert.equal(calls,0);
});

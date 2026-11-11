import assert from 'node:assert/strict';
import test from 'node:test';
import {employmentFlowFixture,queueEmploymentFlow,finishEmploymentAction,employmentReceipts,reloadEmployment,submitEmploymentAction} from './helpers/food-flow-employment.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {completeEmployment,employmentWorkError} from '../src/world/employment.js';
import {initializeFood,foodTransaction} from '../src/world/food.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {totalCoins} from '../src/world/economy.js';
import {recipeSnapshot} from './helpers/food-flow-craft.js';
import {DAY} from '../src/world/time.js';

test('real hiring and numbered employment work records only complete shop-owned conversions, not cook or craft',()=>{
 const f=employmentFlowFixture(),{w,worker,b,c,owner}=f,recipe=structuredClone(c.recipe!),money=totalCoins(w),pocket=structuredClone(worker.inventory);
 const original=structuredClone(w.food!.lots['business:'+b.id].turnip![0]);
 queueEmploymentFlow(f,7);assert.deepEqual(employmentReceipts(finishEmploymentAction(w,worker)),[]);assert.equal(c.batch!.progress,7);
 assert.equal(b.inventory.turnip,2);assert.equal(b.inventory.meal??0,0);assert.notEqual(c.batch!.inventory,c.recipe!.input);
 submitEmploymentAction(w,worker,{type:'wait',minutes:3});assert.deepEqual(employmentReceipts(finishEmploymentAction(w,worker)),[]);
 const plan=queueEmploymentFlow(f,33),observations=finishEmploymentAction(w,worker),flows=employmentReceipts(observations);
 assert.equal(flows.length,2);assert.ok(observations.every(o=>o.foodFlowCoverage===FOOD_FLOW_COVERAGE));
 assert.deepEqual(observations.flatMap(o=>o.foodFlows??[]),flows);
 for(const [index,flow] of flows.entries()){
  assert.equal(flow.residentId,worker.id);assert.equal(flow.employerId,owner.id);assert.equal(flow.contractId,c.id);assert.equal(flow.businessId,b.id);
  assert.equal(flow.planId,plan);assert.equal(flow.buildingId,c.buildingId);assert.equal(flow.inputContainer,'employment:'+c.id);assert.equal(flow.container,'business:'+b.id);
  assert.equal(flow.day,Math.floor(flow.at/DAY));assert.equal(flow.batchNumber,index+1);assert.equal(flow.definition,c.recipeDefinition);
  assert.deepEqual(flow.recipe,recipeSnapshot(recipe));assert.deepEqual(flow.inputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.input));assert.deepEqual(flow.outputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.output));
  assert.deepEqual(flow.inputs.find(a=>a.item==='turnip')!.lots!.map(({nutrition,...lot})=>lot),[{...original,quantity:2}]);
  assert.equal(flow.outputs[0].lots![0].producedAt,flow.at);assert.ok(w.events.some(e=>e.id===flow.eventId&&e.at===flow.at));
 }
 assert.equal(b.inventory.meal,2);assert.equal(c.attendance[0].worked,40);assert.equal(c.paid,4);assert.equal(c.batch,null);assert.deepEqual(worker.inventory,pocket);assert.equal(totalCoins(w),money);
 assert.deepEqual(c.recipe,recipe);assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
 const before=structuredClone(w);assert.equal(completeEmployment(w,worker,{type:'employment',operation:'work',contractId:c.id,minutes:20}),null);assert.deepEqual(w,before);
});

test('original contract and ingredient nutrition survive active recipe replacement and SQLite continuation',()=>{
 let f=employmentFlowFixture();queueEmploymentFlow(f,20);stepWorldWithFoodEvidence(f.w,7);
 const original=structuredClone(f.c.recipe!),definition=f.c.recipeDefinition,lot=f.w.food!.lots['employment:'+f.c.id].turnip![0];
 lot.definition='food/employment-original@1';f.w.definitions[lot.definition]={id:'food/employment-original',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:7}}};
 f.w.definitions['recipe/meal@2']={...structuredClone(f.w.definitions['recipe/meal@1']),version:2,cost:{turnip:8,water:4},minutes:80,data:{yield:9}};f.w.activeDefinitions['recipe/meal']='recipe/meal@2';f=reloadEmployment(f);
 const flows=employmentReceipts(finishEmploymentAction(f.w,f.worker));assert.equal(flows.length,1);assert.equal(flows[0].definition,definition);assert.deepEqual(flows[0].recipe,recipeSnapshot(original));assert.equal(flows[0].inputs[0].nutrition,14);assert.equal(flows[0].outputs[0].quantity,1);
 assert.deepEqual(stepWorldWithFoodEvidence(reloadEmployment(f).w,1).foodFlows,[]);
});

for(const restart of [false,true])test(`expiry and remaining-input refunds never create processing, reload=${restart}`,()=>{
 let f=employmentFlowFixture({turnip:2,fruit:1,water:1});f.b.inventory={turnip:2,fruit:1,water:1};initializeFood(f.w);
 const key='business:'+f.b.id,fruit=structuredClone(f.w.food!.lots[key].fruit);f.w.food!.lots[key].turnip![0].expiresAt=f.w.minute+2;
 queueEmploymentFlow(f,40);assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).foodFlows,[]);if(restart)f=reloadEmployment(f);
 const observations=finishEmploymentAction(f.w,f.worker,false);assert.deepEqual(employmentReceipts(observations),[]);assert.equal(f.b.inventory.meal??0,0);assert.equal(f.b.inventory.water,1);assert.deepEqual(f.w.food!.lots[key].fruit,fruit);assert.equal(f.c.batch,null);assert.equal(f.c.attendance[0].worked,1);
 assert.equal(observations.flatMap(o=>o.foodLosses??[]).filter(x=>x.container==='employment:'+f.c.id).length,1);
});

test('quit cancels a partial batch and refunds original stock without a food conversion',()=>{
 const f=employmentFlowFixture();queueEmploymentFlow(f,7);finishEmploymentAction(f.w,f.worker);
 submitEmploymentAction(f.w,f.worker,{type:'employment',operation:'quit',contractId:f.c.id});const o=finishEmploymentAction(f.w,f.worker);
 assert.deepEqual(employmentReceipts(o),[]);assert.equal(f.c.status,'quit');assert.equal(f.c.batch,null);assert.equal(f.b.inventory.turnip,4);assert.equal(f.b.inventory.water,2);assert.equal(f.b.inventory.meal??0,0);
});

test('stock competition and duplicate same-minute work cannot manufacture completed employment evidence',()=>{
 const f=employmentFlowFixture();queueEmploymentFlow(f,20);foodTransaction(f.w,()=>{f.b.inventory.turnip=0;});assert.deepEqual(employmentReceipts(finishEmploymentAction(f.w,f.worker,false)),[]);assert.equal(f.c.attendance.length,0);
 const g=employmentFlowFixture();queueEmploymentFlow(g,20);stepWorld(g.w,19);
 const final=captureDirectEating(g.w,()=>{g.w.minute++;const a=g.worker.activity!.action as never;assert.equal(employmentWorkError(g.w,g.worker,a,1),null);assert.equal(employmentWorkError(g.w,g.worker,a,1),null);});
 assert.equal(employmentReceipts([final]).length,1);assert.equal(g.c.attendance[0].produced,1);assert.equal(g.b.inventory.meal,1);
});

test('old aliases and damaged signed snapshots do not fabricate ingredients or completed output',()=>{
 const f=employmentFlowFixture();queueEmploymentFlow(f,20);stepWorld(f.w,1);
 f.c.batch!.inventory=f.c.recipe!.input;f.c.batch!.output=f.c.recipe!.output;
 foodTransaction(f.w,()=>{f.c.batch!.inventory.turnip=0;});f.c.recipe!.input.turnip=0;f.c.batch!.progress=19;
 const o=stepWorldWithFoodEvidence(f.w,1);assert.deepEqual(o.foodFlows,[]);assert.equal(f.c.recipe!.input.turnip,2);assert.equal(f.b.inventory.meal??0,0);
});

for(const scenario of ['missing','repaired','future','nutrition'] as const)test(`employment original lot ${scenario} remains honestly unknown`,()=>{
 const f=employmentFlowFixture();queueEmploymentFlow(f,20);stepWorld(f.w,19);const key='employment:'+f.c.id,lot=f.w.food!.lots[key].turnip![0];
 if(scenario==='missing')delete f.w.food!.lots[key];if(scenario==='repaired')lot.quantity=1;if(scenario==='future')lot.producedAt=f.w.minute+10;if(scenario==='nutrition')lot.definition='food/unavailable@1';
 const flow=employmentReceipts([stepWorldWithFoodEvidence(f.w,1)])[0];assert.ok(flow);const input=flow.inputs.find(a=>a.item==='turnip')!;assert.equal(input.quantity,2);assert.equal(input.nutrition,null);if(scenario!=='nutrition')assert.equal(input.lots,null);else assert.equal(input.lots![0].definition,'food/unavailable@1');
});

test('prediction completion and evidence switches do not alter original world, knowledge or serialized saves',()=>{
 const f=employmentFlowFixture();queueEmploymentFlow(f,20);stepWorld(f.w,19);const plain=copyForSimulation(f.w),prediction=copyForSimulation(f.w),before=structuredClone(f.w);
 const imagined=captureDirectEating(f.w,()=>{stepWorld(prediction,1);});assert.deepEqual(imagined.foodFlows,[]);assert.deepEqual(f.w,before);assert.equal(prediction.economy!.businesses[0].inventory.meal,1);
 stepWorld(plain,1);const actual=stepWorldWithFoodEvidence(f.w,1);assert.equal(employmentReceipts([actual]).length,1);assert.deepEqual(f.w,plain);assert.doesNotMatch(JSON.stringify(f.w),/"(?:foodFlows|foodFlowCoverage|batchNumber)"\s*:/);
});


test('actual recruited roles distinguish food processing from nonfood manufacturing',()=>{
 for(const role of ['seedkeeper','miller','dairyworker','preserver','herbalist','carpenter'] as const){
  const f=employmentFlowFixture(undefined,role),recipe=structuredClone(f.c.recipe!);queueEmploymentFlow(f,recipe.minutes);
  const observations=finishEmploymentAction(f.w,f.worker),flows=employmentReceipts(observations);
  const food=['seedkeeper','miller','dairyworker','preserver'].includes(role);assert.equal(flows.length,food?1:0,role);
  assert.equal(f.c.attendance[0].produced,1,role);for(const [item,n]of Object.entries(recipe.output))assert.equal(f.b.inventory[item as keyof typeof f.b.inventory],n,role);
  if(food){assert.deepEqual(flows[0].recipe,recipeSnapshot(recipe));assert.deepEqual(flows[0].inputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.input));assert.deepEqual(flows[0].outputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.output));}
  assert.equal(observations.flatMap(o=>o.foodFlows??[]).length,flows.length,role);
 }
 for(const raw of ['gameMeat','carp'] as const){
  const f=employmentFlowFixture({[raw]:1,water:1});f.b.inventory={[raw]:1,water:1};initializeFood(f.w);queueEmploymentFlow(f,20);
  const flow=employmentReceipts(finishEmploymentAction(f.w,f.worker))[0];assert.ok(flow);assert.equal(flow.inputs.find(i=>i.item===raw)!.quantity,1);assert.ok(flow.inputs.find(i=>i.item===raw)!.lots?.length);
 }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {craftFlowFixture,queueCraftFlow,runCraftFlow,finishCraftFlow,craftReceipts,craftChoices,submitCraftChoice,recipeSnapshot} from './helpers/food-flow-craft.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,hasTimelySelfRescue} from '../src/world/engine.js';
import {initializeFood,advanceFood} from '../src/world/food.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionContext} from '../src/server/decisions.js';
import {industryWorkError} from '../src/world/industry.js';
import {WorldStore} from '../src/server/store.js';
import {fishSpecies} from '../src/shared/fish-species.js';
import type {IndustryAction} from '../src/shared/industry.js';
import type {World} from '../src/shared/types.js';

function started(minutes=10){
 const f=craftFlowFixture(),observations=runCraftFlow(f.w,f.r,'gameMeal',minutes);
 assert.deepEqual(craftReceipts(observations),[]);
 return {...f,batch:f.w.industry!.batches.find(b=>b.ownerId===f.r.id)!};
}
function reload(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);return store.load(true)!;}finally{store.close();}}

test('numbered craft reservation and partial work are only transfers; original complete batch emits one two-sided conversion',()=>{
 const {w,r,recipe,home}=craftFlowFixture(),original=structuredClone(w.food!.lots['person:'+r.id].gameMeat);
 const first=runCraftFlow(w,r,'gameMeal',10),batch=w.industry!.batches.find(b=>b.ownerId===r.id)!;
 assert.ok(first.every(o=>o.foodFlowCoverage===FOOD_FLOW_COVERAGE));assert.deepEqual(craftReceipts(first),[]);
 assert.equal(batch.worked,10);assert.equal(batch.status,'working');assert.equal(r.inventory.gameMeat,0);assert.equal(r.inventory.meal??0,0);
 assert.deepEqual(w.food!.lots['craft:'+batch.id].gameMeat,original);
 const choices=craftChoices(w,r),wait=choices.find(c=>c.action.type==='wait')!;
 submitCraftChoice(w,r,choices,wait,5);assert.deepEqual(craftReceipts(finishCraftFlow(w,r)),[]);
 const completed=runCraftFlow(w,r,'gameMeal',25),flows=craftReceipts(completed);assert.equal(flows.length,1);
 const flow=flows[0];assert.equal(flow.type,'processed');assert.equal(flow.action,'industry_craft');assert.equal(flow.batchId,batch.id);
 assert.equal(flow.buildingId,home.id);assert.equal(flow.inputContainer,'craft:'+batch.id);assert.equal(flow.container,'person:'+r.id);
 assert.equal(flow.definition,batch.definition);assert.deepEqual(flow.recipe,recipeSnapshot(recipe));
 assert.deepEqual(flow.inputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.input));
 assert.deepEqual(flow.outputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.output));
 assert.deepEqual(flow.inputs.find(a=>a.item==='gameMeat')!.lots!.map(({nutrition,...lot})=>lot),original);
 assert.equal(flow.inputs.find(a=>a.item==='gameMeat')!.nutrition,0);
 for(const item of ['wood','water'])assert.deepEqual(flow.inputs.find(a=>a.item===item),{item,quantity:1,nutrition:0,lots:[]});
 assert.equal(flow.outputs[0].nutrition,84);assert.equal(flow.outputs[0].lots![0].producedAt,flow.at);
 assert.equal(w.events.find(e=>e.id===flow.eventId)!.at,flow.at);assert.equal(batch.status,'completed');assert.equal(r.inventory.meal,2);
 assert.deepEqual(batch.input,recipe.input,'completed input remains history, not another physical stock or debit');
 assert.ok(completed.every(o=>o.receipts.length===0&&o.careMeals!.length===0&&o.longCareMeals!.length===0));
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[],'completed batch does not replay');
});

test('original recipe and original input nutrition survive active-version change and SQLite continuation',()=>{
 const {w,r}=craftFlowFixture('fishMeal.carp');runCraftFlow(w,r,'fishMeal.carp',10);
 const batch=w.industry!.batches.find(b=>b.ownerId===r.id)!,original=structuredClone(batch.recipe),oldDefinition=batch.definition!;
 const lot=w.food!.lots['craft:'+batch.id].carp![0];lot.definition='food/original-carp@1';
 w.definitions[lot.definition]={id:'food/original-carp',version:1,kind:'life',dependencies:[],data:{nutrition:{carp:7}}};
 const alias='recipe/industry/fishMeal.carp',next=structuredClone(w.definitions[oldDefinition]);next.version=2;next.cost={carp:3,water:1,wood:1};next.minutes=90;
 next.data={...next.data,input:next.cost,output:{meal:9},minutes:90};w.definitions[alias+'@2']=next;w.activeDefinitions[alias]=alias+'@2';
 const life=structuredClone(w.definitions['food/life@1']);life.version=99;life.data={...life.data,nutrition:{meal:5,carp:99}};
 w.definitions['food/life@99']=life;w.activeDefinitions['food/life']='food/life@99';
 const loaded=reload(w),actor=loaded.residents.find(p=>p.id===r.id)!,flows=craftReceipts(runCraftFlow(loaded,actor,'fishMeal.carp',60));
 assert.equal(flows.length,1);assert.equal(flows[0].definition,oldDefinition);assert.deepEqual(flows[0].recipe,recipeSnapshot(original));
 assert.equal(flows[0].inputs.find(a=>a.item==='carp')!.nutrition,7);assert.equal(flows[0].inputs.find(a=>a.item==='carp')!.lots![0].definition,'food/original-carp@1');
 assert.equal(flows[0].outputs[0].quantity,2);assert.equal(flows[0].outputs[0].nutrition,10);assert.equal(actor.inventory.meal,2);
 assert.deepEqual(stepWorldWithFoodEvidence(reload(loaded),1).foodFlows,[]);
});

test('food qualification includes raw meat, species fish, dairy, grain, preserving and food-to-nonfood conversion',()=>{
 for(const recipeId of ['gameMeal','fishMeal',...fishSpecies.map(s=>'fishMeal.'+s),'preserveFish.carp.cod','bread','cheese','preserve','fodder','herb']){
  const {w,r,recipe}=craftFlowFixture(recipeId),flows=craftReceipts(runCraftFlow(w,r,recipeId));
  assert.equal(flows.length,1,recipeId);const flow=flows[0];assert.deepEqual(flow.recipe,recipeSnapshot(recipe));
  assert.deepEqual(flow.inputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.input));
  assert.deepEqual(flow.outputs.map(a=>[a.item,a.quantity]),Object.entries(recipe.output));
  assert.ok(flow.inputs.every(a=>a.nutrition!==null),recipeId+' original lots should be known');
 }
 for(const recipeId of ['axe','plank','compost','cloth','sapling']){
  const {w,r}=craftFlowFixture(recipeId);assert.deepEqual(craftReceipts(runCraftFlow(w,r,recipeId,120)),[],recipeId);
  assert.equal(w.industry!.batches[0].status,'completed');
 }
});

test('actual expiry cancels reserved batch and returns surviving inputs without processing, then stale continuation cannot spend replacements',()=>{
 const {w,r,batch}=started(),choices=craftChoices(w,r),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft')!;
 const lot=w.food!.lots['craft:'+batch.id].gameMeat![0];lot.expiresAt=w.minute+1;
 const expired=stepWorldWithFoodEvidence(w,1);assert.deepEqual(expired.foodFlows,[]);assert.equal(batch.status,'cancelled');
 assert.equal(expired.foodLosses!.filter(l=>l.container==='craft:'+batch.id).length,1);
 assert.equal(r.inventory.gameMeat,0);assert.equal(r.inventory.water,1);assert.equal(r.inventory.wood,1);assert.equal(r.inventory.meal??0,0);
 r.inventory.gameMeat=1;initializeFood(w);const before={...r.inventory};submitCraftChoice(w,r,choices,choice,25);
 assert.deepEqual(craftReceipts(finishCraftFlow(w,r,false)),[]);assert.ok(r.lastFailure);assert.deepEqual(r.inventory,before);
 assert.equal(w.industry!.batches.length,1);assert.deepEqual(captureDirectEating(w,()=>advanceFood(w)).foodFlows,[]);
});

test('material and permission races cannot publish successful conversion; resumed valid work completes once',()=>{
 const fresh=craftFlowFixture(),choices=craftChoices(fresh.w,fresh.r),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal')!;
 fresh.r.inventory.wood=0;submitCraftChoice(fresh.w,fresh.r,choices,choice,35);
 assert.deepEqual(craftReceipts(finishCraftFlow(fresh.w,fresh.r,false)),[]);assert.ok(fresh.r.lastFailure);assert.equal(fresh.w.industry!.batches.length,0);
 const {w,r,home,batch}=started();queueCraftFlow(w,r,'gameMeal',25);home.ownerId=w.residents[3].id;home.residents=[];
 assert.deepEqual(craftReceipts(finishCraftFlow(w,r,false)),[]);assert.ok(r.lastFailure);assert.equal(batch.worked,10);assert.equal(batch.status,'working');
 home.ownerId=r.id;home.residents=[r.id];assert.equal(craftReceipts(runCraftFlow(w,r,'gameMeal',25)).length,1);
});

test('missing, repaired or malformed original lots remain unknown, never inferred from current nutrition',()=>{
 for(const scenario of ['missing','quantity-repair','bad-definition','future-produced','missing-nutrition'] as const){
  const {w,r,batch}=started(34);queueCraftFlow(w,r,'gameMeal',1);
  const container='craft:'+batch.id,lot=w.food!.lots[container].gameMeat![0];
  if(scenario==='missing')delete w.food!.lots[container];
  else if(scenario==='quantity-repair')lot.quantity=.5;
  else if(scenario==='bad-definition')lot.definition='not a definition';
  else if(scenario==='future-produced')lot.producedAt=w.minute+100;
  else lot.definition='food/no-nutrition@1';
  const flow=craftReceipts(finishCraftFlow(w,r))[0],input=flow.inputs.find(a=>a.item==='gameMeat')!;
  assert.equal(input.quantity,1);assert.equal(input.nutrition,null,scenario);
  if(scenario!=='missing-nutrition')assert.equal(input.lots,null,scenario);
  else assert.equal(input.lots![0].definition,'food/no-nutrition@1');
  assert.equal(flow.outputs[0].quantity,2);assert.equal(r.inventory.meal,2);
 }
});

test('engine projections, menu reads and disabled capture are observationally identical; no save or knowledge fields added',()=>{
 const {w,r}=started(34);queueCraftFlow(w,r,'gameMeal',1);
 const plain=copyForSimulation(w),prediction=copyForSimulation(w),before=structuredClone(w);
 assert.deepEqual(captureDirectEating(w,()=>{
  while(prediction.residents[0].activity||prediction.residents[0].plan)stepWorld(prediction,1);
  hasTimelySelfRescue(w,r,[{type:'eat',item:'meal'}]);decisionContext(w,r);
 }).foodFlows,[]);assert.deepEqual(w,before);
 const flows=[];while(r.activity||r.plan){flows.push(...stepWorldWithFoodEvidence(w,1).foodFlows!);stepWorld(plain,1);}
 assert.equal(flows.length,1);assert.deepEqual(w,plain);
 assert.deepEqual(decisionContext(w,r),decisionContext(plain,plain.residents[0]));
 assert.doesNotMatch(JSON.stringify(w),/"(?:foodFlows|foodFlowCoverage|inputContainer)"\s*:/);
});

test('failed observer capture and repeated completion cannot leak pending lots into later food actions',()=>{
 const {w,r}=started(34);const action=queueCraftFlow(w,r,'gameMeal',1);
 // Reach a real work step then throw after the operation. Capture does not roll back simulation.
 assert.throws(()=>captureDirectEating(w,()=>{while(r.plan||r.activity)stepWorld(w,1);throw new Error('after completed craft');}),/after completed craft/);
 assert.equal(r.inventory.meal,2);assert.equal(w.industry!.totals.crafted,1);
 assert.deepEqual(captureDirectEating(w,()=>industryWorkError(w,r,action,1)).foodFlows,[]);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
 const fresh=craftFlowFixture();assert.equal(craftReceipts(runCraftFlow(fresh.w,fresh.r)).length,1);
});


test('death ends working craft through the original custody path without fabricating food conversion',()=>{
 const {w,r,batch}=started(),original=structuredClone(w.food!.lots['craft:'+batch.id].gameMeat);
 r.health=0;const observed=stepWorldWithFoodEvidence(w,1);
 assert.equal(r.status,'dead');assert.equal(batch.status,'cancelled');assert.deepEqual(batch.input,{});
 assert.deepEqual(observed.foodFlows,[]);assert.equal(w.industry!.totals.crafted,0);
 const estate=w.estates.find(e=>e.personId===r.id)!;assert.ok(estate);
 const parcel=estate.parcels!.find(p=>(p.inventory.gameMeat??0)>0)!;assert.ok(parcel);
 assert.equal(parcel.inventory.gameMeat,1);assert.equal(parcel.inventory.water,1);assert.equal(parcel.inventory.wood,1);
 assert.deepEqual(w.food!.lots[parcel.id].gameMeat,original);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
});

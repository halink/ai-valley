import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {parseChoice} from '../src/server/affordances.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {submitPlan} from '../src/world/engine.js';
import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {craftChoices,craftFlowFixture,recipeSnapshot} from './helpers/food-flow-craft.js';

const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
function receipts(events:RuntimeFoodEvent[]){return events.flatMap(e=>e.type==='food_step_committed'?e.foodFlows??[]:[]).filter(f=>f.action==='industry_craft');}
function fixture(){
 const f=craftFlowFixture('gameMeal');f.w.clock.realMinutesPerDay=24;
 const choices=craftChoices(f.w,f.r),wait=choices.find(c=>c.action.type==='wait');assert.ok(wait);
 const quiet=parseChoice(JSON.stringify({choice:wait.id,minutes:120}),choices);
 const craft=choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal');assert.ok(craft);
 const parsed=parseChoice(JSON.stringify({choice:craft.id,minutes:60}),choices);
 // A real parsed follow-on wait keeps scheduling offline after craft finishes.
 const submitted=submitPlan(f.w,{id:'craft-runtime-plan',actorId:f.r.id,actorRevision:f.r.revision,createdAt:f.w.minute,
  definition:f.w.activeDefinitions['action/routine'],intention:parsed.intention,actions:[...parsed.actions,...quiet.actions]});
 assert.ok(submitted.ok,submitted.error);
 return f;
}

test('industry craft publishes only actual completion after durable commit, retries once and does not replay on restart',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
 const model=async()=>{modelCalls++;throw new Error('No model');};
 const {w,r,recipe,home}=fixture(),opening=w.minute;
 const planId=r.plan!.id;
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[];
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 t.after(()=>runtime.stop());runtime.start();
 assert.deepEqual(receipts(events),[],'accepted plans and startup are not completion evidence');
 const original=store.commit.bind(store);let rejected=false,sawWorking=false;
 const commit=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  const batch=args[0].industry!.batches.find(b=>b.ownerId===r.id);
  if(batch?.status==='completed'){
   assert.equal(batch.worked,recipe.minutes);
   assert.equal(args[0].residents.find(a=>a.id===r.id)!.inventory.meal,2);
   rejected=true;throw new Error('Synthetic craft commit failure');
  }
  return original(...args);
 });
 for(let i=0;i<120&&!rejected;i++){
  const before=structuredClone(runtime.world),savedBefore=store.loadForRuntime(),count=events.length,status=runtime.directEatingEvidenceStatus();
  try{runtime.tick(now+=1000);}catch(error){
   assert.match(String(error),/Synthetic craft commit failure/);
   assert.equal(events.length,count,'failed commit cannot publish even a step event');
   assert.deepEqual(runtime.world,before,'all simulation mutations roll back');
   assert.deepEqual(store.loadForRuntime(),savedBefore);
   assert.deepEqual(runtime.directEatingEvidenceStatus(),status);
  }
  const batch=runtime.world.industry!.batches.find(b=>b.ownerId===r.id);
  if(batch?.status==='working'){
   sawWorking=true;assert.ok(batch.worked<recipe.minutes);
   assert.deepEqual(receipts(events),[],'reserved inputs and partial work are not processed output');
   assert.equal(runtime.world.residents.find(a=>a.id===r.id)!.inventory.meal??0,0);
  }
 }
 assert.ok(sawWorking);assert.ok(rejected,'real completed batch must reach durable commit');
 assert.deepEqual(receipts(events),[]);
 commit.mock.restore();runtime.tick(now+=1000);
 for(let i=0;i<5;i++)runtime.tick(now+=1000);
 runtime.stop();
 const observed=receipts(events);assert.equal(observed.length,1);
 const receipt=observed[0],loaded=store.loadForRuntime()!,batch=loaded.industry!.batches.find(b=>b.ownerId===r.id)!;
 assert.equal(receipt.type,'processed');assert.equal(receipt.planId,planId);assert.equal(receipt.residentId,r.id);
 assert.equal(receipt.batchId,batch.id);assert.equal(receipt.buildingId,home.id);
 assert.equal(receipt.inputContainer,'craft:'+batch.id);assert.equal(receipt.container,'person:'+r.id);
 assert.deepEqual(receipt.recipe,recipeSnapshot(recipe));assert.ok(receipt.eventId);
 assert.ok(receipt.at-opening>=recipe.minutes,'original recipe work is never shortcut');
 assert.deepEqual(Object.fromEntries(receipt.inputs.map(v=>[v.item,v.quantity])),recipe.input);
 assert.deepEqual(Object.fromEntries(receipt.outputs.map(v=>[v.item,v.quantity])),recipe.output);
 assert.equal(batch.status,'completed');assert.equal(loaded.residents.find(a=>a.id===r.id)!.inventory.meal,2);
 for(const output of receipt.outputs){
  assert.ok(output.lots?.length);
  assert.ok(output.lots!.every(lot=>lot.producedAt===receipt.at&&lot.expiresAt>receipt.at));
  assert.deepEqual(output.lots!.map(({nutrition,...lot})=>lot),loaded.food!.lots[receipt.container][output.item]);
 }
 for(const event of events)if(event.type==='food_step_committed')assert.equal(event.foodFlowCoverage,FOOD_FLOW_COVERAGE);
 assert.doesNotMatch(JSON.stringify(loaded),/"(?:foodFlows|foodFlowCoverage|observedReceipts)"\s*:/);
 const restartedEvents:RuntimeFoodEvent[]=[];
 const restarted=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{restartedEvents.push(e);}}});
 t.after(()=>restarted.stop());restarted.start();
 for(let i=0;i<5;i++)restarted.tick(now+=1000);
 restarted.stop();assert.deepEqual(receipts(restartedEvents),[],'persisted completed batch is not replayed');
 assert.equal(restarted.world.industry!.totals.crafted,1);
 assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

for(const failObserver of [false,true])test(`craft runtime evidence ${failObserver?'observer failure':'enabled'} preserves the disabled simulation and durable world`,t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
 const model=async()=>{modelCalls++;throw new Error('No model');};
 const {w,r}=fixture(),events:RuntimeFoodEvent[]=[];
 const stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];
 for(const store of stores){store.commit(structuredClone(w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'});
 let thrown=0;
 const enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{
  events.push(e);if(failObserver&&e.type==='food_step_committed'&&e.foodFlows?.some(f=>f.action==='industry_craft')){thrown++;throw new Error('Synthetic craft observer failure');}
 }}});
 for(const runtime of [disabled,enabled]){t.after(()=>runtime.stop());runtime.start();}
 for(let i=0;i<50;i++){now+=1000;disabled.tick(now);enabled.tick(now);}
 for(const runtime of [disabled,enabled])runtime.stop();
 assert.equal(disabled.world.residents.find(a=>a.id===r.id)!.inventory.meal,2);
 assert.equal(disabled.world.industry!.totals.crafted,1);
 assert.equal(disabled.directEatingEvidenceStatus(),null);
 assert.deepEqual(enabled.world,disabled.world);
 assert.deepEqual(stores[1].loadForRuntime(),stores[0].loadForRuntime());
 assert.equal(receipts(events).length,1);
 assert.equal(thrown,failObserver?1:0);
 assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});


for(const failure of ['sqlite','revision'] as const)test(`real ${failure} rejection rolls back completed craft and permits exactly one recovered publication`,t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
 const model=async()=>{modelCalls++;throw new Error('No model');};
 const {w,r,recipe}=fixture(),events:RuntimeFoodEvent[]=[];
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 t.after(()=>runtime.stop());runtime.start();
 // Stop just before the real final minute, without replacing any simulation step.
 for(let i=0;i<120;i++){
  const batch=runtime.world.industry!.batches.find(b=>b.ownerId===r.id);
  if(batch&&batch.worked>=recipe.minutes-1)break;
  runtime.tick(now+=1000);
 }
 const pending=runtime.world.industry!.batches.find(b=>b.ownerId===r.id)!;
 assert.equal(pending.status,'working');assert.equal(pending.worked,recipe.minutes-1);
 assert.deepEqual(receipts(events),[]);
 const db=(store as unknown as {db:DatabaseSync}).db;
 const tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite'){
  db.exec("CREATE TEMP TRIGGER reject_craft BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_craft_sql_failure'); END");
 }else{
  const winner=store.loadForRuntime()!,revision=winner.revision;
  winner.revision++;store.commit(winner,revision);
 }
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 // This is a pass-through inspection only: the actual store transaction decides failure.
 const original=store.commit.bind(store);let completedDrafts=0;
 const inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  const batch=args[0].industry!.batches.find(b=>b.id===pending.id)!;
  assert.equal(batch.status,'completed');assert.equal(batch.worked,recipe.minutes);
  assert.equal(args[0].residents.find(a=>a.id===r.id)!.inventory.meal,2);
  completedDrafts++;return original(...args);
 });
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_craft_sql_failure/:/stale_world_revision/);
 assert.equal(completedDrafts,1);inspect.mock.restore();
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);
 assert.deepEqual(snapshot(),sqlBefore,'world and all event, receipt and index tables are unchanged');
 assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);
 assert.deepEqual(receipts(events),[]);
 let recovered=runtime;
 const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_craft');
 else{
  // A stale runtime must reload the winning revision, never overwrite it by retrying blindly.
  runtime.stop();
  recovered=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{recoveredEvents.push(e);}}});
  t.after(()=>recovered.stop());recovered.start();
 }
 recovered.tick(now+=1000);
 for(let i=0;i<4;i++)recovered.tick(now+=1000);
 recovered.stop();
 assert.equal(receipts(recoveredEvents).length,1);
 assert.equal(receipts(recoveredEvents)[0].batchId,pending.id);
 assert.equal(recovered.world.industry!.totals.crafted,1);
 assert.equal(store.loadForRuntime()!.industry!.batches.find(b=>b.id===pending.id)!.status,'completed');
 assert.equal(store.loadForRuntime()!.residents.find(a=>a.id===r.id)!.inventory.meal,2);
 assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

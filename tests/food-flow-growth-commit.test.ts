import assert from 'node:assert/strict';
import {test} from 'node:test';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import type {Item,World} from '../src/shared/types.js';
import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {animalProducts} from '../src/world/livestock-life.js';
import {growthFlowFixture} from './helpers/food-flow-growth.js';

const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
function assertFreshGrowth(w:World){
 assert.equal(w.industry!.trees[0].fruit,1);
 for(const animal of w.industry!.animals)assert.equal(animal.product,1);
 const stocks:{container:string;item:Item}[]=[{container:'orchard-stock:growth-tree',item:'fruit'},
  ...w.industry!.animals.filter(a=>a.kind!=='sheep').map(a=>({container:'animal-stock:'+a.id,item:animalProducts[a.kind]}))];
 for(const {container,item} of stocks){
  const lots=w.food!.lots[container][item]!;
  assert.equal(lots.length,1);assert.equal(lots[0].quantity,1);
  assert.ok(lots[0].producedAt<=w.minute);assert.ok(lots[0].expiresAt>w.minute);
 }
}

test('natural fruit and livestock generation rolls back a rejected durable commit and publishes exactly once on retry',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,fetchCalls=0,modelCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
 const model=async()=>{modelCalls++;throw new Error('No model');};
 const {w,r}=growthFlowFixture();
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[];
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 t.after(()=>runtime.stop());runtime.start();
 const before=structuredClone(runtime.world),savedBefore=store.loadForRuntime(),eventCount=events.length;
 const statusBefore=runtime.directEatingEvidenceStatus();let rejected=0;
 const commit=t.mock.method(store,'commit',(draft:World)=>{
  assertFreshGrowth(draft);rejected++;
  throw new Error('Synthetic natural growth commit failure');
 });
 assert.throws(()=>runtime.tick(now+=1000),/Synthetic natural growth commit failure/);
 assert.equal(rejected,1);assert.equal(events.length,eventCount,'a rejected draft publishes no observations');
 assert.deepEqual(runtime.directEatingEvidenceStatus(),statusBefore);
 assert.deepEqual(runtime.world,before,'every world mutation is rolled back');
 assert.deepEqual(store.loadForRuntime(),savedBefore,'durable world remains unchanged');
 commit.mock.restore();runtime.tick(now+=1000);
 assertFreshGrowth(runtime.world);
 for(let i=0;i<5;i++)runtime.tick(now+=1000);
 runtime.stop();
 const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());
 assert.equal(report.foodFlows.complete,true,report.foodFlows.issues.join(', '));
 const receipts=report.foodFlows.observedReceipts;
 assert.equal(receipts.length,5,'one fruit and four food animal sources, never sheep wool');
 assert.deepEqual(report.foodFlows.totals!.sourceAdded.units,{fruit:1,egg:1,duckEgg:1,milk:2});
 const loaded=store.loadForRuntime()!;assertFreshGrowth(loaded);
 for(const receipt of receipts){
  assert.equal(receipt.type,'source_added');
  assert.ok(receipt.action==='fruit_growth'||receipt.action==='animal_product');
  assert.equal(receipt.ownerId,r.id);assert.equal(receipt.residentId,null);
  assert.equal(receipt.eventId,null);assert.equal(receipt.planId,null);
  assert.equal(receipt.outputs.length,1);assert.equal(receipt.outputs[0].quantity,1);
  if(receipt.action==='fruit_growth'){
   assert.equal(receipt.sourceId,'growth-tree');assert.equal(receipt.container,'orchard-stock:growth-tree');
   assert.equal(receipt.outputs[0].item,'fruit');
  }else{
   assert.equal(receipt.sourceId,'growth-'+receipt.species);
   assert.equal(receipt.container,'animal-stock:'+receipt.sourceId);
   assert.equal(receipt.outputs[0].item,animalProducts[receipt.species]);
  }
  const output=receipt.outputs[0];assert.ok(output.lots?.length);
  for(const lot of output.lots!){assert.equal(lot.producedAt,receipt.at);assert.ok(lot.expiresAt>receipt.at);}
  assert.deepEqual(output.lots!.map(({nutrition,...lot})=>lot),loaded.food!.lots[receipt.container][output.item]);
 }
 for(const event of events)if(event.type==='food_step_committed')assert.equal(event.foodFlowCoverage,FOOD_FLOW_COVERAGE);
 assert.doesNotMatch(JSON.stringify(loaded),/"(?:foodFlows|foodFlowCoverage|observedReceipts|sourceAdded)"\s*:/);
 const reloadedEvents:RuntimeFoodEvent[]=[];
 const reloaded=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{reloadedEvents.push(e);}}});
 t.after(()=>reloaded.stop());reloaded.start();
 for(let i=0;i<5;i++)reloaded.tick(now+=1000);
 reloaded.stop();assertFreshGrowth(reloaded.world);
 const restarted=auditRuntimeFoodEvidence(reloadedEvents,reloaded.directEatingEvidenceStatus());
 assert.equal(restarted.foodFlows.complete,true,restarted.foodFlows.issues.join(', '));
 assert.deepEqual(restarted.foodFlows.observedReceipts,[],'loading committed growth does not replay receipts');
 assert.equal(fetchCalls,0);assert.equal(modelCalls,0);
});

test('disabled runtime growth evidence leaves actual stock, lots and the whole saved world unchanged',t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,fetchCalls=0,modelCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
 const model=async()=>{modelCalls++;throw new Error('No model');};
 const {w}=growthFlowFixture(),events:RuntimeFoodEvent[]=[];
 const stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];
 for(const store of stores){store.commit(structuredClone(w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'});
 const enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 for(const runtime of [disabled,enabled]){t.after(()=>runtime.stop());runtime.start();}
 for(let i=0;i<6;i++){now+=1000;disabled.tick(now);enabled.tick(now);}
 for(const runtime of [disabled,enabled])runtime.stop();
 assertFreshGrowth(disabled.world);assert.equal(disabled.directEatingEvidenceStatus(),null);
 assert.deepEqual(disabled.world,enabled.world);
 assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
 assert.equal(auditRuntimeFoodEvidence(events,enabled.directEatingEvidenceStatus()).foodFlows.observedReceipts.length,5);
 assert.equal(fetchCalls,0);assert.equal(modelCalls,0);
});

import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import type {IndustryAction} from '../src/shared/industry.js';
import {submitPlan} from '../src/world/engine.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {fishingKey,fishingStockAt,waterAtShore} from '../src/world/fishing.js';

for(const operation of ['fish','hunt'] as const){
 test(`actual ${operation} completion publishes only after durable commit and retries exactly once`,t=>{
  t.mock.timers.enable({apis:['setInterval']});
  let fetchCalls=0,now=1_700_000_000_000;
  t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw new Error('No network');});
  t.mock.method(Date,'now',()=>now);
  const world=createFrontierWorld();
  world.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
  for(const beast of world.frontierHazards!.beasts){beast.nextMoveAt=world.minute+10000;beast.cooldownUntil=world.minute+10000;}
  for(const resident of world.residents){resident.lastDecisionAt=world.minute;resident.decisionDue=world.minute+10000;}
  const resident=operation==='fish'?world.residents.find(r=>r.id==='founder-3-2')!:world.residents.find(r=>r.skills.building>0)!;
  const beast=world.frontierHazards!.beasts.find(b=>b.species==='boar')!;
  const shore=world.industry!.frontierShore!;
  const pool=fishingStockAt(world,shore)!;
  if(operation==='hunt'){
   resident.at={...beast.at};resident.inside=null;resident.roomAt=null;beast.health=1;
   world.industry!.tools.push({id:'commit-test-spear',ownerId:resident.id,kind:'spear',level:1,durability:10,maxDurability:10});
  }
  const item=operation==='fish'?'carp':'gameMeat',quantity=operation==='fish'?1:5;
  const species=operation==='fish'?'carp':'boar';
  const sourceId=operation==='fish'?'shoal:'+fishingKey(waterAtShore(world,shore)!):beast.id;
  const tool=world.industry!.tools.find(v=>v.ownerId===resident.id&&v.kind===(operation==='fish'?'rod':'spear'))!;
  assert.ok(tool,'a real owned tool is required');
  const durability=tool.durability,opening=resident.inventory[item]??0,fishOpening=pool.species!.carp!.amount;
  const choices=decisionChoices(decisionContext(world,resident));
  const choice=choices.find(c=>c.action.type==='industry'&&c.action.operation===operation&&(operation==='fish'?c.action.fishSpecies==='carp':c.action.beastId===beast.id));
  assert.ok(choice,'the actual decision menu offers the requested wild food action');
  const parsed=parseChoice(JSON.stringify({choice:choice.id}),choices);
  assert.equal((parsed.actions[0] as IndustryAction).operation,operation);
  const planId=`wild-commit-${operation}`;
  const result=submitPlan(world,{id:planId,actorId:resident.id,actorRevision:resident.revision,createdAt:world.minute,
   definition:world.activeDefinitions['action/routine'],intention:'Offline durable wild food test',actions:parsed.actions});
  assert.ok(result.ok,result.error);
  const store=new WorldStore(':memory:');store.commit(world,null);t.after(()=>store.close());
  const events:RuntimeFoodEvent[]=[];
  const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('No model');},
   {mode:'formal',directEatingEvidence:{observe:event=>{events.push(event);}}});
  t.after(()=>runtime.stop());runtime.start();
  const original=store.commit.bind(store);let rejected=false;
  const commit=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
   const draft=args[0],actor=draft.residents.find(r=>r.id===resident.id)!;
   if((actor.inventory[item]??0)>opening){
    assert.equal(actor.inventory[item],opening+quantity,'failure occurs after the real inventory change');
    assert.equal(draft.industry!.tools.find(v=>v.id===tool.id)!.durability,durability-1);
    assert.ok(draft.food!.lots['person:'+resident.id][item]!.some(lot=>lot.producedAt>=world.minute&&lot.producedAt<=draft.minute));
    rejected=true;throw new Error('Synthetic wild food commit failure');
   }
   return original(...args);
  });
  for(let i=0;i<300&&!rejected;i++){
   const before=structuredClone(runtime.world),savedBefore=store.loadForRuntime(),eventCount=events.length;
   try{runtime.tick(now+=1000);}catch(error){
    assert.match(String(error),/Synthetic wild food commit failure/);
    assert.equal(events.length,eventCount,'the rejected draft publishes no event');
    assert.deepEqual(runtime.world,before,'all world and resident mutations roll back');
    assert.deepEqual(store.loadForRuntime(),savedBefore,'durable state stays unchanged');
   }
  }
  assert.equal(rejected,true,'the actual successful food action reached the rejected commit');
  assert.equal(events.some(e=>e.type==='food_step_committed'&&e.foodFlows?.some(r=>r.action===operation)),false);
  assert.equal(store.loadForRuntime()!.residents.find(r=>r.id===resident.id)!.inventory[item]??0,opening);
  commit.mock.restore();runtime.tick(now+=1000);
  for(let i=0;i<5;i++)runtime.tick(now+=1000);
  runtime.stop();
  const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());
  assert.equal(report.foodFlows.complete,true,report.foodFlows.issues.join(", "));
  const receipts=report.foodFlows.observedReceipts;
  assert.equal(receipts.length,1,'retry and later ticks cannot duplicate output evidence');
  const receipt=receipts[0];assert.equal(receipt.type,'source_added');
  assert.equal(receipt.action,operation);assert.equal(receipt.planId,planId);assert.equal(receipt.residentId,resident.id);
  assert.ok('sourceId' in receipt&&receipt.sourceId===sourceId);
  assert.ok('species' in receipt&&receipt.species===species);
  assert.equal(receipt.outputs.length,1);assert.equal(receipt.outputs[0].item,item);assert.equal(receipt.outputs[0].quantity,quantity);
  assert.ok(receipt.outputs[0].lots?.length);
  for(const lot of receipt.outputs[0].lots!){assert.equal(lot.producedAt,receipt.at);assert.ok(lot.expiresAt>receipt.at);}
  assert.equal(report.foodFlows.totals!.sourceAdded.units[item],quantity);
  for(const event of events)if(event.type==='food_step_committed')assert.equal(event.foodFlowCoverage,FOOD_FLOW_COVERAGE);
  const loaded=store.loadForRuntime()!;
  assert.equal(loaded.residents.find(r=>r.id===resident.id)!.inventory[item],opening+quantity);
  assert.equal(loaded.industry!.tools.find(v=>v.id===tool.id)!.durability,durability-1);
  assert.deepEqual(receipt.outputs[0].lots!.map(({nutrition,...lot})=>lot),loaded.food!.lots['person:'+resident.id][item]);
  if(operation==='fish')assert.equal(fishingStockAt(loaded,shore)!.species!.carp!.amount,fishOpening-1);
  else assert.equal(loaded.frontierHazards!.beasts.find(v=>v.id===beast.id)!.status,'dead');
  assert.doesNotMatch(JSON.stringify(loaded),/"(?:foodFlows|foodFlowCoverage|observedReceipts|sourceAdded)"\s*:/,'observations never enter saved world state');
  assert.equal(fetchCalls,0);
 });
}

import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditRuntimeFoodEvidence,observedFoodFlowsByDay} from '../src/server/nine-resident-acceptance.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import type {FoodFlowReceipt} from '../src/world/food-consumption-evidence.js';
const amount=()=>({item:'berry' as const,quantity:2,nutrition:16,lots:[{quantity:2,producedAt:481,expiresAt:600,definition:'food/life@1',nutrition:16}]});
const flow=():FoodFlowReceipt=>({type:'source_added',action:'gather_berry',at:481,residentId:'r',eventId:'event',planId:'plan',container:'resident:r',sourceId:'berry:1',definition:'action/routine@1',outputs:[amount()]});
function session(flows:FoodFlowReceipt[]|undefined=[flow()]){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start('fixture',480);food.committed({worldId:'fixture',fromMinute:480,toMinute:481,receipts:[],foodFlowCoverage:FOOD_FLOW_COVERAGE,...(flows===undefined?{}:{foodFlows:flows})},1);food.stop('fixture',481);
 return {events,food,report:auditRuntimeFoodEvidence(events,food.status())};
}
test('flow legs are separate, immutable and never net production or consumption',()=>{
 const input=flow(),cook:FoodFlowReceipt={type:'processed',action:'cook',at:481,residentId:'r',eventId:'cook',planId:'plan',container:'resident:r',definition:'recipe/meal@1',inputs:[amount()],outputs:[{...amount(),item:'meal',quantity:1,nutrition:null,lots:null}]};
 const f=session([input,cook]);input.outputs[0].quantity=999;
 const step=f.events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 assert.ok(Object.isFrozen(step.foodFlows));assert.ok(Object.isFrozen(step.foodFlows![0].outputs[0].lots![0]));
 assert.equal(step.foodFlows![0].outputs[0].quantity,2);
 assert.deepEqual(f.report.foodFlows.totals,{sourceAdded:{units:{berry:2},nutrition:16},processingInputs:{units:{berry:2},nutrition:16},processingOutputs:{units:{meal:1},nutrition:null}});
 assert.equal(f.report.foodProduction,null);assert.equal(f.report.foodConsumption,null);assert.equal(f.report.totals!.completedActions,0);
});
test('legacy missing flow observations, dropped events and invalid facts remain unknown',()=>{
 const f=session([]);assert.equal(f.report.foodFlows.complete,true);
 const legacy=structuredClone(f.events);delete (legacy[1] as {foodFlows?:unknown}).foodFlows;
 assert.equal(auditRuntimeFoodEvidence(legacy,f.food.status()).foodFlows.totals,null);
 assert.equal(auditRuntimeFoodEvidence(f.events.slice(1),f.food.status()).foodFlows.totals,null);
 const invalid=flow();invalid.outputs[0].quantity=-1;
 const bad=session([invalid]);assert.equal(bad.food.status().phase,'failed');assert.equal(bad.report.foodFlows.totals,null);
 const duplicate=session([flow(),flow()]);assert.equal(duplicate.report.foodFlows.totals,null);
});
test('schema rejects nested extras, accessors, nonfinite quantities and prompt fields without invoking getters',()=>{
 const valid=session().events[1];assert.deepEqual(checkedFoodEvent(valid),valid);
 for(const path of ['receipt','amount','lot'] as const){
  const bad=structuredClone(valid) as any;
  const target=path==='receipt'?bad.foodFlows[0]:path==='amount'?bad.foodFlows[0].outputs[0]:bad.foodFlows[0].outputs[0].lots[0];
  target.prompt='PRIVATE';assert.throws(()=>checkedFoodEvent(bad),/invalid_evidence_schema/);
 }
 for(const value of [Infinity,NaN,-1]){const bad=structuredClone(valid) as any;bad.foodFlows[0].outputs[0].quantity=value;assert.throws(()=>checkedFoodEvent(bad));}
 let calls=0;const bad=structuredClone(valid) as any;Object.defineProperty(bad.foodFlows[0].outputs[0],'nutrition',{get(){calls++;return 8;}});
 assert.throws(()=>checkedFoodEvent(bad));assert.equal(calls,0);
 const legacy=structuredClone(valid) as any;delete legacy.foodFlows;delete legacy.foodFlowCoverage;assert.deepEqual(checkedFoodEvent(legacy),legacy);
});
test('throwing and asynchronous sinks stop optional evidence without throwing',()=>{
 for(const observe of [()=>{throw new Error('PRIVATE');},()=>Promise.reject(new Error('PRIVATE'))]){
  const food=new RuntimeFoodEvidence({observe});assert.doesNotThrow(()=>food.start('fixture',480));assert.equal(food.status().phase,'failed');
 }
});
test('writer reload preserves flow facts and corruption clears both exposed totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'valley-flow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fingerprint='a'.repeat(64);
 const writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:'fixture',fromMinute:480});t.after(()=>writer.abort());
 const wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1}),food=new RuntimeFoodEvidence({observe:writer.observeDirectEating});
 wait.start(480);food.start('fixture',480);food.committed({worldId:'fixture',fromMinute:480,toMinute:481,receipts:[],foodFlowCoverage:FOOD_FLOW_COVERAGE,foodFlows:[flow()]},1);wait.stop(481);food.stop('fixture',481);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
 assert.equal(result.complete,true);assert.equal(result.foodFlows.totals!.sourceAdded.units.berry,2);assert.deepEqual(readAcceptanceEvidence(directory),result);
 const path=join(directory,'evidence.jsonl');writeFileSync(path,readFileSync(path,'utf8').replace('"quantity":2','"quantity":3'));
 const corrupt=readAcceptanceEvidence(directory);assert.equal(corrupt.complete,false);assert.equal(corrupt.foodFlows.totals,null);assert.equal(corrupt.directEating.foodFlows.totals,null);
});

test('runtime optional switch and failed durable commits cannot publish flow observations',async t=>{
 const {ValleyRuntime}=await import('../src/server/runtime.js');
 const {WorldStore}=await import('../src/server/store.js');
 const {createFrontierWorld}=await import('../src/world/formal-seed.js');
 const {QWEN_MODEL}=await import('../src/server/model-completion.js');
 t.mock.timers.enable({apis:['setInterval']});
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network');});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const world=createFrontierWorld();for(const r of world.residents){r.lastDecisionAt=world.minute;r.decisionDue=world.minute+1000;}
 const store=new WorldStore(':memory:');store.commit(world,null);t.after(()=>store.close());
 const plain=new ValleyRuntime(store,null);assert.equal(plain.directEatingEvidenceStatus(),null);plain.stop();
 const events:RuntimeFoodEvent[]=[];
 const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('No model');},
  {mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 t.after(()=>runtime.stop());runtime.start();runtime.tick(now+=1000);
 const committed=events.filter(e=>e.type==='food_step_committed');assert.ok(committed.length>0);
 for(const step of committed){assert.deepEqual(step.foodFlows,[]);assert.ok(Object.isFrozen(step.foodFlows));}
 const before=structuredClone(runtime.world),count=events.length;
 const failedCommit=t.mock.method(store,'commit',()=>{throw new Error('Synthetic durable failure');});
 assert.throws(()=>runtime.tick(now+=1000),/durable failure/);assert.equal(events.length,count);assert.deepEqual(runtime.world,before);
 failedCommit.mock.restore();runtime.stop();
});

test('flow validation rejects array accessors and preserves unknown batch metadata',()=>{
 const event=structuredClone(session().events[1]) as any;let calls=0;
 Object.defineProperty(event.foodFlows[0].outputs,'0',{get(){calls++;return amount();}});
 assert.throws(()=>checkedFoodEvent(event));assert.equal(calls,0);
 const unknown=flow();unknown.outputs[0].nutrition=null;unknown.outputs[0].lots=null;
 const result=session([unknown]).report.foodFlows;
 assert.equal(result.complete,true);assert.deepEqual(result.totals!.sourceAdded,{units:{berry:2},nutrition:null});
 const overflow=flow();overflow.outputs=[{...amount(),quantity:Number.MAX_VALUE,nutrition:Number.MAX_VALUE,lots:null},{...amount(),quantity:Number.MAX_VALUE,nutrition:Number.MAX_VALUE,lots:null}];
 assert.equal(session([overflow]).report.foodFlows.totals,null);
 const malformed=flow();malformed.outputs[0].lots![0].quantity=1;
 assert.equal(session([malformed]).report.foodFlows.totals,null);
});

test('audit refuses inconsistent nutrition, empty food lots and impossible receipt-time metadata',()=>{
 const mutations=[
  (r:FoodFlowReceipt)=>{r.outputs[0].lots![0].nutrition=8;},
  (r:FoodFlowReceipt)=>{r.outputs[0].lots![0].nutrition=null;},
  (r:FoodFlowReceipt)=>{r.outputs[0].lots=null;},
  (r:FoodFlowReceipt)=>{r.outputs[0].lots=[];},
  (r:FoodFlowReceipt)=>{r.outputs[0].lots![0].producedAt=482;},
  (r:FoodFlowReceipt)=>{r.outputs[0].lots![0].producedAt=480;},
  (r:FoodFlowReceipt)=>{r.outputs[0].lots![0].expiresAt=481;},
 ];
 for(const mutate of mutations){const r=flow();mutate(r);assert.equal(session([r]).report.foodFlows.totals,null);}
 const conservative=flow();conservative.outputs[0].nutrition=null;
 assert.equal(session([conservative]).report.foodFlows.totals!.sourceAdded.nutrition,null);
 const water=flow();water.outputs=[{item:'water',quantity:1,nutrition:0,lots:[]}];
 assert.equal(session([water]).report.foodFlows.complete,true);
});

test('daily flow grouping assigns exact midnight and fractional crossing without filling missing days',()=>{
 const before=flow(),after=flow();before.at=1440;after.at=1440.25;after.eventId='later';
 const event={...session().events[1],fromMinute:1439.75,toMinute:1440.5,foodFlows:[before,after]} as RuntimeFoodEvent;
 const days=observedFoodFlowsByDay([event]);assert.deepEqual(days.map(d=>[d.calendarDay,d.receipts.map(r=>r.at)]),[[0,[1440]],[1,[1440.25]]]);
 assert.deepEqual(observedFoodFlowsByDay([]),[]);
 const legacy=structuredClone(event) as any;delete legacy.foodFlows;delete legacy.foodFlowCoverage;assert.deepEqual(observedFoodFlowsByDay([legacy]),[]);
});

test('actual gather completion with failed durable commit publishes no draft flow and retries exactly once',async t=>{
 const {ValleyRuntime}=await import('../src/server/runtime.js');
 const {WorldStore}=await import('../src/server/store.js');
 const {createFrontierWorld}=await import('../src/world/formal-seed.js');
 const {submitPlan}=await import('../src/world/engine.js');
 const {QWEN_MODEL}=await import('../src/server/model-completion.js');
 t.mock.timers.enable({apis:['setInterval']});
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network');});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const world=createFrontierWorld();for(const r of world.residents){r.lastDecisionAt=world.minute;r.decisionDue=world.minute+1000;}
 const r=world.residents[0];world.resources.push({id:'flow-bush',kind:'bush',at:{x:r.at.x+1,y:r.at.y},amount:12,max:12,regrowthDays:0,lastHarvest:0});r.knownResources.push('flow-bush');
 assert.equal(submitPlan(world,{id:'flow-plan',actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Offline gather',actions:[{type:'gather',resourceId:'flow-bush',quantity:2}]}).ok,true);
 const store=new WorldStore(':memory:');store.commit(world,null);t.after(()=>store.close());
 const events:RuntimeFoodEvent[]=[],runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('No model');},{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 t.after(()=>runtime.stop());runtime.start();
 const original=store.commit.bind(store);let rejected=false;
 const commit=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  if(args[0].resources.find(v=>v.id==='flow-bush')!.amount===10){rejected=true;throw new Error('Gather commit failure');}
  return original(...args);
 });
 for(let i=0;i<100&&!rejected;i++){
  const count=events.length,before=structuredClone(runtime.world);
  try{runtime.tick(now+=1000);}catch(error){assert.match(String(error),/Gather commit failure/);assert.equal(events.length,count);assert.deepEqual(runtime.world,before);}
 }
 assert.equal(rejected,true);assert.equal(events.some(e=>e.type==='food_step_committed'&&e.foodFlows!.length>0),false);
 assert.equal(store.loadForRuntime()!.resources.find(v=>v.id==='flow-bush')!.amount,12);
 commit.mock.restore();runtime.tick(now+=1000);runtime.stop();
 const report=auditRuntimeFoodEvidence(events,runtime.directEatingEvidenceStatus());
 assert.equal(report.foodFlows.complete,true);assert.equal(report.foodFlows.observedReceipts.length,1);assert.equal(report.foodFlows.totals!.sourceAdded.units.berry,2);
 assert.equal(store.loadForRuntime()!.resources.find(v=>v.id==='flow-bush')!.amount,10);
});

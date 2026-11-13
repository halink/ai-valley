import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import type {World} from '../src/shared/types.js';
import {seedFlowFixture,queueSeedFlow} from './helpers/food-flow-seed.js';

const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
const tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
function receipts(events:RuntimeFoodEvent[]){
 return events.flatMap(e=>e.type==='food_step_committed'?e.foodFlows??[]:[]).filter(f=>f.action==='saveSeed');
}
function converted(w:World,residentId:string,initial:{turnip:number;seed:number;saved:number}){
 const r=w.residents.find(p=>p.id===residentId)!;
 assert.equal(r.inventory.turnip??0,initial.turnip-1);
 assert.equal(r.inventory.seed??0,initial.seed+2);
 assert.equal(w.production!.seedSaved,initial.saved+2);
}

for(const failure of ['sqlite','revision'] as const)test(`saveSeed rolls back on actual ${failure} rejection, commits once on retry and never replays after restart`,t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});
 const model=async()=>{modelCalls++;throw Error('No model');};
 const {w,r}=seedFlowFixture();w.clock.realMinutesPerDay=24;
 const initial={turnip:r.inventory.turnip??0,seed:r.inventory.seed??0,saved:w.production?.seedSaved??0};
 const plan=queueSeedFlow(w,r,true),events:RuntimeFoodEvent[]=[];
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 t.after(()=>runtime.stop());runtime.start();
 for(let i=0;i<100;i++){
  if(runtime.world.residents.find(p=>p.id===r.id)!.activity?.remaining===1)break;
  runtime.tick(now+=1000);
 }
 assert.equal(runtime.world.residents.find(p=>p.id===r.id)!.activity!.remaining,1);
 assert.deepEqual(receipts(events),[]);
 const db=(store as unknown as {db:DatabaseSync}).db;
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite'){
  db.exec("CREATE TEMP TRIGGER reject_seed BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_seed_sql_failure'); END");
 }else{
  const winner=store.loadForRuntime()!,revision=winner.revision;
  winner.revision++;store.commit(winner,revision);
 }
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot();
 const status=runtime.directEatingEvidenceStatus(),count=events.length,original=store.commit.bind(store);
 let drafts=0;
 const inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  converted(args[0],r.id,initial);drafts++;return original(...args);
 });
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_seed_sql_failure/:/stale_world_revision/);
 assert.equal(drafts,1);inspect.mock.restore();
 assert.deepEqual(runtime.world,before);
 assert.deepEqual(store.loadForRuntime(),saved);
 assert.deepEqual(snapshot(),sqlBefore);
 assert.deepEqual(runtime.directEatingEvidenceStatus(),status);
 assert.equal(events.length,count);
 assert.deepEqual(receipts(events),[]);
 let recovered=runtime;
 const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_seed');
 else{
  assert.throws(()=>runtime.stop(),/stale_world_revision/);
  assert.deepEqual(store.loadForRuntime(),saved);
  recovered=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{recoveredEvents.push(e);}}});
  t.after(()=>recovered.stop());recovered.start();
 }
 recovered.tick(now+=1000);
 assert.equal(receipts(recoveredEvents).length,1);
 for(let i=0;i<4;i++)recovered.tick(now+=1000);
 recovered.stop();
 converted(recovered.world,r.id,initial);converted(store.loadForRuntime()!,r.id,initial);
 const flows=receipts(recoveredEvents);assert.equal(flows.length,1);
 const flow=flows[0];
 assert.equal(flow.type,'processed');assert.equal(flow.residentId,r.id);
 assert.equal(flow.planId,plan.id);assert.equal(flow.definition,plan.definition);
 assert.equal(flow.container,'person:'+r.id);
 assert.deepEqual(flow.inputs.map(a=>({item:a.item,quantity:a.quantity})),[{item:'turnip',quantity:1}]);
 assert.deepEqual(flow.outputs,[{item:'seed',quantity:2,nutrition:0,lots:[]}]);
 assert.ok(recovered.world.events.some(e=>e.id===flow.eventId));
 assert.equal(Object.isFrozen(flow),true);assert.equal(Object.isFrozen(flow.inputs),true);
 assert.equal(Object.isFrozen(flow.inputs[0]),true);assert.equal(Object.isFrozen(flow.inputs[0].lots),true);
 assert.equal(Object.isFrozen(flow.outputs),true);assert.equal(Object.isFrozen(flow.outputs[0]),true);
 assert.equal(Object.isFrozen(flow.outputs[0].lots),true);
 for(const e of recoveredEvents)if(e.type==='food_step_committed')assert.equal(e.foodFlowCoverage,FOOD_FLOW_COVERAGE);
 const report=auditRuntimeFoodEvidence(recoveredEvents,recovered.directEatingEvidenceStatus());
 assert.equal(report.foodFlows.complete,true,report.foodFlows.issues.join(', '));
 assert.equal(report.foodFlows.observedReceipts.length,1);
 const restartEvents:RuntimeFoodEvent[]=[];
 const restart=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{restartEvents.push(e);}}});
 t.after(()=>restart.stop());restart.start();
 for(let i=0;i<4;i++)restart.tick(now+=1000);
 restart.stop();assert.deepEqual(receipts(restartEvents),[]);
 converted(restart.world,r.id,initial);converted(store.loadForRuntime()!,r.id,initial);
 assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

for(const failObserver of [false,true])test(`saveSeed evidence observer does not change default-off runtime world or durable save (throws=${failObserver})`,t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,modelCalls=0,fetchCalls=0,thrown=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});
 const model=async()=>{modelCalls++;throw Error('No model');};
 const {w,r}=seedFlowFixture();w.clock.realMinutesPerDay=24;
 const initial={turnip:r.inventory.turnip??0,seed:r.inventory.seed??0,saved:w.production?.seedSaved??0};
 queueSeedFlow(w,r,true);
 const events:RuntimeFoodEvent[]=[],stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];
 for(const store of stores){store.commit(structuredClone(w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'});
 const enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{
  events.push(e);
  if(failObserver&&e.type==='food_step_committed'&&e.foodFlows?.some(f=>f.action==='saveSeed')){
   thrown++;throw Error('Synthetic seed observer failure');
  }
 }}});
 for(const runtime of [disabled,enabled]){t.after(()=>runtime.stop());runtime.start();}
 for(let i=0;i<30;i++){now+=1000;disabled.tick(now);enabled.tick(now);}
 for(const runtime of [disabled,enabled])runtime.stop();
 converted(disabled.world,r.id,initial);
 assert.deepEqual(enabled.world,disabled.world);
 assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
 assert.equal(disabled.directEatingEvidenceStatus(),null);
 assert.equal(receipts(events).length,1);assert.equal(thrown,failObserver?1:0);
 assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

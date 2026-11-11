import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {employmentFlowFixture,queueEmploymentFlow} from './helpers/food-flow-employment.js';
import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
function receipts(events:RuntimeFoodEvent[]){return events.flatMap(e=>e.type==='food_step_committed'?e.foodFlows??[]:[]).filter(f=>f.action==='employment_processing');}
function fixture(){const f=employmentFlowFixture();f.w.clock.realMinutesPerDay=24;for(const merchant of f.w.foreignTrade?.merchants??[])merchant.person.decisionDue=f.w.minute+10000;for(const contact of f.w.migration?.contacts??[]){contact.phase='home';contact.futureAt=f.w.minute+10000;}queueEmploymentFlow(f,20,true);return f;}

for(const failure of ['sqlite','revision'] as const)test(`employment actual ${failure} commit rejection publishes nothing; recovery and restart publish completion once`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});
 const model=async()=>{modelCalls++;throw Error('No model');};
 const f=fixture(),{w,c,b,worker}=f,events:RuntimeFoodEvent[]=[];
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 assert.deepEqual(receipts(events),[]);
 for(let i=0;i<120;i++){const contract=runtime.world.employment!.contracts.find(x=>x.id===c.id)!;if(contract.batch?.progress===contract.recipe!.minutes-1)break;runtime.tick(now+=1000);}
 const contract=runtime.world.employment!.contracts.find(x=>x.id===c.id)!;assert.equal(contract.batch!.progress,contract.recipe!.minutes-1);assert.equal(contract.attendance[0].produced,0);assert.deepEqual(receipts(events),[]);
 const db=(store as unknown as {db:DatabaseSync}).db,tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite')db.exec("CREATE TEMP TRIGGER reject_employment BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_employment_sql_failure'); END");
 else{const winner=store.loadForRuntime()!,revision=winner.revision;winner.revision++;store.commit(winner,revision);}
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 const original=store.commit.bind(store);let drafts=0;
 const inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{const contract=args[0].employment!.contracts.find(x=>x.id===c.id)!;
 assert.equal(contract.batch,null);assert.equal(contract.attendance[0].produced,1);assert.equal(args[0].economy!.businesses.find(x=>x.id===b.id)!.inventory.meal,1);drafts++;return original(...args);});
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_employment_sql_failure/:/stale_world_revision/);assert.equal(drafts,1);inspect.mock.restore();
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);assert.deepEqual(receipts(events),[]);
 let recovered=runtime;const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_employment');else{runtime.stop();recovered=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{recoveredEvents.push(e);}}});t.after(()=>recovered.stop());recovered.start();}
 recovered.tick(now+=1000);for(let i=0;i<4;i++)recovered.tick(now+=1000);recovered.stop();
 const flows=receipts(recoveredEvents);assert.equal(flows.length,1);assert.equal(flows[0].contractId,c.id);assert.equal(flows[0].batchNumber,1);assert.equal(flows[0].businessId,b.id);assert.equal(flows[0].residentId,worker.id);assert.equal(flows[0].outputs[0].quantity,1);
 assert.equal(store.loadForRuntime()!.employment!.totals.produced,1);assert.equal(store.loadForRuntime()!.economy!.businesses.find(x=>x.id===b.id)!.inventory.meal,1);
 for(const e of recoveredEvents)if(e.type==='food_step_committed')assert.equal(e.foodFlowCoverage,FOOD_FLOW_COVERAGE);
 const restartedEvents:RuntimeFoodEvent[]=[],restarted=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{restartedEvents.push(e);}}});t.after(()=>restarted.stop());restarted.start();for(let i=0;i<4;i++)restarted.tick(now+=1000);restarted.stop();
 assert.deepEqual(receipts(restartedEvents),[]);assert.equal(restarted.world.employment!.totals.produced,1);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

for(const failObserver of [false,true])test(`employment runtime ${failObserver?'throwing observer':'evidence enabled'} equals disabled world and durable save`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0,thrown=0;
 t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});const model=async()=>{modelCalls++;throw Error('No model');};
 const {w,b}=fixture(),events:RuntimeFoodEvent[]=[],stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];for(const store of stores){store.commit(structuredClone(w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'}),enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);if(failObserver&&e.type==='food_step_committed'&&e.foodFlows?.some(f=>f.action==='employment_processing')){thrown++;throw Error('Synthetic employment observer failure');}}}});
 for(const r of [disabled,enabled]){t.after(()=>r.stop());r.start();}for(let i=0;i<30;i++){now+=1000;disabled.tick(now);enabled.tick(now);}for(const r of [disabled,enabled])r.stop();
 assert.equal(disabled.world.economy!.businesses.find(x=>x.id===b.id)!.inventory.meal,1);assert.equal(disabled.world.employment!.totals.produced,1);assert.deepEqual(enabled.world,disabled.world);assert.deepEqual(stores[1].loadForRuntime(),stores[0].loadForRuntime());assert.equal(disabled.directEatingEvidenceStatus(),null);assert.equal(receipts(events).length,1);assert.equal(thrown,failObserver?1:0);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

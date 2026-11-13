import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {houseHarvestFixture,custodyHarvestFixture,queueHarvest} from './helpers/food-flow-harvest.js';
import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import type {World} from '../src/shared/types.js';
const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
function receipts(events:RuntimeFoodEvent[]){return events.flatMap(e=>e.type==='food_step_committed'?e.foodFlows??[]:[]).filter(f=>f.action==='harvest_house'||f.action==='custody_harvest');}
function complete(w:World,kind:'house'|'custody',residentId:string){if(kind==='house'){assert.equal(w.industry!.beds[0].crop,null);assert.equal(w.residents.find(r=>r.id===residentId)!.inventory.turnip,12);}else {assert.equal(w.plots[0].crop,null);const c=w.production!.protectedCustody!.mandates[0];assert.equal(c.workSerial,1);assert.equal(c.records.length,1);assert.equal(w.estates[0].parcels!.find(p=>p.id===`custody-stock:${c.id}:0`)!.inventory.turnip,12);}}
for(const kind of ['house','custody'] as const)for(const failure of ['sqlite','revision'] as const)test(`${kind} harvest physical completion rolls back on actual ${failure} commit rejection, retries once and never replays after restart`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});const model=async()=>{modelCalls++;throw Error('No model');};
 const f=kind==='house'?houseHarvestFixture():custodyHarvestFixture(),{w,r}=f;queueHarvest(f,true);const events:RuntimeFoodEvent[]=[];const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 for(let i=0;i<100;i++){if(runtime.world.residents.find(p=>p.id===r.id)!.activity?.remaining===1)break;runtime.tick(now+=1000);}
 assert.equal(runtime.world.residents.find(p=>p.id===r.id)!.activity!.remaining,1);assert.deepEqual(receipts(events),[]);
 const db=(store as unknown as {db:DatabaseSync}).db,tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite')db.exec("CREATE TEMP TRIGGER reject_harvest BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_harvest_sql_failure'); END");else{const winner=store.loadForRuntime()!,revision=winner.revision;winner.revision++;store.commit(winner,revision);}
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length,original=store.commit.bind(store);let drafts=0;
 const inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{complete(args[0],kind,r.id);drafts++;return original(...args);});
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_harvest_sql_failure/:/stale_world_revision/);assert.equal(drafts,1);inspect.mock.restore();assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);assert.deepEqual(receipts(events),[]);
 let recovered=runtime;const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_harvest');else{assert.throws(()=>runtime.stop(),/stale_world_revision/);assert.deepEqual(store.loadForRuntime(),saved);recovered=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{recoveredEvents.push(e);}}});t.after(()=>recovered.stop());recovered.start();}
 recovered.tick(now+=1000);for(let i=0;i<4;i++)recovered.tick(now+=1000);recovered.stop();complete(recovered.world,kind,r.id);complete(store.loadForRuntime()!,kind,r.id);
 const flows=receipts(recoveredEvents);assert.equal(flows.length,1);assert.equal(flows[0].residentId,r.id);assert.equal(flows[0].outputs[0].quantity,12);assert.equal(Object.isFrozen(flows[0]),true);assert.equal(Object.isFrozen(flows[0].outputs),true);assert.equal(Object.isFrozen(flows[0].outputs[0].lots),true);
 for(const e of recoveredEvents)if(e.type==='food_step_committed')assert.equal(e.foodFlowCoverage,FOOD_FLOW_COVERAGE);
 const report=auditRuntimeFoodEvidence(recoveredEvents,recovered.directEatingEvidenceStatus());assert.equal(report.foodFlows.complete,true,report.foodFlows.issues.join(', '));assert.equal(report.foodFlows.observedReceipts.length,1);
 const restartEvents:RuntimeFoodEvent[]=[],restart=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{restartEvents.push(e);}}});t.after(()=>restart.stop());restart.start();for(let i=0;i<4;i++)restart.tick(now+=1000);restart.stop();assert.deepEqual(receipts(restartEvents),[]);complete(restart.world,kind,r.id);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});
for(const kind of ['house','custody'] as const)for(const failObserver of [false,true])test(`${kind} harvest enabled or throwing observer does not change default-off runtime world or durable save (${failObserver})`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0,thrown=0;t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});const model=async()=>{modelCalls++;throw Error('No model');};
 const f=kind==='house'?houseHarvestFixture():custodyHarvestFixture();queueHarvest(f,true);const events:RuntimeFoodEvent[]=[],stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];for(const store of stores){store.commit(structuredClone(f.w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'}),enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);if(failObserver&&e.type==='food_step_committed'&&e.foodFlows?.some(f=>f.action==='harvest_house'||f.action==='custody_harvest')){thrown++;throw Error('Synthetic harvest observer failure');}}}});
 for(const runtime of [disabled,enabled]){t.after(()=>runtime.stop());runtime.start();}for(let i=0;i<30;i++){now+=1000;disabled.tick(now);enabled.tick(now);}for(const runtime of [disabled,enabled])runtime.stop();complete(disabled.world,kind,f.r.id);assert.deepEqual(enabled.world,disabled.world);assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());assert.equal(disabled.directEatingEvidenceStatus(),null);assert.equal(receipts(events).length,1);assert.equal(thrown,failObserver?1:0);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {foreignShipmentFixture,queueForeignAction} from './helpers/food-transfer-foreign.js';
import {FOOD_TRANSFER_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {decisionContext} from '../src/server/decisions.js';
import {initializeMigration} from '../src/world/migration.js';
const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
const transfers=(events:RuntimeFoodEvent[])=>events.flatMap(e=>e.type==='food_step_committed'?(e.foodTransfers??[]).filter(r=>r.action==='foreignTrade'):[]);
function fixture(){
 const f=foreignShipmentFixture();initializeMigration(f.w);
 for(const contact of f.w.migration!.contacts){contact.phase='home';contact.futureAt=f.w.minute+10000;}
 queueForeignAction(f.w,f.r,{type:'foreignTrade',operation:'collect',shipmentId:f.s.id},true);return f;
}

for(const failure of ['sqlite','revision'] as const)test(`foreign actual ${failure} commit rejection publishes nothing; recovery and restart publish once`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});
 const model=async()=>{modelCalls++;throw Error('No model');};
 const f=fixture(),{w,r,s}=f,events:RuntimeFoodEvent[]=[];
 const store=new WorldStore(':memory:');store.commit(w,null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});t.after(()=>runtime.stop());runtime.start();
 for(let i=0;runtime.world.residents.find(p=>p.id===r.id)!.activity?.remaining!==1;i++){assert.ok(i<10);runtime.tick(now+=1000);}
 assert.deepEqual(transfers(events),[]);assert.equal(runtime.world.foreignTrade!.shipments.find(x=>x.id===s.id)!.status,'arrived');
 const db=(store as unknown as {db:DatabaseSync}).db,tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite')db.exec("CREATE TEMP TRIGGER reject_foreign BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_foreign_sql_failure'); END");
 else{const winner=store.loadForRuntime()!,revision=winner.revision;winner.revision++;store.commit(winner,revision);}
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 const original=store.commit.bind(store);let drafts=0;
 const inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{const delivery=args[0].foreignTrade!.shipments.find(x=>x.id===s.id)!;
  assert.equal(delivery.status,'completed');assert.equal(delivery.goods,0);assert.equal(args[0].residents.find(p=>p.id===r.id)!.inventory.turnip,12);drafts++;return original(...args);});
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_foreign_sql_failure/:/stale_world_revision/);assert.equal(drafts,1);inspect.mock.restore();
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);assert.deepEqual(transfers(events),[]);
 let recovered=runtime;const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_foreign');else{assert.throws(()=>runtime.stop(),/stale_world_revision/);assert.deepEqual(store.loadForRuntime(),saved);recovered=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{recoveredEvents.push(e);}}});t.after(()=>recovered.stop());recovered.start();}
 recovered.tick(now+=1000);for(let i=0;i<4;i++)recovered.tick(now+=1000);recovered.stop();
 const receipts=transfers(recoveredEvents);assert.equal(receipts.length,1);assert.equal(receipts[0].shipmentId,s.id);assert.equal(receipts[0].personId,r.id);assert.equal(receipts[0].amount.quantity,4);assert.equal(receipts[0].amount.nutrition,28);
 const audit=auditRuntimeFoodEvidence(recoveredEvents,recovered.directEatingEvidenceStatus());assert.equal(audit.foodTransfers.complete,true,audit.foodTransfers.issues.join(','));assert.deepEqual(audit.foodTransfers.totals,{units:{turnip:4},nutrition:28,completedActions:1});assert.equal(audit.foodConsumption,null);
 for(const event of recoveredEvents)if(event.type==='food_step_committed'){assert.equal(event.foodTransferCoverage,FOOD_TRANSFER_COVERAGE);assert.deepEqual(event.receipts,[]);}
 assert.equal(store.loadForRuntime()!.foreignTrade!.shipments.find(x=>x.id===s.id)!.goods,0);
 const restartedEvents:RuntimeFoodEvent[]=[],restarted=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{restartedEvents.push(e);}}});t.after(()=>restarted.stop());restarted.start();for(let i=0;i<4;i++)restarted.tick(now+=1000);restarted.stop();
 assert.deepEqual(transfers(restartedEvents),[]);assert.equal(restarted.world.residents.find(p=>p.id===r.id)!.inventory.turnip,12);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

for(const throws of [false,true])test(`foreign runtime ${throws?'throwing observer':'enabled capture'} preserves whole world, menu and durable save`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0,thrown=0;
 t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});const model=async()=>{modelCalls++;throw Error('No model');};
 const {w,r,s}=fixture(),events:RuntimeFoodEvent[]=[],stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];for(const store of stores){store.commit(structuredClone(w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'}),enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);if(throws&&e.type==='food_step_committed'&&e.foodTransfers?.length){thrown++;throw Error('Synthetic foreign observer failure');}}}});
 for(const runtime of [disabled,enabled]){t.after(()=>runtime.stop());runtime.start();}for(let i=0;i<10;i++){now+=1000;disabled.tick(now);enabled.tick(now);}for(const runtime of [disabled,enabled])runtime.stop();
 assert.equal(disabled.world.foreignTrade!.shipments.find(x=>x.id===s.id)!.status,'completed');assert.deepEqual(enabled.world,disabled.world);assert.deepEqual(stores[1].loadForRuntime(),stores[0].loadForRuntime());
 assert.deepEqual(decisionContext(disabled.world,disabled.world.residents.find(p=>p.id===r.id)!),decisionContext(enabled.world,enabled.world.residents.find(p=>p.id===r.id)!));
 assert.equal(disabled.directEatingEvidenceStatus(),null);assert.equal(transfers(events).length,1);assert.equal(thrown,throws?1:0);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
 assert.doesNotMatch(JSON.stringify(stores[1].loadForRuntime()),/"(?:foodTransfers|foodTransferCoverage|destinationContainer)"\s*:/);
});

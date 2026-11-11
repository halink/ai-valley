import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {prototypeFlowFixture,queuePrototypeFlow,prototypeReceipts,selectPrototypeAction,submitPrototypeActions} from './helpers/food-flow-prototype.js';

const credentials=[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}] as const;
const tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
type Phase='started'|'succeeded'|'failed'|'abandoned';
function receipts(events:RuntimeFoodEvent[]){return events.flatMap(e=>e.type==='food_step_committed'?e.foodFlows??[]:[]).filter(f=>f.action==='prototype_trial');}
function fixture(phase:Phase){
 const f=prototypeFlowFixture(phase==='failed'?{batchSize:3}:{}),{w,r}=f;
 w.clock.realMinutesPerDay=24;
 const plan=queuePrototypeFlow(w,r,true);
 if(phase==='abandoned'){
  for(let i=0;!w.designs!.trials?.length;i++){assert.ok(i<100);stepWorld(w,1);}
  r.canExpress=false;stepWorld(w,1);r.canExpress=true;
  submitPrototypeActions(w,r,[selectPrototypeAction(w,r,a=>a.type==='design'&&a.operation==='abandonPrototype'),selectPrototypeAction(w,r,a=>a.type==='wait',{minutes:120})]);
 }
 // Stop immediately before the actual engine transition, never fabricate a trial.
 for(let i=0;;i++){
  assert.ok(i<400,'requested trial transition must occur');
  if((phase==='started'||r.activity?.remaining===1)&&prototypeReceipts([stepWorldWithFoodEvidence(structuredClone(w),1)]).some(f=>f.phase===phase))break;
  stepWorld(w,1);
 }
 return {...f,plan};
}
function assertFrozen(value:unknown){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const v of Object.values(value))assertFrozen(v);}}

for(const phase of ['started','succeeded','failed','abandoned'] as const)for(const failure of ['sqlite','revision'] as const)test(`prototype ${phase} evidence waits for durable ${failure} commit and never replays`,t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000,modelCalls=0,fetchCalls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});
 const model=async()=>{modelCalls++;throw Error('No model');};
 const {w,r,p,d}=fixture(phase),originalTrial=structuredClone(w.designs!.trials?.[0]);
 const fish=r.inventory.fish??0,dried=r.inventory.driedFish??0;
 const events:RuntimeFoodEvent[]=[],store=new WorldStore(':memory:');
 store.commit(w,null);t.after(()=>store.close());
 const runtime=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>events.push(e)}});
 t.after(()=>runtime.stop());runtime.start();
 const db=(store as unknown as {db:DatabaseSync}).db;
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite')db.exec("CREATE TEMP TRIGGER reject_prototype BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_prototype_sql_failure'); END");
 else{const winner=store.loadForRuntime()!,revision=winner.revision;winner.revision++;store.commit(winner,revision);}
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 const original=store.commit.bind(store);let drafts=0;
 const inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  const trial=args[0].designs!.trials![0],actor=args[0].residents.find(a=>a.id===r.id)!;
  assert.equal(trial.status,phase==='started'?'working':phase);
  assert.equal(actor.inventory.fish,fish-(phase==='started'?trial.input.fish!:0));
  assert.equal(actor.inventory.driedFish??0,dried+(phase==='succeeded'?1:0));
  drafts++;return original(...args);
 });
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_prototype_sql_failure/:/stale_world_revision/);
 inspect.mock.restore();assert.equal(drafts,1);
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);
 assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);assert.deepEqual(receipts(events),[]);
 let recovered=runtime;const observed:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_prototype');
 else{runtime.stop();recovered=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>observed.push(e)}});t.after(()=>recovered.stop());recovered.start();}
 recovered.tick(now+=1000);recovered.stop();
 const flows=receipts(observed);assert.equal(flows.length,1);const flow=flows[0],trial=recovered.world.designs!.trials![0];
 assert.equal(flow.phase,phase);assert.equal(flow.trialId,trial.id);assert.equal(flow.prototypeId,p.id);assert.equal(flow.designId,d.id);
 assert.equal(flow.startedAt,trial.startedAt);assert.equal(flow.definition,trial.definition);assert.equal(flow.buildingId,trial.buildingId);
 assert.equal(flow.residentId,r.id);assert.equal(flow.container,'person:'+r.id);
 assert.equal(flow.planId,before.residents.find(a=>a.id===r.id)!.activity!.planId);
 assert.ok(recovered.world.events.some(e=>e.id===flow.eventId&&e.designId===d.id&&e.actors.includes(r.id)));
 assertFrozen(flow);
 if(phase==='started'){
  assert.deepEqual(flow.inputs.map(a=>({item:a.item,quantity:a.quantity})),[{item:'fish',quantity:2}]);assert.deepEqual(flow.outputs,[]);
 }else{
  assert.equal(flow.trialId,originalTrial!.id);assert.deepEqual(trial.sourceLots,originalTrial!.sourceLots);assert.deepEqual(flow.inputs,[]);
  assert.deepEqual(flow.outputs.map(a=>({item:a.item,quantity:a.quantity})),phase==='succeeded'?[{item:'driedFish',quantity:1}]:[]);
 }
 assert.equal(flow.failureReason,phase==='failed'?'overload':phase==='abandoned'?'abandoned':null);
 const committed=store.loadForRuntime()!;assert.deepEqual(committed.designs!.trials,recovered.world.designs!.trials);
 const restartEvents:RuntimeFoodEvent[]=[],restart=new ValleyRuntime(store,credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>restartEvents.push(e)}});
 t.after(()=>restart.stop());restart.start();for(let i=0;i<4;i++)restart.tick(now+=1000);restart.stop();
 assert.deepEqual(receipts(restartEvents),[]);assert.equal(restart.world.residents.find(a=>a.id===r.id)!.inventory.fish,fish-(phase==='started'?2:0));
 assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

for(const failObserver of [false,true])test(`prototype observer and default-disabled worlds agree (throws=${failObserver})`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000,modelCalls=0,fetchCalls=0,thrown=0;
 t.mock.method(Date,'now',()=>now);t.mock.method(globalThis,'fetch',async()=>{fetchCalls++;throw Error('No network');});
 const model=async()=>{modelCalls++;throw Error('No model');};const {w}=fixture('started');
 const events:RuntimeFoodEvent[]=[],stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];
 for(const store of stores){store.commit(structuredClone(w),null);t.after(()=>store.close());}
 const disabled=new ValleyRuntime(stores[0],credentials,model,{mode:'formal'});
 const enabled=new ValleyRuntime(stores[1],credentials,model,{mode:'formal',directEatingEvidence:{observe:e=>{
  events.push(e);if(failObserver&&e.type==='food_step_committed'&&e.foodFlows?.some(f=>f.action==='prototype_trial')){thrown++;throw Error('Synthetic observer failure');}
 }}});
 for(const runtime of [disabled,enabled]){t.after(()=>runtime.stop());runtime.start();}
 for(let i=0;i<190;i++){now+=1000;disabled.tick(now);enabled.tick(now);}
 for(const runtime of [disabled,enabled])runtime.stop();
 assert.deepEqual(enabled.world,disabled.world);assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
 assert.equal(disabled.directEatingEvidenceStatus(),null);assert.deepEqual(receipts(events).map(f=>f.phase),failObserver?['started']:['started','succeeded']);
 assert.equal(enabled.world.designs!.trials![0].status,'succeeded');
 assert.equal(thrown,failObserver?1:0);assert.equal(modelCalls,0);assert.equal(fetchCalls,0);
});

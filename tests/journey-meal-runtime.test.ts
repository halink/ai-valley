import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {journeyMealFixture,chooseJourneyMeal,journeyPerson} from './helpers/journey-meal-evidence.js';

for(const mail of [false,true])for(const failure of ['sqlite','competing-revision'] as const)test(`journey runtime ${mail?'mail':'ordinary'}: actual ${failure} rejection rolls back and recovery publishes once`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('Offline network prohibited');});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=journeyMealFixture(mail);f.w.clock.realMinutesPerDay=24;chooseJourneyMeal(f.w,f.r,mail);stepWorld(f.w,4);
 for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+1000;}
 f.r.lastDecisionAt=f.w.minute;f.r.decisionDue=f.w.minute+1000;
 for(const merchant of f.w.foreignTrade?.merchants??[])merchant.person.decisionDue=f.w.minute+1000;
 for(const contact of f.w.migration?.contacts??[])contact.futureAt=f.w.minute+1000;
 const stock=f.r.inventory.meal!,store=new WorldStore(':memory:');store.commit(f.w,null);const runtimes:ValleyRuntime[]=[];t.after(()=>{try{for(const runtime of [...runtimes].reverse())runtime.stop();}finally{store.close();}});
 // Restart can schedule the now-waiting traveler; this injected stub never calls a model or network.
 const model=async()=>{throw new Error('Offline injected decision stub');};
 const makeRuntime=(events:RuntimeFoodEvent[])=>new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],model,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 const events:RuntimeFoodEvent[]=[],runtime=makeRuntime(events);runtimes.push(runtime);runtime.start();
 const db=(store as unknown as {db:DatabaseSync}).db;
 const tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite')db.exec("CREATE TEMP TRIGGER reject_journey BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_journey_sql_failure'); END");
 else{const winner=store.loadForRuntime()!,revision=winner.revision;assert.equal(revision,runtime.world.revision);winner.revision++;store.commit(winner,revision);}
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 let drafts=0;const original=store.commit.bind(store),inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{
  assert.equal(journeyPerson(args[0],f.r.id).inventory.meal,stock-1);
  const journey=mail?args[0].outsideAid!.visitorJourneys![0]:args[0].migration!.contacts.find(c=>c.id===f.r.id)!.journey!.staged!;
  assert.equal(journey.pause,undefined);drafts++;return original(...args);
 });
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_journey_sql_failure/:/stale_world_revision/);assert.equal(drafts,1);inspect.mock.restore();
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);
 const receipts=(events:RuntimeFoodEvent[])=>events.flatMap(e=>e.type==='food_step_committed'?e.journeyMeals??[]:[]);
 assert.deepEqual(receipts(events),[]);assert.equal(journeyPerson(store.loadForRuntime()!,f.r.id).inventory.meal,stock);
 let recovered=runtime;const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_journey');else{runtime.stop();recovered=makeRuntime(recoveredEvents);runtimes.push(recovered);recovered.start();}
 recovered.tick(now+=1000);recovered.stop();
 const rows=receipts(recoveredEvents);assert.equal(rows.length,1);assert.equal(rows[0].providerId,f.r.id);assert.equal(rows[0].journeyId,f.j.id);assert.equal(journeyPerson(store.loadForRuntime()!,f.r.id).inventory.meal,stock-1);
 const restartedEvents:RuntimeFoodEvent[]=[],restarted=makeRuntime(restartedEvents);runtimes.push(restarted);restarted.start();restarted.tick(now+=1000);restarted.stop();
 assert.deepEqual(receipts(restartedEvents),[]);assert.equal(journeyPerson(store.loadForRuntime()!,f.r.id).inventory.meal,stock-1);assert.equal(network,0);
});

test('journey runtime: actual completion copied deeply frozen independently of observation source',()=>{
 const f=journeyMealFixture();chooseJourneyMeal(f.w,f.r,false);const observation=stepWorldWithFoodEvidence(f.w,5),events:RuntimeFoodEvent[]=[];
 const food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(f.w.id,observation.fromMinute);food.committed(observation,f.w.revision);
 const event=events[1];assert.equal(event.type,'food_step_committed');if(event.type!=='food_step_committed')return;
 assert.equal(event.journeyMeals!.length,1);assert.ok(Object.isFrozen(event.journeyMeals));assert.ok(Object.isFrozen(event.journeyMeals![0].inputs[0].lots![0]));
 observation.journeyMeals![0].inputs[0].quantity=99;assert.equal(event.journeyMeals![0].inputs[0].quantity,1);
});

for(const asynchronous of [false,true])test(`journey runtime: ${asynchronous?'async':'throwing'} observer cannot reverse physical committed food debit`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=journeyMealFixture(true);chooseJourneyMeal(f.w,f.r,true);stepWorld(f.w,4);const stock=f.r.inventory.meal!;
 for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+1000;}
 const store=new WorldStore(':memory:');store.commit(f.w,null);const runtimes:ValleyRuntime[]=[];t.after(()=>{try{for(const runtime of [...runtimes].reverse())runtime.stop();}finally{store.close();}});let observations=0;
 const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_DUMMY'}],async()=>{throw new Error('Offline injected stub');},{mode:'formal',directEatingEvidence:{observe:e=>{
  if(e.type==='food_step_committed'&&e.journeyMeals?.length){observations++;if(asynchronous)return Promise.reject(new Error('Offline observer'));throw new Error('Offline observer');}
 }}});runtimes.push(runtime);runtime.start();for(let i=0;i<20&&!observations;i++)runtime.tick(now+=1000);
 assert.equal(observations,1);assert.equal(runtime.directEatingEvidenceStatus()!.failure,asynchronous?'async_observer':'observer_threw');
 assert.equal(journeyPerson(runtime.world,f.r.id).inventory.meal,stock-1);assert.equal(journeyPerson(store.loadForRuntime()!,f.r.id).inventory.meal,stock-1);
});

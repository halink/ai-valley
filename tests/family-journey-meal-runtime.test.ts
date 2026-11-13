import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {World} from '../src/shared/types.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {familyJourneyMealFixture,acceptFamilyJourney,chooseFamilyJourney,finishFamilyJourneyChoice,originalFamilyJourneyLots} from './helpers/family-journey-meal-evidence.js';

type Trigger='depart'|'resume'|'travel';
const receipts=(events:RuntimeFoodEvent[])=>events.flatMap(e=>e.type==='food_step_committed'?e.familyJourneyMeals??[]:[]);
const person=(w:World,id:string)=>w.residents.find(p=>p.id===id)!;
function prepared(trigger:Trigger){
 const f=familyJourneyMealFixture(true,trigger!=='depart'),c=acceptFamilyJourney(f);originalFamilyJourneyLots(f);
 chooseFamilyJourney(f.w,f.parent,'depart');
 if(trigger!=='depart'){
  assert.equal(finishFamilyJourneyChoice(f.w,f.parent).length,c.members.length);
  if(trigger==='resume'){
   stepWorld(f.w,70);
   const next=c.journey!.path[0],index=next.y*f.w.map.width+next.x;
   f.w.map.tiles[index]='cliff';stepWorld(f.w,.2);assert.equal(c.status,'paused');f.w.map.tiles[index]='grass';
   stepWorld(f.w,Math.max(0,c.journey!.lastRationAt+120-f.w.minute));chooseFamilyJourney(f.w,f.parent,'resume');
  }else stepWorld(f.w,Math.max(0,c.journey!.lastRationAt+119-f.w.minute));
 }
 if(trigger!=='travel'){stepWorld(f.w,.2);assert.ok(f.parent.activity);assert.ok(f.parent.activity.remaining<=1);}
 f.w.clock.realMinutesPerDay=24;
 for(const r of f.w.residents){r.lastDecisionAt=f.w.minute;r.decisionDue=f.w.minute+1000;}
 for(const merchant of f.w.foreignTrade?.merchants??[])merchant.person.decisionDue=f.w.minute+1000;
 for(const contact of f.w.migration?.contacts??[]){contact.phase='home';contact.futureAt=f.w.minute+1000;}
 return {...f,c};
}
const offlineModel=async()=>{throw new Error('Offline injected decision stub');};
const credentials=[{model:QWEN_MODEL as typeof QWEN_MODEL,key:'OFFLINE_DUMMY'}];

for(const trigger of ['depart','resume','travel'] as const)for(const failure of ['sqlite','competing-revision'] as const)test(`family journey runtime ${trigger}: actual ${failure} rollback, retry publishes all members once, reload never replays`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('Offline network prohibited');});
 let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);
 const f=prepared(trigger),stock=new Map(f.c.members.map(m=>[m.providerId,{...person(f.w,m.providerId).inventory}]));
 const rationNumber=(f.c.journey?.rationsUsed??0)+1,counts=new Map<string,number>();for(const m of f.c.members)counts.set(m.providerId,(counts.get(m.providerId)??0)+1);
 const assertDebit=(w:World)=>{for(const [id,count] of counts){assert.equal(person(w,id).inventory.meal,stock.get(id)!.meal!-count);assert.equal(person(w,id).inventory.water,stock.get(id)!.water!-count);}assert.equal(w.familyRelocation!.agreements.find(c=>c.id===f.c.id)!.journey!.rationsUsed,rationNumber);};
 const store=new WorldStore(':memory:');store.commit(f.w,null);const runtimes:ValleyRuntime[]=[];t.after(()=>{try{for(const runtime of [...runtimes].reverse())runtime.stop();}finally{store.close();}});
 const makeRuntime=(events:RuntimeFoodEvent[])=>new ValleyRuntime(store,credentials,offlineModel,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}});
 const events:RuntimeFoodEvent[]=[],runtime=makeRuntime(events);runtimes.push(runtime);runtime.start();
 const db=(store as unknown as {db:DatabaseSync}).db,tables=['worlds','terrain','resource_bases','events','receipts','event_people','event_animals','archive_meta'];
 const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
 if(failure==='sqlite')db.exec("CREATE TEMP TRIGGER reject_family_ration BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT, 'synthetic_family_sql_failure'); END");
 else{const winner=store.loadForRuntime()!,revision=winner.revision;assert.equal(revision,runtime.world.revision);winner.revision++;store.commit(winner,revision);}
 const before=structuredClone(runtime.world),saved=store.loadForRuntime(),sqlBefore=snapshot(),status=runtime.directEatingEvidenceStatus(),count=events.length;
 let drafts=0;const original=store.commit.bind(store),inspect=t.mock.method(store,'commit',(...args:Parameters<typeof store.commit>)=>{assertDebit(args[0]);drafts++;return original(...args);});
 assert.throws(()=>runtime.tick(now+=1000),failure==='sqlite'?/synthetic_family_sql_failure/:/stale_world_revision/);assert.equal(drafts,1);inspect.mock.restore();
 assert.deepEqual(runtime.world,before);assert.deepEqual(store.loadForRuntime(),saved);assert.deepEqual(snapshot(),sqlBefore);assert.deepEqual(runtime.directEatingEvidenceStatus(),status);assert.equal(events.length,count);assert.deepEqual(receipts(events),[]);
 let recovered=runtime;const recoveredEvents:RuntimeFoodEvent[]=failure==='sqlite'?events:[];
 if(failure==='sqlite')db.exec('DROP TRIGGER reject_family_ration');else{runtime.stop();recovered=makeRuntime(recoveredEvents);runtimes.push(recovered);recovered.start();}
 recovered.tick(now+=1000);recovered.stop();assertDebit(recovered.world);assertDebit(store.loadForRuntime()!);
 const rows=receipts(recoveredEvents);assert.equal(rows.length,f.c.members.length);
 assert.deepEqual(rows.map(r=>[r.relocationId,r.trigger,r.rationNumber,r.memberIndex,r.memberCount,r.providerId,r.beneficiaryId]),f.c.members.map((m,i)=>[f.c.id,trigger,rationNumber,i,f.c.members.length,m.providerId,m.personId]));
 assert.equal(new Set(rows.map(r=>r.beneficiaryId)).size,f.c.members.length);
 const restartedEvents:RuntimeFoodEvent[]=[],restarted=makeRuntime(restartedEvents);runtimes.push(restarted);restarted.start();restarted.tick(now+=1000);restarted.stop();
 assert.deepEqual(receipts(restartedEvents),[]);assertDebit(store.loadForRuntime()!);assert.equal(network,0);
});

test('family journey runtime: published actual member receipts are independent deeply frozen clones',()=>{
 const f=prepared('depart'),observation=stepWorldWithFoodEvidence(f.w,1),events:RuntimeFoodEvent[]=[];
 assert.equal(observation.familyJourneyMeals!.length,f.c.members.length);
 const food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(f.w.id,observation.fromMinute);food.committed(observation,f.w.revision);
 const event=events[1];assert.equal(event.type,'food_step_committed');if(event.type!=='food_step_committed')return;
 function frozen(value:unknown){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}}
 assert.equal(event.familyJourneyMeals!.length,f.c.members.length);assert.notEqual(event.familyJourneyMeals,observation.familyJourneyMeals);
 frozen(event.familyJourneyMeals);const saved=structuredClone(event.familyJourneyMeals);
 observation.familyJourneyMeals![0].inputs[0].quantity=99;observation.familyJourneyMeals![0].inputs[0].lots![0].nutrition=99;observation.familyJourneyMeals!.pop();
 assert.deepEqual(event.familyJourneyMeals,saved);
});

for(const asynchronous of [false,true])test(`family journey runtime: ${asynchronous?'async':'throwing'} observer cannot reverse committed group debit`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('Offline network prohibited');});
 const f=prepared('depart'),store=new WorldStore(':memory:');store.commit(f.w,null);const runtimes:ValleyRuntime[]=[];t.after(()=>{try{for(const runtime of [...runtimes].reverse())runtime.stop();}finally{store.close();}});let observations=0;
 const runtime=new ValleyRuntime(store,credentials,offlineModel,{mode:'formal',directEatingEvidence:{observe:e=>{
  if(e.type==='food_step_committed'&&e.familyJourneyMeals?.length){observations++;assert.equal(e.familyJourneyMeals.length,f.c.members.length);if(asynchronous)return Promise.reject(new Error('Offline observer'));throw new Error('Offline observer');}
 }}});runtimes.push(runtime);runtime.start();runtime.tick(now+=1000);
 assert.equal(observations,1);assert.equal(runtime.directEatingEvidenceStatus()!.failure,asynchronous?'async_observer':'observer_threw');
 for(const id of new Set(f.c.members.map(m=>m.providerId))){const count=f.c.members.filter(m=>m.providerId===id).length;for(const item of ['meal','water'] as const){assert.equal(person(runtime.world,id).inventory[item],person(f.w,id).inventory[item]!-count);assert.equal(person(store.loadForRuntime()!,id).inventory[item],person(f.w,id).inventory[item]!-count);}}
 runtime.tick(now+=1000);assert.equal(observations,1);assert.equal(store.loadForRuntime()!.familyRelocation!.agreements[0].journey!.rationsUsed,1);assert.equal(network,0);
});

for(const trigger of ['depart','resume','travel'] as const)test(`family journey runtime ${trigger}: enabled and disabled evidence preserve world, menus and durable save`,t=>{
 t.mock.timers.enable({apis:['setInterval']});let now=1_700_000_000_000;t.mock.method(Date,'now',()=>now);let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('Offline network prohibited');});
 const f=prepared(trigger),events:RuntimeFoodEvent[]=[],stores=[new WorldStore(':memory:'),new WorldStore(':memory:')];for(const store of stores)store.commit(structuredClone(f.w),null);
 const runtimes:ValleyRuntime[]=[];t.after(()=>{try{for(const runtime of [...runtimes].reverse())runtime.stop();}finally{for(const store of stores)store.close();}});
 const enabled=new ValleyRuntime(stores[0],credentials,offlineModel,{mode:'formal',directEatingEvidence:{observe:e=>{events.push(e);}}}),disabled=new ValleyRuntime(stores[1],credentials,offlineModel,{mode:'formal'});
 for(const runtime of [enabled,disabled]){runtimes.push(runtime);runtime.start();}now+=1000;enabled.tick(now);disabled.tick(now);
 assert.equal(receipts(events).length,f.c.members.length);assert.equal(disabled.directEatingEvidenceStatus(),null);assert.deepEqual(enabled.world,disabled.world);assert.deepEqual(stores[0].loadForRuntime(),stores[1].loadForRuntime());
 assert.deepEqual(enabled.world.residents.map(r=>decisionChoices(decisionContext(enabled.world,r))),disabled.world.residents.map(r=>decisionChoices(decisionContext(disabled.world,r))));assert.equal(network,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {foodValue,foodTransaction} from '../src/world/food.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {WorldStore} from '../src/server/store.js';
import {decisionContext} from '../src/server/decisions.js';
import type {Action,World} from '../src/shared/types.js';
import {DAY} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 for(const r of w.residents){r.inventory={meal:2};r.hunger=60;r.health=r.energy=100;}
 stepWorld(w,1);return w;
}
function queue(w:World,actions:Action[],index=0){
 const r=w.residents[index],id=`food-proof:${r.id}:${w.minute}:${r.revision}`;
 assert.deepEqual(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离进食证据测试',actions}),{ok:true});
 return id;
}

test('real completed eating records exact units, original lot nutrition and separate hunger relief',()=>{
 const w=fixture(),r=w.residents[0],container='person:'+r.id;
 w.definitions['food/life@90']={...w.definitions['food/life@1'],version:90,data:{...w.definitions['food/life@1'].data,nutrition:{meal:22}}};
 w.definitions['food/life@91']={...w.definitions['food/life@1'],version:91,data:{...w.definitions['food/life@1'].data,nutrition:{meal:44}}};
 w.food!.lots[container].meal=[{quantity:.25,producedAt:w.minute-20,expiresAt:w.minute+100,definition:'food/life@90'},
  {quantity:1.75,producedAt:w.minute-10,expiresAt:w.minute+200,definition:'food/life@91'}];
 r.hunger=2;const expected=foodValue(w,container,'meal'),planId=queue(w,[{type:'eat',item:'meal'}]);
 assert.equal(stepWorldWithFoodEvidence(w,4).receipts.length,0);
 const observation=stepWorldWithFoodEvidence(w,1),receipt=observation.receipts[0];
 assert.equal(observation.receipts.length,1);assert.equal(r.inventory.meal,1);
 assert.equal(receipt.nutrition,expected);assert.equal(expected,38.5);
 assert.ok(receipt.hungerRelief>2&&receipt.hungerRelief<3);assert.ok(receipt.hungerRelief<receipt.nutrition);
 assert.deepEqual({id:receipt.residentId,item:receipt.item,quantity:receipt.quantity,container:receipt.container,planId:receipt.planId},
  {id:r.id,item:'meal',quantity:1,container,planId});
 assert.equal(receipt.at,w.minute);assert.ok(w.events.some(e=>e.id===receipt.eventId&&e.actors.includes(r.id)&&e.at===receipt.at));
 assert.equal(stepWorldWithFoodEvidence(w,1).receipts.length,0);
});

test('expiry before completion is failed eating, while transfer and spoilage are not consumption',()=>{
 const w=fixture(),[r,other]=w.residents;queue(w,[{type:'eat',item:'meal'}]);
 w.food!.lots['person:'+r.id].meal![0].expiresAt=w.minute+5;
 const observation=stepWorldWithFoodEvidence(w,5);
 assert.deepEqual(observation.receipts,[]);assert.equal(r.inventory.meal,0);assert.ok(r.lastFailure);
 assert.equal(w.food!.spoiled.meal,2);
 const moved=captureDirectEating(w,()=>foodTransaction(w,()=>{other.inventory.meal!--;r.inventory.meal=1;}));
 assert.deepEqual(moved.receipts,[]);assert.equal(r.inventory.meal,1);
});

test('formal nine-person world, resident context and saved data are identical with observation enabled',()=>{
 const observed=createFrontierWorld();observed.clock.paused=false;
 assert.equal(observed.residents.length,9);queue(observed,[{type:'eat',item:'meal'}]);
 const plain=structuredClone(observed),evidence=stepWorldWithFoodEvidence(observed,5);stepWorld(plain,5);
 assert.equal(evidence.receipts.length,1);assert.deepEqual(observed,plain);
 assert.deepEqual(decisionContext(observed,observed.residents[0]),decisionContext(plain,plain.residents[0]));
 assert.equal(JSON.stringify(observed),JSON.stringify(plain));
});

test('forecast eating on a disposable world never appears in actual-world observation',()=>{
 const w=fixture(),r=w.residents[0];r.hunger=98;r.energy=19;
 // Low energy deliberately bypasses the inventory-only shortcut, so the
 // authoritative forecast really advances a copied world and completes eat.
 const before=structuredClone(w);
 const observation=captureDirectEating(w,()=>assert.equal(hasTimelySelfRescue(w,r,[{type:'eat',item:'meal'}]),true));
 assert.deepEqual(observation.receipts,[]);assert.deepEqual(w,before);
});

test('real storage reload continues an in-progress meal without replay or save-schema changes',()=>{
 const store=new WorldStore(':memory:');let w=fixture();const id=w.residents[0].id;
 queue(w,[{type:'eat',item:'meal'},{type:'eat',item:'meal'}]);const observer=createIsolationEvidence(w);
 try{
  for(let i=0;i<7;i++)observer.sample(w,stepWorldWithFoodEvidence(w,1));
  assert.equal(observer.finish(w)!.directEating.totals!.completedActions,1);
  store.commit(w,null);const minute=w.minute;w=store.load()!;
  assert.equal(w.minute,minute);assert.equal(w.residents.find(r=>r.id===id)!.activity!.remaining,3);
  for(let i=0;i<3;i++)observer.sample(w,stepWorldWithFoodEvidence(w,1));
  const report=observer.finish(w)!;
  assert.equal(report.directEating.observedMinutes,10);assert.equal(report.directEating.unobservedMinutes,0);
  assert.deepEqual(report.directEating.totals!.units,{meal:2});assert.equal(report.directEating.totals!.completedActions,2);
  assert.equal(new Set(report.directEating.receipts.map(r=>r.eventId)).size,2);
  assert.equal(w.residents.find(r=>r.id===id)!.inventory.meal,0);
  const restarted=createIsolationEvidence(w);restarted.sample(w,stepWorldWithFoodEvidence(w,1));
  assert.equal(restarted.finish(w)!.directEating.totals!.completedActions,0);
  assert.equal(report.foodConsumption.value,null);assert.equal(report.foodProduction.value,null);
 }finally{store.close();}
});

test('midnight belongs to the closing bucket and next-day coverage starts empty',()=>{
 const w=fixture();w.minute=DAY-5;queue(w,[{type:'eat',item:'meal'}]);const observer=createIsolationEvidence(w);
 let closed:ReturnType<typeof observer.sample>=null;
 for(let i=0;i<5;i++)closed=observer.sample(w,stepWorldWithFoodEvidence(w,1));
 assert.equal(closed!.toMinute,DAY);assert.equal(closed!.directEating.totals!.completedActions,1);
 assert.equal(closed!.directEating.receipts[0].at,DAY);assert.equal(observer.finish(w),null);
 observer.sample(w,stepWorldWithFoodEvidence(w,1));const next=observer.finish(w)!;
 assert.equal(next.calendarDay,1);assert.equal(next.directEating.observedMinutes,1);
 assert.deepEqual(next.directEating.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
});

test('missing instrumentation stays unknown, including mixed observed and unobserved minutes',()=>{
 const w=fixture();queue(w,[{type:'eat',item:'meal'}]);const observer=createIsolationEvidence(w);
 stepWorld(w,1);observer.sample(w);
 for(let i=0;i<4;i++)observer.sample(w,stepWorldWithFoodEvidence(w,1));
 const row=observer.finish(w)!;
 assert.equal(row.directEating.observedMinutes,4);assert.equal(row.directEating.unobservedMinutes,1);
 assert.equal(row.directEating.totals,null);assert.equal(row.directEating.receipts.length,1);
 assert.equal(row.directEating.receipts[0].quantity,1);assert.equal(row.foodConsumption.value,null);
});

test('a later coverage gap clears earlier totals and later observed minutes cannot restore certainty',()=>{
 const w=fixture();queue(w,[{type:'eat',item:'meal'}]);const observer=createIsolationEvidence(w);
 for(let i=0;i<5;i++)observer.sample(w,stepWorldWithFoodEvidence(w,1));
 assert.equal(observer.finish(w)!.directEating.totals!.completedActions,1);
 stepWorld(w,1);observer.sample(w);assert.equal(observer.finish(w)!.directEating.totals,null);
 observer.sample(w,stepWorldWithFoodEvidence(w,1));const row=observer.finish(w)!;
 assert.equal(row.directEating.totals,null);assert.equal(row.directEating.receipts.length,1);
 assert.equal(row.directEating.observedMinutes,6);assert.equal(row.directEating.unobservedMinutes,1);
});

test('simultaneous different foods retain individual attribution and separate item quantities',()=>{
 const w=fixture();w.residents[1].inventory={berry:1};
 queue(w,[{type:'eat',item:'meal'}]);queue(w,[{type:'eat',item:'berry'}],1);
 const observer=createIsolationEvidence(w);
 for(let i=0;i<5;i++)observer.sample(w,stepWorldWithFoodEvidence(w,1));
 const row=observer.finish(w)!;
 assert.deepEqual(row.directEating.totals!.units,{meal:1,berry:1});assert.equal(row.directEating.totals!.completedActions,2);
 assert.deepEqual(row.directEating.receipts.map(r=>[r.residentId,r.item,r.at]),
  [[w.residents[0].id,'meal',w.minute],[w.residents[1].id,'berry',w.minute]]);
 assert.equal(new Set(row.directEating.receipts.map(r=>r.eventId)).size,2);
});

test('sample matching, duplicate handling and detached evidence protect exact coverage',()=>{
 const w=fixture();queue(w,[{type:'eat',item:'meal'}]);const observer=createIsolationEvidence(w);
 for(let i=0;i<4;i++)observer.sample(w,stepWorldWithFoodEvidence(w,1));
 const observation=stepWorldWithFoodEvidence(w,1);
 assert.throws(()=>observer.sample(w,{...observation,worldId:'another-world'}),/does not cover/);
 assert.throws(()=>observer.sample(w,{...observation,fromMinute:observation.fromMinute-1}),/does not cover/);
 observer.sample(w,observation);assert.equal(observer.sample(w,observation),null);
 observation.receipts[0].quantity=999;const report=observer.finish(w)!;
 assert.equal(report.directEating.totals!.completedActions,1);assert.equal(report.directEating.receipts[0].quantity,1);
 report.directEating.receipts[0].nutrition=999;
 assert.notEqual(observer.finish(w)!.directEating.receipts[0].nutrition,999);
});

test('fractional engine observations retain exact times but cannot claim a complete isolation minute',()=>{
 const w=fixture();queue(w,[{type:'eat',item:'meal'}]);const observer=createIsolationEvidence(w);
 const observation=stepWorldWithFoodEvidence(w,4.5);assert.deepEqual(observation.receipts,[]);
 assert.equal(observation.toMinute-observation.fromMinute,4.5);
 assert.throws(()=>observer.sample(w,observation),/consecutive/);
 const end=stepWorldWithFoodEvidence(w,.5);assert.equal(end.receipts.length,1);assert.equal(end.receipts[0].at,w.minute);
});

test('paused steps and failed capture cannot leave instrumentation attached or return success',()=>{
 const w=fixture();w.clock.paused=true;const before=structuredClone(w),paused=stepWorldWithFoodEvidence(w,5);
 assert.equal(paused.fromMinute,paused.toMinute);assert.deepEqual(paused.receipts,[]);assert.deepEqual(w,before);
 w.clock.paused=false;
 assert.throws(()=>captureDirectEating(w,()=>{throw new Error('test-step-failed');}),/test-step-failed/);
 assert.throws(()=>captureDirectEating(w,()=>{stepWorldWithFoodEvidence(w,1);}),/cannot be nested/);
 queue(w,[{type:'eat',item:'meal'}]);assert.equal(stepWorldWithFoodEvidence(w,5).receipts.length,1);
});

test('a failed capture after physical eating returns no success and never replays that receipt',()=>{
 const w=fixture();queue(w,[{type:'eat',item:'meal'}]);
 assert.throws(()=>captureDirectEating(w,()=>{stepWorld(w,5);throw new Error('test-after-eating');}),/test-after-eating/);
 // Capture is not a simulation transaction: actual food was consumed, but the
 // failed observation must remain unknown rather than leak into a later step.
 assert.equal(w.residents[0].inventory.meal,1);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).receipts,[]);
});

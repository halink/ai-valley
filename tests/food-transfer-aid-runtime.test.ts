import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {FOOD_TRANSFER_COVERAGE,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function observation():DirectEatingObservation{return {worldId:'world',fromMinute:480,toMinute:510,receipts:[],foodTransferCoverage:FOOD_TRANSFER_COVERAGE,foodTransfers:[{type:'transfer',action:'outsideAid',operation:'collect',at:500,eventId:'event',deliveryId:'delivery',noticeId:'notice',merchantId:'merchant',recipientId:'recipient',container:'aid:delivery',destinationContainer:'person:recipient',amount:{item:'meal',quantity:1,nutrition:20,lots:[{quantity:1,nutrition:20,definition:'food@1',producedAt:480,expiresAt:1500}]}}]};}
test('transfer runtime copies and deeply freezes source observations',()=>{
 const o=observation(),events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(o.worldId,o.fromMinute);food.committed(o,1);
 const event=events[1];assert.equal(event.type,'food_step_committed');if(event.type!=='food_step_committed')return;
 for(const value of [event,event.foodTransfers,event.foodTransfers![0],event.foodTransfers![0].amount,event.foodTransfers![0].amount.lots,event.foodTransfers![0].amount.lots![0]])assert.ok(Object.isFrozen(value));
 o.foodTransfers![0].amount.lots![0].quantity=99;assert.equal(event.foodTransfers![0].amount.lots![0].quantity,1);assert.equal(event.foodTransferCoverage,FOOD_TRANSFER_COVERAGE);
});
for(const asynchronous of [false,true])test(`transfer runtime ${asynchronous?'async':'throwing'} observer stops evidence without mutating source`,()=>{
 const o=observation(),before=structuredClone(o);let calls=0;const food=new RuntimeFoodEvidence({observe:e=>{if(e.type==='food_step_committed'){calls++;if(asynchronous)return Promise.reject(new Error('observer'));throw new Error('observer');}}});
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.committed(o,2);assert.equal(calls,1);assert.equal(food.status().failure,asynchronous?'async_observer':'observer_threw');assert.deepEqual(o,before);
});
test('transfer runtime rejects top-level getters and unknown coverage before publishing',()=>{
 for(const target of ['foodTransfers','foodTransferCoverage','nested'] as const){const o=observation();let reads=0,calls=0;
 if(target==='nested')Object.defineProperty(o.foodTransfers![0].amount,'nutrition',{get(){reads++;return 20;}});
 else Object.defineProperty(o,target,{get(){reads++;return [];}});
 const food=new RuntimeFoodEvidence({observe:e=>{if(e.type==='food_step_committed')calls++;}});food.start(o.worldId,o.fromMinute);food.committed(o,1);
 assert.equal(reads,0);assert.equal(calls,0);assert.equal(food.status().phase,'failed');assert.equal(food.status().throughMinute,480);
 }
});

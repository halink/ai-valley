import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {FOOD_OWNERSHIP_COVERAGE,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function observation():DirectEatingObservation{return {worldId:'world',fromMinute:480,toMinute:510,receipts:[],foodOwnershipCoverage:FOOD_OWNERSHIP_COVERAGE,
 foodOwnershipChanges:[{type:'ownership_change',action:'production',operation:'inherit',at:500,eventId:'event',planId:'plan',estatePersonId:'parent',shareId:'0',heirId:'heir',
  stocks:[{containerType:'estate-stock',container:'estate:parent:heir:0',fromOwnerId:'parent',toOwnerId:'heir',ambiguous:false,amounts:[{item:'meal',quantity:1.5,nutrition:null,lots:null}]}]}]};}

test('ownership runtime publishes detached deeply frozen observations without freezing their source',()=>{
 const o=observation(),events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:event=>{events.push(event);}});
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);
 const event=events[1];assert.equal(event.type,'food_step_committed');if(event.type!=='food_step_committed')return;
 const receipt=event.foodOwnershipChanges![0],stock=receipt.stocks[0];
 for(const value of [event,event.foodOwnershipChanges,receipt,receipt.stocks,stock,stock.amounts,stock.amounts[0]])assert.ok(Object.isFrozen(value));
 assert.equal(event.foodOwnershipCoverage,FOOD_OWNERSHIP_COVERAGE);assert.equal(event.receipts.length,0);assert.equal(event.foodTransfers,undefined);assert.equal(event.foodFlows,undefined);
 o.foodOwnershipChanges![0].stocks[0].amounts[0].quantity=99;o.foodOwnershipChanges![0].stocks.push({...o.foodOwnershipChanges![0].stocks[0],container:'estate:other'});
 assert.equal(stock.amounts[0].quantity,1.5);assert.equal(receipt.stocks.length,1);assert.equal(food.status().phase,'stopped');
});

for(const asynchronous of [false,true])test(`ownership ${asynchronous?'async':'throwing'} observer cannot mutate observation or publish again`,()=>{
 const o=observation(),before=structuredClone(o);let calls=0;
 const food=new RuntimeFoodEvidence({observe:event=>{if(event.type==='food_step_committed'){calls++;if(asynchronous)return Promise.reject(Error('Observer failure'));throw Error('Observer failure');}}});
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.committed(o,2);
 assert.equal(calls,1);assert.equal(food.status().failure,asynchronous?'async_observer':'observer_threw');assert.deepEqual(o,before);
});

test('ownership runtime checks optional descriptors and rejects nested accessors before publishing',()=>{
 for(const target of ['foodOwnershipChanges','foodOwnershipCoverage','stock','amount','array'] as const){
  const o=observation();let calls=0,reads=0;
  const value=target==='stock'?o.foodOwnershipChanges![0].stocks[0]:target==='amount'?o.foodOwnershipChanges![0].stocks[0].amounts[0]:target==='array'?o.foodOwnershipChanges:o;
  const key=target==='stock'?'fromOwnerId':target==='amount'?'quantity':target==='array'?'0':target;
  Object.defineProperty(value,key,{get(){reads++;throw Error('Must not execute');}});
  const food=new RuntimeFoodEvidence({observe:event=>{if(event.type==='food_step_committed')calls++;}});
  food.start(o.worldId,o.fromMinute);food.committed(o,1);assert.equal(reads,0);assert.equal(calls,0);
  assert.equal(food.status().phase,'failed');assert.equal(food.status().throughMinute,480);assert.equal(food.status().lastSequence,1);
 }
});

test('ownership runtime rejects malformed coverage, dates and duplicate transaction batches atomically',()=>{
 for(const change of [
  (o:any)=>o.foodOwnershipCoverage='all', (o:any)=>delete o.foodOwnershipChanges, (o:any)=>o.foodOwnershipChanges=null,
  (o:any)=>o.foodOwnershipChanges[0].at=480,
  (o:any)=>o.foodOwnershipChanges.push({...o.foodOwnershipChanges[0],shareId:'1'}),
  (o:any)=>o.foodOwnershipChanges.push({...o.foodOwnershipChanges[0],eventId:'other'}),
  (o:any)=>o.foodOwnershipChanges[0].stocks[0].amounts[0].nutrition=42,
 ]){
  const o=observation();change(o);let calls=0;
  const food=new RuntimeFoodEvidence({observe:event=>{if(event.type==='food_step_committed')calls++;}});
  food.start(o.worldId,o.fromMinute);food.committed(o,1);assert.equal(calls,0);assert.equal(food.status().phase,'failed');assert.equal(food.status().throughMinute,480);
 }
});

test('ownership runtime preserves legacy omission rather than adding coverage or fake empty receipts',()=>{
 const o=observation();delete o.foodOwnershipChanges;delete o.foodOwnershipCoverage;
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:event=>{events.push(event);}});
 food.start(o.worldId,o.fromMinute);food.committed(o,1);assert.equal(food.status().phase,'observing');
 assert.equal(Object.hasOwn(events[1],'foodOwnershipChanges'),false);assert.equal(Object.hasOwn(events[1],'foodOwnershipCoverage'),false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {FOOD_TRANSFER_COVERAGE,type DirectEatingObservation,type OutsideAidFoodTransferReceipt as FoodTransferReceipt} from '../src/world/food-consumption-evidence.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
function setup(){
 const w=createWorld(414);w.minute=10;
 const ids=Array.from({length:9},(_,i)=>'fixed-'+i);
 const c=createNineFoodEvidence(w.id,w.minute);
 const receipt=(recipientId=ids[0],id='one'):FoodTransferReceipt=>({type:'transfer',action:'outsideAid',operation:'collect',at:w.minute,eventId:'event-'+id,deliveryId:'delivery-'+id,noticeId:'notice-one',merchantId:ids[1],recipientId,container:'aid:delivery-'+id,destinationContainer:'person:'+recipientId,
  amount:{item:'meal',quantity:2,nutrition:30,lots:[{quantity:2,nutrition:30,producedAt:0,expiresAt:1000,definition:'food/life@1'}]}});
 const tick=()=>{const before=snapshotNineFood(w,ids);w.minute++;return {before,after:snapshotNineFood(w,ids)};};
 const observation=(rs:FoodTransferReceipt[]=[]):DirectEatingObservation=>({worldId:w.id,fromMinute:w.minute-1,toMinute:w.minute,receipts:[],foodTransfers:rs,foodTransferCoverage:FOOD_TRANSFER_COVERAGE});
 return {w,ids,c,receipt,tick,observation};
}
for(const recipient of ['nine','external','commons'])test('nine aid: '+recipient+' destination uses exact identity, not public assets or merchant ownership',()=>{
 const f=setup(),t=f.tick(),r=f.receipt(recipient==='nine'?f.ids[0]:recipient);
 // Even a misleading inside aid container and inside nonmember destination cannot alter transfer classification.
 t.before.containers.push({id:r.container,aliases:[r.container],type:'aid',ownerId:f.ids[1],scope:'nine-and-public',units:t.before.scopedTotals});
 t.after.containers.push({id:r.destinationContainer,aliases:[r.destinationContainer],type:'person',ownerId:'commons',scope:'nine-and-public',units:t.after.scopedTotals});
 const o=f.observation([r]);o.receipts=[{at:f.w.minute,residentId:f.ids[0],eventId:'eat-one',planId:'plan-one',container:'person:'+f.ids[0],item:'meal',quantity:1,nutrition:15,hungerRelief:20}];
 f.c.sample(t.before,t.after,o);const report=f.c.finish(),s=report.foodTransfers;
 assert.deepEqual(s.scopes,['external']);assert.deepEqual(s.destinationScopes,[recipient==='nine'?'nine-and-public':'external']);
 assert.equal(s.scopeInflowTotals!.units.meal,recipient==='nine'?2:0);assert.equal(s.scopeInflowTotals!.nutrition,recipient==='nine'?30:0);
 assert.equal(s.nineIntakeTotals,null);assert.equal(s.scopedTotals!.sourceAdded.units.meal,0);assert.equal(s.scopedTotals!.inputs.units.meal,0);
 assert.equal(report.directEating.nineIntakeTotals!.units.meal,1);assert.equal(report.directEating.nineIntakeTotals!.nutrition,15);
 assert.equal(report.foodConsumption,null);
});
test('nine aid: old coverage keeps raw facts but totals unknown; endpoints never estimate transfers',()=>{
 const f=setup();let t=f.tick(),o=f.observation([f.receipt()]);delete o.foodTransferCoverage;
 f.c.sample(t.before,t.after,o);t=f.tick();t.after.scopedTotals.meal=999;f.c.sample(t.before,t.after,f.observation());
 const s=f.c.finish().foodTransfers;assert.equal(s.receipts.length,1);assert.equal(s.unobservedMinutes,1);assert.equal(s.scopeInflowTotals,null);
 const g=setup(),u=g.tick();g.c.sample(u.before,u.after,{worldId:g.w.id,fromMinute:u.before.at,toMinute:u.after.at,receipts:[]});assert.equal(g.c.finish().foodTransfers.scopeInflowTotals,null);
});
test('nine aid: unknown original nutrition affects inside transfer only',()=>{
 for(const inside of [true,false]){
  const f=setup(),t=f.tick(),r=f.receipt(inside?f.ids[0]:'external');r.amount.nutrition=null;r.amount.lots=null;
  f.c.sample(t.before,t.after,f.observation([r]));const s=f.c.finish().foodTransfers;
  assert.equal(s.scopeInflowTotals!.nutrition,inside?null:0);assert.equal(s.scopeInflowTotals!.units.meal,inside?2:0);
 }
});
for(const field of ['eventId','deliveryId'] as const)test('nine aid: cross-step '+field+' duplicates reject without advancing',()=>{
 const f=setup();let t=f.tick();f.c.sample(t.before,t.after,f.observation([f.receipt()]));t=f.tick();
 const r=f.receipt(f.ids[0],'two');r[field]=field==='eventId'?'event-one':'delivery-one';if(field==='deliveryId')r.container='aid:delivery-one';
 assert.throws(()=>f.c.sample(t.before,t.after,f.observation([r])),/Duplicate/);
 f.c.sample(t.before,t.after,f.observation([f.receipt(f.ids[0],'two')]));assert.equal(f.c.finish().foodTransfers.scopeInflowTotals!.units.meal,4);
});
test('nine aid: malformed second receipt does not poison first identity',()=>{
 const f=setup(),t=f.tick(),r=f.receipt(f.ids[0],'two');r.operation='dispatch' as 'collect';
 assert.throws(()=>f.c.sample(t.before,t.after,f.observation([f.receipt(),r])));
 f.c.sample(t.before,t.after,f.observation([f.receipt()]));assert.equal(f.c.finish().foodTransfers.receipts.length,1);
});

for(const missing of ['absent','undefined','getter'] as const)test('nine aid: claimed coverage requires data '+missing+' and rejection is atomic',()=>{
 const f=setup(),t=f.tick(),o=f.observation();let invoked=false;
 if(missing==='absent')delete o.foodTransfers;
 else if(missing==='undefined')o.foodTransfers=undefined;
 else Object.defineProperty(o,'foodTransfers',{get(){invoked=true;return [];}});
 assert.throws(()=>f.c.sample(t.before,t.after,o));assert.equal(invoked,false);
 f.c.sample(t.before,t.after,f.observation([f.receipt()]));
 const s=f.c.finish().foodTransfers;assert.equal(s.observedMinutes,1);assert.equal(s.unobservedMinutes,0);assert.equal(s.receipts.length,1);
});

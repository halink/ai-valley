import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {DAY} from '../src/world/time.js';
import {FOOD_TRANSFER_COVERAGE,type OutsideAidFoodTransferReceipt as FoodTransferReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';

function setup(at=10){
 const w=createWorld(414);w.minute=at;const daily=createIsolationEvidence(w);
 const receipt=(id='one'):FoodTransferReceipt=>({type:'transfer',action:'outsideAid',operation:'collect',at:w.minute,eventId:'event-'+id,deliveryId:'delivery-'+id,noticeId:'notice-one',merchantId:'merchant-one',recipientId:w.residents[0].id,container:'aid:delivery-'+id,destinationContainer:'person:'+w.residents[0].id,
  amount:{item:'meal',quantity:2,nutrition:30,lots:[{quantity:2,nutrition:30,producedAt:0,expiresAt:DAY*4,definition:'food/life@1'}]}});
 const observation=(receipts:FoodTransferReceipt[]=[]):DirectEatingObservation=>({worldId:w.id,fromMinute:w.minute-1,toMinute:w.minute,receipts:[],foodTransfers:receipts,foodTransferCoverage:FOOD_TRANSFER_COVERAGE});
 return {w,daily,receipt,observation};
}
test('aid daily: separate physical receipt, original nutrition and day boundary, no intake or production',()=>{
 const f=setup(DAY-1);f.w.minute++;const r=f.receipt(),o=f.observation([r]),row=f.daily.sample(f.w,o)!;
 assert.equal(row.calendarDay,0);assert.deepEqual(row.foodTransfers.totals,{units:{meal:2},nutrition:30,completedActions:1});
 assert.deepEqual(row.directEating.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 assert.equal(row.foodProduction.value,null);assert.equal(row.foodConsumption.value,null);assert.equal(row.foodFlows.totals,null);
 r.amount.quantity=99;assert.equal(row.foodTransfers.receipts[0].amount.quantity,2);
 assert.equal(f.daily.sample(f.w,o),null);f.w.minute++;f.daily.sample(f.w,f.observation());
 const next=f.daily.finish(f.w)!;assert.equal(next.calendarDay,1);assert.deepEqual(next.foodTransfers.totals,{units:{},nutrition:0,completedActions:0});
});
for(const missing of ['observation','coverage'] as const)test('aid daily: missing '+missing+' stays unknown',()=>{
 const f=setup();f.w.minute++;const o=f.observation([f.receipt()]);
 if(missing==='coverage')delete o.foodTransferCoverage;
 f.daily.sample(f.w,missing==='observation'?undefined:o);f.w.minute++;f.daily.sample(f.w,f.observation());
 const s=f.daily.finish(f.w)!.foodTransfers;assert.equal(s.unobservedMinutes,1);assert.equal(s.observedMinutes,1);assert.equal(s.totals,null);
 assert.equal(s.receipts.length,missing==='coverage'?1:0);
});
test('aid daily: absent original lots preserve unknown nutrition and known quantity',()=>{
 const f=setup();f.w.minute++;const r=f.receipt();r.amount.lots=null;r.amount.nutrition=null;f.daily.sample(f.w,f.observation([r]));
 assert.deepEqual(f.daily.finish(f.w)!.foodTransfers.totals,{units:{meal:2},nutrition:null,completedActions:1});
});
for(const duplicate of ['event','delivery'] as const)test('aid daily: '+duplicate+' duplicate across midnight rejects atomically',()=>{
 const f=setup(DAY-1);f.w.minute++;f.daily.sample(f.w,f.observation([f.receipt()]));f.w.minute++;
 const r=f.receipt('two');if(duplicate==='event')r.eventId='event-one';else{r.deliveryId='delivery-one';r.container='aid:delivery-one';}
 assert.throws(()=>f.daily.sample(f.w,f.observation([r])),/Duplicate/);
 f.daily.sample(f.w,f.observation([f.receipt('two')]));assert.equal(f.daily.finish(f.w)!.foodTransfers.totals!.completedActions,1);
});
test('aid daily: invalid later receipt cannot consume earlier valid identity or coverage',()=>{
 const f=setup();f.w.minute++;const valid=f.receipt(),bad=f.receipt('bad');bad.destinationContainer='public:wrong';
 assert.throws(()=>f.daily.sample(f.w,f.observation([valid,bad])));
 const o=f.observation([valid]);Object.defineProperty(o.foodTransfers![0],'unexpected',{value:1,enumerable:true});assert.throws(()=>f.daily.sample(f.w,o));
 f.daily.sample(f.w,f.observation([f.receipt()]));assert.equal(f.daily.finish(f.w)!.sampledMinutes,1);
});

for(const missing of ['absent','undefined','getter'] as const)test('aid daily: claimed coverage requires data '+missing+' and rejection is atomic',()=>{
 const f=setup();f.w.minute++;const o=f.observation();let invoked=false;
 if(missing==='absent')delete o.foodTransfers;
 else if(missing==='undefined')o.foodTransfers=undefined;
 else Object.defineProperty(o,'foodTransfers',{get(){invoked=true;return [];}});
 assert.throws(()=>f.daily.sample(f.w,o));assert.equal(invoked,false);
 f.daily.sample(f.w,f.observation([f.receipt()]));
 const row=f.daily.finish(f.w)!;assert.equal(row.sampledMinutes,1);assert.equal(row.foodTransfers.totals!.completedActions,1);
});
for(const ordering of ['same','eat-first','transfer-first'] as const)test('aid daily: cross-slice event collision '+ordering+' rejects atomically',()=>{
 const f=setup();f.w.minute++;
 const eat=()=>({at:f.w.minute,residentId:f.w.residents[0].id,eventId:'event-one',planId:'plan-one',container:'person:'+f.w.residents[0].id,item:'meal' as const,quantity:1,nutrition:15,hungerRelief:20});
 if(ordering!=='same'){
  const first=f.observation(ordering==='transfer-first'?[f.receipt()]:[]);
  if(ordering==='eat-first')first.receipts=[eat()];
  f.daily.sample(f.w,first);f.w.minute++;
 }
 const bad=f.observation(ordering==='transfer-first'?[]:[f.receipt()]);
 if(ordering!=='eat-first')bad.receipts=[eat()];
 assert.throws(()=>f.daily.sample(f.w,bad),/Duplicate/);
 f.daily.sample(f.w,f.observation([f.receipt('two')]));
 const row=f.daily.finish(f.w)!;
 assert.equal(row.sampledMinutes,ordering==='same'?1:2);
 assert.equal(row.foodTransfers.receipts.length,ordering==='transfer-first'?2:1);
});
test('aid daily: legacy missing both transfer fields remains unknown',()=>{
 const f=setup();f.w.minute++;const o=f.observation();delete o.foodTransfers;delete o.foodTransferCoverage;
 f.daily.sample(f.w,o);const s=f.daily.finish(f.w)!.foodTransfers;assert.equal(s.unobservedMinutes,1);assert.equal(s.totals,null);
});
test('aid daily: preexisting non-transfer duplicate behavior stays unchanged',()=>{
 const f=setup();
 for(let i=0;i<2;i++){
  f.w.minute++;const o=f.observation();o.receipts=[{at:f.w.minute,residentId:f.w.residents[0].id,eventId:'eat-legacy',planId:'plan-one',container:'person:'+f.w.residents[0].id,item:'meal',quantity:1,nutrition:15,hungerRelief:20}];
  f.daily.sample(f.w,o);
 }
 assert.equal(f.daily.finish(f.w)!.directEating.totals!.completedActions,2);
});

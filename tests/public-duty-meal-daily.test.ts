import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {DAY} from '../src/world/time.js';
import {publicMealFixture,queuePublicMeal} from './helpers/public-duty-meal-evidence.js';

function ready(role:'kitchen'|'care'='kitchen',funded=false,midnight=false){
 const f=publicMealFixture(role,funded);f.w.minute=Math.ceil(f.w.minute);
 queuePublicMeal(f);stepWorld(f.w,(role==='kitchen'?20:30)-1);
 assert.ok(f.beneficiary.activity);assert.equal(f.shift.served,0);
 if(midnight){
  const delta=DAY-1-f.w.minute;f.w.minute+=delta;f.shift.start+=delta;f.shift.end+=delta;
  for(const lots of Object.values(f.w.food!.lots[f.container]))for(const lot of lots??[])lot.expiresAt+=delta;
 }
 return f;
}
for(const role of ['kitchen','care'] as const)for(const funded of [false,true])test(`public daily: actual ${role} ${funded?'public':'personal'} inputs, effects and wages remain separate`,()=>{
 const f=ready(role,funded),daily=createIsolationEvidence(f.w),observation=stepWorldWithFoodEvidence(f.w,1);
 assert.equal(observation.publicDutyMeals!.length,1);daily.sample(f.w,observation);
 const row=daily.finish(f.w)!,slice=row.publicDutyMeals,r=slice.receipts[0],totals=slice.totals!;
 assert.equal(slice.observedMinutes,1);assert.equal(slice.unobservedMinutes,0);assert.deepEqual(slice.receipts,observation.publicDutyMeals);
 assert.deepEqual(totals.units,{[f.item]:role==='kitchen'?2:1,water:1});assert.equal(totals.completedActions,1);
 assert.equal(totals.nutrition,r.inputs[0].nutrition);assert.equal(totals.hungerRelief,r.hungerRelief);assert.equal(totals.healthGain,r.healthGain);
 assert.equal(totals.wages,funded?3:0);assert.deepEqual(totals.sources[r.source].units,totals.units);
 assert.deepEqual(totals.sources[funded?'personal':'public'].units,{});
 assert.equal(row.foodConsumption.value,null);assert.deepEqual(row.careMeals.receipts,[]);assert.deepEqual(row.directEating.receipts,[]);
 observation.publicDutyMeals![0].inputs[0].quantity=99;assert.equal(slice.receipts[0].inputs[0].quantity,role==='kitchen'?2:1);
});

test('public daily: midnight belongs to the ending day and no-receipt next day is explicitly observed zero',()=>{
 const f=ready('kitchen',false,true),daily=createIsolationEvidence(f.w),observation=stepWorldWithFoodEvidence(f.w,1);
 const row=daily.sample(f.w,observation)!;assert.equal(row.calendarDay,0);assert.equal(row.toMinute,DAY);
 assert.equal(row.publicDutyMeals.receipts.length,1);assert.equal(row.publicDutyMeals.totals!.completedActions,1);
 assert.equal(daily.sample(f.w),null);const next=stepWorldWithFoodEvidence(f.w,1);daily.sample(f.w,next);
 const after=daily.finish(f.w)!;assert.equal(after.calendarDay,1);assert.deepEqual(after.publicDutyMeals.receipts,[]);assert.equal(after.publicDutyMeals.totals!.completedActions,0);
});

for(const legacy of [false,true])test(`public daily: ${legacy?'legacy field absence':'missing observation'} remains unknown after observed zero`,()=>{
 const f=ready(),daily=createIsolationEvidence(f.w),first=stepWorldWithFoodEvidence(f.w,1);delete first.publicDutyMeals;
 daily.sample(f.w,legacy?first:undefined);const next=stepWorldWithFoodEvidence(f.w,1);daily.sample(f.w,next);
 const row=daily.finish(f.w)!;assert.equal(row.publicDutyMeals.observedMinutes,1);assert.equal(row.publicDutyMeals.unobservedMinutes,1);assert.equal(row.publicDutyMeals.totals,null);
 if(legacy)assert.equal(row.longCareMeals.observedMinutes,2);
});

test('public daily: missing original lot remains unknown nutrition with known physical debit',()=>{
 const f=ready('care',true);delete f.w.food!.lots[f.container][f.item];
 const daily=createIsolationEvidence(f.w),o=stepWorldWithFoodEvidence(f.w,1);daily.sample(f.w,o);
 const row=daily.finish(f.w)!,totals=row.publicDutyMeals.totals!;
 assert.equal(totals.nutrition,null);assert.equal(totals.sources.public.nutrition,null);assert.equal(totals.sources.personal.nutrition,0);
 assert.deepEqual(totals.units,{meal:1,water:1});assert.equal(totals.wages,3);assert.equal(totals.hungerRelief,20);
 assert.equal(row.publicDutyMeals.receipts[0].inputs[0].lots,null);
});

test('public daily: wrong interval rejects the receipt before accumulator mutation',()=>{
 const f=ready(),daily=createIsolationEvidence(f.w),o=stepWorldWithFoodEvidence(f.w,1),bad=structuredClone(o);
 bad.publicDutyMeals![0].at=bad.fromMinute;assert.throws(()=>daily.sample(f.w,bad),/does not cover/);
 daily.sample(f.w,o);assert.equal(daily.finish(f.w)!.publicDutyMeals.totals!.completedActions,1);
});

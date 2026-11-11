import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {DAY} from '../src/world/time.js';
import {familyJourneyMealFixture,acceptFamilyJourney,chooseFamilyJourney} from './helpers/family-journey-meal-evidence.js';

function ready(midnight=false){
 const f=familyJourneyMealFixture();if(midnight)f.w.minute=DAY-20;
 acceptFamilyJourney(f);f.w.minute=midnight?DAY-1:Math.ceil(f.w.minute);return f;
}

test('family daily: actual member portions, companion water and midnight use the ending day',()=>{
 const f=ready(true),daily=createIsolationEvidence(f.w);chooseFamilyJourney(f.w,f.parent,'depart');
 const observation=stepWorldWithFoodEvidence(f.w,1);assert.equal(observation.familyJourneyMeals!.length,2);
 const row=daily.sample(f.w,observation)!;assert.equal(row.calendarDay,0);assert.equal(row.toMinute,DAY);
 assert.equal(row.familyJourneyMeals.observedMinutes,1);assert.equal(row.familyJourneyMeals.unobservedMinutes,0);
 assert.deepEqual(row.familyJourneyMeals.receipts,observation.familyJourneyMeals);
 const total=row.familyJourneyMeals.totals!;assert.deepEqual(total.units,{meal:2,water:2});assert.equal(total.completedActions,2);
 assert.equal(total.nutrition,observation.familyJourneyMeals!.reduce((sum,r)=>sum+r.inputs[0].nutrition!,0));
 assert.equal(total.hungerRelief,observation.familyJourneyMeals!.reduce((sum,r)=>sum+r.hungerRelief,0));
 assert.equal(row.foodConsumption.value,null);assert.deepEqual(row.journeyMeals.receipts,[]);
 observation.familyJourneyMeals![0].inputs[0].quantity=99;assert.equal(row.familyJourneyMeals.receipts[0].inputs[0].quantity,1);
 assert.equal(daily.sample(f.w),null);const next=stepWorldWithFoodEvidence(f.w,1);daily.sample(f.w,next);
 const after=daily.finish(f.w)!;assert.equal(after.calendarDay,1);assert.deepEqual(after.familyJourneyMeals.receipts,[]);assert.equal(after.familyJourneyMeals.totals!.completedActions,0);
});

for(const legacy of [false,true])test(`family daily: ${legacy?'legacy journey-only record':'missing observation'} cannot be repaired by subsequent observed zero`,()=>{
 const f=ready(),daily=createIsolationEvidence(f.w);const first=stepWorldWithFoodEvidence(f.w,1);delete first.familyJourneyMeals;
 daily.sample(f.w,legacy?first:undefined);const next=stepWorldWithFoodEvidence(f.w,1);assert.deepEqual(next.familyJourneyMeals,[]);daily.sample(f.w,next);
 const row=daily.finish(f.w)!;assert.equal(row.familyJourneyMeals.observedMinutes,1);assert.equal(row.familyJourneyMeals.unobservedMinutes,1);assert.equal(row.familyJourneyMeals.totals,null);
 if(legacy){assert.equal(row.journeyMeals.unobservedMinutes,0);assert.equal(row.journeyMeals.observedMinutes,2);}
});

test('family daily: unknown original meal nutrition retains actual member units and hunger separately',()=>{
 const f=ready();delete f.w.food!.lots['person:'+f.parent.id].meal;
 const daily=createIsolationEvidence(f.w);chooseFamilyJourney(f.w,f.parent,'depart');const o=stepWorldWithFoodEvidence(f.w,1);
 daily.sample(f.w,o);const row=daily.finish(f.w)!,total=row.familyJourneyMeals.totals!;
 assert.equal(total.nutrition,null);assert.deepEqual(total.units,{meal:2,water:2});assert.equal(total.completedActions,2);assert.ok(total.hungerRelief>0);
 assert.ok(row.familyJourneyMeals.receipts.every(r=>r.inputs[0].lots===null));
});

test('family daily: wrong interval receipt is rejected before changing the accumulator',()=>{
 const f=ready(),daily=createIsolationEvidence(f.w);chooseFamilyJourney(f.w,f.parent,'depart');const observation=stepWorldWithFoodEvidence(f.w,1),bad=structuredClone(observation);
 bad.familyJourneyMeals![0].at=bad.fromMinute;assert.throws(()=>daily.sample(f.w,bad),/does not cover/);
 daily.sample(f.w,observation);assert.equal(daily.finish(f.w)!.familyJourneyMeals.totals!.completedActions,2);
});

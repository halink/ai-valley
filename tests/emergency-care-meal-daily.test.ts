import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {DAY,YEAR} from '../src/world/time.js';
import {careFixture,careChoice,queueCareAction} from './helpers/care-meal-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {observedEmergencyCareMealsByDay} from '../src/server/emergency-care-meal-evidence.js';

function rescueFixture(){const f=careFixture();f.beneficiary.bornAt=f.w.minute-2*YEAR;f.beneficiary.canDecide=false;f.beneficiary.canExpress=false;f.beneficiary.health=19;f.beneficiary.hunger=80;f.beneficiary.guardianIds=[];return f;}
function queueRescue(f:ReturnType<typeof rescueFixture>){return queueCareAction(f.w,f.provider,careChoice(f.w,f.provider,a=>a.type==='emergencyCare'&&a.operation==='rescueMeal'&&a.childId===f.beneficiary.id));}

test('emergency daily: successful midnight rescue belongs to closing day and remains outside other care slices',()=>{
 const f=rescueFixture();f.w.minute=DAY-20;
 for(const lots of Object.values(f.w.food!.lots))for(const rows of Object.values(lots))for(const lot of rows??[])lot.expiresAt=DAY+1000;
 queueRescue(f);const observer=createIsolationEvidence(f.w),events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start(f.w.id,f.w.minute);
 let row;for(let i=0;i<20;i++){const o=stepWorldWithFoodEvidence(f.w,1);food.committed(o,f.w.revision);row=observer.sample(f.w,o);}
 assert.ok(row);assert.equal(row.emergencyCareMeals.observedMinutes,20);assert.equal(row.emergencyCareMeals.unobservedMinutes,0);assert.equal(row.emergencyCareMeals.receipts.length,1);
 const r=row.emergencyCareMeals.receipts[0];assert.equal(r.at,DAY);assert.equal(r.operation,'rescueMeal');assert.equal(r.agreementId,null);assert.equal(r.mealNumber,null);
 assert.deepEqual(row.emergencyCareMeals.totals!.units,{meal:1,water:1});assert.equal(row.emergencyCareMeals.totals!.completedActions,1);assert.equal(row.careMeals.totals!.completedActions,0);assert.equal(row.childCareMeals.totals!.completedActions,0);assert.equal(row.longCareMeals.totals!.completedActions,0);assert.equal(row.foodConsumption.value,null);
 food.stop(f.w.id,f.w.minute);assert.deepEqual(observedEmergencyCareMealsByDay(events),[{calendarDay:0,receipts:[r]}]);
 observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));assert.equal(observer.finish(f.w)!.emergencyCareMeals.totals!.completedActions,0);
});

test('emergency daily: omitted old slice and unobserved minute remain unknown after later explicit empty observations',()=>{
 const f=rescueFixture(),observer=createIsolationEvidence(f.w);
 observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));assert.deepEqual(observer.finish(f.w)!.emergencyCareMeals.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
 const legacy=stepWorldWithFoodEvidence(f.w,1);delete legacy.emergencyCareMeals;observer.sample(f.w,legacy);
 observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));let row=observer.finish(f.w)!;assert.equal(row.emergencyCareMeals.totals,null);assert.equal(row.emergencyCareMeals.observedMinutes,2);assert.equal(row.emergencyCareMeals.unobservedMinutes,1);assert.equal(row.childCareMeals.totals!.completedActions,0);
 stepWorld(f.w,1);observer.sample(f.w);row=observer.finish(f.w)!;assert.equal(row.emergencyCareMeals.unobservedMinutes,2);assert.equal(row.emergencyCareMeals.totals,null);
});

test('emergency daily: original definition gaps preserve actual relief without fabricating nutrition',()=>{
 const f=rescueFixture();for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.definition='food/missing@1';queueRescue(f);const observer=createIsolationEvidence(f.w);
 for(let i=0;i<20;i++)observer.sample(f.w,stepWorldWithFoodEvidence(f.w,1));
 const row=observer.finish(f.w)!;assert.equal(row.emergencyCareMeals.receipts.length,1);assert.equal(row.emergencyCareMeals.totals!.nutrition,null);assert.ok(row.emergencyCareMeals.totals!.hungerRelief>0);assert.equal(row.emergencyCareMeals.totals!.hungerRelief,row.emergencyCareMeals.receipts[0].hungerRelief);
});

test('emergency daily: mismatched receipt timestamp is rejected before changing sampled coverage',()=>{
 const f=rescueFixture();queueRescue(f);stepWorld(f.w,19);const observer=createIsolationEvidence(f.w),o=stepWorldWithFoodEvidence(f.w,1);assert.equal(o.emergencyCareMeals!.length,1);
 for(const at of [o.fromMinute,o.toMinute+1]){const malformed=structuredClone(o);malformed.emergencyCareMeals![0].at=at;assert.throws(()=>observer.sample(f.w,malformed));}
 observer.sample(f.w,o);assert.equal(observer.finish(f.w)!.emergencyCareMeals.observedMinutes,1);
});

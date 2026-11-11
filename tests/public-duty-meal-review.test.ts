import {test} from 'node:test';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import assert from 'node:assert/strict';
import {publicMealFixture,queuePublicMeal,finishPublicMeal} from './helpers/public-duty-meal-evidence.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditPublicDutyMeals} from '../src/server/public-duty-meal-evidence.js';
import {checkedPublicDutyMeal} from '../src/server/acceptance-evidence-schema.js';

function actual(role:'kitchen'|'care'='kitchen',funded=false){const f=publicMealFixture(role,funded);queuePublicMeal(f);const rows=finishPublicMeal(f.w,f.beneficiary);assert.equal(rows.length,1);return {f,row:rows[0]};}
function published(row:ReturnType<typeof actual>['row']){const events:RuntimeFoodEvent[]=[];const food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});food.start('synthetic',row.at-1);food.committed({worldId:'synthetic',fromMinute:row.at-1,toMinute:row.at+1,receipts:[],publicDutyMeals:[row]},1);food.stop('synthetic',row.at+1);return {events,food};}

test('independent public review: unsorted original lots follow expiry and never use fixed relief as nutrition',()=>{
 const f=publicMealFixture();f.w.food!.lots[f.container].turnip!.reverse();queuePublicMeal(f);const [row]=finishPublicMeal(f.w,f.beneficiary);
 assert.deepEqual(row.inputs.map(a=>[a.item,a.quantity]),[['turnip',2],['water',1]]);
 assert.deepEqual(row.inputs[0].lots!.map(l=>[l.quantity,l.nutrition]),[[.25,2.5],[1.75,52.5]]);
 assert.equal(row.inputs[0].nutrition,55);assert.equal(row.hungerRelief,42);assert.equal(row.healthGain,0);assert.equal(row.funding,null);
 assert.deepEqual(checkedPublicDutyMeal(row),row);
});

test('independent public review: care caps relief and health without reducing physical inputs',()=>{
 const f=publicMealFixture('care');f.beneficiary.hunger=1;f.beneficiary.health=99;queuePublicMeal(f);const [row]=finishPublicMeal(f.w,f.beneficiary);
 assert.equal(row.hungerAfter,0);assert.equal(row.healthAfter,100);assert.ok(row.hungerRelief<20);assert.ok(row.healthGain<8);
 assert.deepEqual(row.inputs.map(a=>[a.item,a.quantity]),[['meal',1],['water',1]]);assert.equal(row.inputs[0].nutrition,25);
 assert.deepEqual(checkedPublicDutyMeal(row),row);
});

test('independent public review: same-step original-lot repairs stay unknown',()=>{
 for(const change of ['missing','under','over'] as const){
  const f=publicMealFixture();queuePublicMeal(f);
  let limit=1000;while(!f.beneficiary.activity||f.beneficiary.activity.path.length||f.beneficiary.activity.remaining>.25){assert.ok(limit-->0);assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).publicDutyMeals,[]);}
  if(change==='missing')delete f.w.food!.lots[f.container].turnip;
  else f.w.food!.lots[f.container].turnip![1].quantity+=change==='under'?-1:1;
  const [row]=finishPublicMeal(f.w,f.beneficiary);
  assert.equal(row.inputs[0].nutrition,null,change);assert.equal(row.inputs[0].lots,null,change);
  assert.equal(row.hungerRelief,42);assert.deepEqual(checkedPublicDutyMeal(row),row);
 }
});

test('independent public review: speculative copy cannot publish into original capture or persist evidence',()=>{
 const f=publicMealFixture();queuePublicMeal(f);const copy=copyForSimulation(f.w);
 const observation=captureDirectEating(f.w,()=>{assert.equal(finishPublicMeal(copy,copy.residents.find(r=>r.id===f.beneficiary.id)!).length,1);});
 assert.deepEqual(observation.publicDutyMeals,[]);assert.equal(f.shift.served,0);
 assert.equal(JSON.stringify(copy).includes('publicDutyMeals'),false);assert.equal(finishPublicMeal(f.w,f.beneficiary).length,1);
});

test('independent public review: published nested originals are detached and frozen; accessors are not invoked',()=>{
 const {row}=actual();const {events}=published(row),step=events[1];assert.equal(step.type,'food_step_committed');if(step.type!=='food_step_committed')return;
 const before=structuredClone(step.publicDutyMeals);row.inputs[0].lots![0].definition='unknown@1';assert.deepEqual(step.publicDutyMeals,before);
 assert.throws(()=>{step.publicDutyMeals![0].inputs[0].quantity=100;},TypeError);
 let calls=0;const food=new RuntimeFoodEvidence({observe:()=>{}}),observation={worldId:'synthetic',fromMinute:0,toMinute:1,receipts:[]};
 Object.defineProperty(observation,'publicDutyMeals',{get(){calls++;return [];}});food.start('synthetic',0);food.committed(observation,1);
 assert.equal(calls,0);assert.equal(food.status().phase,'failed');
});

test('independent public review: duplicate services and physical-source forgery suppress trusted totals',()=>{
 const {row}=actual(),{events}=published(row);assert.equal(auditPublicDutyMeals(events,true).complete,true);
 const step=events[1];if(step.type!=='food_step_committed')throw Error('missing step');
 const duplicate=structuredClone(row);duplicate.eventId+='-different';
 assert.equal(auditPublicDutyMeals([{...step,publicDutyMeals:[row,duplicate]}],true).totals,null);
 const forged=structuredClone(row);forged.container='treasuryStock';assert.throws(()=>checkedPublicDutyMeal(forged));
 assert.equal(auditPublicDutyMeals([{...step,publicDutyMeals:[forged]}],true).totals,null);
 const legacy={...step};delete legacy.publicDutyMeals;assert.equal(auditPublicDutyMeals([legacy],true).totals,null);
 assert.equal(auditPublicDutyMeals([{...step,publicDutyMeals:[]}],true).totals!.completedActions,0);
});

test('independent public review: funded public source is one physical debit and wages stay separate',()=>{
 for(const role of ['kitchen','care'] as const){
  const f=publicMealFixture(role,true),stockBefore=f.inventory[f.item]!,personalBefore={...f.provider.inventory},aggregateBefore=f.w.economy!.treasuryStock[f.item]!;
  queuePublicMeal(f);const [row]=finishPublicMeal(f.w,f.beneficiary),cost=role==='kitchen'?2:1;
  assert.equal(row.source,'public');assert.equal(row.container,'public:'+f.building.id);assert.equal(row.inputs[0].quantity,cost);
  assert.equal(stockBefore-f.inventory[f.item]!,cost);assert.equal(aggregateBefore-f.w.economy!.treasuryStock[f.item]!,cost);
  assert.deepEqual(f.provider.inventory,personalBefore);assert.equal(row.funding!.providerCoinsAfter-row.funding!.providerCoinsBefore,3);
  const result=auditPublicDutyMeals(published(row).events,true);assert.equal(result.complete,true);
  assert.equal(result.totals!.units[f.item],cost);assert.equal(result.totals!.sources.personal.completedActions,0);
  assert.equal(result.totals!.wages,3);assert.equal(result.totals!.nutrition,role==='kitchen'?55:25);
 }
});

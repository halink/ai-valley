import {test} from 'node:test';
import assert from 'node:assert/strict';
import {longCareFixture,queueLongCare,finishLongCare} from './helpers/long-care-meal-evidence.js';
import {careChoice,queueCareAction} from './helpers/care-meal-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {auditLongCareMeals} from '../src/server/long-care-meal-evidence.js';
import type {RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';

function nearFinish(f:ReturnType<typeof longCareFixture>){queueLongCare(f);stepWorld(f.w,f.c.rules!.visitMinutes-.25);assert.ok(f.provider.activity);assert.equal(f.c.visits.length,0);}

test('independent long care review: signed historical recipe survives active definition changes and clips effects',()=>{
 const f=longCareFixture(12,{meal:2,water:2});
 assert.equal(f.c.childAssent,true);assert.equal(f.c.definition,'care/long@90');
 f.w.activeDefinitions['care/long']='care/long@1';nearFinish(f);
 f.beneficiary.hunger=1;f.beneficiary.health=99;
 const plain=structuredClone(f.w),stock=structuredClone(f.provider.inventory),paid=f.c.paid;
 const o=stepWorldWithFoodEvidence(f.w,.25);stepWorld(plain,.25);assert.deepEqual(f.w,plain);
 const r=o.longCareMeals![0];assert.ok(r);assert.equal(r.definition,'care/long@90');
 assert.deepEqual(r.inputs.map(x=>[x.item,x.quantity]),[['meal',2],['water',2]]);
 assert.equal(r.inputs[0].nutrition,55);assert.ok(r.hungerRelief<2);assert.equal(r.healthGain,1);
 assert.equal(stock.meal!-f.provider.inventory.meal!,2);assert.equal(f.c.paid-paid,3);
 assert.equal(f.c.visits[0].key,r.slotKey);assert.ok(f.w.events.some(e=>e.id===r.eventId&&e.actors.includes(f.beneficiary.id)));
 assert.deepEqual(o.careMeals,[]);assert.deepEqual(o.childCareMeals,[]);assert.equal(JSON.stringify(f.w).includes('longCareMeals'),false);
});

test('independent long care review: immediate beneficiary stop and current refusal beat the last fraction',()=>{
 for(const stop of ['refusal','cancel'] as const){const f=longCareFixture();nearFinish(f);const stock=structuredClone(f.provider.inventory);
  if(stop==='refusal')f.beneficiary.refusesCare=true;
  else {f.beneficiary.canDecide=false;queueCareAction(f.w,f.beneficiary,careChoice(f.w,f.beneficiary,a=>a.type==='longCare'&&a.operation==='cancel'&&a.agreementId===f.c.id));assert.equal(f.c.status,'cancelled');}
  assert.deepEqual(finishLongCare(f.w,f.provider),[]);assert.deepEqual(f.provider.inventory,stock);assert.equal(f.c.paid,0);assert.equal(f.c.visits.length,0);
 }
});

test('independent long care review: disappeared personal resources cannot be replaced by nearby inventory',()=>{
 const f=longCareFixture();nearFinish(f);f.provider.inventory.meal=0;f.other.inventory.meal=100;f.other.at={...f.provider.at};
 const water=f.provider.inventory.water;assert.deepEqual(finishLongCare(f.w,f.provider),[]);assert.equal(f.provider.inventory.water,water);assert.equal(f.c.visits.length,0);assert.equal(f.c.paid,0);
});

test('independent long care review: unknown original definition retains null nutrition despite successful simulation fallback',()=>{
 const f=longCareFixture();nearFinish(f);for(const lot of f.w.food!.lots['person:'+f.provider.id].meal!)lot.definition='food/missing@99';
 const o=stepWorldWithFoodEvidence(f.w,.25),r=o.longCareMeals![0];assert.ok(r);assert.equal(r.inputs[0].nutrition,null);assert.ok(r.hungerRelief>0);
 const event={type:'food_step_committed',...o} as unknown as RuntimeFoodEvent;
 const audit=auditLongCareMeals([event],true);assert.equal(audit.complete,true);assert.equal(audit.totals!.nutrition,null);assert.equal(audit.totals!.hungerRelief,r.hungerRelief);
});

test('independent long care review: speculative copy completion cannot enter live capture',()=>{
 const f=longCareFixture();nearFinish(f);const before=structuredClone(f.w);
 const observed=captureDirectEating(f.w,()=>{const prediction=copyForSimulation(f.w);stepWorld(prediction,.25);assert.equal(prediction.longCare!.agreements.at(-1)!.visits.length,1);});
 assert.deepEqual(observed.longCareMeals,[]);assert.deepEqual(f.w,before);assert.equal(stepWorldWithFoodEvidence(f.w,.25).longCareMeals!.length,1);
});

test('independent long care review: different event IDs cannot double-count one agreement slot',()=>{
 const f=longCareFixture();nearFinish(f);const o=stepWorldWithFoodEvidence(f.w,.25),r=o.longCareMeals![0];assert.ok(r);
 const event={type:'food_step_committed',...o,longCareMeals:[r,{...structuredClone(r),eventId:r.eventId+':duplicate'}]} as unknown as RuntimeFoodEvent;
 assert.equal(auditLongCareMeals([event],true).totals,null);
});

test('independent long care review: slot identity is scoped to agreement, but persists across step boundaries',()=>{
 const f=longCareFixture();nearFinish(f);const o=stepWorldWithFoodEvidence(f.w,.25),r=o.longCareMeals![0];assert.ok(r);
 const first={type:'food_step_committed',...o} as unknown as RuntimeFoodEvent;
 const next={type:'food_step_committed',...o,fromMinute:o.toMinute,toMinute:o.toMinute+.25,longCareMeals:[{...structuredClone(r),eventId:r.eventId+':next',at:o.toMinute+.25}]} as unknown as RuntimeFoodEvent;
 assert.equal(auditLongCareMeals([first,next],true).totals,null);
 if(next.type!=='food_step_committed')return;
 next.longCareMeals![0].agreementId+=':different';assert.equal(auditLongCareMeals([first,next],true).totals!.completedActions,2);
 next.longCareMeals![0].agreementId=r.agreementId;next.longCareMeals![0].slotKey+=':different';assert.equal(auditLongCareMeals([first,next],true).totals!.completedActions,2);
});

test('independent long care review: one legacy slice makes coverage unknown despite a later valid visit',()=>{
 const f=longCareFixture();nearFinish(f);const o=stepWorldWithFoodEvidence(f.w,.25);
 const current={type:'food_step_committed',...o} as unknown as RuntimeFoodEvent;
 const old={type:'food_step_committed',...o,toMinute:o.fromMinute,fromMinute:o.fromMinute-.25} as unknown as RuntimeFoodEvent;
 if(old.type!=='food_step_committed')return;const {longCareMeals:omitted,...legacy}=old;
 const report=auditLongCareMeals([legacy,current],true);assert.equal(report.totals,null);assert.equal(report.observedReceipts.length,1);assert.ok(report.issues.includes('missing_long_care_observation'));
});

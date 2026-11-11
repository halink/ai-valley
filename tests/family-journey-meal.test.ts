import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stepWorld,stepWorldWithFoodEvidence,planStartError} from '../src/world/engine.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {WorldStore} from '../src/server/store.js';
import {familyJourneyMealFixture,acceptFamilyJourney,chooseFamilyJourney,finishFamilyJourneyChoice,departFamilyJourney,originalFamilyJourneyLots} from './helpers/family-journey-meal-evidence.js';

test('family meals: final numbered proposal, independent signatures and shared fractional original lots',()=>{
 const f=familyJourneyMealFixture(true);originalFamilyJourneyLots(f);const c=acceptFamilyJourney(f);
 assert.equal(c.signatures.length,3);const before=f.parent.inventory.meal!;f.parent.hunger=3;
 chooseFamilyJourney(f.w,f.parent,'depart');const rows=finishFamilyJourneyChoice(f.w,f.parent);
 assert.equal(rows.length,3);assert.equal(c.status,'travelling');assert.equal(f.parent.inventory.meal,before-2);assert.equal(f.owner.inventory.meal,39);
 assert.deepEqual(rows.map(r=>r.memberIndex),[0,1,2]);assert.deepEqual(rows.map(r=>r.providerPortion),[0,0,1]);
 for(const [i,r]of rows.entries()){
  assert.equal(r.action,'familyRelocation');assert.equal(r.operation,'ration');assert.equal(r.trigger,'depart');assert.equal(r.relocationId,c.id);assert.equal(r.definition,c.definition);assert.equal(r.rationNumber,1);assert.equal(r.memberCount,3);
  assert.equal(r.beneficiaryId,c.members[i].personId);assert.equal(r.providerId,c.members[i].providerId);assert.equal(r.container,'person:'+r.providerId);
  assert.equal('eventId' in r,false);assert.equal('planId' in r,false);assert.equal(r.hungerRelief,r.hungerBefore-r.hungerAfter);
  assert.deepEqual(r.inputs.map(a=>[a.item,a.quantity]),[['meal',1],['water',1]]);assert.equal(r.inputs[1].nutrition,0);assert.deepEqual(r.inputs[1].lots,[]);
 }
 assert.equal(rows[0].inputs[0].nutrition,25);assert.deepEqual(rows[0].inputs[0].lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.25,'food/life@90',2.5],[.75,'food/life@91',22.5]]);
 assert.equal(rows[2].inputs[0].nutrition,30);assert.equal(rows[0].hungerAfter,0);assert.ok(rows[0].hungerRelief<25);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,.2).familyJourneyMeals,[]);
});

test('family meals: departure reserve and individual arrival are not extra eating',()=>{
 const f=familyJourneyMealFixture(),{c,rows}=departFamilyJourney(f);assert.equal(rows.length,2);const stock=f.parent.inventory.meal;
 for(let n=0;c.status==='travelling'&&n<100;n++)assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals,[]);
 assert.equal(c.status,'arrived');for(const r of [f.parent,f.child]){chooseFamilyJourney(f.w,r,'arrive',a=>a.operation==='arrive'&&a.personId===r.id);assert.deepEqual(finishFamilyJourneyChoice(f.w,r),[]);}
 assert.equal(c.status,'completed');assert.equal(f.parent.inventory.meal,stock);
});

test('family meals: periodic ration survives SQLite reload with stable identities and no replay',()=>{
 const f=familyJourneyMealFixture(false,true),{c,rows}=departFamilyJourney(f);assert.equal(rows.length,2);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load(true)!,saved=w.familyRelocation!.agreements[0];const all=[...rows];
  for(let n=0;saved.status==='travelling'&&n<200;n++)all.push(...stepWorldWithFoodEvidence(w,1).familyJourneyMeals!);
  assert.equal(saved.status,'arrived');assert.equal(all.length,4);assert.deepEqual(all.map(r=>[r.trigger,r.rationNumber,r.memberIndex]),[['depart',1,0],['depart',1,1],['travel',2,0],['travel',2,1]]);
  assert.equal(new Set(all.map(r=>`${r.relocationId}:${r.rationNumber}:${r.memberIndex}`)).size,4);assert.equal(saved.id,c.id);
  assert.deepEqual(stepWorldWithFoodEvidence(w,1).familyJourneyMeals,[]);
 }finally{store.close();}
});

for(const delay of [false,true])test(`family meals: explicit resume ${delay?'after ration interval eats once':'before interval does not eat again'}`,()=>{
 const f=familyJourneyMealFixture(false,true),{c}=departFamilyJourney(f);if(delay)for(let n=0;n<80;n++)stepWorld(f.w,1);const next=c.journey!.path[0];f.w.map.tiles[next.y*f.w.map.width+next.x]='cliff';assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals,[]);assert.equal(c.status,'paused');
 f.w.map.tiles[next.y*f.w.map.width+next.x]='grass';if(delay)stepWorld(f.w,121);const before=f.parent.inventory.meal!;
 chooseFamilyJourney(f.w,f.parent,'resume');const rows=finishFamilyJourneyChoice(f.w,f.parent);assert.equal(rows.length,delay?2:0);assert.equal(f.parent.inventory.meal,before-(delay?2:0));
 if(delay)assert.ok(rows.every(r=>r.trigger==='resume'&&r.rationNumber===2));
 chooseFamilyJourney(f.w,f.child,'withdraw');assert.deepEqual(finishFamilyJourneyChoice(f.w,f.child),[]);assert.equal(c.status,'cancelled');assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals,[]);
});

for(const change of ['shortage','spoiled','dead'] as const)test(`family meals: ${change} before completion cannot debit any member`,()=>{
 const f=familyJourneyMealFixture(true);acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');stepWorld(f.w,.2);
 if(change==='shortage')f.owner.inventory.water=0;
 if(change==='spoiled')for(const lot of f.w.food!.lots['person:'+f.owner.id].meal!)lot.expiresAt=f.w.minute+.1;
 if(change==='dead')f.child.status='dead';
 const stock=f.parent.inventory.meal;const observation=stepWorldWithFoodEvidence(f.w,2);assert.deepEqual(observation.familyJourneyMeals,[]);assert.equal(f.parent.inventory.meal,stock);
});

for(const corruption of ['missing','overfull','deficit','definition'] as const)test(`family meals: ${corruption} original lots remain unknown instead of certifying repair`,()=>{
 const f=familyJourneyMealFixture();acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');const ledger=f.w.food!.lots['person:'+f.parent.id];
 if(corruption==='missing')delete ledger.meal;
 if(corruption==='overfull')ledger.meal![0].quantity+=10;
 if(corruption==='deficit')ledger.meal![0].quantity-=1;
 if(corruption==='definition')for(const lot of ledger.meal!)lot.definition='missing/definition@1';
 const plain=structuredClone(f.w);stepWorld(plain,1);const rows=stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals!;assert.equal(rows.length,2);assert.deepEqual(f.w,plain);
 for(const r of rows){assert.equal(r.inputs[0].nutrition,null);if(corruption!=='definition')assert.equal(r.inputs[0].lots,null);assert.ok(r.hungerRelief>0);}
});

test('family meals: disabled collection, speculative clones, paused clocks and thrown captures do not leak',()=>{
 const f=familyJourneyMealFixture();acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');const plain=structuredClone(f.w),observed=structuredClone(f.w);
 stepWorld(plain,1);assert.equal(stepWorldWithFoodEvidence(observed,1).familyJourneyMeals!.length,2);assert.deepEqual(observed,plain);
 const before=structuredClone(f.w);let simulated=0;const capture=captureDirectEating(f.w,()=>{const copy=copyForSimulation(f.w);simulated=stepWorldWithFoodEvidence(copy,1).familyJourneyMeals!.length;});assert.equal(simulated,2);assert.deepEqual(capture.familyJourneyMeals,[]);assert.deepEqual(f.w,before);
 f.w.clock.paused=true;const paused=structuredClone(f.w);assert.deepEqual(stepWorldWithFoodEvidence(f.w,200).familyJourneyMeals,[]);assert.deepEqual(f.w,paused);f.w.clock.paused=false;
 assert.throws(()=>captureDirectEating(f.w,()=>{stepWorld(f.w,1);throw new Error('synthetic capture failure');}),/synthetic capture failure/);
 assert.deepEqual(captureDirectEating(f.w,()=>{}).familyJourneyMeals,[]);assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals,[]);
});

 test('family meals: real plan-start prediction can complete hypothetical departure without emitting root evidence',()=>{
 const f=familyJourneyMealFixture();acceptFamilyJourney(f);const plan=chooseFamilyJourney(f.w,f.parent,'depart');f.parent.plan=null;
 const before=structuredClone(f.w);const observation=captureDirectEating(f.w,()=>assert.equal(planStartError(f.w,plan),null));
 assert.deepEqual(observation.familyJourneyMeals,[]);assert.deepEqual(f.w,before);
 });

test('family meals: periodic whole-group shortage pauses without partial debit or spending arrival reserve',()=>{
 const f=familyJourneyMealFixture(true,true),{c}=departFamilyJourney(f);f.owner.inventory.water=1;
 const before=f.parent.inventory.meal!;const rows=[];
 for(let n=0;c.status==='travelling'&&n<125;n++)rows.push(...stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals!);
 assert.equal(c.status,'paused');assert.deepEqual(rows,[]);assert.equal(c.journey!.rationsUsed,1);assert.equal(f.parent.inventory.meal,before);assert.equal(f.owner.inventory.water,1);
});

test('family meals: death during travel and clock restart cannot invent a ration',()=>{
 const f=familyJourneyMealFixture(false,true),{c}=departFamilyJourney(f);f.child.status='dead';const before=f.parent.inventory.meal;
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,121).familyJourneyMeals,[]);assert.notEqual(c.status,'travelling');assert.equal(f.parent.inventory.meal,before);
});

test('family meals: actual periodic ingestion remains evidenced when subsequent movement meets an obstruction',()=>{
 const f=familyJourneyMealFixture(false,true),{c}=departFamilyJourney(f);
 for(let n=0;n<119;n++)assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals,[]);
 const next=c.journey!.path[0],at={...f.parent.at},stock=f.parent.inventory.meal!,water=f.parent.inventory.water!;
 f.w.map.tiles[next.y*f.w.map.width+next.x]='cliff';
 const plain=structuredClone(f.w);stepWorld(plain,1);const rows=stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals!;
 assert.deepEqual(f.w,plain);assert.equal(c.status,'paused');assert.deepEqual(f.parent.at,at);assert.deepEqual(f.child.at,at);
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.trigger==='travel'&&r.rationNumber===2));assert.deepEqual(rows.map(r=>r.memberIndex),[0,1]);
 assert.equal(c.journey!.rationsUsed,2);assert.equal(f.parent.inventory.meal,stock-2);assert.equal(f.parent.inventory.water,water-2);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals,[]);
});

test('family meals: repaired shared-provider lots do not erase another adult provider original provenance',()=>{
 const f=familyJourneyMealFixture(true);acceptFamilyJourney(f);chooseFamilyJourney(f.w,f.parent,'depart');
 delete f.w.food!.lots['person:'+f.parent.id].meal;
 const original=structuredClone(f.w.food!.lots['person:'+f.owner.id].meal!);assert.equal(original.length,1);
 const nutrition=(f.w.definitions[original[0].definition].data.nutrition as Record<string,number>).meal;
 const plain=structuredClone(f.w);stepWorld(plain,1);const rows=stepWorldWithFoodEvidence(f.w,1).familyJourneyMeals!;
 assert.deepEqual(f.w,plain);assert.equal(rows.length,3);
 const shared=rows.filter(r=>r.providerId===f.parent.id),independent=rows.filter(r=>r.providerId===f.owner.id);
 assert.equal(shared.length,2);assert.equal(independent.length,1);
 for(const row of shared){assert.equal(row.inputs[0].nutrition,null);assert.equal(row.inputs[0].lots,null);assert.ok(row.hungerRelief>0);}
 assert.equal(independent[0].providerPortion,0);assert.equal(independent[0].beneficiaryId,f.owner.id);assert.equal(independent[0].inputs[0].nutrition,nutrition);
 assert.deepEqual(independent[0].inputs[0].lots,[{...original[0],quantity:1,nutrition}]);
 assert.equal(f.parent.inventory.meal,38);assert.equal(f.owner.inventory.meal,39);
});

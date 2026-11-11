import assert from 'node:assert/strict';
import {test} from 'node:test';
import {seedFlowFixture,seedChoices,queueSeedFlow,submitSeedActions,finishSeedFlow,seedReceipts,reloadSeed} from './helpers/food-flow-seed.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {completeProduction} from '../src/world/production.js';
import {foodTransaction,initializeFood} from '../src/world/food.js';
import {goods} from '../src/shared/items.js';
import {craftFlowFixture,runCraftFlow,craftReceipts} from './helpers/food-flow-craft.js';
import {employmentFlowFixture,queueEmploymentFlow,finishEmploymentAction,employmentReceipts} from './helpers/food-flow-employment.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';

// Food classification is the existing physical item catalogue, not hunger relief.
test('numbered saveSeed completes turnip to nonfood seed exactly once, preserves original lots and resumes SQLite',()=>{
 const {w,r}=seedFlowFixture(),original=structuredClone(w.food!.lots['person:'+r.id].turnip!),plan=queueSeedFlow(w,r);
 assert.equal(goods.turnip.food,20);assert.equal(goods.turnip.life,14);assert.equal(goods.seed.food,0);assert.equal(goods.seed.life,0);
 const observations=[stepWorldWithFoodEvidence(w,5)];assert.ok(r.activity);assert.deepEqual(seedReceipts(observations),[]);assert.equal(r.inventory.turnip,1);assert.equal(r.inventory.seed,3);
 const boundDefinition=r.activity.definition,life=structuredClone(w.definitions['food/life@1']);life.version=88;life.data={...life.data,nutrition:{turnip:999}};w.definitions['food/life@88']=life;w.activeDefinitions['food/life']='food/life@88';
 const loaded=reloadSeed(w),actor=loaded.residents.find(a=>a.id===r.id)!;observations.push(...finishSeedFlow(loaded,actor));
 const flows=seedReceipts(observations);assert.equal(flows.length,1);const f=flows[0];assert.deepEqual(checkedFoodFlow(f),f);
 assert.equal(f.type,'processed');assert.equal(f.planId,plan.id);assert.equal(f.residentId,r.id);assert.equal(f.container,'person:'+r.id);assert.equal(f.definition,boundDefinition);assert.equal(loaded.events.find(e=>e.id===f.eventId)!.at,f.at);
 assert.deepEqual(f.inputs,[{item:'turnip',quantity:1,nutrition:20,lots:original.map(l=>({...l,nutrition:20*l.quantity}))}]);
 assert.deepEqual(f.outputs,[{item:'seed',quantity:2,nutrition:0,lots:[]}]);assert.equal(actor.inventory.turnip,0);assert.equal(actor.inventory.seed,5);assert.equal(loaded.production!.seedSaved,2);
 assert.ok(observations.every(o=>o.foodFlowCoverage===FOOD_FLOW_COVERAGE));assert.deepEqual(observations.flatMap(o=>o.receipts),[]);assert.equal(observations.flatMap(o=>o.foodFlows??[]).length,1);
 assert.equal(loaded.food!.lots['person:'+r.id]?.seed,undefined);const before=structuredClone(loaded);assert.ok(submitPlan(loaded,plan).ok);assert.deepEqual(loaded,before);
 const resumed=reloadSeed(loaded);assert.deepEqual(stepWorldWithFoodEvidence(resumed,2).foodFlows,[]);assert.equal(JSON.stringify(resumed).includes('foodFlowCoverage'),false);
});

test('saveSeed follows earliest-expiry fractional original inputs without refreshing food or deriving nutrition',()=>{
 const {w,r}=seedFlowFixture();r.inventory.turnip=2;
 w.definitions['food/seed-original@1']={id:'food/seed-original',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:7}}};
 const late={quantity:1.6,producedAt:400,expiresAt:2000,definition:'food/life@1'},early={quantity:.4,producedAt:450,expiresAt:1000,definition:'food/seed-original@1'};
 w.food!.lots['person:'+r.id].turnip=structuredClone([late,early]);queueSeedFlow(w,r);const f=seedReceipts(finishSeedFlow(w,r))[0];
 assert.equal(f.inputs[0].quantity,1);assert.equal(f.inputs[0].nutrition,14.8);assert.deepEqual(f.inputs[0].lots,[{...early,nutrition:2.8000000000000003},{...late,quantity:.6,nutrition:12}]);
 assert.equal(r.inventory.turnip,1);assert.deepEqual(w.food!.lots['person:'+r.id].turnip,[{...late,quantity:1}]);
});

for(const mode of ['missing','short','surplus','invalid-definition','future','unknown-nutrition','zero-nutrition'] as const)test(`saveSeed original batch ${mode} stays conservative at actual completion`,()=>{
 const {w,r}=seedFlowFixture();queueSeedFlow(w,r);while(r.activity?.remaining!==1)stepWorld(w,1);
 const ledger=w.food!.lots['person:'+r.id];if(mode==='missing')delete ledger.turnip;
 else if(mode==='short')ledger.turnip![0].quantity=.5;else if(mode==='surplus')ledger.turnip![0].quantity=2;
 else if(mode==='invalid-definition')ledger.turnip![0].definition='private invalid definition';else if(mode==='future')ledger.turnip![0].producedAt=w.minute+100;
 else {ledger.turnip![0].definition='food/unknown-seed@1';if(mode==='zero-nutrition')w.definitions['food/unknown-seed@1']={id:'food/unknown-seed',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:0}}};}
 const disabled=structuredClone(w),observations=finishSeedFlow(w,r);while(disabled.residents[0].plan||disabled.residents[0].activity)stepWorld(disabled,1);assert.deepEqual(w,disabled);
 const f=seedReceipts(observations)[0];assert.equal(f.inputs[0].quantity,1);assert.equal(f.inputs[0].nutrition,mode==='zero-nutrition'?0:null);
 if(mode==='unknown-nutrition'||mode==='zero-nutrition')assert.ok(f.inputs[0].lots?.length);else assert.equal(f.inputs[0].lots,null);
 assert.deepEqual(checkedFoodFlow(f),f);assert.equal(r.inventory.seed,5);
});

test('insufficient starting material and stale accepted menu never create seed conversion evidence',()=>{
 const {w,r}=seedFlowFixture(),action=seedChoices(w,r).find(c=>c.action.type==='production'&&c.action.operation==='saveSeed')!.action;
 r.inventory.turnip=0;initializeFood(w);assert.ok(!seedChoices(w,r).some(c=>c.action.type==='production'&&c.action.operation==='saveSeed'));
 submitSeedActions(w,r,[action]);const observations=finishSeedFlow(w,r,false);assert.ok(r.lastFailure);assert.deepEqual(seedReceipts(observations),[]);assert.equal(r.inventory.seed,3);
});
for(const mode of ['spoilage','competing-debit'] as const)test(`saveSeed ${mode} before completion produces no conversion`,()=>{
 const {w,r}=seedFlowFixture();queueSeedFlow(w,r);stepWorld(w,3);assert.ok(r.activity);
 if(mode==='spoilage')w.food!.lots['person:'+r.id].turnip![0].expiresAt=w.minute+1;
 else foodTransaction(w,()=>{r.inventory.turnip=0;});
 const observations=finishSeedFlow(w,r,false);assert.ok(r.lastFailure);assert.deepEqual(seedReceipts(observations),[]);assert.equal(r.inventory.seed,3);assert.equal(w.production!.seedSaved,0);
 if(mode==='spoilage')assert.equal(observations.flatMap(o=>o.foodLosses??[]).filter(l=>l.container==='person:'+r.id&&l.amount.item==='turnip').reduce((n,l)=>n+l.amount.quantity,0),1);
});

test('two saveSeed actions in one plan use independent completion events, never plan deduplication',()=>{
 const {w,r}=seedFlowFixture();r.inventory.turnip=2;initializeFood(w);const a=seedChoices(w,r).find(c=>c.action.type==='production'&&c.action.operation==='saveSeed')!.action;
 const plan=submitSeedActions(w,r,[a,structuredClone(a)]),flows=seedReceipts(finishSeedFlow(w,r));assert.equal(flows.length,2);assert.ok(flows.every(f=>f.planId===plan.id));assert.equal(new Set(flows.map(f=>f.eventId)).size,2);assert.equal(r.inventory.seed,7);
});

test('prediction copies, decision inspection and default-off stepping cannot create or alter saveSeed evidence',()=>{
 const {w,r}=seedFlowFixture();queueSeedFlow(w,r);const before=structuredClone(w);
 assert.deepEqual(captureDirectEating(w,()=>{seedChoices(w,r);hasTimelySelfRescue(w,r,[{type:'eat',item:'turnip'}]);const forecast=copyForSimulation(w);finishSeedFlow(forecast,forecast.residents[0]);}).foodFlows,[]);assert.deepEqual(w,before);
 const disabled=structuredClone(w),seen=finishSeedFlow(w,r);while(disabled.residents[0].plan||disabled.residents[0].activity)stepWorld(disabled,1);assert.equal(seedReceipts(seen).length,1);assert.deepEqual(w,disabled);
});

test('direct completion without a real finished activity is not promoted to saveSeed evidence',()=>{
 const {w,r}=seedFlowFixture();const o=captureDirectEating(w,()=>assert.equal(completeProduction(w,r,{type:'production',operation:'saveSeed'}),null));
 assert.equal(r.inventory.seed,5);assert.deepEqual(o.foodFlows,[]);
});

test('craft food-to-fodder and employment seedkeeper retain their own conversions without direct saveSeed duplication',()=>{
 const craft=craftFlowFixture('fodder'),craftSeen=runCraftFlow(craft.w,craft.r,'fodder');assert.equal(craftReceipts(craftSeen).length,1);assert.deepEqual(seedReceipts(craftSeen),[]);
 const employment=employmentFlowFixture(undefined,'seedkeeper');queueEmploymentFlow(employment,15);const employmentSeen=finishEmploymentAction(employment.w,employment.worker);assert.equal(employmentReceipts(employmentSeen).length,1);assert.deepEqual(seedReceipts(employmentSeen),[]);
});

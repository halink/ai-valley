import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,stepWorldWithFoodEvidence,hasTimelySelfRescue} from '../src/world/engine.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {advanceFood,initializeFood} from '../src/world/food.js';
import {advanceIndustry} from '../src/world/industry.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {DAY} from '../src/world/time.js';
import {growthFlowFixture,queueGrowthCollection,finishGrowthCollection} from './helpers/food-flow-growth.js';

function growth(f= growthFlowFixture()){
 const observation=stepWorldWithFoodEvidence(f.w,1);
 assert.equal(observation.foodFlowCoverage,FOOD_FLOW_COVERAGE);return {...f,observation,flows:observation.foodFlows!};
}
test('real midnight generates fruit and four edible livestock products without inventing a resident action or world event',()=>{
 const {w,r,tree,animals,flows,observation}=growth();
 assert.equal(observation.fromMinute,DAY-1);assert.equal(observation.toMinute,DAY);assert.equal(flows.length,5);
 assert.deepEqual(flows.map(f=>f.action),['fruit_growth',...Array(4).fill('animal_product')]);
 assert.equal(tree.fruit,1);assert.ok(animals.every(a=>a.product===1));
 for(const f of flows){
  assert.equal(f.type,'source_added');assert.equal(f.residentId,null);assert.equal(f.eventId,null);assert.equal(f.planId,null);
  assert.ok('ownerId' in f&&f.ownerId===r.id);assert.equal(f.definition,'industry/processes@1');assert.equal(f.at,DAY);
  assert.equal(f.outputs.length,1);assert.equal(f.outputs[0].quantity,1);
  assert.deepEqual(f.outputs[0].lots!.map(({nutrition,...lot})=>lot),w.food!.lots[f.container][f.outputs[0].item]);
  assert.equal(f.outputs[0].lots![0].producedAt,DAY);assert.ok(f.outputs[0].lots![0].expiresAt>DAY);
 }
 assert.deepEqual(flows.map(f=>[f.action==='animal_product'?f.species:null,f.outputs[0].item]),[[null,'fruit'],['chicken','egg'],['duck','duckEgg'],['goat','milk'],['cow','milk']]);
 assert.deepEqual(captureDirectEating(w,()=>advanceIndustry(w)).foodFlows,[],'same-minute reentry creates no new operation');
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
 assert.equal(w.industry!.totals.fruit,0);assert.equal(w.industry!.totals.animalProducts,0,'existing collection counters are not generation counters');
});

test('actual final menu fruit picking and animal collection only transfer original generated lots',()=>{
 for(const kind of ['fruit','chicken','duck','goat','cow'] as const){
  const fixture=growthFlowFixture();
  if(kind!=='fruit')fixture.w.industry!.animals=fixture.animals.filter(a=>a.kind===kind);
  const f=growth(fixture),{w,r,tree,animals}=f;
  const source=kind==='fruit'?tree:animals.find(a=>a.kind===kind)!,container=(kind==='fruit'?'orchard-stock:':'animal-stock:')+source.id;
  const item=kind==='fruit'?'fruit':kind==='chicken'?'egg':kind==='duck'?'duckEgg':'milk';
  const original=structuredClone(w.food!.lots[container][item]);const opening=r.inventory[item]??0;
  r.at={...(kind==='fruit'?tree.at:f.barn.door)};r.inside=null;r.roomAt=null;
  queueGrowthCollection(w,r,kind==='fruit'?'harvestFruit':'collectAnimal',source.id);
  assert.deepEqual(finishGrowthCollection(w,r),[],'collection must not double-count generation');
  assert.equal(r.inventory[item],opening+1);assert.deepEqual(w.food!.lots['person:'+r.id][item]!.filter(l=>l.producedAt===DAY),original);
  assert.equal(kind==='fruit'?tree.fruit:animals.find(a=>a.id===source.id)!.product,0);
  assert.equal(w.food!.lots[container],undefined);
 }
});

test('preexisting stocks, old missing lots, owner visibility and range entry never become output receipts',()=>{
 const f=growthFlowFixture(),{w,r,tree,animals}=f;
 tree.fruit=6;tree.fruitProgress=0;for(const a of animals){a.product=2;a.progress=0;}
 initializeFood(w);delete w.food!.lots['orchard-stock:'+tree.id];
 const observed=captureDirectEating(w,()=>{initializeFood(w);r.at={...tree.at};decisionContext(w,r);});
 assert.deepEqual(observed.foodFlows,[]);assert.equal(tree.fruit,6);
 const step=stepWorldWithFoodEvidence(w,1);assert.deepEqual(step.foodFlows,[]);
});

test('new growth reads the exact created batch and never counts old same-item lots or substitutes current nutrition',()=>{
 const f=growthFlowFixture(),{w,tree,animals}=f;tree.fruit=3;animals[0].product=2;initializeFood(w);
 const oldFruit=structuredClone(w.food!.lots['orchard-stock:'+tree.id].fruit),oldEgg=structuredClone(w.food!.lots['animal-stock:'+animals[0].id].egg);
 const old=w.definitions['food/life@1'];w.definitions['food/life@97']={...old,version:97,data:{...old.data,nutrition:{fruit:7,egg:11}}};w.activeDefinitions['food/life']='food/life@97';
 const {flows}=growth(f);
 assert.equal(flows[0].outputs[0].nutrition,7);assert.equal(flows[1].outputs[0].nutrition,11);
 for(const flow of flows){assert.equal(flow.outputs[0].lots![0].definition,'food/life@97');assert.equal(flow.outputs[0].quantity,1);}
 assert.equal(flows.find(f=>f.outputs[0].item==='milk')!.outputs[0].nutrition,null);
 assert.deepEqual(w.food!.lots['orchard-stock:'+tree.id].fruit![0],oldFruit![0]);assert.deepEqual(w.food!.lots['animal-stock:'+animals[0].id].egg![0],oldEgg![0]);
});

test('capacity, immature/male/dry/nonlactating/dead conditions and wool do not invent edible production',()=>{
 for(const reason of ['capacity','dry','immature','male','dead','nonlactating'] as const){
  const f=growthFlowFixture(),{w,tree,animals}=f;
  if(reason==='capacity'){tree.fruit=12;for(const a of animals)a.product=4;}
  else if(reason==='dry'){w.weather='sun';tree.lastWateredDay=-1;for(const a of animals)a.thirst=90;}
  else{tree.status='cut';for(const a of animals){
   if(reason==='immature')a.bornAt=w.minute;
   if(reason==='male')a.sex='male';
   if(reason==='dead'){a.status='dead';a.deathAt=w.minute;}
   if(reason==='nonlactating'){a.kind='cow';a.lactatesUntil=w.minute;}
  }}
  initializeFood(w);assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[],reason);
 }
});

test('expiry frees real source capacity before new growth; spoiled original units are not new production',()=>{
 const f=growthFlowFixture(),{w,tree,animals}=f;tree.fruit=12;for(const a of animals)a.product=4;initializeFood(w);
 for(const [container,ledger]of Object.entries(w.food!.lots))if(container.startsWith('orchard-stock:')||container.startsWith('animal-stock:'))for(const lots of Object.values(ledger))for(const lot of lots!)lot.expiresAt=DAY;
 const {flows}=growth(f);assert.equal(flows.length,5);assert.ok(flows.every(f=>f.outputs[0].quantity===1));
 assert.equal(w.food!.spoiled.fruit,12);assert.equal(w.food!.spoiled.egg,4);assert.equal(w.food!.spoiled.duckEgg,4);assert.equal(w.food!.spoiled.milk,8);
 assert.equal(tree.fruit,1);assert.equal(animals.at(-1)!.product,4,'wool is not perishable food');
 assert.deepEqual(captureDirectEating(w,()=>advanceFood(w)).foodFlows,[]);
});

test('observation does not change world, decisions or forecasts, and failed capture is cleaned up',()=>{
 const f=growthFlowFixture(),{w,r}=f,plain=copyForSimulation(w),prediction=copyForSimulation(w),original=structuredClone(w);
 assert.deepEqual(captureDirectEating(w,()=>{advanceIndustry(prediction);stepWorld(prediction,1);hasTimelySelfRescue(w,r,[{type:'eat',item:'turnip'}]);}).foodFlows,[]);
 assert.deepEqual(w,original);
 assert.throws(()=>captureDirectEating(w,()=>{throw new Error('synthetic capture failure');}),/synthetic capture failure/);
 const observed=stepWorldWithFoodEvidence(w,1);stepWorld(plain,1);assert.equal(observed.foodFlows!.length,5);assert.deepEqual(w,plain);
 assert.deepEqual(decisionContext(w,r),decisionContext(plain,plain.residents.find(x=>x.id===r.id)!));
 assert.doesNotMatch(JSON.stringify(w),/"(?:foodFlows|foodFlowCoverage|observedReceipts)"\s*:/);
});

test('pre-generation SQLite reload retains original process binding and completed reload cannot replay growth',()=>{
 const {w}=growthFlowFixture();const store=new WorldStore(':memory:');try{
  const old=w.definitions['industry/processes@1'];w.definitions['industry/processes@97']={...old,version:97,data:{...old.data,treeFruitDays:5,chickenProductDays:5}};w.activeDefinitions['industry/processes']='industry/processes@97';
  store.commit(w,null);const reloaded=store.load(true)!,revision=reloaded.revision;
  const first=stepWorldWithFoodEvidence(reloaded,1);assert.equal(first.foodFlows!.length,5);assert.ok(first.foodFlows!.every(f=>f.definition==='industry/processes@1'));
  store.commit(reloaded,revision);const completed=store.load(true)!;
  assert.deepEqual(captureDirectEating(completed,()=>advanceIndustry(completed)).foodFlows,[]);assert.deepEqual(stepWorldWithFoodEvidence(completed,1).foodFlows,[]);
 }finally{store.close();}
});

test('real midnight daily evidence records growth in its preceding interval and leaves all-world production unknown',()=>{
 const f=growthFlowFixture(),daily=createIsolationEvidence(f.w),result=growth(f);
 const day=daily.sample(f.w,result.observation)!;assert.equal(day.calendarDay,0);assert.equal(day.foodFlows.receipts.length,5);
 assert.deepEqual(day.foodFlows.totals!.sourceAdded.units,{fruit:1,egg:1,duckEgg:1,milk:2});assert.equal(day.foodProduction.value,null);assert.equal(day.foodConsumption.value,null);
 assert.equal(daily.sample(f.w,result.observation),null);
 const next=stepWorldWithFoodEvidence(f.w,1);daily.sample(f.w,next);assert.deepEqual(daily.finish(f.w)!.foodFlows.totals!.sourceAdded.units,{});
});

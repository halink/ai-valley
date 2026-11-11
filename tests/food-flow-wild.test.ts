import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {decisionContext} from '../src/server/decisions.js';
import type {FoodFlowReceipt} from '../src/world/food-consumption-evidence.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,hasTimelySelfRescue} from '../src/world/engine.js';
import {advanceFishing,fishingKey,waterAtShore,wildFishAt} from '../src/world/fishing.js';
import {initializeFood} from '../src/world/food.js';
import {completeIndustry} from '../src/world/industry.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {walkable} from '../src/world/navigation.js';
import {DAY} from '../src/world/time.js';
import {wildFlowFixture,prepareHunt,flowMenuAction,queueWildFlow,finishWildFlows} from './helpers/food-flow-wild.js';

function source(rows:FoodFlowReceipt[],action:'fish'|'hunt'){
 assert.equal(rows.length,1);const row=rows[0];assert.equal(row.type,'source_added');assert.equal(row.action,action);
 if(row.type!=='source_added'||row.action!==action)throw new Error('wrong source');return row;
}

test('final numbered fishing menu yields one actual species from the adjacent-water shoal and retains old generic fish lots',()=>{
 const {w,fisher:r,shore,pool}=wildFlowFixture(),container='person:'+r.id;
 r.inventory.fish=2;initializeFood(w);const old=structuredClone(w.food!.lots[container].fish);
 const action=flowMenuAction(w,r,'fish'),species=action.fishSpecies!;
 const count=pool.species![species]!.amount,all=pool.amount,rod=w.industry!.tools.find(t=>t.ownerId===r.id&&t.kind==='rod')!,wear=rod.durability;
 const before=r.inventory[species]??0;queueWildFlow(w,r,action);
 const first=stepWorldWithFoodEvidence(w,1);assert.equal(first.foodFlowCoverage,FOOD_FLOW_COVERAGE);assert.deepEqual(first.foodFlows,[]);
 const row=source(finishWildFlows(w,[r]),'fish');
 assert.equal(row.sourceId,'shoal:'+fishingKey(waterAtShore(w,shore)!));assert.equal(row.species,species);
 assert.equal(row.definition,pool.definition);assert.equal(row.container,container);
 assert.equal(r.inventory[species],before+1);assert.equal(pool.amount,all-1);assert.equal(pool.species![species]!.amount,count-1);assert.equal(pool.species![species]!.caught,1);
 assert.equal(rod.durability,wear-1);assert.equal(row.outputs[0].quantity,1);assert.equal(row.outputs[0].item,species);
 assert.deepEqual(row.outputs[0].lots,w.food!.lots[container][species]!.filter(l=>l.producedAt===row.at).map(l=>({...l,nutrition:16})));
 assert.equal(row.outputs[0].nutrition,16);assert.deepEqual(w.food!.lots[container].fish,old);assert.equal(r.inventory.fish,2);
 const event=w.events.find(e=>e.id===row.eventId)!;assert.deepEqual(event.animalIds,[row.sourceId]);assert.equal(event.at,row.at);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
});

test('hunting wounds are not production; only actual kill adds raw meat with its original zero-nutrition perishable batch',()=>{
 const {w,hunter:r,beast}=wildFlowFixture();prepareHunt(w,r,beast);
 r.inventory.gameMeat=2;initializeFood(w);const container='person:'+r.id,old=structuredClone(w.food!.lots[container].gameMeat);
 const spear=w.industry!.tools.find(t=>t.ownerId===r.id&&t.kind==='spear')!;
 queueWildFlow(w,r,flowMenuAction(w,r,'hunt',beast.id));assert.deepEqual(finishWildFlows(w,[r]),[]);
 assert.equal(r.lastFailure,null);assert.equal(beast.status,'alive');assert.ok(beast.health<55);assert.equal(spear.durability,9);assert.equal(r.inventory.gameMeat,2);
 const action=flowMenuAction(w,r,'hunt',beast.id);queueWildFlow(w,r,action);const row=source(finishWildFlows(w,[r]),'hunt');
 assert.equal(row.sourceId,beast.id);assert.equal(row.species,beast.species);assert.equal(row.definition,action.processDefinition);
 assert.equal(beast.status,'dead');assert.equal(beast.deathCause,'hunted');assert.equal(r.inventory.gameMeat,7);assert.equal(spear.durability,8);
 assert.deepEqual(row.outputs,[{item:'gameMeat',quantity:5,nutrition:0,lots:[{quantity:5,producedAt:row.at,expiresAt:row.at+2*DAY,definition:'food/life/game-meat@1',nutrition:0}]}]);
 assert.deepEqual(w.food!.lots[container].gameMeat![0],old![0]);assert.equal(w.industry!.totals.gameMeat,5);
 assert.deepEqual(w.events.find(e=>e.id===row.eventId)!.animalIds,[beast.id]);
 assert.deepEqual(captureDirectEating(w,()=>{assert.ok(completeIndustry(w,r,action));}).foodFlows,[]);
});

test('fish depletion, exhausted tool and fleeing prey emit no successful raw-source evidence',()=>{
 for(const failure of ['depleted','tool','flee'] as const){
  const {w,fisher,hunter,beast,pool}=wildFlowFixture(),r=failure==='flee'?hunter:fisher;
  if(failure==='flee')prepareHunt(w,r,beast);
  const action=flowMenuAction(w,r,failure==='flee'?'hunt':'fish',failure==='flee'?beast.id:undefined);queueWildFlow(w,r,action);
  assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
  if(failure==='depleted'){pool.amount-=pool.species![action.fishSpecies!]!.amount;pool.species![action.fishSpecies!]!.amount=0;}
  if(failure==='tool')w.industry!.tools.find(t=>t.kind==='rod'&&t.ownerId===r.id)!.durability=0;
  if(failure==='flee'){
   const at=beast.at,away=[{x:at.x+5,y:at.y},{x:at.x-5,y:at.y},{x:at.x,y:at.y+5}].find(p=>walkable(w,p));assert.ok(away);beast.at=away;
  }
  assert.deepEqual(finishWildFlows(w,[r]),[]);assert.ok(r.lastFailure);assert.equal(r.inventory.gameMeat??0,0);
 }
});

test('two residents competing for the last same-species fish publish only the one real catch',()=>{
 const {w,fisher:r,shore,pool}=wildFlowFixture(),other=w.residents.find(x=>x.id!==r.id&&x.canDecide)!;
 r.at={...shore};other.at={...shore};other.inside=null;other.roomAt=null;other.skills.farming=r.skills.farming;
 w.industry!.fishingExperience![other.id]=w.industry!.fishingExperience![r.id]??0;
 w.industry!.tools.push({id:'other-flow-rod',ownerId:other.id,kind:'rod',level:1,durability:30,maxDurability:30});
 const a=flowMenuAction(w,r,'fish'),species=a.fishSpecies!;for(const s of Object.values(pool.species!))s!.amount=0;pool.species![species]!.amount=1;pool.amount=1;
 const b=flowMenuAction(w,other,'fish');assert.equal(b.fishSpecies,species);queueWildFlow(w,r,a);queueWildFlow(w,other,b);
 const rows=finishWildFlows(w,[r,other]);assert.equal(rows.length,1);assert.equal(rows[0].action,'fish');
 assert.equal((r.inventory[species]??0)+(other.inventory[species]??0),1);assert.equal(pool.amount,0);assert.equal(pool.species![species]!.caught,1);
 assert.equal([r,other].filter(p=>p.lastFailure).length,1);
});

test('two hunters cannot turn the same animal into two source additions',()=>{
 const {w,hunter:r,beast}=wildFlowFixture(),other=w.residents.find(x=>x.id!==r.id&&x.canDecide)!;
 prepareHunt(w,r,beast);prepareHunt(w,other,beast);beast.health=35;
 queueWildFlow(w,r,flowMenuAction(w,r,'hunt',beast.id));queueWildFlow(w,other,flowMenuAction(w,other,'hunt',beast.id));
 const row=source(finishWildFlows(w,[r,other]),'hunt');assert.equal(row.sourceId,beast.id);
 assert.equal((r.inventory.gameMeat??0)+(other.inventory.gameMeat??0),5);assert.equal(w.frontierHazards!.totals.hunted,1);
 assert.equal([r,other].filter(p=>p.lastFailure).length,1);
});

test('natural fish renewal, wild duck predation, migration initialization and entering range are not human food production',()=>{
 const {w,fisher:r,shore,pool}=wildFlowFixture();
 const before=pool.amount;assert.ok(wildFishAt(w,shore));assert.equal(pool.amount,before-1);
 pool.species!.carp!.progress=.9999;pool.speciesLastMinute=w.minute-5;
 const born=pool.species!.carp!.born;
 const observation=captureDirectEating(w,()=>{advanceFishing(w);r.at={...shore};decisionContext(w,r);});
 assert.ok(pool.species!.carp!.born>born);assert.deepEqual(observation.foodFlows,[]);
 const predation=captureDirectEating(w,()=>{pool.shoal!.at={...pool.shoal!.anchor};wildFishAt(w,shore);});assert.deepEqual(predation.foodFlows,[]);
 const old=copyForSimulation(w);for(const p of Object.values(old.industry!.fishing))delete p.species;
 assert.deepEqual(captureDirectEating(old,()=>advanceFishing(old)).foodFlows,[]);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
});

test('fish and hunt observation preserves enabled/disabled state and does not leak predictive-copy receipts',()=>{
 for(const operation of ['fish','hunt'] as const){
  const {w,fisher,hunter,beast}=wildFlowFixture(),r=operation==='fish'?fisher:hunter;
  if(operation==='hunt'){prepareHunt(w,r,beast);beast.health=30;}
  const action=flowMenuAction(w,r,operation,operation==='hunt'?beast.id:undefined);queueWildFlow(w,r,action);
  const plain=copyForSimulation(w),forecast=copyForSimulation(w);const before=structuredClone(w);
  assert.deepEqual(captureDirectEating(w,()=>{finishWildFlows(forecast,[forecast.residents.find(p=>p.id===r.id)!]);hasTimelySelfRescue(w,r,[action]);}).foodFlows,[]);
  assert.deepEqual(w,before);
  let count=0;while(r.activity||r.plan){count+=stepWorldWithFoodEvidence(w,1).foodFlows!.length;stepWorld(plain,1);}
  assert.equal(count,1);assert.deepEqual(w,plain);assert.deepEqual(decisionContext(w,r),decisionContext(plain,plain.residents.find(p=>p.id===r.id)!));
 }
});

test('mid-action SQLite save resumes one original fish/hunt addition and completed reload never replays it',()=>{
 for(const operation of ['fish','hunt'] as const){
  const fixture=wildFlowFixture();let w=fixture.w;const r=operation==='fish'?fixture.fisher:fixture.hunter;
  if(operation==='hunt'){prepareHunt(w,r,fixture.beast);fixture.beast.health=30;}
  queueWildFlow(w,r,flowMenuAction(w,r,operation,operation==='hunt'?fixture.beast.id:undefined));stepWorldWithFoodEvidence(w,2);
  const store=new WorldStore(':memory:');try{
   store.commit(w,null);w=store.load(true)!;const actor=w.residents.find(p=>p.id===r.id)!;const revision=w.revision;
   const row=source(finishWildFlows(w,[actor]),operation);assert.ok(row.outputs[0].lots?.length);
   store.commit(w,revision);w=store.load(true)!;assert.equal(JSON.stringify(w).includes('foodFlowCoverage'),false);assert.equal(JSON.stringify(w).includes('foodFlows'),false);
   assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
  }finally{store.close();}
 }
});

test('missing current output nutrition remains unknown for real raw-meat and species lots without substituting generic fish',()=>{
 for(const operation of ['fish','hunt'] as const){
  const {w,fisher,hunter,beast}=wildFlowFixture(),r=operation==='fish'?fisher:hunter;
  if(operation==='hunt'){prepareHunt(w,r,beast);beast.health=30;}
  const action=flowMenuAction(w,r,operation,operation==='hunt'?beast.id:undefined),item=operation==='fish'?action.fishSpecies!:'gameMeat';
  const old=w.definitions['food/life@1'];w.definitions['food/life@97']={...old,version:97,data:{...old.data,days:{...old.data.days as object,[item]:2},nutrition:{}}};w.activeDefinitions['food/life']='food/life@97';
  queueWildFlow(w,r,action);const row=source(finishWildFlows(w,[r]),operation);assert.equal(row.outputs[0].nutrition,null);assert.equal(row.outputs[0].lots![0].definition,'food/life@97');assert.equal(row.outputs[0].lots![0].nutrition,null);
 }
});

test('daily evidence sums actual fish and kill additions once, then a legacy marker gap preserves facts but clears totals',()=>{
 const {w,fisher,hunter,beast}=wildFlowFixture();prepareHunt(w,hunter,beast);beast.health=30;
 const daily=createIsolationEvidence(w),fish=flowMenuAction(w,fisher,'fish'),species=fish.fishSpecies!;
 queueWildFlow(w,fisher,fish);queueWildFlow(w,hunter,flowMenuAction(w,hunter,'hunt',beast.id));
 let left=500;while([fisher,hunter].some(r=>r.activity||r.plan)){
  assert.ok(left--);const observation=stepWorldWithFoodEvidence(w,1);daily.sample(w,observation);assert.equal(daily.sample(w,observation),null);
 }
 const row=daily.finish(w)!;assert.equal(row.foodFlows.receipts.length,2);
 assert.equal(new Set(row.foodFlows.receipts.map(r=>r.eventId)).size,2);
 assert.deepEqual(row.foodFlows.totals!.sourceAdded,{units:{gameMeat:5,[species]:1},nutrition:16});
 assert.deepEqual(row.foodFlows.totals!.processingInputs.units,{});assert.deepEqual(row.foodFlows.totals!.processingOutputs.units,{});
 assert.equal(row.foodProduction.value,null);assert.equal(row.foodConsumption.value,null);
 const legacy=stepWorldWithFoodEvidence(w,1);delete legacy.foodFlowCoverage;daily.sample(w,legacy);
 assert.equal(daily.finish(w)!.foodFlows.totals,null);assert.equal(daily.finish(w)!.foodFlows.receipts.length,2);assert.equal(daily.finish(w)!.foodFlows.unobservedMinutes,1);
});

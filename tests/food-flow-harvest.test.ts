import assert from 'node:assert/strict';
import {test} from 'node:test';
import {houseHarvestFixture,custodyHarvestFixture,queueHarvest,finishHarvest,harvestReceipts,reloadHarvest,harvestChoice,submitHarvest} from './helpers/food-flow-harvest.js';
import {captureDirectEating,FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {decisionContext,decisionChoices} from '../src/server/decisions.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {estateParcel} from '../src/world/estate-custody.js';

for(const kind of ['house','custody'] as const)test(`${kind} numbered harvest records actual source, original crop, fresh output and exactly one completion after SQLite continuation`,()=>{
 const f=kind==='house'?houseHarvestFixture():custodyHarvestFixture(),{w,r}=f,plan=queueHarvest(f);
 const observations=[stepWorldWithFoodEvidence(w,5)];assert.deepEqual(harvestReceipts(observations),[]);assert.ok(r.activity);
 const replacement=structuredClone(w.definitions['crop/turnip@2']);replacement.version=99;replacement.data={...replacement.data,yield:999,output:'grain'};w.definitions['crop/turnip@99']=replacement;w.activeDefinitions['crop/turnip']='crop/turnip@99';
 const life=structuredClone(w.definitions['food/life@1']);life.version=99;life.data={...life.data,nutrition:{turnip:7}};w.definitions['food/life@99']=life;w.activeDefinitions['food/life']='food/life@99';
 const loaded=reloadHarvest(w),actor=loaded.residents.find(p=>p.id===r.id)!;observations.push(...finishHarvest(loaded,actor));
 const flows=harvestReceipts(observations);assert.equal(flows.length,1);const flow=flows[0];assert.equal(flow.type,'source_added');assert.equal(flow.definition,'crop/turnip@2');assert.equal(flow.residentId,r.id);assert.equal(flow.planId,plan.id);assert.equal(loaded.events.find(e=>e.id===flow.eventId)!.at,flow.at);
 assert.equal(flow.outputs.length,1);assert.equal(flow.outputs[0].item,'turnip');assert.equal(flow.outputs[0].quantity,12);assert.equal(flow.outputs[0].nutrition,84);
 assert.ok(flow.outputs[0].lots?.length);for(const lot of flow.outputs[0].lots!){assert.equal(lot.producedAt,flow.at);assert.ok(lot.expiresAt>flow.at);assert.equal(lot.definition,'food/life@99');}
 assert.deepEqual(flow.outputs[0].lots!.map(({nutrition,...lot})=>lot),loaded.food!.lots[flow.container].turnip);
 if(flow.action==='harvest_house'&&'bed' in f){assert.equal(flow.sourceId,f.bed.id);assert.equal(flow.buildingId,f.home.id);assert.equal(flow.bed,0);assert.equal(flow.ownerId,r.id);assert.equal(flow.container,'person:'+r.id);assert.equal(actor.inventory.turnip,12);assert.equal(loaded.industry!.beds[0].crop,null);}
 else if(flow.action==='custody_harvest'&&'c' in f){assert.equal(flow.sourceId,f.plot.id);assert.equal(flow.custodyId,f.c.id);assert.equal(flow.estateOwnerId,f.dead.id);assert.equal(flow.beneficiaryId,f.child.id);assert.equal(flow.shareId,f.share.id);assert.equal(flow.workSerial,0);assert.equal(flow.container,`custody-stock:${f.c.id}:0`);assert.equal(estateParcel(loaded,flow.container)!.inventory.turnip,12);assert.equal(actor.inventory.turnip??0,0);assert.equal(loaded.plots[0].crop,null);}else assert.fail('wrong source receipt variant');
 assert.ok(observations.every(o=>o.foodFlowCoverage===FOOD_FLOW_COVERAGE));assert.equal(observations.flatMap(o=>o.foodFlows??[]).filter(x=>x.action==='harvest').length,0);
 const before=structuredClone(loaded);assert.ok(submitPlan(loaded,plan).ok);assert.deepEqual(loaded,before);assert.deepEqual(stepWorldWithFoodEvidence(reloadHarvest(loaded),1).foodFlows,[]);
});

for(const change of ['ownership','immature','permission'] as const)test(`greenhouse ${change} race rejects accepted final-menu action without food evidence`,()=>{
 const f=houseHarvestFixture(),{w,r,bed}=f;queueHarvest(f);stepWorld(w,3);assert.ok(r.activity);
 if(change==='ownership')bed.crop!.ownerId=w.residents[1].id;else if(change==='immature')bed.crop!.growth=0;else r.knownBuildings=r.knownBuildings.filter(id=>id!==f.home.id);
 assert.deepEqual(harvestReceipts(finishHarvest(w,r,false)),[]);assert.ok(r.lastFailure);assert.ok(bed.crop);assert.equal(r.inventory.turnip??0,0);
});
for(const change of ['ownership','immature','withdrawn'] as const)test(`protected custody ${change} prevents a queued physical harvest and receipt`,()=>{
 const f=custodyHarvestFixture(),{w,r,plot}=f;queueHarvest(f);stepWorld(w,3);assert.ok(r.activity);
 if(change==='ownership')plot.ownerId=f.child.id;else if(change==='immature')plot.crop!.growth=0;else {submitHarvest(w,f.child,harvestChoice(w,f.child,'custodyObject'));assert.deepEqual(harvestReceipts(finishHarvest(w,f.child)),[]);}
 assert.deepEqual(harvestReceipts(finishHarvest(w,r,false)),[]);assert.ok(r.lastFailure);assert.ok(plot.crop);assert.equal(f.c.workSerial,0);assert.equal(f.c.records.length,0);
});

for(const fixture of [houseHarvestFixture,custodyHarvestFixture])test(`${fixture.name} prediction and observer-off execution leave identical physical worlds`,()=>{
 const f=fixture(),{w,r}=f;queueHarvest(f);const before=structuredClone(w);
 assert.deepEqual(captureDirectEating(w,()=>{decisionChoices(decisionContext(w,r));hasTimelySelfRescue(w,r,[{type:'eat',item:'meal'}]);const prediction=copyForSimulation(w);for(let n=0;n<30;n++)stepWorld(prediction,1);}).foodFlows,[]);assert.deepEqual(w,before);
 const disabled=structuredClone(w),actor=disabled.residents.find(p=>p.id===r.id)!;const seen=finishHarvest(w,r);while(actor.plan||actor.activity)stepWorld(disabled,1);assert.equal(harvestReceipts(seen).length,1);assert.deepEqual(w,disabled);
});

test('greenhouse sowing and tending consume inputs but never count as source production',()=>{
 const f=houseHarvestFixture(),{w,r,bed}=f;bed.crop=null;
 for(const operation of ['plantHouse','tendHouse']){submitHarvest(w,r,harvestChoice(w,r,operation,a=>a.type==='industry'&&a.bed===0));const observations=finishHarvest(w,r);assert.deepEqual(harvestReceipts(observations),[]);assert.deepEqual(observations.flatMap(o=>o.foodFlows??[]),[]);}assert.ok(bed.crop);assert.equal(r.inventory.turnip??0,0);
});

test('custody harvest sale and purchase transfer existing crop without a second source receipt',()=>{
 const f=custodyHarvestFixture(),{w,r,buyer}=f;queueHarvest(f);assert.equal(harvestReceipts(finishHarvest(w,r)).length,1);
 submitHarvest(w,r,harvestChoice(w,r,'custodySell'));assert.deepEqual(harvestReceipts(finishHarvest(w,r)),[]);const sale=w.production!.protectedCustody!.sales[0],parcel=estateParcel(w,sale.parcelId)!;buyer.at={...parcel.location.at};
 submitHarvest(w,buyer,harvestChoice(w,buyer,'custodyBuy'));assert.deepEqual(harvestReceipts(finishHarvest(w,buyer)),[]);assert.equal(buyer.inventory.turnip,12);assert.equal(parcel.inventory.turnip,0);assert.equal(f.c.workSerial,2);
});

for(const fixture of [houseHarvestFixture,custodyHarvestFixture])test(`${fixture.name} food classification is independent of known-zero or missing nutrition; nonfood output is excluded`,()=>{
 for(const nutrition of [0,undefined]){const f=fixture(),{w,r}=f;const life=structuredClone(w.definitions['food/life@1']);life.version=77;life.data={...life.data,nutrition:nutrition===undefined?{}:{turnip:nutrition}};w.definitions['food/life@77']=life;w.activeDefinitions['food/life']='food/life@77';queueHarvest(f);const flow=harvestReceipts(finishHarvest(w,r))[0];assert.equal(flow.outputs[0].quantity,12);assert.equal(flow.outputs[0].nutrition,nutrition===undefined?null:0);assert.ok(flow.outputs[0].lots?.length);}
 for(const output of ['fiber','herb','fodder'] as const){const f=fixture(),{w,r}=f;const crop=structuredClone(w.definitions['crop/turnip@2']);crop.version=88;crop.data={...crop.data,output};w.definitions['crop/synthetic-nonfood@88']=crop;if('bed' in f)f.bed.crop!.definition='crop/synthetic-nonfood@88';else f.plot.crop!.definition='crop/synthetic-nonfood@88';queueHarvest(f);const observations=finishHarvest(w,r);assert.deepEqual(harvestReceipts(observations),[]);if('bed' in f)assert.equal(r.inventory[output],12);else assert.equal(estateParcel(w,`custody-stock:${f.c.id}:0`)!.inventory[output],12);}
});

test('stale final-menu harvest competing with completed work cannot duplicate source output',()=>{
 for(const fixture of [houseHarvestFixture,custodyHarvestFixture]){const f=fixture(),{w,r}=f,action=harvestChoice(w,r,'bed' in f?'harvestHouse':'custodyHarvest');queueHarvest(f);assert.equal(harvestReceipts(finishHarvest(w,r)).length,1);submitHarvest(w,r,action);assert.deepEqual(harvestReceipts(finishHarvest(w,r,false)),[]);assert.ok(r.lastFailure);if('bed' in f)assert.equal(r.inventory.turnip,12);else {assert.equal(f.c.workSerial,1);assert.equal(estateParcel(w,`custody-stock:${f.c.id}:0`)!.inventory.turnip,12);}}
});

test('ordinary animal collection only transfers existing products and does not record harvest production',async()=>{
 const {initializeFood}=await import('../src/world/food.js'),{atWorkstation}=await import('./helpers/workspaces.js');
 const {w,r,home}=houseHarvestFixture();home.kind='barn';home.definition='building/barn@1';w.industry!.beds=[];
 const goat={id:'harvest-evidence-goat',ownerId:r.id,kind:'goat' as const,sex:'female' as const,bornAt:w.minute-100*1440,barnId:home.id,pen:0,hunger:40,thirst:70,health:100,status:'alive' as const,deathAt:null,product:2,progress:0,pregnancy:null,lastMinute:w.minute};w.industry!.animals.push(goat);r.inside=null;r.roomAt=null;
 initializeFood(w);const original=structuredClone(w.food!.lots['animal-stock:'+goat.id].milk);atWorkstation(w,r,{type:'industry',operation:'collectAnimal',buildingId:home.id,animalId:goat.id});
 submitHarvest(w,r,harvestChoice(w,r,'collectAnimal'));const observations=finishHarvest(w,r);assert.deepEqual(observations.flatMap(o=>o.foodFlows??[]),[]);assert.equal(r.inventory.milk,2);assert.equal(goat.product,0);assert.deepEqual(w.food!.lots['person:'+r.id].milk,original);
});

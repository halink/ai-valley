import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Inventory,Resident,World} from '../src/shared/types.js';
import type {Livestock,OrchardTree} from '../src/shared/industry.js';
import {createWorld} from '../src/world/seed.js';
import {recordDeath} from '../src/world/life.js';
import {initializeEconomy} from '../src/world/economy.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeFood,foodTransaction} from '../src/world/food.js';
import {estateParcels} from '../src/world/estate-custody.js';
import {initializeProduction,prepareShares,productionTarget,completeProduction,advanceProduction} from '../src/world/production.js';
import {captureDirectEating,FOOD_OWNERSHIP_COVERAGE,type FoodOwnershipStock} from '../src/world/food-consumption-evidence.js';
import {inheritedFoodOwnership} from '../src/world/food-ownership-evidence.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {GLM_MODEL} from '../src/server/model-completion.js';
import {YEAR} from '../src/world/time.js';

// Independent fixture: no production evidence helper is used to construct expectations.
function fixture(singleHeir=false){
 const w=createWorld();w.mode='formal';w.minute=600;w.clock.paused=false;w.resources=[];
 const [parent,heir,coheir]=w.residents,home=w.buildings.find(b=>b.id===parent.homeId)!;
 for(const p of w.residents){
  p.at={...home.door};p.inside=null;p.roomAt=null;p.parents=[];p.adoptiveParents=[];p.relations=[];p.guardianIds=[];p.pregnancy=null;
  p.bornAt=w.minute-30*YEAR;p.inventory={};p.coins=0;p.hunger=0;p.energy=p.health=100;p.plan=null;p.activity=null;
  p.canDecide=p.canExpress=true;p.knownPeople=w.residents.map(r=>r.id);p.knownBuildings=w.buildings.map(b=>b.id);
 }
 heir.parents=[parent.id];if(!singleHeir)coheir.parents=[parent.id];coheir.bornAt=w.minute-10*YEAR;
 parent.inventory={meal:7,wood:3};parent.coins=20;
 initializeEconomy(w);initializeProduction(w);initializeIndustry(w);
 w.industry!.trees=[];w.industry!.animals=[];w.industry!.tools=[];
 initializeFood(w);recordDeath(w,parent);
 return {w,parent,heir,coheir};
}
function action(id:string){return {type:'production' as const,operation:'inherit' as const,personId:id};}
function complete(w:World,heir:Resident,id:string){
 const a=action(id),route=productionTarget(w,heir,a);assert.equal(route.error,undefined);
 heir.at={...route.target};heir.inside=null;heir.roomAt=null;
 return completeProduction(w,heir,a);
}
function split(f:ReturnType<typeof fixture>){
 foodTransaction(f.w,()=>prepareShares(f.w,f.parent.id));
 const share=f.w.production!.inheritances[f.parent.id].shares.find(s=>s.heirId===f.heir.id)!;
 const parcel=estateParcels(f.w).find(p=>share.goodsClaims!.includes(p.id))!;
 return {share,parcel};
}
function observerRead(w:World,read:(capture:NonNullable<ReturnType<typeof inheritedFoodOwnership>>)=>void){
 let stocks:FoodOwnershipStock[]=[];
 const result=captureDirectEating(w,()=>{const capture=inheritedFoodOwnership(w,'review-heir')!;read(capture);stocks=capture.stocks;});
 assert.deepEqual(result.foodOwnershipChanges,[],'sampling alone is not an inheritance event');
 return stocks;
}
function tree(ownerId:string,id='review-tree',fruit=3):OrchardTree{return {id,ownerId,plotId:'review-plot',at:{x:1,y:1},plantedAt:0,growth:1,lastWateredDay:0,lastMinute:600,fruit,fruitProgress:0,status:'mature'};}
function animal(ownerId:string,kind:Livestock['kind'],product=2):Livestock{return {id:'review-'+kind,ownerId,kind,sex:'female',bornAt:0,barnId:'review-barn',hunger:0,thirst:0,health:100,status:'alive',deathAt:null,product,progress:0,pregnancy:null,lastMinute:600};}

function unknownOrigins(stocks:FoodOwnershipStock[]){
 for(const stock of stocks)for(const amount of stock.amounts){assert.equal(amount.lots,null);assert.equal(amount.nutrition,null);}
}

test('independent review: first split observes physical ownership only and preserves every world and original-lot fact',()=>{
 const f=fixture(),control=structuredClone(f.w),originalLots=structuredClone(f.w.food!.lots['estate:'+f.parent.id].meal);
 const observation=captureDirectEating(f.w,()=>assert.equal(complete(f.w,f.heir,f.parent.id),null));
 assert.equal(complete(control,control.residents.find(r=>r.id===f.heir.id)!,f.parent.id),null);
 assert.deepEqual(f.w,control,'enabling observation must not change the completed world, including knowledge and permission state');
 assert.equal(observation.foodOwnershipCoverage,FOOD_OWNERSHIP_COVERAGE);
 assert.equal(observation.foodOwnershipChanges!.length,1);
 const receipt=observation.foodOwnershipChanges![0],stock=receipt.stocks.find(s=>s.containerType==='estate-stock')!;
 assert.equal(receipt.estatePersonId,f.parent.id);assert.equal(receipt.heirId,f.heir.id);
 assert.equal(receipt.shareId,f.w.production!.inheritances[f.parent.id].shares.find(s=>s.heirId===f.heir.id)!.id);
 assert.ok(f.w.events.some(e=>e.id===receipt.eventId&&e.kind==='action'));
 assert.equal(stock.fromOwnerId,f.parent.id);assert.equal(stock.toOwnerId,f.heir.id);assert.equal(stock.ambiguous,false);
 assert.deepEqual(stock.amounts,[{item:'meal',quantity:4,nutrition:null,lots:null}]);
 const lots=estateParcels(f.w).flatMap(p=>f.w.food!.lots[p.id]?.meal??[]);
 assert.equal(lots.reduce((n,l)=>n+l.quantity,0),7);
 assert.ok(lots.every(l=>l.producedAt===originalLots![0].producedAt&&l.expiresAt===originalLots![0].expiresAt&&l.definition===originalLots![0].definition));
 assert.equal(f.heir.inventory.meal??0,0);unknownOrigins(receipt.stocks);
 assert.deepEqual(observation.receipts,[]);assert.deepEqual(observation.foodFlows,[]);assert.deepEqual(observation.foodTransfers,[]);
});

test('independent review: actual preexisting parcel owner is recorded instead of the estate ancestor',()=>{
 const f=fixture(),{parcel}=split(f);parcel.ownerId='outside-owner';
 const beforeLocation=structuredClone(parcel.location),beforeInventory=structuredClone(parcel.inventory),beforeLots=structuredClone(f.w.food!.lots[parcel.id]);
 const observation=captureDirectEating(f.w,()=>assert.equal(complete(f.w,f.heir,f.parent.id),null));
 const stock=observation.foodOwnershipChanges![0].stocks.find(s=>s.container===parcel.id)!;
 assert.equal(stock.fromOwnerId,'outside-owner');assert.equal(stock.toOwnerId,f.heir.id);assert.equal(stock.amounts[0].quantity,4);
 assert.equal(parcel.ownerId,f.heir.id);assert.deepEqual(parcel.location,beforeLocation);assert.deepEqual(parcel.inventory,beforeInventory);
 assert.deepEqual(f.w.food!.lots[parcel.id],beforeLots);unknownOrigins([stock]);
});

test('independent review: a successful share with no actual food owner changes has one empty receipt; replay has none',()=>{
 const f=fixture(),{parcel}=split(f);parcel.ownerId=f.heir.id;
 const first=captureDirectEating(f.w,()=>assert.equal(complete(f.w,f.heir,f.parent.id),null));
 assert.equal(first.foodOwnershipChanges!.length,1);assert.deepEqual(first.foodOwnershipChanges![0].stocks,[]);
 const replay=captureDirectEating(f.w,()=>assert.ok(completeProduction(f.w,f.heir,action(f.parent.id))));
 assert.deepEqual(replay.foodOwnershipChanges,[]);
});

test('independent review: duplicate parcel IDs collapse to one unknown holding and never add their quantities',()=>{
 const f=fixture(),{parcel}=split(f),copy=structuredClone(parcel);copy.ownerId='other-actual-owner';copy.inventory={meal:90,fruit:3};
 f.w.estates.find(e=>e.personId===f.parent.id)!.parcels!.push(copy);
 const observed=captureDirectEating(f.w,()=>assert.equal(complete(f.w,f.heir,f.parent.id),null));
 const stocks=observed.foodOwnershipChanges![0].stocks.filter(s=>s.container===parcel.id);
 assert.equal(stocks.length,1);assert.equal(stocks[0].ambiguous,true);assert.equal(stocks[0].fromOwnerId,null);
 assert.deepEqual(new Set(stocks[0].amounts.map(a=>a.item)),new Set(['meal','fruit']));
 assert.ok(stocks[0].amounts.every(a=>a.quantity===null));unknownOrigins(stocks);
});

test('independent review: same-object inventory aliases remain unknown even when both recorded quantities agree',()=>{
 const f=fixture(),{parcel}=split(f);f.coheir.inventory=parcel.inventory;
 const before=structuredClone(f.w),stocks=observerRead(f.w,c=>c.parcel(parcel));
 assert.deepEqual(f.w,before);assert.equal(f.coheir.inventory,parcel.inventory);
 assert.equal(stocks.length,1);assert.equal(stocks[0].ambiguous,true);assert.equal(stocks[0].amounts[0].quantity,null);
});

test('independent review: duplicate orchard identities and repeated object references cannot prove stock quantity',()=>{
 const f=fixture(),first=tree(f.parent.id),collision={...first,status:'cut' as const,fruit:0};
 f.w.industry!.trees=[first,collision];
 const stocks=observerRead(f.w,c=>c.industry(first,'orchard-stock'));
 assert.equal(stocks[0].ambiguous,true);assert.equal(stocks[0].amounts[0].quantity,null);
 f.w.industry!.trees=[first,first];
 const repeated=observerRead(f.w,c=>{c.industry(first,'orchard-stock');c.industry(first,'orchard-stock');});
 assert.equal(repeated.length,1);assert.equal(repeated[0].amounts[0].quantity,null);
});

test('independent review: invalid scalar amounts are unknown, positive fractions remain exact, and zero is absent',()=>{
 const f=fixture(),{parcel}=split(f);
 for(const value of [NaN,Infinity,-1,'4',undefined]){
  parcel.inventory={meal:value} as Inventory;
  const stocks=observerRead(f.w,c=>c.parcel(parcel));
  assert.deepEqual(stocks[0].amounts,[{item:'meal',quantity:null,nutrition:null,lots:null}]);
 }
 parcel.inventory={meal:.25,fruit:0,wood:100};
 assert.deepEqual(observerRead(f.w,c=>c.parcel(parcel))[0].amounts,[{item:'meal',quantity:.25,nutrition:null,lots:null}]);
 parcel.inventory={meal:0};assert.deepEqual(observerRead(f.w,c=>c.parcel(parcel)),[]);
});

test('independent review: read-only sampling never invokes inventory getters or repairs missing food history',()=>{
 const f=fixture(),{parcel}=split(f);let reads=0;
 parcel.inventory={};Object.defineProperty(parcel.inventory,'meal',{enumerable:true,get(){reads++;return 100;}});
 delete f.w.food;const before=Object.getOwnPropertyDescriptors(parcel.inventory),keys=Reflect.ownKeys(f.w);
 const stock=observerRead(f.w,c=>c.parcel(parcel))[0];
 assert.equal(reads,0);assert.deepEqual(Object.getOwnPropertyDescriptors(parcel.inventory),before);
 assert.equal(f.w.food,undefined);assert.deepEqual(Reflect.ownKeys(f.w),keys);assert.equal(stock.amounts[0].quantity,null);
 assert.equal(inheritedFoodOwnership(f.w,f.heir.id),undefined,'capture is disabled outside the observation wrapper');
});

test('independent review: all edible industry products are classified at the real owner assignment and sheep wool is excluded',()=>{
 const f=fixture(true);
 const fruit=tree(f.parent.id);f.w.industry!.trees=[fruit];
 f.w.industry!.animals=['chicken','duck','goat','cow','sheep'].map(k=>animal(f.parent.id,k as Livestock['kind']));
 initializeFood(f.w);
 const observation=captureDirectEating(f.w,()=>assert.equal(complete(f.w,f.heir,f.parent.id),null));
 const stocks=observation.foodOwnershipChanges![0].stocks;
 assert.deepEqual(stocks.filter(s=>s.containerType!=='estate-stock').map(s=>[s.container,s.amounts[0].item,s.amounts[0].quantity]),[
  ['orchard-stock:review-tree','fruit',3],['animal-stock:review-chicken','egg',2],['animal-stock:review-duck','duckEgg',2],['animal-stock:review-goat','milk',2],['animal-stock:review-cow','milk',2],
 ]);
 assert.ok(stocks.every(s=>s.fromOwnerId===f.parent.id&&s.toOwnerId===f.heir.id));
 assert.ok(f.w.industry!.animals.every(a=>a.ownerId===f.heir.id));unknownOrigins(stocks);
});

test('independent review: unauthorized and insolvent claims emit no ownership receipts',()=>{
 const f=fixture(),outsider=f.coheir;
 const denied=captureDirectEating(f.w,()=>assert.ok(completeProduction(f.w,outsider,action(f.parent.id))));assert.deepEqual(denied.foodOwnershipChanges,[]);
 const {share,parcel}=split(f);f.w.estates.find(e=>e.personId===f.parent.id)!.coins=0;assert.ok(share.coins>0);
 const failed=captureDirectEating(f.w,()=>assert.ok(complete(f.w,f.heir,f.parent.id)));assert.deepEqual(failed.foodOwnershipChanges,[]);assert.equal(parcel.ownerId,f.parent.id);
});

test('independent review: successor redistribution is not acceptance and only the later actual successor claim emits',()=>{
 const f=fixture();assert.equal(complete(f.w,f.heir,f.parent.id),null);
 const first=structuredClone(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt!==null)!);
 recordDeath(f.w,f.coheir);
 const redistribution=captureDirectEating(f.w,()=>advanceProduction(f.w));assert.deepEqual(redistribution.foodOwnershipChanges,[]);
 const next=f.w.production!.inheritances[f.parent.id].shares.find(s=>s.claimedAt===null)!;assert.equal(next.heirId,f.heir.id);
 const observed=captureDirectEating(f.w,()=>assert.equal(complete(f.w,f.heir,f.parent.id),null));
 assert.equal(observed.foodOwnershipChanges!.length,1);assert.equal(observed.foodOwnershipChanges![0].shareId,next.id);
 assert.ok(observed.foodOwnershipChanges![0].stocks.every(s=>s.fromOwnerId===f.parent.id));
 assert.deepEqual(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.id===first.id),first);
});

test('independent review: final numbered menu and real engine completion preserve enabled/disabled world equality',()=>{
 const f=fixture();decisionContext(f.w,f.heir);const before=structuredClone(f.w);
 let chosen:ReturnType<typeof parseChoice>|undefined;
 const preview=captureDirectEating(f.w,()=>{
  const prepared=prepareModelDecision(decisionContext(f.w,f.heir),undefined,GLM_MODEL);
  const option=prepared.choices.find(c=>c.action.type==='production'&&c.action.operation==='inherit'&&c.action.personId===f.parent.id);
  assert.ok(option);assert.match(option.id,/^\d+$/);chosen=parseChoice(JSON.stringify({choice:option.id}),prepared.choices);
 });
 assert.deepEqual(f.w,before);assert.deepEqual(preview.foodOwnershipChanges,[]);
 assert.equal(submitPlan(f.w,{id:'review-numbered-inherit',actorId:f.heir.id,actorRevision:f.heir.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],...chosen!}).ok,true);
 const control=structuredClone(f.w),controlHeir=control.residents.find(r=>r.id===f.heir.id)!;
 const observed=captureDirectEating(f.w,()=>{let i=0;while(f.heir.plan||f.heir.activity){assert.ok(i++<80);stepWorld(f.w,1);}});
 let i=0;while(controlHeir.plan||controlHeir.activity){assert.ok(i++<80);stepWorld(control,1);}
 assert.deepEqual(f.w,control);assert.equal(f.heir.lastFailure,null);
 assert.equal(observed.foodOwnershipChanges!.length,1);assert.equal(observed.foodOwnershipChanges![0].planId,'review-numbered-inherit');
 assert.equal(f.w.metrics.requests,0);
});

test('independent review: inheritance completed in a prediction copy cannot leak into the real-world observation',()=>{
 const f=fixture(),prepared=prepareModelDecision(decisionContext(f.w,f.heir),undefined,GLM_MODEL);
 const option=prepared.choices.find(c=>c.action.type==='production'&&c.action.operation==='inherit'&&c.action.personId===f.parent.id)!;
 assert.ok(option);const parsed=parseChoice(JSON.stringify({choice:option.id}),prepared.choices);
 assert.equal(submitPlan(f.w,{id:'review-prediction-inherit',actorId:f.heir.id,actorRevision:f.heir.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],...parsed}).ok,true);
 const before=structuredClone(f.w),prediction=structuredClone(f.w),predictedHeir=prediction.residents.find(r=>r.id===f.heir.id)!;
 assert.equal(prediction.id,f.w.id,'a prediction deliberately retains the real world ID');
 const observed=captureDirectEating(f.w,()=>{
  const simulated=captureDirectEating(prediction,()=>{let i=0;while(predictedHeir.plan||predictedHeir.activity){assert.ok(i++<80);stepWorld(prediction,1);}});
  assert.equal(simulated.foodOwnershipChanges!.length,1);
  assert.equal(simulated.foodOwnershipChanges![0].heirId,f.heir.id);
  assert.ok(estateParcels(prediction).some(p=>p.ownerId===f.heir.id));
 });
 assert.deepEqual(observed.foodOwnershipChanges,[]);assert.deepEqual(f.w,before);
 assert.equal(f.w.production!.inheritances[f.parent.id],undefined);
 assert.notDeepEqual(prediction,f.w);
});

test('independent review: a failed observation releases its capture and cannot leak a completed receipt into a later slice',()=>{
 const f=fixture();
 assert.throws(()=>captureDirectEating(f.w,()=>{assert.equal(complete(f.w,f.heir,f.parent.id),null);throw Error('synthetic post-action failure');}),/synthetic post-action failure/);
 // The capture does not roll back world actions. Runtime durability owns rollback/publication.
 assert.notEqual(f.w.production!.inheritances[f.parent.id].shares.find(s=>s.heirId===f.heir.id)!.claimedAt,null);
 assert.equal(inheritedFoodOwnership(f.w,f.heir.id),undefined);
 assert.deepEqual(captureDirectEating(f.w,()=>{}).foodOwnershipChanges,[]);
});

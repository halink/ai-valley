import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeEconomy} from '../src/world/economy.js';
import {initializeMigration} from '../src/world/migration.js';
import {advanceFood,initializeFood,foodTransaction,foodContainers} from '../src/world/food.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {growthFlowFixture} from './helpers/food-flow-growth.js';
import {DAY} from '../src/world/time.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 for(const r of w.residents){r.inventory={};r.hunger=0;r.energy=r.health=100;}
 initializeEconomy(w);initializeFood(w);
 return {w,r:w.residents[0],id:'person:'+w.residents[0].id};
}
function observe(w:ReturnType<typeof fixture>['w']){return captureDirectEating(w,()=>advanceFood(w));}

test('independent spoilage review: exact expiry, fractional mixed historical lots and repeated advance',()=>{
 const {w,r,id}=fixture();r.inventory.meal=4;initializeFood(w);
 w.definitions['food/life@90']={...w.definitions['food/life@1'],version:90,data:{nutrition:{meal:13}}};
 w.food!.lots[id].meal=[{quantity:.75,producedAt:w.minute-10,expiresAt:w.minute+1,definition:'food/life@90'},
  {quantity:1.25,producedAt:w.minute-5,expiresAt:w.minute+1,definition:'food/life@1'},
  {quantity:2,producedAt:w.minute,expiresAt:w.minute+2,definition:'food/life@1'}];
 assert.deepEqual(observe(w).foodLosses,[]);w.minute++;
 const o=observe(w);assert.equal(o.foodLossCoverage,'advance_food_spoilage_v1');assert.equal(o.foodLosses!.length,1);
 const loss=o.foodLosses![0];assert.equal(loss.container,id);assert.equal(loss.cause,'spoilage');assert.equal(loss.type,'loss');
 assert.equal(loss.amount.quantity,2);assert.equal(loss.amount.nutrition,.75*13+1.25*42);
 assert.deepEqual(loss.amount.lots!.map(l=>l.quantity),[.75,1.25]);assert.equal(r.inventory.meal,2);
 assert.deepEqual(observe(w).foodLosses,[]);const reload=JSON.parse(JSON.stringify(w));assert.deepEqual(observe(reload).foodLosses,[]);
 reload.minute++;assert.equal(observe(reload).foodLosses![0].amount.quantity,2);assert.equal(reload.food.spoiled.meal,4);
});

test('independent spoilage review: missing historical nutrition stays unknown, never current goods fallback',()=>{
 const {w,r,id}=fixture();r.inventory.meal=1;initializeFood(w);
 w.food!.lots[id].meal![0].definition='food/missing-history@9';w.minute=w.food!.lots[id].meal![0].expiresAt;
 const loss=observe(w).foodLosses![0];assert.equal(loss.amount.quantity,1);assert.equal(loss.amount.nutrition,null);
 assert.equal(loss.amount.lots![0].nutrition,null);assert.equal(loss.amount.lots![0].definition,'food/missing-history@9');
});

test('independent spoilage review: direct initializer repair cannot manufacture original lots',()=>{
 const {w,r,id}=fixture();r.inventory.meal=2;delete w.food!.lots[id];
 const d=structuredClone(w.definitions['food/life@1']);(d.data.days as Record<string,number>).meal=0;
 w.definitions['food/life@91']={...d,version:91};w.activeDefinitions['food/life']='food/life@91';
 const loss=observe(w).foodLosses![0];assert.equal(r.inventory.meal,0);assert.equal(loss.amount.quantity,2);
 assert.equal(loss.amount.lots,null);assert.equal(loss.amount.nutrition,null);
});

test('independent spoilage review: invalid original timestamp cannot certify an expired physical deduction',()=>{
 const {w,r,id}=fixture();r.inventory.meal=2;initializeFood(w);
 const lot=w.food!.lots[id].meal![0];lot.producedAt=lot.expiresAt+10;w.minute=lot.expiresAt;
 const loss=observe(w).foodLosses![0];assert.equal(r.inventory.meal,0);assert.equal(loss.amount.quantity,2);
 assert.equal(loss.amount.lots,null);assert.equal(loss.amount.nutrition,null);
});

test('independent spoilage review: anonymous estate parcels retain full IDs and initialization adds no loss',()=>{
 const {w,r}=fixture();w.estates.push({personId:r.id,inventory:{meal:2},coins:0,status:'protected',heirs:[],parcels:[{
  id:'imported-parcel-1',ownerId:r.id,inventory:{meal:3},location:{at:{x:1,y:1},inside:null,roomAt:null},createdAt:w.minute,source:'old-import',claimId:null}]});
 const setup=captureDirectEating(w,()=>initializeFood(w));assert.deepEqual(setup.foodLosses,[]);
 assert.ok(w.estates[0].location);assert.ok(foodContainers(w).has('imported-parcel-1'));
 w.minute+=3*DAY;const losses=observe(w).foodLosses!;
 assert.deepEqual(losses.map(l=>[l.container,l.amount.quantity]).sort(),[['imported-parcel-1',3],['estate:'+r.id,2]].sort());
 assert.equal(losses.find(l=>l.container==='imported-parcel-1')!.containerType,'estate-stock');
 assert.equal(w.food!.spoiled.meal,5);assert.equal(w.estates[0].parcels![0].inventory.meal,0);
});

test('independent spoilage review: public shelves are physical losses, aggregate treasury is not another loss',()=>{
 const {w}=fixture();w.civic={proposals:[],budgets:[],stores:{clinic:{meal:2}},salesTax:null,nextSerial:1,
  totals:{donations:0,wages:0,procurement:0,repairs:0},reserves:[{id:'reserve',proposalId:'p',buildingId:'b',item:'meal',quantityLimit:3,unitPrice:0,dailyNutrition:42,
   startsAt:w.minute,expiresAt:w.minute+10*DAY,status:'active',supplyAccount:'a',suppliesLimit:0,spent:0,refunded:0,inventory:{meal:3},stocked:3,purchased:0,opened:0,withdrawn:0,receipts:[]}]};
 w.economy!.treasuryStock.meal=5;initializeFood(w);w.minute+=3*DAY;
 const losses=observe(w).foodLosses!;assert.equal(losses.length,2);assert.equal(losses.reduce((s,l)=>s+l.amount.quantity,0),5);
 assert.deepEqual(losses.map(l=>l.container).sort(),['public-reserve:reserve','public:clinic']);assert.equal(w.economy!.treasuryStock.meal,0);
 assert.equal(w.food!.spoiled.meal,5);assert.equal(w.civic.reserves![0].inventory.meal,0);
});

test('independent spoilage review: road contacts are canonical physical containers before arrival',()=>{
 const {w}=fixture();initializeMigration(w);for(const c of w.migration!.contacts)if(c.person)c.person.inventory={};
 const c=w.migration!.contacts[0],p=c.person!;p.inventory.meal=2;initializeFood(w);
 const expiry=w.food!.lots['person:'+c.id].meal![0].expiresAt,revision=p.revision;w.minute=expiry;
 const losses=observe(w).foodLosses!;assert.equal(losses.length,1);assert.equal(losses[0].container,'person:'+c.id);
 assert.equal(losses[0].amount.quantity,2);assert.equal(p.revision,revision+1);assert.equal(p.inventory.meal,0);
 assert.equal(w.residents.some(r=>r.id===p.id),false);assert.deepEqual(observe(w).foodLosses,[]);
});

test('independent spoilage review: transfer retains age but is not a loss; only destination later expires',()=>{
 const {w,r,id}=fixture(),other=w.residents[1];r.inventory.meal=2;initializeFood(w);
 const old=structuredClone(w.food!.lots[id].meal![0]);
 const transfer=captureDirectEating(w,()=>foodTransaction(w,()=>{r.inventory.meal=0;other.inventory.meal=2;}));
 assert.deepEqual(transfer.foodLosses,[]);assert.deepEqual(w.food!.lots['person:'+other.id].meal,[old]);
 w.minute=old.expiresAt;const losses=observe(w).foodLosses!;assert.equal(losses.length,1);assert.equal(losses[0].container,'person:'+other.id);
});

test('independent spoilage review: cloned forecasts and failed captures never leak evidence',()=>{
 const {w,r,id}=fixture();r.inventory.meal=2;initializeFood(w);w.minute=w.food!.lots[id].meal![0].expiresAt;
 const before=structuredClone(w),forecast=captureDirectEating(w,()=>advanceFood(structuredClone(w)));
 assert.deepEqual(forecast.foodLosses,[]);assert.deepEqual(w,before);
 assert.throws(()=>captureDirectEating(w,()=>{advanceFood(w);throw Error('synthetic after-spoilage failure');}),/after-spoilage failure/);
 assert.equal(r.inventory.meal,0);assert.deepEqual(observe(w).foodLosses,[]);
});

test('independent spoilage review: capture does not alter real engine state, no evidence persists on World',()=>{
 const {w,r,id}=fixture();r.inventory.meal=2;initializeFood(w);w.food!.lots[id].meal![0].expiresAt=w.minute+1;
 const plain=structuredClone(w),o=stepWorldWithFoodEvidence(w,1);stepWorld(plain,1);
 assert.deepEqual(w,plain);assert.equal(o.foodLosses!.filter(l=>l.container===id).length,1);
 assert.equal(JSON.stringify(w).includes('foodLosses'),false);assert.equal(JSON.stringify(w).includes('foodLossCoverage'),false);
});

test('independent spoilage review: same tick natural production remains separate from old product spoilage',()=>{
 const {w,tree}=growthFlowFixture();tree.fruit=2;initializeFood(w);
 const id='orchard-stock:'+tree.id;w.food!.lots[id].fruit![0].expiresAt=w.minute+1;
 const o=stepWorldWithFoodEvidence(w,1),loss=o.foodLosses!.filter(l=>l.container===id),source=o.foodFlows!.filter(l=>l.container===id);
 assert.equal(loss.length,1);assert.equal(loss[0].amount.quantity,2);assert.equal(source.length,1);assert.equal(source[0].outputs[0].quantity,1);
 assert.equal(tree.fruit,1);assert.equal(w.food!.lots[id].fruit![0].producedAt,w.minute);
});

test('independent spoilage review: expiring food is removed before scheduled eat completes',()=>{
 const {w,r,id}=fixture();stepWorld(w,1);r.inventory.meal=1;initializeFood(w);
 assert.ok(submitPlan(w,{id:'review-spoil-before-eat',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'Synthetic expiry boundary',actions:[{type:'eat',item:'meal'}]}).ok);
 w.food!.lots[id].meal![0].expiresAt=w.minute+1;
 const o=stepWorldWithFoodEvidence(w,1);assert.equal(o.foodLosses!.find(l=>l.container===id)!.amount.quantity,1);
 assert.deepEqual(o.receipts,[]);assert.equal(r.inventory.meal,0);
 for(let n=0;n<30&&(r.activity||r.plan);n++)assert.deepEqual(stepWorldWithFoodEvidence(w,1).receipts,[]);
 assert.ok(r.lastFailure);
});

test('independent spoilage review: engine pre-loop initialization repair is not original provenance',()=>{
 const {w,r,id}=fixture();stepWorld(w,1);r.inventory.meal=2;delete w.food!.lots[id];
 const d=structuredClone(w.definitions['food/life@1']);(d.data.days as Record<string,number>).meal=0;
 w.definitions['food/life@91']={...d,version:91};w.activeDefinitions['food/life']='food/life@91';
 const loss=stepWorldWithFoodEvidence(w,1).foodLosses!.find(l=>l.container===id)!;
 assert.equal(r.inventory.meal,0);assert.equal(loss.amount.quantity,2);assert.equal(loss.amount.lots,null);assert.equal(loss.amount.nutrition,null);
});

test('independent spoilage review: repaired excess ledger cannot overstate actual physical loss',()=>{
 const {w,r,id}=fixture();r.inventory.meal=5;initializeFood(w);const old=w.food!.lots[id].meal![0];
 r.inventory.meal=2;w.minute=old.expiresAt;
 const loss=observe(w).foodLosses![0];assert.equal(loss.amount.quantity,2);assert.equal(r.inventory.meal,0);
 if(loss.amount.lots!==null)assert.equal(loss.amount.lots.reduce((s,l)=>s+l.quantity,0),2);
});

test('independent spoilage review: actual crated-animal death inside advanceFood is not food spoilage',()=>{
 const {w}=growthFlowFixture(),cargo=w.industry!.livestockCargo!.find(c=>c.status==='crated')!;
 assert.ok(cargo,'synthetic frontier includes actual crated livestock');
 const bag=foodContainers(w).get(cargo.container)!;
 const crates={chicken:'chickCrate',goat:'goatCrate',sheep:'sheepCrate',duck:'duckCrate',cow:'cowCrate'} as const;
 const item=crates[cargo.kind],before=bag[item]!;cargo.health=0;w.minute++;
 const o=observe(w);assert.equal(cargo.status,'dead');assert.equal(bag[item],before-1);assert.deepEqual(o.foodLosses,[]);
});

test('independent spoilage review: two real same-tick deductions have distinct occurrences and detached lots',()=>{
 const {w,r,id}=fixture();r.inventory.meal=2;initializeFood(w);w.minute=w.food!.lots[id].meal![0].expiresAt;
 const original=w.food!.lots[id].meal![0];
 const d=structuredClone(w.definitions['food/life@1']);(d.data.days as Record<string,number>).meal=0;
 w.definitions['food/life@92']={...d,version:92};w.activeDefinitions['food/life']='food/life@92';
 const o=captureDirectEating(w,()=>{advanceFood(w);foodTransaction(w,()=>{r.inventory.meal=1;});advanceFood(w);});
 assert.equal(o.foodLosses!.length,2);assert.deepEqual(o.foodLosses!.map(l=>[l.at,l.container,l.occurrence,l.amount.quantity]),[[w.minute,id,1,2],[w.minute,id,2,1]]);
 assert.equal(o.foodLosses![1].amount.lots![0].definition,'food/life@92');
 original.quantity=999;assert.equal(o.foodLosses![0].amount.lots![0].quantity,2);
 const before=structuredClone(w);o.foodLosses![0].amount.lots![0].quantity=888;assert.deepEqual(w,before);
 assert.deepEqual(observe(w).foodLosses,[]);
});


test('independent spoilage review: extra original-lot fields never enter capture or daily receipts',()=>{
 const {w,r,id}=fixture();r.inventory.meal=2;initializeFood(w);
 const original=w.food!.lots[id].meal![0];original.expiresAt=w.minute+1;
 Object.assign(original,{secretText:'synthetic-private-sentinel',nestedWorld:{residents:[{privateNote:'synthetic-nested-sentinel'}]}});
 let accessorCalls=0;
 Object.defineProperty(original,'unlistedGetter',{enumerable:true,get(){accessorCalls++;throw Error('non-whitelisted lot metadata was read');}});
 const daily=createIsolationEvidence(w);
 const observation=captureDirectEating(w,()=>{w.minute++;advanceFood(w);});
 assert.equal(accessorCalls,0);assert.equal(r.inventory.meal,0);
 const expectedKeys=['quantity','producedAt','expiresAt','definition','nutrition'].sort();
 const loss=observation.foodLosses![0];assert.equal(loss.amount.quantity,2);
 assert.deepEqual(Object.keys(loss.amount.lots![0]).sort(),expectedKeys);
 daily.sample(w,observation);const row=daily.finish(w)!;
 assert.deepEqual(Object.keys(row.foodLosses.receipts[0].amount.lots![0]).sort(),expectedKeys);
 for(const evidence of [observation,row]){
  const serialized=JSON.stringify(evidence);
  for(const forbidden of ['secretText','nestedWorld','privateNote','unlistedGetter','synthetic-private-sentinel','synthetic-nested-sentinel'])assert.equal(serialized.includes(forbidden),false,forbidden);
 }
 assert.equal(accessorCalls,0);
});

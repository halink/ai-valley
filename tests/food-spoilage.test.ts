import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {initializeEconomy} from '../src/world/economy.js';
import {advanceFood,initializeFood,foodContainers} from '../src/world/food.js';
import {captureDirectEating,FOOD_LOSS_CONTAINER_TYPES} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {checkedFoodLoss} from '../src/server/acceptance-evidence-schema.js';
import {DAY} from '../src/world/time.js';
import type {Inventory,World} from '../src/shared/types.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;initializeEconomy(w);
 for(const r of w.residents){r.inventory={};r.hunger=0;r.energy=r.health=100;r.decisionDue=w.minute+10000;}
 initializeFood(w);return {w,r:w.residents[0]};
}

test('every current physical food container category records its own actual debit, never public aggregate',()=>{
 const {w,r}=fixture(),ownerId=r.id;
 const food=():Inventory=>({meal:1});r.inventory=food();
 w.estates=[{personId:'dead',inventory:food(),parcels:[{id:'legacy-parcel',inventory:food(),ownerId,location:{at:r.at,inside:null,roomAt:null}}]}] as any;
 w.culture={events:[{id:'festival',preparation:{held:food()},contributions:[{id:'share',inventory:food()}]}]} as any;
 w.household={pools:[{id:'pool',credits:[{ownerId,inventory:food()}]}],gifts:[{id:'gift',status:'ready',segments:[{ownerId,inventory:food()}]}]} as any;
 w.economy!.businesses=[{id:'shop',inventory:food()}] as any;
 w.economy!.listings=[{id:'sale',side:'sale',status:'open',item:'meal',quantity:1}] as any;
 w.civic={stores:{hall:food()},reserves:[{id:'reserve',inventory:food()}]} as any;
 w.economy!.treasuryStock={meal:2};w.outsideAid={deliveries:[{id:'aid',inventory:food()}]} as any;
 w.foreignTrade={merchants:[],offers:[{id:'offer',item:'meal',stock:1}],shipments:[{id:'shipment',item:'meal',goods:1}]} as any;
 w.industry={trees:[{id:'tree',status:'mature',fruit:1}],animals:[{id:'hen',kind:'chicken',product:1}],livestockCargo:[],
  batches:[{id:'batch',status:'working',input:food(),recipe:{input:{meal:1}},ownerId}],sources:{}} as any;
 w.employment={contracts:[{id:'contract',businessId:'shop',batch:{inventory:food(),output:{meal:1}},recipe:undefined}]} as any;
 initializeFood(w);const containers=foodContainers(w),keys=[...containers].filter(([,bag])=>Object.values(bag).some(n=>n!>0)).map(([id])=>id);assert.equal(keys.length,FOOD_LOSS_CONTAINER_TYPES.length);
 for(const ledger of Object.values(w.food!.lots))for(const lots of Object.values(ledger))for(const lot of lots!)lot.expiresAt=w.minute+1;
 w.minute++;const plain=structuredClone(w),observation=captureDirectEating(w,()=>advanceFood(w));advanceFood(plain);
 assert.deepEqual(w,plain);const losses=observation.foodLosses!;assert.equal(losses.length,18);
 assert.deepEqual(losses.map(l=>l.containerType).sort(),[...FOOD_LOSS_CONTAINER_TYPES].sort());
 assert.deepEqual(losses.map(l=>l.container).sort(),keys.sort());
 for(const loss of losses){assert.equal(loss.amount.quantity,1);assert.deepEqual(checkedFoodLoss(loss),loss);}
 assert.equal(w.economy!.treasuryStock.meal,0);assert.equal(w.food!.spoiled.meal,16);
 assert.equal(w.food!.spoiled.fruit,1);assert.equal(w.food!.spoiled.egg,1);
 assert.equal(w.industry!.batches[0].status,'cancelled');assert.equal(w.employment!.contracts[0].batch,null);
 assert.deepEqual(captureDirectEating(w,()=>advanceFood(w)).foodLosses,[],'cancellation refunds or repeated calls are not another loss');
});

test('legacy aliases cannot record more food than actually removed even when old aggregate counter does',()=>{
 const {w,r}=fixture();r.inventory={meal:2};w.economy!.businesses=[{id:'alias-shop',inventory:r.inventory}] as any;
 initializeFood(w);for(const ledger of Object.values(w.food!.lots))for(const lots of Object.values(ledger))for(const lot of lots!)lot.expiresAt=w.minute+1;
 w.minute++;const o=captureDirectEating(w,()=>advanceFood(w));
 assert.equal(r.inventory.meal,0);assert.equal(o.foodLosses!.length,1);assert.equal(o.foodLosses![0].amount.quantity,2);
 assert.equal(w.food!.spoiled.meal,4,'the observer must not silently change an existing aggregate/rule');
});

function dailyFixture(){
 const {w,r}=fixture();stepWorld(w,1);w.minute=DAY-2;r.inventory.meal=2;initializeFood(w);
 w.food!.lots['person:'+r.id].meal![0].expiresAt=DAY-1;
 return {w,r,daily:createIsolationEvidence(w)};
}
test('real daily rows keep actual spoilage separate from stock deltas and retain null batch nutrition',()=>{
 const {w,r,daily}=dailyFixture();const definition='food/missing-original@1';w.food!.lots['person:'+r.id].meal![0].definition=definition;
 const first=stepWorldWithFoodEvidence(w,1);assert.equal(daily.sample(w,first),null);
 const next=stepWorldWithFoodEvidence(w,1),row=daily.sample(w,next)!;
 assert.equal(row.calendarDay,0);assert.deepEqual(row.foodLosses.totals,{units:{meal:2},nutrition:null});
 assert.equal(row.foodLosses.receipts[0].amount.lots![0].definition,definition);assert.equal(row.foodLosses.observedMinutes,2);
 assert.equal(row.foodProduction.value,null);assert.equal(row.foodConsumption.value,null);assert.deepEqual(row.spoiledUnits,{meal:2});
 assert.equal(daily.sample(w,next),null);daily.sample(w,stepWorldWithFoodEvidence(w,1));
 assert.deepEqual(daily.finish(w)!.foodLosses.totals,{units:{},nutrition:0});
});
test('a missing or legacy daily step keeps loss totals unknown without discarding observed facts',()=>{
 for(const legacy of ['absent','array-without-coverage'] as const){
  const {w,daily}=dailyFixture();const observation=stepWorldWithFoodEvidence(w,1);
  if(legacy==='absent')daily.sample(w);else{delete observation.foodLossCoverage;daily.sample(w,observation);}
  const row=daily.sample(w,stepWorldWithFoodEvidence(w,1))!;
  assert.equal(row.foodLosses.totals,null);assert.equal(row.foodLosses.unobservedMinutes,1);
  assert.equal(row.foodLosses.receipts.length,legacy==='absent'?0:1);
  daily.sample(w,stepWorldWithFoodEvidence(w,1));assert.deepEqual(daily.finish(w)!.foodLosses.totals,{units:{},nutrition:0});
 }
});

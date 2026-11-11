import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {EstateParcel,Inventory,World} from '../src/shared/types.js';
import {roomLayout} from '../src/shared/rooms.js';
import {decisionChoices,decisionContext,prompt} from '../src/server/decisions.js';
import {residentFoodCoverage,settlementFoodCoverage,usableFoodNutrition} from '../src/world/food-coverage.js';
import {initializeFood,foodTransaction} from '../src/world/food.js';
import {initializeEconomy,completeEconomy} from '../src/world/economy.js';
import {initializeHousehold,completeHousehold} from '../src/world/household.js';
import {recordDeath} from '../src/world/life.js';
import {emergencyEstateAllowance,emergencyEstateOptions} from '../src/world/production.js';
import {initializeProduction} from '../src/world/production.js';
import {initializeHealth} from '../src/world/health.js';
import {initializeRooms} from '../src/world/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {DAY,YEAR} from '../src/world/time.js';

function setup(){
 const w=createWorld();w.mode='formal';w.resources=[];w.clock.paused=false;
 const [r,other]=w.residents;
 for(const p of w.residents){p.at={x:34,y:40};p.inside=null;p.roomAt=null;p.inventory={};p.hunger=25;p.energy=p.health=100;p.bornAt=w.minute-30*YEAR;}
 initializeEconomy(w);initializeProduction(w);initializeFood(w);
 return {w,r,other};
}
function parcel(w:World,ownerId:string,inventory:Inventory,at={x:34,y:44}):EstateParcel {
 const p:EstateParcel={id:'coverage-parcel:'+w.estates.length,ownerId,inventory,location:{at,inside:null,roomAt:null,label:'本人原址存货'},createdAt:w.minute,source:'test',claimId:null};
 w.estates.push({personId:'coverage-deceased:'+w.estates.length,inventory:{},coins:0,status:'settled',heirs:[ownerId],parcels:[p]});initializeFood(w);return p;
}
function run(w:World,r:World['residents'][number],action:Parameters<typeof submitPlan>[1]['actions'][0]){
 assert.ok(submitPlan(w,{id:'coverage-test:'+w.revision+':'+r.id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择领取自己的实际口粮',actions:[action]}).ok);
 for(let n=0;n<300&&(r.plan||r.activity);n++)stepWorld(w,1);
 assert.equal(r.lastFailure,null);assert.equal(r.plan,null);assert.equal(r.activity,null);
}

test('nine founders retain at least three verified days each without counting hypothetical replenishment',()=>{
 const w=createFrontierWorld(),before=structuredClone(w),report=settlementFoodCoverage(w);
 assert.equal(report.residents.length,9);assert.equal(report.uniqueNutrition,1542);
 assert.ok(report.stockDays>=3);
 for(const r of report.residents){assert.ok(r.days>=3);assert.equal(r.lowFood,false);assert.equal(r.sourceLabel,null);assert.ok(r.lots.every(l=>l.containerId==='person:'+r.residentId));}
 assert.deepEqual(w,before,'coverage is read-only');
});

test('two-day warning reaches the ordinary model prompt without selecting, replenishing or eating',()=>{
 const {w,r}=setup();r.inventory={meal:1};initializeFood(w);
 const context=decisionContext(w,r),before=structuredClone(w);
 assert.equal(context.formal!.foodCoverage!.lowFood,true);
 assert.ok(prompt(context)[0].content.includes('估算不足两天'));
 assert.ok(decisionChoices(context).some(c=>c.action.type==='eat'&&c.action.item==='meal'));
 assert.deepEqual(w,before);
 const definition=w.definitions['food/life@1'];
 (definition.data.nutrition as Record<string,number>).meal=2*context.formal!.foodCoverage!.dailyNeed;
 w.food!.lots['person:'+r.id].meal![0].expiresAt=w.minute+10*DAY;
 const full=residentFoodCoverage(w,r);assert.equal(full.days,2);assert.equal(full.lowFood,false);
});

test('expiry windows limit usable days and original nutrition versions survive reload',()=>{
 const {w,r}=setup();r.inventory={meal:100};initializeFood(w);
 const lot=w.food!.lots['person:'+r.id].meal![0];lot.expiresAt=w.minute+60;
 const short=residentFoodCoverage(w,r);
 assert.equal(short.reachableNutrition,4200);assert.ok(short.days<1/24);assert.equal(short.lowFood,true);
 const custom=structuredClone(w.definitions['food/life@1']);custom.version=2;(custom.data.nutrition as Record<string,number>).meal=1;
 w.definitions['food/life@2']=custom;w.activeDefinitions['food/life']='food/life@2';
 assert.deepEqual(residentFoodCoverage(JSON.parse(JSON.stringify(w)),JSON.parse(JSON.stringify(r))),short);
 lot.expiresAt=w.minute+5;assert.equal(residentFoodCoverage(w,r).reachableNutrition,0,'expiry at eat completion is too late');
});

test('overlapping release and expiry intervals cannot each claim the same daily consumption',()=>{
 const base={containerId:'a',item:'meal' as const,lotIndex:0,offset:0,quantity:1,nutrition:40,availableAt:50,expiresAt:100};
 assert.equal(usableFoodNutrition([base,{...base,containerId:'b',availableAt:75}],1,0),50);
 assert.equal(usableFoodNutrition([base,{...base,containerId:'b',availableAt:100,expiresAt:150}],1,0),80);
});

test('unknown or inconsistent food ages never acquire invented shelf life on observation',()=>{
 const {w,r}=setup();r.inventory={meal:10};
 const before=structuredClone(w),coverage=residentFoodCoverage(w,r);
 assert.equal(coverage.unknownExpiry,true);assert.equal(coverage.days,0);assert.deepEqual(w,before);
 initializeFood(w);r.inventory.meal=1;
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,42,'physical quantity bounds a stale larger ledger');
});

test('only one reachable owned pickup is counted; other owners, sealed claims and blocked routes stay excluded',()=>{
 const {w,r,other}=setup();r.inventory={berry:1};initializeFood(w);
 const first=parcel(w,r.id,{meal:1}),second=parcel(w,r.id,{meal:2},{x:34,y:46});
 parcel(w,other.id,{meal:100});const reserved=parcel(w,r.id,{meal:100});reserved.claimId='not-yet-owned';
 const coverage=residentFoodCoverage(w,r);
 assert.equal(coverage.reachableNutrition,96);assert.ok(coverage.lots.some(l=>l.containerId===second.id));assert.ok(!coverage.lots.some(l=>l.containerId===first.id));
 for(const p of [first,second])for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])w.map.tiles[(p.location.at.y+dy)*w.map.width+p.location.at.x+dx]='cliff';
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,12);
});

test('indoor travel and collection time are included and normal menus perform the same real pickup',()=>{
 const {w,r}=setup(),home=w.buildings.find(b=>b.id===r.homeId)!;
 const p=parcel(w,r.id,{meal:3},home.door);p.location.inside=home.id;p.location.roomAt=roomLayout(w,home).slots.find(s=>s.key==='table')!.at;
 initializeRooms(w);r.at={...home.door};
 const coverage=residentFoodCoverage(w,r);
 assert.ok(coverage.collectionMinutes!>5);assert.equal(coverage.reachableNutrition,126);
 const choice=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='production'&&c.action.operation==='collectEstate'&&c.action.parcelId===p.id);assert.ok(choice);
 const start=w.minute;run(w,r,choice.action);
 assert.ok(w.minute-start<=coverage.collectionMinutes!,'estimate is no faster than actual one-minute execution');
 assert.equal(r.inventory.meal,3);assert.deepEqual(p.inventory,{});
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,126);
});

test('food that spoils on a pickup route and an immobile resident do not gain reachable reserves',()=>{
 const {w,r}=setup(),p=parcel(w,r.id,{meal:3});
 const minutes=residentFoodCoverage(w,r).collectionMinutes!;
 w.food!.lots[p.id].meal![0].expiresAt=w.minute+minutes+5;
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);
 w.food!.lots[p.id].meal![0].expiresAt=w.minute+DAY;
 w.health={cases:[{id:'injury',personId:r.id,kind:'injury',source:'test',severity:90,stage:'acute',startedAt:w.minute,lastAt:w.minute,resolvedAt:null,treatment:0,capacity:null}],appointments:[],transports:[],transportOffers:[],pulses:[],lastDay:0,nextSerial:1,totals:{injuries:1,illnesses:0,recovered:0,treated:0,paid:0,refunded:0}};
 const before=structuredClone(w);assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);assert.deepEqual(w,before);
});

test('shop reserves require personal ownership and local observation; sale escrow is not also counted',()=>{
 const {w,r,other}=setup(),home=w.buildings.find(b=>b.id===r.homeId)!;r.at={...home.door};r.inventory={meal:6};initializeFood(w);
 assert.equal(completeEconomy(w,r,{type:'economy',operation:'open',buildingId:home.id,name:'本人小铺'}),null);
 const shop=w.economy!.businesses.find(b=>b.ownerId===r.id)!;
 assert.equal(completeEconomy(w,r,{type:'economy',operation:'stock',businessId:shop.id,item:'meal',quantity:6}),null);
 assert.equal(completeEconomy(w,r,{type:'economy',operation:'list',businessId:shop.id,item:'meal',quantity:3,price:1}),null);
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,126);
 other.at={...home.door};assert.equal(residentFoodCoverage(w,other).reachableNutrition,0);
 r.at={x:34,y:50};assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);
});

test('one common pantry retains separate owner shares and public account mirrors never add food',()=>{
 const {w,r,other}=setup(),home=w.buildings.find(b=>b.id===r.homeId)!;
 home.residents.push(other.id);other.homeId=home.id;r.at={...home.door};other.at={...home.door};r.inventory={meal:2};other.inventory={meal:2};initializeHousehold(w);initializeFood(w);
 assert.equal(completeHousehold(w,r,{type:'household',operation:'create',targetId:other.id,buildingId:home.id,name:'共同储物',amount:0,item:'meal',quantity:2}),null);
 const pool=w.household!.pools[0];assert.equal(completeHousehold(w,other,{type:'household',operation:'respond',poolId:pool.id,accept:true}),null);
 w.civic={proposals:[],budgets:[],stores:{lodge:{meal:100}},salesTax:null,nextSerial:1,totals:{donations:0,wages:0,procurement:0,repairs:0}};w.economy!.treasuryStock.meal=100;initializeFood(w);
 const before=structuredClone(w),report=settlementFoodCoverage(w);
 assert.equal(report.uniqueNutrition,168);
 assert.equal(report.residents.find(p=>p.residentId===r.id)!.reachableNutrition,84);
 assert.equal(report.residents.find(p=>p.residentId===other.id)!.reachableNutrition,84);assert.deepEqual(w,before);
});

test('unconsented gifts, future crops, other packs and infants never become autonomous food coverage',()=>{
 const {w,r,other}=setup();other.inventory={meal:100};initializeFood(w);
 w.resources=[{id:'known-berries',kind:'bush',at:{...r.at},amount:100,max:100,regrowthDays:1,lastHarvest:w.minute}];r.knownResources.push('known-berries');
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);
 r.inventory={meal:3};initializeFood(w);r.bornAt=w.minute-YEAR;r.canDecide=false;
 const infant=residentFoodCoverage(w,r);assert.equal(infant.needsCare,true);assert.equal(infant.reachableNutrition,0);assert.equal(infant.lowFood,true);
});

function readyGift(){
 const f=setup(),{w,r,other}=f,to=w.residents[2],home=w.buildings.find(b=>b.id===r.homeId)!;
 home.residents.push(other.id);other.homeId=home.id;
 for(const person of [r,other,to])person.at={...home.door};
 r.inventory={meal:3};other.inventory={meal:3};initializeHousehold(w);initializeFood(w);
 assert.equal(completeHousehold(w,r,{type:'household',operation:'create',targetId:other.id,buildingId:home.id,name:'共同储物',amount:0,item:'meal',quantity:3}),null);
 const pool=w.household!.pools[0];assert.equal(completeHousehold(w,other,{type:'household',operation:'respond',poolId:pool.id,accept:true}),null);
 assert.equal(completeHousehold(w,r,{type:'household',operation:'proposeGift',poolId:pool.id,targetId:to.id,amount:0,item:'meal',quantity:2,ownPercent:50}),null);
 const gift=w.household!.gifts[0];assert.equal(completeHousehold(w,other,{type:'household',operation:'approveGift',giftId:gift.id}),null);
 return {...f,to,home,pool,gift};
}

test('a known ready gift is available only to its recipient, once, until withdrawal or expiry',()=>{
 const {w,r,to,gift}=readyGift();
 assert.equal(residentFoodCoverage(w,to).reachableNutrition,84);
 assert.equal(settlementFoodCoverage(w).uniqueNutrition,252,'escrow was removed from both owners shares, not duplicated');
 to.at={x:34,y:50};assert.equal(residentFoodCoverage(w,to).reachableNutrition,0,'undelivered remote news does not reveal a gift');
 gift.knownBy.push(to.id);assert.equal(residentFoodCoverage(w,to).reachableNutrition,84);
 const original=structuredClone(w);const restored=JSON.parse(JSON.stringify(w)) as World;
 assert.deepEqual(residentFoodCoverage(restored,restored.residents[2]),residentFoodCoverage(w,to));assert.deepEqual(w,original);
 assert.equal(completeHousehold(w,r,{type:'household',operation:'cancelGift',giftId:gift.id}),null);
 assert.equal(residentFoodCoverage(w,to).reachableNutrition,0);
 assert.equal(settlementFoodCoverage(w).uniqueNutrition,252,'cancellation returns originals without a second copy');
});

test('a partially spoiling all-or-nothing gift or fixed-quantity withdrawal is not a promised partial meal',()=>{
 const {w,r,to,gift}=readyGift();
 const minutes=residentFoodCoverage(w,to).collectionMinutes!;
 const first=w.food!.lots['family-gift:'+gift.id+':'+r.id].meal![0];first.expiresAt=w.minute+minutes;
 assert.equal(residentFoodCoverage(w,to).reachableNutrition,0,'whole gift cannot complete if one reserved segment spoils');
 const own=w.food!.lots['family-stock:'+w.household!.pools[0].id+':'+r.id].meal!;
 own[0].quantity=1;own.push({...own[0],expiresAt:w.minute+DAY});own[0].expiresAt=w.minute+1;
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,0,'the estimated fixed withdrawal cannot silently become a smaller transaction');
});

test('protected siblings count disjoint portions of the same physical estate lot once, within their one-day allowance',()=>{
 const {w,r:dead,other:child}=setup(),sibling=w.residents[2];
 for(const p of [child,sibling]){p.parents=[dead.id];p.bornAt=w.minute-10*YEAR;}
 dead.inventory={berry:8};initializeFood(w);recordDeath(w,dead);
 const before=structuredClone(w),report=settlementFoodCoverage(w);
 for(const p of [child,sibling]){
  const option=emergencyEstateOptions(w,p)[0];assert.ok(option);
  const coverage=report.residents.find(r=>r.residentId===p.id)!;
  assert.equal(coverage.reachableNutrition,48);assert.ok(coverage.reachableNutrition<=emergencyEstateAllowance(w,p).remaining);
  assert.equal(coverage.lowFood,true);
 }
 assert.equal(report.uniqueNutrition,96,'both independent four-berry entitlements exhaust, but never duplicate, one eight-berry physical lot');
 assert.deepEqual(w,before);
 const option=decisionChoices(decisionContext(w,child)).find(c=>c.action.type==='production'&&c.action.operation==='emergencyEstateRation');assert.ok(option);
 run(w,child,option.action);
 const after=settlementFoodCoverage(w);assert.equal(after.uniqueNutrition,96,'receipt changes custody, not the total counted stock');
 assert.equal(after.residents.find(r=>r.residentId===child.id)!.sourceLabel,null,'already collected food is counted only in the pack');
});

test('an unreachable indoor estate is not mistaken for an outdoor pickup when no room target exists',()=>{
 const {w,r}=setup(),home=w.buildings.find(b=>b.id===r.homeId)!;
 const p=parcel(w,r.id,{meal:3},home.door),layout=roomLayout(w,home);
 p.location.inside=home.id;p.location.roomAt=layout.slots.find(s=>s.key==='table')!.at;
 initializeRooms(w);r.at={...home.door};
 for(let x=1;x<layout.width-1;x++)w.residents.push({...structuredClone(r),id:'blocked-room:'+x,status:'dead',inside:home.id,roomAt:{x,y:9},body:{reservedBy:null,carriedBy:null,storedAt:home.id}});
 const before=structuredClone(w),coverage=residentFoodCoverage(w,r);
 assert.equal(coverage.reachableNutrition,0);assert.equal(coverage.lowFood,true);assert.deepEqual(w,before);
 const action={type:'production' as const,operation:'collectEstate' as const,parcelId:p.id};
 assert.ok(submitPlan(w,{id:'blocked-indoor-food',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'尝试到原址取粮',actions:[action]}).ok);
 for(let n=0;n<30&&(r.plan||r.activity);n++)stepWorld(w,1);
 assert.ok(r.lastFailure?.includes('实际位置'));assert.equal(r.inventory.meal??0,0);
});

test('non-food custody does not perform outdoor map searches during a coverage query',()=>{
 const {w,r}=setup();for(let i=0;i<20;i++)parcel(w,r.id,{wood:10},{...w.map.entrance});
 const tiles=w.map.tiles;let reads=0;Object.defineProperty(w.map,'tiles',{get:()=>{reads++;return tiles;},configurable:true});
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);assert.equal(reads,0);
});

test('medical passengers cannot count carried meals as immediately eatable or skip the cancellation delay',()=>{
 const {w,r,other}=setup();r.inventory={meal:4};initializeFood(w);initializeHealth(w);
 const t={id:'carrying-food',carrierId:other.id,patientId:r.id,buildingId:'lodge',bed:0,basis:'consent' as const,offerId:null,phase:'carrying' as const,startedAt:w.minute,endedAt:null,reason:null};w.health!.transports.push(t);
 const coverage=residentFoodCoverage(w,r);assert.equal(coverage.reachableNutrition,0);assert.equal(coverage.accessBlocked,'medicalTransport');assert.equal(coverage.lowFood,true);
 const choices=decisionChoices(decisionContext(w,r));assert.ok(choices.every(c=>c.action.type==='wait'||c.action.type==='health'&&c.action.operation==='cancelRescue'));
 assert.equal(submitPlan(w,{id:'cannot-eat-carried',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'护送中不能跳过限制进食',actions:[{type:'eat',item:'meal'}]}).ok,false);
 w.food!.lots['person:'+r.id].meal![0].expiresAt=w.minute+6;
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,0);
 w.health!.transports[0].phase='interrupted';w.health!.transports[0].endedAt=w.minute+5;w.minute+=5;
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,0,'after cancellation, food expiring within the five-minute meal is still unavailable');
 w.food!.lots['person:'+r.id].meal![0].expiresAt=w.minute+10;
 assert.equal(residentFoodCoverage(w,r).reachableNutrition,168,'once transport actually ended and shelf life permits eating, food can be counted again');
});

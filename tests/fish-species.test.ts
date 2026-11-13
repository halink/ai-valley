import {civicOpportunities} from '../src/server/civic-opportunities.js';
import {initializeCivic} from '../src/world/civic.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import {WorldStore} from '../src/server/store.js';
import {fishSpecies,type FishSpecies} from '../src/shared/fish-species.js';
import type {FishPool,IndustryAction} from '../src/shared/industry.js';
import type {Action,Building,Resident,World} from '../src/shared/types.js';

import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFishing,fishWindows,fishingStockAt,initializeFishing,takeFish,wildFishAt} from '../src/world/fishing.js';
import {completeIndustry,industryTarget,initializeIndustry} from '../src/world/industry.js';
import {advanceFood,foodTransaction,initializeFood} from '../src/world/food.js';
import {completeEconomy,initializeEconomy,totalCoins} from '../src/world/economy.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {DAY,YEAR} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;w.minute=8*60;w.weather='sun';
 w.map={width:64,height:32,name:'隔离分种鱼验收',entrance:{x:1,y:1},tiles:Array(64*32).fill('grass')};
 for(let x=27;x<=36;x++)w.map.tiles[12*64+x]='water';
 const r=w.residents[0];
 const home:Building={id:'fish-test-home',kind:'home',name:'自有鱼屋',at:{x:4,y:3},door:{x:7,y:8},width:6,height:5,capacity:4,residents:[r.id],ownerId:r.id,definition:'building/home@1',condition:100};
 w.buildings=[home];w.resources=[];w.plots=[];w.graves=[];
 for(const person of w.residents){person.at={...home.door};person.inside=null;person.roomAt=null;person.bornAt=w.minute-30*YEAR;person.health=person.energy=100;person.hunger=0;person.inventory={};person.knownBuildings=[home.id];person.homeId=home.id;}
 r.at={x:30,y:11};initializeEconomy(w);initializeIndustry(w);initializeFood(w);
 w.industry!.tools.push({id:'species-test-rod',ownerId:r.id,kind:'rod',level:1,durability:30,maxDurability:30});
 return {w,r,home,left:w.industry!.fishing['0,0'],right:w.industry!.fishing['1,0'],shore:{x:30,y:11}};
}
function stock(pool:FishPool,counts:Partial<Record<FishSpecies,number>>){
 for(const species of Object.keys(pool.species!) as FishSpecies[])pool.species![species]={amount:counts[species]??0,progress:0,opening:counts[species]??0,born:0,caught:0,eaten:0,arrived:0,departed:0};
 pool.amount=Object.values(counts).reduce((n,q)=>n+q!,0);pool.progress=0;
}
function conservation(w:World){for(const p of Object.values(w.industry!.fishing)){
 assert.equal(p.amount,Object.values(p.species!).reduce((n,s)=>n+s!.amount,0));
 for(const s of Object.values(p.species!))assert.equal(s!.amount,s!.opening+s!.born+s!.arrived-s!.caught-s!.eaten-s!.departed);
 assert.ok(p.amount>=0&&p.amount<=12);
}}
function run(w:World,r:Resident,action:Action,id='fish-test-'+w.revision+'-'+w.minute){
 assert.equal(submitPlan(w,{id,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'隔离验收中本人选择实际行动',actions:[action]}).ok,true);
 for(let i=0;i<300&&(r.activity||r.plan);i++)stepWorld(w,1);
 assert.equal(r.lastFailure,null);assert.equal(r.activity,null);assert.equal(r.plan,null);
}

test('old-save allocation conserves depleted pools and leaves every generic fish lot, property and historical receipt unchanged',()=>{
 const {w,r,left}=fixture();r.inventory.fish=3;initializeFood(w);w.minute+=DAY;
 for(const p of Object.values(w.industry!.fishing)){delete p.species;delete p.habitats;delete p.speciesRegisteredAt;delete p.speciesLastMinute;delete p.lastMigrationDay;}
 left.amount=5;left.progress=.45;
 const bags=w.residents.map(r=>structuredClone(r.inventory)),lots=structuredClone(w.food),buildings=structuredClone(w.buildings),processed=[...w.processed],minute=w.minute;
 initializeIndustry(w);assert.equal(left.amount,5);assert.equal(left.progress,.45);assert.equal(left.speciesRegisteredAt,minute);conservation(w);
 assert.deepEqual(w.residents.map(r=>r.inventory),bags);assert.deepEqual(w.food,lots);assert.deepEqual(w.buildings,buildings);assert.deepEqual(w.processed,processed);
 const original=structuredClone(w.industry!.fishing);initializeFishing(w);assert.deepEqual(w.industry!.fishing,original);
 const store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load()!;initializeIndustry(loaded);assert.deepEqual(loaded.industry!.fishing,original);assert.deepEqual(loaded.food,lots);}finally{store.close();}
});

test('real catches and duck predation debit the selected same species and preserve distinct old fish',()=>{
 const w=createFrontierWorld(),r=w.residents.find(r=>r.id==='founder-3-2')!,shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!;
 w.clock.paused=false;w.frontierHazards!.nextDisasterAt=Number.MAX_SAFE_INTEGER;
 for(const beast of w.frontierHazards!.beasts)beast.nextMoveAt=w.minute+10000;
 r.inventory.fish=2;initializeFood(w);const old=structuredClone(w.food!.lots['person:'+r.id].fish),opening=pool.species!.carp!.amount;
 const choice=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='industry'&&c.action.operation==='fish')!;
 assert.ok(choice);const action=parseChoice(JSON.stringify({choice:choice.id}),[choice]).actions[0] as IndustryAction;assert.equal(action.fishSpecies,'carp');
 run(w,r,action);assert.equal(r.inventory.carp,1);assert.equal(r.inventory.fish,2);assert.deepEqual(w.food!.lots['person:'+r.id].fish,old);
 assert.equal(pool.species!.carp!.amount,opening-1);assert.equal(pool.species!.carp!.caught,1);
 pool.shoal!.at={...pool.shoal!.anchor};assert.equal(wildFishAt(w,shore),'carp');assert.equal(pool.species!.carp!.amount,opening-2);assert.equal(pool.species!.carp!.eaten,1);conservation(w);

});

test('multiple active species reach normal menus and an exhausted chosen species never silently changes the catch',()=>{
 const {w,r,left,shore}=fixture();w.weather='rain';
 assert.deepEqual(new Set(fishWindows(w,shore).map(f=>f.species)),new Set(['bream','carp']));
 const choices=industryOpportunities(w,r).filter(c=>c.action.type==='industry'&&c.action.operation==='fish');
 assert.deepEqual(new Set(choices.map(c=>(c.action as IndustryAction).fishSpecies)),new Set(['bream','carp']));
 const action=choices.find(c=>(c.action as IndustryAction).fishSpecies==='bream')!.action as IndustryAction;
 while(takeFish(w,shore,'bream','caught')){};const rod=w.industry!.tools[0].durability,amount=left.amount;
 assert.match(industryTarget(w,r,action).error!,/所选鱼种/);assert.ok(completeIndustry(w,r,action));assert.equal(left.amount,amount);assert.equal(w.industry!.tools[0].durability,rod);assert.equal(r.inventory.carp,undefined);conservation(w);
});

test('a pending catch cannot cross its selected weather window or pay twice after a durable restart',()=>{
 const {w,r,left,shore}=fixture();w.weather='rain';
 const action:IndustryAction={type:'industry',operation:'fish',at:shore,fishSpecies:'bream'};
 assert.equal(submitPlan(w,{id:'pending-species',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'雨天钓雨鲂',actions:[action]}).ok,true);
 stepWorld(w,10);assert.ok(r.activity);const opening=left.amount;w.weather='sun';
 for(let i=0;i<80&&(r.activity||r.plan);i++)stepWorld(w,1);
 assert.ok(r.lastFailure);assert.equal(left.amount,opening);assert.equal(r.inventory.bream,undefined);
 w.weather='sun';run(w,r,{type:'industry',operation:'fish',at:shore,fishSpecies:'carp'},'durable-species');
 const store=new WorldStore(':memory:');try{store.commit(w,null);const saved=store.load()!,actor=saved.residents[0],before=structuredClone(actor.inventory),p=structuredClone(saved.industry!.fishing);
  assert.equal(submitPlan(saved,{id:'durable-species',actorId:actor.id,actorRevision:actor.revision,createdAt:saved.minute,definition:saved.activeDefinitions['action/routine'],intention:'重复提交',actions:[{type:'industry',operation:'fish',at:shore,fishSpecies:'carp'}]}).ok,true);
  stepWorld(saved,60);assert.deepEqual(actor.inventory,before);assert.equal(saved.industry!.fishing['0,0'].amount,p['0,0'].amount);assert.equal(saved.industry!.fishing['0,0'].species!.carp!.caught,1);
 }finally{store.close();}
});

test('seasonal reproduction needs surviving fish and real water, shares capacity and never revives an isolated extinction',()=>{
 const {w,left}=fixture();w.industry!.fishing={'0,0':left};stock(left,{carp:1,catfish:1,crucian:1});
 w.minute+=10*DAY;advanceFishing(w);assert.ok(left.species!.carp!.born>0);assert.equal(left.species!.catfish!.born,0);conservation(w);
 stock(left,{});w.minute+=YEAR;advanceFishing(w);assert.equal(left.amount,0);conservation(w);
 stock(left,{carp:1});w.map.tiles=Array(w.map.width*w.map.height).fill('grass');w.minute+=YEAR;advanceFishing(w);assert.equal(left.amount,1);conservation(w);
});

test('daily migration conserves species along connected waters, respects capacity and does not replay on reload',()=>{
 const {w,left,right}=fixture();stock(left,{carp:4});stock(right,{});
 w.minute+=DAY;advanceFishing(w);assert.equal(left.species!.carp!.departed,1);assert.equal(right.species!.carp!.arrived,1);assert.equal(left.amount+right.amount,4);conservation(w);
 const original=structuredClone(w.industry!.fishing),restored=JSON.parse(JSON.stringify(w)) as World;initializeFishing(restored);advanceFishing(restored);assert.deepEqual(restored.industry!.fishing,original);
 stock(left,{carp:12});stock(right,{carp:12});w.minute+=DAY;advanceFishing(w);assert.equal(right.amount,12);conservation(w);
});

test('land barriers between adjacent registered pools prevent migration and do not create new water stocks',()=>{
 const {w,left,right}=fixture();stock(left,{carp:4});stock(right,{});w.map.tiles[12*64+31]='grass';
 w.minute+=DAY;advanceFishing(w);assert.equal(right.amount,0);assert.equal(left.species!.carp!.departed,0);
 const keys=Object.keys(w.industry!.fishing);w.map.tiles[29*64+5]='water';initializeFishing(w);assert.deepEqual(Object.keys(w.industry!.fishing),keys);conservation(w);
});

test('species fish are saleable physical goods with original expiry, while mixed preservation consumes both actual inputs and station time',()=>{
 const {w,r,home}=fixture();r.at={...home.door};r.inventory={carp:2,bream:1,water:3,wood:3,fish:1};initializeFood(w);
 const expires=w.food!.lots['person:'+r.id].carp![0].expiresAt;
 assert.equal(completeEconomy(w,r,{type:'economy',operation:'open',buildingId:home.id,name:'分种鱼铺'}),null);const shop=w.economy!.businesses[0];r.revision++;
 assert.equal(completeEconomy(w,r,{type:'economy',operation:'stock',businessId:shop.id,item:'carp',quantity:1}),null);r.revision++;
 assert.equal(completeEconomy(w,r,{type:'economy',operation:'list',businessId:shop.id,item:'carp',quantity:1,price:3}),null);
 assert.equal(w.food!.lots['listing:'+w.economy!.listings[0].id].carp![0].expiresAt,expires);
 const buyer=w.residents[1];buyer.at={...home.door};const money=totalCoins(w);
 assert.equal(completeEconomy(w,buyer,{type:'economy',operation:'buy',listingId:w.economy!.listings[0].id,businessId:shop.id,item:'carp',quantity:1,maxTotal:3}),null);assert.equal(buyer.inventory.carp,1);assert.equal(totalCoins(w),money);assert.equal(w.food!.lots['person:'+buyer.id].carp![0].expiresAt,expires);
 const recipe:IndustryAction={type:'industry',operation:'craft',buildingId:home.id,recipeId:'preserveFish.carp.bream',minutes:60};
 assert.match(industryTarget(w,r,recipe).error!,/设备/);w.industry!.stations.push({id:'test-preserver',buildingId:home.id,kind:'preserver',installedAt:w.minute});
 const choices=industryOpportunities(w,r);assert.ok(choices.some(c=>c.action.type==='industry'&&c.action.recipeId===recipe.recipeId));
 run(w,r,recipe);assert.equal(r.inventory.carp,0);assert.equal(r.inventory.bream,0);assert.equal(r.inventory.fish,1);assert.equal(r.inventory.preserve,2);
 const batch=w.industry!.batches.find(b=>b.recipe.id===recipe.recipeId)!;assert.deepEqual(batch.input,{carp:1,bream:1,water:1,wood:1});assert.equal(batch.worked,60);assert.equal(batch.status,'completed');
 w.minute=expires;advanceFood(w);assert.equal(buyer.inventory.carp,0);assert.equal(r.inventory.preserve,2);
});

test('old sparse food definitions accept new fish without changing any existing definition or lot',()=>{
 const {w,r}=fixture();w.definitions['food/life@1'].data.days={fish:2};w.definitions['food/life@1'].data.nutrition={fish:16};r.inventory={fish:1};initializeFood(w);
 const definition=structuredClone(w.definitions['food/life@1']),old=structuredClone(w.food!.lots['person:'+r.id].fish);
 foodTransaction(w,()=>{r.inventory.cod=1;});assert.equal(w.food!.lots['person:'+r.id].cod![0].definition,'food/life/fish-species@1');assert.equal(w.food!.lots['person:'+r.id].cod![0].expiresAt,w.minute+3*DAY);assert.deepEqual(w.definitions['food/life@1'],definition);assert.deepEqual(w.food!.lots['person:'+r.id].fish,old);
});

test('a partially completed selected-species action resumes once from durable state without resetting physical work',()=>{
 const {w,r,shore}=fixture(),store=new WorldStore(':memory:');
 try{
  assert.equal(submitPlan(w,{id:'resume-species',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'连续钓获同一种',actions:[{type:'industry',operation:'fish',at:shore,fishSpecies:'carp'}]}).ok,true);
  stepWorld(w,20);assert.ok(r.activity);const remaining=r.activity.remaining;store.commit(w,null);
  const loaded=store.load()!,actor=loaded.residents[0];initializeIndustry(loaded);assert.equal(actor.activity!.remaining,remaining);assert.equal((actor.activity!.action as IndustryAction).fishSpecies,'carp');
  for(let i=0;i<80&&(actor.activity||actor.plan);i++)stepWorld(loaded,1);
  assert.equal(actor.lastFailure,null);assert.equal(actor.inventory.carp,1);assert.equal(loaded.industry!.fishing['0,0'].species!.carp!.caught,1);conservation(loaded);
 }finally{store.close();}
});

test('an intermediate active flood blocks both a cast and duck predation even with dry endpoints',()=>{
 const w=createFrontierWorld(),shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!,source=pool.shoal!.anchor;
 // Keep the same registered water sector, but isolate a narrow channel through an active current.
 const start={x:Math.floor(source.x/32)*32+5,y:Math.floor(source.y/32)*32+5};
 for(let y=start.y-1;y<=start.y+1;y++)for(let x=start.x-1;x<=start.x+5;x++)w.map.tiles[y*w.map.width+x]='grass';
 for(let x=start.x;x<=start.x+4;x++)w.map.tiles[start.y*w.map.width+x]='water';
 pool.shoal!.at={x:start.x+4,y:start.y};pool.shoal!.anchor={...start};const bank={x:start.x,y:start.y-1};
 w.frontierHazards!.disasters.push({id:'intermediate-current',kind:'flashFlood',at:{x:start.x+2,y:start.y},radius:0,phase:'active',warningAt:w.minute-1,startsAt:w.minute,endsAt:w.minute+30,intensity:2,warned:[],exposure:{}});
 const count=pool.amount;assert.equal(wildFishAt(w,bank),false);assert.equal(pool.amount,count);
 w.buildings=[];w.resources=[];w.plots=[];w.industry!.pastures=[];
 const r=w.residents.find(r=>r.id==='founder-3-2')!;r.at=bank;r.inside=null;assert.match(industryTarget(w,r,{type:'industry',operation:'fish',at:bank}).error!,/鱼群离岸/);
});

test('rainy species alternatives survive the final ordinary decision menu without rewriting the chosen species',()=>{
 const w=createFrontierWorld(),r=w.residents.find(r=>r.id==='founder-3-2')!;w.weather='rain';
 const choices=decisionChoices(decisionContext(w,r)).filter(c=>c.action.type==='industry'&&c.action.operation==='fish');
 assert.deepEqual(new Set(choices.map(c=>(c.action as IndustryAction).fishSpecies)),new Set(['bream','carp']));
 for(const choice of choices)assert.equal((parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as IndustryAction).fishSpecies,(choice.action as IndustryAction).fishSpecies);
});

test('nearby exhausted shores cannot hide the next registered pool behind a global shore cutoff',()=>{
 const {w,r,left,right}=fixture();w.scenario='frontier';r.at={x:27,y:11};w.industry!.frontierShore={x:27,y:11};stock(left,{});stock(right,{carp:3});
 const choice=industryOpportunities(w,r).find(c=>c.action.type==='industry'&&c.action.operation==='fish')!;
 assert.ok(choice);const action=choice.action as IndustryAction;
 assert.equal(fishingStockAt(w,action.at!),right);assert.equal(action.fishSpecies,'carp');assert.ok(Math.abs(r.at.x-action.at!.x)+Math.abs(r.at.y-action.at!.y)<=12);
});

test('new fish reserve proposals require the residents real species stock and do not crowd legacy civic choices',()=>{
 const {w,r,home}=fixture();home.kind='lodge';home.ownerId='commons';home.definition='building/lodge@1';r.at={...home.door};initializeCivic(w);
 const reserveItems=()=>civicOpportunities(w,r).flatMap(c=>c.action.type==='civic'&&c.action.operation==='propose'&&c.action.measure.kind==='foodReserve'?[c.action.measure.item]:[]);
 const before=reserveItems();assert.ok(before.includes('turnip'));assert.ok(!before.some(i=>fishSpecies.includes(i as FishSpecies)));
 r.inventory.carp=1;const withFish=reserveItems();assert.deepEqual(withFish.filter(i=>i!=='carp'),before);assert.equal(withFish.filter(i=>i==='carp').length,1);
 delete r.inventory.carp;assert.deepEqual(reserveItems(),before);
});

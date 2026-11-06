import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseChoice} from '../src/server/affordances.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {industryOpportunities} from '../src/server/industry-opportunities.js';
import type {IndustryAction} from '../src/shared/industry.js';
import type {Resident,World} from '../src/shared/types.js';
import {initializeConstruction} from '../src/world/construction.js';
import {constructionSiteError,proposedSite} from '../src/world/construction-sites.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {fishingKey,fishingMinutes,fishingStockAt} from '../src/world/fishing.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceIndustry} from '../src/world/industry.js';
import {same} from '../src/world/navigation.js';
import {productionTarget} from '../src/world/production.js';

function begin(w:World,actor:Resident,id:string,action:IndustryAction){
 const result=submitPlan(w,{id,actorId:actor.id,actorRevision:actor.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择此项行动',actions:[action]});
 assert.ok(result.ok,result.error);
}

function finish(w:World,actor:Resident){
 for(let i=0;i<180&&(actor.activity||actor.plan);i++)stepWorld(w,1);
 assert.equal(actor.activity,null);
 assert.equal(actor.plan,null);
 assert.equal(actor.lastFailure,null);
}

test('a founder can choose a real shore from the model menu, catch fish and improve through experience',()=>{
 const w=createFrontierWorld(),state=w.industry!,r=w.residents.find(r=>r.id==='founder-3-2')!,shore=state.frontierShore!;
 w.clock.paused=false;
 const choices=decisionChoices(decisionContext(w,r));
 const choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='fish');
 assert.ok(choice,'fishing must reach the actual model menu');
 const action=parseChoice(JSON.stringify({choice:choice.id}),choices).actions[0] as IndustryAction;
 assert.deepEqual(action.at,shore);
 assert.ok(!same(r.at,shore));
 const pool=fishingStockAt(w,shore)!,stock=pool.amount;
 const rod=state.tools.find(t=>t.kind==='rod'&&t.ownerId===r.id)!,durability=rod.durability;
 const duration=fishingMinutes(w,r,shore,rod.level),fish=r.inventory.fish??0;
 begin(w,r,'first-frontier-catch',action);
 stepWorld(w,duration-1);
 assert.equal(r.inventory.fish??0,fish);
 assert.equal(rod.durability,durability);
 finish(w,r);
 assert.deepEqual(r.at,shore);
 assert.equal(r.inventory.fish,fish+1);
 assert.equal(pool.amount,stock-1);
 assert.equal(rod.durability,durability-1);
 assert.equal(state.fishingExperience![r.id],.5);
 assert.ok(fishingMinutes(w,r,shore,rod.level)<duration);
});

test('a shore across a sector boundary draws from the adjacent water sector',()=>{
 const w=createFrontierWorld(),shore={x:31,y:242},water={x:32,y:242};
 for(const at of [shore,{x:30,y:242},{x:31,y:241},{x:31,y:243}])w.map.tiles[at.y*w.map.width+at.x]='grass';
 w.map.tiles[water.y*w.map.width+water.x]='water';
 const stocks=w.industry!.fishing,source={...fishingStockAt(w,w.industry!.frontierShore!)!,amount:2};
 stocks[fishingKey(water)]=source;
 stocks[fishingKey(shore)]={...source,amount:8};
 assert.strictEqual(fishingStockAt(w,shore),source);
});

test('riverbank leisure from the model menu takes time and restores energy at the actual shore',()=>{
 const w=createFrontierWorld(),r=w.residents.find(r=>r.id==='founder-3-2')!;
 w.clock.paused=false;r.energy=65;
 const control=structuredClone(w),idle=control.residents.find(p=>p.id===r.id)!;
 const choice=decisionChoices(decisionContext(w,r)).find(c=>c.action.type==='industry'&&c.action.operation==='shoreRest');
 assert.ok(choice,'riverbank leisure must reach the actual model menu');
 const action=choice.action as IndustryAction,start=w.minute;
 begin(w,r,'riverbank-break',action);
 stepWorld(w,29);
 assert.ok(r.activity);
 finish(w,r);
 stepWorld(control,w.minute-start);
 assert.ok(w.minute>start+30,'travel and actual resting both take time');
 assert.deepEqual(r.at,action.at);
 assert.ok(r.energy>idle.energy+2);
});

test('pasture animals graze and move, while the owner must actually shelter, water and collect them',()=>{
 const w=createFrontierWorld(),state=w.industry!,yard=state.pastures![0],hen=state.animals.find(a=>a.kind==='chicken'&&a.sex==='female')!;
 const owner=w.residents.find(r=>r.id===hen.ownerId)!,barn=w.buildings.find(b=>b.id===yard.barnId)!;
 w.clock.paused=false;
 const before=yard.forage,oldTile={...hen.at!},thirst=hen.thirst;
 stepWorld(w,15);
 assert.ok(yard.forage<before);
 assert.ok(hen.at&&!same(oldTile,hen.at));
 assert.ok(state.animals.every(n=>n.at&&yard.tiles.some(tile=>same(tile,n.at!))));
 assert.ok(hen.thirst>thirst,'grazing cannot supply water');
 assert.ok(w.residents.every(r=>r.plan===null&&r.activity===null),'grazing does not assign residents tasks');

 const choices=industryOpportunities(w,owner);
 const collect=choices.find(c=>c.action.type==='industry'&&c.action.operation==='collectAnimal')!;
 assert.ok(collect);
 const eggs=owner.inventory.egg??0;
 begin(w,owner,'collect-real-egg',collect.action as IndustryAction);finish(w,owner);
 assert.equal(owner.inventory.egg,eggs+1);
 assert.equal(hen.product,0);

 const watering=industryOpportunities(w,owner).find(c=>c.action.type==='industry'&&c.action.operation==='waterAnimal'&&c.action.animalId===hen.id)!;
 assert.ok(watering);
 const water=owner.inventory.water!,parched=hen.thirst;
 begin(w,owner,'water-pasture-hen',watering.action as IndustryAction);finish(w,owner);
 assert.equal(owner.inventory.water,water-1);
 assert.ok(hen.thirst<parched);

 const shelter={type:'industry',operation:'moveAnimal',animalId:hen.id,buildingId:barn.id} as const;
 begin(w,owner,'shelter-hen',shelter);finish(w,owner);
 assert.equal(hen.pastureId,undefined);
 assert.equal(hen.at,undefined);
 assert.equal(hen.carrierId,null);
 assert.equal(owner.inside,barn.id);
 const pasture=industryOpportunities(w,owner).find(c=>c.action.type==='industry'&&c.action.operation==='moveAnimal'&&c.action.pastureId===yard.id&&c.action.animalId===hen.id);
 assert.ok(pasture,'an indoor animal has a real route back out to the pasture');
 begin(w,owner,'release-hen',pasture.action as IndustryAction);finish(w,owner);
 assert.equal(hen.pastureId,yard.id);
 assert.equal(hen.inside,null);
 assert.equal(owner.inside,null);
 assert.ok(hen.at&&yard.tiles.some(tile=>same(tile,hen.at!)));
});

test('a resident breeding two real pasture chickens leads to a distinct outdoor newborn',()=>{
 const w=createFrontierWorld(),state=w.industry!,yard=state.pastures![0],hen=state.animals.find(a=>a.kind==='chicken'&&a.sex==='female')!;
 const owner=w.residents.find(r=>r.id===hen.ownerId)!;
 w.clock.paused=false;
 const choice=industryOpportunities(w,owner).find(c=>c.action.type==='industry'&&c.action.operation==='breedAnimal'&&c.action.animalId===hen.id);
 assert.ok(choice);
 begin(w,owner,'breed-pasture-chickens',choice.action as IndustryAction);finish(w,owner);
 assert.ok(hen.pregnancy);
 assert.equal(state.animals.length,3);

 w.minute=hen.pregnancy.dueAt;
 yard.lastMinute=w.minute-1;
 for(const n of state.animals)n.lastMinute=w.minute-1;
 advanceIndustry(w);
 assert.equal(state.animals.length,4);
 assert.equal(state.totals.animalBirths,1);
 const chick=state.animals.find(n=>n.bornAt===w.minute)!;
 assert.equal(chick.pastureId,yard.id);
 assert.equal(chick.product,0);
 assert.ok(chick.at&&yard.tiles.some(tile=>same(tile,chick.at!)));
 assert.ok(state.animals.every(n=>n.id===chick.id||n.at&&!same(n.at,chick.at!)));
});

test('active pasture land cannot be converted into a house, road or private crop plot',()=>{
 const w=createFrontierWorld(),yard=w.industry!.pastures![0],at=yard.tiles[0];
 const owner=w.residents.find(r=>r.id==='founder-1-1')!;
 initializeConstruction(w);
 owner.at={...at};
 const house=proposedSite(w,owner,{type:'construction',operation:'propose',kind:'home',scope:'public',at});
 const road=proposedSite(w,owner,{type:'construction',operation:'propose',kind:'road',scope:'public',at,end:yard.tiles[1]});
 assert.ok(house&&road);
 assert.match(constructionSiteError(w,house)??'',/牧场/);
 assert.match(constructionSiteError(w,road)??'',/牧场/);
 assert.match(productionTarget(w,owner,{type:'production',operation:'claimPlot',at}).error??'',/牧场/);
});

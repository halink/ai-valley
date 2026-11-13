import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {LocalWildSpecies} from '../src/shared/frontier-hazards.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFrontierHazards,initializeFrontierHazards,woundWildBeast} from '../src/world/frontier-hazards.js';
import {createWildBeast} from '../src/world/frontier-wildlife.js';
import {initializeWildlifePopulation,localWildlifeHabitat,localWildSpecies,reviewWildlifePopulation} from '../src/world/wildlife-population.js';
import {DAY,YEAR} from '../src/world/time.js';
import {WorldStore} from '../src/server/store.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {advanceIndustry,barnCapacity,industryTarget} from '../src/world/industry.js';

import {wildFlowFixture,prepareHunt,flowMenuAction,queueWildFlow,finishWildFlows} from './helpers/food-flow-wild.js';

function fixture(kind:LocalWildSpecies='deer'){
 const w=createFrontierWorld(),s=w.frontierHazards!;
 w.map={width:30,height:25,tiles:Array(750).fill('grass'),name:'isolated finite wildlife test',entrance:{x:0,y:0},settlement:{x:25,y:20}};
 w.buildings=[];w.residents=[];w.plots=[];w.resources=[{id:'water',kind:'spring',at:{x:9,y:10},amount:10000,max:10000,regrowthDays:20,lastHarvest:0}];
 w.industry!.animals=[];w.industry!.pastures=[];w.industry!.mines=[];w.industry!.fishing={};
 if(w.construction)w.construction.projects=[];
 w.clock.paused=false;w.minute=480;w.events=[];s.disasters=[];s.nextDisasterAt=1e12;s.shore=null;
 s.beasts=[createWildBeast(w,kind,'test:mother',{x:6,y:10}),createWildBeast(w,kind,'test:sire',{x:6,y:10})];
 const [mother,sire]=s.beasts;sire.at={x:6,y:11};mother.sex='female';sire.sex='male';
 for(const b of s.beasts)Object.assign(b,{health:100,hunger:20,thirst:20,energy:90,bornAt:w.minute-YEAR,nextMoveAt:1e12,cooldownUntil:1e12});
 s.foodPatches=[{id:'habitat:'+kind,kind:kind==='boar'?'roots':kind==='deer'?'browse':'seeds',at:{x:7,y:10},amount:100,capacity:100,progress:0}];
 delete s.wildlifePopulation;initializeWildlifePopulation(w,s);
 return {w,s,mother,sire,stock:s.wildlifePopulation!.species[kind]};
}
function review(f:ReturnType<typeof fixture>,minute=f.w.minute+60){f.w.minute=minute;reviewWildlifePopulation(f.w,f.s,createWildBeast);}
function tick(f:ReturnType<typeof fixture>,minute=f.w.minute+1,elapsed=1){f.w.minute=minute;advanceFrontierHazards(f.w,elapsed);}
function conserved(f:ReturnType<typeof fixture>){
 for(const kind of localWildSpecies){const a=f.s.wildlifePopulation!.species[kind];assert.equal(a.registered+a.born-a.deaths-a.tamed,f.s.beasts.filter(b=>b.status==='alive'&&b.species===kind).length);}
}

test('new registration preserves founding numbers and repeated hydration does not seed individuals',()=>{
 const w=createFrontierWorld(),s=w.frontierHazards!;
 assert.deepEqual(localWildSpecies.map(kind=>s.beasts.filter(b=>b.species===kind).length),[2,3,4,2]);
 assert.deepEqual(localWildSpecies.map(kind=>s.wildlifePopulation!.species[kind].capacity),[4,6,8,4]);
 const before=JSON.stringify(s);initializeFrontierHazards(w);initializeFrontierHazards(w);assert.equal(JSON.stringify(s),before);
});

for(const kind of localWildSpecies)test(`${kind} births require real parents and retain finite population accounting`,()=>{
 const f=fixture(kind);review(f);const pregnancy={...f.mother.pregnancy!};assert.equal(pregnancy.sireId,f.sire.id);
 review(f,pregnancy.dueAt);const baby=f.s.beasts.find(b=>b.motherId===f.mother.id)!;
 assert.ok(baby);assert.equal(baby.sireId,f.sire.id);assert.equal(baby.bornAt,f.w.minute);assert.equal(f.stock.born,1);assert.equal(f.mother.hunger,35);
 assert.ok(f.w.events.some(e=>e.animalIds?.includes(baby.id)&&e.animalIds.includes(f.mother.id)&&e.animalIds.includes(f.sire.id)));
 const before=JSON.stringify(f.s);reviewWildlifePopulation(f.w,f.s,createWildBeast);assert.equal(JSON.stringify(f.s),before);conserved(f);
});

const rejections:Record<string,(f:ReturnType<typeof fixture>)=>void>={
 'same sex':f=>{f.sire.sex='female';},'juvenile sire':f=>{f.sire.bornAt=f.w.minute;},
 'dead sire':f=>{woundWildBeast(f.w,f.sire.id,100);},'hungry mother':f=>{f.mother.hunger=80;},
 'thirsty mother':f=>{f.mother.thirst=90;},'poor health':f=>{f.mother.health=60;},
 'exhausted food':f=>{f.s.foodPatches[0].amount=0;},'exhausted water':f=>{f.w.resources[0].amount=0;},
 'blocked food and water':f=>{for(let y=0;y<25;y++)f.w.map.tiles[y*30+7]='water';},
 'blocked mate':f=>{f.sire.at={x:6,y:13};for(let x=0;x<30;x++)f.w.map.tiles[12*30+x]='water';},
 'known parent':f=>{f.sire.motherId=f.mother.id;},'known siblings':f=>{f.sire.motherId=f.mother.motherId='earlier-mother';},
 'full population':f=>{f.stock.capacity=2;},
 'active flood':f=>{f.s.disasters.push({id:'test-flood',kind:'flashFlood',at:{...f.mother.at},radius:1,phase:'active',warningAt:0,startsAt:0,endsAt:1e12,intensity:20,warned:[],exposure:{}});},
};
for(const [reason,change] of Object.entries(rejections))test(`local conception rejects ${reason}`,()=>{
 const f=fixture();change(f);review(f);assert.equal(f.mother.pregnancy,undefined);assert.equal(f.stock.born,0);conserved(f);
});

test('a safe detour around a local disaster keeps actual food and water reachable',()=>{
 const f=fixture();f.s.foodPatches[0].at={x:8,y:10};
 f.s.disasters=[{id:'detour-storm',kind:'windstorm',at:{x:7,y:10},radius:0,phase:'active',warningAt:0,startsAt:0,endsAt:1e12,intensity:20,warned:[],exposure:{}}];
 assert.deepEqual(localWildlifeHabitat(f.w,f.mother),{food:100,watered:true});review(f);assert.ok(f.mother.pregnancy);
});

test('a pregnancy reserves the last place, fails after one overdue day, and can recover later',()=>{
 const f=fixture();f.s.beasts.push({...f.mother,id:'second-mother',at:{x:5,y:10}});f.stock.registered++;f.stock.capacity=4;
 review(f);assert.equal(f.s.beasts.filter(b=>b.pregnancy).length,1);const due=f.mother.pregnancy!.dueAt;
 f.w.resources[0].amount=0;review(f,due);assert.ok(f.mother.pregnancy);review(f,due+DAY);assert.equal(f.mother.pregnancy,undefined);
 assert.equal(f.stock.born,0);assert.ok(f.w.events.some(e=>e.text.includes('孕育')&&e.text.includes('终止')));
 f.w.resources[0].amount=100;f.s.beasts[2].sex='male';review(f,due+8*DAY);assert.ok(f.mother.pregnancy);conserved(f);
});

test('birth rechecks health and actual space, without silently replacing a lost pregnancy',()=>{
 const f=fixture();review(f);const due=f.mother.pregnancy!.dueAt;
 for(const at of [{x:5,y:10},{x:7,y:10},{x:6,y:9}])f.w.map.tiles[at.y*30+at.x]='water';
 review(f,due);assert.equal(f.stock.born,0);assert.ok(f.mother.pregnancy);
 f.w.map.tiles[10*30+7]='grass';review(f,due+60);assert.equal(f.stock.born,1);conserved(f);
});

test('a dead sire does not erase existing pregnancy but a dead mother releases it without offspring',()=>{
 const f=fixture();review(f);const due=f.mother.pregnancy!.dueAt;woundWildBeast(f.w,f.sire.id,100);review(f,due);assert.equal(f.stock.born,1);conserved(f);
 const g=fixture();review(g);const later=g.mother.pregnancy!.dueAt;woundWildBeast(g.w,g.mother.id,100);review(g,later);
 assert.equal(g.stock.born,0);assert.equal(g.mother.pregnancy,undefined);assert.equal(g.stock.deaths,1);conserved(g);
});

test('mammal young consume parent nutrition and ducklings consume actual forage',()=>{
 const f=fixture('deer');review(f);review(f,f.mother.pregnancy!.dueAt);const baby=f.s.beasts.find(b=>b.motherId===f.mother.id)!;
 baby.hunger=45;baby.thirst=20;baby.nextMoveAt=f.w.minute;const before=f.mother.hunger;tick(f);
 assert.ok(f.mother.hunger>before+15);assert.ok(baby.hunger<30);
 const g=fixture('duck');review(g);review(g,g.mother.pregnancy!.dueAt);const duckling=g.s.beasts.find(b=>b.motherId===g.mother.id)!;
 duckling.at={...g.s.foodPatches[0].at};duckling.hunger=45;duckling.thirst=20;duckling.nextMoveAt=g.w.minute;
 const amount=g.s.foodPatches[0].amount,hunger=g.mother.hunger;tick(g);assert.equal(g.s.foodPatches[0].amount,amount-1);
 assert.ok(g.mother.hunger<hunger+1);assert.ok(duckling.hunger<45);conserved(g);
});

for(const kind of localWildSpecies)test(`${kind} extinction persists through seasons, available food, and old-save initialization`,()=>{
 const f=fixture(kind);for(const b of f.s.beasts)woundWildBeast(f.w,b.id,100);
 for(let season=1;season<=5;season++){tick(f,season*28*DAY);initializeFrontierHazards(f.w);conserved(f);}
 assert.equal(f.stock.born,0);assert.equal(f.stock.deaths,2);assert.equal(f.s.beasts.filter(b=>b.status==='alive').length,0);
 const restored=structuredClone(f.w);delete restored.frontierHazards!.wildlifePopulation;delete restored.frontierHazards!.ecologyVersion;
 const ids=restored.frontierHazards!.beasts.map(b=>b.id);initializeFrontierHazards(restored);initializeFrontierHazards(restored);
 assert.deepEqual(restored.frontierHazards!.beasts.map(b=>b.id),ids);assert.equal(restored.frontierHazards!.wildlifePopulation!.species[kind].registered,0);
});

test('legacy upgrade preserves existing individuals, pregnancy, and exhausted patches without guessing history',()=>{
 const f=fixture('duck');f.mother.pregnancy={dueAt:f.w.minute+DAY,sireId:f.sire.id};f.mother.alert={residentId:'synthetic',attackAt:f.w.minute+30};
 f.s.foodPatches[0].amount=0;delete f.s.wildlifePopulation;delete f.s.ecologyVersion;
 const before=structuredClone(f.s.beasts);initializeFrontierHazards(f.w);initializeFrontierHazards(f.w);
 assert.deepEqual(f.s.beasts,before);assert.equal(f.s.foodPatches[0].amount,0);assert.equal(f.s.wildlifePopulation!.species.duck.registered,2);
 assert.equal(f.s.wildlifePopulation!.species.duck.born,0);assert.equal(f.mother.motherId,undefined);
});

test('SQLite restart preserves pregnancy and completed counts without replaying a birth',()=>{
 const f=fixture();review(f);const store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.load()!,s=w.frontierHazards!,mother=s.beasts.find(b=>b.id===f.mother.id)!;
  const previous=w.revision;w.minute=mother.pregnancy!.dueAt;reviewWildlifePopulation(w,s,createWildBeast);assert.equal(s.wildlifePopulation!.species.deer.born,1);
  store.commit(w,previous);const saved=store.load()!,before=JSON.stringify(saved.frontierHazards);reviewWildlifePopulation(saved,saved.frontierHazards!,createWildBeast);
  assert.equal(JSON.stringify(saved.frontierHazards),before);
 }finally{store.close();}
});

function tamingFixture(){
 const w=createFrontierWorld(),s=w.frontierHazards!,duck=s.beasts.find(b=>b.species==='duck')!;
 const barn=w.buildings.find(b=>b.id==='frontier-barn')!,owner=w.residents.find(r=>r.id===barn.ownerId)!;
 w.events=[];w.clock.paused=false;s.nextDisasterAt=1e12;
 for(const r of w.residents)r.inside=r.homeId;for(const b of s.beasts)b.nextMoveAt=w.minute+10000;
 owner.at={...s.shore!};owner.inside=null;owner.knownBuildings.push(barn.id);owner.inventory.fodder=2;
 duck.at={...owner.at};duck.hunger=42;duck.nextMoveAt=w.minute+5;duck.motherId='recorded-mother';duck.sireId='recorded-father';
 return {w,s,duck,barn,owner};
}
test('ordinary taming transfers one finite duck and its parentage, with pregnancy reserving domestic capacity',()=>{
 const f=tamingFixture();f.w.industry!.animals=[];f.duck.pregnancy={dueAt:f.w.minute+DAY,sireId:'recorded-mate'};
 const choice=decisionChoices(decisionContext(f.w,f.owner)).find(c=>c.action.type==='industry'&&c.action.operation==='tameAnimal'&&c.action.beastId===f.duck.id);assert.ok(choice);
 assert.equal(submitPlan(f.w,{id:'finite-duck-taming',actorId:f.owner.id,actorRevision:f.owner.revision,createdAt:f.w.minute,
  definition:f.w.activeDefinitions['action/routine'],intention:'驯养近处野鸭',actions:[choice.action]}).ok,true);stepWorld(f.w,27);
 const animal=f.w.industry!.animals.find(b=>b.id===f.duck.id)!;assert.ok(animal);assert.deepEqual(animal.pregnancy,f.duck.pregnancy);
 assert.equal(animal.motherId,'recorded-mother');assert.equal(animal.sireId,'recorded-father');
 assert.equal(f.s.wildlifePopulation!.species.duck.tamed,1);assert.equal(f.s.wildlifePopulation!.species.duck.deaths,0);
 assert.equal(f.s.wildlifePopulation!.species.duck.registered-f.s.wildlifePopulation!.species.duck.tamed,f.s.beasts.filter(b=>b.status==='alive'&&b.species==='duck').length);
 const mother=animal.id;f.w.minute=animal.pregnancy!.dueAt;animal.lastMinute=f.w.minute;animal.hunger=20;animal.thirst=20;advanceIndustry(f.w);
 const baby=f.w.industry!.animals.find(b=>b.motherId===mother)!;assert.ok(baby);assert.equal(baby.sireId,'recorded-mate');
 assert.equal(f.s.wildlifePopulation!.species.duck.born,0,'a domestic birth must not increment wild births');
});

test('a pregnant duck cannot be tamed into the final unreserved barn slot',()=>{
 const f=tamingFixture(),template=f.w.industry!.animals[0];
 f.w.industry!.animals=Array.from({length:barnCapacity(f.barn)-1},(_,i)=>({...template,id:'occupied:'+i,barnId:f.barn.id,pregnancy:null}));
 f.duck.pregnancy={dueAt:f.w.minute+DAY,sireId:'known-sire'};
 const action={type:'industry' as const,operation:'tameAnimal' as const,beastId:f.duck.id,buildingId:f.barn.id,at:{...f.duck.at}};
 assert.match(industryTarget(f.w,f.owner,action).error??'',/没有空位/);assert.equal(f.owner.inventory.fodder,2);assert.equal(f.s.wildlifePopulation!.species.duck.tamed,0);
});

test('taming completion rechecks newly occupied space without consuming fodder or losing the wild pregnancy',()=>{
 const f=tamingFixture(),template=f.w.industry!.animals[0];f.w.industry!.animals=[];
 f.duck.pregnancy={dueAt:f.w.minute+DAY,sireId:'known-sire'};
 const choice=decisionChoices(decisionContext(f.w,f.owner)).find(c=>c.action.type==='industry'&&c.action.operation==='tameAnimal'&&c.action.beastId===f.duck.id);assert.ok(choice);
 assert.equal(submitPlan(f.w,{id:'finite-duck-race',actorId:f.owner.id,actorRevision:f.owner.revision,createdAt:f.w.minute,
  definition:f.w.activeDefinitions['action/routine'],intention:'驯养近处野鸭',actions:[choice.action]}).ok,true);stepWorld(f.w,1);
 f.w.industry!.animals=Array.from({length:barnCapacity(f.barn)-1},(_,i)=>({...template,id:'late-occupied:'+i,barnId:f.barn.id,pregnancy:null}));
 stepWorld(f.w,27);assert.ok(f.owner.lastFailure);assert.equal(f.owner.inventory.fodder,2);assert.ok(f.duck.pregnancy);
 assert.ok(f.s.beasts.some(b=>b.id===f.duck.id));assert.equal(f.s.wildlifePopulation!.species.duck.tamed,0);
});

test('actual competing hunters remove one registered animal and cannot count its death twice',()=>{
 const {w,hunter,beast}=wildFlowFixture(),other=w.residents.find(r=>r.id!==hunter.id&&r.canDecide)!;
 prepareHunt(w,hunter,beast);prepareHunt(w,other,beast);beast.health=35;
 queueWildFlow(w,hunter,flowMenuAction(w,hunter,'hunt',beast.id));queueWildFlow(w,other,flowMenuAction(w,other,'hunt',beast.id));
 finishWildFlows(w,[hunter,other]);const stock=w.frontierHazards!.wildlifePopulation!.species.boar;
 assert.equal(beast.status,'dead');assert.equal(stock.deaths,1);assert.equal(stock.registered+stock.born-stock.deaths,w.frontierHazards!.beasts.filter(b=>b.species==='boar'&&b.status==='alive').length);
 assert.equal((hunter.inventory.gameMeat??0)+(other.inventory.gameMeat??0),5);stepWorld(w,1);assert.equal(stock.deaths,1);
});

test('incoming pregnant livestock reserves both places before a second pregnant duck can be tamed',()=>{
 const f=tamingFixture(),template=f.w.industry!.animals[0],capacity=barnCapacity(f.barn);
 f.duck.pregnancy={sireId:'known-sire',dueAt:f.w.minute+DAY};
 f.w.industry!.animals=[...Array.from({length:capacity-3},(_,i)=>({...template,id:'resident:'+i,barnId:f.barn.id,pregnancy:null})),
  {...template,id:'incoming-mother',barnId:'other-barn',destinationId:f.barn.id,pregnancy:{sireId:'known-sire',dueAt:f.w.minute+DAY}}];
 const action={type:'industry' as const,operation:'tameAnimal' as const,beastId:f.duck.id,buildingId:f.barn.id,at:{...f.duck.at}};
 assert.match(industryTarget(f.w,f.owner,action).error??'',/没有空位/);
 f.w.industry!.animals.at(-1)!.status='dead';assert.equal(industryTarget(f.w,f.owner,action).error,undefined,'dead arrivals no longer reserve a place');
});

test('moving a pregnant duck needs two places and excludes its own existing destination reservation',()=>{
 const f=tamingFixture(),template=f.w.industry!.animals[0],capacity=barnCapacity(f.barn);
 const animal={...template,id:f.duck.id,kind:'duck' as const,ownerId:f.owner.id,barnId:'source-barn',at:{...f.owner.at},inside:null,
  carrierId:null,destinationId:f.barn.id,pregnancy:{sireId:'known-sire',dueAt:f.w.minute+DAY}};
 f.w.industry!.animals=[...Array.from({length:capacity-1},(_,i)=>({...template,id:'resident:'+i,barnId:f.barn.id,pregnancy:null})),animal];
 const action={type:'industry' as const,operation:'moveAnimal' as const,animalId:animal.id,buildingId:f.barn.id};
 assert.match(industryTarget(f.w,f.owner,action).error??'',/没有空位/);
 f.w.industry!.animals.shift();assert.equal(industryTarget(f.w,f.owner,action).error,undefined);
});

test('new domestic breeding cannot consume an incoming mother and offspring reservation',()=>{
 const f=tamingFixture(),template=f.w.industry!.animals[0];
 // This capacity fixture is actually housed in the barn, not an outdoor
 // animal whose registered pasture has lost its coordinate.
 const mother={...template,id:'domestic-mother',ownerId:f.owner.id,at:undefined,pastureId:undefined,barnId:f.barn.id,sex:'female' as const,bornAt:f.w.minute-YEAR,hunger:20,thirst:20,pregnancy:null};
 const sire={...mother,id:'domestic-sire',sex:'male' as const};
 const incoming={...mother,id:'incoming-mother',barnId:'other-barn',destinationId:f.barn.id,pregnancy:{sireId:'known-sire',dueAt:f.w.minute+DAY}};
 f.w.industry!.animals=[mother,sire,incoming];
 const action={type:'industry' as const,operation:'breedAnimal' as const,animalId:mother.id,partnerId:sire.id};
 assert.match(industryTarget(f.w,f.owner,action).error??'',/预留幼畜空位/);
 incoming.status='dead';assert.equal(industryTarget(f.w,f.owner,action).error,undefined);
});

test('unpacking a real crated animal cannot consume incoming pregnancy reservations',()=>{
 const f=tamingFixture(),template=f.w.industry!.animals[0],crate=f.w.industry!.livestockCargo!.find(c=>c.kind==='chicken'&&c.status==='crated')!;
 assert.ok(crate);crate.container='person:'+f.owner.id;f.owner.inventory.chickCrate=1;
 f.w.industry!.animals=[{...template,id:'resident-a',barnId:f.barn.id,pregnancy:null},{...template,id:'resident-b',barnId:f.barn.id,pregnancy:null},
  {...template,id:'incoming-mother',barnId:'other-barn',destinationId:f.barn.id,pregnancy:{sireId:'known-sire',dueAt:f.w.minute+DAY}}];
 const action={type:'industry' as const,operation:'placeAnimal' as const,kind:'chicken' as const,animalId:crate.id,buildingId:f.barn.id};
 assert.match(industryTarget(f.w,f.owner,action).error??'',/未预留的空位/);
 f.w.industry!.animals.at(-1)!.status='dead';assert.equal(industryTarget(f.w,f.owner,action).error,undefined);
});

test('a full synthetic year retains finite counts through ordinary needs, births, resource use, and death',()=>{
 for(const kind of localWildSpecies){
  const f=fixture(kind);for(const b of f.s.beasts)b.nextMoveAt=f.w.minute;
  for(let minute=0;minute<YEAR;minute++){
   tick(f);if(minute%DAY===0){conserved(f);assert.ok(f.s.beasts.filter(b=>b.status==='alive').length<=f.stock.capacity);}
  }
  assert.ok(f.stock.born>0,`${kind} can reproduce while actual needs continue`);assert.ok(f.w.resources[0].amount<10000);conserved(f);
 }
});

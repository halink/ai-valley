import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {fishingStockAt} from '../src/world/fishing.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFrontierHazards,initializeFrontierHazards} from '../src/world/frontier-hazards.js';
import {initializeFood} from '../src/world/food.js';
import {distance} from '../src/world/navigation.js';

function isolated(){
 const world=createFrontierWorld();
 const state=world.frontierHazards!;
 state.nextDisasterAt=Infinity;
 world.clock.paused=false;
 for(const r of world.residents)r.inside=r.homeId;
 for(const n of state.beasts)n.nextMoveAt=world.minute+10000;
 return {world,state};
}
function advance({world}:ReturnType<typeof isolated>,minutes:number){
 for(let i=0;i<minutes;i++){world.minute++;advanceFrontierHazards(world,1);}
}

test('a hunting fox consumes a real prey animal, records both identities and calms its hunger',()=>{
 const f=isolated(),{world,state}=f,fox=state.beasts.find(n=>n.species==='fox')!,hare=state.beasts.find(n=>n.species==='hare')!;
 world.minute=1200;
 fox.at={...hare.at};fox.hunger=70;fox.nextMoveAt=world.minute;fox.cooldownUntil=world.minute;
 hare.energy=1;
 advance(f,1);
 assert.equal(fox.alert?.preyId,hare.id);
 assert.equal(fox.activity?.kind,'hunt');
 advance(f,12);
 assert.equal(hare.status,'dead');
 assert.equal(hare.deathCause,'predation');
 assert.ok(fox.hunger<60);
 assert.ok(world.events.some(e=>e.animalIds?.includes(hare.id)&&e.animalIds.includes(fox.id)));
});

test('a thirsty deer uses the village water stock, and a hungry deer can reduce real crop growth',()=>{
 const f=isolated(),{world,state}=f,deer=state.beasts.find(n=>n.species==='deer')!;
 const spring=world.resources.find(r=>r.id==='spring-419-233')!;
 deer.at={...spring.at};deer.thirst=90;deer.nextMoveAt=world.minute;
 const stock=spring.amount;
 advance(f,1);
 assert.equal(spring.amount,stock-1);
 assert.ok(deer.thirst<60);
 assert.equal(deer.activity?.targetId,spring.id);
 const plot=world.plots.find(p=>!world.resources.some(r=>r.kind==='bush'&&distance(r.at,p.at)<=1))!;
 plot.crop={definition:'crop/turnip@1',planted:world.minute,growth:2,wateredDay:0,lastGrowthDay:0};
 deer.at={...plot.at};deer.hunger=81;deer.nextMoveAt=world.minute;deer.cooldownUntil=world.minute;
 advance(f,1);
 assert.equal(plot.crop.growth,1.5);
 assert.equal(deer.activity?.targetId,plot.id);
 assert.ok(world.events.some(e=>e.animalIds?.includes(deer.id)&&e.text.includes('啃食')));
});

test('a wild duck can take a unit from the same finite river stock that residents fish',()=>{
 const f=isolated(),{world,state}=f,duck=state.beasts.find(n=>n.species==='duck')!;
 duck.at={...state.shore!};duck.hunger=80;duck.nextMoveAt=world.minute;
 const stock=fishingStockAt(world,duck.at)!;
 const amount=stock.amount;
 assert.ok(amount>0);
 advance(f,1);
 assert.equal(stock.amount,amount-1);
 assert.match(duck.activity?.reason??'',/实际鱼群/);
 assert.ok(duck.hunger<58);
});

test('an actual model option can tame a wild duck with real feed and keep the same animal and location',()=>{
 const f=isolated(),{world,state}=f,duck=state.beasts.find(n=>n.species==='duck')!;
 const barn=world.buildings.find(b=>b.id==='frontier-barn')!;
 const owner=world.residents.find(r=>r.id===barn.ownerId)!;
 owner.at={...state.shore!};owner.inside=null;
 owner.knownBuildings.push(barn.id);owner.inventory.fodder=2;
 duck.at={...owner.at};duck.hunger=42;duck.nextMoveAt=world.minute+5;
 const choice=decisionChoices(decisionContext(world,owner)).find(c=>c.action.type==='industry'&&c.action.operation==='tameAnimal');
 assert.ok(choice);
 assert.equal(submitPlan(world,{id:'actual-taming',actorId:owner.id,actorRevision:owner.revision,createdAt:world.minute,
  definition:world.activeDefinitions['action/routine'],intention:'用饲料驯养近处的鸭子',actions:[choice.action]}).ok,true);
 stepWorld(world,27);
 const animal=world.industry!.animals.find(n=>n.id===duck.id);
 assert.ok(animal);
 assert.equal(animal.kind,'duck');
 assert.equal(animal.ownerId,owner.id);
 assert.equal(animal.bornAt,duck.bornAt);
 assert.deepEqual(animal.at,duck.at);
 assert.equal(owner.inventory.fodder,1);
 assert.ok(!state.beasts.some(n=>n.id===duck.id));
 assert.ok(world.events.some(e=>e.animalIds?.includes(duck.id)&&e.text.includes('驯养')));
});

test('legacy ecology upgrades once, preserves a dead wolf and introduces finite outside breeding stock',()=>{
 const {world,state}=isolated();
 state.beasts=state.beasts.filter(n=>n.id==='beast:boar'||n.id==='beast:wolf');
 const [boar,wolf]=state.beasts,original={...boar.at};
 wolf.status='dead';wolf.deathAt=world.minute;wolf.deathCause='hunted';wolf.health=0;
 state.foodPatches=state.foodPatches.filter(p=>p.id==='habitat:boar'||p.id==='habitat:wolf');
 state.foodPatches[0].amount=1;delete state.ecologyVersion;
 initializeFrontierHazards(world);
 assert.equal(state.beasts.length,13);
 assert.equal(state.beasts.filter(n=>n.status==='alive').length,12);
 assert.deepEqual(boar.at,original);
 assert.equal(wolf.status,'dead');
 assert.equal(state.foodPatches[0].amount,1);

 const store=new WorldStore(':memory:');
 try{
  store.commit(world,null);
  const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'}),w=runtime.world;
  const added=w.industry!.livestockCargo!.filter(n=>n.kind==='duck'||n.kind==='cow');
  assert.equal(added.filter(n=>n.kind==='duck').length,3);
  assert.equal(added.filter(n=>n.kind==='cow').length,2);
  assert.ok(added.every(n=>n.container.startsWith('person:foreign-')));
  assert.equal(w.industry!.animals.length,3);
  initializeFood(w);initializeFrontierHazards(w);
  assert.deepEqual(w.industry!.livestockCargo!.filter(n=>n.kind==='duck'||n.kind==='cow').map(n=>n.id),added.map(n=>n.id));
  assert.equal(w.frontierHazards!.beasts.length,13);
  runtime.stop();
 }finally{store.close();}
});

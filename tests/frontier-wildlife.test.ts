import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFrontierHazards,initializeFrontierHazards,wildlifeVisible,woundWildBeast} from '../src/world/frontier-hazards.js';
import {distance} from '../src/world/navigation.js';
import {DAY} from '../src/world/time.js';

function frontierAtNight(){
 const w=createFrontierWorld();
 w.minute=20*60;w.clock.paused=false;
 const state=w.frontierHazards!;
 state.nextDisasterAt=Infinity;
 for(const r of w.residents)r.inside=r.homeId;
 const wolf=state.beasts.find(b=>b.species==='wolf')!;
 return {w,state,wolf};
}

function activeRaid(){
 const {w,state,wolf}=frontierAtNight(),hen=w.industry!.animals[0];
 // This particular raid occurs when the wolf cannot find its usual living prey.
 state.beasts=state.beasts.filter(animal=>!['hare','deer','duck'].includes(animal.species));
 wolf.hunger=74;hen.health=50;
 const startingDistance=distance(wolf.at,hen.at!);
 assert.ok(startingDistance>=40);
 for(let i=0;i<260&&!wolf.alert;i++){w.minute++;advanceFrontierHazards(w,1);}
 assert.equal(wolf.alert?.animalId,hen.id);
 assert.ok(distance(wolf.at,hen.at!)<=4);
 assert.equal(hen.health,50,'a warning is separate from a landed attack');
 return {w,state,wolf,hen};
}

test('a hungry wolf actually leaves the forest to hunt outdoor livestock and consumes its kill',()=>{
 const {w,state,wolf,hen}=activeRaid();
 const strikeAt=wolf.alert!.attackAt,initialHunger=wolf.hunger,at={...hen.at!};
 while(w.minute<=strikeAt){w.minute++;advanceFrontierHazards(w,1);}
 assert.equal(hen.status,'dead');assert.equal(hen.deathDetail,'灰狼袭击');assert.deepEqual(hen.at,at);
 assert.equal(hen.deathAt,strikeAt);
 assert.equal(state.totals.livestockAttacks,1);assert.equal(state.totals.livestockKilled,1);
 assert.equal(w.industry!.totals.animalDeaths,1);
 assert.ok(wolf.hunger<initialHunger);
 assert.ok(w.events.some(e=>e.text.includes('灰狼袭击死亡')&&distance(e.place,at)===0));
});

test('a witnessing owner can choose to physically move threatened livestock into the barn',()=>{
 const {w,state,wolf,hen}=activeRaid();
 const owner=w.residents.find(r=>r.id===hen.ownerId)!;
 owner.at={...hen.at!};owner.inside=null;
 const rescue=decisionChoices(decisionContext(w,owner)).find(c=>c.label.includes('带回畜舍')&&c.action.type==='industry'&&c.action.animalId===hen.id);
 assert.ok(rescue);
 const deadline=wolf.alert!.attackAt;
 assert.equal(submitPlan(w,{id:'shelter-livestock',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'把鸡带回畜舍',actions:[rescue.action]}).ok,true);
 stepWorld(w,deadline-w.minute+1);
 assert.equal(hen.status,'alive');
 assert.equal(hen.at,undefined);assert.equal(hen.pastureId,undefined);
 assert.ok(w.events.some(e=>e.text.includes('沿实际路线把自有鸡送到柳岸畜舍')));
 assert.equal(state.totals.livestockAttacks,0);
});

test('local habitat stock is finite, wolves die without food, and a recovered habitat draws a new individual',()=>{
 const {w,state,wolf}=frontierAtNight(),prey=state.foodPatches.find(p=>p.kind==='smallGame')!;
 const starting=prey.amount;
 wolf.at={...prey.at};wolf.hunger=56;wolf.nextMoveAt=w.minute;
 advanceFrontierHazards(w,1);
 assert.equal(prey.amount,starting-1);assert.ok(wolf.hunger<56);
 prey.amount=0;prey.progress=0;wolf.health=.01;wolf.hunger=100;w.minute++;
 advanceFrontierHazards(w,1);
 assert.equal(wolf.status,'dead');assert.equal(wolf.deathCause,'starvation');
 assert.equal(woundWildBeast(w,wolf.id,50),null);
 w.minute+=9*DAY;
 advanceFrontierHazards(w,1);
 assert.equal(state.beasts.filter(b=>b.species==='wolf').length,1,'an empty habitat cannot host an immigrant');
 prey.amount=2;w.minute++;
 advanceFrontierHazards(w,1);
 const immigrant=state.beasts.find(b=>b.species==='wolf'&&b.status==='alive');
 assert.ok(immigrant);assert.notEqual(immigrant.id,wolf.id);
 assert.equal(wolf.status,'dead');
});

test('a river blocks both close-range wildlife perception and a pending physical attack',()=>{
 const {w,wolf}=frontierAtNight(),person=w.residents[0];
 w.map.tiles=w.map.tiles.map((tile,index)=>index%w.map.width===410?'water':tile);
 wolf.at={x:409,y:222};person.at={x:411,y:222};person.inside=null;
 const health=person.health;
 wolf.alert={residentId:person.id,attackAt:w.minute};
 assert.equal(wildlifeVisible(w,person,wolf),false);
 advanceFrontierHazards(w,1);
 assert.equal(person.health,health);
});

test('initialization adds wildlife state to a 2.0.0 save without moving or replacing its animals',()=>{
 const {w,state,wolf}=frontierAtNight(),position={...wolf.at};
 wolf.alert={residentId:w.residents[0].id,attackAt:w.minute+12};
 const legacy=JSON.parse(JSON.stringify(w));
 delete legacy.frontierHazards.foodPatches;delete legacy.frontierHazards.nextBeastSerial;
 for(const beast of legacy.frontierHazards.beasts){delete beast.health;delete beast.hunger;delete beast.status;delete beast.bornAt;}
 initializeFrontierHazards(legacy);initializeFrontierHazards(legacy);
 const hydrated=legacy.frontierHazards.beasts.find((b:{id:string})=>b.id===wolf.id);
 assert.equal(hydrated.health,100);assert.equal(hydrated.status,'alive');assert.deepEqual(hydrated.at,position);
 assert.deepEqual(hydrated.alert,wolf.alert);
 assert.equal(legacy.frontierHazards.foodPatches.length,state.foodPatches.length);
});

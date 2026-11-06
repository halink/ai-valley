import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {createFormalWorld,createFrontierWorld} from '../src/world/formal-seed.js';
import {initializeInfrastructure,infrastructureFootprint,infrastructureSiteError} from '../src/world/infrastructure.js';
import {distance,findPath,reachableTiles} from '../src/world/navigation.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DAY} from '../src/world/time.js';


test('the frontier starts as a compact nine-person village on the full watershed without bridges',()=>{
 const world=createFrontierWorld(),legacy=createFormalWorld();
 assert.equal(world.id,'valley-formal-frontier-5401');
 assert.equal(world.scenario,'frontier');
 assert.deepEqual([world.map.width,world.map.height],[640,480]);
 assert.equal(world.residents.length,9);
 assert.equal(legacy.residents.length,54);
 assert.equal(world.buildings.length,5);
 assert.deepEqual(world.buildings.map(b=>b.kind),['home','home','home','lodge','barn']);
 assert.ok(world.buildings.every(b=>distance(b.door,world.map.settlement!)<=18));
 for(const home of world.buildings.filter(b=>b.kind==='home'))assert.equal(home.residents.length,3);
 assert.ok(!world.map.tiles.includes('bridge'));
 let formerBridges=0;
 for(let i=0;i<legacy.map.tiles.length;i++)if(legacy.map.tiles[i]==='bridge'){
  formerBridges++;
  assert.equal(world.map.tiles[i],'water','former bridge cells return to water');
 }
 assert.ok(formerBridges>0);
 assert.equal(world.industry?.animals.length,3);
 assert.equal(world.frontierHazards?.beasts.length,13);
 assert.equal(new Set(world.frontierHazards?.beasts.map(animal=>animal.species)).size,6);
});

test('founders can reach their farmland, freshwater, burial sites and a fishable riverbank from land',()=>{
 const world=createFrontierWorld(),reached=reachableTiles(world);
 const at=(x:number,y:number)=>y*world.map.width+x;
 const well=world.resources.find(r=>r.id==='spring-419-233')!;
 const shore={x:433,y:241};
 const fisher=world.residents.find(r=>r.id==='founder-3-2')!;
 for(const site of [well.at,shore,...world.buildings.map(b=>b.door),...world.graves.map(g=>g.at),...world.plots.map(p=>p.at),...world.industry!.pastures!.flatMap(p=>p.tiles)]){
  assert.equal(reached[at(site.x,site.y)],1,`walkable from the land entrance at ${site.x},${site.y}`);
 }
 assert.equal(world.map.tiles[at(434,241)],'water');
 assert.ok(findPath(world,fisher.at,shore)!.length<=12);
 assert.ok(world.residents.every(r=>r.knownResources.includes(well.id)&&r.knownBuildings.includes('frontier-hall')));
 for(const resident of world.residents){
  assert.ok(decisionChoices(decisionContext(world,resident)).some(({action})=>action.type==='gather'&&action.resourceId===well.id),`${resident.name} can choose to gather fresh water immediately`);
 }
 assert.equal(world.plots.length,18);
 assert.ok(world.industry!.tools.some(t=>t.ownerId===fisher.id&&t.kind==='rod'));
 assert.ok(world.residents.every(r=>!r.plan&&!r.activity&&r.lastDecisionAt===-1));
});

test('the unbridged river still allows residents to propose a real crossing',()=>{
 const world=createFrontierWorld();initializeInfrastructure(world);
 const footprint=infrastructureFootprint(world,{type:'construction',operation:'propose',kind:'bridge',scope:'public',at:{x:434,y:241},end:{x:443,y:241}})!;
 assert.ok(footprint);
 assert.equal(footprint.terrain.tiles.length,10);
 assert.equal(infrastructureSiteError(world,{...footprint,id:'bridge-plan',ownerId:'commons'},true),null);
 assert.deepEqual(world.infrastructure!.assets,[]);
 assert.ok(!world.map.tiles.includes('bridge'));
});

test('a fresh formal service persists its opening and keeps the same frontier on restart',()=>{
 const store=new WorldStore(':memory:');
 try{
  const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'});
  const world=runtime.world;
  assert.equal(world.id,'valley-formal-frontier-5401');
  assert.equal(world.residents.length,9);
  assert.equal(world.clock.realMinutesPerDay,20);
  assert.equal(world.clock.paused,true);
  assert.ok(world.migration!.nextPostAt>=world.minute+4*DAY);
  assert.ok(world.foreignTrade!.merchants.every(merchant=>merchant.person.decisionDue>=world.minute+4*DAY));
  assert.deepEqual(world.metrics.inFlight,[]);
  runtime.stop();
  const restarted=new ValleyRuntime(store,null,undefined,{mode:'formal'});
  assert.equal(restarted.world.minute,world.minute);
  assert.equal(restarted.world.id,world.id);
  assert.deepEqual(restarted.world.industry?.animals,world.industry?.animals);
  assert.deepEqual(restarted.world.frontierHazards,world.frontierHazards);
  restarted.stop();
 }finally{store.close();}
});

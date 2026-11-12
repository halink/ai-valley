import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {FrontierDisaster,WildBeast} from '../src/shared/frontier-hazards.js';
import {disasterContains} from '../src/shared/frontier-hazards.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld} from '../src/world/engine.js';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {advanceWildlife} from '../src/world/frontier-wildlife.js';
import {distance,walkable} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';
import type {Resource,Vec} from '../src/shared/types.js';

const threats={warn:()=>{},injure:()=>{},notify:()=>{}};
function fixture(kind:WildBeast['species']='deer'){
 const w=createFrontierWorld(5402),s=w.frontierHazards!,beast=s.beasts.find(b=>b.species===kind)!;
 w.minute=9*60;w.weather='sun';w.residents=[];w.industry!.animals=[];w.industry!.mines=[];
 if(w.infrastructure)w.infrastructure.assets=[];if(w.construction)w.construction.projects=[];
 w.buildings=[];w.plots=[];w.resources=[];
 w.map.width=32;w.map.height=24;w.map.tiles=Array(32*24).fill('grass');
 s.disasters=[];s.shore=null;s.beasts=[beast];s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[]};
 Object.assign(beast,{at:{x:5,y:10},den:{x:5,y:10},hunger:20,thirst:70,health:100,energy:90,nextMoveAt:w.minute,cooldownUntil:1e12,activity:{kind:'roam',reason:'synthetic water fixture'}});
 delete beast.path;delete beast.alert;delete beast.migration;
 const spring:Resource={id:'synthetic-water',kind:'spring',at:{x:11,y:10},amount:3,max:3,regrowthDays:3,lastHarvest:0};
 w.resources=[spring];return {w,s,beast,spring};
}
function advance(w:ReturnType<typeof createFrontierWorld>,minutes=1){for(let i=0;i<minutes;i++){w.minute++;advanceWildlife(w,1,threats);}}
function danger(at:Vec,kind:FrontierDisaster['kind']='windstorm'):FrontierDisaster{
 return {id:'synthetic-danger',kind,at:{...at},radius:0,phase:'active',warningAt:0,startsAt:0,endsAt:1e9,intensity:20,warned:[],exposure:{}};
}
function untilDrink(f:ReturnType<typeof fixture>,limit=220){
 const stock=f.spring.amount;
 for(let i=0;i<limit;i++){
  const at={...f.beast.at},thirst=f.beast.thirst!;advance(f.w);
  assert.ok(distance(at,f.beast.at)<=1,'water seeking cannot teleport');
  if(distance(at,f.beast.at))assert.ok(walkable(f.w,f.beast.at,at));
  assert.ok(!f.s.disasters.some(d=>d.phase==='active'&&disasterContains(d,f.beast.at)),'water route remains outside active disasters');
  if(f.spring.amount!==stock){
   assert.equal(f.spring.amount,stock-1);assert.ok(distance(f.beast.at,f.spring.at)<=1);
   assert.ok(Math.abs(f.beast.thirst!-(thirst+1/82-46))<1e-9,'original 46 thirst relief');
   assert.equal(f.spring.lastHarvest,f.w.minute);return;
  }
  assert.ok(f.beast.thirst!>=thirst,'walking itself does not supply water');
 }
 assert.fail('must physically reach and drink the finite safe spring');
}

for(const kind of ['flashFlood','windstorm'] as const){
 test(`an adjacent spring covered by active ${kind} is not consumed`,()=>{
  const f=fixture();f.spring.at={x:6,y:10};f.s.disasters=[danger(f.spring.at,kind)];advance(f.w);
  assert.equal(f.spring.amount,3);assert.equal(f.spring.lastHarvest,0);assert.ok(f.beast.thirst!>70);
  assert.notEqual(f.beast.activity?.kind,'drink');
 });
 test(`a water journey detours around active ${kind} without receiving water early`,()=>{
  const f=fixture();f.s.disasters=[danger({x:8,y:10},kind)];untilDrink(f);
 });
 test(`a cached water route rechecks a new ${kind} beyond its next step`,()=>{
  const f=fixture();advance(f.w);assert.deepEqual(f.beast.at,{x:6,y:10});
  f.s.disasters=[danger({x:8,y:10},kind)];advance(f.w,8);
  assert.equal(f.spring.amount,3);assert.ok(f.beast.path?.steps.every(at=>!disasterContains(f.s.disasters[0],at)));
  untilDrink(f);
 });
}

test('a newly dangerous water destination is replaced by another actual safe spring',()=>{
 const f=fixture();advance(f.w);f.s.disasters=[danger(f.spring.at)];
 const safe={...f.spring,id:'safe-water',at:{x:6,y:13}};f.w.resources.push(safe);advance(f.w,8);
 assert.equal(f.beast.activity?.targetId,safe.id);assert.equal(f.spring.amount,3);assert.equal(safe.amount,3);
 untilDrink({...f,spring:safe});assert.equal(f.spring.amount,3);
});

test('a dangerous water corridor does not consume water or retain the rejected water path',()=>{
 const f=fixture();advance(f.w);
 f.s.disasters=[{...danger({x:8,y:10}),footprint:Array.from({length:24},(_,y)=>({x:8,y}))}];
 advance(f.w,8);assert.notEqual(f.beast.activity?.kind,'drink');assert.equal(f.spring.amount,3);
 assert.notDeepEqual(f.beast.path?.to,f.spring.at);assert.ok(f.beast.thirst!>70);
});

test('warning and ended disasters do not block a real adjacent drink',()=>{
 for(const phase of ['warning','ended'] as const){
  const f=fixture();f.spring.at={x:6,y:10};f.s.disasters=[{...danger(f.spring.at),phase}];advance(f.w);
  assert.equal(f.spring.amount,2);assert.ok(f.beast.thirst!<25);
 }
});

test('a spring can be used after the active hazard ends without restoring its stock',()=>{
 const f=fixture();f.spring.at={x:6,y:10};f.s.disasters=[danger(f.spring.at)];advance(f.w);
 assert.equal(f.spring.amount,3);f.s.disasters[0].phase='ended';untilDrink(f);assert.equal(f.spring.amount,2);
});

test('a dangerous shore is rejected even when the danger is not a flood',()=>{
 const f=fixture();f.w.resources=[];f.s.shore={x:6,y:10};f.w.map.tiles[10*32+7]='water';
 f.s.disasters=[danger(f.s.shore)];advance(f.w);assert.ok(f.beast.thirst!>70);assert.notEqual(f.beast.activity?.kind,'drink');
});

test('safe shore drinking retains the original relief without creating spring stock',()=>{
 const f=fixture();f.w.resources=[];f.s.shore={x:6,y:10};f.w.map.tiles[10*32+7]='water';advance(f.w);
 assert.equal(f.beast.activity?.kind,'drink');assert.ok(Math.abs(f.beast.thirst!-(70+1/82-46))<1e-9);assert.deepEqual(f.w.resources,[]);
});

test('two thirsty animals cannot duplicate the last spring unit and same-minute reentry does not drink twice',()=>{
 const f=fixture();f.spring.at={x:6,y:10};f.spring.amount=1;f.s.beasts.push(structuredClone({...f.beast,id:'other-thirsty-deer'}));
 advance(f.w);assert.equal(f.spring.amount,0);assert.equal(f.s.beasts.filter(b=>b.thirst!<25).length,1);
 const before=JSON.stringify(f.w);advanceWildlife(f.w,1,threats);assert.equal(JSON.stringify(f.w),before);
});

test('SQLite water-route continuation revalidates danger and matches uninterrupted progress',()=>{
 const f=fixture();advance(f.w);f.s.disasters=[danger({x:8,y:10})];const store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,before=JSON.stringify(w.frontierHazards);
  advanceWildlife(w,1,threats);assert.equal(JSON.stringify(w.frontierHazards),before);
  untilDrink(f);advance(w,f.w.minute-w.minute);
  assert.deepEqual(w.frontierHazards,f.s);assert.deepEqual(w.resources,f.w.resources);
 }finally{store.close();}
});

for(const kind of ['boar','wolf','deer','hare','fox','duck'] as const)test(`${kind} retains ordinary safe spring use`,()=>{
 const f=fixture(kind);f.spring.at={x:6,y:10};advance(f.w);assert.equal(f.spring.amount,2);assert.ok(f.beast.thirst!<25);
});

for(const kind of ['flashFlood','windstorm'] as const)test(`safe ground beside active ${kind} water cannot supply a drink`,()=>{
 const f=fixture();f.w.resources=[];f.s.shore={x:6,y:10};const water={x:7,y:10};f.w.map.tiles[water.y*32+water.x]='water';
 f.s.disasters=[danger(water,kind)];advance(f.w);
 assert.ok(f.beast.thirst!>70);assert.notEqual(f.beast.activity?.kind,'drink');
});

test('a bank with another safe water contact still supplies one ordinary drink',()=>{
 const f=fixture();f.w.resources=[];f.s.shore={x:6,y:10};f.w.map.tiles[10*32+7]='water';f.w.map.tiles[9*32+6]='water';
 f.s.disasters=[danger({x:7,y:10},'flashFlood')];advance(f.w);
 assert.equal(f.beast.activity?.kind,'drink');assert.ok(Math.abs(f.beast.thirst!-(70+1/82-46))<1e-9);
});

test('a dry shore address is not an inexhaustible water source',()=>{
 const f=fixture();f.w.resources=[];f.s.shore={x:6,y:10};advance(f.w);
 assert.ok(f.beast.thirst!>70);assert.notEqual(f.beast.activity?.kind,'drink');
});


test('world steps and a closed SQLite restart keep unsafe water unavailable until the flood ends',()=>{
 const f=fixture();f.w.clock.paused=false;f.w.resources=[];f.s.shore={x:6,y:10};
 f.w.map.tiles[10*32+7]='water';f.s.disasters=[danger({x:7,y:10},'flashFlood')];f.s.nextDisasterAt=1e12;
 stepWorld(f.w,1);assert.ok(f.beast.thirst!>70);
 mkdirSync('output',{recursive:true});
 const dir=mkdtempSync('output/wildlife-bank-'),file=join(dir,'fixture.sqlite');
 let store=new WorldStore(file);
 try{
  store.commit(f.w,null);store.close();store=new WorldStore(file);
  const loaded=store.loadForRuntime()!,control=structuredClone(f.w);
  for(const w of [control,loaded]){
   w.frontierHazards!.disasters[0].phase='ended';
   for(let i=0;i<16;i++)stepWorld(w,1);
   assert.ok(w.frontierHazards!.beasts[0].thirst!<30,'the same real bank works once water is safe');
  }
  assert.deepEqual(loaded.frontierHazards,control.frontierHazards);
  assert.equal(loaded.metrics.requests,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

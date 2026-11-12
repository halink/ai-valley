import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Livestock,Pasture} from '../src/shared/industry.js';
import {WorldStore} from '../src/server/store.js';
import {stepWorld} from '../src/world/engine.js';
import {initializeIndustry} from '../src/world/industry.js';
import {distance,findPath,same,walkable} from '../src/world/navigation.js';
import {advancePastures} from '../src/world/pasture.js';
import {createWorld} from '../src/world/seed.js';
import {DAY} from '../src/world/time.js';
import {PastureFoodChain} from './helpers/pasture-food-chain.js';

function fixture(){
 const w=createWorld(5403);w.mode='formal';w.clock.paused=false;w.minute=600;w.weather='sun';
 w.map={...w.map,width:24,height:24,tiles:Array(24*24).fill('grass'),entrance:{x:1,y:1}};
 w.resources=[];w.plots=[];w.graves=[];w.residents=[];
 const source=w.buildings[0];w.buildings=[{...source,id:'synthetic-water-barn',kind:'barn',at:{x:2,y:2},width:6,height:4,door:{x:5,y:6},condition:100,residents:[],definition:'building/barn@1'}];
 initializeIndustry(w);
 const p:Pasture={id:'synthetic-water-yard',barnId:w.buildings[0].id,tiles:Array.from({length:15},(_,i)=>({x:2+i%5,y:9+Math.floor(i/5)})),capacity:60,forage:30,lastMinute:w.minute,
  trough:{at:{x:6,y:10},capacity:8,water:1,delivered:1,consumed:0}};
 const n:Livestock={id:'synthetic-thirsty-goat',ownerId:'synthetic-owner',kind:'goat',sex:'female',bornAt:w.minute-30*DAY,barnId:p.barnId,pastureId:p.id,at:{x:2,y:10},inside:null,pen:0,hunger:20,thirst:80,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:w.minute,energy:85};
 const blocker:Livestock={...n,id:'synthetic-resting-goat',sex:'male',at:{x:3,y:10},pen:1,thirst:0,energy:0,activity:{kind:'rest',reason:'合成低体力对照'}};
 w.industry!.pastures=[p];w.industry!.animals=[n,blocker];
 return {w,p,n,blocker};
}
function tick(f:ReturnType<typeof fixture>){stepWorld(f.w,1);}
function untilDrink(f:ReturnType<typeof fixture>,limit=120){
 const initial=f.p.trough!.water,blockingAt={...f.blocker.at!};
 for(let i=0;i<limit;i++){
  const at={...f.n.at!},thirst=f.n.thirst;tick(f);
  assert.ok(distance(at,f.n.at!)<=1,'water seeking moves at most one actual grid edge per minute');
  if(!same(at,f.n.at!))assert.ok(walkable(f.w,f.n.at!,at));
  assert.ok(f.p.tiles.some(t=>same(t,f.n.at!)),'water seeking remains in the registered pasture');
  assert.notDeepEqual(f.n.at,f.blocker.at,'animals cannot overlap');
  assert.deepEqual(f.blocker.at,blockingAt,'the low-energy animal still rests instead of clearing the path for the test');
  if(f.p.trough!.water<initial){
   assert.ok(distance(f.n.at!,f.p.trough!.at)<=1,'only actual contact supplies water');
   assert.ok(f.n.thirst<thirst);assert.ok(Math.abs(f.p.trough!.water+f.p.trough!.consumed-f.p.trough!.delivered)<1e-9);
   assert.equal(f.n.lastCaredAt,f.w.minute);return;
  }
  assert.ok(f.n.thirst>=80,'walking cannot lower thirst');
 }
 assert.fail('must take an available in-pasture detour and consume actual trough water');
}

test('thirsty livestock detour around a resting animal instead of repeatedly choosing its occupied tile',()=>{
 const f=fixture();untilDrink(f);assert.equal(f.w.metrics.requests,0);
});

test('an in-pasture route is found even when the globally shorter route leaves the yard',()=>{
 const f=fixture();f.p.tiles=[{x:2,y:10},{x:2,y:11},{x:2,y:12},{x:3,y:12},{x:4,y:12},{x:5,y:12},{x:6,y:12},{x:6,y:11},{x:6,y:10}];
 f.blocker.at={x:3,y:9};untilDrink(f);
});

test('a disconnected pasture cannot use an outside shortcut or consume water remotely',()=>{
 const f=fixture();f.p.tiles=[{x:2,y:10},{x:3,y:10},{x:5,y:10},{x:6,y:10}];
 const stock=structuredClone(f.p.trough);for(let i=0;i<90;i++)tick(f);
 assert.deepEqual(f.p.trough,stock);assert.ok(f.n.thirst>80);assert.equal(f.n.lastCaredAt,undefined);
 assert.ok(f.p.tiles.some(t=>same(t,f.n.at!)));assert.ok(f.n.at!.x<=3);
});

test('an occupied trough can still be reached at a free adjacent drinking position',()=>{
 const f=fixture();f.blocker.at={...f.p.trough!.at};untilDrink(f);assert.notDeepEqual(f.n.at,f.p.trough!.at);
});

test('a new obstruction changes the next water route without resetting the animal or water',()=>{
 const f=fixture();f.blocker.at={x:3,y:9};for(let i=0;i<15;i++)tick(f);
 assert.deepEqual(f.n.at,{x:3,y:10});assert.equal(f.p.trough!.water,1);
 f.blocker.at={x:4,y:10};untilDrink(f);
});

test('same-minute reentry and SQLite reload retain finite water and the actual route continuation',()=>{
 const f=fixture();for(let i=0;i<15;i++)tick(f);
 const store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,restored={w,p:w.industry!.pastures![0],n:w.industry!.animals[0],blocker:w.industry!.animals[1]};
  const before=JSON.stringify(w.industry);advancePastures(w);assert.equal(JSON.stringify(w.industry),before);
  untilDrink(f);untilDrink(restored);assert.deepEqual(restored.p,f.p);assert.deepEqual(restored.n,f.n);
  const after=JSON.stringify(w.industry);advancePastures(w);assert.equal(JSON.stringify(w.industry),after);
 }finally{store.close();}
});

for(const location of ['empty','outside','blocked'] as const)test(`the ${location} trough does not provide water`,()=>{
 const f=fixture();
 if(location==='empty')f.p.trough!.water=0;
 if(location==='outside')f.p.trough!.at={x:7,y:10};
 if(location==='blocked')f.w.map.tiles[10*f.w.map.width+6]='cliff';
 const stock=structuredClone(f.p.trough);for(let i=0;i<90;i++)tick(f);
 assert.deepEqual(f.p.trough,stock);assert.equal(f.n.lastCaredAt,undefined);assert.ok(f.n.thirst>80);
});

test('numbered water delivery feeds only the real trough, then autonomous detouring reaches that same finite stock',()=>{
 const built=new PastureFoodChain().build().seedAnimalsAndAdmit();
 built.walk(built.owner,built.barn.door);
 built.select(a=>a.type==='industry'&&a.operation==='moveAnimal'&&a.animalId===built.newcomerId&&a.pastureId===built.pasture.id,'escort the second actual animal');
 // Explicit synthetic placement/needs isolate the water-routing counterexample.
 // Land, construction, both admissions and delivered water use ordinary actions.
 const f={w:built.world,p:built.pasture,n:built.goat,blocker:built.newcomer};
 f.n.at={...[...f.p.tiles].sort((a,b)=>distance(b,f.p.trough!.at)-distance(a,f.p.trough!.at))[0]};
 f.blocker.at={...findPath(f.w,f.n.at!,f.p.trough!.at)![0]};
 for(const n of [f.n,f.blocker]){n.thirst=0;n.energy=0;n.activity={kind:'rest',reason:'合成饮水寻路前置'};}
 const inventory=structuredClone(built.owner.inventory);
 built.industry('fillTrough',f.p.id);
 assert.equal(built.owner.inventory.water,inventory.water!-1);assert.equal(f.p.trough!.water,1);assert.equal(f.p.trough!.consumed,0);
 f.n.thirst=80;f.n.energy=85;
 untilDrink(f);
 assert.equal(built.owner.inventory.water,inventory.water!-1);assert.equal(built.owner.inventory.fodder,inventory.fodder);
 assert.equal(f.w.metrics.requests,0);assert.ok(f.w.residents.every(r=>r.activity===null&&r.plan===null));
 assert.equal(built.selections.filter(s=>s.action.type==='industry'&&s.action.operation==='fillTrough').length,1);
});

for(const kind of ['chicken','duck','goat','sheep','cow'] as const)test(`${kind} uses the same contact route without duplicating the final water fraction`,()=>{
 const f=fixture();f.n.kind=kind;f.p.trough!.water=f.p.trough!.delivered=.01;
 untilDrink(f);assert.equal(f.p.trough!.water,0);assert.equal(f.p.trough!.consumed,.01);
 const thirsty=f.n.thirst;for(let i=0;i<5;i++)tick(f);
 assert.equal(f.p.trough!.water,0);assert.equal(f.p.trough!.consumed,.01);assert.ok(f.n.thirst>thirsty);
});

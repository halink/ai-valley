import {YEAR} from '../src/world/time.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeProduction} from '../src/world/production.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import type {Action,World} from '../src/shared/types.js';
function fixture(){
 const w=createWorld();w.clock.paused=false;
 const r=w.residents[0];w.residents=[r];w.resources=[];w.buildings=[];w.events=[];
 w.map={width:50,height:50,tiles:Array(2500).fill('grass'),entrance:{x:0,y:0},name:'work feedback fixture'};
 Object.assign(r,{at:{x:20,y:20},inside:null,roomAt:null,homeId:null,inventory:{water:4,seed:4},knownBuildings:[],knownResources:[],knownPeople:[],memories:[],hunger:0,energy:100,health:100,plan:null,activity:null});
 const p={id:'field',ownerId:r.id,at:{...r.at},crop:null};w.plots=[p];
 const start=(a:Action)=>assert.equal(submitPlan(w,{id:'work:'+w.revision,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:'action/routine@1',intention:'work feedback fixture',actions:[a]}).ok,true);
 const finish=()=>{for(let i=0;i<120&&(r.plan||r.activity);i++)stepWorld(w,1);};
 return {w,r,p,start,finish};
}
// Inspect authoritative engine facts directly; no retired display tracker.
const completed=(w:World,after:number)=>w.events.slice(after).filter(e=>e.workCompleted);
test('actual planting, watering and harvest produce one authoritative completion event with matching memory',()=>{
 const {w,r,p,start,finish}=fixture();
 for(const action of ['plant','water','harvest'] as const){
  if(action==='harvest')w.plots[0].crop!.growth=999;
  const before=w.events.length;start({type:action,plotId:p.id});finish();assert.equal(r.lastFailure,null);
  const rows=completed(w,before);assert.equal(rows.length,1);const event=rows[0];
  assert.equal(event.workCompleted!.action,action);assert.equal(event.workCompleted!.residentId,r.id);assert.deepEqual(event.place,r.at);
  assert.ok(event.workCompleted!.planId);assert.ok(Number.isFinite(event.workCompleted!.startedAt));
  assert.equal(r.memories.find(m=>m.eventId===event.id)?.text,event.text);
  const saved=structuredClone(w);stepWorld(w,1);assert.deepEqual(completed(w,before),completed(saved,before));
 }
});
test('unfinished, paused and invalidated work never produces an authoritative success event',()=>{
 const {w,r,p,start,finish}=fixture();start({type:'plant',plotId:p.id});stepWorld(w,1);assert.ok(r.activity);assert.deepEqual(completed(w,0),[]);
 w.clock.paused=true;const before=structuredClone(w);stepWorld(w,100);assert.deepEqual(w,before);
 w.clock.paused=false;r.inventory.seed=0;finish();assert.ok(r.lastFailure);assert.deepEqual(completed(w,0),[]);
});
test('a success followed by failed work retains only the actual success receipt',()=>{
 const {w,r,p,start,finish}=fixture();start({type:'plant',plotId:p.id});finish();assert.equal(completed(w,0).length,1);
 const before=w.events.length;start({type:'water',plotId:p.id});stepWorld(w,1);r.inventory.water=0;finish();assert.ok(r.lastFailure);assert.deepEqual(completed(w,before),[]);assert.equal(completed(w,0).length,1);
});
test('gather completion and competing depletion have distinct authoritative outcomes',()=>{
 const {w,r,start,finish}=fixture();w.resources=[{id:'rock',kind:'rock',at:{...r.at},amount:2,max:2,regrowthDays:0,lastHarvest:0}];r.knownResources=['rock'];
 start({type:'gather',resourceId:'rock',quantity:1});finish();assert.equal(r.lastFailure,null);assert.equal(completed(w,0)[0].workCompleted!.action,'gather');
 const before=w.events.length;start({type:'gather',resourceId:'rock',quantity:1});stepWorld(w,1);w.resources[0].amount=0;finish();assert.ok(r.lastFailure);assert.deepEqual(completed(w,before),[]);
});
test('orchard operations and production planting produce authoritative action and operation identities',()=>{
 const {w,r,p,start,finish}=fixture();w.mode='formal';initializeIndustry(w);initializeProduction(w);r.bornAt=w.minute-25*YEAR;r.inventory.sapling=1;
 const run=(a:Action)=>{const before=w.events.length;start(a);finish();assert.equal(r.lastFailure,null);const rows=completed(w,before);assert.equal(rows.length,1);assert.equal(rows[0].workCompleted!.action,a.type);return rows[0].workCompleted!;};
 assert.equal(run({type:'industry',operation:'plantTree',plotId:p.id}).operation,'plantTree');const tree=w.industry!.trees[0];
 assert.equal(run({type:'industry',operation:'tendTree',treeId:tree.id}).operation,'tendTree');tree.status='mature';tree.fruit=2;
 assert.equal(run({type:'industry',operation:'harvestFruit',treeId:tree.id}).operation,'harvestFruit');
 assert.equal(run({type:'industry',operation:'cutTree',treeId:tree.id}).operation,'cutTree');
 assert.equal(run({type:'production',operation:'plantCrop',plotId:p.id,cropId:'crop/turnip@2'}).operation,'plantCrop');
});
test('fishing completion records success but depleted stocks do not',()=>{
 const {w,r,start,finish}=fixture();w.mode='formal';r.bornAt=w.minute-25*YEAR;
 w.map={width:40,height:36,tiles:Array(40*36).fill('grass'),entrance:{x:1,y:1},name:'fishing receipt fixture'};r.at={x:29,y:10};
 for(let y=5;y<20;y++)w.map.tiles[y*40+30]='water';initializeIndustry(w);r.inventory.rodKit=1;
 start({type:'industry',operation:'equip',tool:'rod'});finish();assert.equal(r.lastFailure,null);
 let before=w.events.length;start({type:'industry',operation:'fish',at:{...r.at},fishSpecies:'perch'});finish();assert.equal(r.lastFailure,null);
 const rows=completed(w,before);assert.equal(rows.length,1);assert.equal(rows[0].workCompleted!.operation,'fish');
 before=w.events.length;start({type:'industry',operation:'fish',at:{...r.at},fishSpecies:'perch'});stepWorld(w,1);
 for(const pool of Object.values(w.industry!.fishing)){pool.amount=0;for(const stock of Object.values(pool.species??{}))if(stock){stock.amount=0;stock.progress=0;}}
 finish();assert.ok(r.lastFailure);assert.deepEqual(completed(w,before),[]);
});

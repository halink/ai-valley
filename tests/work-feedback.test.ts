import {YEAR} from '../src/world/time.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeProduction} from '../src/world/production.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorkFeedback} from '../src/client/work-feedback.js';
import type {Action,WorldEvent} from '../src/shared/types.js';
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
test('actual engine planting, watering and harvest successes attach identity only to existing facts',()=>{
 const {w,r,p,start,finish}=fixture(),feedback=new WorkFeedback();assert.deepEqual(feedback.inspect(w),[]);
 for(const action of ['plant','water','harvest'] as const){
  if(action==='harvest')w.plots[0].crop!.growth=999;
  start({type:action,plotId:p.id});finish();assert.equal(r.lastFailure,null);
  const receipts=feedback.inspect(w);assert.equal(receipts.length,1);assert.equal(receipts[0].workCompleted.action,action);assert.equal(receipts[0].workCompleted.residentId,r.id);assert.deepEqual(receipts[0].place,r.at);
  assert.deepEqual(feedback.inspect(structuredClone(w)),[]);
  assert.equal(r.memories.find(m=>m.eventId===receipts[0].id)?.text,w.events.find(e=>e.id===receipts[0].id)?.text);
 }
});
test('remaining work, paused world and changed resources never generate success feedback',()=>{
 const {w,r,p,start,finish}=fixture(),feedback=new WorkFeedback();feedback.inspect(w);
 start({type:'plant',plotId:p.id});stepWorld(w,1);assert.ok(r.activity);assert.deepEqual(feedback.inspect(w),[]);
 w.clock.paused=true;const before=structuredClone(w);stepWorld(w,100);assert.deepEqual(w,before);assert.deepEqual(feedback.inspect(w),[]);
 w.clock.paused=false;r.inventory.seed=0;finish();assert.ok(r.lastFailure);assert.deepEqual(feedback.inspect(w),[]);assert.equal(w.events.some(e=>e.workCompleted),false);
});
test('success followed by failed work only reports actual success, not textual failure events',()=>{
 const {w,r,p,start,finish}=fixture(),feedback=new WorkFeedback();feedback.inspect(w);
 start({type:'plant',plotId:p.id});finish();assert.equal(feedback.inspect(w).length,1);
 start({type:'water',plotId:p.id});stepWorld(w,1);r.inventory.water=0;finish();assert.ok(r.lastFailure);assert.deepEqual(feedback.inspect(w),[]);
});
function event(id:string,at:number):WorldEvent{return {id,at,kind:'action',actors:['r'],witnesses:[],place:{x:2,y:3},text:'arbitrary text',workCompleted:{residentId:'r',planId:'p',startedAt:1,action:'water'}};}
test('tracker suppresses baseline/reconnect, stale/repeated snapshots, old history, invalid/future/unstructured facts',()=>{
 const tracker=new WorkFeedback(),w={id:'test',minute:10,revision:1,events:[event('initial',10)]};
 assert.deepEqual(tracker.inspect(w),[]);w.minute=11;w.revision++;
 w.events.push(event('fresh',11));const original=structuredClone(w);const result=tracker.inspect(w);assert.equal(result.length,1);assert.deepEqual(w,original);
 result[0].place.x=100;assert.equal(w.events[1].place.x,2);
 assert.deepEqual(tracker.inspect({...w,minute:10,revision:1}),[]);assert.deepEqual(tracker.inspect(w),[]);
 const plain=event('plain',11);delete plain.workCompleted;
 w.events.push(event('historical',9),event('future',99),plain,{...event('invalid',11),workCompleted:{...event('x',1).workCompleted!,startedAt:NaN}});w.revision++;
 assert.deepEqual(tracker.inspect(w),[]);
 tracker.reset();w.events.push(event('reconnected',11));assert.deepEqual(tracker.inspect(w),[]);
 assert.deepEqual(tracker.inspect({...w,id:'other-world'}),[]);
});
test('receipt retains original event room rather than the resident current position',()=>{
 const tracker=new WorkFeedback(),w={id:'test',minute:10,revision:1,events:[] as WorldEvent[]};tracker.inspect(w);
 w.events.push({...event('room',11),roomId:'workshop',roomAt:{x:3,y:4}});w.minute=11;w.revision++;
 assert.deepEqual(tracker.inspect(w)[0].roomAt,{x:3,y:4});
});

test('gather success and a competing depletion report only completed gathering',()=>{
 const {w,r,start,finish}=fixture(),feedback=new WorkFeedback();
 w.resources=[{id:'rock',kind:'rock',at:{...r.at},amount:2,max:2,regrowthDays:0,lastHarvest:0}];r.knownResources=['rock'];feedback.inspect(w);
 start({type:'gather',resourceId:'rock',quantity:1});finish();assert.equal(r.lastFailure,null);assert.equal(feedback.inspect(w)[0].workCompleted.action,'gather');
 start({type:'gather',resourceId:'rock',quantity:1});stepWorld(w,1);w.resources[0].amount=0;finish();assert.ok(r.lastFailure);assert.deepEqual(feedback.inspect(w),[]);
});
test('industry orchard operations and production planting yield supported authoritative receipts',()=>{
 const {w,r,p,start,finish}=fixture();w.mode="formal";initializeIndustry(w);initializeProduction(w);r.bornAt=w.minute-25*YEAR;r.inventory.sapling=1;
 const feedback=new WorkFeedback();feedback.inspect(w);
 const run=(a:Action)=>{start(a);finish();assert.equal(r.lastFailure,null);const receipt=feedback.inspect(w);assert.equal(receipt.length,1);assert.equal(receipt[0].workCompleted.action,a.type);return receipt[0];};
 assert.equal(run({type:'industry',operation:'plantTree',plotId:p.id}).workCompleted.operation,'plantTree');
 const tree=w.industry!.trees[0];
 assert.equal(run({type:'industry',operation:'tendTree',treeId:tree.id}).workCompleted.operation,'tendTree');
 tree.status='mature';tree.fruit=2;
 assert.equal(run({type:'industry',operation:'harvestFruit',treeId:tree.id}).workCompleted.operation,'harvestFruit');
 assert.equal(run({type:'industry',operation:'cutTree',treeId:tree.id}).workCompleted.operation,'cutTree');
 assert.equal(run({type:'production',operation:'plantCrop',plotId:p.id,cropId:'crop/turnip@2'}).workCompleted.operation,'plantCrop');
});
test('fishing completion and stock depletion failure are distinct',()=>{
 const {w,r,start,finish}=fixture();w.mode='formal';r.bornAt=w.minute-25*YEAR;
 w.map={width:40,height:36,tiles:Array(40*36).fill('grass'),entrance:{x:1,y:1},name:'fishing feedback fixture'};r.at={x:29,y:10};
 for(let y=5;y<20;y++)w.map.tiles[y*40+30]='water';
 initializeIndustry(w);r.inventory.rodKit=1;
 start({type:'industry',operation:'equip',tool:'rod'});finish();assert.equal(r.lastFailure,null);
 const tracker=new WorkFeedback();tracker.inspect(w);
 start({type:'industry',operation:'fish',at:{...r.at},fishSpecies:'perch'});finish();assert.equal(r.lastFailure,null);
 assert.equal(tracker.inspect(w)[0].workCompleted.operation,'fish');
 start({type:'industry',operation:'fish',at:{...r.at},fishSpecies:'perch'});stepWorld(w,1);
 for(const pool of Object.values(w.industry!.fishing)){pool.amount=0;for(const stock of Object.values(pool.species??{}))if(stock){stock.amount=0;stock.progress=0;}}
 finish();assert.ok(r.lastFailure);assert.deepEqual(tracker.inspect(w),[]);
});

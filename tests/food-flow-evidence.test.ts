import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan,hasTimelySelfRescue} from '../src/world/engine.js';
import {captureDirectEating,foodFlowInputs,type FoodFlowReceipt} from '../src/world/food-consumption-evidence.js';
import {foodTransaction} from '../src/world/food.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,World} from '../src/shared/types.js';
import {DAY} from '../src/world/time.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 for(const r of w.residents){r.hunger=20;r.energy=r.health=100;r.inventory={turnip:10,water:10,berry:1,meal:1};}
 stepWorld(w,1);const r=w.residents[0];
 w.resources.push({id:'flow-bush',kind:'bush',at:{x:r.at.x+1,y:r.at.y},amount:12,max:12,regrowthDays:0,lastHarvest:0});r.knownResources.push('flow-bush');
 w.plots.push({id:'flow-field',ownerId:r.id,at:{...r.at},crop:{definition:'crop/turnip@1',planted:0,growth:10,wateredDay:-1,lastGrowthDay:0}});
 return {w,r};
}
let serial=0;
function queue(w:World,action:Action){const r=w.residents[0];assert.deepEqual(submitPlan(w,{id:`flow-plan:${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Synthetic physical flow evidence',actions:[action]}),{ok:true});}
function finish(w:World){const receipts:FoodFlowReceipt[]=[];let left=1000;while(w.residents[0].plan||w.residents[0].activity){assert.ok(left--);receipts.push(...stepWorldWithFoodEvidence(w,1).foodFlows!);}return receipts;}

test('berry source facts use actual addition and newly created lot, not existing stock or action counts',()=>{
 const {w,r}=fixture(),container='person:'+r.id;
 w.definitions['food/life@90']={...w.definitions['food/life@1'],version:90,data:{...w.definitions['food/life@1'].data,nutrition:{berry:19}}};
 w.activeDefinitions['food/life']='food/life@90';
 const original=structuredClone(w.food!.lots[container].berry![0]);
 queue(w,{type:'gather',resourceId:'flow-bush',quantity:2});const rows=finish(w);
 assert.equal(rows.length,1);const receipt=rows[0];assert.equal(receipt.type,'source_added');assert.equal(receipt.action,'gather_berry');
 assert.deepEqual(receipt.outputs[0],{item:'berry',quantity:2,nutrition:38,lots:[{quantity:2,producedAt:w.minute,expiresAt:w.minute+4*DAY,definition:'food/life@90',nutrition:38}]});
 assert.equal(r.inventory.berry,3);assert.equal(w.resources.find(v=>v.id==='flow-bush')!.amount,10);
 assert.deepEqual(w.food!.lots[container].berry![0],original);assert.ok(w.events.some(e=>e.id===receipt.eventId&&e.at===receipt.at));
 assert.equal(stepWorldWithFoodEvidence(w,1).foodFlows!.length,0);
});

test('field source records actual original crop definition and yield, separate from cooking',()=>{
 const {w,r}=fixture(),p=w.plots.find(p=>p.id==='flow-field')!;
 w.definitions['crop/turnip@90']={...w.definitions['crop/turnip@1'],version:90,data:{...w.definitions['crop/turnip@1'].data,yield:7}};p.crop!.definition='crop/turnip@90';
 queue(w,{type:'harvest',plotId:p.id});const rows=finish(w);
 assert.equal(rows.length,1);assert.equal(rows[0].action,'harvest');assert.equal(rows[0].definition,'crop/turnip@90');
 assert.equal(rows[0].outputs[0].quantity,7);assert.equal(r.inventory.turnip,17);assert.equal(p.crop,null);
 assert.equal(rows[0].outputs[0].lots![0].quantity,7);assert.equal(rows[0].outputs[0].nutrition,7*20);
});

test('ordinary cook preserves gross original batch inputs and actual fresh outputs, never eat or net production',()=>{
 const {w,r}=fixture(),container='person:'+r.id;
 w.definitions['food/life@90']={...w.definitions['food/life@1'],version:90,data:{...w.definitions['food/life@1'].data,nutrition:{turnip:11}}};
 w.definitions['food/life@91']={...w.definitions['food/life@1'],version:91,data:{...w.definitions['food/life@1'].data,nutrition:{turnip:23,meal:51}}};
 w.food!.lots[container].turnip=[{quantity:.5,producedAt:w.minute-20,expiresAt:w.minute+1000,definition:'food/life@90'},
  {quantity:9.5,producedAt:w.minute-10,expiresAt:w.minute+2000,definition:'food/life@91'}];
 w.activeDefinitions['food/life']='food/life@91';queue(w,{type:'cook',quantity:1});
 const observer=createIsolationEvidence(w),eats:unknown[]=[];let left=1000;
 while(r.plan||r.activity){assert.ok(left--);const observation=stepWorldWithFoodEvidence(w,1);eats.push(...observation.receipts);observer.sample(w,observation);}
 const row=observer.finish(w)!,receipt=row.foodFlows.receipts[0];assert.equal(receipt.type,'processed');if(receipt.type!=='processed')return;
 assert.equal(receipt.action,'cook');assert.equal(receipt.definition,'recipe/meal@1');assert.deepEqual(eats,[]);
 const input=receipt.inputs.find(a=>a.item==='turnip')!;assert.equal(input.quantity,2);assert.equal(input.nutrition,40);
 assert.deepEqual(input.lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.5,'food/life@90',5.5],[1.5,'food/life@91',34.5]]);
 assert.deepEqual(receipt.inputs.find(a=>a.item==='water'),{item:'water',quantity:1,nutrition:0,lots:[]});
 assert.equal(receipt.outputs[0].quantity,1);assert.equal(receipt.outputs[0].nutrition,51);assert.equal(receipt.outputs[0].lots![0].producedAt,receipt.at);
 assert.deepEqual(row.foodFlows.totals,{sourceAdded:{units:{},nutrition:0},processingInputs:{units:{turnip:2,water:1},nutrition:40},processingOutputs:{units:{meal:1},nutrition:51}});
 assert.equal(row.foodProduction.value,null);assert.equal(row.foodConsumption.value,null);
 assert.equal(r.inventory.turnip,8);assert.equal(r.inventory.water,9);assert.equal(r.inventory.meal,2);
 assert.deepEqual(w.food!.lots[container].turnip!.map(l=>[l.quantity,l.definition]),[[8,'food/life@91']]);
});

test('failed gather, crop loss and spoiled cooking inputs do not create physical-flow success',()=>{
 for(const action of [{type:'gather',resourceId:'flow-bush',quantity:2},{type:'harvest',plotId:'flow-field'},{type:'cook',quantity:1}] as Action[]){
  const {w,r}=fixture();queue(w,action);assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
  if(action.type==='gather')w.resources.find(v=>v.id==='flow-bush')!.amount=0;
  if(action.type==='harvest')w.plots.find(v=>v.id==='flow-field')!.crop=null;
  if(action.type==='cook')for(const lot of w.food!.lots['person:'+r.id].turnip!)lot.expiresAt=w.minute+1;
  assert.deepEqual(finish(w),[]);assert.ok(r.lastFailure);
 }
});

test('transfers, nonfood gathering, inventory repair and unrelated fresh production cannot be counted',()=>{
 const {w,r}=fixture(),other=w.residents[1];
 const observed=captureDirectEating(w,()=>foodTransaction(w,()=>{r.inventory.berry!--;other.inventory.berry!++;r.inventory.meal!++;}));
 assert.deepEqual(observed.foodFlows,[]);
 const tree=w.resources.find(v=>v.kind==='tree')!;tree.at={x:r.at.x+1,y:r.at.y};r.knownResources.push(tree.id);
 queue(w,{type:'gather',resourceId:tree.id,quantity:1});assert.deepEqual(finish(w),[]);
});

test('optional capture, forecasts and no-op observations do not mutate world, context or save',()=>{
 const observed=createFrontierWorld();observed.clock.paused=false;queue(observed,{type:'cook',quantity:1});
 const plain=structuredClone(observed);for(let i=0;i<100;i++){stepWorldWithFoodEvidence(observed,1);stepWorld(plain,1);}
 assert.deepEqual(observed,plain);assert.deepEqual(decisionContext(observed,observed.residents[0]),decisionContext(plain,plain.residents[0]));
 const w=fixture().w,r=w.residents[0];r.hunger=98;r.energy=19;const before=structuredClone(w);
 const observation=captureDirectEating(w,()=>{hasTimelySelfRescue(w,r,[{type:'cook',quantity:1},{type:'gather',resourceId:'flow-bush',quantity:2}]);});
 assert.deepEqual(observation.foodFlows,[]);assert.deepEqual(w,before);
 // These query helpers never call initialization or enumerate containers.
 delete w.food;const missing=structuredClone(w);captureDirectEating(w,()=>foodFlowInputs(w,'person:'+r.id,{turnip:2},1));assert.deepEqual(w,missing);
 const store=new WorldStore(':memory:');try{store.commit(observed,null);assert.equal(JSON.stringify(store.load(true)!).includes('foodFlows'),false);}finally{store.close();}
});

test('daily flow coverage loses totals on a gap, handles legacy observations and resets at day boundary',()=>{
 const {w}=fixture();w.minute=DAY-6;queue(w,{type:'gather',resourceId:'flow-bush',quantity:2});const observer=createIsolationEvidence(w);
 let row:ReturnType<typeof observer.sample>=null;for(let i=0;i<6;i++)row=observer.sample(w,stepWorldWithFoodEvidence(w,1));
 assert.equal(row!.toMinute,DAY);assert.equal(row!.foodFlows.receipts[0].at,DAY);assert.equal(row!.foodFlows.totals!.sourceAdded.units.berry,2);
 observer.sample(w,stepWorldWithFoodEvidence(w,1));assert.equal(observer.finish(w)!.foodFlows.observedMinutes,1);
 const legacy=stepWorldWithFoodEvidence(w,1);delete legacy.foodFlows;observer.sample(w,legacy);
 observer.sample(w,stepWorldWithFoodEvidence(w,1));assert.equal(observer.finish(w)!.foodFlows.totals,null);assert.equal(observer.finish(w)!.foodFlows.unobservedMinutes,1);
 assert.notEqual(observer.finish(w)!.directEating.totals,null);
});

test('mid-action SQLite reload keeps original cooking lots, emits once, and never backfills a new observer',()=>{
 let {w}=fixture();queue(w,{type:'cook',quantity:1});stepWorldWithFoodEvidence(w,2);
 const store=new WorldStore(':memory:');try{
  store.commit(w,null);const savedRevision=w.revision;w=store.load(true)!;const receipts=finish(w);assert.equal(receipts.length,1);assert.equal(receipts[0].action,'cook');
  assert.equal(stepWorldWithFoodEvidence(w,1).foodFlows!.length,0);
  store.commit(w,savedRevision);w=store.load(true)!;const observer=createIsolationEvidence(w);observer.sample(w,stepWorldWithFoodEvidence(w,1));
  assert.deepEqual(observer.finish(w)!.foodFlows.receipts,[]);
 }finally{store.close();}
});

test('capture failure after real gathering cannot replay receipts or attach hooks to later actions',()=>{
 const {w,r}=fixture();queue(w,{type:'gather',resourceId:'flow-bush',quantity:2});
 assert.throws(()=>captureDirectEating(w,()=>{stepWorld(w,6);throw new Error('synthetic failure');}),/synthetic failure/);
 assert.equal(r.inventory.berry,3);assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodFlows,[]);
 queue(w,{type:'gather',resourceId:'flow-bush',quantity:1});assert.equal(finish(w).length,1);
});

test('missing original nutrition or lot coverage stays unknown and observation does not repair it',()=>{
 const {w,r}=fixture(),container='person:'+r.id;w.food!.lots[container].turnip![0].definition='missing/food@1';
 const before=structuredClone(w);let inputs:ReturnType<typeof foodFlowInputs>;
 captureDirectEating(w,()=>{inputs=foodFlowInputs(w,container,{turnip:2},1);});
 assert.equal(inputs![0].nutrition,null);assert.equal(inputs![0].lots![0].definition,'missing/food@1');assert.deepEqual(w,before);
 w.food!.lots[container].turnip![0].quantity=.5;const incomplete=structuredClone(w);
 captureDirectEating(w,()=>{inputs=foodFlowInputs(w,container,{turnip:2},1);});assert.equal(inputs![0].lots,null);assert.equal(inputs![0].nutrition,null);assert.deepEqual(w,incomplete);
});

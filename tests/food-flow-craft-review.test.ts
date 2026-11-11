import assert from 'node:assert/strict';
import test from 'node:test';
import {craftFlowFixture,runCraftFlow,queueCraftFlow,finishCraftFlow,craftReceipts} from './helpers/food-flow-craft.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';

function nearlyDone(){
 const f=craftFlowFixture();assert.deepEqual(craftReceipts(runCraftFlow(f.w,f.r,'gameMeal',34)),[]);
 queueCraftFlow(f.w,f.r,'gameMeal',1);return {...f,batch:f.w.industry!.batches[0]};
}

test('independent review: fractional work boundary records exactly one actual completion',()=>{
 const {w,r,batch}=nearlyDone();const receipts=[];
 for(let i=0;i<20&&(r.plan||r.activity);i++){
  const before=batch.worked,o=stepWorldWithFoodEvidence(w,.25),flows=craftReceipts([o]);
  if(batch.status==='working'){assert.equal(flows.length,0);assert.ok(batch.worked<batch.recipe.minutes);}
  else {assert.ok(before<batch.recipe.minutes);assert.equal(flows.length,1);assert.equal(r.inventory.meal,2);}
  receipts.push(...flows);
 }
 assert.equal(receipts.length,1);assert.deepEqual(checkedFoodFlow(receipts[0]),receipts[0]);
 assert.deepEqual(stepWorldWithFoodEvidence(w,.125).foodFlows,[]);
});

test('independent review: nested same-world refusal does not poison outer capture or another world',()=>{
 const a=nearlyDone(),b=nearlyDone();let other;
 const observed=captureDirectEating(a.w,()=>{
  assert.throws(()=>captureDirectEating(a.w,()=>stepWorld(a.w,1)),/nested/);
  other=captureDirectEating(b.w,()=>{while(b.r.plan||b.r.activity)stepWorld(b.w,.5);});
  while(a.r.plan||a.r.activity)stepWorld(a.w,.5);
 });
 assert.equal(craftReceipts([observed]).length,1);assert.equal(craftReceipts([other!]).length,1);
 assert.notEqual(observed.foodFlows,other!.foodFlows);
 assert.deepEqual(stepWorldWithFoodEvidence(a.w,1).foodFlows,[]);
});

test('independent review: prediction completion remains invisible and cannot mutate original lot evidence',()=>{
 const {w,r,batch}=nearlyDone(),prediction=copyForSimulation(w),before=structuredClone(w);
 const predicted=captureDirectEating(w,()=>{while(prediction.residents[0].plan||prediction.residents[0].activity)stepWorld(prediction,.25);});
 assert.deepEqual(predicted.foodFlows,[]);assert.deepEqual(w,before);assert.equal(batch.status,'working');
 const flow=craftReceipts(finishCraftFlow(w,r))[0];assert.equal(flow.inputs.find(i=>i.item==='gameMeat')!.quantity,1);
 assert.equal(flow.outputs[0].quantity,2);
});

test('independent review: observed snapshot is detached from later batch economics and lot changes',()=>{
 const {w,r,batch}=nearlyDone(),flow=craftReceipts(finishCraftFlow(w,r))[0],saved=structuredClone(flow);
 batch.recipe.input.gameMeat=9;batch.recipe.output.meal=17;batch.input.gameMeat=99;
 w.food!.lots['person:'+r.id].meal![0].quantity=29;
 assert.deepEqual(flow,saved);assert.deepEqual(checkedFoodFlow(flow),saved);
});

test('independent review: malformed original lot nutrition is never reconstructed from the current definition',()=>{
 for(const value of [-1,NaN,Infinity,'42']){
  const {w,r,batch}=nearlyDone(),lot=w.food!.lots['craft:'+batch.id].gameMeat![0];
  lot.definition='food/review-original@1';w.definitions[lot.definition]={id:'food/review-original',version:1,kind:'life',dependencies:[],data:{nutrition:{gameMeat:value}}};
  const flow=craftReceipts(finishCraftFlow(w,r))[0],input=flow.inputs.find(i=>i.item==='gameMeat')!;
  assert.equal(input.nutrition,null);assert.equal(input.lots![0].nutrition,null);assert.equal(input.lots![0].definition,lot.definition);
  assert.deepEqual(checkedFoodFlow(flow),flow);
 }
});

test('independent review: dynamic same-item output keeps gross economics without inventing fresh lots',()=>{
 const {w,r}=craftFlowFixture();
 const definition=w.definitions['recipe/industry/gameMeal@1'];
 definition.data={...definition.data,output:{gameMeat:1,meal:1}};
 const original=structuredClone(w.food!.lots['person:'+r.id].gameMeat);
 const flow=craftReceipts(runCraftFlow(w,r))[0];
 assert.deepEqual(flow.recipe.output,{gameMeat:1,meal:1});
 assert.equal(flow.inputs.find(a=>a.item==='gameMeat')!.quantity,1);
 assert.deepEqual(flow.outputs.find(a=>a.item==='gameMeat'),{item:'gameMeat',quantity:1,nutrition:null,lots:null});
 assert.deepEqual(w.food!.lots['person:'+r.id].gameMeat,original);
 assert.equal(flow.outputs.find(a=>a.item==='meal')!.lots![0].producedAt,flow.at);
 assert.deepEqual(checkedFoodFlow(flow),flow);
});

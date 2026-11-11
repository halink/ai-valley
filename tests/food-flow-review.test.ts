import {FOOD_FLOW_COVERAGE} from '../src/world/food-consumption-evidence.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {captureDirectEating,foodFlowInputs,type FoodFlowReceipt} from '../src/world/food-consumption-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {auditRuntimeFoodEvidence} from '../src/server/nine-resident-acceptance.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';
import type {Action,World} from '../src/shared/types.js';
function fixture(){const w=createWorld();w.mode='formal';w.clock.paused=false;for(const r of w.residents){r.hunger=20;r.energy=r.health=100;r.inventory={turnip:10,water:10,meal:5};}stepWorld(w,1);return w;}
function queue(w:World,action:Action){const r=w.residents[0];assert.deepEqual(submitPlan(w,{id:'review-plan',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Synthetic independent review',actions:[action]}),{ok:true});}
function finish(w:World){const flows:FoodFlowReceipt[]=[];let limit=100;while(w.residents[0].plan||w.residents[0].activity){assert.ok(limit--);flows.push(...stepWorldWithFoodEvidence(w,1).foodFlows!);}return flows;}
function flow():FoodFlowReceipt{return {type:'source_added',action:'gather_berry',at:481,residentId:'r',eventId:'event',planId:'plan',container:'person:r',sourceId:'bush',definition:'action/routine@1',outputs:[{item:'berry',quantity:2,nutrition:16,lots:[{quantity:2,producedAt:481,expiresAt:600,definition:'food/life@1',nutrition:16}]}]};}
function report(f:FoodFlowReceipt){const events:RuntimeFoodEvent[]=[];const sink=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});sink.start('fixture',480);sink.committed({worldId:'fixture',fromMinute:480,toMinute:481,receipts:[],foodFlowCoverage:FOOD_FLOW_COVERAGE,foodFlows:[f]},1);sink.stop('fixture',481);return auditRuntimeFoodEvidence(events,sink.status()).foodFlows;}

test('review: same-item cook reports gross quantity but never fabricates netted output batches',()=>{
 for(const yieldAmount of [1,2,3]){const w=fixture(),r=w.residents[0],key='person:'+r.id;
  w.definitions['recipe/meal@90']={...w.definitions['recipe/meal@1'],version:90,cost:{meal:2,water:1},data:{...w.definitions['recipe/meal@1'].data,yield:yieldAmount}};w.activeDefinitions['recipe/meal']='recipe/meal@90';w.definitions[w.activeDefinitions['action/routine']].dependencies=w.definitions[w.activeDefinitions['action/routine']].dependencies.map(d=>d.startsWith('recipe/meal@')?'recipe/meal@90':d);
  const original=structuredClone(w.food!.lots[key].meal!);queue(w,{type:'cook',quantity:1});const rows=finish(w);assert.equal(rows.length,1);const f=rows[0];assert.equal(f.type,'processed');if(f.type!=='processed')return;
  assert.equal(f.inputs.find(a=>a.item==='meal')!.quantity,2);assert.equal(f.outputs[0].quantity,yieldAmount);assert.equal(f.outputs[0].lots,null);assert.equal(f.outputs[0].nutrition,null);
  assert.equal(r.inventory.meal,5-2+yieldAmount);assert.equal(f.inputs[0].lots![0].producedAt,original[0].producedAt);
 }
});

test('review: input observation neither sorts original lots nor repairs corrupt metadata',()=>{
 const w=fixture(),r=w.residents[0],key='person:'+r.id;
 w.food!.lots[key].turnip=[{quantity:8,producedAt:400,expiresAt:900,definition:'food/life@1'},{quantity:2,producedAt:300,expiresAt:800,definition:'food/life@1'}];
 const before=structuredClone(w);let input:ReturnType<typeof foodFlowInputs>;captureDirectEating(w,()=>{input=foodFlowInputs(w,key,{turnip:2},1);});assert.deepEqual(w,before);assert.equal(input![0].lots![0].producedAt,300);
 w.food!.lots[key].turnip![0].expiresAt=NaN;captureDirectEating(w,()=>{input=foodFlowInputs(w,key,{turnip:2},1);});assert.equal(input![0].lots,null);assert.ok(Number.isNaN(w.food!.lots[key].turnip![0].expiresAt));
});

test('review: strict whitelist rejects symbols, inherited prototypes, holes and unknown items',()=>{
 for(const change of [(f:any)=>{f.outputs[0][Symbol('secret')]='synthetic';},(f:any)=>{Object.setPrototypeOf(f.outputs[0],{secret:'synthetic'});},(f:any)=>{delete f.outputs[0];},(f:any)=>{f.outputs[0].item='unknown';}]){const f=flow();change(f);assert.throws(()=>checkedFoodFlow(f),/invalid_evidence_schema/);}
});

test('review: contradictory nutrition cannot become a complete numeric aggregate',()=>{
 const f=flow();f.outputs[0].nutrition=999;assert.equal(report(f).totals,null);
});

test('review: food with empty batch metadata cannot prove positive nutrition',()=>{
 const f=flow();f.outputs[0].lots=[];const result=report(f);assert.ok(result.totals===null||result.totals.sourceAdded.nutrition===null);
});

test('review: future or already expired batch metadata is not accepted as actual fresh output',()=>{
 for(const mutate of [(f:FoodFlowReceipt)=>{f.outputs[0].lots![0].producedAt=482;},(f:FoodFlowReceipt)=>{f.outputs[0].lots![0].expiresAt=481;}]){const f=flow();mutate(f);assert.equal(report(f).totals,null);}
});

test('review: future-dated original lots remain unknown without changing the world',()=>{
 const w=fixture(),r=w.residents[0],key='person:'+r.id;
 w.food!.lots[key].turnip![0].producedAt=w.minute+10;
 const before=structuredClone(w);let input:ReturnType<typeof foodFlowInputs>;
 captureDirectEating(w,()=>{input=foodFlowInputs(w,key,{turnip:2},1);});
 assert.deepEqual(w,before);assert.equal(input![0].lots,null);assert.equal(input![0].nutrition,null);
});

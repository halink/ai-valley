import assert from 'node:assert/strict';
import test from 'node:test';
import {employmentFlowFixture,queueEmploymentFlow,finishEmploymentAction,employmentReceipts,reloadEmployment} from './helpers/food-flow-employment.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {checkedFoodFlow} from '../src/server/acceptance-evidence-schema.js';
import {bindRecipeSnapshot} from '../src/world/industry-definitions.js';
import {DAY} from '../src/world/time.js';

function pending(){const f=employmentFlowFixture();queueEmploymentFlow(f,20);stepWorld(f.w,19);assert.equal(f.c.batch!.progress,19);return f;}

test('independent employment review: fractional final work records exactly once at actual completion',()=>{
 const f=pending(),flows=[];
 for(let n=0;n<4;n++){
  const o=stepWorldWithFoodEvidence(f.w,.25),receipts=employmentReceipts([o]);
  assert.equal(receipts.length,n===3?1:0);flows.push(...receipts);
 }
 assert.equal(flows.length,1);assert.equal(f.c.attendance[0].worked,20);assert.equal(f.c.attendance[0].produced,1);
 assert.equal(f.b.inventory.meal,1);assert.equal(f.c.batch,null);assert.deepEqual(checkedFoodFlow(flows[0]),flows[0]);
 assert.deepEqual(stepWorldWithFoodEvidence(f.w,.25).foodFlows,[]);
});

test('independent employment review: overnight partial batch retains input and counts completion on actual day',()=>{
 let f=employmentFlowFixture();queueEmploymentFlow(f,7);assert.deepEqual(employmentReceipts(finishEmploymentAction(f.w,f.worker)),[]);
 const firstDay=f.c.startDay,original=structuredClone(f.w.food!.lots['employment:'+f.c.id]);
 // Explicit synthetic jump to the second legal shift, not a long-run survival claim.
 f.w.minute=(firstDay+1)*DAY+f.c.terms.startMinute;f=reloadEmployment(f);
 queueEmploymentFlow(f,33);const flows=employmentReceipts(finishEmploymentAction(f.w,f.worker));
 assert.equal(flows.length,2);assert.deepEqual(flows.map(x=>[x.day,x.batchNumber]),[[firstDay+1,1],[firstDay+1,2]]);
 assert.deepEqual(flows[0].inputs.find(x=>x.item==='turnip')!.lots!.map(({nutrition,...lot})=>lot),original.turnip);
 assert.equal(f.c.attendance[0].produced,0);assert.equal(f.c.attendance[1].produced,2);
 assert.equal(f.c.attendance[1].worked,33);assert.equal(f.b.inventory.meal,2);
 for(const flow of flows)assert.deepEqual(checkedFoodFlow(flow),flow);
});

test('independent employment review: same-item output records gross legs without inventing fresh food lots',()=>{
 const f=employmentFlowFixture();
 // A synthetic valid bound promise with a same-item output; no active recipe fallback.
 const recipe=structuredClone(f.c.recipe!);recipe.output={turnip:1,meal:1};
 f.c.recipe=recipe;f.c.recipeDefinition=bindRecipeSnapshot(f.w,recipe);
 const original=structuredClone(f.w.food!.lots['business:'+f.b.id].turnip![0]);
 queueEmploymentFlow(f,20);const flows=employmentReceipts(finishEmploymentAction(f.w,f.worker));assert.equal(flows.length,1);
 const flow=flows[0];assert.deepEqual(flow.recipe.output,{turnip:1,meal:1});assert.equal(flow.inputs[0].quantity,2);
 assert.deepEqual(flow.outputs.find(x=>x.item==='turnip'),{item:'turnip',quantity:1,nutrition:null,lots:null});
 assert.equal(flow.outputs.find(x=>x.item==='meal')!.lots![0].producedAt,flow.at);
 assert.deepEqual(f.w.food!.lots['business:'+f.b.id].turnip,[{...original,quantity:3}]);
 assert.deepEqual(checkedFoodFlow(flow),flow);
});

test('independent employment review: nested refusal and separate world capture do not cross-contaminate receipts',()=>{
 const a=pending(),b=pending();let other;
 const observed=captureDirectEating(a.w,()=>{
  assert.throws(()=>captureDirectEating(a.w,()=>stepWorld(a.w,1)),/nested/);
  other=captureDirectEating(b.w,()=>stepWorld(b.w,1));stepWorld(a.w,1);
 });
 assert.equal(employmentReceipts([observed]).length,1);assert.equal(employmentReceipts([other!]).length,1);
 assert.notEqual(observed.foodFlows,other!.foodFlows);assert.deepEqual(stepWorldWithFoodEvidence(a.w,1).foodFlows,[]);
});

test('independent employment review: thrown capture discards candidate evidence and clears hooks for next work',()=>{
 const f=pending();
 assert.throws(()=>captureDirectEating(f.w,()=>{stepWorld(f.w,1);throw new Error('review discarded candidate');}),/review discarded/);
 // Direct capture does not roll back world state. Runtime durable rollback is tested separately.
 assert.equal(f.b.inventory.meal,1);assert.equal(f.c.attendance[0].produced,1);
 queueEmploymentFlow(f,20);const flows=employmentReceipts(finishEmploymentAction(f.w,f.worker));
 assert.equal(flows.length,1);assert.equal(flows[0].batchNumber,2);assert.equal(f.b.inventory.meal,2);
 assert.equal(flows[0].outputs[0].quantity,1);assert.equal(flows[0].outputs[0].lots![0].quantity,1);
 assert.deepEqual(checkedFoodFlow(flows[0]),flows[0]);
});

test('independent employment review: snapshots and lots remain detached after source mutations',()=>{
 const f=pending(),flow=employmentReceipts([stepWorldWithFoodEvidence(f.w,1)])[0],before=structuredClone(flow);
 f.c.recipe!.input.turnip=99;f.c.recipe!.output.meal=29;f.c.attendance[0].produced=300;
 f.w.food!.lots['business:'+f.b.id].meal![0].quantity=19;
 assert.deepEqual(flow,before);assert.deepEqual(checkedFoodFlow(flow),before);
});

test('independent employment review: invalid old original nutrition never falls back to current values',()=>{
 for(const value of [-1,NaN,Infinity,'42']){
  const f=pending(),lot=f.w.food!.lots['employment:'+f.c.id].turnip![0];
  lot.definition='food/employment-review@1';f.w.definitions[lot.definition]={id:'food/employment-review',version:1,kind:'life',dependencies:[],data:{nutrition:{turnip:value}}};
  const flow=employmentReceipts([stepWorldWithFoodEvidence(f.w,1)])[0],input=flow.inputs.find(x=>x.item==='turnip')!;
  assert.equal(input.nutrition,null);assert.equal(input.lots![0].nutrition,null);assert.equal(input.lots![0].definition,lot.definition);
  assert.deepEqual(checkedFoodFlow(flow),flow);
 }
});

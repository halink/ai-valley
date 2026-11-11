import assert from 'node:assert/strict';
import test from 'node:test';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
import {prototypeFlowFixture,queuePrototypeFlow,prototypeReceipts} from './helpers/food-flow-prototype.js';
for(const failure of [false,true])test(`actual final-menu prototype ${failure?'failed':'successful'} phases reconcile physical nine stocks and daily legs`,()=>{
 const {w,r}=prototypeFlowFixture(failure?{batchSize:4}:{}),ids=w.residents.map(p=>p.id),initialFish=r.inventory.fish!;
 assert.equal(ids.length,9);const nine=createNineFoodEvidence(w.id,w.minute),daily=createIsolationEvidence(w);
 queuePrototypeFlow(w,r);let starts=0,ends=0;
 while(r.plan||r.activity){
  const before=snapshotNineFood(w,ids),fishBefore=r.inventory.fish!,driedBefore=r.inventory.driedFish??0;
  const observation=stepWorldWithFoodEvidence(w,1),after=snapshotNineFood(w,ids);
  nine.sample(before,after,observation);daily.sample(w,observation);
  for(const flow of prototypeReceipts([observation])){
   assert.equal(flow.residentId,r.id);
   if(flow.phase==='started'){
    starts++;assert.equal(fishBefore-r.inventory.fish!,failure?4:2);assert.equal(flow.inputs[0].quantity,fishBefore-r.inventory.fish!);
    assert.equal((r.inventory.driedFish??0)-driedBefore,0);assert.deepEqual(flow.outputs,[]);
   }else{
    ends++;assert.equal(flow.phase,failure?'failed':'succeeded');assert.equal(r.inventory.fish,fishBefore);assert.deepEqual(flow.inputs,[]);
    assert.equal((r.inventory.driedFish??0)-driedBefore,failure?0:1);
    assert.equal(flow.outputs.reduce((n,a)=>n+a.quantity,0),failure?0:1);
   }
  }
 }
 assert.equal(starts,1);assert.equal(ends,1);assert.equal(r.inventory.fish,initialFish-(failure?4:2));
 const report=nine.finish(),day=daily.finish(w)!;
 assert.equal(report.foodFlows.unobservedMinutes,0);assert.deepEqual(report.foodFlows.scopes,['nine-and-public','nine-and-public']);
 assert.equal(report.foodFlows.scopedTotals!.inputs.units.fish,failure?4:2);assert.equal(report.foodFlows.scopedTotals!.outputs.units.driedFish,failure?0:1);
 assert.equal(report.foodFlows.scopedTotals!.sourceAdded.units.driedFish,0);assert.equal(report.foodFlows.nineIntakeTotals,null);
 assert.deepEqual(day.foodFlows.totals!.processingInputs.units,{fish:failure?4:2});
 assert.deepEqual(day.foodFlows.totals!.processingOutputs.units,failure?{}:{driedFish:1});
 assert.deepEqual(day.foodFlows.totals!.sourceAdded.units,{});
 assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);assert.equal(report.completeFoodLedger,false);
});

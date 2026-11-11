import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {DecisionWaitEvidence,type DecisionWaitEvent} from '../src/server/decision-wait-evidence.js';
import {auditRuntimeFoodEvidence,auditDecisionWaitEvidence} from '../src/server/nine-resident-acceptance.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {QWEN_MODEL} from '../src/server/model-completion.js';

function food(){
 const rows:RuntimeFoodEvent[]=[];const recorder=new RuntimeFoodEvidence({observe:e=>{rows.push(e);}});
 recorder.start('review-world',480);recorder.committed({worldId:'review-world',fromMinute:480,toMinute:481.2,receipts:[]},2);
 recorder.stop('review-world',481.2);return {rows,status:recorder.status()};
}
test('review: serialized complete empty interval remains scoped to 1.2 game minutes',()=>{
 const f=food(),rows=JSON.parse(JSON.stringify(f.rows)),status=JSON.parse(JSON.stringify(f.status));
 const report=auditRuntimeFoodEvidence(rows,status);assert.equal(report.complete,true);
 assert.ok(Math.abs(report.observedGameMinutes!-1.2)<1e-10);assert.equal(report.totals!.completedActions,0);
 assert.equal(report.foodConsumption,null);assert.equal(report.foodProduction,null);
});
test('review: same-length persisted duplicate, reordered rows and wrong world cannot masquerade as completeness',()=>{
 const f=food();
 const cases=[ [f.rows[0],f.rows[0],f.rows[2]], [f.rows[0],f.rows[2],f.rows[1]],
  f.rows.map((row,i)=>i===1?{...row,worldId:'wrong-world'}:row) ];
 for(const rows of cases){const report=auditRuntimeFoodEvidence(rows,f.status);assert.equal(report.complete,false);assert.equal(report.totals,null);}
 for(const status of [{...f.status,throughMinute:500},{...f.status,lastSequence:4},{...f.status,phase:'observing' as const}]){
  assert.equal(auditRuntimeFoodEvidence(f.rows,status).totals,null);
 }
});
test('review: dropped sink output without throwing is detected by persisted row readback',()=>{
 const rows:RuntimeFoodEvent[]=[];const recorder=new RuntimeFoodEvidence({observe:e=>{if(e.type!=='food_step_committed')rows.push(e);}});
 recorder.start('review',0);recorder.committed({worldId:'review',fromMinute:0,toMinute:1,receipts:[]},1);recorder.stop('review',1);
 assert.equal(recorder.status().phase,'stopped');assert.equal(auditRuntimeFoodEvidence(rows,recorder.status()).totals,null);
});
test('review: coverage discontinuity and stopped endpoint mismatch fail closed',()=>{
 for(const scenario of ['world','gap','reverse','stop']){
  const rows:RuntimeFoodEvent[]=[];const r=new RuntimeFoodEvidence({observe:e=>{rows.push(e);}});r.start('review',2);
  if(scenario==='stop')r.stop('review',3);
  else r.committed({worldId:scenario==='world'?'other':'review',fromMinute:scenario==='gap'?3:2,toMinute:scenario==='reverse'?1:4,receipts:[]},1);
  assert.equal(r.status().phase,'failed');assert.equal(r.status().failure,'coverage_discontinuity');
  assert.equal(auditRuntimeFoodEvidence(rows,r.status()).totals,null);
 }
});
test('review: stop storage failure leaves open evidence unknown, never complete',t=>{
 t.mock.timers.enable({apis:['setInterval']});t.mock.method(globalThis,'fetch',async()=>{throw new Error('Forbidden network');});
 const store=new WorldStore(':memory:'),rows:RuntimeFoodEvent[]=[];
 const runtime=new ValleyRuntime(store,[{model:QWEN_MODEL,key:'OFFLINE_REVIEW'}],()=>new Promise(()=>{}),{directEatingEvidence:{observe:e=>{rows.push(e);}}});
 try{runtime.start();t.mock.method(store,'commit',()=>{throw new Error('review stop failure');});
  assert.throws(()=>runtime.stop(),/review stop failure/);
  assert.equal(runtime.directEatingEvidenceStatus()!.phase,'observing');
  assert.equal(auditRuntimeFoodEvidence(rows,runtime.directEatingEvidenceStatus()).totals,null);
 }finally{runtime.stop();store.close();}
});
test('review: complete waiting stream with invalid clock does not promise valid durations',()=>{
 const rows:DecisionWaitEvent[]=[];let now=10;
 const r=new DecisionWaitEvidence({observe:e=>{rows.push(e);},monotonicNow:()=>now});
 r.start(480);r.reconcile([{actorId:'review',actorKind:'resident'}],480);now=5;r.stop(480);
 const report=auditDecisionWaitEvidence(rows,r.status());assert.equal(report.complete,true);assert.equal(report.monotonicDurationsValid,false);
 assert.equal(report.counts!.censoredWaits,1);assert.equal(report.aggregateWorldWaitMs,null);
 const wrong=rows.map((row,i)=>i===1?{...row,sessionId:'wrong'}:row);
 assert.equal(auditDecisionWaitEvidence(wrong,r.status()).counts,null);
 assert.equal(auditDecisionWaitEvidence(rows,{...r.status(),openWaits:1}).counts,null);
});

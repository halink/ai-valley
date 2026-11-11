import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {RuntimeFoodEvidence} from '../src/server/runtime-food-evidence.js';
import {prototypeFlowFixture,queuePrototypeFlow,finishPrototypeFlow,prototypeReceipts} from './helpers/food-flow-prototype.js';
for(const legacy of [false,true])test(`real numbered-menu prototype start and success survive sealed writer reload (legacy=${legacy})`,t=>{
 const f=prototypeFlowFixture(),from=f.w.minute;queuePrototypeFlow(f.w,f.r);
 const observations=finishPrototypeFlow(f.w,f.r),actual=prototypeReceipts(observations);
 assert.deepEqual(actual.map(r=>r.phase),['started','succeeded']);
 if(legacy)for(const observation of observations)observation.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1';
 const root=mkdtempSync(join(testTmpdir(),'prototype-writer-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fingerprint='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:f.w.id,fromMinute:from});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(from);food.start(f.w.id,from);let revision=1;for(const observation of observations)food.committed(observation,revision++);
 wait.stop(f.w.minute);food.stop(f.w.id,f.w.minute);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
 assert.deepEqual(result.foodFlows.observedReceipts,actual);assert.deepEqual(readAcceptanceEvidence(directory),result);
 assert.equal(result.foodProduction,null);assert.equal(result.foodConsumption,null);
 if(legacy){assert.equal(result.foodFlows.complete,false);assert.equal(result.foodFlows.totals,null);return;}
 assert.equal(result.foodFlows.complete,true,result.foodFlows.issues.join(','));
 assert.deepEqual(result.foodFlows.totals!.sourceAdded.units,{});
 assert.deepEqual(result.foodFlows.totals!.processingInputs.units,{fish:2});assert.deepEqual(result.foodFlows.totals!.processingOutputs.units,{driedFish:1});
 const path=join(directory,'evidence.jsonl'),original=readFileSync(path,'utf8'),edited=original.replace(actual[0].trialId,actual[0].trialId+'-tampered');
 assert.notEqual(edited,original);writeFileSync(path,edited);assert.equal(readAcceptanceEvidence(directory).foodFlows.totals,null);
});

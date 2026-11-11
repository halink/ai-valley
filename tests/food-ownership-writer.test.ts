import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {RuntimeFoodEvidence} from '../src/server/runtime-food-evidence.js';
import {ownershipFixture,queueOwnership,finishOwnership,ownershipReceipts} from './helpers/food-ownership.js';

test('actual inheritance ownership survives sealed writer roundtrip; tampering breaks evidence without inventing totals',t=>{
 const {w,heir,parent}=ownershipFixture(),from=w.minute;queueOwnership(w,heir,parent.id);const observations=finishOwnership(w,heir),actual=ownershipReceipts(observations);assert.equal(actual.length,1);
 const root=mkdtempSync(join(testTmpdir(),'ownership-writer-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'run'),fingerprint='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:w.id,fromMinute:from});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(from);food.start(w.id,from);let revision=1;for(const observation of observations)food.committed(observation,revision++);
 wait.stop(w.minute);food.stop(w.id,w.minute);
 const result=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
 assert.equal(result.foodOwnershipChanges.complete,true,result.foodOwnershipChanges.issues.join(','));assert.deepEqual(result.foodOwnershipChanges.observedReceipts,actual);assert.equal(result.foodOwnershipChanges.totals!.units.meal,5);assert.equal(result.foodOwnershipChanges.totals!.nutrition,null);
 assert.deepEqual(readAcceptanceEvidence(directory),result);assert.equal(result.foodProduction,null);assert.equal(result.foodConsumption,null);
 const path=join(directory,'evidence.jsonl'),original=readFileSync(path,'utf8'),edited=original.replace('ownership-parent','ownership-tampered');assert.notEqual(edited,original);writeFileSync(path,edited);const broken=readAcceptanceEvidence(directory);assert.equal(broken.foodOwnershipChanges.totals,null);assert.equal(broken.directEating.foodOwnershipChanges.totals,null);assert.equal(broken.foodOwnershipChanges.complete,false);
});

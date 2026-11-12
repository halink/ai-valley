import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,openSync,closeSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {persistedWorldFingerprint} from '../src/server/acceptance-offline-protocol.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
// @ts-ignore executable JavaScript boundary
import {launchSyntheticAccountProcess} from '../scripts/production-model-account-launch.mjs';

for(const phase of ['intent','response'] as const)test(`independent review: ${phase} fault retains durable unmatched request`,{timeout:25000},async t=>{
 const dir=mkdtempSync(join(testTmpdir(),'account-process-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'journal.sqlite'),reportPath=join(dir,'report.json');
 const store=new WorldStore(worldPath),world=createFrontierWorld(701);world.clock.paused=true;
 for(const actor of world.residents.slice(1))actor.decisionDue=world.minute+1000;
 store.commit(world,null);
 const now=Date.now(),contract=productionCandidateContract({runId:'review-fault',worldId:world.id,maxRequests:2,createdAtMs:now-1,deadlineAtMs:now+60000,requestTimeoutMs:5000});
 const initial=new DatabaseSync(journalPath);new ProductionModelJournal(initial,contract,{create:true,worldFingerprint:persistedWorldFingerprint(store.loadForRuntime())});initial.close();store.close();chmodSync(worldPath,0o600);chmodSync(journalPath,0o600);
 const options={account:{registryDirectory:join(dir,'registry'),accountScope:'synthetic-review',runId:contract.runId},worldPath,journalPath,contract,process:{maxWallMs:12000,termGraceMs:1500,killWaitMs:1500}};
 const fd=openSync(reportPath,'wx',0o600),child=launchSyntheticAccountProcess(options,{scenario:`crash_${phase}`,reportDescriptor:fd});closeSync(fd);
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
 const result=JSON.parse(readFileSync(reportPath,'utf8'));assert.equal(result.report.account,'unresolved');assert.equal(result.report.durableCompletionVerified,false);
 const db=new DatabaseSync(journalPath,{readOnly:true});
 try{
  const events=(db.prepare('SELECT body FROM production_model_audit ORDER BY sequence').all() as {body:string}[]).map(row=>JSON.parse(row.body));
  assert.equal(events.filter(e=>e.type==='intent').length,1);
  assert.equal(events.filter(e=>e.type==='response').length,phase==='response'?1:0);
  assert.equal(events.filter(e=>e.type==='world_committed').length,0,'fault must not acknowledge the request');
 }finally{db.close();}
});

test('independent review: fixed launcher refuses gated contract before spawn',()=>{
 assert.throws(()=>launchSyntheticAccountProcess({contract:{executionKind:'gated-production-http-candidate'}},{reportDescriptor:1}),/synthetic_account_launch_invalid/);
});

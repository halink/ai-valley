import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
import {ProductionModelJournal,productionCandidateContract} from '../src/server/production-model-journal.js';
import {ProductionModelAccountSupervisor} from '../src/server/production-model-account-supervisor.js';
function fixture(t:TestContext,mode:'pending'|'failed'|'wrong-world'|'expired'){
 const dir=mkdtempSync(join(testTmpdir(),'account-supervisor-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const worldPath=join(dir,'world.sqlite'),journalPath=join(dir,'journal.sqlite');
 const store=new WorldStore(worldPath),world=createFrontierWorld(701);world.clock.paused=true;store.commit(world,null);
 const now=Date.now(),contract=productionCandidateContract({runId:'review-run',worldId:world.id,maxRequests:2,createdAtMs:mode==='expired'?now-10000:now-1,deadlineAtMs:mode==='expired'?now-1:now+60000,requestTimeoutMs:500});
 const db=new DatabaseSync(journalPath),journal=new ProductionModelJournal(db,contract,{create:true,worldFingerprint:hash(store.loadForRuntime())});
 if(mode==='pending')journal.intent('a'.repeat(64),now);
 if(mode==='failed')journal.block('review_unknown');
 db.close();store.close();chmodSync(worldPath,0o600);chmodSync(journalPath,0o600);
 return {account:{registryDirectory:join(dir,'registry'),accountScope:'synthetic-review',runId:contract.runId},worldPath,journalPath,
 contract:mode==='wrong-world'?productionCandidateContract({...contract,worldId:'wrong-world'}):contract,
 process:{maxWallMs:1000,termGraceMs:50,killWaitMs:50}};
}
for(const mode of ['pending','failed','wrong-world','expired'] as const)test(`review: ${mode} durable state prevents launch, not just clean release`,async t=>{
 let launches=0;
 try{await new ProductionModelAccountSupervisor(fixture(t,mode)).start(()=>{launches++;throw Error('must_not_launch');});}catch{}
 assert.equal(launches,0);
});

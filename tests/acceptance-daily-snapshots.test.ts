import {spawnSync} from 'node:child_process';
import {initializeEconomy} from '../src/world/economy.js';
import {initializeCivic} from '../src/world/civic.js';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {DEEPSEEK_MODEL} from '../src/server/model-completion.js';
import {captureDailySnapshot,buildDailySnapshotReport,dailyBoundaryMinutes,nextDailyBoundary,type DailySnapshotConfig} from '../src/server/acceptance-daily-snapshots.js';
import {AcceptanceRunDirectory} from '../src/server/acceptance-run-directory.js';
import {createResumableOfflineSegment,resumableManifest} from '../src/server/acceptance-resumable-runner.js';
import {persistedWorldFingerprint as hash} from '../src/server/acceptance-offline-protocol.js';
const source='d'.repeat(64);
function fixture(t:TestContext,fromMinute=480,endMinute=3000){
 const base=mkdtempSync(join(testTmpdir(),'daily-snapshots-')),path=join(base,'world.sqlite'),world=createFrontierWorld(5401);world.minute=fromMinute;
 const config:DailySnapshotConfig={schema:1,fromMinute,endMinute,sourceFingerprint:source,founderIds:world.residents.map(p=>p.id)};
 t.after(()=>rmSync(base,{recursive:true,force:true}));return {base,path,world,config};
}
function advanced(world:ReturnType<typeof createFrontierWorld>,minute:number){const w=structuredClone(world);w.minute=minute;w.revision++;return w;}
test('calendar midnights and partial endpoints are exact, not 24 hours from the 480-minute start',()=>{
 const w=createFrontierWorld(5401),config:DailySnapshotConfig={schema:1,fromMinute:480,endMinute:22080,sourceFingerprint:source,founderIds:w.residents.map(p=>p.id)};
 assert.deepEqual(dailyBoundaryMinutes(config,1440),[480,1440]);assert.equal(nextDailyBoundary(1439.9999999999998,config),1440);
 assert.equal(nextDailyBoundary(1440,config),2880);assert.equal(nextDailyBoundary(22080,config),Infinity);
 assert.deepEqual(dailyBoundaryMinutes(config,22080).slice(-2),[21600,22080]);
 const initial=captureDailySnapshot(w,config);w.minute=2880;w.revision++;const later=captureDailySnapshot(w,config);
 const report=buildDailySnapshotReport(config,w.id,2880,[initial,later]);assert.deepEqual(report.missingBoundaries,[1440]);
 assert.equal(report.boundaries[1].snapshot,null);assert.equal(report.intervals[0].endpointCoverage,'missing');assert.equal(report.acceptancePassed,null);
});
test('fixed cohort, independent population, dead/outside and unknown values do not become nine survivors or zero stock',t=>{
 const {world:w,config}=fixture(t);initializeEconomy(w);initializeCivic(w);const initial=captureDailySnapshot(w,config);w.minute=1440;w.revision++;
 w.residents[0].status='dead';w.residents[0].deathAt=1300;w.residents[1].residency='outside';
 w.residents.push({...structuredClone(w.residents[2]),id:'synthetic-new-person',residency:'visitor'});
 const missing=w.residents.splice(3,1)[0];delete (w.residents[4] as any).inventory;(w.residents[5] as any).hunger=NaN;
 w.civic!.stores={'synthetic-hall':{meal:2}};w.civic!.reserves=[];w.economy!.treasuryStock={meal:999};
 const before=structuredClone(w),snapshot=captureDailySnapshot(w,config);assert.deepEqual(w,before);
 assert.equal(snapshot.founders.length,9);assert.equal(snapshot.population.total,9);assert.equal(snapshot.population.groups.aliveVisitor.count,1);assert.equal(snapshot.population.groups.dead.count,1);
 assert.equal(snapshot.founders.find(p=>p.id===missing.id)!.status,null);assert.equal(snapshot.founders.find(p=>p.id===missing.id)!.inventory.meal,null);
 assert.equal(snapshot.founders.find(p=>p.id===w.residents[4].id)!.inventory.meal,null);assert.equal(snapshot.founders.find(p=>p.id===w.residents[5].id)!.hunger,null);
 assert.equal(snapshot.community.totals.meal,2);const report=buildDailySnapshotReport(config,w.id,1440,[initial,snapshot]);
 assert.deepEqual(report.transitions.map(x=>[x.kind,x.exactMinute]),[['death',1300],['outside',null]]);
});
test('same transaction captures first midnight arrival, receipts and population then preserves it on same-minute commits/reload',t=>{
 const {path,world,config}=fixture(t);let store=new WorldStore(path,{dailySnapshots:config});store.commit(world,null);
 let next=advanced(world,1440);next.residents[0].inventory.meal=7;next.residents[1].residency='outside';next.processed.push('synthetic-midnight-receipt');store.commit(next,world.revision);
 const first=store.dailySnapshotReport();assert.equal(first.boundaries[1].snapshot!.founders[0].inventory.meal,7);assert.equal(first.transactions[1].receiptCount,1);
 const changed=advanced(next,1440);changed.residents[0].inventory.meal=9;store.commit(changed,next.revision);store.close();store=new WorldStore(path,{dailySnapshots:config});
 const again=store.dailySnapshotReport();assert.deepEqual(again.boundaries,first.boundaries);assert.deepEqual(again.transactions,first.transactions);
 const after=advanced(store.loadForRuntime()!,1440.25);store.commit(after,changed.revision);assert.equal(store.dailySnapshotReport().boundaries.length,2);store.close();
});
test('snapshot write failure rolls back world, event and receipt ledgers together; retry settles once',t=>{
 const {path,world,config}=fixture(t),store=new WorldStore(path,{dailySnapshots:config});t.after(()=>store.close());store.commit(world,null);
 const sql=new DatabaseSync(path);t.after(()=>sql.close());sql.exec("CREATE TRIGGER fail_daily_snapshot BEFORE INSERT ON acceptance_daily_snapshots WHEN NEW.minute=1440 BEGIN SELECT RAISE(ABORT,'synthetic_snapshot_failure'); END");
 const next=advanced(world,1440);next.residents[0].inventory.meal=8;next.processed.push('synthetic-midnight-receipt');
 next.events.push({id:'synthetic-midnight-event',at:1440,kind:'action',actors:[next.residents[0].id],place:{x:0,y:0},text:'Synthetic only',witnesses:[]});
 assert.throws(()=>store.commit(next,world.revision),/synthetic_snapshot_failure/);
 assert.equal(store.load()!.minute,world.minute);assert.equal(store.load()!.processed.includes('synthetic-midnight-receipt'),false);assert.equal(store.load()!.events.some(e=>e.id==='synthetic-midnight-event'),false);
 assert.equal(store.dailySnapshotReport().boundaries.length,1);sql.exec('DROP TRIGGER fail_daily_snapshot');store.commit(next,world.revision);
 assert.equal(store.dailySnapshotReport().boundaries.length,2);assert.equal(store.load()!.processed.filter(x=>x==='synthetic-midnight-receipt').length,1);
});
test('skipped boundary and concurrent stale commit fail without partially adding snapshot or receipt',t=>{
 const {path,world,config}=fixture(t),a=new WorldStore(path,{dailySnapshots:config});t.after(()=>a.close());a.commit(world,null);
 const b=new WorldStore(path,{dailySnapshots:config});t.after(()=>b.close());const skipped=advanced(world,1440.1);skipped.processed.push('skipped');
 assert.throws(()=>a.commit(skipped,world.revision),/boundary_skipped/);assert.equal(a.load()!.minute,480);
 const midnight=advanced(world,1440);a.commit(midnight,world.revision);assert.throws(()=>b.commit(midnight,world.revision),/stale_world_revision/);
 assert.equal(b.dailySnapshotReport().transactions.length,2);assert.equal(a.load()!.processed.includes('skipped'),false);
});
test('late installation, uninstrumented writes, altered history and changed config fail closed',t=>{
 const {path,world,config}=fixture(t);let store=new WorldStore(path);store.commit(world,null);store.close();
 store=new WorldStore(path,{dailySnapshots:config});assert.throws(()=>store.commit(advanced(world,500),world.revision),/history_missing/);store.close();
 const path2=path+'.fresh';store=new WorldStore(path2,{dailySnapshots:config});store.commit(world,null);store.commit(advanced(world,1440),world.revision);store.close();
 assert.throws(()=>new WorldStore(path2,{dailySnapshots:{...config,endMinute:4000}}),/config_mismatch/);
 const ordinary=new WorldStore(path2),current=ordinary.loadForRuntime()!;ordinary.commit(advanced(current,1441),current.revision);ordinary.close();
 store=new WorldStore(path2,{dailySnapshots:config});assert.throws(()=>store.dailySnapshotReport(),/continuity_failed/);store.close();
 const path3=path+'.tamper';store=new WorldStore(path3,{dailySnapshots:config});store.commit(world,null);store.commit(advanced(world,1440),world.revision);
 const sql=new DatabaseSync(path3);sql.exec('DELETE FROM acceptance_daily_snapshots WHERE minute=1440');sql.close();assert.throws(()=>store.dailySnapshotReport(),/integrity_failed/);store.close();
});
test('actual runtime clamps fractional midnight: completed meal is in the atomic snapshot and post-midnight tick cannot replace it',t=>{
 const f=fixture(t,1439.75,1441.2),w=f.world;w.minute=1435;w.clock.paused=false;
 for(const p of w.residents){p.lastDecisionAt=w.minute;p.decisionDue=1e9;p.inventory={meal:2};p.hunger=70;p.health=p.energy=100;}
 const actor=w.residents[0];assert.equal(submitPlan(w,{id:'synthetic-boundary-meal',actorId:actor.id,actorRevision:actor.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Synthetic boundary test',actions:[{type:'eat',item:'meal'}]}).ok,true);
 stepWorld(w,4.75);assert.equal(w.minute,1439.75);assert.equal(actor.activity!.remaining,.25);
 const store=new WorldStore(f.path,{dailySnapshots:f.config});t.after(()=>store.close());store.commit(w,null);
 const runtime=new ValleyRuntime(store,[{model:DEEPSEEK_MODEL,key:'OFFLINE-FAKE'}],async()=>({decision:{intention:'Synthetic wait',actions:[{type:'wait',minutes:15}]},inputTokens:1,outputTokens:1,latencyMs:0,acceptanceCostUsd:0}),
  {mode:'formal',modelSlots:1,dayMinutes:20,dailySnapshots:f.config,acceptanceStop:{endGameMinute:f.config.endMinute,maxRequests:10,maxWallMs:60000,allowedModels:[DEEPSEEK_MODEL],assessPrice:model=>({model,currency:'USD',inputPerMillion:0,outputPerMillion:0,perRequest:0,otherFees:0,validUntilMonotonicMs:1e15})}});
 t.after(()=>runtime.stop());runtime.start();runtime.tick(Date.now()+2000);assert.equal(runtime.world.minute,1440);
 const report=store.dailySnapshotReport(),sample=report.boundaries.at(-1)!.snapshot!;assert.equal(sample.minute,1440);assert.equal(sample.founders[0].inventory.meal,1);assert.ok(sample.founders[0].hunger!<70);
 assert.ok(store.load()!.events.some(e=>e.at===1440&&e.actors.includes(actor.id)&&e.kind==='action'));
 runtime.tick(Date.now()+4000);assert.equal(runtime.world.minute,1441.2);assert.deepEqual(store.dailySnapshotReport().boundaries[1],report.boundaries[1]);
});
test('resumable runner emits unified report with verified state and separated segment evidence across restart',async t=>{
 const f=fixture(t),directory=AcceptanceRunDirectory.create(join(f.base,'run'));t.after(()=>directory.close());directory.writeJson('resumable-manifest.json',resumableManifest(source));
 const settings={directory,sourceFingerprint:source,sourceFingerprintAfter:()=>source};const run=createResumableOfflineSegment({...settings,create:true});run.start();await new Promise(resolve=>setImmediate(resolve));const result=run.close();
 const report=directory.readJson(result.dailyReportFile) as any;assert.equal(hash(report),result.dailyReportHash);assert.equal(report.worldState.boundaries[0].minute,480);assert.equal(report.worldState.persistence.kind,'same-world-sqlite-transaction');assert.equal(report.evidence.segments.length,1);assert.equal(report.realModelExecuted,false);assert.equal(report.acceptancePassed,null);assert.equal(report.foodConsumption,null);
 const again=createResumableOfflineSegment({...settings,create:false});again.start();const second=again.close();const next=directory.readJson(second.dailyReportFile) as any;
 assert.equal(next.evidence.segments.length,2);assert.deepEqual(next.worldState.boundaries,report.worldState.boundaries);assert.equal(second.journal.attempts,result.journal.attempts);
});

for(const phase of ['inside','after'] as const)test(`actual process exit ${phase} boundary transaction recovers all or none`,t=>{
 const f=fixture(t,1439.75,1441.25),code=`
 import {WorldStore} from './src/server/store.ts';
 import {createFrontierWorld} from './src/world/formal-seed.ts';
 const w=createFrontierWorld(5401);w.minute=1439.75;
 const store=new WorldStore(${JSON.stringify(f.path)},{dailySnapshots:${JSON.stringify(f.config)}});store.commit(w,null);
 if(${JSON.stringify(phase)}==='inside'){
  store.db.function('synthetic_crash',()=>process.exit(73));
  store.db.exec("CREATE TRIGGER crash_snapshot BEFORE INSERT ON acceptance_daily_snapshots WHEN NEW.minute=1440 BEGIN SELECT synthetic_crash(); END");
 }
 const revision=w.revision;w.revision++;w.minute=1440;w.residents[0].inventory.meal=12;w.processed.push('synthetic-process-boundary');store.commit(w,revision);process.exit(73);`;
 const child=spawnSync(process.execPath,['--import','./scripts/acceptance-offline-guard.mjs','--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),env:{},encoding:'utf8',timeout:20000});
 assert.equal(child.status,73,child.stderr);const store=new WorldStore(f.path,{dailySnapshots:f.config});t.after(()=>store.close());
 const recovered=store.load()!,report=store.dailySnapshotReport();assert.equal(recovered.minute,phase==='inside'?1439.75:1440);
 assert.equal(recovered.processed.includes('synthetic-process-boundary'),phase==='after');assert.equal(report.boundaries.length,phase==='inside'?1:2);
 if(phase==='after')assert.equal(report.boundaries[1].snapshot!.founders[0].inventory.meal,12);
});

test('ambiguous census identities remain unknown and intervening archived departures are not replaced by endpoint differences',t=>{
 const {world,config,path}=fixture(t);world.residents.push(structuredClone(world.residents[0]));const unknown=captureDailySnapshot(world,config);
 assert.equal(unknown.population.total,null);assert.equal(unknown.population.groups.unknown.count,2);assert.equal(unknown.founders[0].status,null);world.residents.pop();
 const store=new WorldStore(path,{dailySnapshots:config});t.after(()=>store.close());store.commit(world,null);const end=advanced(world,1440);
 end.events.push({id:'synthetic-depart',at:1000,kind:'departure',populationChange:'depart',actors:[world.residents[0].id],place:{x:0,y:0},text:'synthetic departure',witnesses:[]},
  {id:'synthetic-return',at:1100,kind:'arrival',populationChange:'visit',actors:[world.residents[0].id],place:{x:0,y:0},text:'synthetic return',witnesses:[]});
 store.commit(end,world.revision);const report=store.dailySnapshotReport();assert.deepEqual(report.transitions,[]);
 assert.deepEqual(report.transactions[1].populationEvents.map((e:any)=>[e.change,e.at]),[['depart',1000],['visit',1100]]);
});

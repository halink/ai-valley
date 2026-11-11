import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {runNineResidentFoodChain} from './helpers/nine-resident-food-chain.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {WorldStore} from '../src/server/store.js';
import {reserveContainer} from '../src/world/public-food-reserves.js';

test('review: rejects in-memory and existing destinations without changing the existing synthetic file',()=>{
 const directory=mkdtempSync(join(testTmpdir(),'nine-food-boundary-')),path=join(directory,'sentinel.sqlite');
 try{
  writeFileSync(path,'synthetic review sentinel');
  assert.throws(()=>runNineResidentFoodChain(':memory:'),/fresh synthetic SQLite path/);
  assert.throws(()=>runNineResidentFoodChain(path),/fresh synthetic SQLite path/);
  assert.equal(readFileSync(path,'utf8'),'synthetic review sentinel');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('review: CLI requires the exact explicit offline invocation',()=>{
 for(const args of [[],['--online'],['--offline','--database=forbidden.sqlite']]){
  const result=spawnSync(process.execPath,['--import','tsx','scripts/acceptance-nine-food-chain.mjs',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:30000});
  assert.equal(result.status,2,result.stderr);assert.equal(result.stdout,'');assert.match(result.stderr,/Usage:/);
 }
});

test('review: formal nine-person menu chain preserves harvest identity through a real SQLite reopen',t=>{
 const network=t.mock.method(globalThis,'fetch',()=>{throw new Error('Offline review forbids network and model requests');});
 const directory=mkdtempSync(join(testTmpdir(),'nine-food-review-')),path=join(directory,'synthetic.sqlite');
 try{
  const report=runNineResidentFoodChain(path),initial=createFrontierWorld(5401);
  assert.deepEqual(report.initialPeople,initial.residents.map(r=>({id:r.id,inventory:r.inventory,bornAt:r.bornAt,homeId:r.homeId})));
  assert.equal(network.mock.callCount(),0);
  assert.equal(report.realModelExecuted,false);
  assert.equal(report.modelAutonomyAcceptancePassed,null);
  assert.equal(report.populationSurvivalAcceptancePassed,null);
  assert.equal(report.mode,'formal');assert.equal(report.scenario,'frontier');
  assert.equal(report.initialPeople.length,9);
  assert.deepEqual(report.growth.map(g=>[g.before,g.after]),[[0,1],[1,2],[2,3],[3,4]]);
  assert.ok(report.plantedAt!<report.harvestedAt!&&report.harvestedAt!<report.replantedAt!);
  assert.ok(report.replantedAt!<report.deliveredAt!&&report.deliveredAt!<report.takenAt!&&report.takenAt!<report.eatenAt!);
  const eatIndex=report.trace.findIndex(row=>row.actorId===report.childId&&row.completedAt===report.eatenAt&&row.action.type==='eat'&&row.action.item==='turnip');
  assert.ok(eatIndex>=0);assert.equal(report.childReceipt.planId,`offline-food-chain:${eatIndex}`);
  assert.equal(report.childReceipt.quantity,1);assert.equal(report.childReceipt.container,`person:${report.childId}`);
  const votes=report.trace.filter(row=>row.action.type==='civic'&&row.action.operation==='vote');
  assert.equal(votes.length,4);assert.equal(new Set(votes.map(row=>row.actorId)).size,4);
  assert.ok(votes.every(row=>row.completedAt!==null&&row.failure===null));
  assert.equal(readFileSync(path).subarray(0,16).toString(),'SQLite format 3\0');
  const sqlite=new DatabaseSync(path,{readOnly:true});
  try{assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM worlds').get()!.n,1);assert.ok(Number(sqlite.prepare('SELECT COUNT(*) AS n FROM receipts').get()!.n)>0);}finally{sqlite.close();}
  const store=new WorldStore(path);
  try{
   const saved=store.load()!;
   assert.equal(saved.minute,report.endMinute);assert.equal(saved.metrics.requests,0);
   assert.deepEqual(saved.residents.map(r=>r.id),initial.residents.map(r=>r.id));
   const reserve=saved.civic!.reserves!.at(-1)!;
   assert.equal(reserve.withdrawn,1);assert.equal(reserve.inventory.turnip,2);
   assert.deepEqual(saved.food!.lots[reserveContainer(reserve.id)].turnip,[{...report.harvestBatch[0],quantity:2}]);
   assert.equal(saved.residents.find(r=>r.id===report.childId)!.inventory.turnip,1);
   assert.equal(saved.household!.gifts.find(g=>g.id===report.familyGift.giftId)!.status,'delivered');
   assert.equal(saved.food!.lots['person:'+report.childId].turnip![0].producedAt,report.harvestBatch[0].producedAt);
   assert.equal(saved.plots.find(p=>p.id===report.plotId)!.crop!.growth,0);
  }finally{store.close();}
 }finally{rmSync(directory,{recursive:true,force:true});}
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {aidTransferFixture,queueAidAction,queueAidCollection} from './helpers/food-transfer-aid.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {NINE_RESIDENT_PLAN} from '../src/server/nine-resident-acceptance.js';
import {WorldStore} from '../src/server/store.js';

test('real fixed-nine menu collect crosses boundary once after partial spoilage and SQLite reload; later eat is separate',()=>{
 const f=aidTransferFixture(4,true,true);let w=f.w,r=f.r;const ids=[...NINE_RESIDENT_PLAN.residentIds],id=r.id,delivery=f.d.id;
 assert.deepEqual(w.residents.map(r=>r.id),ids);const old=w.food!.lots['aid:'+delivery].turnip![0];
 w.food!.lots['aid:'+delivery].turnip=[{...old,quantity:1.5,expiresAt:w.minute+2},{...old,quantity:2.5}];
 const collector=createNineFoodEvidence(w.id,w.minute);queueAidCollection(f);let reloaded=false;
 const tick=()=>{const before=snapshotNineFood(w,ids),observation=stepWorldWithFoodEvidence(w,1),after=snapshotNineFood(w,ids);collector.sample(before,after,observation);};
 while(r.plan||r.activity){tick();if(!reloaded&&r.activity?.remaining===2){
  const store=new WorldStore(':memory:');try{store.commit(w,null);w=store.load(true)!;r=w.residents.find(p=>p.id===id)!;}finally{store.close();}reloaded=true;
 }}
 assert.equal(reloaded,true);assert.equal(r.inventory.turnip,2.5);let report=collector.finish();
 assert.deepEqual(report.foodTransfers.scopes,['external']);assert.deepEqual(report.foodTransfers.destinationScopes,['nine-and-public']);assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,2.5);assert.equal(report.foodTransfers.scopeInflowTotals!.nutrition,17.5);assert.equal(report.foodTransfers.receipts.length,1);
 assert.equal(report.foodLosses.scopedTotals!.inputs.units.turnip,0,'spoiled aid was still external custody');assert.equal(report.directEating.nineIntakeTotals!.nutrition,0);assert.equal(report.foodTransfers.nineIntakeTotals,null);
 queueAidAction(w,r,{type:'eat',item:'turnip'});while(r.plan||r.activity)tick();report=collector.finish();
 assert.equal(r.inventory.turnip,1.5);assert.equal(report.directEating.nineIntakeTotals!.units.turnip,1);assert.equal(report.directEating.nineIntakeTotals!.nutrition,7);
 assert.equal(report.foodTransfers.receipts.length,1);assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,2.5);assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);assert.equal(report.completeFoodLedger,false);
});

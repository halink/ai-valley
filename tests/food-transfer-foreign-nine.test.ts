import assert from 'node:assert/strict';
import {test} from 'node:test';
import {foreignTransferFixture,queueForeignAction,residentProposal} from './helpers/food-transfer-foreign.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {NINE_RESIDENT_PLAN} from '../src/server/nine-resident-acceptance.js';
import {completeForeignTrade,advanceForeignTrade} from '../src/world/foreign-trade.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {recordDeath} from '../src/world/life.js';

test('seed5401 numbered export reserve and returned collection reconcile exact fixed-nine endpoints without intake',()=>{
 const f=foreignTransferFixture(true),{w,r,m}=f,ids=[...NINE_RESIDENT_PLAN.residentIds];assert.deepEqual(w.residents.map(p=>p.id),ids);const collector=createNineFoodEvidence(w.id,w.minute);
 const tick=()=>{const before=snapshotNineFood(w,ids),observation=stepWorldWithFoodEvidence(w,1);collector.sample(before,snapshotNineFood(w,ids),observation);};
 queueForeignAction(w,r,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity:4,price:1,maximumLevyBasisPoints:0});while(r.plan||r.activity)tick();let report=collector.finish();
 assert.equal(report.foodTransfers.receipts.length,1);assert.deepEqual(report.foodTransfers.scopes,['nine-and-public']);assert.deepEqual(report.foodTransfers.destinationScopes,['external']);assert.equal(report.foodTransfers.scopeOutflowTotals!.units.turnip,4);assert.equal(report.foodTransfers.scopeOutflowTotals!.nutrition,null);assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,0);
 const o=w.foreignTrade!.offers.at(-1)!;const before=snapshotNineFood(w,ids),observation=captureDirectEating(w,()=>{w.minute++;assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'cancelOffer',offerId:o.id}),null);});collector.sample(before,snapshotNineFood(w,ids),observation);const s=w.foreignTrade!.shipments.at(-1)!;
 queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});while(r.plan||r.activity)tick();report=collector.finish();assert.equal(r.inventory.turnip,8);assert.equal(report.foodTransfers.receipts.length,2);assert.equal(report.foodTransfers.scopeOutflowTotals!.units.turnip,4);assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,4);assert.equal(report.foodTransfers.scopeInflowTotals!.nutrition,28);assert.equal(report.directEating.nineIntakeTotals!.nutrition,0);assert.equal(report.foodTransfers.nineIntakeTotals,null);assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);assert.equal(report.completeFoodLedger,false);
});

test('seed5401 pending offer estate custody is actual fixed-nine inflow without a claimant',()=>{
 const f=foreignTransferFixture(true),{w,r}=f,ids=[...NINE_RESIDENT_PLAN.residentIds];residentProposal(f);recordDeath(w,r,'illHealth');const collector=createNineFoodEvidence(w.id,w.minute),before=snapshotNineFood(w,ids),observation=stepWorldWithFoodEvidence(w,1);collector.sample(before,snapshotNineFood(w,ids),observation);const report=collector.finish();assert.equal(report.foodTransfers.receipts.length,1);assert.deepEqual(report.foodTransfers.scopes,['external']);assert.deepEqual(report.foodTransfers.destinationScopes,['nine-and-public']);assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,4);assert.equal(report.foodTransfers.scopeInflowTotals!.nutrition,28);assert.equal(report.directEating.nineIntakeTotals!.nutrition,0);assert.equal(report.foodTransfers.nineIntakeTotals,null);
});

test('non-nine real export reservation and return remain external-to-external',()=>{
 const f=foreignTransferFixture(),{w,r,m}=f,ids=[...NINE_RESIDENT_PLAN.residentIds],collector=createNineFoodEvidence(w.id,w.minute);assert.ok(!ids.includes(r.id as typeof ids[number]));
 const sample=(run:()=>void)=>{const before=snapshotNineFood(w,ids),observation=captureDirectEating(w,()=>{w.minute++;run();});collector.sample(before,snapshotNineFood(w,ids),observation);};
 sample(()=>{residentProposal(f);});const o=w.foreignTrade!.offers.at(-1)!;sample(()=>assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'cancelOffer',offerId:o.id}),null));const s=w.foreignTrade!.shipments.at(-1)!;sample(()=>assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id}),null));const report=collector.finish();assert.equal(report.foodTransfers.receipts.length,2);assert.deepEqual(report.foodTransfers.scopes,['external','external']);assert.deepEqual(report.foodTransfers.destinationScopes,['external','external']);assert.equal(report.foodTransfers.scopeOutflowTotals!.units.turnip,0);assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,0);assert.equal(report.foodTransfers.nineIntakeTotals,null);
});

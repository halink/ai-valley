import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {runNineResidentFoodChain} from './helpers/nine-resident-food-chain.js';

test('formal seed5401 normal-menu crop, reserve and child meal chain uses real elapsed rules and disk reloads',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Network and model calls are forbidden in this acceptance');});
 const directory=mkdtempSync(join(testTmpdir(),'nine-food-chain-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const database=join(directory,'synthetic.sqlite'),r=runNineResidentFoodChain(database);
 assert.equal(r.executionKind,'offline-scripted-normal-menu');assert.equal(r.realModelExecuted,false);
 assert.equal(r.modelAutonomyAcceptancePassed,null);assert.equal(r.populationSurvivalAcceptancePassed,null);
 assert.equal(r.mode,'formal');assert.equal(r.scenario,'frontier');assert.equal(r.seed,5401);assert.equal(r.initialPeople.length,9);
 assert.equal(r.weatherHazardsEnabled,false);assert.equal(r.initialMinute,480);assert.equal(r.elapsedGameMinutes,r.endMinute-480);
 assert.deepEqual(r.growth.map(g=>[g.at,g.previousWeather,g.wateredDay,g.before,g.after]),[[1440,'sun',0,0,1],[2880,'sun',1,1,2],[4320,'rain',1,2,3],[5760,'sun',3,3,4]]);
 assert.deepEqual(r.irrigations.map(i=>i.day),[0,1,3]);assert.deepEqual(r.farmerWater,{initial:4,irrigationUsed:3,final:1});
 assert.equal(r.harvestQuantity,12);assert.ok(r.plantedAt!<r.harvestedAt!);assert.ok(r.harvestedAt!<r.replantedAt!);
 assert.ok(r.replantedAt!<r.deliveredAt!);assert.ok(r.deliveredAt!<r.takenAt!);assert.ok(r.takenAt!<r.eatenAt!);
 assert.equal(r.proposal.status,'approved');assert.equal(r.proposal.electorate.length,6);assert.equal(Object.keys(r.proposal.votes).length,4);
 assert.equal(r.conservation.finalTurnip,r.conservation.initialTurnip+12-1-r.conservation.rootsEaten);
 assert.equal(r.conservation.finalSeed,r.conservation.initialSeed);assert.equal(r.conservation.finalCoins,r.conservation.initialCoins);
 assert.equal(r.childReceipt!.residentId,r.childId);assert.equal(r.childReceipt!.quantity,1);assert.equal(r.childReceipt!.nutrition,20);
 // Actual sight changes the scripted upkeep routes. Two residents now select
 // the same last berry before either arrives; finite competition must fail
 // honestly rather than reserve or duplicate food to preserve a zero-failure trace.
 const failed=r.trace.filter(t=>t.failure!==null);
 assert.equal(r.actionCounts.failed,1);assert.equal(failed.length,1);
 assert.deepEqual(failed.map(t=>({actorId:t.actorId,purpose:t.purpose,selectedAt:t.selectedAt,completedAt:t.completedAt,action:t.action,failure:t.failure})),[
  {actorId:'founder-2-3',purpose:'scripted upkeep: forage',selectedAt:6135,completedAt:6144,action:{type:'gather',resourceId:'bush-427-232',quantity:1},failure:'资源或实际位置已经变化'},
 ]);
 const competitors=r.trace.filter(t=>t.selectedAt===6135&&t.action.type==='gather'&&t.action.resourceId==='bush-427-232');
 assert.equal(competitors.length,2);assert.deepEqual(competitors.map(t=>t.actorId),['founder-2-2','founder-2-3']);
 assert.ok(competitors.every(t=>t.completedAt===6144&&t.action.type==='gather'&&t.action.quantity===1));assert.equal(competitors[0].failure,null);
 const winnerPlan='offline-food-chain:'+r.trace.indexOf(competitors[0]),failedPlan='offline-food-chain:'+r.trace.indexOf(failed[0]);
 const payout=r.evidence.foodFlows.receipts.filter(f=>f.action==='gather_berry'&&f.sourceId==='bush-427-232'&&f.at===6144);
 assert.equal(payout.length,1);assert.equal(payout[0].type,'source_added');assert.equal(payout[0].residentId,'founder-2-2');assert.equal(payout[0].planId,winnerPlan);assert.equal(payout[0].container,'person:founder-2-2');
 assert.deepEqual(payout[0].outputs.map(o=>({item:o.item,quantity:o.quantity})),[{item:'berry',quantity:1}]);
 assert.ok(!r.evidence.foodFlows.receipts.some(f=>f.planId===failedPlan),'the unsuccessful competitor creates no food-flow receipt');
 assert.equal(r.actionCounts.selected,r.actionCounts.completed+r.actionCounts.pending);
 assert.ok(r.trace.some(s=>s.purpose==='scripted upkeep: forage'&&s.action.type==='gather'));
 assert.equal(r.checkpoints.filter(c=>c.stage.includes('SQLite')).length,4);assert.equal(existsSync(database),true);
 assert.equal(r.accountingScope.completeFoodLedger,false);assert.equal(r.accountingScope.treasuryStockIncluded,false);
 assert.equal(r.accountingScope.inventoryDebitBoundary,'fixed-nine-and-public');assert.equal(r.accountingScope.intakeBoundary,'fixed-nine-only');
 assert.equal(r.evidence.directEating.nineIntakeTotals!.units.turnip,r.conservation.rootsEaten);
 assert.equal(r.evidence.foodConsumption,null);
 for(const slice of [r.evidence.journeyMeals,r.evidence.familyJourneyMeals,r.evidence.publicDutyMeals,r.evidence.emergencyCareMeals]){assert.deepEqual(slice.receipts,[]);assert.equal(slice.nineIntakeTotals!.completedServings,0);}
 assert.equal(r.familyGift.quantity,2);assert.equal(r.familyGift.receipt.quantity,1);assert.equal(r.familyGift.remainingInChild,1);
 assert.ok(r.eatenAt!<r.familyGift.takenAt!&&r.familyGift.takenAt!<r.familyGift.eatenAt!);
 const family=r.checkpoints.find(c=>c.stage==='family stock')!;
 assert.ok(family.physical.containers.some(c=>c.type==='family-stock'&&c.units.turnip===2));
 const gift=r.checkpoints.find(c=>c.stage==='family gift SQLite close and reopen')!;
 assert.ok(gift.physical.containers.some(c=>c.type==='family-gift'&&c.units.turnip===2));
 assert.equal(r.evidence.foodFlows.scopedTotals!.sourceAdded.units.turnip,12);
 const seeds=r.evidence.foodFlows.receipts.filter(f=>f.action==='saveSeed');assert.equal(seeds.length,1);assert.equal(seeds[0].type,'processed');
 assert.equal(r.evidence.foodFlows.scopedTotals!.inputs.units.turnip,r.conservation.rootsSavedForSeed);
 assert.equal(r.evidence.foodFlows.scopedTotals!.outputs.units.seed,2);assert.equal(r.evidence.foodFlows.scopedTotals!.outputs.nutrition,0);
 assert.equal(r.evidence.foodFlows.nineIntakeTotals,null);
 assert.ok(r.evidence.foodLosses.receipts.length>0,'previously discarded actual spoilage must be retained');
 assert.equal(r.evidence.foodLosses.scopedTotals!.inputs.units.turnip,0);
 for(const s of [r.evidence.directEating,r.evidence.foodFlows,r.evidence.foodLosses,r.evidence.careMeals,r.evidence.childCareMeals,r.evidence.longCareMeals,r.evidence.journeyMeals,r.evidence.familyJourneyMeals,r.evidence.publicDutyMeals,r.evidence.emergencyCareMeals]){assert.equal(s.observedMinutes,r.elapsedGameMinutes);assert.equal(s.unobservedMinutes,0);}
 assert.throws(()=>runNineResidentFoodChain(database),/fresh synthetic SQLite/);
});

test('food-chain harness requires a newly created on-disk save, never an in-memory or existing save',()=>{
 assert.throws(()=>runNineResidentFoodChain(':memory:'),/fresh synthetic SQLite/);
});

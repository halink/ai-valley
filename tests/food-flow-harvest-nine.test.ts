import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {World} from '../src/shared/types.js';
import {stepWorldWithFoodEvidence} from '../src/world/engine.js';
import {estateParcel} from '../src/world/estate-custody.js';
import {houseHarvestFixture,custodyHarvestFixture,queueHarvest,reloadHarvest} from './helpers/food-flow-harvest.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';

/** Synthetic boundary experiment only, not the unchanged seed5401 opening or CLI run.
 * Every cohort ID resolves to a distinct full resident object. Excluded participants
 * remain real additional residents, with their existing mandate and rights unchanged. */
function fixedNine(w:World,excluded:readonly string[]){
 const prototype=w.residents.find(r=>r.status==='alive'&&r.homeId===null)??w.residents.find(r=>r.status==='alive')!;
 while(w.residents.filter(r=>!excluded.includes(r.id)).length<9){
  const id='synthetic-nine-harvest:'+w.residents.length;
  w.residents.push({...structuredClone(prototype),id,name:'合成边界居民 '+id,homeId:null,inventory:{},coins:0,parents:[],adoptiveParents:[],guardianIds:[],relations:[],plan:null,activity:null,lastFailure:null,knownPeople:[],lastDecisionAt:w.minute,decisionDue:w.minute+10000});
 }
 const ids=Object.freeze(w.residents.filter(r=>!excluded.includes(r.id)).map(r=>r.id));
 assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);assert.equal(new Set(w.residents).size,w.residents.length);
 for(const id of ids)assert.equal(w.residents.filter(r=>r.id===id).length,1);
 return ids;
}

for(const kind of ['house','custody'] as const)for(const ownerInScope of [true,false])test(`real ${kind} harvest reaches fixed-nine collector with ${ownerInScope?'in-scope':'external'} physical owner, through mid-action and completed SQLite reload`,t=>{
 let fetchCalls=0;t.mock.method(globalThis,'fetch',()=>{fetchCalls++;throw Error('Offline synthetic harvest boundary');});
 const f=kind==='house'?houseHarvestFixture():custodyHarvestFixture();
 // Crossed custody cases deliberately leave title and permissions untouched:
 // external worker + child with nine estate owner, versus nine worker + child with external estate owner.
 const excluded='c' in f?(ownerInScope?[f.r.id,f.child.id]:[f.dead.id]):(ownerInScope?[]:[f.r.id]);
 const ids=fixedNine(f.w,excluded),originalIds=[...ids],actorId=f.r.id;
 if('c' in f){assert.equal(ids.includes(f.dead.id),ownerInScope);assert.equal(ids.includes(f.r.id),!ownerInScope);assert.equal(ids.includes(f.child.id),!ownerInScope);assert.equal(f.c.status,'active');}
 else assert.equal(ids.includes(f.r.id),ownerInScope);
 const plan=queueHarvest(f);let w=f.w;const initial=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute);
 const tick=()=>{const before=snapshotNineFood(w,ids),observation=stepWorldWithFoodEvidence(w,1),after=snapshotNineFood(w,ids);collector.sample(before,after,observation);return {before,after,observation};};
 for(let i=0;i<5;i++)tick();assert.ok(w.residents.find(r=>r.id===actorId)!.activity);assert.equal(collector.finish().foodFlows.receipts.length,0);
 const mid=snapshotNineFood(w,ids);w=reloadHarvest(w);assert.deepEqual(snapshotNineFood(w,ids),mid);
 for(let n=0;;n++){const actor=w.residents.find(r=>r.id===actorId)!;if(!actor.activity&&!actor.plan)break;assert.ok(n<50);tick();}
 assert.equal(w.residents.find(r=>r.id===actorId)!.lastFailure,null);
 const final=snapshotNineFood(w,ids),report=collector.finish(),flows=report.foodFlows.receipts;
 assert.equal(flows.length,1);const flow=flows[0];assert.ok(flow.action==='harvest_house'||flow.action==='custody_harvest');assert.equal(flow.residentId,actorId);assert.equal(flow.planId,plan.id);assert.equal(flow.outputs[0].quantity,12);
 assert.deepEqual(report.foodFlows.scopes,[ownerInScope?'nine-and-public':'external']);assert.equal(report.foodFlows.scopedTotals!.sourceAdded.units.turnip,ownerInScope?12:0);assert.equal(report.foodFlows.scopedTotals!.inputs.units.turnip,0);assert.equal(report.foodFlows.scopedTotals!.outputs.units.turnip,0);
 assert.equal(final.scopedTotals.turnip!-initial.scopedTotals.turnip!,ownerInScope?12:0);assert.equal(final.externalTotals.turnip!-initial.externalTotals.turnip!,ownerInScope?0:12);
 const physical=final.containers.filter(c=>c.aliases.includes(flow.container));assert.equal(physical.length,1);assert.equal(physical[0].units.turnip,12);assert.equal(physical[0].scope,ownerInScope?'nine-and-public':'external');
 if(flow.action==='custody_harvest'&&'c' in f){
  assert.equal(flow.workSerial,0);assert.equal(flow.estateOwnerId,f.dead.id);assert.equal(flow.beneficiaryId,f.child.id);assert.equal(flow.shareId,f.share.id);assert.equal(physical[0].ownerId,f.dead.id);
  const parcel=estateParcel(w,flow.container)!,share=w.production!.inheritances[f.dead.id].shares.find(s=>s.id===f.share.id)!;
  assert.equal(parcel.inventory.turnip,12);assert.equal(share.inventory.turnip,12,'share aggregate is a rights view of the same physical crop');assert.ok(share.goodsClaims!.includes(parcel.id));
  assert.equal(final.containers.some(c=>c.id===share.id),false,'share aggregate is not an additional physical stock');assert.equal(w.residents.find(r=>r.id===actorId)!.inventory.turnip??0,0);assert.equal(w.residents.find(r=>r.id===f.child.id)!.inventory.turnip??0,0);
 }else if(flow.action==='harvest_house'){assert.equal(flow.ownerId,actorId);assert.equal(physical[0].ownerId,actorId);}
 assert.equal(report.foodFlows.observedMinutes,kind==='house'?15:20);assert.equal(report.foodFlows.unobservedMinutes,0);assert.equal(report.completeFoodLedger,false);assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);assert.equal(report.foodFlows.nineIntakeTotals,null);
 const completed=structuredClone(w);w=reloadHarvest(w);assert.deepEqual(w,completed);assert.deepEqual(snapshotNineFood(w,ids),final);
 for(let i=0;i<3;i++){const {observation}=tick();assert.deepEqual(observation.foodFlows,[],'reload must not reissue a completed harvest');}
 const resumed=collector.finish();assert.equal(resumed.foodFlows.receipts.length,1);assert.equal(resumed.foodFlows.observedMinutes,kind==='house'?18:23);assert.equal(resumed.foodFlows.scopedTotals!.sourceAdded.units.turnip,ownerInScope?12:0);assert.deepEqual([...ids],originalIds);assert.deepEqual(resumed.founderIds,[...originalIds].sort());
 const unchanged=structuredClone(w);snapshotNineFood(w,ids);collector.finish();assert.deepEqual(w,unchanged);assert.equal(fetchCalls,0);
});

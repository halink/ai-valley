import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld,stepWorldWithFoodEvidence,submitPlan} from '../src/world/engine.js';
import {initializeFood} from '../src/world/food.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import {snapshotNineFood,createNineFoodEvidence} from './helpers/nine-food-accounting.js';
import type {World} from '../src/shared/types.js';

function fixture(){const w=createFrontierWorld(5401);w.clock.paused=false;stepWorld(w,1);return {w,ids:w.residents.map(r=>r.id)};}
function roundtrip(w:World){
 const directory=mkdtempSync(join(testTmpdir(),'nine-accounting-synthetic-')),path=join(directory,'fixture.sqlite');
 try{const store=new WorldStore(path);try{store.commit(w,null);}finally{store.close();}
  const reopened=new WorldStore(path);try{return reopened.load()!;}finally{reopened.close();}
 }finally{rmSync(directory,{recursive:true,force:true});}
}
test('synthetic family/estate/craft spoilage is captured once, reconciles scoped stock, and reloads without audit side effects',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Offline synthetic test');});
 const {w,ids}=fixture(),r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 // Explicit fixture injection, separate from the unchanged normal-menu opening.
 w.estates.push({personId:r.id,inventory:{turnip:2},coins:0,status:'protected',heirs:[],parcels:[{id:'opaque-parcel',ownerId:r.id,inventory:{turnip:3},location:{at:{...home.door},inside:null,roomAt:null},createdAt:w.minute,source:'synthetic',claimId:null}]});
 w.industry!.batches.push({id:'synthetic-craft',ownerId:r.id,buildingId:home.id,recipe:{id:'synthetic',name:'Synthetic',input:{turnip:4,water:1},output:{meal:2},minutes:10,station:null,skill:'farming',minimum:0},input:{turnip:4,water:1},actionKey:'synthetic',worked:0,lastAt:w.minute,status:'working',createdAt:w.minute});
 w.household!.pools.push({id:'synthetic-family',definition:'family/shared@1',name:'Synthetic',creatorId:r.id,partnerId:ids[1],buildingId:home.id,at:{...home.door},account:'escrow:synthetic',initial:{coins:0,quantity:0},credits:[{ownerId:r.id,coins:0,inventory:{turnip:5}}],status:'closed',createdAt:w.minute,expiresAt:w.minute+100,acceptedAt:w.minute,closedAt:w.minute,reason:null});
 initializeFood(w);
 const containers=['estate:'+r.id,'opaque-parcel','craft:synthetic-craft','family-stock:synthetic-family:'+r.id];
 for(const id of containers)for(const lot of w.food!.lots[id].turnip!)lot.expiresAt=w.minute+1;
 const before=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute),plain=structuredClone(w);
 const observation=stepWorldWithFoodEvidence(w,1);collector.sample(before,snapshotNineFood(w,ids),observation);stepWorld(plain,1);
 assert.deepEqual(w,plain,'audit must not change engine behavior');
 const report=collector.finish(),losses=report.foodLosses.receipts.filter(r=>containers.includes(r.container));
 assert.equal(losses.length,4);assert.equal(losses.reduce((n,r)=>n+r.amount.quantity,0),14);
 assert.equal(snapshotNineFood(w,ids).scopedTotals.turnip,before.scopedTotals.turnip!-14);
 assert.equal(report.foodLosses.scopedTotals!.inputs.units.turnip,14);
 assert.equal(w.industry!.batches[0].status,'cancelled');assert.equal(w.industry!.batches[0].input.turnip,undefined);
 const saved=roundtrip(w);assert.deepEqual(saved,w);assert.deepEqual(snapshotNineFood(saved,ids),snapshotNineFood(w,ids));
 const atRest=structuredClone(saved);snapshotNineFood(saved,ids);collector.finish();assert.deepEqual(saved,atRest);
 const next=stepWorldWithFoodEvidence(saved,1);assert.equal(next.foodLosses!.some(l=>containers.includes(l.container)),false);
 assert.doesNotMatch(JSON.stringify(saved),/"(?:scopedTotals|foodFlows|foodLosses|completeFoodLedger)"\s*:/);
});

test('normal numbered industry work reserves physical inputs, reloads, then records completed craft conversion without treating the output as source production',t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Offline synthetic test');});
 let {w,ids}=fixture();const actorId=ids[0],r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 r.at={...home.door};r.inside=null;r.roomAt=null;r.inventory={gameMeat:1,wood:1,water:1};r.hunger=20;r.energy=100;initializeFood(w);
 const collector=createNineFoodEvidence(w.id,w.minute),initial=snapshotNineFood(w,ids);
 function tick(){const before=snapshotNineFood(w,ids),o=stepWorldWithFoodEvidence(w,1);collector.sample(before,snapshotNineFood(w,ids),o);}
 function craft(minutes:number){
  for(let attempt=0;attempt<40;attempt++){
   const actor=w.residents.find(r=>r.id===actorId)!,choices=decisionChoices(decisionContext(w,actor)),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='craft'&&c.action.recipeId==='gameMeal');
   const selected=choice??choices.find(c=>c.action.type==='wait')!;assert.ok(selected);
   const parsed=parseChoice(JSON.stringify({choice:selected.id,minutes:choice?minutes:30}),choices);
   assert.equal(submitPlan(w,{id:'synthetic-craft:'+w.minute,actorId,actorRevision:actor.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Synthetic menu craft',actions:parsed.actions}).ok,true);
   let limit=500;while(actor.plan||actor.activity){assert.ok(limit-->0);tick();}assert.equal(actor.lastFailure,null);
   if(choice)return;
  }throw new Error('No numbered industry craft choice');
 }
 craft(10);const reserved=snapshotNineFood(w,ids),batch=w.industry!.batches.find(b=>b.ownerId===actorId)!;
 assert.equal(batch.status,'working');assert.equal(reserved.scopedTotals.gameMeat,initial.scopedTotals.gameMeat);
 assert.equal(reserved.containers.find(c=>c.id==='craft:'+batch.id)!.units.gameMeat,1);
 assert.equal(w.residents[0].inventory.gameMeat,0);assert.equal(w.residents[0].inventory.meal??0,0);
 const beforeSave=structuredClone(w);w=roundtrip(w);assert.deepEqual(w,beforeSave);assert.deepEqual(snapshotNineFood(w,ids),reserved);
 craft(25);const final=snapshotNineFood(w,ids),report=collector.finish();
 assert.equal(w.industry!.batches.find(b=>b.id===batch.id)!.status,'completed');
 assert.equal(final.scopedTotals.gameMeat,initial.scopedTotals.gameMeat!-1);assert.equal(final.scopedTotals.meal,initial.scopedTotals.meal!+2);
 assert.equal(final.containers.some(c=>c.id==='craft:'+batch.id),false,'completed input is historical metadata, not stock');
 const flows=report.foodFlows.receipts.filter(f=>f.action==='industry_craft');assert.equal(flows.length,1);
 assert.equal(flows[0].batchId,batch.id);assert.deepEqual(flows[0].inputs.map(a=>[a.item,a.quantity]),[['gameMeat',1],['water',1],['wood',1]]);
 assert.equal(report.foodFlows.scopedTotals!.inputs.units.gameMeat,1);assert.equal(report.foodFlows.scopedTotals!.outputs.units.meal,2);
 assert.equal(report.completeFoodLedger,false);assert.ok(report.uncovered.includes('non-food industry craft and non-food employment processing'));
 assert.equal(report.foodFlows.scopedTotals!.sourceAdded.units.meal,0,'gross craft output is not a new food source');
});

test('duplicate step or receipt is rejected before changing collected evidence',()=>{
 const {w,ids}=fixture(),collector=createNineFoodEvidence(w.id,w.minute),before=snapshotNineFood(w,ids),observation=stepWorldWithFoodEvidence(w,1),after=snapshotNineFood(w,ids);
 const receipt={at:w.minute,residentId:ids[0],eventId:'synthetic:eat',planId:'synthetic:plan',container:'person:'+ids[0],item:'turnip' as const,quantity:1,nutrition:20,hungerRelief:20};
 const bad={...observation,receipts:[receipt,structuredClone(receipt)]};
 assert.throws(()=>collector.sample(before,after,bad),/Duplicate food receipt/);
 assert.equal(collector.finish().directEating.observedMinutes,0);
 collector.sample(before,after,observation);const collected=collector.finish();
 assert.throws(()=>collector.sample(before,after,observation),/consecutive one-minute/);
 assert.deepEqual(collector.finish(),collected);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {aidTransferFixture,queueAidCollection,finishAidCollection,aidTransfers} from './helpers/food-transfer-aid.js';
import {stepWorldWithFoodEvidence,stepWorld} from '../src/world/engine.js';
import {FOOD_TRANSFER_COVERAGE,type DirectEatingObservation,type FoodTransferReceipt} from '../src/world/food-consumption-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {AcceptanceEvidenceWriter} from '../src/server/acceptance-evidence-writer.js';
import {observedFoodTransfersByDay,auditFoodTransfers} from '../src/server/food-transfer-evidence.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
import {createWorld} from '../src/world/seed.js';
import {WorldStore} from '../src/server/store.js';

function transfer():FoodTransferReceipt{return {type:'transfer',action:'outsideAid',operation:'collect',at:11,eventId:'event-one',deliveryId:'delivery-one',noticeId:'notice-one',merchantId:'merchant-one',recipientId:'fixed-0',container:'aid:delivery-one',destinationContainer:'person:fixed-0',amount:{item:'turnip',quantity:2,nutrition:14,lots:[{quantity:2,nutrition:14,producedAt:0,expiresAt:100,definition:'food/original@1'}]}};}
function observation():DirectEatingObservation{return {worldId:'world',fromMinute:10,toMinute:11,receipts:[],foodTransfers:[transfer()],foodTransferCoverage:FOOD_TRANSFER_COVERAGE};}
function event(o=observation()):RuntimeFoodEvent{return {schema:1,sessionId:'session-one',sequence:2,type:'food_step_committed',revision:1,...o};}
function nine(){const w=createWorld(),ids=Array.from({length:9},(_,i)=>'fixed-'+i);w.minute=10;const before=snapshotNineFood(w,ids);w.minute=11;const after=snapshotNineFood(w,ids),c=createNineFoodEvidence(w.id,10);return {w,ids,before,after,c,o:{...observation(),worldId:w.id}};}

for(const repair of ['missing','under-count'] as const)test('review: '+repair+' source repaired on an earlier captured step never becomes original nutrition',()=>{
 const f=aidTransferFixture();queueAidCollection(f);const container='aid:'+f.d.id;
 if(repair==='missing')delete f.w.food!.lots[container];else f.w.food!.lots[container].turnip![0].quantity=2;
 stepWorldWithFoodEvidence(f.w,1);
 const receipt=aidTransfers(finishAidCollection(f.w,f.r))[0];
 assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);
 assert.equal(f.r.inventory.turnip,4);
});

for(const delta of [0,1])test('review: original lots at or after reservation time cannot certify aid nutrition: '+delta,()=>{
 const f=aidTransferFixture();queueAidCollection(f);f.w.food!.lots['aid:'+f.d.id].turnip![0].producedAt=f.d.createdAt+delta;
 const receipt=aidTransfers(finishAidCollection(f.w,f.r))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);
});

// A later normalized ledger retaining an old lot is indistinguishable from a
// legitimate original lot. This slice does not certify historical ledger integrity.
test('review: earlier over-count trimming retains surviving original lot metadata, not a proof of no repair',()=>{
 const f=aidTransferFixture();queueAidCollection(f);f.w.food!.lots['aid:'+f.d.id].turnip![0].quantity=5;stepWorldWithFoodEvidence(f.w,1);
 const receipt=aidTransfers(finishAidCollection(f.w,f.r))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,28);assert.equal(receipt.amount.lots![0].definition,'food/aid-original@1');
});

test('review: original provenance remains unknown across an uncaptured intervening step',()=>{
 const f=aidTransferFixture();queueAidCollection(f);delete f.w.food!.lots['aid:'+f.d.id];stepWorldWithFoodEvidence(f.w,1);stepWorld(f.w,1);
 assert.equal(aidTransfers(finishAidCollection(f.w,f.r))[0].amount.nutrition,null);
});

test('review: initialization repair saved and reloaded before collection cannot prove original lots',()=>{
 const f=aidTransferFixture();queueAidCollection(f);delete f.w.food!.lots['aid:'+f.d.id];stepWorldWithFoodEvidence(f.w,1);
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const loaded=store.load(true)!,actor=loaded.residents.find(r=>r.id===f.r.id)!;
  const receipt=aidTransfers(finishAidCollection(loaded,actor))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);
 }finally{store.close();}
});

test('review: helper rejects a coverage assertion without the corresponding array before advancing',()=>{
 const {c,before,after,o}=nine(),bad={...o};delete bad.foodTransfers;
 assert.throws(()=>c.sample(before,after,bad));
 c.sample(before,after,o);const result=c.finish().foodTransfers;
 assert.equal(result.observedMinutes,1);assert.equal(result.unobservedMinutes,0);assert.equal(result.receipts.length,1);
});

test('review: helper later-slice collision rejects all transfer identity and coverage mutations',()=>{
 const {c,before,after,o}=nine();o.receipts=[{at:11,residentId:'fixed-0',eventId:'event-one',planId:'plan-one',container:'person:fixed-0',item:'turnip',quantity:1,nutrition:7,hungerRelief:20}];
 assert.throws(()=>c.sample(before,after,o),/Duplicate/);o.receipts=[];c.sample(before,after,o);
 const result=c.finish();assert.equal(result.foodTransfers.receipts.length,1);assert.equal(result.foodTransfers.scopeInflowTotals!.nutrition,14);assert.equal(result.directEating.nineIntakeTotals!.nutrition,0);
});

test('review: runtime rejects an accessor in the second transfer before publishing any part',()=>{
 const events:RuntimeFoodEvent[]=[],runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);}}),o=observation();let calls=0;
 const second={...transfer(),eventId:'event-two',deliveryId:'delivery-two',container:'aid:delivery-two'};
 Object.defineProperty(second.amount={...second.amount},'nutrition',{get(){calls++;throw Error('must not invoke');}});o.foodTransfers!.push(second);
 runtime.start('world',10);runtime.committed(o,1);
 assert.equal(events.length,1);assert.equal(calls,0);assert.equal(runtime.status().throughMinute,10);assert.equal(runtime.status().lastSequence,1);assert.equal(runtime.status().phase,'failed');
});

test('review: strict writer validates every transfer before appending journal bytes',t=>{
 const root=mkdtempSync(join(testTmpdir(),'aid-review-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'evidence'),writer=new AcceptanceEvidenceWriter({directory,worldId:'world',fromMinute:10,sourceFingerprint:'a'.repeat(64)});t.after(()=>writer.abort());
 const o=observation(),bad={...transfer(),eventId:'event-two',deliveryId:'delivery-two',container:'aid:delivery-two'};Object.assign(bad.amount={...bad.amount},{privateText:'not permitted'});o.foodTransfers!.push(bad);
 assert.throws(()=>writer.observeDirectEating(event(o)),/invalid_input/);assert.equal(readFileSync(join(directory,'evidence.jsonl'),'utf8'),'');assert.equal(writer.status().durableRecords,0);
});

test('review: daily rows detach original amounts and reject a malformed later event without partial return',()=>{
 const e=event(),days=observedFoodTransfersByDay([e]);if(e.type!=='food_step_committed')throw Error('unreachable');
 e.foodTransfers![0].amount.quantity=20;assert.equal(days[0].receipts[0].amount.quantity,2);
 assert.throws(()=>observedFoodTransfersByDay([event(),e]),/invalid_evidence_schema/);
 const old={...event()} as any;delete old.foodTransfers;delete old.foodTransferCoverage;assert.deepEqual(observedFoodTransfersByDay([old]),[]);
 const audit=auditFoodTransfers([{schema:1,sessionId:'session-one',sequence:1,worldId:'world',type:'food_session_started',fromMinute:10},old,{schema:1,sessionId:'session-one',sequence:3,worldId:'world',type:'food_session_stopped',toMinute:11}],true);
 assert.equal(audit.totals,null);assert.ok(audit.issues.includes('missing_transfer_coverage'));
});

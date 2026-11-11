import assert from 'node:assert/strict';
import {test} from 'node:test';
import {aidTransferFixture,aidTransfers,arriveAid,queueAidCollection,finishAidCollection} from './helpers/food-transfer-aid.js';
import {captureDirectEating,FOOD_TRANSFER_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {completeOutsideAid,advanceOutsideAid,outsideAidReason} from '../src/world/outside-aid.js';
import {stepWorld,stepWorldWithFoodEvidence,hasTimelySelfRescue} from '../src/world/engine.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';

test('normal numbered collection transfers remaining original lots once, without nutrition intake or authority changes',()=>{
 const f=aidTransferFixture(),{w,r,d,n,m}=f,original=structuredClone(w.food!.lots['aid:'+d.id].turnip!);
 const rights={guardians:r.guardianIds,home:r.homeId,residency:r.residency,people:w.residents.length},hunger=r.hunger;
 queueAidCollection(f);const observations=finishAidCollection(w,r),receipts=aidTransfers(observations);assert.equal(receipts.length,1);
 const receipt=receipts[0];assert.equal(receipt.type,'transfer');assert.equal(receipt.action,'outsideAid');assert.equal(receipt.operation,'collect');
 assert.equal(receipt.deliveryId,d.id);assert.equal(receipt.noticeId,n.id);assert.equal(receipt.merchantId,m.id);assert.equal(receipt.recipientId,r.id);
 assert.equal(receipt.container,'aid:'+d.id);assert.equal(receipt.destinationContainer,'person:'+r.id);assert.equal(receipt.amount.item,'turnip');
 assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,28);assert.equal(d.quantity,4);assert.equal(d.collectedQuantity,4);assert.equal(d.inventory.turnip,0);assert.equal(r.inventory.turnip,4);
 assert.deepEqual(receipt.amount.lots!.map(({nutrition,...lot})=>lot),original);assert.deepEqual(w.food!.lots['person:'+r.id].turnip,original);
 assert.equal(w.events.find(e=>e.id===receipt.eventId)!.at,receipt.at);assert.ok(d.eventIds.includes(receipt.eventId));
 assert.ok(r.hunger>hunger,'collection is not eating');assert.ok(observations.every(o=>o.foodTransferCoverage===FOOD_TRANSFER_COVERAGE&&o.receipts.length===0&&o.foodFlows!.length===0));
 assert.deepEqual({guardians:r.guardianIds,home:r.homeId,residency:r.residency,people:w.residents.length},rights);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodTransfers,[]);assert.ok(outsideAidReason(w,r,{type:'outsideAid',operation:'collect',deliveryId:d.id}));
});

test('partial spoilage moves fractional real remainder, never the original promised four portions',()=>{
 const f=aidTransferFixture(),{w,r,d}=f,lot=w.food!.lots['aid:'+d.id].turnip![0];
 w.food!.lots['aid:'+d.id].turnip=[{...lot,quantity:1.5,expiresAt:w.minute+2},{...lot,quantity:2.5}];
 queueAidCollection(f);const observations=finishAidCollection(w,r),receipt=aidTransfers(observations)[0];
 assert.equal(d.quantity,4);assert.equal(d.collectedQuantity,2.5);assert.equal(r.inventory.turnip,2.5);assert.equal(receipt.amount.quantity,2.5);assert.equal(receipt.amount.nutrition,17.5);
 assert.equal(receipt.amount.lots![0].quantity,2.5);assert.equal(receipt.amount.lots![0].expiresAt,lot.expiresAt);
 assert.equal(observations.flatMap(o=>o.foodLosses??[]).filter(l=>l.container==='aid:'+d.id).reduce((n,l)=>n+l.amount.quantity,0),1.5);
 assert.ok(observations.every(o=>o.receipts.length===0));
});

for(const change of ['withdraw','expired-request','insufficient-remainder','wrong-recipient','dead','cannot-decide','cannot-express','outside','blocked-gate'] as const)test(`last completion rechecks ${change} without emitting successful collection`,()=>{
 const f=aidTransferFixture(),{w,r,d,n}=f;queueAidCollection(f);
 for(let i=0;r.activity?.remaining!==1;i++){assert.ok(i<10);assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodTransfers,[]);}
 if(change==='withdraw')n.withdrawnAt=w.minute;
 else if(change==='expired-request')n.expiresAt=w.minute+1;
 else if(change==='insufficient-remainder'){const original=w.food!.lots['aid:'+d.id].turnip![0];w.food!.lots['aid:'+d.id].turnip=[{...original,quantity:3.5,expiresAt:w.minute+1},{...original,quantity:.5}];}
 else if(change==='wrong-recipient')d.residentId=f.other.id;
 else if(change==='dead')r.health=0;
 else if(change==='cannot-decide')r.canDecide=false;
 else if(change==='cannot-express')r.canExpress=false;
 else if(change==='outside')r.residency='outside';
 else w.map.tiles[r.at.y*w.map.width+r.at.x]='water';
 // Outside residents no longer advance a local action; do not force that paused
 // activity to finish just to exercise the original authorization check.
 const observations=change==='outside'?[stepWorldWithFoodEvidence(w,2)]:finishAidCollection(w,r,false);
 if(change==='outside')assert.ok(completeOutsideAid(w,r,{type:'outsideAid',operation:'collect',deliveryId:d.id}));
 assert.deepEqual(aidTransfers(observations),[]);assert.notEqual(d.status,'collected');assert.equal(r.inventory.turnip??0,0);
});

test('competing actor and repeated claimant cannot take or record another copy of the delivery',()=>{
 const f=aidTransferFixture(),{w,r,other,d}=f,action={type:'outsideAid' as const,operation:'collect' as const,deliveryId:d.id};
 assert.deepEqual(captureDirectEating(w,()=>assert.ok(completeOutsideAid(w,other,action))).foodTransfers,[]);
 queueAidCollection(f);stepWorldWithFoodEvidence(w,1);
 const competing=captureDirectEating(w,()=>assert.equal(completeOutsideAid(w,r,action),null));assert.equal(competing.foodTransfers!.length,1);
 assert.deepEqual(aidTransfers(finishAidCollection(w,r,false)),[]);assert.equal(r.inventory.turnip,4);assert.equal(other.inventory.turnip??0,0);
 assert.deepEqual(captureDirectEating(w,()=>assert.ok(completeOutsideAid(w,r,action))).foodTransfers,[]);
});

test('dispatch, arrival, uncollected wait, cancellation and withdrawn return do not record boundary entry',()=>{
 const f=aidTransferFixture(4,false),{w,r,d,m}=f;
 const arrival=captureDirectEating(w,()=>arriveAid(f));assert.deepEqual(arrival.foodTransfers,[]);assert.equal(d.status,'arrived');assert.equal(r.inventory.turnip??0,0);
 assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodTransfers,[]);
 const returned=captureDirectEating(w,()=>{assert.equal(completeOutsideAid(w,r,{type:'outsideAid',operation:'withdraw',noticeId:d.noticeId}),null);advanceOutsideAid(w);w.minute=d.arrivesAt!;advanceOutsideAid(w);});
 assert.deepEqual(returned.foodTransfers,[]);assert.equal(d.status,'returned');assert.equal(m.person.inventory.turnip,36);
 const g=aidTransferFixture(4,false);assert.deepEqual(captureDirectEating(g.w,()=>assert.equal(completeOutsideAid(g.w,g.m.person,{type:'outsideAid',operation:'cancel',deliveryId:g.d.id}),null)).foodTransfers,[]);
 assert.equal(g.d.status,'returned');
});

for(const missing of ['missing','under-count','over-count','malformed-definition','future-produced','missing-nutrition'] as const)test(`original ${missing} lots preserve real quantity but cannot invent nutrition`,()=>{
 const f=aidTransferFixture(),{w,r,d}=f;queueAidCollection(f);
 for(let i=0;r.activity?.remaining!==1;i++){assert.ok(i<10);stepWorldWithFoodEvidence(w,1);}
 const container='aid:'+d.id,lot=w.food!.lots[container].turnip![0];
 if(missing==='missing')delete w.food!.lots[container];
 else if(missing==='under-count')lot.quantity=2;
 else if(missing==='over-count')lot.quantity=5;
 else if(missing==='malformed-definition')lot.definition='not a definition';
 else if(missing==='future-produced')lot.producedAt=w.minute+20;
 else lot.definition='food/unknown-original@1';
 const receipt=aidTransfers(finishAidCollection(w,r))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);
 if(missing==='missing-nutrition')assert.equal(receipt.amount.lots![0].definition,'food/unknown-original@1');else assert.equal(receipt.amount.lots,null);
 assert.equal(r.inventory.turnip,4);
});

test('SQLite before final completion preserves source lots and completed reload does not replay transfer',()=>{
 const f=aidTransferFixture(),{w,r,d}=f;queueAidCollection(f);stepWorldWithFoodEvidence(w,2);
 const original=structuredClone(w.food!.lots['aid:'+d.id].turnip!),store=new WorldStore(':memory:');
 try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(p=>p.id===r.id)!;
  const receipt=aidTransfers(finishAidCollection(loaded,actor))[0];assert.deepEqual(receipt.amount.lots!.map(({nutrition,...lot})=>lot),original);
  assert.equal(receipt.amount.nutrition,28);store.commit(loaded,w.revision);const again=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(again,1).foodTransfers,[]);
  assert.equal(again.outsideAid!.deliveries.find(x=>x.id===d.id)!.collectedQuantity,4);assert.doesNotMatch(JSON.stringify(again),/"(?:foodTransfers|foodTransferCoverage|destinationContainer)"\s*:/);
 }finally{store.close();}
});

test('capture toggling, prediction and menu reads preserve world and knowledge; failed capture cannot leak into the next step',()=>{
 const f=aidTransferFixture(),{w,r}=f;queueAidCollection(f);const plain=copyForSimulation(w),prediction=copyForSimulation(w),before=structuredClone(w);
 assert.deepEqual(captureDirectEating(w,()=>{while(prediction.residents[0].plan||prediction.residents[0].activity)stepWorld(prediction,1);hasTimelySelfRescue(w,r,[{type:'outsideAid',operation:'collect',deliveryId:f.d.id}]);decisionContext(w,r);}).foodTransfers,[]);assert.deepEqual(w,before);
 const receipts=[];while(r.plan||r.activity){receipts.push(...stepWorldWithFoodEvidence(w,1).foodTransfers!);stepWorld(plain,1);}assert.equal(receipts.length,1);assert.deepEqual(w,plain);
 assert.deepEqual(decisionChoices(decisionContext(w,r)),decisionChoices(decisionContext(plain,plain.residents[0])));
 const g=aidTransferFixture();queueAidCollection(g);assert.throws(()=>captureDirectEating(g.w,()=>{while(g.r.plan||g.r.activity)stepWorld(g.w,1);throw Error('synthetic_failed_observation');}),/synthetic_failed_observation/);
 assert.equal(g.r.inventory.turnip,4);assert.deepEqual(stepWorldWithFoodEvidence(g.w,1).foodTransfers,[]);
});

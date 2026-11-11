import assert from 'node:assert/strict';
import {test} from 'node:test';
import {foreignTransferFixture,foreignShipmentFixture,merchantOffer,residentProposal,queueForeignAction,finishForeignAction,foreignTransfers} from './helpers/food-transfer-foreign.js';
import {captureDirectEating,FOOD_TRANSFER_COVERAGE} from '../src/world/food-consumption-evidence.js';
import {completeForeignTrade,advanceForeignTrade} from '../src/world/foreign-trade.js';
import {initializeFood} from '../src/world/food.js';
import {stepWorld,stepWorldWithFoodEvidence,hasTimelySelfRescue} from '../src/world/engine.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {WorldStore} from '../src/server/store.js';
import {recordDeath} from '../src/world/life.js';

for(const branch of ['propose','accept'] as const)test(`real numbered resident export ${branch} records only actual reservation`,()=>{
 const f=foreignTransferFixture(),{w,r,m}=f;const o=branch==='accept'?merchantOffer(f,'export'):null;
 queueForeignAction(w,r,branch==='propose'?{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity:4,price:1,maximumLevyBasisPoints:0}:{type:'foreignTrade',operation:'accept',offerId:o!.id,quantity:4,quotedPrice:1,maximumLevyBasisPoints:0});
 const observations=finishForeignAction(w,r),receipts=foreignTransfers(observations);assert.equal(receipts.length,1);const receipt=receipts[0];
 assert.equal(receipt.operation,branch==='propose'?'reserveOffer':'reserveShipment');assert.equal(receipt.container,'person:'+r.id);assert.equal(receipt.personId,r.id);assert.equal(receipt.estateOwnerId,null);assert.equal(receipt.side,'export');assert.equal(receipt.returned,false);assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null,'personal stock has no durable original-provenance proof');assert.equal(receipt.amount.lots,null);assert.equal(r.inventory.turnip,4);
 assert.equal(receipt.destinationContainer,(branch==='propose'?'offer:':'shipment:')+(branch==='propose'?receipt.offerId:receipt.shipmentId));assert.ok(w.events.some(e=>e.id===receipt.eventId&&e.at===receipt.at));
 assert.equal(w.foreignTrade!.totals.exports,0);assert.ok(observations.every(o=>o.receipts.length===0&&o.foodFlows!.length===0&&o.foodTransferCoverage===FOOD_TRANSFER_COVERAGE));
});

test('import arrival is not collection; numbered collection preserves original lots once',()=>{
 const f=foreignShipmentFixture('import',false),{w,r,s}=f;const original=structuredClone(w.food!.lots['shipment:'+s.id].turnip!);
 assert.deepEqual(captureDirectEating(w,()=>{w.minute=s.arrivesAt!;advanceForeignTrade(w);}).foodTransfers,[]);assert.equal(s.status,'arrived');assert.equal(r.inventory.turnip,8);
 queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});const observations=finishForeignAction(w,r),receipts=foreignTransfers(observations);assert.equal(receipts.length,1);const receipt=receipts[0];
 assert.equal(receipt.operation,'collect');assert.equal(receipt.shipmentId,s.id);assert.equal(receipt.offerId,s.offerId);assert.equal(receipt.residentId,r.id);assert.equal(receipt.merchantId,f.m.id);assert.equal(receipt.container,'shipment:'+s.id);assert.equal(receipt.destinationContainer,'person:'+r.id);assert.equal(receipt.amount.nutrition,28);assert.deepEqual(receipt.amount.lots!.map(({nutrition,...lot})=>lot),original);assert.equal(r.inventory.turnip,12);assert.equal(s.goods,0);assert.ok(observations.every(o=>o.receipts.length===0));
 assert.deepEqual(captureDirectEating(w,()=>assert.ok(completeForeignTrade(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id}))).foodTransfers,[]);
});

for(const mode of ['cancelOffer','reject','cancelShipment'] as const)test(`${mode} only records returned export at actual collection`,()=>{
 const f=foreignTransferFixture(),{w,r,m}=f,o=residentProposal(f);
 const noBoundary=captureDirectEating(w,()=>{if(mode==='cancelOffer')assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:mode,offerId:o.id}),null);else{w.minute=o.noticeAt;advanceForeignTrade(w);assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:mode==='reject'?'reject':'accept',offerId:o.id}),null);if(mode==='cancelShipment'){const s=w.foreignTrade!.shipments.at(-1)!;w.minute=s.readyAt;assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:mode,shipmentId:s.id}),null);}}});assert.deepEqual(noBoundary.foodTransfers,[]);
 const s=w.foreignTrade!.shipments.at(-1)!;w.minute=Math.max(w.minute,s.readyAt);queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});const receipt=foreignTransfers(finishForeignAction(w,r))[0];assert.equal(receipt.operation,'collect');assert.equal(receipt.returned,true);assert.equal(receipt.side,'export');assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,28);assert.equal(r.inventory.turnip,8);assert.equal(w.foreignTrade!.totals.exports,0);
});

for(const remainder of [.5,2.5,0])test(`spoilage leaves ${remainder} real portions without inventing full promised shipment`,()=>{
 const {w,r,s}=foreignShipmentFixture(),container='shipment:'+s.id,lot=w.food!.lots[container].turnip![0];w.food!.lots[container].turnip=[{...lot,quantity:4-remainder,expiresAt:w.minute+2},...(remainder?[{...lot,quantity:remainder}]:[])];queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});const observations=finishForeignAction(w,r,remainder>0),receipts=foreignTransfers(observations);
 assert.equal(receipts.length,remainder?1:0);if(remainder){assert.equal(receipts[0].amount.quantity,remainder);assert.equal(receipts[0].amount.nutrition,remainder*7);}assert.equal(r.inventory.turnip,8+remainder);assert.equal(observations.flatMap(o=>o.foodLosses??[]).filter(l=>l.container===container).reduce((n,l)=>n+l.amount.quantity,0),4-remainder);
});

for(const change of ['identity','cannot-decide','cannot-express','outside','place','dead'] as const)test(`completion rechecks ${change}; no successful personal transfer`,()=>{
 const {w,r,s,other}=foreignShipmentFixture();queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});for(let i=0;r.activity?.remaining!==1;i++){assert.ok(i<15);stepWorldWithFoodEvidence(w,1);}
 if(change==='identity')s.residentId=other.id;else if(change==='cannot-decide')r.canDecide=false;else if(change==='cannot-express')r.canExpress=false;else if(change==='outside')r.residency='outside';else if(change==='place')r.at={x:10,y:6};else r.health=0;
 const receipts=foreignTransfers(change==='outside'?[stepWorldWithFoodEvidence(w,2)]:finishForeignAction(w,r,false));assert.equal(receipts.filter(x=>x.operation==='collect').length,0);assert.notEqual(s.collectedAt,w.minute);assert.equal(r.inventory.turnip===12,false);
});

test('competition and replay cannot collect a duplicate',()=>{
 const {w,r,s,other}=foreignShipmentFixture(),action={type:'foreignTrade' as const,operation:'collect' as const,shipmentId:s.id};assert.deepEqual(captureDirectEating(w,()=>assert.ok(completeForeignTrade(w,other,action))).foodTransfers,[]);queueForeignAction(w,r,action);stepWorldWithFoodEvidence(w,1);assert.equal(captureDirectEating(w,()=>assert.equal(completeForeignTrade(w,r,action),null)).foodTransfers!.length,1);assert.deepEqual(foreignTransfers(finishForeignAction(w,r,false)),[]);assert.equal(r.inventory.turnip,12);
});

for(const missing of ['missing','under-count','over-count','future-produced','reservation-produced','missing-nutrition','prior-repair'] as const)test(`${missing} source metadata does not manufacture original nutrition`,()=>{
 const {w,r,s}=foreignShipmentFixture();queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});for(let i=0;r.activity?.remaining!==1;i++){assert.ok(i<15);stepWorldWithFoodEvidence(w,1);}const container='shipment:'+s.id,lot=w.food!.lots[container].turnip![0];
 if(missing==='missing'||missing==='prior-repair'){delete w.food!.lots[container];if(missing==='prior-repair')initializeFood(w);}else if(missing==='under-count')lot.quantity=2;else if(missing==='over-count')lot.quantity=5;else if(missing==='future-produced')lot.producedAt=w.minute+20;else if(missing==='reservation-produced')lot.producedAt=s.createdAt;else lot.definition='food/unknown-original@1';
 const receipt=foreignTransfers(finishForeignAction(w,r))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);if(missing!=='missing-nutrition')assert.equal(receipt.amount.lots,null);assert.equal(r.inventory.turnip,12);
});

for(const phase of ['offer','ready','inTransit','arrived'] as const)test(`death at ${phase} records sealed estate custody, never claimant collection`,()=>{
 const f=phase==='offer'?foreignTransferFixture():foreignShipmentFixture(phase==='ready'?'export':'import',phase==='arrived');const {w,r}=f;const o=phase==='offer'?residentProposal(f):w.foreignTrade!.offers.at(-1)!;const s=w.foreignTrade!.shipments.at(-1);recordDeath(w,r,'illHealth');
 const observation=captureDirectEating(w,()=>{if(phase==='inTransit')w.minute=s!.arrivesAt!;advanceForeignTrade(w);}),receipts=foreignTransfers([observation]);assert.equal(receipts.length,1);const receipt=receipts[0];assert.equal(receipt.operation,'estateCustody');assert.equal(receipt.personId,null);assert.equal(receipt.estateOwnerId,r.id);assert.equal(receipt.residentId,r.id);assert.equal(receipt.offerId,o.id);assert.equal(receipt.shipmentId,phase==='offer'?null:s!.id);assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,28);assert.ok(receipt.destinationContainer.startsWith('estate-stock:'+r.id+':'));const parcel=w.estates.flatMap(e=>e.parcels??[]).find(p=>p.id===receipt.destinationContainer)!;assert.equal(parcel.ownerId,r.id);assert.equal(parcel.claimId,null);assert.equal(parcel.inventory.turnip,4);if(phase==='arrived')assert.equal(receipt.eventId,null);else assert.ok(w.events.some(e=>e.id===receipt.eventId));assert.deepEqual(captureDirectEating(w,()=>advanceForeignTrade(w)).foodTransfers,[]);
});

test('SQLite round trip before completion preserves source and after completion never replays',()=>{
 const {w,r,s}=foreignShipmentFixture();queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});stepWorldWithFoodEvidence(w,2);const original=structuredClone(w.food!.lots['shipment:'+s.id].turnip!),store=new WorldStore(':memory:');try{store.commit(w,null);const loaded=store.load(true)!,actor=loaded.residents.find(p=>p.id===r.id)!;const receipt=foreignTransfers(finishForeignAction(loaded,actor))[0];assert.deepEqual(receipt.amount.lots!.map(({nutrition,...lot})=>lot),original);store.commit(loaded,w.revision);const again=store.load(true)!;assert.deepEqual(stepWorldWithFoodEvidence(again,1).foodTransfers,[]);assert.equal(again.foreignTrade!.shipments.find(x=>x.id===s.id)!.goods,0);assert.doesNotMatch(JSON.stringify(again),/"(?:foodTransfers|foodTransferCoverage|destinationContainer)"\s*:/);}finally{store.close();}
});

test('enabled evidence, prediction and menu reads preserve complete world and knowledge',()=>{
 const {w,r,s}=foreignShipmentFixture();queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});const plain=copyForSimulation(w),prediction=copyForSimulation(w),before=structuredClone(w);assert.deepEqual(captureDirectEating(w,()=>{while(prediction.residents[0].plan||prediction.residents[0].activity)stepWorld(prediction,1);hasTimelySelfRescue(w,r,[{type:'foreignTrade',operation:'collect',shipmentId:s.id}]);decisionContext(w,r);}).foodTransfers,[]);assert.deepEqual(w,before);const receipts=[];while(r.plan||r.activity){receipts.push(...stepWorldWithFoodEvidence(w,1).foodTransfers!);stepWorld(plain,1);}assert.equal(receipts.length,1);assert.deepEqual(w,plain);assert.deepEqual(decisionChoices(decisionContext(w,r)),decisionChoices(decisionContext(plain,plain.residents[0])));
});

for(const branch of ['propose','accept'] as const)for(const missing of ['missing','under-count','over-count','same-minute','prior-repair'] as const)test(`${branch} reservation rejects ${missing} original-lot provenance without losing physical quantity`,()=>{
 const f=foreignTransferFixture(),{w,r,m}=f,o=branch==='accept'?merchantOffer(f,'export'):null;
 queueForeignAction(w,r,branch==='propose'?{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity:4,price:1,maximumLevyBasisPoints:0}:{type:'foreignTrade',operation:'accept',offerId:o!.id,quantity:4,quotedPrice:1,maximumLevyBasisPoints:0});
 for(let i=0;r.activity?.remaining!==1;i++){assert.ok(i<10);stepWorldWithFoodEvidence(w,1);}const container='person:'+r.id,lot=w.food!.lots[container].turnip![0];
 if(missing==='missing'||missing==='prior-repair'){delete w.food!.lots[container];if(missing==='prior-repair')initializeFood(w);}else if(missing==='under-count')lot.quantity=7;else if(missing==='over-count')lot.quantity=9;else lot.producedAt=w.minute+1;
 const receipt=foreignTransfers(finishForeignAction(w,r))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);assert.equal(r.inventory.turnip,4);
});

test('merchant-origin reserve, offer-to-shipment, export dispatch and settlement do not create boundary receipts',()=>{
 const f=foreignTransferFixture(),{w,r,m}=f;assert.deepEqual(captureDirectEating(w,()=>merchantOffer(f)).foodTransfers,[]);
 const o=residentProposal(f);assert.deepEqual(captureDirectEating(w,()=>{w.minute=o.noticeAt;advanceForeignTrade(w);assert.equal(completeForeignTrade(w,m.person,{type:'foreignTrade',operation:'accept',offerId:o.id}),null);}).foodTransfers,[]);const s=w.foreignTrade!.shipments.at(-1)!;
 assert.deepEqual(captureDirectEating(w,()=>{w.minute=s.readyAt;assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'dispatch',shipmentId:s.id}),null);w.minute=s.arrivesAt!;advanceForeignTrade(w);}).foodTransfers,[]);assert.equal(s.status,'completed');assert.equal(w.foreignTrade!.totals.exports,4);assert.equal(r.inventory.turnip,4);
});

test('throwing capture cannot leak completed receipts into the next engine step',()=>{
 const {w,r,s}=foreignShipmentFixture();queueForeignAction(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id});assert.throws(()=>captureDirectEating(w,()=>{while(r.plan||r.activity)stepWorld(w,1);throw Error('synthetic_failed_observation');}),/synthetic_failed_observation/);assert.equal(r.inventory.turnip,12);assert.deepEqual(stepWorldWithFoodEvidence(w,1).foodTransfers,[]);
});

test('existing sealed parcel uses its actual owner, not the dead resident or an inferred claimant',()=>{
 const f=foreignTransferFixture(),{w,r,other}=f,o=residentProposal(f);recordDeath(w,r,'illHealth');const estate=w.estates.find(e=>e.personId===r.id)!;const destination='estate-stock:'+r.id+':foreign-offer:'+o.id;
 estate.parcels??=[];estate.parcels.push({id:destination,ownerId:other.id,inventory:{},location:{at:{...w.foreignTrade!.station},inside:null,roomAt:null},createdAt:w.minute,source:'foreign-offer:'+o.id,claimId:null});
 const receipt=foreignTransfers([captureDirectEating(w,()=>advanceForeignTrade(w))])[0];assert.equal(receipt.operation,'estateCustody');assert.equal(receipt.residentId,r.id);assert.equal(receipt.estateOwnerId,other.id);assert.equal(receipt.personId,null);assert.equal(receipt.destinationContainer,destination);assert.equal(other.inventory.turnip,8);
});

for(const branch of ['propose','accept'] as const)test(`${branch} repair before plan submission remains unknown`,()=>{
 const f=foreignTransferFixture(),{w,r,m}=f,o=branch==='accept'?merchantOffer(f,'export'):null;delete w.food!.lots['person:'+r.id];initializeFood(w);w.minute+=10;
 queueForeignAction(w,r,branch==='propose'?{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity:4,price:1,maximumLevyBasisPoints:0}:{type:'foreignTrade',operation:'accept',offerId:o!.id,quantity:4,quotedPrice:1,maximumLevyBasisPoints:0});const receipt=foreignTransfers(finishForeignAction(w,r))[0];assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);
});

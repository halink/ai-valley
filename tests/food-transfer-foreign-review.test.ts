import assert from 'node:assert/strict';
import {test} from 'node:test';
import {foreignTransferFixture,foreignShipmentFixture,residentProposal,foreignTransfers} from './helpers/food-transfer-foreign.js';
import {captureDirectEating} from '../src/world/food-consumption-evidence.js';
import {completeForeignTrade,advanceForeignTrade} from '../src/world/foreign-trade.js';
import {recordDeath} from '../src/world/life.js';
import {estateStock,estateLocation,estateParcel} from '../src/world/estate-custody.js';
import {checkedFoodTransfer} from '../src/server/acceptance-evidence-schema.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';

for(const phase of ['offer','shipment'] as const)for(const owner of ['original','commons','external'] as const)test(`review: ${phase} death transfer observes actual ${owner} parcel owner`,()=>{
 const f=phase==='offer'?foreignTransferFixture():foreignShipmentFixture(),{w,r}=f;
 const o=phase==='offer'?residentProposal(f):w.foreignTrade!.offers.at(-1)!,s=w.foreignTrade!.shipments.at(-1);
 recordDeath(w,r,'illHealth');
 const source=phase==='offer'?'foreign-offer:'+o.id:'foreign-shipment:'+s!.id;
 estateStock(w,r.id,source,estateLocation(w.foreignTrade!.station));
 const parcel=estateParcel(w,'estate-stock:'+r.id+':'+source)!;
 parcel.ownerId=owner==='original'?r.id:owner==='commons'?'commons':'external-owner';
 const ids=[r.id,...Array.from({length:8},(_,i)=>'fixed-other-'+i)];
 const before=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,w.minute);
 const observation=captureDirectEating(w,()=>{w.minute++;advanceForeignTrade(w);});
 const [receipt]=foreignTransfers([observation]);assert.ok(receipt);assert.deepEqual(checkedFoodTransfer(receipt),receipt);
 assert.equal(receipt.estateOwnerId,parcel.ownerId);assert.equal(receipt.residentId,r.id);assert.equal(receipt.personId,null);
 assert.equal(parcel.inventory.turnip,4);assert.equal(receipt.amount.quantity,4);
 collector.sample(before,snapshotNineFood(w,ids),observation);
 const result=collector.finish();assert.equal(result.foodTransfers.destinationScopes[0],owner==='external'?'external':'nine-and-public');
 assert.equal(result.foodTransfers.scopeInflowTotals!.units.turnip??0,owner==='external'?0:4);
 assert.equal(result.foodTransfers.nineIntakeTotals,null);assert.equal(result.completeFoodLedger,false);
 assert.deepEqual(captureDirectEating(w,()=>advanceForeignTrade(w)).foodTransfers,[]);
});

test('review: collection uses shipment identity after its offer history was pruned',()=>{
 const {w,r,s}=foreignShipmentFixture();w.foreignTrade!.offers=[];const prior=structuredClone(w.foreignTrade!.offers);
 const observation=captureDirectEating(w,()=>assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'collect',shipmentId:s.id}),null));
 const [receipt]=foreignTransfers([observation]);assert.equal(receipt.offerId,s.offerId);assert.equal(receipt.amount.nutrition,28);
 assert.deepEqual(checkedFoodTransfer(receipt),receipt);assert.deepEqual(w.foreignTrade!.offers,prior);
 assert.deepEqual(observation.receipts,[]);assert.deepEqual(observation.foodFlows,[]);
});

for(const mismatch of ['missing','under','over','same-minute'] as const)test(`review: ${mismatch} original personal ledger cannot prove export nutrition`,()=>{
 const {w,r,m}=foreignTransferFixture(),container='person:'+r.id;
 if(mismatch==='missing')delete w.food!.lots[container];
 else if(mismatch==='same-minute')w.food!.lots[container].turnip![0].producedAt=w.minute;
 else w.food!.lots[container].turnip![0].quantity=mismatch==='under'?4:12;
 const observation=captureDirectEating(w,()=>assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity:4,price:1,maximumLevyBasisPoints:0}),null));
 const [receipt]=foreignTransfers([observation]);assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);
 assert.equal(r.inventory.turnip,4);assert.equal(w.foreignTrade!.totals.exports,0);assert.deepEqual(checkedFoodTransfer(receipt),receipt);
});

test('review: even matching personal lots cannot certify historical repair provenance',()=>{
 const {w,r,m}=foreignTransferFixture();
 const observation=captureDirectEating(w,()=>assert.equal(completeForeignTrade(w,r,{type:'foreignTrade',operation:'propose',merchantId:m.id,side:'export',item:'turnip',quantity:4,price:1,maximumLevyBasisPoints:0}),null));
 const [receipt]=foreignTransfers([observation]);assert.equal(receipt.amount.quantity,4);assert.equal(receipt.amount.nutrition,null);assert.equal(receipt.amount.lots,null);
 assert.equal(r.inventory.turnip,4);assert.equal(w.foreignTrade!.offers.at(-1)!.stock,4);
});

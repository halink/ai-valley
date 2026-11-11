import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkedFoodTransfer,foodTransferKey} from '../src/server/acceptance-evidence-schema.js';
import {auditFoodTransfers} from '../src/server/food-transfer-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {FOOD_TRANSFER_COVERAGE,type DirectEatingObservation,type ForeignFoodTransferReceipt} from '../src/world/food-consumption-evidence.js';
import {createWorld} from '../src/world/seed.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';
const receipt=(operation:ForeignFoodTransferReceipt['operation']='collect'):ForeignFoodTransferReceipt=>({type:'transfer',action:'foreignTrade',operation,at:11,eventId:'event-'+operation,offerId:'offer',shipmentId:operation==='reserveOffer'?null:'shipment',merchantId:'merchant',residentId:'resident',personId:operation==='estateCustody'?null:'resident',estateOwnerId:operation==='estateCustody'?'resident':null,side:'export',returned:operation==='collect'||operation==='estateCustody',container:operation.startsWith('reserve')?'person:resident':'shipment:shipment',destinationContainer:operation==='reserveOffer'?'offer:offer':operation==='reserveShipment'?'shipment:shipment':operation==='estateCustody'?'estate-stock:resident:foreign-shipment:shipment':'person:resident',amount:{item:'turnip',quantity:operation.startsWith('reserve')?2:.5,nutrition:null,lots:null}});
const observation=(worldId='world',foodTransfers=[receipt()]):DirectEatingObservation=>({worldId,fromMinute:10,toMinute:11,receipts:[],foodTransfers,foodTransferCoverage:FOOD_TRANSFER_COVERAGE});
function session(o=observation()){const events:RuntimeFoodEvent[]=[];const runtime=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});runtime.start(o.worldId,10);runtime.committed(o,1);runtime.stop(o.worldId,11);return events;}
test('foreign strict union supports reservation, fractional collection, estate and semantic keys',()=>{
 for(const operation of ['reserveOffer','reserveShipment','collect','estateCustody'] as const){const r=receipt(operation);assert.deepEqual(checkedFoodTransfer(r),r);}
 assert.notEqual(foodTransferKey(receipt('reserveShipment')),foodTransferKey(receipt('collect')));
 const r=receipt('estateCustody');r.eventId=null;assert.deepEqual(checkedFoodTransfer(r),r);
 for(const change of [(r:any)=>r.personId='wrong',(r:any)=>r.container='offer:offer',(r:any)=>r.returned=false,(r:any)=>r.amount.item='water',(r:any)=>r.eventId=null,(r:any)=>r.estateOwnerId='resident',(r:any)=>r.extra=1]){const r=receipt();change(r);assert.throws(()=>checkedFoodTransfer(r));}
 const reserve=receipt('reserveOffer');reserve.amount.quantity=.5;assert.throws(()=>checkedFoodTransfer(reserve));
});
test('foreign audit legacy coverage stays unknown, reservations and collection coexist, duplicates rejected',()=>{
 const o=observation('world',[receipt('reserveShipment'),receipt()]);assert.equal(auditFoodTransfers(session(o),true).complete,true);
 o.foodTransferCoverage='outside_aid_collect_v1';assert.equal(auditFoodTransfers(session(o),true).totals,null);
 o.foodTransferCoverage=FOOD_TRANSFER_COVERAGE;o.foodTransfers!.push({...receipt(),eventId:'other'});assert.ok(auditFoodTransfers(session(o),true).issues.includes('duplicate_transfer_receipt'));
 const estate=receipt('estateCustody');estate.eventId=null;const second={...estate,offerId:'other',shipmentId:'other',container:'shipment:other',destinationContainer:'estate-stock:resident:foreign-shipment:other'};
 assert.equal(auditFoodTransfers(session(observation('world',[estate,second])),true).complete,true);
});
test('foreign daily validates a whole batch before mutation and retains legacy receipts without totals',()=>{
 const w=createWorld(414);w.minute=10;const daily=createIsolationEvidence(w);w.minute=11;
 const invalid={...receipt(),destinationContainer:'person:wrong'};
 assert.throws(()=>daily.sample(w,observation(w.id,[receipt('reserveShipment'),invalid])));
 const o=observation(w.id,[receipt('reserveShipment'),receipt()]);o.foodTransferCoverage='outside_aid_collect_v1';daily.sample(w,o);
 const row=daily.finish(w)!;assert.equal(row.sampledMinutes,1);assert.equal(row.foodTransfers.totals,null);assert.equal(row.foodTransfers.receipts.length,2);
});
test('foreign fixed nine separates actual source outflow, destination inflow and estate owner boundary',()=>{
 const w=createWorld(414);w.minute=10;const ids=Array.from({length:9},(_,i)=>'fixed-'+i);
 const before=snapshotNineFood(w,ids);w.minute=11;const after=snapshotNineFood(w,ids),collector=createNineFoodEvidence(w.id,10);
 const foreign=(op:ForeignFoodTransferReceipt['operation'],owner=ids[0])=>{const r=receipt(op);r.residentId=ids[0];r.personId=op==='estateCustody'?null:ids[0];if(r.container==='person:resident')r.container='person:'+ids[0];if(r.destinationContainer==='person:resident')r.destinationContainer='person:'+ids[0];if(op==='estateCustody'){r.estateOwnerId=owner;r.destinationContainer=`estate-stock:${ids[0]}:foreign-shipment:shipment`;}return r;};
 const reserve=foreign('reserveShipment'),collect=foreign('collect'),estate=foreign('estateCustody','external-owner');
 estate.shipmentId='estate-shipment';estate.container='shipment:estate-shipment';estate.destinationContainer=`estate-stock:${ids[0]}:foreign-shipment:estate-shipment`;
 collector.sample(before,after,observation(w.id,[reserve,collect,estate]));const result=collector.finish();
 assert.deepEqual(result.foodTransfers.scopes,['nine-and-public','external','external']);assert.deepEqual(result.foodTransfers.destinationScopes,['external','nine-and-public','external']);
 assert.equal(result.foodTransfers.scopeOutflowTotals!.units.turnip,2);assert.equal(result.foodTransfers.scopeInflowTotals!.units.turnip,.5);assert.equal(result.foodTransfers.scopedTotals!.inputs.units.turnip,0);assert.equal(result.foodTransfers.nineIntakeTotals,null);assert.equal(result.completeFoodLedger,false);
 const estateCollector=createNineFoodEvidence(w.id,10);estateCollector.sample(before,after,observation(w.id,[foreign('estateCustody')]));assert.equal(estateCollector.finish().foodTransfers.scopeInflowTotals!.units.turnip,.5);
});

for(const kind of ['different-recipient','estate-instead-of-collect','different-reserver'] as const)test('foreign transfer semantic identity rejects '+kind+' atomically across consumers',()=>{
 const first=receipt(kind==='different-reserver'?'reserveShipment':'collect');
 const second=kind==='estate-instead-of-collect'?receipt('estateCustody'):{...first,eventId:'different-event',residentId:'other',personId:'other'};
 if(kind==='different-recipient')second.destinationContainer='person:other';
 if(kind==='different-reserver')second.container='person:other';
 assert.deepEqual(checkedFoodTransfer(second),second);
 assert.equal(foodTransferKey(first),foodTransferKey(second));
 const report=auditFoodTransfers(session(observation('world',[first,second])),true);
 assert.equal(report.totals,null);assert.ok(report.issues.includes('duplicate_transfer_receipt'));
 const w=createWorld(414);w.minute=10;const daily=createIsolationEvidence(w),ids=Array.from({length:9},(_,i)=>'fixed-'+i),nine=createNineFoodEvidence(w.id,10),before=snapshotNineFood(w,ids);
 w.minute=11;const after=snapshotNineFood(w,ids),invalid=observation(w.id,[first,second]);
 assert.throws(()=>daily.sample(w,invalid),/Duplicate/);assert.throws(()=>nine.sample(before,after,invalid),/Duplicate/);
 const valid=observation(w.id,[first]);daily.sample(w,valid);nine.sample(before,after,valid);
 assert.equal(daily.finish(w)!.foodTransfers.receipts.length,1);assert.equal(nine.finish().foodTransfers.receipts.length,1);
});

test('foreign reservations cannot claim reconstructed personal batch provenance; cargo may retain known lots',()=>{
 for(const operation of ['reserveOffer','reserveShipment','collect'] as const){
  const r=receipt(operation),quantity=r.amount.quantity;
  r.amount={item:'turnip',quantity,nutrition:quantity*7,lots:[{quantity,nutrition:quantity*7,producedAt:0,expiresAt:1000,definition:'food/life@1'}]};
  if(operation==='collect')assert.deepEqual(checkedFoodTransfer(r),r);
  else{
   assert.throws(()=>checkedFoodTransfer(r));
   r.amount.nutrition=null;r.amount.lots![0].nutrition=null;assert.throws(()=>checkedFoodTransfer(r));
   r.amount.lots=null;assert.deepEqual(checkedFoodTransfer(r),r);
  }
 }
});

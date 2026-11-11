import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {checkedFoodTransfer,checkedFoodEvent} from '../src/server/acceptance-evidence-schema.js';
import {auditFoodTransfers,observedFoodTransfersByDay} from '../src/server/food-transfer-evidence.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {AcceptanceEvidenceWriter,readAcceptanceEvidence} from '../src/server/acceptance-evidence-writer.js';
import {DecisionWaitEvidence} from '../src/server/decision-wait-evidence.js';
import {FOOD_TRANSFER_COVERAGE,type OutsideAidFoodTransferReceipt as FoodTransferReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function receipt():FoodTransferReceipt{return {type:'transfer',action:'outsideAid',operation:'collect',at:500,eventId:'event-1',deliveryId:'delivery-1',noticeId:'notice-1',merchantId:'merchant-1',recipientId:'person-1',container:'aid:delivery-1',destinationContainer:'person:person-1',amount:{item:'meal',quantity:1.5,nutrition:30,lots:[{quantity:.5,producedAt:480,expiresAt:2000,definition:'food@1',nutrition:10},{quantity:1,producedAt:490,expiresAt:2100,definition:'food@2',nutrition:20}]}};}
function observation():DirectEatingObservation{return {worldId:'world',fromMinute:480,toMinute:510,receipts:[],foodTransfers:[receipt()],foodTransferCoverage:FOOD_TRANSFER_COVERAGE};}
function session(o=observation()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:e=>{events.push(e);}});
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);
 return {events:structuredClone(events),status:food.status(),report:auditFoodTransfers(events,true)};
}
test('outside aid transfer schema accepts fractional original split lots, never eating or production',()=>{
 const r=receipt();assert.deepEqual(checkedFoodTransfer(r),r);const report=session().report;
 assert.equal(report.complete,true);assert.equal(report.fullTransferLedger,false);
 assert.deepEqual(report.totals,{units:{meal:1.5},nutrition:30,completedActions:1});assert.equal('hungerRelief' in report.totals!,false);
});
for(const [name,change] of Object.entries<(r:any)=>void>({
 type:r=>r.type='source_added',action:r=>r.action='visitorAid',operation:r=>r.operation='eatMail',container:r=>r.container='aid:other',destination:r=>r.destinationContainer='person:other',
 plan:r=>r.planId='plan',hunger:r=>r.hungerRelief=30,water:r=>r.amount.item='water',empty:r=>r.amount.lots=[],fraction:r=>r.amount.quantity=.9,
 expired:r=>r.amount.lots[0].expiresAt=r.at,future:r=>r.amount.lots[0].producedAt=r.at+1,quantity:r=>r.amount.lots[0].quantity=1,
 nutrition:r=>r.amount.nutrition=31,unknown:r=>r.amount.lots[0].nutrition=null,missingLots:r=>r.amount.lots=null,nonfinite:r=>r.amount.nutrition=Infinity,
 extra:r=>r.secret='private',negative:r=>r.amount.lots[0].nutrition=-1,
})){test(`outside aid transfer rejects ${name}`,()=>{const r=receipt();change(r);assert.throws(()=>checkedFoodTransfer(r),/invalid_evidence_schema/);});}
test('outside aid transfer unknown original nutrition is retained without reconstruction',()=>{
 for(const missing of [false,true]){const o=observation(),r=o.foodTransfers![0];r.amount.nutrition=null;
 if(missing)r.amount.lots=null;else r.amount.lots![0].nutrition=null;
 assert.deepEqual(checkedFoodTransfer(r),r);assert.equal(session(o).report.totals!.nutrition,null);}
});
test('outside aid transfer boundary rejects nested accessors, symbols, extras, sparse and custom objects without execution',()=>{
 for(const target of ['receipt','amount','lots','lot','transfers'] as const)for(const kind of ['getter','symbol','extra','sparse','prototype'] as const){
 const o=observation(),r=o.foodTransfers![0],event={schema:1,sessionId:'session',sequence:2,type:'food_step_committed',revision:1,...o};
 let calls=0;const value:any=target==='receipt'?r:target==='amount'?r.amount:target==='lot'?r.amount.lots![0]:target==='lots'?r.amount.lots:o.foodTransfers;
 const key=Array.isArray(value)?'0':target==='receipt'?'recipientId':'quantity';
 if(kind==='getter')Object.defineProperty(value,key,{get(){calls++;throw new Error('invoked');}});
 if(kind==='symbol')value[Symbol('private')]=1;if(kind==='extra')value.secret=1;if(kind==='sparse')delete value[key];if(kind==='prototype')Object.setPrototypeOf(value,{});
 assert.throws(()=>checkedFoodEvent(event),/invalid_evidence_schema/);assert.equal(calls,0);
 }
});
test('outside aid transfer old omissions remain unknown; explicit covered empty is zero',()=>{
 for(const omitted of ['foodTransfers','foodTransferCoverage'] as const){const o=observation();delete o[omitted];
 if(omitted==='foodTransfers')delete o.foodTransferCoverage;
 assert.equal(session(o).report.totals,null);}
 const o=observation();o.foodTransfers=[];assert.deepEqual(session(o).report.totals,{units:{},nutrition:0,completedActions:0});
 const e:any=session().events[1];delete e.foodTransfers;assert.throws(()=>checkedFoodEvent(e));
 e.foodTransfers=[];e.foodTransferCoverage='all_transfers';assert.throws(()=>checkedFoodEvent(e));
});
test('outside aid duplicate event or delivery IDs across steps and missing boundaries invalidate totals',()=>{
 for(const identity of ['eventId','deliveryId'] as const){const {events}=session(),step=events[1] as any,second=structuredClone(step);
 second.sequence=3;second.revision=2;second.fromMinute=510;second.toMinute=520;second.foodTransfers[0].at=515;
 if(identity==='eventId'){second.foodTransfers[0].deliveryId='delivery-2';second.foodTransfers[0].container='aid:delivery-2';}else second.foodTransfers[0].eventId='event-2';
 (events[2] as any).sequence=4;(events[2] as any).toMinute=520;events.splice(2,0,second);
 const result=auditFoodTransfers(events,true);assert.equal(result.totals,null);assert.ok(result.issues.includes(identity==='eventId'?'duplicate_transfer_receipt':'duplicate_transfer_delivery'));
 }
 const {events}=session();for(const altered of [events.slice(1),events.slice(0,-1),[events[0],events[2]],[]])assert.equal(auditFoodTransfers(altered,true).totals,null);
 assert.equal(auditFoodTransfers(events,false).totals,null);
});
test('outside aid timestamps and midnight grouping retain only observed rows',()=>{
 const {events}=session(),step=events[1] as any;step.foodTransfers[0].at=480;assert.equal(auditFoodTransfers(events,true).totals,null);
 step.foodTransfers[0].at=1440;step.toMinute=1441;assert.equal(observedFoodTransfersByDay([step])[0].calendarDay,0);
 step.foodTransfers[0].at=1440.25;assert.equal(observedFoodTransfersByDay([step])[0].calendarDay,1);assert.deepEqual(observedFoodTransfersByDay([]),[]);
});
test('outside aid writer roundtrip and broken seal retain observations but invalidate both totals',t=>{
 const root=mkdtempSync(join(testTmpdir(),'transfer-aid-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const legacy of [false,true]){const o=observation();if(legacy){delete o.foodTransfers;delete o.foodTransferCoverage;}
 const directory=join(root,String(legacy)),fingerprint='a'.repeat(64),writer=new AcceptanceEvidenceWriter({directory,sourceFingerprint:fingerprint,worldId:o.worldId,fromMinute:o.fromMinute});t.after(()=>writer.abort());
 const food=new RuntimeFoodEvidence({observe:writer.observeDirectEating}),wait=new DecisionWaitEvidence({observe:writer.observeDecisionWait,monotonicNow:()=>1});
 wait.start(o.fromMinute);food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);wait.stop(o.toMinute);
 const report=writer.close({reason:'scope_finished',statuses:{decisionWaiting:wait.status(),directEating:food.status()},sourceFingerprintAfter:fingerprint});
 assert.equal(report.complete,true);assert.equal(report.foodTransfers.complete,!legacy);assert.deepEqual(readAcceptanceEvidence(directory),report);
 assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);
 unlinkSync(join(directory,'run-close.json'));const broken=readAcceptanceEvidence(directory);assert.equal(broken.complete,false);assert.equal(broken.foodTransfers.totals,null);assert.equal(broken.directEating.foodTransfers.totals,null);
 }
});
test('outside aid event collision with eating or production invalidates transfer totals',()=>{
 for(const other of ['receipts','foodFlows'] as const){const {events}=session(),step=events[1] as any,r=receipt();
 step[other]=other==='receipts'?[{at:r.at,residentId:r.recipientId,eventId:r.eventId,planId:'plan',container:r.destinationContainer,item:'meal',quantity:1,nutrition:20,hungerRelief:20}]:[{type:'source_added',action:'gather_berry',at:r.at,residentId:r.recipientId,eventId:r.eventId,planId:'plan',container:r.destinationContainer,definition:'gather@1',sourceId:'source',outputs:[r.amount]}];
 const result=auditFoodTransfers(events,true);assert.equal(result.totals,null);assert.ok(result.issues.includes('duplicate_transfer_receipt'));
 }
});
test('outside aid unknown nested lots and aggregate overflow are never reported as known totals',()=>{
 const {events}=session(),step=events[1] as any;
 step.foodTransfers=[receipt(),{...receipt(),eventId:'event-2',deliveryId:'delivery-2',container:'aid:delivery-2'}];
 for(const r of step.foodTransfers){r.amount.quantity=Number.MAX_VALUE;r.amount.nutrition=null;r.amount.lots=null;}
 assert.ok(auditFoodTransfers(events,true).issues.includes('non_finite_transfer_aggregate'));
 const gap=structuredClone(events);(gap[1] as any).fromMinute=481;assert.ok(auditFoodTransfers(gap,true).issues.includes('coverage_gap'));
});

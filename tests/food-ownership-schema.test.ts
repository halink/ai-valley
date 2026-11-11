import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedFoodOwnership,checkedFoodOwnershipChanges,checkedFoodEvent,foodOwnershipKey} from '../src/server/acceptance-evidence-schema.js';
import {auditFoodOwnershipChanges,observedFoodOwnershipChangesByDay} from '../src/server/food-ownership-evidence.js';
import {auditRuntimeFoodEvidence,prepareNineResidentAcceptance} from '../src/server/nine-resident-acceptance.js';
import {RuntimeFoodEvidence,type RuntimeFoodEvent} from '../src/server/runtime-food-evidence.js';
import {FOOD_OWNERSHIP_COVERAGE,type FoodOwnershipReceipt,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
function receipt():FoodOwnershipReceipt{return {type:'ownership_change',action:'production',operation:'inherit',at:500,eventId:'event',planId:'plan',
 estatePersonId:'parent',shareId:'0',heirId:'heir',stocks:[
 {containerType:'estate-stock',container:'estate:parent:heir:0',fromOwnerId:'parent',toOwnerId:'heir',ambiguous:false,amounts:[{item:'meal',quantity:2.5,nutrition:null,lots:null}]},
 {containerType:'orchard-stock',container:'orchard-stock:tree',fromOwnerId:'parent',toOwnerId:'heir',ambiguous:false,amounts:[{item:'fruit',quantity:1,nutrition:null,lots:null}]},
 {containerType:'animal-stock',container:'animal-stock:hen',fromOwnerId:'parent',toOwnerId:'heir',ambiguous:false,amounts:[{item:'egg',quantity:.25,nutrition:null,lots:null}]},
 ]};}
function observation():DirectEatingObservation{return {worldId:'world',fromMinute:480,toMinute:510,receipts:[],foodOwnershipChanges:[receipt()],foodOwnershipCoverage:FOOD_OWNERSHIP_COVERAGE};}
function session(o=observation()){
 const events:RuntimeFoodEvent[]=[],food=new RuntimeFoodEvidence({observe:event=>{events.push(event);}});
 food.start(o.worldId,o.fromMinute);food.committed(o,1);food.stop(o.worldId,o.toMinute);
 return {events:structuredClone(events),status:food.status(),report:auditFoodOwnershipChanges(events,true)};
}

test('ownership schema accepts existing quantities, successor identifiers and distinct ownership totals only',()=>{
 const r=receipt();assert.deepEqual(checkedFoodOwnership(r),r);assert.equal(foodOwnershipKey(r),JSON.stringify(['parent','0']));
 for(const shareId of ['0.1','0.loss.1.2']){r.shareId=shareId;r.planId=null;assert.deepEqual(checkedFoodOwnership(r),r);}
 const {report,events,status}=session();assert.equal(report.complete,true);assert.equal(report.fullOwnershipLedger,false);
 assert.deepEqual(report.totals,{units:{meal:2.5,fruit:1,egg:.25},nutrition:null,completedActions:1,completedShares:1});
 const overall=auditRuntimeFoodEvidence(events,status);
 assert.deepEqual(overall.foodOwnershipChanges,report);assert.equal(overall.foodProduction,null);assert.equal(overall.foodConsumption,null);
 assert.deepEqual(overall.totals,{units:{},nutrition:0,hungerRelief:0,completedActions:0});
});
for(const [name,change] of Object.entries<(r:any)=>void>({
 type:r=>r.type='transfer',action:r=>r.action='outsideAid',operation:r=>r.operation='collect',at:r=>r.at=Infinity,
 share:r=>r.shareId='',plan:r=>r.planId=undefined,extra:r=>r.note='private',quantity:r=>r.stocks[0].amounts[0].quantity=Infinity,
 negative:r=>r.stocks[0].amounts[0].quantity=-1,zero:r=>r.stocks[0].amounts[0].quantity=0,
 nutrition:r=>r.stocks[0].amounts[0].nutrition=0,lots:r=>r.stocks[0].amounts[0].lots=[],
 water:r=>r.stocks[0].amounts[0].item='water',seed:r=>r.stocks[0].amounts[0].item='seed',wool:r=>r.stocks[0].amounts[0].item='wool',
 rawMeat:r=>r.stocks[0].amounts[0].item='gameMeat',fruit:r=>r.stocks[1].amounts[0].item='meal',animal:r=>r.stocks[2].amounts[0].item='fruit',
 container:r=>r.stocks[0].container='person:parent',orchard:r=>r.stocks[1].container='orchard-stock:',
 duplicateContainer:r=>r.stocks.push(structuredClone(r.stocks[0])),duplicateItem:r=>r.stocks[0].amounts.push(structuredClone(r.stocks[0].amounts[0])),
 empty:r=>r.stocks[0].amounts=[],owner:r=>r.stocks[0].toOwnerId='someone',noChange:r=>r.stocks[0].fromOwnerId='heir',
 unprovenOwner:r=>r.stocks[0].fromOwnerId=null,ambiguous:r=>r.stocks[0].ambiguous=true,
})){test(`ownership schema rejects ${name}`,()=>{const r=receipt();change(r);assert.throws(()=>checkedFoodOwnership(r),/invalid_evidence_schema/);});}

test('ownership unknown quantity and alias ambiguity never reconstruct old lots or nutrition',()=>{
 const o=observation(),stock=o.foodOwnershipChanges![0].stocks[0];stock.amounts[0].quantity=null;
 assert.deepEqual(checkedFoodOwnership(o.foodOwnershipChanges![0]),o.foodOwnershipChanges![0]);
 assert.equal(session(o).report.totals!.units.meal,null);
 stock.ambiguous=true;stock.fromOwnerId=null;assert.equal(session(o).report.complete,true);
 stock.fromOwnerId='parent';assert.equal(session(o).report.complete,true);
 for(const item of ['egg','duckEgg','milk'] as const){const r=receipt();r.stocks[2].amounts[0].item=item;assert.deepEqual(checkedFoodOwnership(r),r);}
});

test('ownership schema rejects accessors, custom prototypes, symbols, extra fields and sparse arrays without running code',()=>{
 for(const target of ['receipt','stocks','stock','amounts','amount','ownership','event'] as const)
 for(const kind of ['getter','symbol','extra','sparse','prototype'] as const){
  const {events}=session(),event=events[1] as any,r=event.foodOwnershipChanges[0];let calls=0;
  const value=target==='receipt'?r:target==='stocks'?r.stocks:target==='stock'?r.stocks[0]:target==='amounts'?r.stocks[0].amounts:
   target==='amount'?r.stocks[0].amounts[0]:target==='ownership'?event.foodOwnershipChanges:event;
  const key=Array.isArray(value)?'0':target==='receipt'?'heirId':target==='stock'?'fromOwnerId':target==='amount'?'quantity':'foodOwnershipChanges';
  if(kind==='getter')Object.defineProperty(value,key,{get(){calls++;throw Error('Must not execute');}});
  if(kind==='symbol')value[Symbol('private')]=1;if(kind==='extra')value.secret=1;if(kind==='sparse')delete value[key];if(kind==='prototype')Object.setPrototypeOf(value,{});
  assert.throws(()=>checkedFoodEvent(event),/invalid_evidence_schema/);assert.equal(calls,0);
 }
});

test('ownership coverage absent remains unknown; empty covered stock changes and no-food shares are observed',()=>{
 for(const property of ['foodOwnershipChanges','foodOwnershipCoverage'] as const){const o=observation();delete o[property];if(property==='foodOwnershipChanges')delete o.foodOwnershipCoverage;
  const result=session(o).report;assert.equal(result.complete,false);assert.equal(result.totals,null);
 }
 const empty=observation();empty.foodOwnershipChanges=[];assert.deepEqual(session(empty).report.totals,{units:{},nutrition:null,completedActions:0,completedShares:0});
 empty.foodOwnershipChanges=[{...receipt(),stocks:[]}];assert.deepEqual(session(empty).report.totals,{units:{},nutrition:null,completedActions:1,completedShares:1});
 const event=session().events[1] as any;delete event.foodOwnershipChanges;assert.throws(()=>checkedFoodEvent(event));
 event.foodOwnershipChanges=[];event.foodOwnershipCoverage='complete_food_ledger';assert.throws(()=>checkedFoodEvent(event));
});

test('ownership whole-step validation rejects duplicate event or stable share and invalid transaction times',()=>{
 const r=receipt();
 for(const second of [{...r,shareId:'1'},{...r,eventId:'other'}])assert.throws(()=>checkedFoodOwnershipChanges([r,second],480,510));
 for(const at of [480,510.01,-1,NaN])assert.throws(()=>checkedFoodOwnershipChanges([{...r,at}],480,510));
 assert.deepEqual(checkedFoodOwnershipChanges([{...r,at:510}],480,510),[{...r,at:510}]);
 assert.throws(()=>checkedFoodOwnershipChanges([],510,480));
});

test('ownership audit detects event and share replay across steps and across sessions',()=>{
 for(const key of ['event','share'] as const)for(const separateSession of [false,true]){
  const {events}=session(),later=structuredClone(events[1]) as any;
  later.fromMinute=510;later.toMinute=520;later.revision=2;later.sequence=3;later.foodOwnershipChanges[0].at=515;
  if(key==='event')later.foodOwnershipChanges[0].shareId='1';else later.foodOwnershipChanges[0].eventId='new-event';
  let all:RuntimeFoodEvent[];
  if(separateSession){later.sessionId='second';later.sequence=2;all=[...events,{schema:1,sessionId:'second',worldId:'world',sequence:1,type:'food_session_started',fromMinute:510},later,
   {schema:1,sessionId:'second',worldId:'world',sequence:3,type:'food_session_stopped',toMinute:520}];}
  else all=[events[0],events[1],later,{...events[2],sequence:4,toMinute:520} as RuntimeFoodEvent];
  const result=auditFoodOwnershipChanges(all,true);assert.equal(result.totals,null);
  assert.ok(result.issues.includes(key==='event'?'duplicate_ownership_receipt':'duplicate_ownership_share'),result.issues.join(','));
 }
});

test('ownership event collision with intake, physical transfer or production invalidates ownership totals',()=>{
 for(const other of ['receipts','foodFlows','foodTransfers'] as const){const {events}=session(),step=events[1] as any;
  step[other]=other==='receipts'?[{at:500,eventId:'event',residentId:'heir',planId:'plan',container:'person:heir',item:'meal',quantity:1,nutrition:20,hungerRelief:20}]:
   other==='foodFlows'?[{type:'source_added',action:'gather_berry',at:500,eventId:'event',residentId:'heir',planId:'plan',container:'person:heir',definition:'gather@1',sourceId:'bush',outputs:[{item:'berry',quantity:1,nutrition:null,lots:null}]}]:
   [{type:'transfer',action:'outsideAid',operation:'collect',at:500,eventId:'event',deliveryId:'delivery',noticeId:'notice',merchantId:'merchant',recipientId:'heir',container:'aid:delivery',destinationContainer:'person:heir',amount:{item:'meal',quantity:1,nutrition:null,lots:null}}];
  const result=auditFoodOwnershipChanges(events,true);assert.equal(result.totals,null);assert.ok(result.issues.includes('duplicate_ownership_receipt'));
 }
});

test('ownership audit rejects missing boundaries, coverage gaps, revisions, failed sessions and aggregate overflow',()=>{
 const {events}=session();
 for(const altered of [[],events.slice(1),events.slice(0,-1),[events[0],events[2]]])assert.equal(auditFoodOwnershipChanges(altered,true).totals,null);
 assert.equal(auditFoodOwnershipChanges(events,false).totals,null);
 for(const change of [(e:any[])=>e[1].fromMinute++, (e:any[])=>e[1].sequence++, (e:any[])=>e[1].worldId='other']){
  const e=structuredClone(events);change(e);assert.equal(auditFoodOwnershipChanges(e,true).totals,null);
 }
 const second=structuredClone(events[1]) as any;second.sequence=3;second.fromMinute=510;second.toMinute=520;second.foodOwnershipChanges=[];
 assert.ok(auditFoodOwnershipChanges([events[0],events[1],second,{...events[2],sequence:4,toMinute:520} as RuntimeFoodEvent],true).issues.includes('revision_not_increasing'));
 const large=session().events,e=large[1] as any,r=e.foodOwnershipChanges[0];r.stocks=[r.stocks[0]];r.stocks[0].amounts[0].quantity=Number.MAX_VALUE;
 const next=structuredClone(r);next.eventId='second';next.shareId='1';e.foodOwnershipChanges.push(next);
 assert.ok(auditFoodOwnershipChanges(large,true).issues.includes('non_finite_ownership_aggregate'));
});

test('ownership day grouping retains midnight, unknowns and observed rows without inventing zero days',()=>{
 const e=session().events[1] as any;e.fromMinute=1439;e.toMinute=1441;e.foodOwnershipChanges[0].at=1440;
 const later=structuredClone(e.foodOwnershipChanges[0]);later.at=1440.25;later.shareId='1';later.eventId='later';later.stocks[0].amounts[0].quantity=null;e.foodOwnershipChanges.push(later);
 const days=observedFoodOwnershipChangesByDay([e]);assert.deepEqual(days.map(day=>[day.calendarDay,day.receipts.length]),[[0,1],[1,1]]);
 assert.equal(days[1].receipts[0].stocks[0].amounts[0].quantity,null);assert.deepEqual(observedFoodOwnershipChangesByDay([]),[]);
 delete e.foodOwnershipChanges;delete e.foodOwnershipCoverage;assert.deepEqual(observedFoodOwnershipChangesByDay([e]),[]);
});

test('ownership acceptance preparation describes only the optional inherited existing-food ownership slice',()=>{
 const coverage=prepareNineResidentAcceptance('a'.repeat(64)).coverage;
 assert.match(coverage.foodOwnershipChanges,/optional-committed-runtime-steps/);
 assert.match(coverage.foodOwnershipChanges,/production\.inherit ownership changes to existing edible estate, orchard and animal stock only/);
 assert.match(coverage.foodOwnershipChanges,/no physical movement, intake or production/);
 assert.equal(coverage.foodProduction.value,null);assert.equal(coverage.foodConsumption.value,null);
});

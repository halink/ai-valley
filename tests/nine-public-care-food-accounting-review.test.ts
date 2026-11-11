import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {World} from '../src/shared/types.js';
import type {DirectEatingObservation,PublicDutyMealReceipt,EmergencyCareMealReceipt,FoodFlowAmount} from '../src/world/food-consumption-evidence.js';
import {snapshotNineFood,createNineFoodEvidence} from './helpers/nine-food-accounting.js';

// Independent hand-built receipts: no engine, live save, database or model calls.
const ids=Array.from({length:9},(_,i)=>`pc-review-${i}`);
const keys=['publicDutyMeals','emergencyCareMeals'] as const;
function world(at=10):World{return {id:'pc-review',minute:at,residents:[...ids,'outsider'].map(id=>({id,inventory:{meal:10,water:10}})),estates:[],civic:{stores:{hall:{meal:5,water:5}}},economy:{businesses:[],listings:[],treasuryStock:{meal:5,water:5}}} as unknown as World;}
function snap(at=10){return snapshotNineFood(world(at),ids);}
function food():FoodFlowAmount{return {item:'meal',quantity:1,nutrition:25,lots:[{quantity:1,producedAt:1,expiresAt:100,definition:'food/original@1',nutrition:25}]};}
const water=():FoodFlowAmount=>({item:'water',quantity:1,nutrition:0,lots:[]});
function duty():PublicDutyMealReceipt{return {action:'publicDuty',operation:'receive',at:11,providerId:'outsider',beneficiaryId:ids[0],eventId:'public-event',planId:'public-plan',definition:'public/duty@1',shiftId:'shift-review',buildingId:'hall',role:'care',serviceNumber:1,source:'public',container:'public:hall',inputs:[food(),water()],hungerBefore:70,hungerAfter:50,hungerRelief:20,healthBefore:40,healthAfter:48,healthGain:8,funding:{budgetId:'budget-review',account:'escrow:shift-review:wages',wagePerService:3,providerCoinsBefore:0,providerCoinsAfter:3,accountBalanceBefore:6,accountBalanceAfter:3,paidBefore:0,paidAfter:3}};}
function emergency():EmergencyCareMealReceipt{return {action:'emergencyCare',operation:'feed',at:11,providerId:ids[0],beneficiaryId:'outsider',eventId:'emergency-event',planId:'emergency-plan',container:`person:${ids[0]}`,definition:'emergency/care@1',agreementId:'agreement-review',mealNumber:1,inputs:[food(),water()],hungerBefore:70,hungerAfter:45,hungerRelief:25};}
function observation():DirectEatingObservation{return {worldId:'pc-review',fromMinute:10,toMinute:11,receipts:[],publicDutyMeals:[duty()],emergencyCareMeals:[emergency()]};}
function reject(change:(o:DirectEatingObservation,b:ReturnType<typeof snap>,a:ReturnType<typeof snap>)=>void){const c=createNineFoodEvidence('pc-review',10),o=observation(),b=snap(),a=snap(11),prior=c.finish();change(o,b,a);assert.throws(()=>c.sample(b,a,o));assert.deepEqual(c.finish(),prior,'entire rejected step must be atomic');c.sample(snap(),snap(11),observation());for(const key of keys)assert.equal(c.finish()[key].receipts.length,1,'valid correction must remain possible');}
function freeze<T>(x:T):T{if(x&&typeof x==='object'){for(const d of Object.values(Object.getOwnPropertyDescriptors(x)))if('value'in d)freeze(d.value);Object.freeze(x);}return x;}

for(const key of keys)for(const kind of ['extra','symbol','getter','sparse','array-extra','array-getter','prototype','nested-extra','nested-getter','bad-nutrition','bad-container','bad-quantity','expired-lot','missing-field','nonfinite'] as const){
 test(`independent public/care review: ${key} rejects ${kind} atomically`,()=>{let reads=0;reject(o=>{
  const r=o[key]![0],amount=r.inputs[0];
  switch(kind){
   case 'extra':Object.defineProperty(r,'unexpected',{value:'do not retain'});break;
   case 'symbol':Object.defineProperty(r,Symbol('unexpected'),{value:1});break;
   case 'getter':Object.defineProperty(r,'at',{get(){reads++;return 11;}});break;
   case 'sparse':delete o[key]![0];break;
   case 'array-extra':Object.defineProperty(o[key]!,'unexpected',{value:1});break;
   case 'array-getter':Object.defineProperty(o[key]!,'0',{get(){reads++;return r;}});break;
   case 'prototype':Object.setPrototypeOf(r,{custom:true});break;
   case 'nested-extra':Object.defineProperty(amount.lots![0],'unexpected',{value:1});break;
   case 'nested-getter':Object.defineProperty(amount,'nutrition',{get(){reads++;return 25;}});break;
   case 'bad-nutrition':amount.nutrition=26;break;
   case 'bad-container':r.container='treasuryStock';break;
   case 'bad-quantity':amount.quantity=2;break;
   case 'expired-lot':amount.lots![0].expiresAt=11;break;
   case 'missing-field':Reflect.deleteProperty(r,'beneficiaryId');break;
   case 'nonfinite':r.hungerRelief=Infinity;break;
  }
 });assert.equal(reads,0);});
}

test('independent public/care review: source, effect, funding and agreement contracts are enforced',()=>{
 for(const edit of [(r:PublicDutyMealReceipt)=>r.source='personal',(r:PublicDutyMealReceipt)=>r.funding=null,(r:PublicDutyMealReceipt)=>r.funding!.paidAfter++,(r:PublicDutyMealReceipt)=>r.healthGain++,(r:PublicDutyMealReceipt)=>r.hungerRelief++])reject(o=>edit(o.publicDutyMeals![0]));
 for(const edit of [(r:EmergencyCareMealReceipt)=>r.mealNumber=5,(r:EmergencyCareMealReceipt)=>r.agreementId=null,(r:EmergencyCareMealReceipt)=>r.operation='rescueMeal',(r:EmergencyCareMealReceipt)=>r.hungerAfter++])reject(o=>edit(o.emergencyCareMeals![0]));
});
test('independent public/care review: world, time and fixed founder boundary cannot advance on rejection',()=>{
 reject(o=>{o.worldId='foreign';});reject(o=>{o.toMinute=12;});reject((_o,b)=>{b.worldId='foreign';});reject((_o,_b,a)=>{a.at=12;});reject((_o,_b,a)=>{a.founderIds[0]='outsider';});
 for(const key of keys)for(const at of [10,12,NaN])reject(o=>{o[key]![0].at=at;});
 const c=createNineFoodEvidence('pc-review',10);c.sample(snap(),snap(11),observation());const prior=c.finish(),b=snap(11),a=snap(12);b.founderIds[0]='outsider';a.founderIds[0]='outsider';assert.throws(()=>c.sample(b,a));assert.deepEqual(c.finish(),prior);
});
test('independent public/care review: duplicate event IDs within and across slices reject the whole step',()=>{
 for(const key of keys)reject(o=>{o[key]!.push(structuredClone(o[key]![0]) as never);});
 reject(o=>{o.emergencyCareMeals![0].eventId=o.publicDutyMeals![0].eventId;});
 for(const key of keys)reject(o=>{o.receipts=[{at:11,residentId:ids[0],eventId:o[key]![0].eventId,planId:'direct-plan',container:`person:${ids[0]}`,item:'meal',quantity:1,nutrition:25,hungerRelief:25}];});
});
test('independent public/care review: distinct events cannot repeat public services or emergency meals',()=>{
 reject(o=>{o.publicDutyMeals!.push({...duty(),eventId:'distinct-public'});});
 reject(o=>{o.emergencyCareMeals!.push({...emergency(),eventId:'distinct-emergency'});});
});
test('independent public/care review: later replay rejection is continuable and does not reserve new identities',()=>{
 for(const key of keys)for(const duplicate of ['event','transaction'] as const){
  const c=createNineFoodEvidence('pc-review',10);c.sample(snap(),snap(11),observation());const prior=c.finish(),o=observation();o.fromMinute=11;o.toMinute=12;
  o.publicDutyMeals![0].at=12;o.publicDutyMeals![0].eventId='next-public';o.publicDutyMeals![0].serviceNumber=2;
  o.emergencyCareMeals![0].at=12;o.emergencyCareMeals![0].eventId='next-emergency';o.emergencyCareMeals![0].mealNumber=2;
  if(duplicate==='event')o[key]![0].eventId=key==='publicDutyMeals'?'public-event':'emergency-event';
  else if(key==='publicDutyMeals')o.publicDutyMeals![0].serviceNumber=1;else o.emergencyCareMeals![0].mealNumber=1;
  assert.throws(()=>c.sample(snap(11),snap(12),o));assert.deepEqual(c.finish(),prior);
  o.publicDutyMeals![0].eventId='next-public';o.publicDutyMeals![0].serviceNumber=2;o.emergencyCareMeals![0].eventId='next-emergency';o.emergencyCareMeals![0].mealNumber=2;
  c.sample(snap(11),snap(12),o);assert.equal(c.finish().toMinute,12);for(const k of keys)assert.equal(c.finish()[k].receipts.length,2);
 }
});
test('independent public/care review: public custody is independent of outsider provider and beneficiary',()=>{
 const c=createNineFoodEvidence('pc-review',10);c.sample(snap(),snap(11),observation());const r=c.finish();
 assert.deepEqual(r.publicDutyMeals.scopes,['nine-and-public']);assert.deepEqual(r.publicDutyMeals.beneficiaryScopes,['nine']);
 assert.equal(r.publicDutyMeals.scopedTotals!.inputs.units.meal,1);assert.equal(r.publicDutyMeals.nineIntakeTotals!.nutrition,25);assert.equal(r.publicDutyMeals.nineIntakeTotals!.hungerRelief,20);
 assert.equal(r.emergencyCareMeals.scopedTotals!.inputs.units.meal,1);assert.equal(r.emergencyCareMeals.nineIntakeTotals!.completedServings,0);
 const s=snap();assert.equal(s.scopedTotals.meal,95);assert.equal(s.containers.some(x=>x.id==='treasuryStock'),false);
 assert.equal(r.completeFoodLedger,false);assert.equal(r.foodConsumption,null);assert.equal(r.foodProduction,null);
});
test('independent public/care review: outsider personal stock can feed founders without local debit',()=>{
 const o=observation();o.publicDutyMeals![0].source='personal';o.publicDutyMeals![0].funding=null;o.publicDutyMeals![0].container='person:outsider';
 o.emergencyCareMeals![0].providerId='outsider';o.emergencyCareMeals![0].beneficiaryId=ids[0];o.emergencyCareMeals![0].container='person:outsider';
 const c=createNineFoodEvidence('pc-review',10);c.sample(snap(),snap(11),o);for(const key of keys){assert.deepEqual(c.finish()[key].scopes,['external']);assert.equal(c.finish()[key].scopedTotals!.inputs.units.meal,0);assert.equal(c.finish()[key].nineIntakeTotals!.units.meal,1);assert.equal(c.finish()[key].nineIntakeTotals!.units.water,1);}
});
test('independent public/care review: unknown custody and original nutrition do not invent values from relief',()=>{
 const o=observation(),b=snap(),a=snap(11);for(const s of [b,a])s.containers=s.containers.filter(x=>x.id!=='public:hall');
 o.publicDutyMeals![0].inputs[0].nutrition=null;o.publicDutyMeals![0].inputs[0].lots=null;
 const c=createNineFoodEvidence('pc-review',10);c.sample(b,a,o);const r=c.finish().publicDutyMeals;assert.equal(r.scopedTotals,null);assert.equal(r.nineIntakeTotals!.units.meal,1);assert.equal(r.nineIntakeTotals!.nutrition,null);assert.equal(r.nineIntakeTotals!.hungerRelief,20);
 const d=createNineFoodEvidence('pc-review',10);o.emergencyCareMeals![0].inputs[0].nutrition=null;o.emergencyCareMeals![0].inputs[0].lots=null;d.sample(snap(),snap(11),o);assert.equal(d.finish().emergencyCareMeals.scopedTotals!.inputs.nutrition,null);assert.equal(d.finish().emergencyCareMeals.nineIntakeTotals!.nutrition,0);
});
test('independent public/care review: omitted old slices stay unknown independently of newer empty arrays',()=>{
 const c=createNineFoodEvidence('pc-review',10);for(const key of keys)assert.equal(c.finish()[key].nineIntakeTotals,null);
 const old=observation();delete old.emergencyCareMeals;old.publicDutyMeals=[];c.sample(snap(),snap(11),old);
 const later:DirectEatingObservation={worldId:'pc-review',fromMinute:11,toMinute:12,receipts:[],publicDutyMeals:[],emergencyCareMeals:[]};c.sample(snap(11),snap(12),later);
 assert.equal(c.finish().publicDutyMeals.nineIntakeTotals!.completedServings,0);assert.equal(c.finish().emergencyCareMeals.observedMinutes,1);assert.equal(c.finish().emergencyCareMeals.unobservedMinutes,1);assert.equal(c.finish().emergencyCareMeals.scopedTotals,null);assert.equal(c.finish().emergencyCareMeals.nineIntakeTotals,null);
});
test('independent public/care review: frozen inputs and caller/returned mutation remain detached',()=>{
 const c=createNineFoodEvidence('pc-review',10),o=observation();c.sample(freeze(snap()),freeze(snap(11)),freeze(o));const report=c.finish();report.publicDutyMeals.receipts[0].inputs[0].nutrition=999;report.emergencyCareMeals.receipts.length=0;assert.equal(c.finish().publicDutyMeals.nineIntakeTotals!.nutrition,25);assert.equal(c.finish().emergencyCareMeals.receipts.length,1);
 const d=createNineFoodEvidence('pc-review',10),mutable=observation();d.sample(snap(),snap(11),mutable);mutable.publicDutyMeals![0].inputs[0].lots![0].nutrition=999;assert.equal(d.finish().publicDutyMeals.receipts[0].inputs[0].lots![0].nutrition,25);
});

test('independent public/care review: whole-envelope extras and getters never partly commit',()=>{
 reject(o=>{Object.defineProperty(o,'unexpected',{value:1});});let reads=0;
 reject(o=>{Object.defineProperty(o,'emergencyCareMeals',{get(){reads++;return [];}});});assert.equal(reads,0);
 reject(o=>{Reflect.deleteProperty(o,'receipts');});
});
test('independent public/care review: emergency sequence skips require missing coverage, not empty observed minutes',()=>{
 for(const gap of [false,true]){
  const c=createNineFoodEvidence('pc-review',10);c.sample(snap(),snap(11),observation());
  const middle:DirectEatingObservation={worldId:'pc-review',fromMinute:11,toMinute:12,receipts:[],publicDutyMeals:[],...(gap?{}:{emergencyCareMeals:[]})};c.sample(snap(11),snap(12),middle);
  const next=emergency();next.at=13;next.eventId='after-gap';next.mealNumber=3;
  const o:DirectEatingObservation={worldId:'pc-review',fromMinute:12,toMinute:13,receipts:[],publicDutyMeals:[],emergencyCareMeals:[next]};
  if(gap){c.sample(snap(12),snap(13),o);assert.equal(c.finish().emergencyCareMeals.receipts.length,2);assert.equal(c.finish().emergencyCareMeals.scopedTotals,null);assert.equal(c.finish().emergencyCareMeals.nineIntakeTotals,null);}
  else{const prior=c.finish();assert.throws(()=>c.sample(snap(12),snap(13),o));assert.deepEqual(c.finish(),prior);next.mealNumber=2;c.sample(snap(12),snap(13),o);assert.equal(c.finish().emergencyCareMeals.receipts.length,2);}
 }
});
test('independent public/care review: late first emergency counter is valid but identity changes are not',()=>{
 const c=createNineFoodEvidence('pc-review',10),o=observation();o.emergencyCareMeals![0].mealNumber=3;c.sample(snap(),snap(11),o);
 const next=emergency();next.at=12;next.mealNumber=4;next.eventId='fourth-meal';next.beneficiaryId=ids[1];const n:DirectEatingObservation={worldId:'pc-review',fromMinute:11,toMinute:12,receipts:[],publicDutyMeals:[],emergencyCareMeals:[next]};
 const prior=c.finish();assert.throws(()=>c.sample(snap(11),snap(12),n));assert.deepEqual(c.finish(),prior);next.beneficiaryId='outsider';c.sample(snap(11),snap(12),n);
});
test('independent public/care review: public food for an outsider remains debit without founder intake',()=>{
 const c=createNineFoodEvidence('pc-review',10),o=observation();o.publicDutyMeals![0].providerId=ids[0];o.publicDutyMeals![0].beneficiaryId='outsider';o.publicDutyMeals![0].inputs[0].nutrition=null;o.publicDutyMeals![0].inputs[0].lots=null;
 c.sample(snap(),snap(11),o);const s=c.finish().publicDutyMeals;assert.equal(s.scopedTotals!.inputs.units.meal,1);assert.equal(s.scopedTotals!.inputs.nutrition,null);assert.equal(s.nineIntakeTotals!.nutrition,0);assert.equal(s.nineIntakeTotals!.completedServings,0);
});
test('independent public/care review: rescue meals have no agreement identity but still reject event replays',()=>{
 const c=createNineFoodEvidence('pc-review',10),o=observation();Object.assign(o.emergencyCareMeals![0],{operation:'rescueMeal',agreementId:null,mealNumber:null});c.sample(snap(),snap(11),o);
 o.fromMinute=11;o.toMinute=12;o.publicDutyMeals=[];o.emergencyCareMeals![0].at=12;const prior=c.finish();assert.throws(()=>c.sample(snap(11),snap(12),o));assert.deepEqual(c.finish(),prior);o.emergencyCareMeals![0].eventId='rescue-next';c.sample(snap(11),snap(12),o);
});

test('independent public/care review: event identity remains shared between slices across minutes',()=>{
 for(const key of keys){
  const c=createNineFoodEvidence('pc-review',10),o=observation();c.sample(snap(),snap(11),o);const prior=c.finish();
  const eventId=o[key]![0].eventId;
  const next:DirectEatingObservation={worldId:'pc-review',fromMinute:11,toMinute:12,receipts:[{at:12,residentId:ids[0],eventId,planId:'later-direct',container:`person:${ids[0]}`,item:'meal',quantity:1,nutrition:25,hungerRelief:25}],publicDutyMeals:[],emergencyCareMeals:[]};
  assert.throws(()=>c.sample(snap(11),snap(12),next));assert.deepEqual(c.finish(),prior);next.receipts[0].eventId='later-distinct';c.sample(snap(11),snap(12),next);
 }
});

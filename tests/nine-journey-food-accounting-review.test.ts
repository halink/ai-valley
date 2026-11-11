import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {World} from '../src/shared/types.js';
import type {DirectEatingObservation,FamilyJourneyMealReceipt,JourneyMealReceipt,FoodFlowAmount} from '../src/world/food-consumption-evidence.js';
import {snapshotNineFood,createNineFoodEvidence} from './helpers/nine-food-accounting.js';

// Independent, hand-built evidence: no engine, seed, database or runtime imports.
const ids=Array.from({length:9},(_,i)=>`review-${i}`);
function world(at=10):World{return {id:'review-world',minute:at,residents:[...ids,'outsider'].map(id=>({id,inventory:{meal:10,water:10}})),estates:[],civic:{stores:{hall:{meal:5}}}} as unknown as World;}
function snap(at=10){return snapshotNineFood(world(at),ids);}
function food(known=true):FoodFlowAmount{return {item:'meal',quantity:1,nutrition:known?25:null,lots:known?[{quantity:1,producedAt:1,expiresAt:100,definition:'food/life@1',nutrition:25}]:null};}
function journey():JourneyMealReceipt{return {action:'visitorJourney',operation:'eat',at:11,providerId:ids[0],beneficiaryId:ids[0],eventId:'event-review',journeyId:'journey-review',container:`person:${ids[0]}`,inputs:[food()],hungerBefore:70,hungerAfter:45,hungerRelief:25};}
function family():FamilyJourneyMealReceipt[]{return [ids[0],'outsider',ids[1]].map((beneficiaryId,memberIndex)=>({action:'familyRelocation',operation:'ration',trigger:'depart',at:11,relocationId:'relocation-review',definition:'action/routine@1',rationNumber:1,memberIndex,memberCount:3,providerPortion:memberIndex===2?1:0,providerId:memberIndex===1?ids[0]:'outsider',beneficiaryId,container:`person:${memberIndex===1?ids[0]:'outsider'}`,inputs:[food(),{item:'water',quantity:1,nutrition:0,lots:[]}],hungerBefore:70,hungerAfter:45,hungerRelief:25}));}
function observation():DirectEatingObservation{return {worldId:'review-world',fromMinute:10,toMinute:11,receipts:[],journeyMeals:[journey()],familyJourneyMeals:family()};}
function reject(change:(o:DirectEatingObservation,b:ReturnType<typeof snap>,a:ReturnType<typeof snap>)=>void){const c=createNineFoodEvidence('review-world',10),o=observation(),b=snap(),a=snap(11),initial=c.finish();change(o,b,a);assert.throws(()=>c.sample(b,a,o));assert.deepEqual(c.finish(),initial);c.sample(snap(),snap(11),observation());assert.equal(c.finish().familyJourneyMeals.receipts.length,3);}
function freeze<T>(x:T):T{if(x&&typeof x==='object'){for(const d of Object.values(Object.getOwnPropertyDescriptors(x)))if('value' in d)freeze(d.value);Object.freeze(x);}return x;}

for(const [label,change] of Object.entries({
 missing:(o:DirectEatingObservation)=>{o.familyJourneyMeals!.pop();},
 duplicate:(o:DirectEatingObservation)=>{o.familyJourneyMeals!.push(structuredClone(o.familyJourneyMeals![0]));},
 reordered:(o:DirectEatingObservation)=>{o.familyJourneyMeals!.reverse();},
 beneficiary:(o:DirectEatingObservation)=>{o.familyJourneyMeals![2].beneficiaryId=o.familyJourneyMeals![0].beneficiaryId;},
 portion:(o:DirectEatingObservation)=>{o.familyJourneyMeals![2].providerPortion=0;},
 count:(o:DirectEatingObservation)=>{o.familyJourneyMeals![1].memberCount=4;},
 definition:(o:DirectEatingObservation)=>{o.familyJourneyMeals![1].definition='action/routine@2';},
 time:(o:DirectEatingObservation)=>{o.familyJourneyMeals![1].at=10.5;},
 event:(o:DirectEatingObservation)=>{o.journeyMeals!.push(structuredClone(o.journeyMeals![0]));},
 lowerBound:(o:DirectEatingObservation)=>{o.journeyMeals![0].at=10;},
 upperBound:(o:DirectEatingObservation)=>{o.journeyMeals![0].at=12;},
 foreignWorld:(o:DirectEatingObservation)=>{o.worldId='foreign';},
 duration:(o:DirectEatingObservation)=>{o.toMinute=12;},
 sparse:(o:DirectEatingObservation)=>{delete o.familyJourneyMeals![1];},
 invalidArray:(o:DirectEatingObservation)=>{(o as unknown as Record<string,unknown>).journeyMeals=null;},
})){test(`independent journey review: atomic rejection of ${label}`,()=>reject(change));}

test('independent journey review: accessors rejected without invocation, including array elements',()=>{let calls=0;for(const target of ['observation','row','array'])reject(o=>{const obj=target==='observation'?o:target==='row'?o.familyJourneyMeals![1]:o.familyJourneyMeals!;Object.defineProperty(obj,target==='observation'?'journeyMeals':target==='row'?'at':'1',{get(){calls++;throw Error('must not execute');},configurable:true});});assert.equal(calls,0);});
test('independent journey review: world, minute and cohort boundaries are atomic',()=>{reject((_o,b)=>{b.worldId='other';});reject((_o,_b,a)=>{a.at=10;});reject((_o,_b,a)=>{a.at=12;});reject((_o,_b,a)=>{a.founderIds[0]='outsider';});const c=createNineFoodEvidence('review-world',10);c.sample(snap(),snap(11),observation());const b=snap(11),a=snap(12);b.founderIds[0]='outsider';a.founderIds[0]='outsider';assert.throws(()=>c.sample(b,a));assert.equal(c.finish().toMinute,11);});
test('independent journey review: zero steps, absent observations and legacy arrays remain unknown',()=>{const c=createNineFoodEvidence('review-world',10);assert.equal(c.finish().journeyMeals.nineIntakeTotals,null);c.sample(snap(),snap(11));const legacy:DirectEatingObservation={worldId:'review-world',fromMinute:11,toMinute:12,receipts:[]};c.sample(snap(11),snap(12),legacy);c.sample(snap(12),snap(13),{...legacy,fromMinute:12,toMinute:13,journeyMeals:[],familyJourneyMeals:[]});for(const s of [c.finish().journeyMeals,c.finish().familyJourneyMeals]){assert.equal(s.unobservedMinutes,2);assert.equal(s.observedMinutes,1);assert.equal(s.scopedTotals,null);assert.equal(s.nineIntakeTotals,null);}});
test('independent journey review: explicit empty arrays prove only their own zero',()=>{const c=createNineFoodEvidence('review-world',10);c.sample(snap(),snap(11),{...observation(),journeyMeals:[],familyJourneyMeals:[]});const r=c.finish();assert.equal(r.journeyMeals.nineIntakeTotals!.completedServings,0);assert.equal(r.familyJourneyMeals.scopedTotals!.inputs.units.meal,0);assert.equal(r.completeFoodLedger,false);assert.equal(r.foodConsumption,null);for(const added of [r.publicDutyMeals,r.emergencyCareMeals]){assert.equal(added.unobservedMinutes,1);assert.equal(added.scopedTotals,null);assert.equal(added.nineIntakeTotals,null);}});
test('independent journey review: external provider and beneficiary boundaries are independent',()=>{const c=createNineFoodEvidence('review-world',10);c.sample(snap(),snap(11),observation());const r=c.finish().familyJourneyMeals;assert.deepEqual(r.scopes,['external','nine-and-public','external']);assert.deepEqual(r.beneficiaryScopes,['nine','external','nine']);assert.equal(r.scopedTotals!.inputs.units.meal,1);assert.equal(r.nineIntakeTotals!.units.meal,2);assert.equal(r.nineIntakeTotals!.units.water,2);assert.equal(r.nineIntakeTotals!.nutrition,50);assert.equal(r.nineIntakeTotals!.hungerRelief,50);});
test('independent journey review: unknown payer custody does not erase known beneficiary intake',()=>{const c=createNineFoodEvidence('review-world',10),b=snap(),a=snap(11);for(const s of [b,a])s.containers=s.containers.filter(x=>x.id!=='person:outsider');c.sample(b,a,observation());assert.equal(c.finish().familyJourneyMeals.scopedTotals,null);assert.equal(c.finish().familyJourneyMeals.nineIntakeTotals!.nutrition,50);});
test('independent journey review: original unknown nutrition is isolated by beneficiary, never replaced by relief',()=>{const c=createNineFoodEvidence('review-world',10),o=observation();o.familyJourneyMeals![1].inputs[0]=food(false);c.sample(snap(),snap(11),o);assert.equal(c.finish().familyJourneyMeals.scopedTotals!.inputs.nutrition,null);assert.equal(c.finish().familyJourneyMeals.nineIntakeTotals!.nutrition,50);const d=createNineFoodEvidence('review-world',10);o.familyJourneyMeals![0].inputs[0]=food(false);d.sample(snap(),snap(11),o);assert.equal(d.finish().familyJourneyMeals.nineIntakeTotals!.nutrition,null);assert.equal(d.finish().familyJourneyMeals.nineIntakeTotals!.hungerRelief,50);});
test('independent journey review: custody drift is unknown, fixed identities tolerate ordering',()=>{const b=snap(),a=snap(11);a.founderIds.reverse();a.containers.find(x=>x.id===`person:${ids[0]}`)!.scope='external';const c=createNineFoodEvidence('review-world',10);c.sample(b,a,observation());assert.equal(c.finish().journeyMeals.scopedTotals,null);assert.equal(c.finish().journeyMeals.nineIntakeTotals!.nutrition,25);});
test('independent journey review: collection and finish detach caller data and accept frozen inputs',()=>{const c=createNineFoodEvidence('review-world',10),o=observation();c.sample(freeze(snap()),freeze(snap(11)),freeze(o));const first=c.finish();first.familyJourneyMeals.receipts[0].inputs[0].quantity=999;first.founderIds![0]='changed';assert.equal(c.finish().familyJourneyMeals.receipts[0].inputs[0].quantity,1);assert.equal(c.finish().founderIds![0],ids[0]);const d=createNineFoodEvidence('review-world',10),mutable=observation();d.sample(snap(),snap(11),mutable);mutable.journeyMeals![0].inputs[0].nutrition=999;assert.equal(d.finish().journeyMeals.nineIntakeTotals!.nutrition,25);});
test('independent journey review: replayed events and family transactions cannot enter later minutes',()=>{for(const familyReplay of [false,true]){const c=createNineFoodEvidence('review-world',10);c.sample(snap(),snap(11),observation());const o=observation();o.fromMinute=11;o.toMinute=12;for(const r of [...o.journeyMeals!,...o.familyJourneyMeals!])r.at=12;if(familyReplay)o.journeyMeals=[];else o.familyJourneyMeals=[];const prior=c.finish();assert.throws(()=>c.sample(snap(11),snap(12),o));assert.deepEqual(c.finish(),prior);}});
test('independent journey review: snapshot reads frozen physical stores without initialization, alias double count or inferred intake',()=>{const w=world(),bag=w.residents[0].inventory;w.residents.push({id:ids[0],inventory:bag} as World['residents'][number]);let calls=0;Object.defineProperty(bag,'water',{get(){calls++;throw Error('inventory getter');},enumerable:true});const s=snapshotNineFood(freeze(w),ids);assert.equal(calls,0);assert.equal(s.scopedTotals.meal,95);assert.equal(s.scopedTotals.water,null);assert.equal(s.containers.filter(c=>c.id===`person:${ids[0]}`).length,1);assert.equal('food' in w,false);const c=createNineFoodEvidence('review-world',10);const a=snap(11);a.scopedTotals.meal=0;c.sample(s,a,{...observation(),journeyMeals:[],familyJourneyMeals:[]});assert.equal(c.finish().journeyMeals.nineIntakeTotals!.units.meal,0);});

test('independent journey review: public stores cannot masquerade as person journey providers',()=>{
 for(const container of ['public:hall','public-reserve:review'])for(const key of ['journeyMeals','familyJourneyMeals'] as const){
  reject(o=>{o[key]![0].container=container;});
 }
});

test('independent journey review: event IDs cannot collide across current or earlier receipt slices',()=>{
 const direct=(at:number)=>({at,residentId:ids[0],eventId:'event-review',planId:'plan-review',container:`person:${ids[0]}`,item:'meal' as const,quantity:1,nutrition:25,hungerRelief:25});
 // Same-minute collision: ordinary eating is inspected before the journey slice.
 reject(o=>{o.receipts=[direct(11)];});
 // A preceding ordinary meal reserves the identity across slice and time boundaries.
 const c=createNineFoodEvidence('review-world',10);
 c.sample(snap(),snap(11),{...observation(),receipts:[direct(11)],journeyMeals:[],familyJourneyMeals:[]});
 const prior=c.finish(),o=observation();o.fromMinute=11;o.toMinute=12;o.familyJourneyMeals=[];o.journeyMeals![0].at=12;
 assert.throws(()=>c.sample(snap(11),snap(12),o));assert.deepEqual(c.finish(),prior);
 o.journeyMeals![0].eventId='event-review-distinct';c.sample(snap(11),snap(12),o);
 assert.equal(c.finish().directEating.receipts.length,1);assert.equal(c.finish().journeyMeals.receipts.length,1);
});

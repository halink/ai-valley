import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {World,Inventory} from '../src/shared/types.js';
import {FOOD_FLOW_COVERAGE,FOOD_LOSS_COVERAGE,FOOD_LOSS_CONTAINER_TYPES,type DirectEatingObservation} from '../src/world/food-consumption-evidence.js';
import {snapshotNineFood,createNineFoodEvidence} from './helpers/nine-food-accounting.js';

const founders=Array.from({length:9},(_,i)=>'review-founder-'+i);
const owner=founders[0],outsider='review-merchant';
function fixture(){return {id:'review-world',minute:0,residents:founders.map(id=>({id,inventory:{}})),estates:[]} as unknown as World;}
const asWorld=(fields:object)=>Object.assign(fixture(),fields) as World;
const snapshot=(w:World)=>snapshotNineFood(w,founders);
function complete(w:World):DirectEatingObservation{return {worldId:w.id,fromMinute:0,toMinute:1,receipts:[],foodFlows:[],foodFlowCoverage:FOOD_FLOW_COVERAGE,foodLosses:[],foodLossCoverage:FOOD_LOSS_COVERAGE,careMeals:[],childCareMeals:[],longCareMeals:[]};}
const amount=(quantity=1,nutrition:number|null=20)=>({item:'turnip' as const,quantity,nutrition,lots:null});

// Synthetic partial worlds intentionally omit initializer-only fields. An audit
// must read the extant physical bags, never initialize or repair these worlds.
test('review: every physical container type is inventoried once; metadata is excluded',()=>{
 const w=asWorld({
  estates:[{personId:owner,inventory:{turnip:1},parcels:[{id:'foreign-looking-parcel',ownerId:owner,inventory:{turnip:1}}]}],
  economy:{businesses:[{id:'shop',ownerId:owner,inventory:{turnip:1}}],listings:[{id:'sale',businessId:'shop',side:'sale',status:'open',item:'turnip',quantity:1},{id:'purchase',businessId:'shop',side:'purchase',status:'open',item:'turnip',quantity:100}],treasuryStock:{turnip:100}},
  civic:{stores:{hall:{turnip:1}},reserves:[{id:'reserve',inventory:{turnip:1}}]},
  household:{pools:[{id:'pool',creatorId:outsider,credits:[{ownerId:owner,inventory:{turnip:1}}],initial:{turnip:100}}],gifts:[{id:'ready',status:'ready',recipientId:outsider,segments:[{ownerId:owner,inventory:{turnip:1}}],costs:[{ownerId:owner,inventory:{turnip:100}}]},{id:'delivered',status:'delivered',segments:[{ownerId:owner,inventory:{turnip:100}}]}]},
  culture:{events:[{id:'event',hostId:outsider,preparation:{supplierId:owner,held:{turnip:1},required:{turnip:100}},contributions:[{id:'food',donorId:owner,inventory:{turnip:1}}]}]},
  industry:{batches:[{id:'batch',ownerId:owner,status:'working',input:{turnip:1},recipe:{input:{turnip:100},output:{turnip:100}}},{id:'done',ownerId:owner,status:'completed',input:{turnip:100}}],trees:[{id:'tree',ownerId:owner,status:'mature',fruit:1},{id:'cut',ownerId:owner,status:'cut',fruit:100}],animals:[{id:'animal',ownerId:owner,kind:'chicken',status:'dead',product:1},{id:'sheep',ownerId:owner,kind:'sheep',product:100}],sources:{turnip:100},totals:{turnip:100}},
  employment:{contracts:[{id:'job',employerId:owner,workerId:outsider,status:'ended',batch:{inventory:{turnip:1},output:{turnip:100}}}]},
  outsideAid:{deliveries:[{id:'aid',merchantId:outsider,inventory:{turnip:1}}]},
  foreignTrade:{merchants:[{id:outsider,person:{inventory:{turnip:1}}}],offers:[{id:'offer',merchantId:outsider,item:'turnip',stock:1}],shipments:[{id:'shipment',merchantId:outsider,item:'turnip',goods:1}]},
  food:{lots:{'phantom-lot':{turnip:[{quantity:100}]}},spoiled:{turnip:100}},
 });
 w.residents[0].inventory={turnip:1};
 const original=structuredClone(w),s=snapshot(w);
 assert.deepEqual(new Set(s.containers.map(c=>c.type)),new Set(FOOD_LOSS_CONTAINER_TYPES));
 assert.equal(s.scopedTotals.turnip,13);assert.equal(s.scopedTotals.fruit,1);assert.equal(s.scopedTotals.egg,1);
 assert.equal(s.externalTotals.turnip,4);assert.deepEqual(w,original);
 assert.equal(s.containers.find(c=>c.id==='family-gift:ready:'+owner)!.ownerId,owner);
 assert.equal(s.containers.find(c=>c.id==='employment:job')!.scope,'nine-and-public');
});

test('review: parcel identity does not override changed current owner',()=>{
 const parcel={id:'estate-stock:'+owner+':original',ownerId:outsider,inventory:{turnip:3}};
 const w=asWorld({estates:[{personId:owner,inventory:{},parcels:[parcel]}]});
 assert.equal(snapshot(w).scopedTotals.turnip,0);assert.equal(snapshot(w).externalTotals.turnip,3);
 parcel.ownerId=owner;assert.equal(snapshot(w).scopedTotals.turnip,3);assert.equal(snapshot(w).externalTotals.turnip,0);
});

test('review: duplicate person representations and shared references count once without repairing aliases',()=>{
 const w=fixture(),bag={turnip:3};w.residents[0].inventory=bag;
 Object.assign(w,{migration:{contacts:[{id:owner,person:{inventory:{turnip:3}}}]},economy:{businesses:[{id:'alias',ownerId:owner,inventory:bag}]}});
 const before=structuredClone(w),s=snapshot(w);
 assert.equal(s.scopedTotals.turnip,3);assert.deepEqual(w,before);assert.equal(w.residents[0].inventory,bag);
 assert.ok(s.containers.find(c=>c.id==='person:'+owner)!.aliases.includes('business:alias'));
});

test('review: identity and object-reference alias bridges collapse all connected records',()=>{
 const w=fixture(),a={turnip:3},b={turnip:3};w.residents[0].inventory=a;w.residents[1].inventory=b;
 Object.assign(w,{migration:{contacts:[{id:owner,person:{inventory:b}}]}});
 const s=snapshot(w),connected=s.containers.filter(c=>c.aliases.includes('person:'+owner)||c.aliases.includes('person:'+founders[1]));
 assert.equal(connected.length,1,'bridge must not leave the second object counted independently');
 assert.equal(connected[0].scope,'unknown','different owner identities cannot be silently merged as certain');
 assert.equal(s.scopedTotals.turnip,null);
});

test('review: duplicate disagreement and explicit malformed quantities stay unknown',()=>{
 const w=fixture();w.residents[0].inventory={turnip:3};w.residents[1].inventory={seed:NaN,meal:-1,berry:Infinity};
 Object.assign(w,{migration:{contacts:[{id:owner,person:{inventory:{turnip:4}}}]}});
 const s=snapshot(w);for(const item of ['turnip','seed','meal','berry'] as const)assert.equal(s.scopedTotals[item],null);
 assert.equal(s.scopedTotals.wood,0);assert.ok(s.issues.some(i=>i.includes('Conflicting duplicate stock')));
});

test('review: bag and scalar accessors are not evaluated as audit evidence',()=>{
 const w=fixture();let calls=0;
 Object.defineProperty(w.residents[0].inventory,'turnip',{enumerable:true,get(){calls++;return 3;}});
 const tree={id:'getter-tree',ownerId:owner,status:'mature'};
 Object.defineProperty(tree,'fruit',{enumerable:true,get(){calls++;return 9;}});
 Object.assign(w,{industry:{trees:[tree]}});
 const s=snapshot(w);assert.equal(calls,0);assert.equal(s.scopedTotals.turnip,null);assert.equal(s.scopedTotals.fruit,null);
});

test('review: finite individual quantities may not overflow into a claimed finite total',()=>{
 const w=fixture();w.residents[0].inventory={turnip:Number.MAX_VALUE};w.residents[1].inventory={turnip:Number.MAX_VALUE};
 assert.equal(snapshot(w).scopedTotals.turnip,null);
});

test('review: absent estate metadata and aliased employment recipes are not initialized or repaired',()=>{
 const bag:Inventory={turnip:2};const contract={id:'job',employerId:owner,recipe:{input:bag},batch:{inventory:bag,output:{meal:1}}};
 const w=asWorld({estates:[{personId:owner,inventory:{}}],employment:{contracts:[contract]}});
 const before=structuredClone(w);snapshot(w);assert.deepEqual(w,before);assert.equal(contract.batch.inventory,contract.recipe.input);
 assert.equal(Object.hasOwn(w.estates[0],'parcels'),false);assert.equal(Object.hasOwn(w.estates[0],'location'),false);assert.equal(w.food,undefined);
});

test('review: all-world care, merchant consumption and natural sources remain preserved but scoped totals stay separate',()=>{
 const w=fixture();Object.assign(w,{foreignTrade:{merchants:[{id:outsider,person:{inventory:{}}}]}});
 const before=snapshot(w);w.minute=1;const after=snapshot(w),obs=complete(w);
 obs.receipts=[{at:1,residentId:outsider,eventId:'eat',planId:'eat-plan',container:'person:'+outsider,item:'turnip',quantity:2,nutrition:40,hungerRelief:30}];
 const base={at:1,providerId:outsider,beneficiaryId:owner,eventId:'care',planId:'plan',container:'person:'+outsider,definition:'care@1',inputs:[amount()],hungerBefore:50,hungerAfter:30,hungerRelief:20};
 obs.careMeals=[{...base,action:'care',proposalId:null,authority:'consent'}];
 obs.childCareMeals=[{...base,eventId:'child-care',action:'tendChild',authority:'guardian'}];
 obs.longCareMeals=[{...base,eventId:'long-care',action:'longCare',operation:'visit',agreementId:'agreement',slotKey:'slot',healthBefore:50,healthAfter:51,healthGain:1}];
 obs.foodFlows=[{type:'source_added',action:'harvest',at:1,residentId:outsider,eventId:'harvest',planId:'harvest-plan',container:'person:'+outsider,definition:'crop@1',sourceId:'field',outputs:[amount(4)]}];
 const collector=createNineFoodEvidence(w.id,0);collector.sample(before,after,obs);const result=collector.finish();
 for(const key of ['directEating','careMeals','childCareMeals','longCareMeals','foodFlows'] as const){assert.equal(result[key].receipts.length,1);assert.deepEqual(result[key].scopes,['external']);assert.equal(result[key].scopedTotals!.inputs.units.turnip,0);assert.equal(result[key].scopedTotals!.outputs.units.turnip,0);}
 for(const key of ['careMeals','childCareMeals','longCareMeals'] as const){assert.equal(result[key].nineIntakeTotals!.units.turnip,1);assert.equal(result[key].nineIntakeTotals!.completedServings,1);}
 assert.equal(result.directEating.nineIntakeTotals!.completedServings,0);assert.equal(result.foodFlows.nineIntakeTotals,null);
 assert.equal(result.completeFoodLedger,false);assert.ok(result.uncovered.some(s=>s.includes('industry')));
});

test('review: legacy coverage preserves receipts without inventing zeros for missing slices',()=>{
 const w=fixture(),before=snapshot(w);w.minute=1;const after=snapshot(w),obs=complete(w);
 delete obs.foodFlowCoverage;delete obs.foodLossCoverage;delete obs.childCareMeals;delete obs.longCareMeals;delete obs.careMeals;
 obs.foodFlows=[{type:'source_added',action:'harvest',at:1,residentId:owner,eventId:'h',planId:'p',container:'person:'+owner,definition:'crop@1',sourceId:'f',outputs:[amount()]}];
 const c=createNineFoodEvidence(w.id,0);c.sample(before,after,obs);const r=c.finish();
 assert.equal(r.foodFlows.receipts.length,1);assert.equal(r.foodFlows.unobservedMinutes,1);
 for(const key of ['foodFlows','foodLosses','careMeals','childCareMeals','longCareMeals'] as const)assert.equal(r[key].scopedTotals,null);
 assert.equal(r.directEating.scopedTotals!.inputs.units.turnip,0);
});

test('review: unknown original nutrition and unknown stock ownership are not coerced to zero',()=>{
 const w=fixture(),before=snapshot(w);w.minute=1;const after=snapshot(w),obs=complete(w);
 obs.careMeals=[{action:'care',at:1,providerId:owner,beneficiaryId:founders[1],eventId:'care',planId:'p',container:'person:'+owner,definition:'old@1',proposalId:null,authority:'consent',inputs:[amount(1,null)],hungerBefore:50,hungerAfter:30,hungerRelief:20}];
 const c=createNineFoodEvidence(w.id,0);c.sample(before,after,obs);assert.equal(c.finish().careMeals.scopedTotals!.inputs.nutrition,null);
 obs.careMeals[0].container='missing-container';const other=createNineFoodEvidence(w.id,0);other.sample(before,after,obs);assert.equal(other.finish().careMeals.scopedTotals,null);
});

test('review: gross sources and processing inputs/outputs remain distinct physical evidence',()=>{
 const w=fixture(),before=snapshot(w);w.minute=1;const after=snapshot(w),obs=complete(w);
 const identity={at:1,residentId:owner,eventId:'source-event',planId:'plan',container:'person:'+owner,definition:'historical@1'};
 obs.foodFlows=[
  {...identity,type:'source_added',action:'harvest',sourceId:'field',outputs:[amount(12,240)]},
  {...identity,eventId:'cook-event',type:'processed',action:'cook',inputs:[amount(2,40)],outputs:[{item:'meal',quantity:1,nutrition:50,lots:null}]},
 ];
 const c=createNineFoodEvidence(w.id,0);c.sample(before,after,obs);const total=c.finish().foodFlows.scopedTotals!;
 assert.equal(total.sourceAdded.units.turnip,12);assert.equal(total.sourceAdded.nutrition,240);
 assert.equal(total.inputs.units.turnip,2);assert.equal(total.inputs.nutrition,40);
 assert.equal(total.outputs.units.meal,1);assert.equal(total.outputs.units.turnip,0);assert.equal(total.outputs.nutrition,50);
 assert.equal(c.finish().completeFoodLedger,false);
});

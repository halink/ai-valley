import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {createIsolationEvidence} from '../src/world/isolation-evidence.js';
import {FOOD_OWNERSHIP_COVERAGE,FOOD_FLOW_COVERAGE,FOOD_LOSS_COVERAGE,FOOD_TRANSFER_COVERAGE,type DirectEatingObservation,type FoodOwnershipReceipt,type FoodOwnershipStock,type FoodOwnershipAmount} from '../src/world/food-consumption-evidence.js';
import {DAY} from '../src/world/time.js';
import {createNineFoodEvidence,snapshotNineFood} from './helpers/nine-food-accounting.js';

const amount=(quantity:number|null=3,item:FoodOwnershipAmount['item']='turnip'):FoodOwnershipAmount=>({item,quantity,nutrition:null,lots:null});
const stock=(from:string|null,to:string,id='parcel',quantity:number|null=3,ambiguous=false):FoodOwnershipStock=>({containerType:'estate-stock',container:'estate-stock:'+id,fromOwnerId:from,toOwnerId:to,ambiguous,amounts:[amount(quantity)]});
function fixture(at=10){
 const w=createFrontierWorld(5401);w.minute=at;
 const ids=w.residents.map(r=>r.id),daily=createIsolationEvidence(w),nine=createNineFoodEvidence(w.id,at);
 assert.equal(ids.length,9);
 const receipt=(id='one',stocks=[stock('outside-owner',ids[0])]):FoodOwnershipReceipt=>({type:'ownership_change',action:'production',operation:'inherit',at:w.minute,eventId:'event-'+id,planId:'plan-'+id,estatePersonId:'decedent',shareId:'share-'+id,heirId:stocks[0]?.toOwnerId??ids[0],stocks});
 const observation=(receipts:FoodOwnershipReceipt[]=[]):DirectEatingObservation=>({worldId:w.id,fromMinute:w.minute-1,toMinute:w.minute,receipts:[],foodFlows:[],foodFlowCoverage:FOOD_FLOW_COVERAGE,foodLosses:[],foodLossCoverage:FOOD_LOSS_COVERAGE,foodTransfers:[],foodTransferCoverage:FOOD_TRANSFER_COVERAGE,foodOwnershipChanges:receipts,foodOwnershipCoverage:FOOD_OWNERSHIP_COVERAGE,careMeals:[],childCareMeals:[],emergencyCareMeals:[],journeyMeals:[],familyJourneyMeals:[],longCareMeals:[],publicDutyMeals:[]});
 const begin=()=>{const before=snapshotNineFood(w,ids);w.minute++;return {before,after:snapshotNineFood(w,ids)};};
 return {w,ids,daily,nine,receipt,observation,begin};
}

test('ownership accounting: every direction uses receipt owners, fixed founders and commons, never endpoint aliases or estate provenance',()=>{
 const f=fixture(),{w,ids,daily,nine}=f;
 w.residents[0].status='dead';w.residents[1].residency='outside';
 const pair=f.begin(),directions:[string,string,number][]=[['outside-owner',ids[0],2],[ids[1],'outside-heir',3],[ids[2],ids[3],5],['outside-a','outside-b',7],['outside-owner','commons',11],['commons','outside-heir',13],['commons',ids[4],17],[ids[5],'commons',19]];
 const receipts=directions.map(([from,to,q],i)=>f.receipt('direction-'+i,[stock(from,to,'direction-'+i,q)]));
 // Decedent identity and opaque container name cannot change the actual source owner.
 receipts[0].estatePersonId=ids[8];receipts[0].stocks[0].container='estate-stock:'+ids[7]+':misleading';
 const observation=f.observation(receipts),unchanged=structuredClone(w);
 daily.sample(w,observation);nine.sample(pair.before,pair.after,observation);
 const day=daily.finish(w)!,report=nine.finish(),s=report.foodOwnershipChanges;
 assert.equal(s.receipts.length,8);assert.equal(s.scopeInflowTotals!.units.turnip,13);assert.equal(s.scopeOutflowTotals!.units.turnip,16);
 assert.deepEqual(s.stockScopes.map(a=>[a[0].fromScope,a[0].toScope]),[['external','nine-and-public'],['nine-and-public','external'],['nine-and-public','nine-and-public'],['external','external'],['external','nine-and-public'],['nine-and-public','external'],['nine-and-public','nine-and-public'],['nine-and-public','nine-and-public']]);
 assert.deepEqual(day.foodOwnershipChanges.totals,{units:{turnip:77},nutrition:null,completedActions:8});
 assert.equal(s.totals!.units.turnip,77);assert.equal(s.totals!.nutrition,null);assert.equal(s.scopeInflowTotals!.nutrition,null);assert.equal(s.scopeOutflowTotals!.nutrition,null);
 assert.equal(report.foodTransfers.scopeInflowTotals!.units.turnip,0);assert.equal(report.foodTransfers.scopeOutflowTotals!.units.turnip,0);assert.equal(report.foodFlows.scopedTotals!.sourceAdded.units.turnip,0);assert.equal(report.directEating.nineIntakeTotals!.units.turnip,0);
 assert.equal(day.foodProduction.value,null);assert.equal(day.foodConsumption.value,null);assert.equal(report.foodProduction,null);assert.equal(report.foodConsumption,null);assert.equal(report.completeFoodLedger,false);assert.deepEqual(w,unchanged);
 observation.foodOwnershipChanges![0].stocks[0].amounts[0].quantity=99;assert.equal(nine.finish().foodOwnershipChanges.receipts[0].stocks[0].amounts[0].quantity,2);assert.equal(daily.finish(w)!.foodOwnershipChanges.receipts[0].stocks[0].amounts[0].quantity,2);
 s.receipts.length=0;assert.equal(nine.finish().foodOwnershipChanges.receipts.length,8);
});

test('ownership accounting: classify each stock separately within one successful inheritance',()=>{
 const f=fixture(),pair=f.begin(),to=f.ids[0],r=f.receipt('mixed',[
  stock('outside-owner',to,'outside',2),stock(f.ids[1],to,'internal',3),stock('commons',to,'public',5),
  {containerType:'orchard-stock',container:'orchard-stock:tree',fromOwnerId:'outside-owner',toOwnerId:to,ambiguous:false,amounts:[amount(7,'fruit')]},
  {containerType:'animal-stock',container:'animal-stock:hen',fromOwnerId:'outside-owner',toOwnerId:to,ambiguous:false,amounts:[amount(11,'egg')]},
 ]);
 f.daily.sample(f.w,f.observation([r]));f.nine.sample(pair.before,pair.after,f.observation([r]));
 const s=f.nine.finish().foodOwnershipChanges;assert.equal(s.scopeInflowTotals!.units.turnip,2);assert.equal(s.scopeInflowTotals!.units.fruit,7);assert.equal(s.scopeInflowTotals!.units.egg,11);assert.equal(s.totals!.units.turnip,10);assert.equal(s.totals!.completedActions,1);
 assert.equal(f.daily.finish(f.w)!.foodOwnershipChanges.totals!.completedActions,1);
});

test('ownership accounting: empty successful receipt remains one event without invented food or nutrition',()=>{
 const f=fixture(),pair=f.begin(),o=f.observation([f.receipt('empty',[])]);f.daily.sample(f.w,o);f.nine.sample(pair.before,pair.after,o);
 assert.deepEqual(f.daily.finish(f.w)!.foodOwnershipChanges.totals,{units:{},nutrition:null,completedActions:1});
 const s=f.nine.finish().foodOwnershipChanges;assert.equal(s.receipts.length,1);assert.deepEqual(s.stockScopes,[[]]);assert.equal(s.totals!.completedActions,1);assert.equal(s.scopeInflowTotals!.units.turnip,0);
});

test('ownership accounting: unknown quantities and ambiguous aliases stay null rather than inferred zero',()=>{
 const f=fixture(),pair=f.begin(),o=f.observation([
  f.receipt('unknown',[stock('outside-owner',f.ids[0],'unknown',null)]),
  f.receipt('alias',[stock(null,'outside-heir','alias',null,true)]),
  f.receipt('alias-in',[stock(null,f.ids[1],'alias-in',null,true)]),
 ]);
 f.daily.sample(f.w,o);f.nine.sample(pair.before,pair.after,o);const s=f.nine.finish().foodOwnershipChanges;
 assert.equal(s.totals!.units.turnip,null);assert.equal(s.scopeInflowTotals!.units.turnip,null);assert.equal(s.scopeOutflowTotals!.units.turnip,null);assert.equal(s.scopeInflowTotals!.units.berry,0);
 assert.equal(s.stockScopes[1][0].fromScope,'unknown');assert.equal(s.receipts[1].stocks[0].ambiguous,true);assert.equal(f.daily.finish(f.w)!.foodOwnershipChanges.totals!.units.turnip,null);
});

test('ownership accounting: finite stock quantities overflowing an aggregate remain unknown',()=>{
 const f=fixture(),pair=f.begin(),o=f.observation([f.receipt('overflow-a',[stock('outside-owner',f.ids[0],'a',Number.MAX_VALUE)]),f.receipt('overflow-b',[stock('outside-owner',f.ids[0],'b',Number.MAX_VALUE)])]);
 f.daily.sample(f.w,o);f.nine.sample(pair.before,pair.after,o);assert.equal(f.daily.finish(f.w)!.foodOwnershipChanges.totals!.units.turnip,null);assert.equal(f.nine.finish().foodOwnershipChanges.scopeInflowTotals!.units.turnip,null);assert.equal(f.nine.finish().foodOwnershipChanges.totals!.units.turnip,null);
});

for(const mode of ['no-observation','no-marker','no-array','neither'] as const)test('ownership accounting: legacy '+mode+' preserves facts but cannot claim coverage',()=>{
 const f=fixture();let pair=f.begin();const o=f.observation([f.receipt()]);
 if(mode==='no-marker'||mode==='neither')delete o.foodOwnershipCoverage;
 if(mode==='no-array'||mode==='neither'){delete o.foodOwnershipChanges;delete o.foodOwnershipCoverage;}
 f.daily.sample(f.w,mode==='no-observation'?undefined:o);f.nine.sample(pair.before,pair.after,mode==='no-observation'?undefined:o);
 pair=f.begin();const fresh=f.observation([f.receipt('new')]);f.daily.sample(f.w,fresh);f.nine.sample(pair.before,pair.after,fresh);
 for(const s of [f.daily.finish(f.w)!.foodOwnershipChanges,f.nine.finish().foodOwnershipChanges]){assert.equal(s.observedMinutes,1);assert.equal(s.unobservedMinutes,1);assert.equal(s.totals,null);assert.equal(s.receipts.length,mode==='no-marker'?2:1);}
 assert.equal(f.nine.finish().foodOwnershipChanges.scopeInflowTotals,null);assert.equal(f.nine.finish().foodOwnershipChanges.scopeOutflowTotals,null);
});

for(const malformed of ['missing-array','undefined-array','wrong-marker','bad-quantity','extra-field','duplicate-container','duplicate-item','sparse-array','accessor','malformed-other-slice','other-slice-accessor'] as const)test('ownership accounting: whole-observation rejection is atomic for '+malformed,()=>{
 const f=fixture(),pair=f.begin(),o=f.observation([f.receipt()]);let invoked=false;
 if(malformed==='missing-array')delete o.foodOwnershipChanges;
 else if(malformed==='undefined-array')o.foodOwnershipChanges=undefined;
 else if(malformed==='wrong-marker')(o as unknown as Record<string,unknown>).foodOwnershipCoverage='wrong';
 else if(malformed==='bad-quantity')o.foodOwnershipChanges![0].stocks[0].amounts[0].quantity=NaN;
 else if(malformed==='extra-field')Object.assign(o.foodOwnershipChanges![0],{untrusted:'not evidence'});
 else if(malformed==='duplicate-container')o.foodOwnershipChanges![0].stocks.push(structuredClone(o.foodOwnershipChanges![0].stocks[0]));
 else if(malformed==='duplicate-item')o.foodOwnershipChanges![0].stocks[0].amounts.push(amount(2));
 else if(malformed==='sparse-array')o.foodOwnershipChanges!.length=2;
 else if(malformed==='accessor')Object.defineProperty(o.foodOwnershipChanges![0].stocks[0].amounts[0],'quantity',{get(){invoked=true;return 3;}});
 else if(malformed==='malformed-other-slice')(o as unknown as Record<string,unknown>).foodLosses=[null];
 else Object.defineProperty(o,'careMeals',{get(){invoked=true;return [];}});
 assert.throws(()=>f.daily.sample(f.w,o));assert.throws(()=>f.nine.sample(pair.before,pair.after,o));assert.equal(invoked,false);assert.equal(f.nine.finish().toMinute,pair.before.at);
 const good=f.observation([f.receipt()]);f.daily.sample(f.w,good);f.nine.sample(pair.before,pair.after,good);
 assert.equal(f.daily.finish(f.w)!.sampledMinutes,1);assert.equal(f.daily.finish(f.w)!.foodOwnershipChanges.totals!.completedActions,1);assert.equal(f.nine.finish().foodOwnershipChanges.totals!.completedActions,1);
});

for(const duplicate of ['event','share'] as const)test('ownership accounting: replay '+duplicate+' across days rejects before opening next bucket or consuming valid IDs',()=>{
 const f=fixture(DAY-1);let pair=f.begin();const closing=f.daily.sample(f.w,f.observation([f.receipt()]))!;f.nine.sample(pair.before,pair.after,f.observation([f.receipt()]));
 assert.equal(closing.calendarDay,0);assert.equal(closing.foodOwnershipChanges.receipts.length,1);
 pair=f.begin();const bad=f.receipt('bad');if(duplicate==='event')bad.eventId='event-one';else bad.shareId='share-one';
 const o=f.observation([f.receipt('good'),bad]);assert.throws(()=>f.daily.sample(f.w,o));assert.throws(()=>f.nine.sample(pair.before,pair.after,o));
 f.daily.sample(f.w,f.observation([f.receipt('good')]));f.nine.sample(pair.before,pair.after,f.observation([f.receipt('good')]));
 const day=f.daily.finish(f.w)!;assert.equal(day.calendarDay,1);assert.equal(day.sampledMinutes,1);assert.equal(day.foodOwnershipChanges.totals!.completedActions,1);assert.equal(f.nine.finish().foodOwnershipChanges.totals!.completedActions,2);assert.equal(f.nine.finish().foodOwnershipChanges.receipts.length,2);
});

for(const ordering of ['same-step','ownership-first','eat-first','transfer-first'] as const)test('ownership accounting: event overlap '+ordering+' rejects atomically',()=>{
 const f=fixture();let pair=f.begin();
 const eat=()=>({at:f.w.minute,residentId:f.ids[0],eventId:'event-one',planId:'eat-plan',container:'person:'+f.ids[0],item:'turnip' as const,quantity:1,nutrition:20,hungerRelief:20});
 if(ordering!=='same-step'){
  const first=f.observation(ordering==='ownership-first'?[f.receipt()]:[]);
  if(ordering==='eat-first')first.receipts=[eat()];
  if(ordering==='transfer-first')first.foodTransfers=[{type:'transfer',action:'outsideAid',operation:'collect',at:f.w.minute,eventId:'event-one',deliveryId:'delivery',noticeId:'notice',merchantId:'merchant',recipientId:f.ids[0],container:'aid:delivery',destinationContainer:'person:'+f.ids[0],amount:{item:'turnip',quantity:1,nutrition:null,lots:null}}];
  f.daily.sample(f.w,first);f.nine.sample(pair.before,pair.after,first);pair=f.begin();
 }
 const bad=f.observation(ordering==='ownership-first'?[]:[f.receipt()]);if(ordering==='ownership-first'||ordering==='same-step')bad.receipts=[eat()];
 assert.throws(()=>f.daily.sample(f.w,bad));assert.throws(()=>f.nine.sample(pair.before,pair.after,bad));
 f.daily.sample(f.w,f.observation([f.receipt('good')]));f.nine.sample(pair.before,pair.after,f.observation([f.receipt('good')]));
 assert.equal(f.daily.finish(f.w)!.sampledMinutes,ordering==='same-step'?1:2);assert.equal(f.nine.finish().foodOwnershipChanges.receipts.length,ordering==='ownership-first'?2:1);
});

test('ownership accounting: same-minute growth and spoilage on an ownership-changed stock retain unknown physical scope',()=>{
 const f=fixture(),before=snapshotNineFood(f.w,f.ids);f.w.minute++;const after=snapshotNineFood(f.w,f.ids);
 const units=structuredClone(before.scopedTotals);for(const key of Object.keys(units) as (keyof typeof units)[])units[key]=0;units.fruit=3;
 const source={id:'orchard-stock:tree',aliases:['orchard-stock:tree'],type:'orchard-stock' as const,ownerId:'outside-owner',scope:'external' as const,units};
 before.containers.push(source);after.containers.push({...structuredClone(source),ownerId:f.ids[0],scope:'nine-and-public'});
 const r=f.receipt('tree',[{containerType:'orchard-stock',container:'orchard-stock:tree',fromOwnerId:'outside-owner',toOwnerId:f.ids[0],ambiguous:false,amounts:[amount(3,'fruit')]}]),o=f.observation([r]);
 o.foodFlows=[{type:'source_added',action:'fruit_growth',at:f.w.minute,residentId:null,eventId:null,planId:null,container:'orchard-stock:tree',definition:'industry/processes@1',ownerId:f.ids[0],sourceId:'tree',outputs:[{item:'fruit',quantity:1,nutrition:null,lots:null}]}];
 o.foodLosses=[{type:'loss',cause:'spoilage',occurrence:1,at:f.w.minute,containerType:'orchard-stock',container:'orchard-stock:tree',amount:{item:'fruit',quantity:2,nutrition:null,lots:null}}];
 f.nine.sample(before,after,o);const report=f.nine.finish();
 assert.equal(report.foodOwnershipChanges.scopeInflowTotals!.units.fruit,3);assert.deepEqual(report.foodFlows.scopes,['unknown']);assert.deepEqual(report.foodLosses.scopes,['unknown']);assert.equal(report.foodFlows.scopedTotals,null);assert.equal(report.foodLosses.scopedTotals,null);assert.equal(report.completeFoodLedger,false);
});

for(const duplicate of ['event','share'] as const)test('ownership accounting: duplicate '+duplicate+' within a step rejects all earlier valid records and permits retry',()=>{
 const f=fixture(),pair=f.begin(),a=f.receipt('a'),b=f.receipt('b');
 if(duplicate==='event')b.eventId=a.eventId;else b.shareId=a.shareId;
 assert.throws(()=>f.daily.sample(f.w,f.observation([a,b])));assert.throws(()=>f.nine.sample(pair.before,pair.after,f.observation([a,b])));
 f.daily.sample(f.w,f.observation([a]));f.nine.sample(pair.before,pair.after,f.observation([a]));assert.equal(f.daily.finish(f.w)!.sampledMinutes,1);assert.equal(f.nine.finish().foodOwnershipChanges.totals!.completedActions,1);
});

test('ownership daily compatibility: old absent flow array stays unknown beside fully covered ownership evidence',()=>{
 const f=fixture();f.begin();const o=f.observation([f.receipt()]);delete o.foodFlows;
 f.daily.sample(f.w,o);const day=f.daily.finish(f.w)!;assert.equal(day.foodFlows.totals,null);assert.equal(day.foodFlows.unobservedMinutes,1);assert.equal(day.foodOwnershipChanges.totals!.completedActions,1);
});

test('ownership daily compatibility: old uncovered craft facts keep historical lot timestamps without weakening ownership validation',()=>{
 const f=fixture();f.begin();const o=f.observation([f.receipt()]);o.foodFlowCoverage='gather_harvest_cook_fish_hunt_growth_v1';
 o.foodFlows=[{type:'processed',action:'industry_craft',at:f.w.minute,residentId:f.ids[0],eventId:'craft-event',planId:'craft-plan',container:'person:'+f.ids[0],inputContainer:'craft:batch',batchId:'batch',buildingId:'mill',definition:'recipe/industry/milled@1',recipe:{id:'milled',input:{grain:2},output:{bread:1},minutes:30,station:'mill',skill:'farming',minimum:1},inputs:[{item:'grain',quantity:2,nutrition:6,lots:[{quantity:2,producedAt:1,expiresAt:5,definition:'food/life@1',nutrition:6}]}],outputs:[{item:'bread',quantity:1,nutrition:4,lots:[{quantity:1,producedAt:2,expiresAt:6,definition:'food/life@1',nutrition:4}]}]}];
 const bad=structuredClone(o);bad.foodOwnershipChanges![0].stocks[0].amounts[0].quantity=-1;assert.throws(()=>f.daily.sample(f.w,bad));
 f.daily.sample(f.w,o);const day=f.daily.finish(f.w)!;assert.deepEqual(day.foodFlows.receipts,o.foodFlows);assert.equal(day.foodFlows.totals,null);assert.equal(day.foodOwnershipChanges.totals!.completedActions,1);
});

test('ownership daily compatibility: old out-of-window receipt error precedes semantic validation and cannot consume inheritance identity',()=>{
 const f=fixture();f.begin();const bad=f.observation([f.receipt()]);bad.longCareMeals=[{at:f.w.minute+1} as never];
 assert.throws(()=>f.daily.sample(f.w,bad),/does not cover/);f.daily.sample(f.w,f.observation([f.receipt()]));assert.equal(f.daily.finish(f.w)!.sampledMinutes,1);assert.equal(f.daily.finish(f.w)!.foodOwnershipChanges.totals!.completedActions,1);
});

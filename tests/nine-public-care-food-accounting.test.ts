import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import type {World} from '../src/shared/types.js';
import {snapshotNineFood,createNineFoodEvidence} from './helpers/nine-food-accounting.js';
import {publicMealFixture,queuePublicMeal} from './helpers/public-duty-meal-evidence.js';
import {activeEmergencyCare,emergencyCareFixture,queueEmergencyCare} from './helpers/emergency-care-meal-evidence.js';

// Explicit synthetic cohort: exactly nine identities exist before collection.
// Nonmembers remain external even when they provide or receive an actual meal.
function cohort(w:World,included:string[]){
 const ids=[...included],template=w.residents[0];
 while(ids.length<9){const id='nine-public-care-bystander-'+ids.length,r=structuredClone(template);
  Object.assign(r,{id,name:id,homeId:null,inside:null,roomAt:null,at:{x:0,y:0},inventory:{},parents:[],guardianIds:[],knownPeople:[],plan:null,activity:null,hunger:0,energy:100,health:100,decisionDue:Number.MAX_SAFE_INTEGER});
  w.residents.push(r);ids.push(id);
 }
 assert.equal(new Set(ids).size,9);return ids;
}
function harness(initial:World,ids:string[]){
 let w=initial;const collector=createNineFoodEvidence(w.id,w.minute);
 return {get w(){return w;},collector,
  tick(){const before=snapshotNineFood(w,ids),plain=structuredClone(w),observation=stepWorldWithFoodEvidence(w,1);stepWorld(plain,1);assert.deepEqual(w,plain,'collection must preserve ordinary engine state');const after=snapshotNineFood(w,ids);collector.sample(before,after,observation);return {before,after,observation};},
  reload(){const before=structuredClone(w);collector.finish();assert.deepEqual(w,before);const store=new WorldStore(':memory:');try{store.commit(w,null);w=store.load(true)!;assert.deepEqual(w,JSON.parse(JSON.stringify(before)),'SQLite preserves all JSON-serializable state');}finally{store.close();}
   assert.doesNotMatch(JSON.stringify(w),/"(?:publicDutyMeals|emergencyCareMeals|nineIntakeTotals|scopedTotals|beneficiaryScopes)"\s*:/);
  },
 };
}
function finish(h:ReturnType<typeof harness>,actorId:string){
 const ticks=[];let remaining=100;
 while(h.w.residents.find(r=>r.id===actorId)!.plan||h.w.residents.find(r=>r.id===actorId)!.activity){assert.ok(remaining-->0);ticks.push(h.tick());}
 return ticks;
}

for(const role of ['kitchen','care'] as const)for(const funded of [false,true])for(const providerIncluded of [false,true])test(`nine public meals: ${role}, ${funded?'public':'personal'} supplies, ${providerIncluded?'founder feeds external':'external feeds founder'}`,()=>{
 const f=publicMealFixture(role,funded);const plan=queuePublicMeal(f),ids=cohort(f.w,[providerIncluded?f.provider.id:f.beneficiary.id]),h=harness(f.w,ids);
 const stock={...f.inventory},personal={...f.provider.inventory};
 for(let i=0;i<10;i++)assert.deepEqual(h.tick().observation.publicDutyMeals,[]);
 h.reload();const ticks=finish(h,f.beneficiary.id),report=h.collector.finish().publicDutyMeals;
 assert.equal(report.receipts.length,1);const row=report.receipts[0],quantity=role==='care'?1:2,debitIncluded=funded||providerIncluded;
 assert.equal(row.planId,plan.id);assert.equal(row.providerId,f.provider.id);assert.equal(row.beneficiaryId,f.beneficiary.id);assert.equal(row.container,f.container);assert.equal(row.source,funded?'public':'personal');
 assert.deepEqual(row.inputs[0].lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.25,'food/life@90',2.5],[quantity-.25,'food/life@91',(quantity-.25)*30]]);
 assert.equal(row.inputs[0].nutrition,role==='care'?25:55);
 assert.deepEqual(report.scopes,[debitIncluded?'nine-and-public':'external']);assert.deepEqual(report.beneficiaryScopes,[providerIncluded?'external':'nine']);
 assert.equal(report.scopedTotals!.inputs.units[f.item],debitIncluded?quantity:0);assert.equal(report.scopedTotals!.inputs.units.water,debitIncluded?1:0);
 assert.equal(report.nineIntakeTotals!.units[f.item],providerIncluded?0:quantity);assert.equal(report.nineIntakeTotals!.units.water,providerIncluded?0:1);
 assert.equal(report.nineIntakeTotals!.nutrition,providerIncluded?0:row.inputs[0].nutrition);assert.equal(report.nineIntakeTotals!.hungerRelief,providerIncluded?0:row.hungerRelief);assert.equal(report.nineIntakeTotals!.completedServings,providerIncluded?0:1);
 const mealTick=ticks.find(t=>t.observation.publicDutyMeals!.length)!;
 assert.equal(mealTick.before.scopedTotals[f.item]!-mealTick.after.scopedTotals[f.item]!,debitIncluded?quantity:0,'public treasury aggregate must not double count physical consumption');
 assert.equal(mealTick.before.scopedTotals.water!-mealTick.after.scopedTotals.water!,debitIncluded?1:0);
 const provider=h.w.residents.find(r=>r.id===f.provider.id)!,inventory=funded?h.w.civic!.stores[f.building.id]:provider.inventory;
 assert.equal(inventory[f.item],stock[f.item]!-quantity);assert.equal(inventory.water,stock.water!-1);
 if(funded){assert.deepEqual(provider.inventory,personal);assert.equal(h.w.economy!.treasuryStock[f.item],inventory[f.item]);assert.equal(mealTick.after.containers.filter(c=>c.aliases.includes(f.container)).length,1);}
 h.reload();for(let i=0;i<3;i++)assert.deepEqual(h.tick().observation.publicDutyMeals,[]);
 assert.equal(h.collector.finish().publicDutyMeals.receipts.length,1);assert.equal(h.collector.finish().completeFoodLedger,false);
});

for(const operation of ['feed','rescueMeal'] as const)for(const providerIncluded of [false,true])test(`nine emergency meals: ${operation}, ${providerIncluded?'founder feeds external child':'external feeds founder child'}`,()=>{
 const f=operation==='feed'?activeEmergencyCare():emergencyCareFixture(10,true),plan=queueEmergencyCare(f,operation),ids=cohort(f.w,[providerIncluded?f.provider.id:f.beneficiary.id]),h=harness(f.w,ids),stock={...f.provider.inventory};
 for(let i=0;i<10;i++)assert.deepEqual(h.tick().observation.emergencyCareMeals,[]);
 h.reload();const ticks=finish(h,f.provider.id),report=h.collector.finish().emergencyCareMeals;
 assert.equal(report.receipts.length,1);const row=report.receipts[0];assert.equal(row.planId,plan.id);assert.equal(row.operation,operation);assert.equal(row.providerId,f.provider.id);assert.equal(row.beneficiaryId,f.beneficiary.id);
 assert.deepEqual(row.inputs[0].lots!.map(l=>[l.quantity,l.definition,l.nutrition]),[[.25,'food/life@90',2.5],[.75,'food/life@91',22.5]]);
 assert.equal(row.agreementId,operation==='feed'?f.w.emergencyCare!.agreements.at(-1)!.id:null);assert.equal(row.mealNumber,operation==='feed'?1:null);
 assert.deepEqual(report.scopes,[providerIncluded?'nine-and-public':'external']);assert.deepEqual(report.beneficiaryScopes,[providerIncluded?'external':'nine']);
 assert.equal(report.scopedTotals!.inputs.units.meal,providerIncluded?1:0);assert.equal(report.scopedTotals!.inputs.units.water,providerIncluded?1:0);
 assert.equal(report.nineIntakeTotals!.units.meal,providerIncluded?0:1);assert.equal(report.nineIntakeTotals!.units.water,providerIncluded?0:1);assert.equal(report.nineIntakeTotals!.nutrition,providerIncluded?0:25);assert.equal(report.nineIntakeTotals!.hungerRelief,providerIncluded?0:row.hungerRelief);assert.equal(report.nineIntakeTotals!.completedServings,providerIncluded?0:1);
 const mealTick=ticks.find(t=>t.observation.emergencyCareMeals!.length)!;
 assert.equal(mealTick.before.scopedTotals.meal!-mealTick.after.scopedTotals.meal!,providerIncluded?1:0);assert.equal(mealTick.before.scopedTotals.water!-mealTick.after.scopedTotals.water!,providerIncluded?1:0);
 const provider=h.w.residents.find(r=>r.id===f.provider.id)!;assert.equal(provider.inventory.meal,stock.meal!-1);assert.equal(provider.inventory.water,stock.water!-1);
 h.reload();for(let i=0;i<3;i++)assert.deepEqual(h.tick().observation.emergencyCareMeals,[]);
 assert.equal(h.collector.finish().emergencyCareMeals.receipts.length,1);assert.equal(h.collector.finish().completeFoodLedger,false);
});

for(const kind of ['public','emergency'] as const)test(`nine ${kind} meals: original unknown nutrition is not inferred from hunger relief`,()=>{
 const f=kind==='public'?(()=>{const f=publicMealFixture('care',true);queuePublicMeal(f);return f;})():(()=>{const f=emergencyCareFixture(10,true);queueEmergencyCare(f,'rescueMeal');return f;})(),container=kind==='public'?'public:'+f.w.buildings[0].id:'person:'+f.provider.id;
 for(const lot of f.w.food!.lots[container].meal!)lot.definition='missing/original-food@1';
 const ids=cohort(f.w,[f.beneficiary.id]),h=harness(f.w,ids);finish(h,kind==='public'?f.beneficiary.id:f.provider.id);
 const report=kind==='public'?h.collector.finish().publicDutyMeals:h.collector.finish().emergencyCareMeals;
 assert.equal(report.receipts.length,1);assert.equal(report.receipts[0].inputs[0].nutrition,null);assert.ok(report.receipts[0].inputs[0].lots!.every(l=>l.nutrition===null));
 assert.equal(report.nineIntakeTotals!.nutrition,null);assert.equal(report.nineIntakeTotals!.units.meal,1);assert.ok(report.nineIntakeTotals!.hungerRelief!>0);
 assert.equal(report.scopedTotals!.inputs.nutrition,kind==='public'?null:0,'external unknown source does not poison known zero founder debit');
});

test('nine public and emergency meals: missing arrays leave coverage and totals unknown, not zero',()=>{
 const f=emergencyCareFixture(),ids=cohort(f.w,[]),collector=createNineFoodEvidence(f.w.id,f.w.minute),before=snapshotNineFood(f.w,ids),observation=stepWorldWithFoodEvidence(f.w,1);
 delete observation.publicDutyMeals;delete observation.emergencyCareMeals;collector.sample(before,snapshotNineFood(f.w,ids),observation);
 for(const slice of [collector.finish().publicDutyMeals,collector.finish().emergencyCareMeals]){assert.equal(slice.observedMinutes,0);assert.equal(slice.unobservedMinutes,1);assert.equal(slice.scopedTotals,null);assert.equal(slice.nineIntakeTotals,null);}
});

for(const kind of ['public','emergency'] as const)test(`nine ${kind} meals: last-step missing water produces no inventory or intake receipt`,()=>{
 const f=kind==='public'?(()=>{const f=publicMealFixture('care',true);queuePublicMeal(f);return f;})():(()=>{const f=emergencyCareFixture(10,true);queueEmergencyCare(f,'rescueMeal');return f;})(),ids=cohort(f.w,[f.provider.id,f.beneficiary.id]),h=harness(f.w,ids);
 for(let i=0;i<(kind==='public'?29:19);i++)h.tick();
 const inventory=kind==='public'?h.w.civic!.stores[h.w.buildings[0].id]:h.w.residents.find(r=>r.id===f.provider.id)!.inventory;
 inventory.water=0;const stock={...inventory};finish(h,kind==='public'?f.beneficiary.id:f.provider.id);
 const report=kind==='public'?h.collector.finish().publicDutyMeals:h.collector.finish().emergencyCareMeals;
 assert.deepEqual(inventory,stock);assert.deepEqual(report.receipts,[]);assert.equal(report.scopedTotals!.inputs.units.meal,0);assert.equal(report.nineIntakeTotals!.completedServings,0);assert.equal(report.nineIntakeTotals!.nutrition,0);
});

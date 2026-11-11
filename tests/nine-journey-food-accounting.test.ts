import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorldStore} from '../src/server/store.js';
import {stepWorld,stepWorldWithFoodEvidence} from '../src/world/engine.js';
import type {World} from '../src/shared/types.js';
import {snapshotNineFood,createNineFoodEvidence} from './helpers/nine-food-accounting.js';
import {journeyMealFixture,chooseJourneyMeal,originalJourneyLots,journeyPerson} from './helpers/journey-meal-evidence.js';
import {familyJourneyMealFixture,acceptFamilyJourney,chooseFamilyJourney,originalFamilyJourneyLots} from './helpers/family-journey-meal-evidence.js';

// Explicit synthetic cohort construction: all nine identities are real people
// present before collection starts. Family members excluded here remain external.
function cohort(w:World,included:string[]){
 const ids=[...included],template=w.residents[0];
 while(ids.length<9){const id='nine-journey-bystander-'+ids.length;
  const r=structuredClone(template);Object.assign(r,{id,name:id,homeId:null,inside:null,roomAt:null,at:{x:0,y:0},inventory:{},parents:[],guardianIds:[],knownPeople:[],plan:null,activity:null,hunger:0,energy:100,health:100,decisionDue:Number.MAX_SAFE_INTEGER});
  w.residents.push(r);ids.push(id);
 }
 assert.equal(new Set(ids).size,9);return ids;
}
function reload(w:World){const store=new WorldStore(':memory:');try{store.commit(w,null);const saved=store.load(true)!;assert.deepEqual(saved,w);return saved;}finally{store.close();}}
function harness(initial:World,ids:string[]){
 let w=initial;const collector=createNineFoodEvidence(w.id,w.minute);
 return {get w(){return w;},collector,
  tick(){const before=snapshotNineFood(w,ids),plain=structuredClone(w),observation=stepWorldWithFoodEvidence(w,1);stepWorld(plain,1);assert.deepEqual(w,plain,'evidence collection must preserve ordinary engine state');collector.sample(before,snapshotNineFood(w,ids),observation);return {before,after:snapshotNineFood(w,ids),observation};},
  reload(){const before=structuredClone(w);collector.finish();assert.deepEqual(w,before);w=reload(w);assert.doesNotMatch(JSON.stringify(w),/"(?:journeyMeals|familyJourneyMeals|nineIntakeTotals|scopedTotals|beneficiaryScopes)"\s*:/);},
 };
}

for(const mail of [false,true])for(const included of [false,true])test(`nine journey accounting: ${mail?'mail':'visitor'} ${included?'founder':'external'} actual meal survives mid-pause SQLite reload`,()=>{
 const f=journeyMealFixture(mail,true);originalJourneyLots(f.w,f.r);const ids=cohort(f.w,included?[f.r.id]:[]);chooseJourneyMeal(f.w,f.r,mail);
 const h=harness(f.w,ids),stock=f.r.inventory.meal!;
 for(let i=0;i<2;i++)assert.deepEqual(h.tick().observation.journeyMeals,[]);
 h.reload();h.w.clock.paused=true;const frozen=structuredClone(h.w);assert.deepEqual(stepWorldWithFoodEvidence(h.w,20).journeyMeals,[]);assert.deepEqual(h.w,frozen);h.w.clock.paused=false;
 for(let i=0;i<3;i++)h.tick();
 const report=h.collector.finish().journeyMeals,row=report.receipts[0];assert.equal(report.receipts.length,1);
 assert.equal(row.providerId,f.r.id);assert.equal(row.beneficiaryId,f.r.id);assert.equal(row.inputs[0].nutrition,25);
 assert.deepEqual(report.scopes,[included?'nine-and-public':'external']);assert.deepEqual(report.beneficiaryScopes,[included?'nine':'external']);
 assert.equal(report.scopedTotals!.inputs.units.meal,included?1:0);
 assert.equal(report.nineIntakeTotals!.units.meal,included?1:0);assert.equal(report.nineIntakeTotals!.nutrition,included?25:0);
 assert.equal(report.nineIntakeTotals!.hungerRelief,included?row.hungerRelief:0);assert.equal(report.nineIntakeTotals!.completedServings,included?1:0);
 assert.equal(journeyPerson(h.w,f.r.id).inventory.meal,stock-1);
 h.reload();for(let i=0;i<6;i++)assert.deepEqual(h.tick().observation.journeyMeals,[]);
 assert.equal(h.collector.finish().journeyMeals.receipts.length,1);
 assert.equal(h.collector.finish().completeFoodLedger,false);
});

for(const externalProvider of [true,false])test(`nine family accounting: three actual members, two providers, ${externalProvider?'external feeds founder':'founder feeds external'}`,()=>{
 const f=familyJourneyMealFixture(true);originalFamilyJourneyLots(f);acceptFamilyJourney(f);
 const ids=cohort(f.w,[f.owner.id,externalProvider?f.child.id:f.parent.id]);chooseFamilyJourney(f.w,f.parent,'depart');
 const h=harness(f.w,ids),{before,after,observation}=h.tick(),rows=observation.familyJourneyMeals!;
 assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.providerId)).size,2);assert.deepEqual(rows.map(r=>r.providerPortion),[0,0,1]);
 const report=h.collector.finish().familyJourneyMeals;
 assert.deepEqual(report.receipts,rows,'retain full transaction, including external providers and beneficiaries');
 assert.deepEqual(report.scopes,rows.map(r=>ids.includes(r.providerId)?'nine-and-public':'external'));
 assert.deepEqual(report.beneficiaryScopes,rows.map(r=>ids.includes(r.beneficiaryId)?'nine':'external'));
 const intake=rows.filter(r=>ids.includes(r.beneficiaryId)),debits=rows.filter(r=>ids.includes(r.providerId));
 assert.equal(report.scopedTotals!.inputs.units.meal,debits.length);assert.equal(report.scopedTotals!.inputs.units.water,debits.length);
 assert.equal(before.scopedTotals.meal!-after.scopedTotals.meal!,debits.length);
 assert.equal(report.nineIntakeTotals!.units.meal,2);assert.equal(report.nineIntakeTotals!.units.water,2);
 assert.equal(report.nineIntakeTotals!.completedServings,2);
 assert.equal(report.nineIntakeTotals!.nutrition,intake.reduce((n,r)=>n+r.inputs[0].nutrition!,0));
 assert.equal(report.nineIntakeTotals!.hungerRelief,intake.reduce((n,r)=>n+r.hungerRelief,0));
 assert.notEqual(report.scopedTotals!.inputs.units.meal,report.nineIntakeTotals!.units.meal,'inventory boundary and beneficiary boundary are independent');
 assert.deepEqual(h.collector.finish().journeyMeals.receipts,[]);
 const collected=h.collector.finish();assert.throws(()=>h.collector.sample(before,after,observation),/consecutive one-minute/);assert.deepEqual(h.collector.finish(),collected);
 h.reload();assert.deepEqual(h.tick().observation.familyJourneyMeals,[]);
});

test('nine family accounting: interrupted long route, SQLite restore, interval resume and withdrawal do not replay meals',()=>{
 const f=familyJourneyMealFixture(true,true);acceptFamilyJourney(f);const ids=cohort(f.w,[f.owner.id,f.child.id]);chooseFamilyJourney(f.w,f.parent,'depart');const h=harness(f.w,ids);
 assert.equal(h.tick().observation.familyJourneyMeals!.length,3);
 for(let i=0;i<80;i++)assert.deepEqual(h.tick().observation.familyJourneyMeals,[]);
 const agreement=()=>h.w.familyRelocation!.agreements[0];
 const next=agreement().journey!.path[0];h.w.map.tiles[next.y*h.w.map.width+next.x]='cliff';assert.deepEqual(h.tick().observation.familyJourneyMeals,[]);assert.equal(agreement().status,'paused');
 h.reload();h.w.map={...h.w.map,tiles:[...h.w.map.tiles]};h.w.map.tiles[next.y*h.w.map.width+next.x]='grass';
 for(let i=0;i<121;i++)assert.deepEqual(h.tick().observation.familyJourneyMeals,[]);
 const parent=()=>h.w.residents.find(r=>r.id===f.parent.id)!;chooseFamilyJourney(h.w,parent(),'resume');
 const resumed=h.tick().observation.familyJourneyMeals!;assert.equal(resumed.length,3);assert.ok(resumed.every(r=>r.trigger==='resume'&&r.rationNumber===2));
 h.reload();assert.deepEqual(h.tick().observation.familyJourneyMeals,[]);
 chooseFamilyJourney(h.w,h.w.residents.find(r=>r.id===f.child.id)!,'withdraw');assert.deepEqual(h.tick().observation.familyJourneyMeals,[]);assert.equal(agreement().status,'cancelled');
 const report=h.collector.finish().familyJourneyMeals;assert.equal(report.receipts.length,6);assert.equal(new Set(report.receipts.map(r=>`${r.relocationId}:${r.rationNumber}:${r.memberIndex}`)).size,6);
 assert.equal(report.nineIntakeTotals!.completedServings,4);assert.equal(report.scopedTotals!.inputs.units.meal,2);
});

test('nine journey accounting: an unobserved actual minute leaves both receipt slices unknown, not zero',()=>{
 const f=familyJourneyMealFixture();const ids=cohort(f.w,[]),collector=createNineFoodEvidence(f.w.id,f.w.minute),before=snapshotNineFood(f.w,ids);
 const observation=stepWorldWithFoodEvidence(f.w,1);delete observation.journeyMeals;delete observation.familyJourneyMeals;
 collector.sample(before,snapshotNineFood(f.w,ids),observation);
 for(const slice of [collector.finish().journeyMeals,collector.finish().familyJourneyMeals]){assert.equal(slice.unobservedMinutes,1);assert.equal(slice.scopedTotals,null);assert.equal(slice.nineIntakeTotals,null);}
});

test('nine family accounting: unknown original nutrition remains unknown after actual founder feeding',()=>{
 const f=familyJourneyMealFixture(true);acceptFamilyJourney(f);const ids=cohort(f.w,[f.child.id,f.owner.id]);
 for(const lot of f.w.food!.lots['person:'+f.parent.id].meal!)lot.definition='unknown/legacy@1';chooseFamilyJourney(f.w,f.parent,'depart');
 const h=harness(f.w,ids);h.tick();const report=h.collector.finish().familyJourneyMeals;
 assert.equal(report.receipts.length,3);assert.equal(report.nineIntakeTotals!.nutrition,null);assert.equal(report.nineIntakeTotals!.units.meal,2);assert.ok(report.nineIntakeTotals!.hungerRelief!>0);
 assert.notEqual(report.scopedTotals!.inputs.nutrition,null,'external unknown nutrition does not poison known founder inventory debit');
});

for(const corruption of ['duplicate','missing','beneficiary','portion'] as const)test(`nine family accounting: actual mixed-provider ${corruption} transaction is rejected atomically`,()=>{
 const f=familyJourneyMealFixture(true);acceptFamilyJourney(f);const ids=cohort(f.w,[f.owner.id,f.child.id]);chooseFamilyJourney(f.w,f.parent,'depart');
 const collector=createNineFoodEvidence(f.w.id,f.w.minute),before=snapshotNineFood(f.w,ids),observation=stepWorldWithFoodEvidence(f.w,1),after=snapshotNineFood(f.w,ids),bad=structuredClone(observation),rows=bad.familyJourneyMeals!;
 assert.equal(rows.length,3);
 if(corruption==='duplicate')rows.push(structuredClone(rows[0]));
 if(corruption==='missing')rows.pop();
 if(corruption==='beneficiary')rows[2].beneficiaryId=rows[1].beneficiaryId;
 if(corruption==='portion')rows[2].providerPortion=2;
 const empty=collector.finish();assert.throws(()=>collector.sample(before,after,bad));assert.deepEqual(collector.finish(),empty,'rejected transaction must not advance any receipt slice or coverage');
 collector.sample(before,after,observation);assert.deepEqual(collector.finish().familyJourneyMeals.receipts,observation.familyJourneyMeals);assert.equal(collector.finish().familyJourneyMeals.nineIntakeTotals!.completedServings,2);
});

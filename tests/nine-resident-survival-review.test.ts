/** Independent adversarial contract fixtures. These are NOT engine simulations. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SURVIVAL_CONTRACT,MEAL_CHANNELS,createSurvivalEvaluator,type SurvivalHeader,type SurvivalStep,type SurvivalClose} from './helpers/nine-resident-survival.js';
import type {DirectEatingObservation,FoodFlowAmount} from '../src/world/food-consumption-evidence.js';
const start=480,end=start+21600;
const header=():SurvivalHeader=>({type:'header',schema:1,executionKind:'offline-scripted-survival-observation',worldId:'independent-fixture',seed:5401,fromMinute:start,endMinute:end,contract:SURVIVAL_CONTRACT,initialFingerprint:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),helperSha256:'c'.repeat(64),initial:{at:start,people:Array.from({length:9},(_,i)=>({id:`review-${i}`,name:`review ${i}`,status:'alive',health:100,hunger:30,hungerPerMinute:.038}))}});
const closing=():SurvivalClose=>({type:'close',at:end,exception:null,reloaded:true,
 actionCoverage:Object.fromEntries(['exactEndpoint','defaultNine','allNineAte','allNineSlept','share','heardAddressVisit','plant','water','harvest','saveSeed','replant'].map(k=>[k,true])),
 supportCoverage:Object.fromEntries(['giftOffered','giftAccepted','giftDelivered','giftNextEatLinked','commonsInspected','commonsTaken','explorationBackoffUsed'].map(k=>[k,true]))});
const step=(at:number):SurvivalStep=>({type:'step',snapshot:{at,people:header().initial.people},food:{worldId:'independent-fixture',fromMinute:at-1,toMinute:at,receipts:[],careMeals:[],childCareMeals:[],longCareMeals:[],journeyMeals:[],familyJourneyMeals:[],publicDutyMeals:[],emergencyCareMeals:[]}});
function run(edit?:(s:SurvivalStep,n:number)=>void){
 const e=createSurvivalEvaluator();e.accept(header());
 for(let n=1;n<=21600;n++){
  const s=step(start+n);
  if(n%720===0)s.food.receipts=s.snapshot.people.map(p=>({at:s.snapshot.at,residentId:p.id,eventId:`meal-${p.id}-${n}`,planId:`plan-${p.id}-${n}`,container:`person:${p.id}`,item:'meal',quantity:1,nutrition:30,hungerRelief:30}));
  edit?.(s,n);e.accept(s);
 }
 e.accept(closing());return e.finish();
}
const has=(r:ReturnType<ReturnType<typeof createSurvivalEvaluator>['finish']>,code:string,id='review-0')=>r.failures.some(f=>f.code===code&&f.residentId===id);

test('independent fixture passes only the frozen synthetic contract, with no real-model claim',()=>{
 const r=run();assert.equal(r.syntheticLongTermSurvivalPassed,true);assert.equal(r.realModelExecuted,false);assert.equal(r.modelAutonomyAcceptancePassed,null);assert.equal(r.residents.length,9);
 assert.equal(r.residents[0].food.nutrition,900);assert.equal(r.residents[0].food.terminalNutrition,180);assert.equal(r.residents[0].food.maximumMealGapMinutes,720);
});
test('recovered endpoint cannot erase a severe intermediate health loss',()=>{
 const r=run((s,n)=>{if(n===100)s.snapshot.people[0].health=79;});
 assert.equal(r.residents[0].final.health,100);assert.equal(r.residents[0].netHealthChange,0);assert.ok(has(r,'health_below_floor'));assert.ok(has(r,'health_drawdown'));assert.equal(r.syntheticLongTermSurvivalPassed,false);
});
test('strict dangerous-hunger boundary and sustained episode are independently measured',()=>{
 const r=run((s,n)=>{if(n<=121)s.snapshot.people[0].hunger=80;if(n===500)s.snapshot.people[1].hunger=95;if(n===501)s.snapshot.people[2].hunger=95.001;});
 assert.ok(has(r,'sustained_hunger'));assert.equal(r.residents[0].longestSustainedHungerMinutes,121);assert.equal(r.residents[1].dangerousHungerMinutes,0);assert.ok(has(r,'dangerous_hunger_exposure','review-2'));
});
test('one unfed resident cannot be hidden by eight residents meals or healthy endpoints',()=>{
 const r=run(s=>{s.food.receipts=s.food.receipts.filter(m=>m.residentId!=='review-0');});
 assert.ok(has(r,'meal_gap'));assert.ok(has(r,'nutrition_below_demand'));assert.ok(has(r,'terminal_nutrition_below_demand'));assert.equal(r.residents[0].food.nutrition,0);assert.equal(r.residents[1].food.nutrition,900);
});
test('whole-run nutrition cannot cover a terminal supply collapse; gap includes the tail',()=>{
 const r=run((s,n)=>{for(const m of s.food.receipts)if(m.residentId==='review-0')m.nutrition=60;if(n>17280)s.food.receipts=s.food.receipts.filter(m=>m.residentId!=='review-0');});
 assert.equal(r.residents[0].food.nutrition,1440);assert.ok(has(r,'terminal_nutrition_below_demand'));assert.ok(has(r,'meal_gap'));assert.equal(r.residents[0].food.maximumMealGapMinutes,4320);
});
test('one absent meal channel is unknown intake, never zero-filled coverage',()=>{
 const r=run((s,n)=>{if(n===100)delete s.food.careMeals;});
 assert.ok(has(r,'meal_channel_incomplete:careMeals'));assert.ok(has(r,'intake_unknown'));assert.equal(r.residents[0].food.nutrition,null);assert.equal(r.residents[0].food.maximumMealGapMinutes,null);
});
test('duplicate receipts invalidate evidence rather than inflate nutrition',()=>{
 const r=run((s,n)=>{if(n===720)s.food.receipts.push({...s.food.receipts[0]});});
 assert.equal(r.syntheticLongTermSurvivalPassed,false);assert.ok(r.failures.some(f=>f.actual==='duplicate_meal_receipt'));assert.equal(r.residents[0].food.nutrition,null);assert.equal(r.residents[0].dangerousHungerMinutes,null);
});
test('missing state and resurrection cannot be certified from final nine alive',()=>{
 const e=createSurvivalEvaluator();e.accept(header());const s=step(start+1);s.snapshot.people[0].status='dead';e.accept(s);const next=step(start+2);e.accept(next);
 const r=e.finish();assert.ok(has(r,'resident_resurrected'));assert.ok(has(r,'resident_not_surviving'));assert.equal(r.residents[0].dangerousHungerMinutes,null);assert.equal(r.syntheticLongTermSurvivalPassed,false);
});
test('a fractional substep can expose damage otherwise hidden by the integer endpoint',()=>{
 const e=createSurvivalEvaluator();e.accept(header());const first=step(start+.25);first.food.fromMinute=start;first.snapshot.people[0].health=79;first.snapshot.people[0].hunger=96;e.accept(first);
 const second=step(start+1);second.food.fromMinute=start+.25;e.accept(second);const r=e.finish();assert.ok(has(r,'health_below_floor'));assert.equal(r.residents[0].observedDangerousHungerMinutes,.25);assert.equal(r.residents[0].final.health,100);
});

const foodAmount=(nutrition:number|null=20):FoodFlowAmount=>({item:'meal',quantity:1,nutrition,lots:nutrition===null?null:[{quantity:1,definition:'food/meal@1',producedAt:start,expiresAt:end+1,nutrition}]});
const water:FoodFlowAmount={item:'water',quantity:1,nutrition:0,lots:[]};
function channelReceipt(channel:typeof MEAL_CHANNELS[number],at:number):unknown{
 const providerId=channel==='journeyMeals'?'review-0':'review-1',base={at,providerId,beneficiaryId:'review-0',eventId:`channel-${channel}`,planId:'review-plan',container:`person:${providerId}`,definition:'action/care@1',inputs:[foodAmount()],hungerBefore:50,hungerAfter:30,hungerRelief:20};
 switch(channel){
  case 'receipts':return {at,residentId:'review-0',eventId:'channel-direct',planId:'review-plan',container:'person:review-0',item:'meal',quantity:1,nutrition:20,hungerRelief:20};
  case 'careMeals':return {...base,action:'care',proposalId:null,authority:'guardian'};
  case 'childCareMeals':return {...base,action:'tendChild',authority:'guardian'};
  case 'longCareMeals':return {...base,action:'longCare',operation:'visit',agreementId:'review-agreement',slotKey:'review-slot',healthBefore:100,healthAfter:100,healthGain:0};
  case 'emergencyCareMeals':return {...base,action:'emergencyCare',operation:'rescueMeal',agreementId:null,mealNumber:null,inputs:[foodAmount(),water]};
  case 'publicDutyMeals':return {...base,action:'publicDuty',operation:'receive',shiftId:'review-shift',buildingId:'review-building',role:'care',serviceNumber:1,source:'personal',inputs:[foodAmount(),water],healthBefore:100,healthAfter:100,healthGain:0,funding:null};
  case 'journeyMeals':{const {planId,definition,...rest}=base;return {...rest,action:'visitorJourney',operation:'eat',journeyId:'review-journey'};}
  case 'familyJourneyMeals':{const {eventId,planId,...rest}=base;return {...rest,action:'familyRelocation',operation:'ration',trigger:'depart',relocationId:'review-relocation',rationNumber:1,memberIndex:0,memberCount:2,providerPortion:0,inputs:[foodAmount(),water]};}
 }
}
test('all eight meal channels credit the beneficiary, never a distinct provider',()=>{
 for(const channel of MEAL_CHANNELS){const e=createSurvivalEvaluator();e.accept(header());const s=step(start+1);Object.assign(s.food,{[channel]:[channelReceipt(channel,start+1)]});e.accept(s);const r=e.finish();
  assert.equal(r.failures.some(f=>f.code==='invalid_evidence'),false,channel+': '+JSON.stringify(r.failures));assert.equal(r.residents[0].food.observedNutrition,20,channel);assert.equal(r.residents[1].food.observedNutrition,0,channel);assert.equal(r.residents[0].food.nutrition,null,'partial trace is never full intake');
 }
});
test('unknown original nutrition stays unknown, not inferred from hunger relief',()=>{
 const e=createSurvivalEvaluator();e.accept(header());const s=step(start+1);const meal=channelReceipt('careMeals',start+1) as NonNullable<DirectEatingObservation['careMeals']>[number];meal.inputs=[foodAmount(null)];s.food.careMeals=[meal];e.accept(s);const r=e.finish();assert.equal(r.residents[0].food.observedNutrition,null);assert.equal(r.residents[0].food.nutrition,null);assert.ok(has(r,'intake_unknown'));
});
test('finite receipt values whose sum overflows cannot become infinite accepted nutrition',()=>{
 const r=run(s=>{for(const m of s.food.receipts)if(m.residentId==='review-0')m.nutrition=1e308;});
 assert.equal(r.syntheticLongTermSurvivalPassed,false);assert.equal(r.residents[0].food.nutrition,null);assert.ok(has(r,'intake_unknown'));
});
test('fixed inclusive limits are not silently tightened by the independent review',()=>{
 const r=run((s,n)=>{if(n<=120)s.snapshot.people[0].hunger=80;if(n===500)s.snapshot.people[0].health=80;});
 assert.equal(r.syntheticLongTermSurvivalPassed,true);assert.equal(r.residents[0].longestSustainedHungerMinutes,120);assert.equal(r.residents[0].maximumHealthDrawdown,20);
});
test('a skipped interval and changed resident identity fail closed without inventing observation minutes',()=>{
 for(const mutate of [(s:SurvivalStep)=>{s.food.fromMinute=start+1;s.food.toMinute=start+2;s.snapshot.at=start+2;},(s:SurvivalStep)=>{s.snapshot.people[0].id='foreign-replacement';}]){
  const e=createSurvivalEvaluator();e.accept(header());const s=step(start+1);mutate(s);e.accept(s);const r=e.finish();
  assert.equal(r.syntheticLongTermSurvivalPassed,false);assert.equal(r.observedMinutes,0);assert.ok(r.failures.some(f=>f.code==='invalid_evidence'));assert.equal(r.residents[0].dangerousHungerMinutes,null);
 }
});

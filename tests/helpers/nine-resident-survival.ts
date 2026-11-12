/** Offline, observer-only acceptance. No world mutation, decisions, model or IO.
 * This contract deliberately remains separate from the historical alive-only gate. */
import {checkedDirectEatingObservation} from '../../src/world/isolation-evidence.js';
import {goods} from '../../src/shared/items.js';
import type {World} from '../../src/shared/types.js';
import type {DirectEatingObservation} from '../../src/world/food-consumption-evidence.js';

export const SURVIVAL_CONTRACT=Object.freeze({
 id:'nine-resident-synthetic-survival-v1',days:15,dayMinutes:1440,residents:9,maxSampleMinutes:1,
 minimumHealth:80,maximumHealthDrawdown:20,sustainedHungerAt:80,maximumSustainedHungerMinutes:120,
 dangerousHungerAbove:95,maximumDangerousHungerMinutes:0,maximumMealGapMinutes:1440,
 minimumNutritionDemandRatio:1,terminalNutritionWindowMinutes:4320,hungerPerMinute:.038
} as const);
export const MEAL_CHANNELS=['receipts','careMeals','childCareMeals','longCareMeals','journeyMeals','familyJourneyMeals','publicDutyMeals','emergencyCareMeals'] as const;
type Channel=typeof MEAL_CHANNELS[number];
export type SurvivalPerson={id:string;name:string;status:'alive'|'dead';health:number;hunger:number;hungerPerMinute:number|null};
export type SurvivalSnapshot={at:number;people:SurvivalPerson[]};
export type SurvivalHeader={type:'header';schema:1;executionKind:'offline-scripted-survival-observation';worldId:string;seed:5401;
 fromMinute:number;endMinute:number;contract:typeof SURVIVAL_CONTRACT;initialFingerprint:string;sourceFingerprint:string;helperSha256:string;initial:SurvivalSnapshot};
export type SurvivalStep={type:'step';snapshot:SurvivalSnapshot;food:DirectEatingObservation};
export type SurvivalClose={type:'close';at:number;exception:string|null;actionCoverage:Record<string,boolean>;supportCoverage:Record<string,boolean>;reloaded:boolean};
export type SurvivalRecord=SurvivalHeader|SurvivalStep|SurvivalClose;
type Failure={gate:'coverage'|'survival'|'health'|'hunger'|'food';code:string;residentId?:string;at?:number;actual?:number|string;limit?:number};
type Meal={at:number;channel:Channel;identity:string;nutrition:number|null;hungerRelief:number};
type Episode={fromMinute:number;throughMinute:number;minutes:number};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const close=(a:number,b:number)=>Math.abs(a-b)<=1e-8;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fail(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}

/** Read raw fields only: no physiology accessor that could initialize a world. */
export function survivalSnapshot(world:World):SurvivalSnapshot {
 return {at:world.minute,people:world.residents.map(p=>({id:p.id,name:p.name,status:p.status,health:p.health,hunger:p.hunger,
  hungerPerMinute:typeof world.definitions[p.physiologyDefinition??'life/physiology@1']?.data.hungerPerMinute==='number'
   ?world.definitions[p.physiologyDefinition??'life/physiology@1'].data.hungerPerMinute as number:null}))};
}
/** Preserve actual receipts, not inventory changes, promises or completed actions. */
export function survivalFood(observation:DirectEatingObservation):DirectEatingObservation {
 const result:DirectEatingObservation={worldId:observation.worldId,fromMinute:observation.fromMinute,toMinute:observation.toMinute,receipts:observation.receipts};
 for(const key of MEAL_CHANNELS)if(observation[key]!==undefined)Object.assign(result,{[key]:observation[key]});
 return structuredClone(result);
}
function checkedSnapshot(value:SurvivalSnapshot){
 fail(value&&finite(value.at)&&Array.isArray(value.people),'invalid_snapshot');
 const seen=new Set<string>();
 for(const p of value.people){
  fail(p&&typeof p.id==='string'&&p.id.length>0&&!seen.has(p.id)&&typeof p.name==='string','invalid_resident_identity');seen.add(p.id);
  fail(['alive','dead'].includes(p.status)&&finite(p.health)&&p.health>=0&&p.health<=100&&finite(p.hunger)&&p.hunger>=0&&p.hunger<=100,'invalid_resident_state');
  fail(p.hungerPerMinute===null||finite(p.hungerPerMinute)&&p.hungerPerMinute>=0,'invalid_physiology_rate');
 }
 return structuredClone(value);
}
function newResident(p:SurvivalPerson,at:number){return {id:p.id,name:p.name,initial:structuredClone(p),final:structuredClone(p),sampledMinutes:0,
 minimumHealth:p.health,minimumHealthAt:at,maximumHealth:p.health,maximumHealthDrawdown:0,maximumHealthDrawdownAt:at,
 maximumHunger:p.hunger,dangerousHungerMinutes:0,sustainedHungerMinutes:0,longestSustainedHungerMinutes:0,
 hungerEpisodes:[] as Episode[],activeHunger:null as Episode|null,firstDeathAt:p.status==='dead'?at:null as number|null,
 meals:[] as Meal[],coverage:Object.fromEntries(MEAL_CHANNELS.map(k=>[k,0])) as Record<Channel,number>};}

/** Records may be streamed again from the retained journal. Invalid input cannot
 * turn into zero exposure. Known observations survive, with explicit blockers. */
export function createSurvivalEvaluator(){
 let header:SurvivalHeader|null=null,last:number|null=null,closed:SurvivalClose|null=null,steps=0;
 let invalid=false;
 const failures:Failure[]=[],people=new Map<string,ReturnType<typeof newResident>>(),mealIds=new Set<string>();
 const add=(failure:Failure)=>{if(!failures.some(f=>equal(f,failure)))failures.push(failure);};
 const ids=()=>[...people.keys()].sort();
 return {
  accept(input:SurvivalRecord){
   try{
    fail(input&&typeof input==='object','invalid_record');
    if(input.type==='header'){
     fail(!header&&steps===0&&!closed,'duplicate_or_late_header');
     fail(input.schema===1&&input.executionKind==='offline-scripted-survival-observation'&&input.seed===5401,'unsupported_execution');
     fail(equal(input.contract,SURVIVAL_CONTRACT),'contract_mismatch');
     fail(typeof input.worldId==='string'&&input.worldId.length>0&&finite(input.fromMinute)&&finite(input.endMinute)&&input.endMinute>input.fromMinute,'invalid_interval');
     for(const v of [input.initialFingerprint,input.sourceFingerprint,input.helperSha256])fail(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'missing_source_fingerprint');
     const initial=checkedSnapshot(input.initial);fail(initial.at===input.fromMinute,'initial_time_mismatch');
     fail(initial.people.length===SURVIVAL_CONTRACT.residents,'initial_nine_required');
     header=structuredClone(input);last=input.fromMinute;
     for(const p of initial.people)people.set(p.id,newResident(p,initial.at));
     return;
    }
    fail(header&&last!==null&&!closed,'missing_header_or_record_after_close');
    if(input.type==='close'){
     fail(input.at===last&& (input.exception===null||typeof input.exception==='string'),'invalid_close');
     for(const map of [input.actionCoverage,input.supportCoverage])fail(map&&typeof map==='object'&&!Array.isArray(map)&&Object.values(map).every(v=>typeof v==='boolean'),'invalid_coverage_map');
     fail(typeof input.reloaded==='boolean','invalid_reload_coverage');closed=structuredClone(input);return;
    }
    fail(input.type==='step','unsupported_record_type');
    const snapshot=checkedSnapshot(input.snapshot),food=checkedDirectEatingObservation(input.food);
    const dt=food.toMinute-food.fromMinute;
    fail(food.worldId===header.worldId&&food.fromMinute===last&&snapshot.at===food.toMinute&&dt>0&&dt<=SURVIVAL_CONTRACT.maxSampleMinutes&&food.toMinute<=header.endMinute,'nonconsecutive_or_oversized_sample');
    fail(equal(snapshot.people.map(p=>p.id).sort(),ids()),'resident_set_changed');
    // Validate all receipts and identities before applying any part of this step.
    const meals:Array<{residentId:string;meal:Meal}>=[],newIds=new Set<string>();
    for(const channel of MEAL_CHANNELS){
     for(const receipt of food[channel]??[]){
      fail(receipt.at>food.fromMinute&&receipt.at<=food.toMinute,'receipt_outside_step');
      const identity='eventId'in receipt?'event:'+receipt.eventId:'family:'+JSON.stringify([receipt.relocationId,receipt.rationNumber,receipt.memberIndex]);
      fail(!mealIds.has(identity)&&!newIds.has(identity),'duplicate_meal_receipt');newIds.add(identity);
      const residentId='residentId'in receipt?receipt.residentId:receipt.beneficiaryId;
      const amounts='nutrition'in receipt?[{item:receipt.item,nutrition:receipt.nutrition}]:receipt.inputs;
      const edible=amounts.filter(a=>goods[a.item].food>0);
      const nutrition=edible.some(a=>a.nutrition===null)?null:edible.reduce((sum,a)=>sum+a.nutrition!,0);
      fail(nutrition===null||Number.isFinite(nutrition),'meal_nutrition_overflow');
      if(people.has(residentId))meals.push({residentId,meal:{at:receipt.at,channel,identity,nutrition,hungerRelief:receipt.hungerRelief}});
     }
    }
    for(const id of newIds)mealIds.add(id);
    for(const {residentId,meal}of meals)people.get(residentId)!.meals.push(meal);
    for(const p of snapshot.people){
     const row=people.get(p.id)!;row.sampledMinutes+=dt;
     if(row.final.status==='dead'&&p.status!=='dead')add({gate:'coverage',code:'resident_resurrected',residentId:p.id,at:snapshot.at});
     if(p.health<row.minimumHealth){row.minimumHealth=p.health;row.minimumHealthAt=snapshot.at;}
     row.maximumHealth=Math.max(row.maximumHealth,p.health);
     if(row.maximumHealth-p.health>row.maximumHealthDrawdown){row.maximumHealthDrawdown=row.maximumHealth-p.health;row.maximumHealthDrawdownAt=snapshot.at;}
     row.maximumHunger=Math.max(row.maximumHunger,p.hunger);
     // Include the sampled interval in which death was first observed, but do
     // not treat an already dead resident's frozen hunger as further exposure.
     const livingInterval=row.final.status==='alive';
     if(livingInterval&&p.hunger>SURVIVAL_CONTRACT.dangerousHungerAbove)row.dangerousHungerMinutes+=dt;
     if(livingInterval&&p.hunger>=SURVIVAL_CONTRACT.sustainedHungerAt){
      row.sustainedHungerMinutes+=dt;
      row.activeHunger??={fromMinute:food.fromMinute,throughMinute:snapshot.at,minutes:0};
      row.activeHunger.throughMinute=snapshot.at;row.activeHunger.minutes+=dt;
      row.longestSustainedHungerMinutes=Math.max(row.longestSustainedHungerMinutes,row.activeHunger.minutes);
     }else if(row.activeHunger){row.hungerEpisodes.push(row.activeHunger);row.activeHunger=null;}
     if(p.status==='dead'&&row.firstDeathAt===null)row.firstDeathAt=snapshot.at;
     for(const channel of MEAL_CHANNELS)if(Array.isArray(food[channel]))row.coverage[channel]+=dt;
     if(p.hungerPerMinute!==SURVIVAL_CONTRACT.hungerPerMinute
      &&!failures.some(f=>f.code==='unsupported_or_unknown_physiology'&&f.residentId===p.id))
      add({gate:'coverage',code:'unsupported_or_unknown_physiology',residentId:p.id,at:snapshot.at});
     row.final=p;
    }
    last=snapshot.at;steps++;
   }catch(error){invalid=true;add({gate:'coverage',code:'invalid_evidence',actual:error instanceof Error?error.message:String(error)});}
  },
  finish(){
   if(!header)add({gate:'coverage',code:'missing_header'});
   if(!closed)add({gate:'coverage',code:'missing_close'});
   const duration=header?header.endMinute-header.fromMinute:0,observed=header&&last!==null?last-header.fromMinute:0;
   if(duration!==SURVIVAL_CONTRACT.days*SURVIVAL_CONTRACT.dayMinutes)add({gate:'coverage',code:'fifteen_days_required',actual:duration,limit:SURVIVAL_CONTRACT.days*SURVIVAL_CONTRACT.dayMinutes});
   if(last!==header?.endMinute)add({gate:'coverage',code:'endpoint_not_reached',actual:last??'unknown'});
   if(closed?.exception)add({gate:'coverage',code:'run_exception',actual:closed.exception});
   const actionKeys=['exactEndpoint','defaultNine','allNineAte','allNineSlept','share','heardAddressVisit','plant','water','harvest','saveSeed','replant'];
   const supportKeys=['giftOffered','giftAccepted','giftDelivered','giftNextEatLinked','commonsInspected','commonsTaken','explorationBackoffUsed'];
   for(const [kind,keys,map]of [['action',actionKeys,closed?.actionCoverage],['support',supportKeys,closed?.supportCoverage]] as const)
    for(const key of keys)if(map?.[key]!==true)add({gate:'coverage',code:`${kind}_not_covered:${key}`});
   if(closed?.reloaded!==true)add({gate:'coverage',code:'reload_not_covered'});
   const residents=[...people.values()].map(row=>{
    const id=row.id,complete=!invalid&&header!==null&&close(row.sampledMinutes,duration)&&last===header.endMinute;
    if(!complete)add({gate:'coverage',code:'resident_samples_incomplete',residentId:id,actual:row.sampledMinutes,limit:duration});
    for(const channel of MEAL_CHANNELS)if(!close(row.coverage[channel],duration))add({gate:'coverage',code:`meal_channel_incomplete:${channel}`,residentId:id,actual:row.coverage[channel],limit:duration});
    if(row.initial.hungerPerMinute!==SURVIVAL_CONTRACT.hungerPerMinute)add({gate:'coverage',code:'unsupported_or_unknown_initial_physiology',residentId:id});
    if(row.firstDeathAt!==null||row.final.status!=='alive')add({gate:'survival',code:'resident_not_surviving',residentId:id,at:row.firstDeathAt??undefined});
    if(row.minimumHealth<SURVIVAL_CONTRACT.minimumHealth)add({gate:'health',code:'health_below_floor',residentId:id,at:row.minimumHealthAt,actual:row.minimumHealth,limit:SURVIVAL_CONTRACT.minimumHealth});
    if(row.maximumHealthDrawdown>SURVIVAL_CONTRACT.maximumHealthDrawdown)add({gate:'health',code:'health_drawdown',residentId:id,at:row.maximumHealthDrawdownAt,actual:row.maximumHealthDrawdown,limit:SURVIVAL_CONTRACT.maximumHealthDrawdown});
    if(row.dangerousHungerMinutes>SURVIVAL_CONTRACT.maximumDangerousHungerMinutes)add({gate:'hunger',code:'dangerous_hunger_exposure',residentId:id,actual:row.dangerousHungerMinutes,limit:0});
    if(row.longestSustainedHungerMinutes>SURVIVAL_CONTRACT.maximumSustainedHungerMinutes)add({gate:'hunger',code:'sustained_hunger',residentId:id,actual:row.longestSustainedHungerMinutes,limit:SURVIVAL_CONTRACT.maximumSustainedHungerMinutes});
    const sorted=[...row.meals].sort((a,b)=>a.at-b.at),positive=sorted.filter(m=>m.nutrition!==null&&m.nutrition>0);
    const times=[header!.fromMinute,...positive.map(m=>m.at),last!];
    let maximumMealGap=0,gapFrom=times[0],gapThrough=times[0];
    for(let i=1;i<times.length;i++)if(times[i]-times[i-1]>maximumMealGap){maximumMealGap=times[i]-times[i-1];gapFrom=times[i-1];gapThrough=times[i];}
    const nutritionSum=sorted.reduce((sum,m)=>sum+(m.nutrition??0),0);
    const nutritionKnown=sorted.every(m=>m.nutrition!==null)&&Number.isFinite(nutritionSum),observedNutrition=nutritionKnown?nutritionSum:null;
    if(!Number.isFinite(nutritionSum))add({gate:'food',code:'nutrition_overflow',residentId:id});
    const intakeComplete=complete&&MEAL_CHANNELS.every(c=>close(row.coverage[c],duration))&&nutritionKnown;
    const nutrition=intakeComplete?observedNutrition:null,demand=duration*SURVIVAL_CONTRACT.hungerPerMinute;
    const tailFrom=header!.endMinute-SURVIVAL_CONTRACT.terminalNutritionWindowMinutes;
    const tailNutrition=intakeComplete&&tailFrom>=header!.fromMinute?sorted.filter(m=>m.at>tailFrom&&m.at<=header!.endMinute).reduce((sum,m)=>sum+m.nutrition!,0):null;
    const tailDemand=SURVIVAL_CONTRACT.terminalNutritionWindowMinutes*SURVIVAL_CONTRACT.hungerPerMinute;
    if(!intakeComplete)add({gate:'food',code:'intake_unknown',residentId:id});
    if(intakeComplete&&maximumMealGap>SURVIVAL_CONTRACT.maximumMealGapMinutes)add({gate:'food',code:'meal_gap',residentId:id,at:gapThrough,actual:maximumMealGap,limit:SURVIVAL_CONTRACT.maximumMealGapMinutes});
    if(nutrition!==null&&nutrition+1e-8<demand)add({gate:'food',code:'nutrition_below_demand',residentId:id,actual:nutrition,limit:demand});
    if(tailNutrition===null)add({gate:'food',code:'terminal_nutrition_unknown',residentId:id});
    else if(tailNutrition+1e-8<tailDemand)add({gate:'food',code:'terminal_nutrition_below_demand',residentId:id,actual:tailNutrition,limit:tailDemand});
    const {activeHunger,...reported}=row;
    return {...structuredClone(reported),hungerEpisodes:structuredClone([...row.hungerEpisodes,...(activeHunger?[activeHunger]:[])]),
     dangerousHungerMinutes:complete?row.dangerousHungerMinutes:null,observedDangerousHungerMinutes:row.dangerousHungerMinutes,
     sustainedHungerMinutes:complete?row.sustainedHungerMinutes:null,observedSustainedHungerMinutes:row.sustainedHungerMinutes,
     longestSustainedHungerMinutes:complete?row.longestSustainedHungerMinutes:null,observedLongestSustainedHungerMinutes:row.longestSustainedHungerMinutes,
     sampleCoverage:complete?'complete':'incomplete',netHealthChange:row.final.health-row.initial.health,
     food:{observedNutrition,nutrition,nutritionDemand:demand,ratio:nutrition===null?null:nutrition/demand,
      terminalFromMinute:tailFrom,terminalNutrition:tailNutrition,terminalDemand:tailDemand,
      maximumMealGapMinutes:intakeComplete?maximumMealGap:null,observedMaximumMealGapMinutes:maximumMealGap,gapFromMinute:gapFrom,gapThroughMinute:gapThrough},
     failures:failures.filter(f=>f.residentId===id)};
   });
   // Behavioral coverage is independent of measured health/intake. A missing
   // commons action must not relabel nine fully observed living residents dead.
   const stateEvidenceComplete=!invalid&&!!header&&!!closed&&duration===SURVIVAL_CONTRACT.days*SURVIVAL_CONTRACT.dayMinutes
    &&residents.length===9&&residents.every(p=>p.sampleCoverage==='complete')&&!failures.some(f=>f.code==='resident_resurrected');
   const intakeEvidenceComplete=stateEvidenceComplete&&residents.every(p=>p.food.nutrition!==null&&p.food.terminalNutrition!==null)
    &&!failures.some(f=>f.code==='unsupported_or_unknown_physiology'||f.code==='unsupported_or_unknown_initial_physiology');
   const gates=Object.fromEntries(['coverage','survival','health','hunger','food'].map(gate=>[gate,
    !failures.some(f=>f.gate===gate)&&residents.length===9&&(gate==='coverage'||(gate==='food'?intakeEvidenceComplete:stateEvidenceComplete))]));
   return {schema:1,evaluatorRevision:2,contract:SURVIVAL_CONTRACT,executionKind:'offline-scripted-survival-verdict',realModelExecuted:false,modelAutonomyAcceptancePassed:null,
    syntheticLongTermSurvivalPassed:Object.values(gates).every(Boolean),gates,fromMinute:header?.fromMinute??null,throughMinute:last,endMinute:header?.endMinute??null,
    stateEvidenceComplete,intakeEvidenceComplete,observedMinutes:observed,steps,residents,failures,
    completeFoodLedger:false,grossHealthDamage:null,
    limitations:['Synthetic numbered-menu policy only; not real model or 1.0 release acceptance.',
     'Health and hunger are post-engine-step samples, at most one game minute apart; not continuous extrema or a gross-damage ledger.',
     'Food measures eight observed meal channels by actual beneficiary. Inventory, gifts, production and transfers are not intake.',
     'Nutrition sufficiency is a frozen engineering gate, not proof of future supply, accessibility, autonomy or complete food accounting.',
     'Coverage flags attest the original runner checks; hashes detect mismatch, not forged evidence.']};
  }
 };
}
export function evaluateSurvivalRecords(records:Iterable<SurvivalRecord>){const evaluator=createSurvivalEvaluator();for(const row of records)evaluator.accept(row);return evaluator.finish();}

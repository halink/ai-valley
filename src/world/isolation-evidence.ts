import {recordPrototypeFlow,type PrototypeFlowHistory,array,checkedFoodFlow,checkedFoodTransfer,foodTransferKey,checkedFoodEvent,checkedFoodOwnership,foodOwnershipKey} from '../server/acceptance-evidence-schema.js';
import {FOOD_FLOW_COVERAGE,FOOD_LOSS_COVERAGE,FOOD_TRANSFER_COVERAGE,FOOD_OWNERSHIP_COVERAGE} from './food-consumption-evidence.js';
import type {Inventory,Item,Resident,World} from '../shared/types.js';
import type {DecisionProtection} from '../shared/decision-protection.js';
import {settlementFoodCoverage} from './food-coverage.js';
import {DAY} from './time.js';
import type {DirectEatingObservation,DirectEatingReceipt,FoodFlowReceipt,FoodLossReceipt,FoodTransferReceipt,FoodOwnershipReceipt,FoodOwnershipAmount,FoodFlowAmount,CareMealReceipt,ChildCareMealReceipt,EmergencyCareMealReceipt,LongCareMealReceipt,PublicDutyMealReceipt,JourneyMealReceipt,FamilyJourneyMealReceipt} from './food-consumption-evidence.js';

/** Endpoint stock equivalents and individual access are deliberately separate. */
export function isolationSnapshot(w:World){
 const food=settlementFoodCoverage(w);
 return {minute:w.minute,population:{alive:w.residents.filter(r=>r.status==='alive').length,
  localResidents:w.residents.filter(r=>r.status==='alive'&&r.residency==='resident').length,
  visitors:w.residents.filter(r=>r.status==='alive'&&r.residency==='visitor').length,
  outside:w.residents.filter(r=>r.status==='alive'&&r.residency==='outside').length,
  dead:w.residents.filter(r=>r.status==='dead').length},
  food:{uniqueReachableStockNutrition:food.uniqueNutrition,collectiveStockDays:food.stockDays,
   personal:food.residents.map(r=>({residentId:r.residentId,usableDays:r.days,lowFood:r.lowFood,needsCare:r.needsCare,unknownExpiry:r.unknownExpiry,accessBlocked:r.accessBlocked??null,sourceLabel:r.sourceLabel,collectionMinutes:r.collectionMinutes,dailyNeed:r.dailyNeed,carriedNutrition:r.carriedNutrition,reachableNutrition:r.reachableNutrition,usableNutrition:r.usableNutrition}))}};
}
/** Detach every slice as strict plain data before any collector state changes.
 * Historical daily slices retain their own existing semantic validators. */
function cloneFoodData(input:unknown):unknown{
 if(input===null||typeof input!=='object'){
  if(input===null||['string','number','boolean','undefined'].includes(typeof input))return input;
  throw new Error('Invalid food observation data');
 }
 if(Array.isArray(input))return array(cloneFoodData)(input);
 if(![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new Error('Invalid food observation object');
 const result:Record<string,unknown>={};
 for(const key of Reflect.ownKeys(input)){
  const descriptor=Object.getOwnPropertyDescriptor(input,key)!;
  if(typeof key!=='string'||!('value'in descriptor))throw new Error('Invalid food observation accessor');
  Object.defineProperty(result,key,{value:cloneFoodData(descriptor.value),enumerable:true,writable:true,configurable:true});
 }
 return result;
}
function cloneDirectEatingObservation(input:unknown):DirectEatingObservation{
 const observation=cloneFoodData(input) as DirectEatingObservation;
 const allowed=new Set(['worldId','fromMinute','toMinute','receipts','foodFlows','foodFlowCoverage','foodLosses','foodLossCoverage','foodTransfers','foodTransferCoverage','foodOwnershipChanges','foodOwnershipCoverage','careMeals','childCareMeals','emergencyCareMeals','journeyMeals','familyJourneyMeals','longCareMeals','publicDutyMeals']);
 if(!observation||typeof observation!=='object'||Array.isArray(observation)||Object.keys(observation).some(key=>!allowed.has(key)))throw new Error('Invalid food observation schema');
 return observation;
}
/** Strict current receipt schemas for callers that already require them.
 * The temporary runtime envelope is never emitted or persisted. */
export function checkedDirectEatingObservation(input:unknown):DirectEatingObservation{
 const observation=cloneDirectEatingObservation(input);
 const event=checkedFoodEvent({...observation,schema:1,sessionId:'isolated-observation',sequence:1,type:'food_step_committed',revision:0});
 if(event.type!=='food_step_committed')throw new Error('Invalid food observation schema');
 const {schema,sessionId,sequence,type,revision,...checked}=event;
 return checked as DirectEatingObservation;
}
const ownershipTotals=()=>({units:{} as Partial<Record<Item,number|null>>,nutrition:null,completedActions:0});
function addOwnershipAmounts(total:ReturnType<typeof ownershipTotals>,amounts:FoodOwnershipAmount[]){
 for(const amount of amounts){
  const prior=Object.hasOwn(total.units,amount.item)?total.units[amount.item]!:0;
  const next=prior===null||amount.quantity===null?null:prior+amount.quantity;
  total.units[amount.item]=next===null||!Number.isFinite(next)?null:next;
 }
}
const unavailable=()=>({value:null,reason:'No complete quantity ledger exists; action counts and stock deltas are not totals.'});
const flowAmountTotals=()=>({units:{} as Inventory,nutrition:0 as number|null});
const transferTotals=()=>({...flowAmountTotals(),completedActions:0});
const flowTotals=()=>({sourceAdded:flowAmountTotals(),processingInputs:flowAmountTotals(),processingOutputs:flowAmountTotals()});
const careTotals=()=>({...flowAmountTotals(),hungerRelief:0,completedActions:0});
const longCareTotals=()=>({...careTotals(),healthGain:0});
const publicDutyTotals=()=>({...longCareTotals(),wages:0,sources:{personal:{...flowAmountTotals(),completedActions:0},public:{...flowAmountTotals(),completedActions:0}}});
function addFlowAmounts(total:ReturnType<typeof flowAmountTotals>,amounts:FoodFlowAmount[]){
 for(const a of amounts){total.units[a.item]=(total.units[a.item]??0)+a.quantity;
  total.nutrition=total.nutrition===null||a.nutrition===null?null:total.nutrition+a.nutrition;}
}
function bucket(snapshot:ReturnType<typeof isolationSnapshot>){return {isolated:true,controller:'deterministic-local',calendarDay:Math.floor(snapshot.minute/DAY),
 interval:'(fromMinute, toMinute] end-of-minute observations',fromMinute:snapshot.minute,toMinute:snapshot.minute,sampledMinutes:0,
 start:snapshot,end:snapshot,
 completedActions:{} as Record<string,number>,observedSamples:{chosenWait:0,idleDecisionDue:0,activeProtection:0},
 spoiledUnits:{} as Inventory,protectionRecorded:{prevented:{hunger:0,exhaustion:0},losses:{hunger:0,exhaustion:0,illnessOrInjury:0,hazard:0}},
 grossHealthDamage:{value:null,reason:'No complete damage ledger exists; net health change cannot identify gross damage.'},foodProduction:unavailable(),foodConsumption:unavailable(),
 directEating:{scope:'Completed engine eat actions only; excludes care, outside journeys, cooking inputs and all other consumption.',
  observedMinutes:0,unobservedMinutes:0,
  totals:null as null|{units:Inventory;nutrition:number;hungerRelief:number;completedActions:number},
  receipts:[] as DirectEatingReceipt[]},
 foodFlows:{scope:'Successful berry gather, field harvest, harvest_house, custody_harvest, fish, hunt, fruit growth, animal food products, ordinary cook, food-related industry_craft completed employment_processing, saveSeed and prototype_trial phases only. Prototype inputs debit only at start; terminal outcomes do not repeat that debit. Seed outputs are nonfood physical quantities with zero nutrition; plantCrop remains excluded. Employment reservations and refunds remain excluded. Source additions and gross processing inputs/outputs stay separate; not net food production.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof flowTotals>|null,receipts:[] as FoodFlowReceipt[]},
 foodTransfers:{scope:'Completed outsideAid collection and foreign trade reservation, collection and estate custody only. Physical transfers are neither intake nor source additions; not a complete transfer ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof transferTotals>|null,receipts:[] as FoodTransferReceipt[]},
 foodOwnershipChanges:{scope:'Successful production inherit ownership changes of existing estate parcel, orchard and animal food stock only. No physical transfer, source production or intake. Original lots and nutrition are unknown; not a complete ownership or food ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof ownershipTotals>|null,receipts:[] as FoodOwnershipReceipt[]},
 foodLosses:{scope:'Actual advanceFood physical spoilage removals only; excludes transfers, initialization, aggregate public balances, livestock death and all other losses. Not a complete loss ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof flowAmountTotals>|null,receipts:[] as FoodLossReceipt[]},
 careMeals:{scope:'Successful ordinary care only; original provider meal and companion water debits, named beneficiary and actual hunger change. Excludes long care and all other consumption; not a complete consumption ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof careTotals>|null,receipts:[] as CareMealReceipt[]},
 childCareMeals:{scope:'Successful guardian tendChild only; provider personal meal or turnip and personal water debits, named child and actual hunger change. Not vessel water, ordinary care, emergencyCare, or a complete consumption ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof careTotals>|null,receipts:[] as ChildCareMealReceipt[]},
 emergencyCareMeals:{scope:'Successful emergencyCare feed/rescueMeal only; provider personal meal or turnip and water debits, named child and actual hunger change. Not offers, reservations, ordinary care, tendChild or a complete consumption ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof careTotals>|null,receipts:[] as EmergencyCareMealReceipt[]},
 journeyMeals:{scope:'Successful self-carried visitorJourney eat and visitorAid eatMail only. Original-lot nutrition and actual hunger relief stay separate; excludes family relocation, transfers and all other consumption. Not a complete consumption ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof careTotals>|null,receipts:[] as JourneyMealReceipt[]},
 familyJourneyMeals:{scope:'Actual per-member family relocation ration debits only; each signed provider portion is counted once. Companion water has zero food nutrition. Reservations, transfers, arrival registration and other consumption are excluded. Not a complete consumption ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof careTotals>|null,receipts:[] as FamilyJourneyMealReceipt[]},
 longCareMeals:{scope:'Successful signed longCare visit only; actual provider personal inputs, original-lot nutrition, beneficiary hunger and health changes stay separate. Not ordinary care, tendChild, emergencyCare or a complete consumption or health ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof longCareTotals>|null,receipts:[] as LongCareMealReceipt[]},
 publicDutyMeals:{scope:'Successful publicDuty receive only; personal or authorized physical public store inputs counted once, companion water, original-lot nutrition, beneficiary hunger/health effects and actual wages kept separate. Treasury stock is an aggregate, not a second source. Not complete feeding or a consumption ledger.',
  observedMinutes:0,unobservedMinutes:0,totals:null as ReturnType<typeof publicDutyTotals>|null,receipts:[] as PublicDutyMealReceipt[]},
 technicalOrModelWaitMinutes:{value:null,reason:'The isolated engine has no runtime/model queue telemetry.'}};}
export type IsolationDailyEvidence=ReturnType<typeof bucket>;
const actionKey=(r:Resident,a:NonNullable<Resident['recentActions']>[number])=>JSON.stringify([r.id,a.at,a.type]);

/** External accumulator only. No world initialization, repair, plan selection or persistence.
 * Requires every game minute; duplicates are no-ops and gaps/reversal are rejected.
 * Caller must retain emitted rows. Memory retains only current-day receipts,
 * residents and recently retained actions; transfer event/delivery IDs persist
 * across days to reject replay without retaining the entire receipt history.
 */
export function createIsolationEvidence(w:World){
 let lastMinute=w.minute,row=bucket(isolationSnapshot(w)),spoiled={...w.food?.spoiled};
 let seenActions=new Set(w.residents.flatMap(r=>(r.recentActions??[]).map(a=>actionKey(r,a))));
 const prototypeTrials:PrototypeFlowHistory=new Map(),prototypeEvents=new Set<string>();
 const custodyWork=new Set<string>(),seedEvents=new Set<string>();
 const transferEvents=new Set<string>(),transferDeliveries=new Set<string>(),observedEventIds=new Set<string>();
 const ownershipEvents=new Set<string>(),ownershipShares=new Set<string>();
 let lastEventId=w.events.at(-1)?.id;
 const protection=new Map<string,{startedAt:number;state:DecisionProtection}>();
 for(const r of w.residents)if(r.decisionProtection)protection.set(r.id,{startedAt:r.decisionProtection.startedAt,state:structuredClone(r.decisionProtection)});
 function recordProtection(id:string,state:DecisionProtection){
  const prior=protection.get(id),old=prior?.startedAt===state.startedAt?prior.state:undefined;
  // Event snapshots may precede the current record; counters only move forward.
  if(prior&&prior.startedAt>state.startedAt)return;
  const next=structuredClone(state);
  for(const group of ['prevented','losses'] as const)for(const key of Object.keys(state[group])){
   const value=state[group][key as keyof typeof state[typeof group]];
   const before=old?.[group][key as keyof typeof state[typeof group]]??0;
   const target=row.protectionRecorded[group] as Record<string,number>;
   target[key]+=Math.max(0,value-before);
   (next[group] as Record<string,number>)[key]=Math.max(value,before);
  }
  protection.set(id,{startedAt:state.startedAt,state:next});
 }
 return {
  sample(world:World,eating?:DirectEatingObservation):IsolationDailyEvidence|null {
   if(world.minute===lastMinute)return null;
   if(eating!==undefined)eating=cloneDirectEatingObservation(eating);
   // Validate the plain-data slice before reading any receipt fields or mutating state.
   const flowDescriptor=eating&&Object.getOwnPropertyDescriptor(eating,'foodFlows');
   if(flowDescriptor&&!('value'in flowDescriptor))throw new Error('Invalid food flow accessor');
   const flows=flowDescriptor?.value===undefined?undefined:array(input=>{
    if(!input||typeof input!=='object')throw new Error('Invalid food flow');
    const action=Object.getOwnPropertyDescriptor(input,'action');
    if(!action||!('value'in action))throw new Error('Invalid food flow action');
    return ['saveSeed','harvest_house','custody_harvest','prototype_trial'].includes(action.value)?checkedFoodFlow(input):input;
   })(flowDescriptor.value) as FoodFlowReceipt[];
   if(world.minute!==lastMinute+1)throw new Error('Isolation evidence requires consecutive one-minute samples.');
   if(eating&&(eating.worldId!==world.id||eating.fromMinute!==lastMinute||eating.toMinute!==world.minute
    ||eating.receipts.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||flows?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.foodLosses?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.careMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.childCareMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.emergencyCareMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.journeyMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.familyJourneyMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.publicDutyMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)
    ||eating.longCareMeals?.some(r=>r.at<=lastMinute||r.at>world.minute)))throw new Error('Direct eating evidence does not cover this world and minute.');
   // Validate the complete optional slice before any cursor, bucket or ID changes.
   const transferDescriptor=eating&&Object.getOwnPropertyDescriptor(eating,'foodTransfers');
   const coverageDescriptor=eating&&Object.getOwnPropertyDescriptor(eating,'foodTransferCoverage');
   if(transferDescriptor&&!('value'in transferDescriptor)||coverageDescriptor&&!('value'in coverageDescriptor))throw new Error('Invalid food transfer evidence accessor');
   const coverage=coverageDescriptor?.value;
   if(coverage!==undefined&&coverage!==FOOD_TRANSFER_COVERAGE&&coverage!=='outside_aid_collect_v1')throw new Error('Invalid food transfer coverage');
   if(coverage!==undefined&&!Array.isArray(transferDescriptor?.value))throw new Error('Food transfer coverage requires an array');
   const transfers=transferDescriptor?.value===undefined?undefined:array(checkedFoodTransfer)(transferDescriptor.value) as FoodTransferReceipt[];
   const nextPrototypeTrials:PrototypeFlowHistory=new Map(prototypeTrials),nextPrototypeEvents=new Set<string>();
   for(const flow of flows??[])if(flow.action==='prototype_trial'){
    if(observedEventIds.has(flow.eventId)||nextPrototypeEvents.has(flow.eventId))throw new Error('Duplicate prototype event');
    recordPrototypeFlow(nextPrototypeTrials,flow);nextPrototypeEvents.add(flow.eventId);
   }
   const nextCustodyWork=new Set<string>(),nextSeedEvents=new Set<string>();
   for(const flow of flows??[])if(flow.action==='saveSeed'){
    if(observedEventIds.has(flow.eventId)||nextSeedEvents.has(flow.eventId))throw new Error('Duplicate seed completion event');
    nextSeedEvents.add(flow.eventId);
   }
   for(const flow of flows??[])if(flow.action==='harvest_house'||flow.action==='custody_harvest'){
    checkedFoodFlow(flow);
    if(flow.action==='custody_harvest'){
     const key=JSON.stringify([flow.custodyId,flow.workSerial]);
     if(custodyWork.has(key)||nextCustodyWork.has(key))throw new Error('Duplicate custody harvest work');
     nextCustodyWork.add(key);
    }
   }
   const nextEvents=new Set<string>(),nextDeliveries=new Set<string>(),nextOwnershipEvents=new Set<string>(),nextShares=new Set<string>();
   // New ownership evidence always has strict schema/coverage, even alongside
   // old slices whose historical daily compatibility remains unchanged.
   const ownershipDescriptor=eating&&Object.getOwnPropertyDescriptor(eating,'foodOwnershipChanges');
   const ownershipCoverageDescriptor=eating&&Object.getOwnPropertyDescriptor(eating,'foodOwnershipCoverage');
   if(ownershipCoverageDescriptor&&(ownershipCoverageDescriptor.value!==FOOD_OWNERSHIP_COVERAGE||!Array.isArray(ownershipDescriptor?.value)))throw new Error('Invalid food ownership coverage');
   const ownership=ownershipDescriptor?array(checkedFoodOwnership)(ownershipDescriptor.value) as FoodOwnershipReceipt[]:undefined;
   const otherEvents=new Set<string>();
   for(const key of ['receipts','foodFlows','foodLosses','careMeals','childCareMeals','emergencyCareMeals','journeyMeals','familyJourneyMeals','publicDutyMeals','longCareMeals'] as const){
    for(const r of (key==='foodFlows'?flows:eating?.[key])??[]){
     const eventId=Object.getOwnPropertyDescriptor(r,'eventId')?.value;
     if(typeof eventId==='string'){
      if(prototypeEvents.has(eventId)||nextPrototypeEvents.has(eventId)&&otherEvents.has(eventId))throw new Error('Duplicate prototype event');
      if(seedEvents.has(eventId)||nextSeedEvents.has(eventId)&&otherEvents.has(eventId))throw new Error('Duplicate seed completion event');
      if(ownershipEvents.has(eventId))throw new Error('Duplicate food ownership event');
      if(transferEvents.has(eventId))throw new Error('Duplicate food transfer event');
      otherEvents.add(eventId);
     }
    }
   }
   for(const r of transfers??[]){
    if(r.at<=lastMinute||r.at>world.minute)throw new Error('Food transfer evidence does not cover this world and minute.');
    const key=foodTransferKey(r);
    if(r.eventId!==null&&(observedEventIds.has(r.eventId)||otherEvents.has(r.eventId)||nextEvents.has(r.eventId))||transferDeliveries.has(key)||nextDeliveries.has(key))throw new Error('Duplicate food transfer');
    if(r.eventId!==null)nextEvents.add(r.eventId);nextDeliveries.add(key);
   }
   for(const receipt of ownership??[]){
    checkedFoodOwnership(receipt);
    if(receipt.at<=lastMinute||receipt.at>world.minute)throw new Error('Food ownership evidence does not cover this world and minute.');
    const key=foodOwnershipKey(receipt);
    if(observedEventIds.has(receipt.eventId)||otherEvents.has(receipt.eventId)||nextEvents.has(receipt.eventId)||nextOwnershipEvents.has(receipt.eventId)||ownershipShares.has(key)||nextShares.has(key))throw new Error('Duplicate food ownership');
    nextOwnershipEvents.add(receipt.eventId);nextShares.add(key);
   }
   for(const item of Object.keys(spoiled) as (keyof Inventory)[])if((world.food?.spoiled[item]??0)-(spoiled[item]??0)<0)throw new Error('Spoilage counter reset during isolated observation.');
   // A boundary closes the preceding day; the next sample opens a fresh bucket.
   if(row.toMinute%DAY===0&&row.sampledMinutes>0)row=bucket(row.end);
   row.toMinute=world.minute;row.sampledMinutes++;
   if(eating){
    row.directEating.observedMinutes++;
    row.directEating.receipts.push(...structuredClone(eating.receipts));
    if(!row.directEating.unobservedMinutes){
     const totals=row.directEating.totals??={units:{},nutrition:0,hungerRelief:0,completedActions:0};
     for(const r of eating.receipts){totals.units[r.item]=(totals.units[r.item]??0)+r.quantity;totals.nutrition+=r.nutrition;totals.hungerRelief+=r.hungerRelief;totals.completedActions++;}
    }
   }else{row.directEating.unobservedMinutes++;row.directEating.totals=null;}
   // Old collectors may have genuine berry/harvest/cook facts but no proof that
   // the latest prototype trial slice was observed. Keep facts without inventing coverage.
   if(flows)row.foodFlows.receipts.push(...structuredClone(flows));
   if(flows&&eating?.foodFlowCoverage===FOOD_FLOW_COVERAGE){
    row.foodFlows.observedMinutes++;
    if(!row.foodFlows.unobservedMinutes){
     const totals=row.foodFlows.totals??=flowTotals();
     for(const flow of flows){
      if(flow.type==='source_added')addFlowAmounts(totals.sourceAdded,flow.outputs);
      else{addFlowAmounts(totals.processingInputs,flow.inputs);addFlowAmounts(totals.processingOutputs,flow.outputs);}
     }
    }
   }else{row.foodFlows.unobservedMinutes++;row.foodFlows.totals=null;}
   if(transfers)row.foodTransfers.receipts.push(...structuredClone(transfers));
   if(transfers&&coverage===FOOD_TRANSFER_COVERAGE){
    row.foodTransfers.observedMinutes++;
    if(!row.foodTransfers.unobservedMinutes){
     const totals=row.foodTransfers.totals??=transferTotals();
     for(const receipt of transfers){addFlowAmounts(totals,[receipt.amount]);totals.completedActions++;}
    }
   }else{row.foodTransfers.unobservedMinutes++;row.foodTransfers.totals=null;}
   if(ownership)row.foodOwnershipChanges.receipts.push(...ownership);
   if(ownership&&eating?.foodOwnershipCoverage===FOOD_OWNERSHIP_COVERAGE){
    row.foodOwnershipChanges.observedMinutes++;
    if(!row.foodOwnershipChanges.unobservedMinutes){
     const totals=row.foodOwnershipChanges.totals??=ownershipTotals();
     for(const receipt of ownership){for(const stock of receipt.stocks)addOwnershipAmounts(totals,stock.amounts);totals.completedActions++;}
    }
   }else{row.foodOwnershipChanges.unobservedMinutes++;row.foodOwnershipChanges.totals=null;}
   if(eating?.foodLosses)row.foodLosses.receipts.push(...structuredClone(eating.foodLosses));
   if(eating?.foodLosses&&eating.foodLossCoverage===FOOD_LOSS_COVERAGE){
    row.foodLosses.observedMinutes++;
    if(!row.foodLosses.unobservedMinutes){
     const totals=row.foodLosses.totals??=flowAmountTotals();
     for(const receipt of eating.foodLosses)addFlowAmounts(totals,[receipt.amount]);
    }
   }else{row.foodLosses.unobservedMinutes++;row.foodLosses.totals=null;}
   if(eating?.careMeals){
    row.careMeals.observedMinutes++;row.careMeals.receipts.push(...structuredClone(eating.careMeals));
    if(!row.careMeals.unobservedMinutes){
     const totals=row.careMeals.totals??=careTotals();
     for(const receipt of eating.careMeals){addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;}
    }
   }else{row.careMeals.unobservedMinutes++;row.careMeals.totals=null;}
   if(eating?.childCareMeals){
    row.childCareMeals.observedMinutes++;row.childCareMeals.receipts.push(...structuredClone(eating.childCareMeals));
    if(!row.childCareMeals.unobservedMinutes){
     const totals=row.childCareMeals.totals??=careTotals();
     for(const receipt of eating.childCareMeals){addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;}
    }
   }else{row.childCareMeals.unobservedMinutes++;row.childCareMeals.totals=null;}
   if(eating?.emergencyCareMeals){
    row.emergencyCareMeals.observedMinutes++;row.emergencyCareMeals.receipts.push(...structuredClone(eating.emergencyCareMeals));
    if(!row.emergencyCareMeals.unobservedMinutes){
     const totals=row.emergencyCareMeals.totals??=careTotals();
     for(const receipt of eating.emergencyCareMeals){addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;}
    }
   }else{row.emergencyCareMeals.unobservedMinutes++;row.emergencyCareMeals.totals=null;}
   if(eating?.journeyMeals){
    row.journeyMeals.observedMinutes++;row.journeyMeals.receipts.push(...structuredClone(eating.journeyMeals));
    if(!row.journeyMeals.unobservedMinutes){
     const totals=row.journeyMeals.totals??=careTotals();
     for(const receipt of eating.journeyMeals){addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;}
    }
   }else{row.journeyMeals.unobservedMinutes++;row.journeyMeals.totals=null;}
   if(eating?.familyJourneyMeals){
    row.familyJourneyMeals.observedMinutes++;row.familyJourneyMeals.receipts.push(...structuredClone(eating.familyJourneyMeals));
    if(!row.familyJourneyMeals.unobservedMinutes){
     const totals=row.familyJourneyMeals.totals??=careTotals();
     for(const receipt of eating.familyJourneyMeals){addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;}
    }
   }else{row.familyJourneyMeals.unobservedMinutes++;row.familyJourneyMeals.totals=null;}
   if(eating?.longCareMeals){
    row.longCareMeals.observedMinutes++;row.longCareMeals.receipts.push(...structuredClone(eating.longCareMeals));
    if(!row.longCareMeals.unobservedMinutes){
     const totals=row.longCareMeals.totals??=longCareTotals();
     for(const receipt of eating.longCareMeals){addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.healthGain+=receipt.healthGain;totals.completedActions++;}
    }
   }else{row.longCareMeals.unobservedMinutes++;row.longCareMeals.totals=null;}
   if(eating?.publicDutyMeals){
    row.publicDutyMeals.observedMinutes++;row.publicDutyMeals.receipts.push(...structuredClone(eating.publicDutyMeals));
    if(!row.publicDutyMeals.unobservedMinutes){
     const totals=row.publicDutyMeals.totals??=publicDutyTotals();
     for(const receipt of eating.publicDutyMeals){
      addFlowAmounts(totals,receipt.inputs);totals.hungerRelief+=receipt.hungerRelief;totals.healthGain+=receipt.healthGain;totals.completedActions++;
      const source=totals.sources[receipt.source];addFlowAmounts(source,receipt.inputs);source.completedActions++;
      totals.wages+=receipt.funding?receipt.funding.providerCoinsAfter-receipt.funding.providerCoinsBefore:0;
     }
    }
   }else{row.publicDutyMeals.unobservedMinutes++;row.publicDutyMeals.totals=null;}
   const retained=new Set<string>();
   for(const r of world.residents){
    for(const a of r.recentActions??[]){const key=actionKey(r,a);retained.add(key);if(!seenActions.has(key)&&a.at>lastMinute&&a.at<=world.minute)row.completedActions[a.type]=(row.completedActions[a.type]??0)+1;}
    if(r.status==='alive'){
     if(r.activity?.action.type==='wait')row.observedSamples.chosenWait++;
     if(!r.plan&&!r.activity&&r.canDecide&&r.canExpress&&r.decisionDue<=world.minute)row.observedSamples.idleDecisionDue++;
     if(r.decisionProtection?.endedAt===null&&r.decisionProtection.expiresAt>world.minute)row.observedSamples.activeProtection++;
    }
   }
   seenActions=retained;
   // Events are append-only in the engine. Scan only the newly appended suffix.
   let first=world.events.length;
   while(first>0&&world.events[first-1].id!==lastEventId)first--;
   for(let i=first;i<world.events.length;i++){const e=world.events[i];if(e.at>lastMinute&&e.at<=world.minute&&e.decisionProtection&&e.actors[0])recordProtection(e.actors[0],e.decisionProtection.state);}
   lastEventId=world.events.at(-1)?.id;
   for(const r of world.residents)if(r.decisionProtection)recordProtection(r.id,r.decisionProtection);
   for(const item of new Set([...Object.keys(spoiled),...Object.keys(world.food?.spoiled??{})])){
    const key=item as keyof Inventory,delta=(world.food?.spoiled[key]??0)-(spoiled[key]??0);
    if(delta<0)throw new Error('Spoilage counter reset during isolated observation.');
    if(delta)row.spoiledUnits[key]=(row.spoiledUnits[key]??0)+delta;
   }
   for(const [key,value]of nextPrototypeTrials)prototypeTrials.set(key,value);
   for(const id of nextPrototypeEvents)prototypeEvents.add(id);
   for(const id of nextSeedEvents)seedEvents.add(id);
   for(const id of otherEvents)observedEventIds.add(id);
   for(const id of nextEvents){transferEvents.add(id);observedEventIds.add(id);}for(const id of nextDeliveries)transferDeliveries.add(id);
   for(const key of nextCustodyWork)custodyWork.add(key);
   for(const id of nextOwnershipEvents){ownershipEvents.add(id);observedEventIds.add(id);}for(const key of nextShares)ownershipShares.add(key);
   spoiled={...world.food?.spoiled};lastMinute=world.minute;
   if(world.minute%DAY===0){row.end=isolationSnapshot(world);return structuredClone(row);}
   return null;
  },
  finish(world:World):IsolationDailyEvidence|null {
   if(world.minute!==lastMinute)throw new Error('Sample the final minute before finishing evidence.');
   if(!row.sampledMinutes||row.toMinute%DAY===0)return null;
   row.end=isolationSnapshot(world);return structuredClone(row);
  }
 };
}


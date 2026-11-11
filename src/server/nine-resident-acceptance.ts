import {auditFoodOwnershipChanges} from './food-ownership-evidence.js';
export {auditFoodOwnershipChanges,observedFoodOwnershipChangesByDay} from './food-ownership-evidence.js';
import {auditFoodTransfers} from './food-transfer-evidence.js';
export {auditFoodTransfers,observedFoodTransfersByDay} from './food-transfer-evidence.js';
import {auditEmergencyCareMeals} from './emergency-care-meal-evidence.js';
export {observedEmergencyCareMealsByDay} from './emergency-care-meal-evidence.js';
import {auditPublicDutyMeals} from './public-duty-meal-evidence.js';
export {observedPublicDutyMealsByDay} from './public-duty-meal-evidence.js';
import {auditFamilyJourneyMeals} from './family-journey-meal-evidence.js';
export {auditFamilyJourneyMeals,observedFamilyJourneyMealsByDay} from './family-journey-meal-evidence.js';
import {auditJourneyMeals} from './journey-meal-evidence.js';
export {observedJourneyMealsByDay} from './journey-meal-evidence.js';
import {FOOD_FLOW_COVERAGE,FOOD_LOSS_COVERAGE} from '../world/food-consumption-evidence.js';
import {auditLongCareMeals} from './long-care-meal-evidence.js';
export {observedLongCareMealsByDay} from './long-care-meal-evidence.js';
import {checkedFoodFlow,checkedFoodLoss,recordPrototypeFlow,type PrototypeFlowHistory} from './acceptance-evidence-schema.js';
import {auditCareMeals} from './care-meal-evidence.js';
import {auditChildCareMeals} from './child-care-meal-evidence.js';
export {observedChildCareMealsByDay} from './child-care-meal-evidence.js';
export {observedCareMealsByDay} from './care-meal-evidence.js';
import type {FoodLossReceipt,FoodFlowAmount,FoodFlowReceipt} from '../world/food-consumption-evidence.js';
import {createHash} from 'node:crypto';
import {createFrontierWorld} from '../world/formal-seed.js';
import {goods} from '../shared/items.js';
import {DAY} from '../world/time.js';
import {VALLEY_VERSION} from '../shared/version.js';
import {QWEN_MODEL,DEEPSEEK_MODEL,modelLimits} from './model-completion.js';
import type {DecisionWaitEvent,DecisionWaitEvidence} from './decision-wait-evidence.js';
import type {RuntimeFoodEvent,RuntimeFoodEvidenceStatus} from './runtime-food-evidence.js';

/** A proposed, immutable protocol. This is not permission to spend or run models. */
export const NINE_RESIDENT_PLAN=Object.freeze({schema:1,protocol:'frontier-nine-15-game-days-v1',seed:5401,
 mode:'formal',scenario:'frontier',initialResidents:9,gameDays:15,gameMinutes:15*DAY,
 residentIds:Object.freeze(Array.from({length:9},(_,index)=>`founder-${Math.floor(index/3)+1}-${index%3+1}`)),
 realMinutesPerDay:20,modelSlots:16,primary:QWEN_MODEL,backup:DEEPSEEK_MODEL,
 expectedStartMinute:480,expectedEndMinute:480+15*DAY,restartPolicy:'new-runtime-new-session-no-backfill'} as const);
export const evidenceHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Pure seed inspection, never opens a database, environment file or model. */
export function prepareNineResidentAcceptance(sourceFingerprint:string){
 if(!/^[a-f0-9]{64}$/.test(sourceFingerprint))throw new Error('Expected a SHA-256 source fingerprint.');
 const world=createFrontierWorld(NINE_RESIDENT_PLAN.seed);
 if(world.mode!=='formal'||world.scenario!=='frontier'||world.residents.length!==9||world.minute!==480
  ||world.residents.some((r,index)=>r.id!==NINE_RESIDENT_PLAN.residentIds[index]||r.status!=='alive'||r.residency!=='resident'))throw new Error('Formal seed does not match the proposed protocol.');
 return {schema:1,type:'nine-resident-acceptance-preparation',executionKind:'offline-preparation',
  realModelExecuted:false,acceptancePassed:null,readyForRealRun:false,
  version:VALLEY_VERSION,sourceFingerprint,plan:{...NINE_RESIDENT_PLAN},planFingerprint:evidenceHash(NINE_RESIDENT_PLAN),
  initial:{worldId:world.id,minute:world.minute,residentIds:world.residents.map(r=>r.id),
   seedWorldFingerprint:evidenceHash(world),mapFingerprint:evidenceHash(world.map),definitionsFingerprint:evidenceHash(world.definitions)},
  configuredModelLimits:structuredClone({[QWEN_MODEL]:modelLimits[QWEN_MODEL],[DEEPSEEK_MODEL]:modelLimits[DEEPSEEK_MODEL]}),
  coverage:{decisionWaiting:'optional-runtime-events',directEating:'optional-committed-runtime-steps',
   foodOwnershipChanges:'optional-committed-runtime-steps: successful production.inherit ownership changes to existing edible estate, orchard and animal stock only; no physical movement, intake or production, and no complete food ledger',
   foodTransfers:'optional-committed-runtime-steps: successful outsideAid collection and foreign trade reservation, collection and estate custody physical transfers only',
   foodFlows:'optional-committed-runtime-steps: gather_berry/harvest/harvest_house/custody_harvest/fish/hunt/fruit_growth/animal_product additions and cook/industry_craft/employment_processing/saveSeed input/output legs plus prototype_trial start debit and terminal outcomes only',
   careMeals:'optional-committed-runtime-steps: ordinary care provider debit and beneficiary hunger change only',
   familyJourneyMeals:'optional-committed-runtime-steps: actual family relocation meal/water portions by provider and beneficiary only',
   journeyMeals:'optional-committed-runtime-steps: self-carried visitorJourney eat and visitorAid eatMail only',
   publicDutyMeals:'optional-committed-runtime-steps: public duty receive physical inputs, beneficiary changes and separate wage deltas only',
   longCareMeals:'optional-committed-runtime-steps: signed longCare visit provider inputs and beneficiary hunger/health changes only',
   emergencyCareMeals:'optional-committed-runtime-steps: actual emergencyCare feed/rescueMeal provider personal meal/turnip and water debit and child hunger change only',
   childCareMeals:'optional-committed-runtime-steps: guardian tendChild personal meal/turnip and water debit and child hunger change only',
   foodProduction:{value:null,reason:'No complete production quantity ledger.'},
   foodConsumption:{value:null,reason:'Successful engine eat, ordinary care, guardian tendChild, child emergencyCare feed/rescueMeal, signed longCare visits, public duty meals, limited self-carried journey meals, family relocation rations and limited cook inputs are instrumented; no complete consumption ledger.'},
   grossHealthDamage:{value:null,reason:'No complete gross damage ledger.'}},
  pending:['User authorization for real model use and spending cap','Separate new run directory and database; never reuse a live save',
   'Explicitly configure the offline-tested evidence integration and verify its filesystem, final statuses and close seal','Validate authorized wall/request limits, real free-only routing and billing evidence, and independent external process supervision',
   'Full 21600 game-minute run, evidence analysis and separate acceptance verdict'],
 };
}

type FoodStep=Extract<RuntimeFoodEvent,{type:'food_step_committed'}>;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/** Verify one trusted internal session after reading persisted rows back. Not a signature
 * or a hostile-input parser. Completeness covers only this session's elapsed game time.
 */
export function auditRuntimeFoodEvidence(events:readonly RuntimeFoodEvent[],status:RuntimeFoodEvidenceStatus|null){
 const issues=new Set<string>();
 const start=events[0],end=events.at(-1);
 if(!status||status.phase!=='stopped'||status.failure!==null)issues.add('missing_or_failed_close_status');
 if(start?.type!=='food_session_started'||end?.type!=='food_session_stopped')issues.add('missing_session_boundary');
 if(!status?.sessionId||events.length!==status.lastSequence)issues.add('missing_events');
 let cursor=start?.type==='food_session_started'?start.fromMinute:NaN,lastRevision=-1;
 if(!finite(cursor))issues.add('invalid_time');
 const publicDutyIds=new Set(events.flatMap(e=>e.type==='food_step_committed'?[...(e.publicDutyMeals??[]),...(e.emergencyCareMeals??[])].map(r=>r.eventId):[]));
 const ids=new Set<string>(),units:Record<string,number>={};let nutrition=0,hungerRelief=0,completedActions=0;
 for(const [index,event] of events.entries()){
  if(event.schema!==1||event.sequence!==index+1||event.sessionId!==status?.sessionId||event.worldId!==status?.worldId)issues.add('identity_or_sequence_mismatch');
  if(event.type==='food_session_started'&&index!==0||event.type==='food_session_stopped'&&index!==events.length-1)issues.add('unexpected_session_boundary');
  if(event.type==='food_step_committed'){
   if(!finite(event.fromMinute)||!finite(event.toMinute)||event.fromMinute!==cursor||event.toMinute<event.fromMinute)issues.add('coverage_gap');
   if(!Number.isInteger(event.revision)||event.revision<=lastRevision)issues.add('revision_not_increasing');
   for(const receipt of event.receipts){
    if(ids.has(receipt.eventId)||publicDutyIds.has(receipt.eventId))issues.add('duplicate_receipt');ids.add(receipt.eventId);
    if(!finite(receipt.at)||receipt.at<=event.fromMinute||receipt.at>event.toMinute||!finite(receipt.quantity)||receipt.quantity<=0
     ||!finite(receipt.nutrition)||receipt.nutrition<0||!finite(receipt.hungerRelief)||receipt.hungerRelief<0)issues.add('invalid_receipt');
    units[receipt.item]=(units[receipt.item]??0)+receipt.quantity;nutrition+=receipt.nutrition;hungerRelief+=receipt.hungerRelief;completedActions++;
   }
   cursor=event.toMinute;lastRevision=event.revision;
  }else if(event.type==='food_session_stopped'&&event.toMinute!==cursor)issues.add('coverage_gap');
 }
 if(cursor!==status?.throughMinute)issues.add('status_endpoint_mismatch');
 const complete=issues.size===0;
 return {complete,issues:[...issues],scope:'Successful engine eat only; not total food consumption.',
  fromMinute:start?.type==='food_session_started'?start.fromMinute:null,toMinute:finite(cursor)?cursor:null,
  observedGameMinutes:complete?cursor-(start as Extract<RuntimeFoodEvent,{type:'food_session_started'}>).fromMinute:null,
  totals:complete?{units,nutrition,hungerRelief,completedActions}:null,
  observedReceiptCount:events.reduce((sum,event)=>sum+(event.type==='food_step_committed'?event.receipts.length:0),0),
  foodOwnershipChanges:auditFoodOwnershipChanges(events,complete),foodTransfers:auditFoodTransfers(events,complete),foodLosses:auditFoodLosses(events,complete),foodFlows:auditFoodFlows(events,complete),careMeals:auditCareMeals(events,complete),childCareMeals:auditChildCareMeals(events,complete),emergencyCareMeals:auditEmergencyCareMeals(events,complete),longCareMeals:auditLongCareMeals(events,complete),publicDutyMeals:auditPublicDutyMeals(events,complete),journeyMeals:auditJourneyMeals(events,complete),familyJourneyMeals:auditFamilyJourneyMeals(events,complete),foodProduction:null,foodConsumption:null};
}

/** Only actual spoilage removals; not consumption or a complete loss ledger. */
export function auditFoodLosses(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const units:Record<string,number>={},receipts:FoodLossReceipt[]=[];
 let nutrition:number|null=0,steps=0;
 for(const event of events)if(event.type==='food_step_committed'){
  steps++;
  if(event.foodLossCoverage!==FOOD_LOSS_COVERAGE)issues.add('missing_loss_coverage');
  if(!Object.hasOwn(event,'foodLosses')||!Array.isArray(event.foodLosses)){issues.add('missing_loss_observation');continue;}
  const ids=new Set<number>();let occurrence=0;
  for(const input of event.foodLosses){
   let loss:FoodLossReceipt;try{loss=checkedFoodLoss(input);}catch{issues.add('invalid_loss_receipt');continue;}
   receipts.push(loss);
   if(loss.at<=event.fromMinute||loss.at>event.toMinute)issues.add('invalid_loss_time');
   if(ids.has(loss.occurrence))issues.add('duplicate_loss_receipt');ids.add(loss.occurrence);
   if(loss.occurrence!==++occurrence)issues.add('loss_occurrence_gap');
   units[loss.amount.item]=(units[loss.amount.item]??0)+loss.amount.quantity;
   nutrition=nutrition===null||loss.amount.nutrition===null?null:nutrition+loss.amount.nutrition;
  }
 }
 if(!steps)issues.add('missing_loss_observation');
 if(!Object.values(units).every(Number.isFinite)||nutrition!==null&&!Number.isFinite(nutrition))issues.add('non_finite_loss_aggregate');
 return {complete:issues.size===0,issues:[...issues],scope:'Actual advanceFood spoilage removals only; not consumption or a complete food ledger.',
  totals:issues.size===0?{units,nutrition}:null,observedReceipts:receipts};
}
/** Exact receipt timestamps use (from,to] day boundaries, without invented zero rows. */
export function observedFoodLossesByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:FoodLossReceipt[]}>();
 for(const event of events)if(event.type==='food_step_committed')for(const input of event.foodLosses??[]){
  const receipt=checkedFoodLoss(input),day=Math.ceil(receipt.at/DAY)-1;
  if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
  days.get(day)!.receipts.push(receipt);
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

/** These are gross operation legs, never a net production or consumption ledger. */
function auditFoodFlows(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const publicDutyIds=new Set(events.flatMap(e=>e.type==='food_step_committed'?[...(e.publicDutyMeals??[]),...(e.emergencyCareMeals??[])].map(r=>r.eventId):[]));
 // Seed completion IDs cannot also certify intake, transfers or another slice.
 // Keep legacy non-seed audit semantics unchanged.
 const nonFlowEventIds=new Set<string>();
 for(const event of events)if(event.type==='food_step_committed'){
  for(const key of ['receipts','foodTransfers','careMeals','childCareMeals','emergencyCareMeals','longCareMeals','publicDutyMeals','journeyMeals','familyJourneyMeals','foodLosses'] as const){
   for(const receipt of event[key]??[])if('eventId'in receipt&&typeof receipt.eventId==='string')nonFlowEventIds.add(receipt.eventId);
  }
 }
 const bucket=()=>({units:{} as Record<string,number>,nutrition:0 as number|null});
 const totals={sourceAdded:bucket(),processingInputs:bucket(),processingOutputs:bucket()};
 const prototypeTrials:PrototypeFlowHistory=new Map();
 const receipts:FoodFlowReceipt[]=[],ids=new Set<string>(),batches=new Set<string>(),employmentBatches=new Set<string>(),custodyWork=new Set<string>();let steps=0;
 const add=(target:ReturnType<typeof bucket>,amounts:FoodFlowAmount[],at:number,output:boolean)=>{
  for(const amount of amounts){
   if(amount.quantity<=0)issues.add('invalid_flow_amount');
   if(goods[amount.item].life===0&&amount.nutrition!==null&&amount.nutrition!==0)issues.add('invalid_nonfood_nutrition');
   target.units[amount.item]=(target.units[amount.item]??0)+amount.quantity;
   target.nutrition=target.nutrition===null||amount.nutrition===null?null:target.nutrition+amount.nutrition;
   if(amount.lots===null){
    if(goods[amount.item].life>0&&amount.nutrition!==null)issues.add('unproven_flow_nutrition');
   }else{
    if(!amount.lots.length){
     if(goods[amount.item].life!==0||amount.nutrition!==0)issues.add('invalid_empty_flow_lots');
    }else{
     if(goods[amount.item].life===0)issues.add('invalid_nonfood_flow_lots');
     if(amount.lots.some(lot=>lot.quantity<=0||lot.producedAt>at||lot.expiresAt<=at||output&&lot.producedAt!==at))issues.add('invalid_flow_lot');
     if(Math.abs(amount.lots.reduce((sum,lot)=>sum+lot.quantity,0)-amount.quantity)>1e-8)issues.add('flow_lot_quantity_mismatch');
     if(amount.nutrition!==null){
      const sum=amount.lots.reduce((n,lot)=>n+(lot.nutrition??0),0);
      if(amount.lots.some(lot=>lot.nutrition===null)||!Number.isFinite(sum)||Math.abs(sum-amount.nutrition)>1e-8)issues.add('flow_lot_nutrition_mismatch');
     }
    }
   }
  }
 };
 for(const event of events)if(event.type==='food_step_committed'){
  steps++;
  if(event.foodFlowCoverage!==FOOD_FLOW_COVERAGE)issues.add('missing_flow_coverage');
  if(!Object.hasOwn(event,'foodFlows')||!Array.isArray(event.foodFlows)){issues.add('missing_flow_observation');continue;}
  for(const input of event.foodFlows){
   let flow:FoodFlowReceipt;try{flow=checkedFoodFlow(input);}catch{issues.add('invalid_flow_receipt');continue;}
   if(flow.at<=event.fromMinute||flow.at>event.toMinute)issues.add('invalid_flow_time');
   if(flow.action!=='prototype_trial'&&(!flow.outputs.length||flow.type==='processed'&&!flow.inputs.length))issues.add('empty_flow_operation');
   const id=flow.eventId===null?JSON.stringify([flow.action,flow.sourceId,flow.at]):JSON.stringify(['event',flow.eventId]);
   if(ids.has(id)||flow.eventId!==null&&publicDutyIds.has(flow.eventId)||(flow.action==='saveSeed'||flow.action==='prototype_trial')&&nonFlowEventIds.has(flow.eventId))issues.add('duplicate_flow_receipt');ids.add(id);receipts.push(flow);
   if(flow.action==='prototype_trial')try{recordPrototypeFlow(prototypeTrials,flow);}catch{issues.add('invalid_prototype_trial_sequence');}
   if(flow.action==='industry_craft'){if(batches.has(flow.batchId))issues.add('duplicate_craft_batch');batches.add(flow.batchId);}
   if(flow.action==='employment_processing'){const key=JSON.stringify([flow.contractId,flow.day,flow.batchNumber]);if(employmentBatches.has(key))issues.add('duplicate_employment_batch');employmentBatches.add(key);}
   if(flow.action==='custody_harvest'){const key=JSON.stringify([flow.custodyId,flow.workSerial]);if(custodyWork.has(key))issues.add('duplicate_custody_work');custodyWork.add(key);}
   if(flow.type==='source_added')add(totals.sourceAdded,flow.outputs,flow.at,true);
   else{add(totals.processingInputs,flow.inputs,flow.at,false);add(totals.processingOutputs,flow.outputs,flow.at,true);}
  }
 }
 // With no step there is no capability marker distinguishing legacy capture from instrumented zero activity.
 if(!steps)issues.add('missing_flow_observation');
 for(const value of Object.values(totals))if(!Object.values(value.units).every(Number.isFinite)||value.nutrition!==null&&!Number.isFinite(value.nutrition))issues.add('non_finite_flow_aggregate');
 return {complete:issues.size===0,issues:[...issues],coveredActions:['gather_berry','harvest','cook','fish','hunt','fruit_growth','animal_product','industry_craft','employment_processing','harvest_house','custody_harvest','saveSeed','prototype_trial'],
  scope:'Successful gather_berry/harvest/harvest_house/custody_harvest/fish/hunt/fruit_growth/animal_product source additions and cook/industry_craft/employment_processing/saveSeed/prototype_trial input/output legs only; prototype inputs debit once at start, outcomes never repeat that debit; quantities are operation amounts. Unknown batch/nutrition metadata remains null. Transfers, unfinished employment reservations/refunds, trade, spoilage and all other flows are excluded; plantCrop remains excluded. Nonfood legs are physical quantities, not edible food; not net food production or consumption.',
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Daily receipts can be assigned by their own exact game timestamp. Fractional
 * steps crossing midnight are not split into invented minute snapshots. */
export function observedEatingByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:FoodStep['receipts'][number][]}>();
 for(const event of events)if(event.type==='food_step_committed')for(const receipt of event.receipts){
  const day=Math.ceil(receipt.at/DAY)-1;
  if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
  days.get(day)!.receipts.push({...receipt});
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

/** Observed receipts only; missing daily coverage is never filled with zero. */
export function observedFoodFlowsByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:FoodFlowReceipt[]}>();
 const history:PrototypeFlowHistory=new Map(),ids=new Set<string>();
 const otherIds=new Set<string>();
 for(const event of events)if(event.type==='food_step_committed')for(const key of ['receipts','foodTransfers','foodLosses','careMeals','childCareMeals','emergencyCareMeals','longCareMeals','publicDutyMeals','journeyMeals','familyJourneyMeals'] as const)
  for(const r of event[key]??[])if('eventId'in r&&typeof r.eventId==='string')otherIds.add(r.eventId);
 for(const event of events)if(event.type==='food_step_committed')for(const input of event.foodFlows??[]){
  const receipt=checkedFoodFlow(input),day=Math.ceil(receipt.at/DAY)-1;
  if(receipt.action==='prototype_trial'&&(receipt.at<=event.fromMinute||receipt.at>event.toMinute))throw new Error('Invalid food flow time');
  if(receipt.eventId!==null){if(ids.has(receipt.eventId))throw new Error('Duplicate food flow event');ids.add(receipt.eventId);}
  if(receipt.action==='prototype_trial'){if(otherIds.has(receipt.eventId))throw new Error('Duplicate prototype event');recordPrototypeFlow(history,receipt);}
  if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
  days.get(day)!.receipts.push(receipt);
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

export function auditDecisionWaitEvidence(events:readonly DecisionWaitEvent[],status:ReturnType<DecisionWaitEvidence['status']>|null){
 const issues=new Set<string>();
 if(!status||status.phase!=='stopped'||status.failure!==null||status.openRequests!==0||status.openWaits!==0)issues.add('missing_or_failed_close_status');
 if(!status?.sessionId||status.lastSequence!==events.length)issues.add('missing_events');
 if(events[0]?.type!=='session_started'||events.at(-1)?.type!=='session_stopped')issues.add('missing_session_boundary');
 for(const [index,event] of events.entries()){
  if(event.schema!==1||event.sequence!==index+1||event.sessionId!==status?.sessionId)issues.add('identity_or_sequence_mismatch');
  if(event.type==='session_started'&&index!==0||event.type==='session_stopped'&&index!==events.length-1)issues.add('unexpected_session_boundary');
 }
 // A complete log is not evidence of valid durations or that every wait succeeded.
 const complete=issues.size===0;
 return {complete,issues:[...issues],scope:'All recorded actors, including regional and foreign; not the initial-nine subset.',
  monotonicDurationsValid:complete&&status?.monotonicClockValid===true,
  counts:complete?{requests:events.filter(e=>e.type==='request_started').length,
   acceptedWaits:events.filter(e=>e.type==='wait_finished'&&e.reason==='accepted').length,
   censoredWaits:events.filter(e=>e.type==='wait_finished'&&e.rightCensored).length,
   failedRequests:events.filter(e=>e.type==='request_finished'&&(e.outcome==='timeout'||e.outcome==='failed')).length}:null,
  priorWaitMs:null,downtimeMs:null,aggregateWorldWaitMs:null};
}

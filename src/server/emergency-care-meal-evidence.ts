import {array,checkedFoodEvent,checkedEmergencyCareMeal} from './acceptance-evidence-schema.js';
import type {EmergencyCareMealReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {DAY} from '../world/time.js';

/** Actual completed emergencyCare feed/rescueMeal only; agreements are not intake. */
export function auditEmergencyCareMeals(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const totals={units:{} as Record<string,number>,nutrition:0 as number|null,hungerRelief:0,completedActions:0};
 const receipts:EmergencyCareMealReceipt[]=[],ids=new Set<string>(),otherIds=new Set<string>();
 const agreements=new Map<string,{providerId:string;beneficiaryId:string;mealNumber:number;firstAt:number;lastAt:number}>();
 const checked:RuntimeFoodEvent[]=[];
 for(const event of events){try{checked.push(checkedFoodEvent(event));}catch{issues.add('invalid_emergency_care_event');}}
 const start=checked[0],end=checked.at(-1);
 if(start?.type!=='food_session_started'||end?.type!=='food_session_stopped')issues.add('missing_session_boundary');
 let cursor=start?.type==='food_session_started'?start.fromMinute:NaN,revision=-1,steps=0;
 for(const event of checked)if(event.type==='food_step_committed'){
  for(const r of [...event.receipts,...(event.publicDutyMeals??[]),...(event.journeyMeals??[]),...(event.foodFlows??[]),...(event.careMeals??[]),...(event.childCareMeals??[]),...(event.longCareMeals??[])])if(r.eventId!==null)otherIds.add(r.eventId);
 }
 for(const [index,event] of checked.entries()){
  if(event.sequence!==index+1||event.sessionId!==start?.sessionId||event.worldId!==start?.worldId)issues.add('identity_or_sequence_mismatch');
  if(event.type==='food_session_started'&&index!==0||event.type==='food_session_stopped'&&index!==checked.length-1)issues.add('unexpected_session_boundary');
  if(event.type==='food_session_stopped'&&event.toMinute!==cursor)issues.add('coverage_gap');
  if(event.type!=='food_step_committed')continue;
  steps++;
  if(event.fromMinute!==cursor||event.toMinute<event.fromMinute)issues.add('coverage_gap');
  if(event.revision<=revision)issues.add('revision_not_increasing');cursor=event.toMinute;revision=event.revision;
  if(!Object.hasOwn(event,'emergencyCareMeals')){issues.add('missing_emergency_care_observation');continue;}
  for(const receipt of event.emergencyCareMeals!){
   receipts.push(receipt);
   if(ids.has(receipt.eventId)||otherIds.has(receipt.eventId))issues.add('duplicate_emergency_care_receipt');ids.add(receipt.eventId);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_emergency_care_time');
   if(receipt.operation==='feed'){
    const prior=agreements.get(receipt.agreementId!);
    if(prior&&(prior.providerId!==receipt.providerId||prior.beneficiaryId!==receipt.beneficiaryId))issues.add('invalid_emergency_care_agreement_identity');
    // A session may start after earlier meals, but a counter cannot be reused or
    // skip within fully observed consecutive steps of this session.
    if(prior&&receipt.mealNumber!==prior.mealNumber+1)issues.add('invalid_emergency_care_meal_sequence');
    // Even without the offer timestamp, two actual meals under one fixed
    // 24-hour agreement cannot be a day apart or move backwards in time.
    if(prior&&(receipt.at<prior.lastAt||receipt.at-prior.firstAt>=DAY))issues.add('invalid_emergency_care_agreement_time');
    agreements.set(receipt.agreementId!,{providerId:receipt.providerId,beneficiaryId:receipt.beneficiaryId,mealNumber:receipt.mealNumber!,firstAt:prior?.firstAt??receipt.at,lastAt:receipt.at});
   }
   for(const amount of receipt.inputs){
    totals.units[amount.item]=(totals.units[amount.item]??0)+amount.quantity;
    totals.nutrition=totals.nutrition===null||amount.nutrition===null?null:totals.nutrition+amount.nutrition;
   }
   totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;
  }
 }
 if(!steps)issues.add('missing_emergency_care_observation');
 if(!Object.values(totals.units).every(Number.isFinite)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition)
  ||!Number.isFinite(totals.hungerRelief)||!Number.isSafeInteger(totals.completedActions))issues.add('non_finite_emergency_care_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Successful emergencyCare feed and rescueMeal only: actual provider personal meal or turnip and water debits, named child and hunger change. Original-lot nutrition stays separate from fallback effects. Offers, reviews, acceptance, reservations, ordinary care, tendChild and other consumption are excluded. Not a complete consumption ledger.',
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed receipts only; old missing observations never invent zero days. */
export function observedEmergencyCareMealsByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:EmergencyCareMealReceipt[]}>();
 for(const input of events){
  const event=checkedFoodEvent(input);if(event.type!=='food_step_committed')continue;
  for(const receipt of array(checkedEmergencyCareMeal)(event.emergencyCareMeals??[]) as EmergencyCareMealReceipt[]){
   const day=Math.ceil(receipt.at/DAY)-1;
   if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
   days.get(day)!.receipts.push(receipt);
  }
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

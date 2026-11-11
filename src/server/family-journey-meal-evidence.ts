import {checkedFoodEvent} from './acceptance-evidence-schema.js';
import type {FamilyJourneyMealReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {DAY} from '../world/time.js';

/** Completeness means this observed slice, never the entire consumption ledger. */
export function auditFamilyJourneyMeals(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const totals={units:{} as Record<string,number>,nutrition:0 as number|null,hungerRelief:0,completedActions:0};
 const receipts:FamilyJourneyMealReceipt[]=[],checked:RuntimeFoodEvent[]=[];
 for(const event of events){try{checked.push(checkedFoodEvent(event));}catch{issues.add('invalid_family_journey_event');}}
 const start=checked[0],end=checked.at(-1);
 if(start?.type!=='food_session_started'||end?.type!=='food_session_stopped')issues.add('missing_session_boundary');
 let cursor=start?.type==='food_session_started'?start.fromMinute:NaN,revision=-1,steps=0;
 const transactions=new Map<string,{first:FamilyJourneyMealReceipt;step:number;members:Set<number>;beneficiaries:Set<string>;providers:Map<string,number>}>();
 for(const [index,event] of checked.entries()){
  if(event.sequence!==index+1||event.sessionId!==start?.sessionId||event.worldId!==start?.worldId)issues.add('identity_or_sequence_mismatch');
  if(event.type==='food_session_started'&&index!==0||event.type==='food_session_stopped'&&index!==checked.length-1)issues.add('unexpected_session_boundary');
  if(event.type==='food_session_stopped'&&event.toMinute!==cursor)issues.add('coverage_gap');
  if(event.type!=='food_step_committed')continue;
  steps++;
  if(event.fromMinute!==cursor||event.toMinute<event.fromMinute)issues.add('coverage_gap');
  if(event.revision<=revision)issues.add('revision_not_increasing');cursor=event.toMinute;revision=event.revision;
  if(!Object.hasOwn(event,'familyJourneyMeals')){issues.add('missing_family_journey_observation');continue;}
  for(const receipt of event.familyJourneyMeals!){
   receipts.push(receipt);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_family_journey_time');
   const key=JSON.stringify([receipt.relocationId,receipt.rationNumber]);
   let group=transactions.get(key);
   if(!group){group={first:receipt,step:index,members:new Set(),beneficiaries:new Set(),providers:new Map()};transactions.set(key,group);}
   if(group.step!==index||group.members.has(receipt.memberIndex)||group.beneficiaries.has(receipt.beneficiaryId))issues.add('duplicate_family_journey_receipt');
   if(group.first.at!==receipt.at||group.first.trigger!==receipt.trigger||group.first.definition!==receipt.definition
    ||group.first.memberCount!==receipt.memberCount)issues.add('contradictory_family_journey_transaction');
   if(receipt.memberIndex!==group.members.size)issues.add('family_journey_member_order');
   if(receipt.providerPortion!==(group.providers.get(receipt.providerId)??0))issues.add('family_journey_provider_portion_order');
   group.members.add(receipt.memberIndex);group.beneficiaries.add(receipt.beneficiaryId);
   group.providers.set(receipt.providerId,(group.providers.get(receipt.providerId)??0)+1);
   for(const amount of receipt.inputs){
    totals.units[amount.item]=(totals.units[amount.item]??0)+amount.quantity;
    totals.nutrition=totals.nutrition===null||amount.nutrition===null?null:totals.nutrition+amount.nutrition;
   }
   totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;
  }
 }
 for(const group of transactions.values())if(group.members.size!==group.first.memberCount||group.beneficiaries.size!==group.first.memberCount)issues.add('incomplete_family_journey_transaction');
 if(!steps)issues.add('missing_family_journey_observation');
 if(!Object.values(totals.units).every(Number.isFinite)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition)
  ||!Number.isFinite(totals.hungerRelief)||!Number.isSafeInteger(totals.completedActions))issues.add('non_finite_family_journey_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Actual familyRelocation depart/resume/travel ration portions only. completedActions counts beneficiary servings, not selected actions. Original-lot nutrition and actual hunger relief stay separate. Transfers, reservations and other consumption are excluded. Not a complete consumption ledger.',
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed receipts only; missing observations do not invent zero days. */
export function observedFamilyJourneyMealsByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:FamilyJourneyMealReceipt[]}>();
 for(const input of events){
  const event=checkedFoodEvent(input);if(event.type!=='food_step_committed')continue;
  for(const receipt of event.familyJourneyMeals??[]){
   const day=Math.ceil(receipt.at/DAY)-1;
   if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
   days.get(day)!.receipts.push(receipt);
  }
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

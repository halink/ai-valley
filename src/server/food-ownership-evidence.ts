import {checkedFoodEvent,foodOwnershipKey} from './acceptance-evidence-schema.js';
import {FOOD_OWNERSHIP_COVERAGE,type FoodOwnershipReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {DAY} from '../world/time.js';

/** Existing stock changes owner without being produced, transferred, or eaten. */
export function auditFoodOwnershipChanges(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const totals={units:{} as Record<string,number|null>,nutrition:null,completedActions:0,completedShares:0};
 const receipts:FoodOwnershipReceipt[]=[],ids=new Set<string>(),shares=new Set<string>(),otherIds=new Set<string>();
 const checked:RuntimeFoodEvent[]=[];
 for(const event of events){try{checked.push(checkedFoodEvent(event));}catch{issues.add('invalid_ownership_event');}}
 const start=checked[0],end=checked.at(-1);
 if(start?.type!=='food_session_started'||end?.type!=='food_session_stopped')issues.add('missing_session_boundary');
 let cursor=start?.type==='food_session_started'?start.fromMinute:NaN,revision=-1,steps=0;
 for(const event of checked)if(event.type==='food_step_committed'){
  for(const receipt of [...event.receipts,...(event.foodTransfers??[]),...(event.publicDutyMeals??[]),...(event.foodFlows??[]),
   ...(event.emergencyCareMeals??[]),...(event.careMeals??[]),...(event.childCareMeals??[]),...(event.longCareMeals??[]),...(event.journeyMeals??[])])
   if(receipt.eventId!==null)otherIds.add(receipt.eventId);
 }
 for(const [index,event] of checked.entries()){
  if(event.sequence!==index+1||event.sessionId!==start?.sessionId||event.worldId!==start?.worldId)issues.add('identity_or_sequence_mismatch');
  if(event.type==='food_session_started'&&index!==0||event.type==='food_session_stopped'&&index!==checked.length-1)issues.add('unexpected_session_boundary');
  if(event.type==='food_session_stopped'&&event.toMinute!==cursor)issues.add('coverage_gap');
  if(event.type!=='food_step_committed')continue;
  steps++;
  if(event.fromMinute!==cursor||event.toMinute<event.fromMinute)issues.add('coverage_gap');
  if(event.revision<=revision)issues.add('revision_not_increasing');cursor=event.toMinute;revision=event.revision;
  if(event.foodOwnershipCoverage!==FOOD_OWNERSHIP_COVERAGE)issues.add('missing_ownership_coverage');
  if(!Object.hasOwn(event,'foodOwnershipChanges')){issues.add('missing_ownership_observation');continue;}
  for(const receipt of event.foodOwnershipChanges!){
   receipts.push(receipt);
   if(ids.has(receipt.eventId)||otherIds.has(receipt.eventId))issues.add('duplicate_ownership_receipt');ids.add(receipt.eventId);
   const key=foodOwnershipKey(receipt);if(shares.has(key))issues.add('duplicate_ownership_share');shares.add(key);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_ownership_time');
   for(const stock of receipt.stocks)for(const amount of stock.amounts){
    const prior=totals.units[amount.item];
    totals.units[amount.item]=prior===null||amount.quantity===null?null:(prior??0)+amount.quantity;
   }
   totals.completedActions++;totals.completedShares++;
  }
 }
 if(!steps)issues.add('missing_ownership_observation');
 if(!Object.values(totals.units).every(value=>value===null||Number.isFinite(value))
  ||!Number.isSafeInteger(totals.completedActions)||!Number.isSafeInteger(totals.completedShares))issues.add('non_finite_ownership_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Successful production.inherit changes to ownership of existing edible estate, orchard and animal stock only. No physical movement, production or eating. Original lots and nutrition remain unknown. Not a complete ownership or food ledger.',
  fullOwnershipLedger:false,
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed receipts only; absent legacy observations never invent zero days. */
export function observedFoodOwnershipChangesByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:FoodOwnershipReceipt[]}>();
 for(const input of events){
  const event=checkedFoodEvent(input);if(event.type!=='food_step_committed')continue;
  for(const receipt of event.foodOwnershipChanges??[]){
   const day=Math.ceil(receipt.at/DAY)-1;
   if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
   days.get(day)!.receipts.push(receipt);
  }
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

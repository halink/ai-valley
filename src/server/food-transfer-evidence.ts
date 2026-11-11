import {checkedFoodEvent,foodTransferKey} from './acceptance-evidence-schema.js';
import {FOOD_TRANSFER_COVERAGE,type FoodTransferReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {DAY} from '../world/time.js';

/** Observed aid collection and foreign trade physical custody transfers only. */
export function auditFoodTransfers(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const totals={units:{} as Record<string,number>,nutrition:0 as number|null,completedActions:0};
 const receipts:FoodTransferReceipt[]=[],ids=new Set<string>(),deliveries=new Set<string>(),otherIds=new Set<string>();
 const checked:RuntimeFoodEvent[]=[];
 for(const event of events){try{checked.push(checkedFoodEvent(event));}catch{issues.add('invalid_transfer_event');}}
 const start=checked[0],end=checked.at(-1);
 if(start?.type!=='food_session_started'||end?.type!=='food_session_stopped')issues.add('missing_session_boundary');
 let cursor=start?.type==='food_session_started'?start.fromMinute:NaN,revision=-1,steps=0;
 for(const event of checked)if(event.type==='food_step_committed'){
  for(const r of [...event.receipts,...(event.publicDutyMeals??[]),...(event.foodFlows??[]),...(event.emergencyCareMeals??[]),...(event.careMeals??[]),...(event.childCareMeals??[]),...(event.longCareMeals??[]),...(event.journeyMeals??[])])if(r.eventId!==null)otherIds.add(r.eventId);
 }
 for(const [index,event] of checked.entries()){
  if(event.sequence!==index+1||event.sessionId!==start?.sessionId||event.worldId!==start?.worldId)issues.add('identity_or_sequence_mismatch');
  if(event.type==='food_session_started'&&index!==0||event.type==='food_session_stopped'&&index!==checked.length-1)issues.add('unexpected_session_boundary');
  if(event.type==='food_session_stopped'&&event.toMinute!==cursor)issues.add('coverage_gap');
  if(event.type!=='food_step_committed')continue;
  steps++;
  if(event.fromMinute!==cursor||event.toMinute<event.fromMinute)issues.add('coverage_gap');
  if(event.revision<=revision)issues.add('revision_not_increasing');cursor=event.toMinute;revision=event.revision;
  if(event.foodTransferCoverage!==FOOD_TRANSFER_COVERAGE)issues.add('missing_transfer_coverage');
  if(!Object.hasOwn(event,'foodTransfers')){issues.add('missing_transfer_observation');continue;}
  for(const receipt of event.foodTransfers!){
   receipts.push(receipt);
   if(receipt.eventId!==null){if(ids.has(receipt.eventId)||otherIds.has(receipt.eventId))issues.add('duplicate_transfer_receipt');ids.add(receipt.eventId);}
   const key=foodTransferKey(receipt);if(deliveries.has(key))issues.add(receipt.action==='outsideAid'?'duplicate_transfer_delivery':'duplicate_transfer_receipt');deliveries.add(key);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_transfer_time');
   for(const amount of [receipt.amount]){
    totals.units[amount.item]=(totals.units[amount.item]??0)+amount.quantity;
    totals.nutrition=totals.nutrition===null||amount.nutrition===null?null:totals.nutrition+amount.nutrition;
   }
   totals.completedActions++;
  }
 }
 if(!steps)issues.add('missing_transfer_observation');
 if(!Object.values(totals.units).every(Number.isFinite)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition)
  ||!Number.isSafeInteger(totals.completedActions))issues.add('non_finite_transfer_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Successful outsideAid collect and foreign trade reservation, collection and estate custody physical transfers only. Neither production nor eating; not a complete transfer or food ledger.',
  fullTransferLedger:false,
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed receipts only; old missing observations never invent zero days. */
export function observedFoodTransfersByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:FoodTransferReceipt[]}>();
 for(const input of events){
  const event=checkedFoodEvent(input);if(event.type!=='food_step_committed')continue;
  for(const receipt of event.foodTransfers??[]){
   const day=Math.ceil(receipt.at/DAY)-1;
   if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
   days.get(day)!.receipts.push(receipt);
  }
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

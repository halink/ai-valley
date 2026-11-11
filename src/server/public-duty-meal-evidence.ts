import {array,checkedPublicDutyMeal} from './acceptance-evidence-schema.js';
import type {PublicDutyMealReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {DAY} from '../world/time.js';

/** Physical ingredient consumption is counted once; wages are not nutrition. */
export function auditPublicDutyMeals(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const sourceTotals=()=>({units:{} as Record<string,number>,nutrition:0 as number|null,completedActions:0});
 const sources={personal:sourceTotals(),public:sourceTotals()};
 const totals={sources,units:{} as Record<string,number>,nutrition:0 as number|null,hungerRelief:0,healthGain:0,completedActions:0,wages:0};
 const receipts:PublicDutyMealReceipt[]=[],ids=new Set<string>(),services=new Set<string>();let steps=0;
 const otherIds=new Set(events.flatMap(e=>e.type==='food_step_committed'?[...e.receipts,...(e.journeyMeals??[]),...(e.foodFlows??[]),...(e.emergencyCareMeals??[]),...(e.careMeals??[]),...(e.childCareMeals??[]),...(e.longCareMeals??[])].map(r=>r.eventId):[]));
 for(const event of events)if(event.type==='food_step_committed'){
  steps++;
  if(!Object.hasOwn(event,'publicDutyMeals')||!Array.isArray(event.publicDutyMeals)){issues.add('missing_public_duty_observation');continue;}
  let inputs:PublicDutyMealReceipt[];
  try{inputs=array(checkedPublicDutyMeal)(event.publicDutyMeals) as PublicDutyMealReceipt[];}
  catch{issues.add('invalid_public_duty_receipt');continue;}
  for(const receipt of inputs){
   receipts.push(receipt);
   if(ids.has(receipt.eventId)||otherIds.has(receipt.eventId))issues.add('duplicate_public_duty_receipt');ids.add(receipt.eventId);
   const service=JSON.stringify([receipt.shiftId,receipt.serviceNumber]);
   if(services.has(service))issues.add('duplicate_public_duty_service');services.add(service);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_public_duty_time');
   const source=sources[receipt.source];source.completedActions++;
   for(const amount of receipt.inputs){
    source.units[amount.item]=(source.units[amount.item]??0)+amount.quantity;
    source.nutrition=source.nutrition===null||amount.nutrition===null?null:source.nutrition+amount.nutrition;
    totals.units[amount.item]=(totals.units[amount.item]??0)+amount.quantity;
    totals.nutrition=totals.nutrition===null||amount.nutrition===null?null:totals.nutrition+amount.nutrition;
    if(source.nutrition!==null&&!Number.isFinite(source.nutrition)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition))issues.add('non_finite_public_duty_aggregate');
   }
   totals.hungerRelief+=receipt.hungerRelief;totals.healthGain+=receipt.healthGain;totals.completedActions++;
   totals.wages+=receipt.funding?.wagePerService??0;
  }
 }
 if(!steps)issues.add('missing_public_duty_observation');
 if(Object.values(sources).some(s=>!Object.values(s.units).every(Number.isFinite)||s.nutrition!==null&&!Number.isFinite(s.nutrition))
  ||!Object.values(totals.units).every(Number.isFinite)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition)
  ||![totals.hungerRelief,totals.healthGain,totals.wages].every(Number.isFinite)||!Number.isSafeInteger(totals.completedActions))issues.add('non_finite_public_duty_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Successful publicDuty receive only: provider personal stock or physical public building stock, named beneficiary hunger and health changes, and separate funded wage deltas. Treasury stock is an aggregate, not another physical debit. Original-lot nutrition is independent of fixed service relief and remains unknown when originals are missing. Other duties, transfers and consumption are excluded. Not a complete consumption ledger.',
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed facts only; no invented empty days. */
export function observedPublicDutyMealsByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:PublicDutyMealReceipt[]}>();
 for(const event of events)if(event.type==='food_step_committed')for(const input of event.publicDutyMeals??[]){
  const receipt=checkedPublicDutyMeal(input),day=Math.ceil(receipt.at/DAY)-1;
  if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
  days.get(day)!.receipts.push(receipt);
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

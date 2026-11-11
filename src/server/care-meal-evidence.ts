import {checkedCareMeal} from './acceptance-evidence-schema.js';
import type {CareMealReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {DAY} from '../world/time.js';

/** Separate ordinary-care slice; never infer total consumption from hunger relief. */
export function auditCareMeals(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const totals={units:{} as Record<string,number>,nutrition:0 as number|null,hungerRelief:0,completedActions:0};
 const receipts:CareMealReceipt[]=[],ids=new Set<string>();let steps=0;
 const otherIds=new Set(events.flatMap(e=>e.type==='food_step_committed'?[...e.receipts,...(e.publicDutyMeals??[]),...(e.journeyMeals??[]),...(e.foodFlows??[]),...(e.emergencyCareMeals??[]),...(e.childCareMeals??[]),...(e.longCareMeals??[])].map(r=>r.eventId):[]));
 for(const event of events)if(event.type==='food_step_committed'){
  steps++;
  if(!Object.hasOwn(event,'careMeals')||!Array.isArray(event.careMeals)){issues.add('missing_care_observation');continue;}
  for(const input of event.careMeals){
   let receipt:CareMealReceipt;try{receipt=checkedCareMeal(input);}catch{issues.add('invalid_care_receipt');continue;}
   receipts.push(receipt);
   if(ids.has(receipt.eventId)||otherIds.has(receipt.eventId))issues.add('duplicate_care_receipt');ids.add(receipt.eventId);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_care_time');
   if(receipt.providerId===receipt.beneficiaryId||receipt.container!=='person:'+receipt.providerId
    ||(receipt.authority==='consent')!==(receipt.proposalId!==null))issues.add('invalid_care_identity');
   if(receipt.hungerBefore>100||Math.abs(receipt.hungerAfter-Math.max(0,receipt.hungerBefore-22))>1e-8
    ||Math.abs(receipt.hungerBefore-receipt.hungerAfter-receipt.hungerRelief)>1e-8)issues.add('invalid_care_relief');
   if(receipt.inputs.length!==2||!receipt.inputs.some(a=>a.item==='meal')||!receipt.inputs.some(a=>a.item==='water'))issues.add('invalid_care_inputs');
   for(const amount of receipt.inputs){
    if(amount.quantity!==1)issues.add('invalid_care_amount');
    totals.units[amount.item]=(totals.units[amount.item]??0)+amount.quantity;
    totals.nutrition=totals.nutrition===null||amount.nutrition===null?null:totals.nutrition+amount.nutrition;
    if(amount.item==='water'){
     if(amount.nutrition!==0||amount.lots?.length!==0)issues.add('invalid_care_water');
    }else if(amount.lots===null){
     if(amount.nutrition!==null)issues.add('unproven_care_nutrition');
    }else{
     if(!amount.lots.length||amount.lots.some(l=>l.quantity<=0||l.producedAt>receipt.at||l.expiresAt<=receipt.at))issues.add('invalid_care_lot');
     if(Math.abs(amount.lots.reduce((n,l)=>n+l.quantity,0)-amount.quantity)>1e-8)issues.add('care_lot_quantity_mismatch');
     const nutrition=amount.lots.reduce((n,l)=>n+(l.nutrition??0),0);
     if(amount.nutrition!==null&&(amount.lots.some(l=>l.nutrition===null)||!Number.isFinite(nutrition)||Math.abs(nutrition-amount.nutrition)>1e-8))issues.add('care_lot_nutrition_mismatch');
    }
   }
   totals.hungerRelief+=receipt.hungerRelief;totals.completedActions++;
  }
 }
 if(!steps)issues.add('missing_care_observation');
 if(!Object.values(totals.units).every(Number.isFinite)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition)
  ||!Number.isFinite(totals.hungerRelief)||!Number.isSafeInteger(totals.completedActions))issues.add('non_finite_care_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Successful ordinary care only, from the provider personal stock to the named beneficiary. Meal nutrition uses original lots; companion water is separate. Long care, child tending, emergency-care actions and all other consumption are excluded. Not a complete consumption ledger.',
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed facts only. No receipt is not evidence of an observed empty day. */
export function observedCareMealsByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:CareMealReceipt[]}>();
 for(const event of events)if(event.type==='food_step_committed')for(const input of event.careMeals??[]){
  const receipt=checkedCareMeal(input),day=Math.ceil(receipt.at/DAY)-1;
  if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
  days.get(day)!.receipts.push(receipt);
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

import {array,checkedLongCareMeal} from './acceptance-evidence-schema.js';
import type {LongCareMealReceipt} from '../world/food-consumption-evidence.js';
import type {RuntimeFoodEvent} from './runtime-food-evidence.js';
import {goods} from '../shared/items.js';
import {DAY} from '../world/time.js';

/** Signed visit recipes and gains can vary. Actual changes are not original-lot nutrition. */
export function auditLongCareMeals(events:readonly RuntimeFoodEvent[],sessionComplete:boolean){
 const issues=new Set<string>();if(!sessionComplete)issues.add('incomplete_session');
 const totals={units:{} as Record<string,number>,nutrition:0 as number|null,hungerRelief:0,healthGain:0,completedActions:0};
 const receipts:LongCareMealReceipt[]=[],ids=new Set<string>(),slots=new Set<string>();let steps=0;
 const otherIds=new Set(events.flatMap(e=>e.type==='food_step_committed'?[...e.receipts,...(e.publicDutyMeals??[]),...(e.journeyMeals??[]),...(e.foodFlows??[]),...(e.emergencyCareMeals??[]),...(e.careMeals??[]),...(e.childCareMeals??[])].map(r=>r.eventId):[]));
 for(const event of events)if(event.type==='food_step_committed'){
  steps++;
  if(!Object.hasOwn(event,'longCareMeals')||!Array.isArray(event.longCareMeals)){issues.add('missing_long_care_observation');continue;}
  let inputs:LongCareMealReceipt[];
  try{inputs=array(checkedLongCareMeal)(event.longCareMeals) as LongCareMealReceipt[];}
  catch{issues.add('invalid_long_care_receipt');continue;}
  for(const input of inputs){
   let receipt:LongCareMealReceipt;try{receipt=checkedLongCareMeal(input);}catch{issues.add('invalid_long_care_receipt');continue;}
   receipts.push(receipt);
   if(ids.has(receipt.eventId)||otherIds.has(receipt.eventId))issues.add('duplicate_long_care_receipt');ids.add(receipt.eventId);
   const slot=JSON.stringify([receipt.agreementId,receipt.slotKey]);
   if(slots.has(slot))issues.add('duplicate_long_care_slot');slots.add(slot);
   if(receipt.at<=event.fromMinute||receipt.at>event.toMinute)issues.add('invalid_long_care_time');
   if(receipt.providerId===receipt.beneficiaryId||receipt.container!=='person:'+receipt.providerId)issues.add('invalid_long_care_identity');
   if(receipt.hungerBefore>100||receipt.hungerAfter>receipt.hungerBefore
    ||Math.abs(receipt.hungerBefore-receipt.hungerAfter-receipt.hungerRelief)>1e-8)issues.add('invalid_long_care_relief');
   if(receipt.healthAfter>100||receipt.healthBefore>receipt.healthAfter
    ||Math.abs(receipt.healthAfter-receipt.healthBefore-receipt.healthGain)>1e-8)issues.add('invalid_long_care_health');
   const items=new Set<string>();
   for(const amount of receipt.inputs){
    if(amount.quantity<=0||items.has(amount.item))issues.add('invalid_long_care_amount');items.add(amount.item);
    totals.units[amount.item]=(totals.units[amount.item]??0)+amount.quantity;
    totals.nutrition=totals.nutrition===null||amount.nutrition===null?null:totals.nutrition+amount.nutrition;
    if(goods[amount.item].food===0){
     if(amount.nutrition!==0||amount.lots?.length!==0)issues.add('invalid_long_care_nonfood');
    }else if(amount.lots===null){
     if(amount.nutrition!==null)issues.add('unproven_long_care_nutrition');
    }else{
     if(!amount.lots.length||amount.lots.some(l=>l.quantity<=0||l.producedAt>receipt.at||l.expiresAt<=receipt.at))issues.add('invalid_long_care_lot');
     const quantity=amount.lots.reduce((n,l)=>n+l.quantity,0);
     if(!Number.isFinite(quantity)||Math.abs(quantity-amount.quantity)>1e-8)issues.add('long_care_lot_quantity_mismatch');
     const nutrition=amount.lots.reduce((n,l)=>n+(l.nutrition??0),0);
     if(amount.nutrition!==null&&(amount.lots.some(l=>l.nutrition===null)||!Number.isFinite(nutrition)||Math.abs(nutrition-amount.nutrition)>1e-8))issues.add('long_care_lot_nutrition_mismatch');
    }
   }
   totals.hungerRelief+=receipt.hungerRelief;totals.healthGain+=receipt.healthGain;totals.completedActions++;
  }
 }
 if(!steps)issues.add('missing_long_care_observation');
 if(!Object.values(totals.units).every(Number.isFinite)||totals.nutrition!==null&&!Number.isFinite(totals.nutrition)
  ||!Number.isFinite(totals.hungerRelief)||!Number.isFinite(totals.healthGain)||!Number.isSafeInteger(totals.completedActions))issues.add('non_finite_long_care_aggregate');
 return {complete:issues.size===0,issues:[...issues],
  scope:'Successful signed longCare visit only: actual provider personal inputs and named beneficiary hunger and health changes. Recipes and gains follow the signed agreement. Original-lot nutrition remains separate from actual relief, including unknown-definition fallback. Other care, transfers, spoilage and consumption are excluded. Not a complete consumption ledger.',
  totals:issues.size===0?totals:null,observedReceipts:receipts};
}

/** Observed facts only; no invented empty days. */
export function observedLongCareMealsByDay(events:readonly RuntimeFoodEvent[]){
 const days=new Map<number,{calendarDay:number;receipts:LongCareMealReceipt[]}>();
 for(const event of events)if(event.type==='food_step_committed')for(const input of event.longCareMeals??[]){
  const receipt=checkedLongCareMeal(input),day=Math.ceil(receipt.at/DAY)-1;
  if(!days.has(day))days.set(day,{calendarDay:day,receipts:[]});
  days.get(day)!.receipts.push(receipt);
 }
 return [...days.values()].sort((a,b)=>a.calendarDay-b.calendarDay);
}

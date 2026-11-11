// Deliberately no arbitrary strings, error messages, object spreading or toJSON calls.
// The boundary accepts trusted runtime identities, never arbitrary model/user content.
import {QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL} from './model-completion.js';
import {ACCEPTANCE_STOP_REASONS,type AcceptanceStopStatus} from './acceptance-stop-control.js';
import {FOOD_OWNERSHIP_COVERAGE,type FoodOwnershipReceipt,FOOD_TRANSFER_COVERAGE,type FoodTransferReceipt,FOOD_FLOW_COVERAGE,FOOD_LOSS_COVERAGE,FOOD_LOSS_CONTAINER_TYPES,type FoodLossReceipt,type FoodFlowReceipt,type CareMealReceipt,type ChildCareMealReceipt,type EmergencyCareMealReceipt,type LongCareMealReceipt,type PublicDutyMealReceipt,type JourneyMealReceipt,type FamilyJourneyMealReceipt} from '../world/food-consumption-evidence.js';
import {prototypeFish} from '../shared/prototypes.js';
import {fishItems,fishSpecies} from '../shared/fish-species.js';
import {beastNames,huntedMeatYield} from '../shared/frontier-hazards.js';
import {DAY} from '../world/time.js';
import {goods,itemKeys} from '../shared/items.js';
import type {DecisionWaitEvent,DecisionWaitEvidence} from './decision-wait-evidence.js';
import type {RuntimeFoodEvent,RuntimeFoodEvidenceStatus} from './runtime-food-evidence.js';

type Check=(input:unknown)=>unknown;
const invalid=():never=>{throw new Error('invalid_evidence_schema');};
export const number:Check=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:invalid();
export const integer:Check=v=>Number.isSafeInteger(v)&&(v as number)>=0?v:invalid();
const positive:Check=v=>Number.isSafeInteger(v)&&(v as number)>0?v:invalid();
const bool:Check=v=>typeof v==='boolean'?v:invalid();
export const nullable=(check:Check):Check=>v=>v===null?null:check(v);
export const enumeration=(...values:unknown[]):Check=>v=>values.includes(v)?v:invalid();
export const identifier:Check=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(v)?v:invalid();
export const fingerprint:Check=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:invalid();
const model=enumeration(QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL);
export const array=(check:Check):Check=>v=>{
 if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>10000)return invalid();
 const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(v);
 if(keys.length!==v.length+1)return invalid();
 const result:unknown[]=[];
 for(let index=0;index<v.length;index++){
  const descriptor=descriptors[String(index)];if(!descriptor||!('value' in descriptor))return invalid();
  result.push(check(descriptor.value));
 }
 return result;
};
/** Reject unexpected fields rather than silently accepting prompts or credentials. */
export const object=(fields:Record<string,Check>):Check=>v=>{
 if(v===null||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return invalid();
 const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(v);
 if(keys.length!==Object.keys(fields).length||keys.some(k=>typeof k!=='string'||!Object.hasOwn(fields,k)))return invalid();
 const result:Record<string,unknown>={};
 for(const [key,check] of Object.entries(fields)){
  const descriptor=descriptors[key];if(!descriptor||!('value' in descriptor))return invalid();
  result[key]=check(descriptor.value);
 }
 return result;
};
const typeOf=(v:unknown)=>{
 if(!v||typeof v!=='object')return invalid();
 const descriptor=Object.getOwnPropertyDescriptor(v,'type');
 return descriptor&&'value' in descriptor&&typeof descriptor.value==='string'?descriptor.value:invalid();
};
const common={schema:enumeration(1),sessionId:identifier,sequence:positive};
const actor={actorId:identifier,actorKind:enumeration('resident','regional','foreign'),waitId:positive};
const request={...actor,requestId:positive,model};
const duration={elapsedMs:nullable(number),gameMinutes:nullable(number)};
const stamp=object({wallTimeMs:nullable(number),monotonicMs:nullable(number),gameMinute:number});
const safeCode:Check=v=>v===null?null:typeof v==='string'&&/^(model_http_\d{3}|model_incomplete|model_stream_error|model_context_limit|invalid_decision|unsupported_action|invalid_action|model_timeout_or_invalid_response)$/.test(v)?v:invalid();
const waits:Record<string,Record<string,Check>>={
 session_started:{priorWait:enumeration('unknown')},session_stopped:{},
 wait_started:{...actor,origin:enumeration('session_start','runtime_boundary'),priorWaitMs:enumeration(null)},
 wait_finished:{...actor,...duration,reason:enumeration('accepted','no_longer_eligible','stopped'),rightCensored:bool,requestId:nullable(positive)},
 request_started:{...request,route:enumeration('primary','backup'),trigger:enumeration('normal','fallback_pending','primary_blocked')},
 request_finished:{...request,...duration,outcome:enumeration('reply','timeout','failed','interrupted'),code:safeCode},
 admission_deferred:{...actor,reason:enumeration('budget'),model},
 preparation_failed:{...actor,code:enumeration('model_context_limit','model_request_invalid'),model},
 decision_rejected:{...actor,requestId:positive,reason:enumeration('actor_changed','plan_invalid','regional_changed','foreign_changed')},
 retry_scheduled:{...actor,delayMs:number,fallbackModel:nullable(model)},
};
export function checkedWaitEvent(input:unknown):DecisionWaitEvent{
 const type=typeOf(input);if(!Object.hasOwn(waits,type))return invalid();
 return object({...common,type:enumeration(type),at:stamp,...waits[type]})(input) as DecisionWaitEvent;
}
const receipt=object({at:number,residentId:identifier,eventId:identifier,planId:identifier,container:identifier,
 item:enumeration(...itemKeys),quantity:number,nutrition:number,hungerRelief:number});
const definitionKey:Check=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/.test(v)?v:invalid();
const positiveQuantity:Check=v=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:invalid();
export const foodFlowCoverage=enumeration('gather_harvest_cook_fish_hunt_v1','gather_harvest_cook_fish_hunt_growth_v1','gather_harvest_cook_fish_hunt_growth_craft_v1','gather_harvest_cook_fish_hunt_growth_craft_employment_v1','gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1','gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1',FOOD_FLOW_COVERAGE);
const flowLot=object({quantity:positiveQuantity,producedAt:number,expiresAt:number,definition:definitionKey,nutrition:nullable(number)});
const flowAmount=object({item:enumeration(...itemKeys),quantity:positiveQuantity,nutrition:nullable(number),lots:nullable(array(flowLot))});
export const foodLossCoverage=enumeration(FOOD_LOSS_COVERAGE);
const foodLossContainerType=enumeration(...FOOD_LOSS_CONTAINER_TYPES);
/** Copy only data properties before checking semantics; never invoke caller accessors. */
export function checkedFoodLoss(input:unknown):FoodLossReceipt{
 const loss=object({type:enumeration('loss'),cause:enumeration('spoilage'),occurrence:positive,at:number,containerType:foodLossContainerType,
  container:identifier,amount:flowAmount})(input) as FoodLossReceipt;
 const {amount,at}=loss;
 if(goods[amount.item].life<=0||loss.containerType!=='estate-stock'&&(!loss.container.startsWith(`${loss.containerType}:`)||loss.container.length<=loss.containerType.length+1))return invalid();
 if(amount.lots===null){if(amount.nutrition!==null)return invalid();}
 else{
  if(!amount.lots.length||amount.lots.some(l=>l.producedAt>l.expiresAt||l.producedAt>at||l.expiresAt>at))return invalid();
  const quantity=amount.lots.reduce((sum,l)=>sum+l.quantity,0);
  const nutrition=amount.lots.some(l=>l.nutrition===null)?null:amount.lots.reduce((sum,l)=>sum+l.nutrition!,0);
  if(!Number.isFinite(quantity)||Math.abs(quantity-amount.quantity)>1e-8||nutrition!==null&&!Number.isFinite(nutrition)
   ||(nutrition===null)!==(amount.nutrition===null)||nutrition!==null&&Math.abs(nutrition-amount.nutrition!)>1e-8)return invalid();
 }
 return loss;
}
export const foodOwnershipCoverage=enumeration(FOOD_OWNERSHIP_COVERAGE);
/** The estate share is stable across event IDs, retries, and observer sessions. */
export function foodOwnershipKey(receipt:FoodOwnershipReceipt):string{
 return JSON.stringify([receipt.estatePersonId,receipt.shareId]);
}
const ownershipAmount=object({item:enumeration(...itemKeys),quantity:nullable(positiveQuantity),nutrition:enumeration(null),lots:enumeration(null)});
const ownershipStock=object({containerType:enumeration('estate-stock','orchard-stock','animal-stock'),container:identifier,
 fromOwnerId:nullable(identifier),toOwnerId:identifier,ambiguous:bool,amounts:array(ownershipAmount)});
/** Ownership of existing stock only. Original lots and nutrition are unproven. */
export function checkedFoodOwnership(input:unknown):FoodOwnershipReceipt{
 const receipt=object({type:enumeration('ownership_change'),action:enumeration('production'),operation:enumeration('inherit'),
  at:number,eventId:identifier,planId:nullable(identifier),estatePersonId:identifier,shareId:identifier,heirId:identifier,
  stocks:array(ownershipStock)})(input) as FoodOwnershipReceipt;
 const containers=new Set<string>();
 for(const stock of receipt.stocks){
  const prefixes=stock.containerType==='estate-stock'?['estate:','estate-stock:']:[`${stock.containerType}:`];
  if(!prefixes.some(prefix=>stock.container.startsWith(prefix)&&stock.container.length>prefix.length)
   ||containers.has(stock.container)||!stock.amounts.length||stock.toOwnerId!==receipt.heirId
   ||stock.fromOwnerId===stock.toOwnerId||stock.fromOwnerId===null&&!stock.ambiguous)return invalid();
  containers.add(stock.container);
  const items=new Set<string>();
  for(const amount of stock.amounts){
   if(goods[amount.item].food<=0||items.has(amount.item)||stock.ambiguous&&amount.quantity!==null
    ||stock.containerType==='orchard-stock'&&amount.item!=='fruit'
    ||stock.containerType==='animal-stock'&&!['egg','duckEgg','milk'].includes(amount.item))return invalid();
   items.add(amount.item);
  }
 }
 return receipt;
}
/** Validate the entire slice before publishing or mutating an aggregate. */
export function checkedFoodOwnershipChanges(input:unknown,fromMinute:number,toMinute:number):FoodOwnershipReceipt[]{
 number(fromMinute);number(toMinute);if(toMinute<fromMinute)return invalid();
 const receipts=array(checkedFoodOwnership)(input) as FoodOwnershipReceipt[],events=new Set<string>(),shares=new Set<string>();
 for(const receipt of receipts){
  const key=foodOwnershipKey(receipt);
  if(receipt.at<=fromMinute||receipt.at>toMinute||events.has(receipt.eventId)||shares.has(key))return invalid();
  events.add(receipt.eventId);shares.add(key);
 }
 return receipts;
}
export const foodTransferCoverage=enumeration('outside_aid_collect_v1',FOOD_TRANSFER_COVERAGE);
/** Stable physical operation identity; a reservation and later collection differ. */
export function foodTransferKey(r:FoodTransferReceipt):string{
 return r.action==='outsideAid'?JSON.stringify(['outsideAid',r.deliveryId]):JSON.stringify(['foreignTrade',r.operation==='reserveOffer'||r.operation==='reserveShipment'?'reserve':'release',r.operation==='reserveOffer'||r.operation==='reserveShipment'?r.destinationContainer:r.container]);
}
/** Strict physical transfers, never production or eating. */
export function checkedFoodTransfer(input:unknown):FoodTransferReceipt{
 const action=input&&typeof input==='object'?Object.getOwnPropertyDescriptor(input,'action'):undefined;
 if(!action||!('value'in action))return invalid();
 let transfer:FoodTransferReceipt;
 if(action.value==='outsideAid'){
  transfer=object({type:enumeration('transfer'),action:enumeration('outsideAid'),operation:enumeration('collect'),
   at:number,eventId:identifier,deliveryId:identifier,noticeId:identifier,merchantId:identifier,recipientId:identifier,
   container:identifier,destinationContainer:identifier,amount:flowAmount})(input) as FoodTransferReceipt;
  if(transfer.action!=='outsideAid'||transfer.container!==`aid:${transfer.deliveryId}`||transfer.destinationContainer!==`person:${transfer.recipientId}`||transfer.amount.quantity<1)return invalid();
 }else{
  transfer=object({type:enumeration('transfer'),action:enumeration('foreignTrade'),operation:enumeration('reserveOffer','reserveShipment','collect','estateCustody'),
   at:number,eventId:nullable(identifier),offerId:identifier,shipmentId:nullable(identifier),merchantId:identifier,residentId:identifier,personId:nullable(identifier),estateOwnerId:nullable(identifier),
   side:enumeration('import','export'),returned:bool,container:identifier,destinationContainer:identifier,amount:flowAmount})(input) as FoodTransferReceipt;
  if(transfer.action!=='foreignTrade')return invalid();
  const r=transfer,person=`person:${r.residentId}`,offer=`offer:${r.offerId}`,shipment=`shipment:${r.shipmentId}`;
  if(r.operation!=='estateCustody'&&(r.eventId===null||r.estateOwnerId!==null)||r.side==='import'&&r.returned)return invalid();
  if(r.operation==='reserveOffer'||r.operation==='reserveShipment'){
   if(r.side!=='export'||r.returned||r.personId!==r.residentId||r.container!==person||!Number.isSafeInteger(r.amount.quantity)||r.amount.quantity<1
    ||r.amount.lots!==null||r.amount.nutrition!==null)return invalid();
   if(r.operation==='reserveOffer'?(r.shipmentId!==null||r.destinationContainer!==offer):(r.shipmentId===null||r.destinationContainer!==shipment))return invalid();
  }else if(r.operation==='collect'){
   if(r.shipmentId===null||r.personId!==r.residentId||r.container!==shipment||r.destinationContainer!==person||r.side==='export'&&!r.returned)return invalid();
  }else{
   const source=r.shipmentId===null?offer:shipment;
   const destination=`estate-stock:${r.residentId}:foreign-${r.shipmentId===null?'offer:'+r.offerId:'shipment:'+r.shipmentId}`;
   if(r.personId!==null||r.estateOwnerId===null||r.container!==source||r.destinationContainer!==destination||r.shipmentId===null&&(r.side!=='export'||!r.returned)||r.shipmentId!==null&&r.side==='export'&&!r.returned)return invalid();
  }
 }
 if(goods[transfer.amount.item].food<=0)return invalid();
 checkedCraftAmounts([transfer.amount],transfer.at,false);
 return transfer;
}
const flowCommon={at:number,residentId:identifier,eventId:identifier,planId:identifier,container:identifier,definition:definitionKey};
export const checkedCareMeal=(input:unknown)=>object({action:enumeration('care'),at:number,providerId:identifier,beneficiaryId:identifier,
 eventId:identifier,planId:identifier,container:identifier,definition:definitionKey,proposalId:nullable(identifier),
 authority:enumeration('consent','guardian','emergency'),inputs:array(flowAmount),hungerBefore:number,hungerAfter:number,hungerRelief:number})(input) as CareMealReceipt;
export const checkedChildCareMeal=(input:unknown)=>object({action:enumeration('tendChild'),at:number,providerId:identifier,beneficiaryId:identifier,
 eventId:identifier,planId:identifier,container:identifier,definition:definitionKey,authority:enumeration('guardian'),
 inputs:array(flowAmount),hungerBefore:number,hungerAfter:number,hungerRelief:number})(input) as ChildCareMealReceipt;
/** Strict physical feeding facts, independent of current definitions or inferred authority. */
export function checkedEmergencyCareMeal(input:unknown):EmergencyCareMealReceipt{
 const meal=object({action:enumeration('emergencyCare'),operation:enumeration('feed','rescueMeal'),
  at:number,providerId:identifier,beneficiaryId:identifier,eventId:identifier,planId:identifier,container:identifier,
  definition:definitionKey,agreementId:nullable(identifier),mealNumber:nullable(positive),inputs:array(flowAmount),
  hungerBefore:number,hungerAfter:number,hungerRelief:number})(input) as EmergencyCareMealReceipt;
 if(meal.operation==='feed'?(meal.agreementId===null||meal.mealNumber===null||meal.mealNumber>4):(meal.agreementId!==null||meal.mealNumber!==null))return invalid();
 if(meal.providerId===meal.beneficiaryId||meal.container!=='person:'+meal.providerId||meal.inputs.length!==2
  ||!meal.inputs.some(a=>(a.item==='meal'||a.item==='turnip')&&a.quantity===1)
  ||!meal.inputs.some(a=>a.item==='water'&&a.quantity===1))return invalid();
 checkedCraftAmounts(meal.inputs,meal.at,false);
 if(meal.hungerBefore<12||meal.hungerBefore>100||meal.hungerAfter>meal.hungerBefore
  ||Math.abs(meal.hungerBefore-meal.hungerAfter-meal.hungerRelief)>1e-8)return invalid();
 // Unknown original definitions remain unknown, even though the existing engine
 // can apply its own fallback. Never derive original nutrition from hunger relief.
 const nutrition=meal.inputs.find(a=>a.item!=='water')!.nutrition;
 if(nutrition!==null&&Math.abs(meal.hungerAfter-Math.max(0,meal.hungerBefore-nutrition))>1e-8)return invalid();
 return meal;
}
export const checkedLongCareMeal=(input:unknown)=>object({action:enumeration('longCare'),operation:enumeration('visit'),
 at:number,providerId:identifier,beneficiaryId:identifier,eventId:identifier,planId:identifier,container:identifier,
 definition:definitionKey,agreementId:identifier,slotKey:identifier,inputs:array(flowAmount),
 hungerBefore:number,hungerAfter:number,hungerRelief:number,healthBefore:number,healthAfter:number,healthGain:number})(input) as LongCareMealReceipt;
/** Exact physical source and wage deltas, independent of original-lot nutrition. */
export function checkedPublicDutyMeal(input:unknown):PublicDutyMealReceipt{
 const meal=object({action:enumeration('publicDuty'),operation:enumeration('receive'),at:number,providerId:identifier,beneficiaryId:identifier,
  eventId:identifier,planId:identifier,definition:definitionKey,shiftId:identifier,buildingId:identifier,role:enumeration('kitchen','care'),serviceNumber:positive,
  container:identifier,source:enumeration('personal','public'),inputs:array(flowAmount),hungerBefore:number,hungerAfter:number,hungerRelief:number,
  healthBefore:number,healthAfter:number,healthGain:number,funding:nullable(object({budgetId:identifier,account:identifier,wagePerService:positiveQuantity,
   providerCoinsBefore:number,providerCoinsAfter:number,accountBalanceBefore:number,accountBalanceAfter:number,paidBefore:number,paidAfter:number}))})(input) as PublicDutyMealReceipt;
 if(meal.providerId===meal.beneficiaryId||meal.container!==(meal.source==='public'?'public:'+meal.buildingId:'person:'+meal.providerId)
  ||(meal.source==='public')!==(meal.funding!==null)||meal.inputs.length!==2
  ||!meal.inputs.some(a=>a.item===(meal.role==='kitchen'?'turnip':'meal')&&a.quantity===(meal.role==='kitchen'?2:1))
  ||!meal.inputs.some(a=>a.item==='water'&&a.quantity===1))return invalid();
 checkedCraftAmounts(meal.inputs,meal.at,false);
 const relief=meal.role==='kitchen'?42:20,gain=meal.role==='care'?8:0;
 if(meal.hungerBefore>100||meal.healthBefore>100||meal.healthAfter>100
  ||Math.abs(meal.hungerAfter-Math.max(0,meal.hungerBefore-relief))>1e-8
  ||Math.abs(meal.hungerBefore-meal.hungerAfter-meal.hungerRelief)>1e-8
  ||Math.abs(meal.healthAfter-Math.min(100,meal.healthBefore+gain))>1e-8
  ||Math.abs(meal.healthAfter-meal.healthBefore-meal.healthGain)>1e-8)return invalid();
 const f=meal.funding;
 if(f&&(f.account!==`escrow:${meal.shiftId}:wages`
  ||Math.abs(f.providerCoinsAfter-f.providerCoinsBefore-f.wagePerService)>1e-8
  ||Math.abs(f.accountBalanceBefore-f.accountBalanceAfter-f.wagePerService)>1e-8
  ||Math.abs(f.paidAfter-f.paidBefore-f.wagePerService)>1e-8))return invalid();
 return meal;
}
/** Journey pause completions have no plan or mutable action-definition attribution. */
export function checkedJourneyMeal(input:unknown):JourneyMealReceipt{
 const meal=object({action:enumeration('visitorJourney','visitorAid'),operation:enumeration('eat','eatMail'),
  at:number,providerId:identifier,beneficiaryId:identifier,eventId:identifier,journeyId:identifier,container:identifier,
  inputs:array(flowAmount),hungerBefore:number,hungerAfter:number,hungerRelief:number})(input) as JourneyMealReceipt;
 if((meal.action==='visitorJourney'?meal.operation!=='eat':meal.operation!=='eatMail')
  ||meal.providerId!==meal.beneficiaryId||meal.container!=='person:'+meal.providerId
  ||meal.hungerBefore>100||meal.hungerAfter>meal.hungerBefore
  ||Math.abs(meal.hungerBefore-meal.hungerAfter-meal.hungerRelief)>1e-8||meal.inputs.length!==1)return invalid();
 const amount=meal.inputs[0];
 if(goods[amount.item].food<=0||amount.quantity!==1)return invalid();
 // Both physical paths apply known original nutrition before subsequent need drift.
 if(amount.nutrition!==null&&Math.abs(meal.hungerAfter-Math.max(0,meal.hungerBefore-amount.nutrition))>1e-8)return invalid();
 if(amount.lots===null){if(amount.nutrition!==null)return invalid();}
 else{
  if(!amount.lots.length||amount.lots.some(l=>l.producedAt>meal.at||l.expiresAt<=meal.at))return invalid();
  const quantity=amount.lots.reduce((sum,l)=>sum+l.quantity,0);
  const nutrition=amount.lots.some(l=>l.nutrition===null)?null:amount.lots.reduce((sum,l)=>sum+l.nutrition!,0);
  if(!Number.isFinite(quantity)||Math.abs(quantity-amount.quantity)>1e-8||nutrition!==null&&!Number.isFinite(nutrition)
   ||(nutrition===null)!==(amount.nutrition===null)||nutrition!==null&&Math.abs(nutrition-amount.nutrition!)>1e-8)return invalid();
 }
 return meal;
}
/** One physical family-ration portion; transaction completeness is audited separately. */
export function checkedFamilyJourneyMeal(input:unknown):FamilyJourneyMealReceipt{
 const meal=object({action:enumeration('familyRelocation'),operation:enumeration('ration'),trigger:enumeration('depart','resume','travel'),
  at:number,relocationId:identifier,definition:definitionKey,rationNumber:positive,memberIndex:integer,memberCount:integer,
  providerPortion:integer,providerId:identifier,beneficiaryId:identifier,container:identifier,
  inputs:array(flowAmount),hungerBefore:number,hungerAfter:number,hungerRelief:number})(input) as FamilyJourneyMealReceipt;
 if((meal.trigger==='depart'?meal.rationNumber!==1:meal.rationNumber<2)||meal.memberCount<2||meal.memberCount>8||meal.memberIndex>=meal.memberCount||meal.providerPortion>=meal.memberCount
  ||meal.container!=='person:'+meal.providerId||meal.hungerBefore>100||meal.hungerAfter>meal.hungerBefore
  ||Math.abs(meal.hungerBefore-meal.hungerAfter-meal.hungerRelief)>1e-8||meal.inputs.length!==2)return invalid();
 if(!meal.inputs.some(a=>a.item==='meal'&&a.quantity===1)||!meal.inputs.some(a=>a.item==='water'&&a.quantity===1))return invalid();
 checkedCraftAmounts(meal.inputs,meal.at,false);
 const nutrition=meal.inputs.find(a=>a.item==='meal')!.nutrition;
 if(nutrition!==null&&Math.abs(meal.hungerAfter-Math.max(0,meal.hungerBefore-nutrition))>1e-8)return invalid();
 return meal;
}
// Snapshot economics are checked independently of today's mutable definitions.
const craftInventory:Check=v=>{
 if(!v||typeof v!=='object'||Array.isArray(v))return invalid();
 const fields:Record<string,Check>={};
 for(const key of Reflect.ownKeys(v)){
  if(typeof key!=='string'||!itemKeys.includes(key as typeof itemKeys[number]))return invalid();
  fields[key]=n=>{integer(n);return (n as number)<=100000?n:invalid();};
 }
 const result=object(fields)(v) as Record<string,number>;
 return Object.values(result).some(n=>n>0)?result:invalid();
};
const craftRecipe=object({id:identifier,input:craftInventory,output:craftInventory,
 minutes:v=>{positive(v);return (v as number)<=10080?v:invalid();},
 station:enumeration(null,'bench','forge','mill','dairy','loom','preserver'),skill:enumeration('farming','building','care'),
 minimum:v=>{number(v);return (v as number)<=100?v:invalid();}});
function checkedCraftAmounts(amounts:import('../world/food-consumption-evidence.js').FoodFlowAmount[],at:number,output:boolean){
 if(!amounts.length)return invalid();
 const seen=new Set<string>();
 for(const amount of amounts){
  if(seen.has(amount.item))return invalid();seen.add(amount.item);
  if(goods[amount.item].life===0){
   if(amount.nutrition!==0||amount.lots===null||amount.lots.length)return invalid();
   continue;
  }
  if(amount.lots===null){if(amount.nutrition!==null)return invalid();continue;}
  if(!amount.lots.length||amount.lots.some(l=>l.producedAt>at||l.expiresAt<=at||output&&l.producedAt!==at))return invalid();
  const quantity=amount.lots.reduce((sum,l)=>sum+l.quantity,0);
  const nutrition=amount.lots.some(l=>l.nutrition===null)?null:amount.lots.reduce((sum,l)=>sum+l.nutrition!,0);
  if(!Number.isFinite(quantity)||Math.abs(quantity-amount.quantity)>1e-8||nutrition!==null&&!Number.isFinite(nutrition)
   ||(nutrition===null)!==(amount.nutrition===null)||nutrition!==null&&Math.abs(nutrition-amount.nutrition!)>1e-8)return invalid();
 }
}
export function checkedFoodFlow(input:unknown):FoodFlowReceipt{
 const type=typeOf(input);
 if(type==='source_added'){
  const descriptor=Object.getOwnPropertyDescriptor(input,'action');
  if(!descriptor||!('value' in descriptor))return invalid();
  const action=descriptor.value;
  if(action==='harvest_house'||action==='custody_harvest'){
   const flow=object({...flowCommon,type:enumeration(type),action:enumeration(action),sourceId:identifier,
    ...(action==='harvest_house'?{buildingId:identifier,bed:integer,ownerId:identifier}
     :{custodyId:identifier,estateOwnerId:identifier,beneficiaryId:identifier,shareId:identifier,workSerial:integer}),
    outputs:array(flowAmount)})(input) as Extract<FoodFlowReceipt,{action:'harvest_house'|'custody_harvest'}>;
   if(flow.action==='harvest_house'){
    if(flow.ownerId!==flow.residentId||flow.container!=='person:'+flow.residentId)return invalid();
   }else if(flow.container!==`custody-stock:${flow.custodyId}:${flow.workSerial}`
    ||new Set([flow.estateOwnerId,flow.beneficiaryId,flow.residentId]).size!==3)return invalid();
   if(flow.outputs.length!==1||goods[flow.outputs[0].item].life<=0||goods[flow.outputs[0].item].food<=0)return invalid();
   checkedCraftAmounts(flow.outputs,flow.at,true);
   return flow;
  }
  if(action==='fruit_growth'||action==='animal_product'){
   const flow=object({...flowCommon,residentId:enumeration(null),eventId:enumeration(null),planId:enumeration(null),
    type:enumeration(type),action:enumeration(action),ownerId:identifier,sourceId:identifier,
    ...(action==='animal_product'?{species:enumeration('chicken','duck','goat','cow')}:{}),outputs:array(flowAmount)})(input) as FoodFlowReceipt;
   if(flow.action!=='fruit_growth'&&flow.action!=='animal_product')return invalid();
   const item=flow.action==='fruit_growth'?'fruit':flow.species==='chicken'?'egg':flow.species==='duck'?'duckEgg':'milk';
   const container=`${flow.action==='fruit_growth'?'orchard':'animal'}-stock:${flow.sourceId}`;
   if(flow.container!==container||flow.outputs.length!==1||flow.outputs[0].item!==item)return invalid();
   return flow;
  }
  if(action==='fish'||action==='hunt'){
   const flow=object({...flowCommon,type:enumeration(type),action:enumeration(action),
    sourceId:action==='fish'?(v=>typeof v==='string'&&/^shoal:[0-9]+,[0-9]+$/.test(v)&&v.length<=256?v:invalid()):identifier,
    species:enumeration(...(action==='fish'?fishSpecies:Object.keys(beastNames))),outputs:array(flowAmount)})(input) as FoodFlowReceipt;
   if(flow.action!=='fish'&&flow.action!=='hunt')return invalid();
   const item=flow.action==='fish'?fishItems[flow.species]:'gameMeat';
   const quantity=flow.action==='fish'?1:huntedMeatYield[flow.species];
   if(flow.outputs.length!==1||flow.outputs[0].item!==item||flow.outputs[0].quantity!==quantity)return invalid();
   return flow;
  }
 }
 if(type==='source_added')return object({...flowCommon,type:enumeration(type),action:enumeration('gather_berry','harvest'),sourceId:identifier,
  outputs:array(flowAmount)})(input) as FoodFlowReceipt;
 if(type==='processed'){
  const descriptor=Object.getOwnPropertyDescriptor(input,'action');
  if(!descriptor||!('value' in descriptor))return invalid();
  if(descriptor.value==='prototype_trial'){
   const flow=object({...flowCommon,type:enumeration(type),action:enumeration('prototype_trial'),
    definition:enumeration('invention/air-drying@1'),phase:enumeration('started','succeeded','failed','abandoned'),
    trialId:identifier,prototypeId:identifier,designId:identifier,buildingId:identifier,startedAt:number,
    inputItem:enumeration(...prototypeFish),inputQuantity:positive,failureReason:enumeration(null,'overload','expired','rain','sunlight','abandoned'),
    inputs:array(flowAmount),outputs:array(flowAmount)})(input) as PrototypeFlow;
   if(flow.container!=='person:'+flow.residentId||flow.inputQuantity<2||flow.inputQuantity>6)return invalid();
   if(flow.phase==='started'){
    if(flow.at!==flow.startedAt||flow.failureReason!==null||flow.outputs.length||flow.inputs.length!==1
     ||flow.inputs[0].item!==flow.inputItem||flow.inputs[0].quantity!==flow.inputQuantity)return invalid();
    checkedCraftAmounts(flow.inputs,flow.at,false);
   }else{
    if(flow.at<=flow.startedAt||flow.inputs.length)return invalid();
    if(flow.phase==='succeeded'){
     if(flow.failureReason!==null||flow.outputs.length!==1||flow.outputs[0].item!=='driedFish'
      ||flow.outputs[0].quantity!==Math.floor(flow.inputQuantity/2)||flow.outputs[0].lots===null)return invalid();
     checkedCraftAmounts(flow.outputs,flow.at,true);
    }else if(flow.outputs.length||flow.phase==='abandoned'&&flow.failureReason!=='abandoned'
     ||flow.phase==='failed'&&![ 'overload','expired','rain','sunlight'].includes(flow.failureReason!))return invalid();
   }
   return flow;
  }
  if(descriptor.value==='saveSeed'){
   const flow=object({...flowCommon,type:enumeration(type),action:enumeration('saveSeed'),
    inputs:array(flowAmount),outputs:array(flowAmount)})(input) as Extract<FoodFlowReceipt,{action:'saveSeed'}>;
   if(flow.container!=='person:'+flow.residentId||flow.inputs.length!==1||flow.outputs.length!==1
    ||flow.inputs[0].item!=='turnip'||flow.inputs[0].quantity!==1||flow.outputs[0].item!=='seed'||flow.outputs[0].quantity!==2)return invalid();
   checkedCraftAmounts(flow.inputs,flow.at,false);checkedCraftAmounts(flow.outputs,flow.at,true);
   return flow;
  }
  if(descriptor.value==='employment_processing'){
   const flow=object({...flowCommon,type:enumeration(type),action:enumeration('employment_processing'),inputContainer:identifier,
    contractId:identifier,businessId:identifier,employerId:identifier,buildingId:identifier,day:integer,batchNumber:positive,
    recipe:craftRecipe,inputs:array(flowAmount),outputs:array(flowAmount)})(input) as Extract<FoodFlowReceipt,{action:'employment_processing'}>;
   if(flow.inputContainer!==`employment:${flow.contractId}`||flow.container!==`business:${flow.businessId}`
    ||flow.employerId===flow.residentId||flow.day!==Math.floor(flow.at/DAY))return invalid();
   if(![flow.recipe.input,flow.recipe.output].some(bag=>Object.entries(bag).some(([item,n])=>n!>0&&goods[item as typeof itemKeys[number]].life>0)))return invalid();
   checkedCraftAmounts(flow.inputs,flow.at,false);checkedCraftAmounts(flow.outputs,flow.at,true);
   // Employment rejects incomplete or surplus reserved stock before production.
   for(const [bag,amounts] of [[flow.recipe.input,flow.inputs],[flow.recipe.output,flow.outputs]] as const){
    const entries=Object.entries(bag).filter(([,n])=>n!>0);
    if(amounts.length!==entries.length||entries.some(([item,n])=>!amounts.some(a=>a.item===item&&a.quantity===n)))return invalid();
   }
   if(Object.values(flow.recipe.input).some(n=>n!<=0))return invalid();
   return flow;
  }
  if(descriptor.value==='industry_craft'){
   const flow=object({...flowCommon,type:enumeration(type),action:enumeration('industry_craft'),inputContainer:identifier,
    batchId:identifier,buildingId:identifier,recipe:craftRecipe,inputs:array(flowAmount),outputs:array(flowAmount)})(input) as Extract<FoodFlowReceipt,{action:'industry_craft'}>;
   if(flow.inputContainer!==`craft:${flow.batchId}`||flow.container!==`person:${flow.residentId}`)return invalid();
   if(![flow.recipe.input,flow.recipe.output].some(bag=>Object.entries(bag).some(([item,n])=>n!>0&&goods[item as typeof itemKeys[number]].life>0)))return invalid();
   checkedCraftAmounts(flow.inputs,flow.at,false);checkedCraftAmounts(flow.outputs,flow.at,true);
   if(Object.entries(flow.recipe.input).some(([item,n])=>n!>0&&!(flow.inputs.some(a=>a.item===item&&a.quantity>=n!))))return invalid();
   const output=Object.entries(flow.recipe.output).filter(([,n])=>n!>0);
   if(flow.outputs.length!==output.length||output.some(([item,n])=>!flow.outputs.some(a=>a.item===item&&a.quantity===n)))return invalid();
   return flow;
  }
  return object({...flowCommon,type:enumeration(type),action:enumeration('cook'),inputs:array(flowAmount),outputs:array(flowAmount)})(input) as FoodFlowReceipt;
 }
 return invalid();
}
const foods:Record<string,Record<string,Check>>={food_session_started:{fromMinute:number},
 food_step_committed:{fromMinute:number,toMinute:number,revision:integer,receipts:array(receipt)},food_session_stopped:{toMinute:number}};
export function checkedFoodEvent(input:unknown):RuntimeFoodEvent{
 const type=typeOf(input);if(!Object.hasOwn(foods,type))return invalid();
 const extra:Record<string,Check>={};
 if(type==='food_step_committed'){
  if(Object.hasOwn(input as object,'foodOwnershipCoverage')){
   if(!Object.hasOwn(input as object,'foodOwnershipChanges'))return invalid();
   extra.foodOwnershipCoverage=foodOwnershipCoverage;
  }
  if(Object.hasOwn(input as object,'foodOwnershipChanges'))extra.foodOwnershipChanges=array(checkedFoodOwnership);
  if(Object.hasOwn(input as object,'foodTransferCoverage')){
   if(!Object.hasOwn(input as object,'foodTransfers'))return invalid();
   extra.foodTransferCoverage=foodTransferCoverage;
  }
  if(Object.hasOwn(input as object,'foodTransfers'))extra.foodTransfers=array(checkedFoodTransfer);
  if(Object.hasOwn(input as object,'foodFlowCoverage')){
   if(!Object.hasOwn(input as object,'foodFlows'))return invalid();
   extra.foodFlowCoverage=foodFlowCoverage;
  }
  if(Object.hasOwn(input as object,'foodFlows'))extra.foodFlows=array(checkedFoodFlow);
  if(Object.hasOwn(input as object,'foodLossCoverage')){
   if(!Object.hasOwn(input as object,'foodLosses'))return invalid();
   extra.foodLossCoverage=foodLossCoverage;
  }
  if(Object.hasOwn(input as object,'foodLosses'))extra.foodLosses=array(checkedFoodLoss);
  if(Object.hasOwn(input as object,'careMeals'))extra.careMeals=array(checkedCareMeal);
  if(Object.hasOwn(input as object,'childCareMeals'))extra.childCareMeals=array(checkedChildCareMeal);
  if(Object.hasOwn(input as object,'emergencyCareMeals'))extra.emergencyCareMeals=array(checkedEmergencyCareMeal);
  if(Object.hasOwn(input as object,'familyJourneyMeals'))extra.familyJourneyMeals=array(checkedFamilyJourneyMeal);
  if(Object.hasOwn(input as object,'journeyMeals'))extra.journeyMeals=array(checkedJourneyMeal);
  if(Object.hasOwn(input as object,'longCareMeals'))extra.longCareMeals=array(checkedLongCareMeal);
  if(Object.hasOwn(input as object,'publicDutyMeals'))extra.publicDutyMeals=array(checkedPublicDutyMeal);
 }
 const event=object({...common,worldId:identifier,type:enumeration(type),...foods[type],...extra})(input) as RuntimeFoodEvent;
 if(event.type==='food_step_committed'&&event.foodOwnershipChanges!==undefined)
  checkedFoodOwnershipChanges(event.foodOwnershipChanges,event.fromMinute,event.toMinute);
 return event;
}
export const waitStatus=nullable(object({sessionId:nullable(identifier),phase:enumeration('not_started','observing','stopped','failed'),
 lastSequence:integer,failure:enumeration(null,'observer_threw','async_observer'),monotonicClockValid:bool,openWaits:integer,openRequests:integer}));
export const foodStatus=nullable(object({sessionId:nullable(identifier),worldId:nullable(identifier),phase:enumeration('not_started','observing','stopped','failed'),
 lastSequence:integer,throughMinute:nullable(number),failure:enumeration(null,'observer_threw','async_observer','coverage_discontinuity')}));
export type EvidenceStatuses={decisionWaiting:ReturnType<DecisionWaitEvidence['status']>|null;directEating:RuntimeFoodEvidenceStatus|null};
export const checkedStatuses=(input:unknown)=>object({decisionWaiting:waitStatus,directEating:foodStatus})(input) as EvidenceStatuses;
export const stopReasons=['scope_finished','storage_failed','model_failed','limit_reached',...ACCEPTANCE_STOP_REASONS] as const;
export type StopReason=typeof stopReasons[number];
export const stopReason=enumeration(...stopReasons);

/** Only fixed control fields, never model text, whole worlds or arbitrary errors. */
export const checkedAcceptanceControl=(input:unknown)=>object({
 phase:enumeration('not_started','running','stopped'),reason:nullable(enumeration(...ACCEPTANCE_STOP_REASONS)),
 fromMinute:nullable(number),throughMinute:nullable(number),targetMinute:number,maxWallMs:positive,maxRequests:positive,
 elapsedMs:nullable(number),requestReservations:integer,dispatchedRequests:integer,settledResponses:integer,
 interruptedRequests:integer,unfinishedRequests:array(object({id:positive,model,dispatched:bool})),
 unknownCostRequests:integer,confirmedCostUsd:nullable(number),
 endpoint:nullable(object({worldId:identifier,gameMinute:number,revision:integer,
  residents:array(object({id:identifier,status:enumeration('alive','dead'),health:number,hunger:number,energy:number}))})),
 gameScopeComplete:bool,controlComplete:bool,
 issues:array(enumeration('shutdown_failed','timer_failed','endpoint_observer_failed','evidence_persistence_failed')),
 remoteCancellationConfirmed:enumeration(false),acceptancePassed:enumeration(null),
})(input) as AcceptanceStopStatus;

export type PrototypeFlow=Extract<FoodFlowReceipt,{action:'prototype_trial'}>;
export type PrototypeFlowHistory=Map<string,{first:PrototypeFlow;started:boolean;terminal:boolean}>;
/** Mutate only a caller-owned staged history; terminal-only capture is valid after reload. */
export function recordPrototypeFlow(history:PrototypeFlowHistory,flow:PrototypeFlow){
 const prior=history.get(flow.trialId),started=flow.phase==='started';
 if(prior){
  if(started||prior.terminal)throw new Error('Duplicate prototype trial phase');
  const first=prior.first;
  for(const key of ['residentId','container','definition','prototypeId','designId','buildingId','startedAt','inputItem','inputQuantity'] as const)
   if(flow[key]!==first[key])throw new Error('Inconsistent prototype trial identity');
  if(flow.at<=first.at)throw new Error('Invalid prototype trial sequence');
 }
 history.set(flow.trialId,{first:prior?.first??flow,started:started||prior?.started===true,terminal:!started});
}

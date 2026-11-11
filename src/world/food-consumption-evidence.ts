import type {Inventory,Item,Resident,World} from '../shared/types.js';
import type {FoodLot} from '../shared/food.js';
import type {CraftRecipe} from '../shared/industry.js';
import type {prototypeFish} from '../shared/prototypes.js';
import type {FishSpecies} from '../shared/fish-species.js';
import type {WildBeast} from '../shared/frontier-hazards.js';
import {goods} from '../shared/items.js';

/** Older collectors did not observe the separate prototype debit and terminal outcome. */
export const FOOD_FLOW_COVERAGE='gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_prototype_v1' as const;
export type FoodFlowCoverage=typeof FOOD_FLOW_COVERAGE|'gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_seed_v1'|'gather_harvest_cook_fish_hunt_growth_craft_employment_house_custody_v1'|'gather_harvest_cook_fish_hunt_growth_craft_employment_v1'|'gather_harvest_cook_fish_hunt_growth_craft_v1'|'gather_harvest_cook_fish_hunt_growth_v1'|'gather_harvest_cook_fish_hunt_v1';
export type FoodCraftRecipe=Omit<CraftRecipe,'name'>;
export interface FoodFlowLot extends FoodLot {nutrition:number|null;}
export interface FoodFlowAmount {item:Item;quantity:number;nutrition:number|null;lots:FoodFlowLot[]|null;}
/** Narrow physical custody changes only, never a complete boundary ledger. */
export const FOOD_TRANSFER_COVERAGE='outside_aid_foreign_trade_v1' as const;
export type FoodTransferCoverage=typeof FOOD_TRANSFER_COVERAGE|'outside_aid_collect_v1';
export interface OutsideAidFoodTransferReceipt {
 type:'transfer';action:'outsideAid';operation:'collect';at:number;eventId:string;
 deliveryId:string;noticeId:string;merchantId:string;recipientId:string;
 container:string;destinationContainer:string;amount:FoodFlowAmount;
}
export interface ForeignFoodTransferReceipt {
 type:'transfer';action:'foreignTrade';operation:'reserveOffer'|'reserveShipment'|'collect'|'estateCustody';
 at:number;eventId:string|null;offerId:string;shipmentId:string|null;merchantId:string;residentId:string;
 personId:string|null;estateOwnerId:string|null;side:'import'|'export';returned:boolean;
 container:string;destinationContainer:string;amount:FoodFlowAmount;
}
export type FoodTransferReceipt=OutsideAidFoodTransferReceipt|ForeignFoodTransferReceipt;
/** Legal ownership of existing food only: no movement, production or intake. */
export const FOOD_OWNERSHIP_COVERAGE='production_inherit_existing_food_v1' as const;
export interface FoodOwnershipAmount {item:Item;quantity:number|null;nutrition:null;lots:null;}
export interface FoodOwnershipStock {
 containerType:'estate-stock'|'orchard-stock'|'animal-stock';container:string;
 fromOwnerId:string|null;toOwnerId:string;ambiguous:boolean;amounts:FoodOwnershipAmount[];
}
export interface FoodOwnershipReceipt {
 type:'ownership_change';action:'production';operation:'inherit';at:number;eventId:string;planId:string|null;
 estatePersonId:string;shareId:string;heirId:string;stocks:FoodOwnershipStock[];
}
/** A separate partial loss slice; older food flow collectors did not observe it. */
export const FOOD_LOSS_COVERAGE='advance_food_spoilage_v1' as const;
export const FOOD_LOSS_CONTAINER_TYPES=['person','estate','estate-stock','business','public','public-reserve','listing','aid','offer','shipment','orchard-stock','animal-stock','employment','craft','culture-prep','culture-food','family-stock','family-gift'] as const;
export type FoodLossContainerType=typeof FOOD_LOSS_CONTAINER_TYPES[number];
export interface FoodLossReceipt {type:'loss';cause:'spoilage';at:number;occurrence:number;containerType:FoodLossContainerType;container:string;amount:FoodFlowAmount;}

type FoodFlowIdentity={at:number;residentId:string;eventId:string;planId:string;container:string;definition:string};
/** Gross physical operations, not a net production or consumption ledger. */
export type NaturalFoodFlowReceipt={type:'source_added';at:number;residentId:null;eventId:null;planId:null;
 ownerId:string;container:string;definition:string;sourceId:string;outputs:FoodFlowAmount[]}&(
 |{action:'fruit_growth'}
 |{action:'animal_product';species:'chicken'|'duck'|'goat'|'cow'});
export type FoodFlowReceipt=NaturalFoodFlowReceipt|FoodFlowIdentity&(
 |{type:'source_added';action:'gather_berry'|'harvest';sourceId:string;outputs:FoodFlowAmount[]}
 |{type:'source_added';action:'harvest_house';sourceId:string;buildingId:string;bed:number;ownerId:string;outputs:FoodFlowAmount[]}
 // The worker never receives this output. Its physical estate parcel retains
 // the original owner and the child's separately protected inheritance share.
 |{type:'source_added';action:'custody_harvest';sourceId:string;custodyId:string;estateOwnerId:string;beneficiaryId:string;
   shareId:string;workSerial:number;outputs:FoodFlowAmount[]}
 |{type:'source_added';action:'fish';sourceId:string;species:FishSpecies;outputs:FoodFlowAmount[]}
 |{type:'source_added';action:'hunt';sourceId:string;species:WildBeast['species'];outputs:FoodFlowAmount[]}
 // Prototype input is spent only at start; terminal outcomes never repeat that debit.
 |{type:'processed';action:'prototype_trial';phase:'started'|'succeeded'|'failed'|'abandoned';
   trialId:string;prototypeId:string;designId:string;buildingId:string;startedAt:number;
   inputItem:typeof prototypeFish[number];inputQuantity:number;failureReason:'overload'|'expired'|'rain'|'sunlight'|'abandoned'|null;
   inputs:FoodFlowAmount[];outputs:FoodFlowAmount[]}
 // Direct seed saving has no batch or recipe: its actual completed activity and event identify the fixed conversion.
 |{type:'processed';action:'saveSeed';inputs:FoodFlowAmount[];outputs:FoodFlowAmount[]}
 |{type:'processed';action:'cook';inputs:FoodFlowAmount[];outputs:FoodFlowAmount[]}
 |{type:'processed';action:'industry_craft';batchId:string;buildingId:string;inputContainer:string;recipe:FoodCraftRecipe;inputs:FoodFlowAmount[];outputs:FoodFlowAmount[]}
 // Employment has no persistent batch ID. The original per-contract attendance
 // counter identifies one completion on its actual work day, including reloads.
 |{type:'processed';action:'employment_processing';contractId:string;businessId:string;employerId:string;buildingId:string;
   inputContainer:string;day:number;batchNumber:number;recipe:FoodCraftRecipe;inputs:FoodFlowAmount[];outputs:FoodFlowAmount[]});

/** An actual successful engine `eat`, not a stock delta or a hunger estimate. */
export interface DirectEatingReceipt {
 at:number;
 residentId:string;
 eventId:string;
 planId:string;
 container:string;
 item:Item;
 quantity:number;
 nutrition:number;
 hungerRelief:number;
}
/** One completed ordinary care action. Nutrition is original food, not relief. */
export interface CareMealReceipt {
 action:'care';at:number;providerId:string;beneficiaryId:string;eventId:string;planId:string;
 container:string;definition:string;proposalId:string|null;authority:'consent'|'guardian'|'emergency';
 inputs:FoodFlowAmount[];hungerBefore:number;hungerAfter:number;hungerRelief:number;
}
/** One completed existing guardian tendChild action; never ordinary care or emergencyCare. */
export interface ChildCareMealReceipt {
 action:'tendChild';at:number;providerId:string;beneficiaryId:string;eventId:string;planId:string;
 container:string;definition:string;authority:'guardian';inputs:FoodFlowAmount[];
 hungerBefore:number;hungerAfter:number;hungerRelief:number;
}
/** Actual child emergency feeding only. A finite agreement or one-time rescue,
 * never the offer, review, acceptance, reservation or guardian tendChild action. */
export interface EmergencyCareMealReceipt {
 action:'emergencyCare';operation:'feed'|'rescueMeal';at:number;providerId:string;beneficiaryId:string;eventId:string;planId:string;
 container:string;definition:string;agreementId:string|null;mealNumber:number|null;inputs:FoodFlowAmount[];
 hungerBefore:number;hungerAfter:number;hungerRelief:number;
}
/** One successful signed long-care visit; original inputs, hunger and health are distinct facts. */
export interface LongCareMealReceipt {
 action:'longCare';operation:'visit';at:number;providerId:string;beneficiaryId:string;eventId:string;planId:string;
 container:string;definition:string;agreementId:string;slotKey:string;inputs:FoodFlowAmount[];
 hungerBefore:number;hungerAfter:number;hungerRelief:number;
 healthBefore:number;healthAfter:number;healthGain:number;
}
/** Actual beneficiary-requested public service. Physical stock, wage settlement,
 * original-lot nutrition and immediate effects remain separate observations. */
export interface PublicDutyMealReceipt {
 action:'publicDuty';operation:'receive';at:number;providerId:string;beneficiaryId:string;eventId:string;planId:string;
 definition:string;shiftId:string;buildingId:string;role:'kitchen'|'care';serviceNumber:number;
 container:string;source:'personal'|'public';inputs:FoodFlowAmount[];
 hungerBefore:number;hungerAfter:number;hungerRelief:number;healthBefore:number;healthAfter:number;healthGain:number;
 funding:null|{budgetId:string;account:string;wagePerService:number;
  providerCoinsBefore:number;providerCoinsAfter:number;accountBalanceBefore:number;accountBalanceAfter:number;paidBefore:number;paidAfter:number};
}
/** Actual self-carried meal at a completed regional pause, not a transfer or reserved ration. */
export type JourneyMealReceipt={
 at:number;providerId:string;beneficiaryId:string;eventId:string;journeyId:string;container:string;
 inputs:FoodFlowAmount[];hungerBefore:number;hungerAfter:number;hungerRelief:number;
}&({action:'visitorJourney';operation:'eat'}|{action:'visitorAid';operation:'eatMail'});
/** One member's physical portion in a family ration transaction. No world event
 * is invented: the saved ration counter and member order identify the debit. */
export interface FamilyJourneyMealReceipt {
 action:'familyRelocation';operation:'ration';trigger:'depart'|'resume'|'travel';at:number;
 relocationId:string;definition:string;rationNumber:number;memberIndex:number;memberCount:number;providerPortion:number;
 providerId:string;beneficiaryId:string;container:string;inputs:FoodFlowAmount[];
 hungerBefore:number;hungerAfter:number;hungerRelief:number;
}
export interface DirectEatingObservation {
 worldId:string;
 fromMinute:number;
 toMinute:number;
 receipts:DirectEatingReceipt[];
 /** Absent on legacy observations: coverage of these operations is unknown. */
 foodFlows?:FoodFlowReceipt[];
 /** Absent on older collectors even when their original foodFlows array exists. */
 foodFlowCoverage?:FoodFlowCoverage;
 /** Explicitly observed physical expiry only, never transfers or all-world loss. */
 foodLosses?:FoodLossReceipt[];
 foodLossCoverage?:typeof FOOD_LOSS_COVERAGE;
 /** Narrow aid/foreign custody transfers. Missing or older coverage is unknown. */
 foodTransfers?:FoodTransferReceipt[];
 foodTransferCoverage?:FoodTransferCoverage;
 /** Existing food ownership at successful inheritance; absent means unknown. */
 foodOwnershipChanges?:FoodOwnershipReceipt[];
 foodOwnershipCoverage?:typeof FOOD_OWNERSHIP_COVERAGE;
 /** Absent on older observations: ordinary-care coverage is unknown. */
 careMeals?:CareMealReceipt[];
 /** Absent on older observations: guardian child-tending coverage is unknown. */
 childCareMeals?:ChildCareMealReceipt[];
 /** Successful emergencyCare feed/rescueMeal only; absent means unobserved. */
 emergencyCareMeals?:EmergencyCareMealReceipt[];
 /** Absent on older observations: signed long-care visit coverage is unknown. */
 longCareMeals?:LongCareMealReceipt[];
 /** Public kitchen/care receive only. Absent means this slice was unobserved. */
 publicDutyMeals?:PublicDutyMealReceipt[];
 /** Only completed visitorJourney.eat and visitorAid.eatMail. Absent means unobserved. */
 journeyMeals?:JourneyMealReceipt[];
 /** Family relocation physical member portions only. Absent means unobserved. */
 familyJourneyMeals?:FamilyJourneyMealReceipt[];
}

// Observation belongs to one synchronous engine invocation, never to the world,
// residents, their forecasts or their serialized knowledge/persistence state.
type Capture={foodOwnershipChanges:FoodOwnershipReceipt[];foodTransfers:FoodTransferReceipt[];foodLosses:FoodLossReceipt[];unprovenLossLots:Set<string>;receipts:DirectEatingReceipt[];foodFlows:FoodFlowReceipt[];careMeals:CareMealReceipt[];childCareMeals:ChildCareMealReceipt[];emergencyCareMeals:EmergencyCareMealReceipt[];longCareMeals:LongCareMealReceipt[];publicDutyMeals:PublicDutyMealReceipt[];journeyMeals:JourneyMealReceipt[];familyJourneyMeals:FamilyJourneyMealReceipt[];pending:Map<FoodFlowAmount,FoodFlowLot[]>};
const active=new WeakMap<World,Capture>();
// Transient FIFO evidence for exact direct meals. It is intentionally absent
// from serialized receipts, save files and the public accounting protocol.
const directInputs=new WeakMap<DirectEatingReceipt,FoodFlowAmount[]|undefined>();
export function directEatingOriginalInputs(receipt:DirectEatingReceipt){const inputs=directInputs.get(receipt);return inputs&&structuredClone(inputs);}
export function recordDirectEating(world:World,receipt:DirectEatingReceipt):void {
 const capture=active.get(world);if(!capture)return;
 // The engine has debited the bag, but the surrounding foodTransaction has
 // not yet removed its original lots. Capture that exact consumed FIFO slice.
 directInputs.set(receipt,foodFlowInputs(world,receipt.container,{[receipt.item]:receipt.quantity},1,true));
 capture.receipts.push(receipt);
}
export function recordCareMeal(world:World,receipt:CareMealReceipt):void {active.get(world)?.careMeals.push(receipt);}
export function recordEmergencyCareMeal(world:World,receipt:EmergencyCareMealReceipt):void {active.get(world)?.emergencyCareMeals.push(receipt);}
export function recordChildCareMeal(world:World,receipt:ChildCareMealReceipt):void {active.get(world)?.childCareMeals.push(receipt);}

export function recordLongCareMeal(world:World,receipt:LongCareMealReceipt):void {active.get(world)?.longCareMeals.push(receipt);}
export function recordPublicDutyMeal(world:World,receipt:PublicDutyMealReceipt):void {active.get(world)?.publicDutyMeals.push(receipt);}
export function recordJourneyMeal(world:World,receipt:JourneyMealReceipt):void {active.get(world)?.journeyMeals.push(receipt);}
export function recordFamilyJourneyMeal(world:World,receipt:FamilyJourneyMealReceipt):void {active.get(world)?.familyJourneyMeals.push(receipt);}
export function recordFoodTransfer(world:World,receipt:FoodTransferReceipt):void {active.get(world)?.foodTransfers.push(receipt);}
export function observesFoodOwnership(world:World):boolean{return active.has(world);}
export function recordFoodOwnership(world:World,receipt:FoodOwnershipReceipt):void {active.get(world)?.foodOwnershipChanges.push(receipt);}

const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function observedLot(world:World,item:Item,lot:FoodLot,quantity:number):FoodFlowLot|null {
 if(!finite(lot.quantity)||!finite(lot.producedAt)||lot.producedAt>world.minute||!finite(lot.expiresAt)||lot.expiresAt<=world.minute
  ||typeof lot.definition!=='string'||!finite(quantity)||quantity<=0)return null;
 const value=(world.definitions[lot.definition]?.data.nutrition as Record<string,unknown>|undefined)?.[item];
 return {quantity,producedAt:lot.producedAt,expiresAt:lot.expiresAt,definition:lot.definition,
  nutrition:finite(value)&&Number.isFinite(value*quantity)?value*quantity:null};
}
function amount(item:Item,quantity:number):FoodFlowAmount{return {item,quantity,nutrition:null,lots:null};}
function attachLots(target:FoodFlowAmount,lots:FoodFlowLot[]){
 if(Math.abs(lots.reduce((n,l)=>n+l.quantity,0)-target.quantity)>1e-9)return;
 target.lots=lots;target.nutrition=lots.every(l=>l.nutrition!==null)?lots.reduce((n,l)=>n+l.nutrition!,0):null;
 if(target.nutrition!==null&&!Number.isFinite(target.nutrition))target.nutrition=null;
}
/** Reads only this operation's existing original lots before its real consume.
 * Never initializes, repairs, inventories containers or falls back to current nutrition. */
export function foodFlowInputs(world:World,container:string,cost:Inventory,multiple:number,requireOriginal=false,offset=0):FoodFlowAmount[]|undefined {
 if(!active.has(world))return;
 return (Object.entries(cost) as [Item,number][]).filter(([,n])=>n>0).map(([item,n])=>{
  const target=amount(item,n*multiple);
  // Raw hunted meat is not directly edible, but still has real perishable lots.
  if(goods[item].life===0){target.nutrition=0;target.lots=[];return target;}
  const original=world.food?.lots[container]?.[item];if(!Array.isArray(original))return target;
  if(original.some(l=>!l||!finite(l.quantity)||!finite(l.producedAt)||!finite(l.expiresAt)
   ||requireOriginal&&(typeof l.definition!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/.test(l.definition)
    ||active.get(world)!.unprovenLossLots.has(lossLotKey(item,l)))))return target;
  let left=target.quantity,skip=offset;const taken:FoodFlowLot[]=[];
  for(const lot of [...original].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt)){
   if(left<=1e-9)break;const skipped=Math.min(skip,lot.quantity);skip-=skipped;
   const q=Math.min(left,lot.quantity-skipped);if(q<=0)continue;
   const observed=observedLot(world,item,lot,q);if(!observed)return target;taken.push(observed);left-=q;
  }
  attachLots(target,taken);return target;
 });
}
/** Collection moves the complete remaining cargo. Snapshot before foodTransaction
 * can initialize/repair it; a mismatching or repaired ledger proves no original lot. */
export function outsideAidTransferAmount(world:World,container:string,item:Item,quantity:number,reservedAt:number):FoodFlowAmount|undefined {
 const value=foodFlowInputs(world,container,{[item]:quantity},1,true)?.[0];if(!value)return;
 const original=world.food?.lots[container]?.[item];
 const held=Array.isArray(original)&&original.every(l=>l&&finite(l.quantity)&&l.quantity>0)?original.reduce((n,l)=>n+l.quantity,0):undefined;
 // Cargo cannot produce new food. A lot created at/after reservation might be
 // initialization replacing missing metadata, including on an earlier step or
 // before SQLite reload. The same-minute case is indistinguishable, so stays
 // unknown too. This requires no hidden persistent state or new save fields.
 if(!finite(held)||Math.abs(held-quantity)>1e-9||!finite(reservedAt)||original!.some(l=>l.producedAt>=reservedAt)){
  value.lots=null;value.nutrition=null;
 }
 return value;
}
/** Personal inventory can produce food and can have been repaired on an earlier
 * step. Existing saves contain no provenance bit distinguishing those histories.
 * Preserve the confirmed physical quantity but never claim original batch proof. */
export function foreignPersonalTransferAmount(world:World,_person:Resident,item:Item,quantity:number):FoodFlowAmount|undefined {
 if(!active.has(world)||goods[item]?.food<=0||!finite(quantity)||quantity<=0)return;
 return amount(item,quantity);
}
/** Cargo cannot generate new food. Repaired/same-minute metadata stays unknown. */
export function foreignCargoTransferAmount(world:World,container:string,item:Item,quantity:number,reservedAt:number):FoodFlowAmount|undefined {
 if(goods[item]?.food<=0||!finite(quantity)||quantity<=0)return;
 return outsideAidTransferAmount(world,container,item,quantity,reservedAt);
}
/** A following foodTransaction may repair an inconsistent ledger before debiting.
 * Such a repair cannot prove which original batch fed this traveller. */
export function journeyMealInputs(world:World,provider:Resident,item:Item):FoodFlowAmount[]|undefined {
 const inputs=foodFlowInputs(world,'person:'+provider.id,{[item]:1},1,true);if(!inputs)return;
 const original=world.food?.lots['person:'+provider.id]?.[item];
 const held=Array.isArray(original)&&original.every(l=>l&&finite(l.quantity))?original.reduce((n,l)=>n+l.quantity,0):undefined;
 if(!finite(held)||!finite(provider.inventory[item])||Math.abs(held-provider.inventory[item]!)>1e-9){
  inputs[0].lots=null;inputs[0].nutrition=null;
 }
 return inputs;
}
/** Called for all members before the single food transaction starts, while both
 * inventory and original lots still describe the same pre-debit provider stock.
 * Offset is the provider's prior portions, not a whole-group stock delta. */
export function familyJourneyMealInputs(world:World,provider:Resident,providerPortion:number):FoodFlowAmount[]|undefined {
 const inputs=foodFlowInputs(world,'person:'+provider.id,{meal:1,water:1},1,true,providerPortion);if(!inputs)return;
 const original=world.food?.lots['person:'+provider.id]?.meal;
 const held=Array.isArray(original)&&original.every(l=>l&&finite(l.quantity))?original.reduce((n,l)=>n+l.quantity,0):undefined;
 if(!finite(held)||!finite(provider.inventory.meal)||Math.abs(held-provider.inventory.meal!)>1e-9){
  inputs[0].lots=null;inputs[0].nutrition=null;
 }
 return inputs;
}
/** Craft and employment reservation are transfers, not processing. Only completion calls this,
 * reading the physical batch before it leaves the working-container set. A same-step
 * initialization repair cannot certify original input lots or nutrition. */
export function craftFoodFlowInputs(world:World,container:string,input:Inventory,recipe:CraftRecipe):FoodFlowAmount[]|undefined {
 if(!active.has(world)||![...Object.entries(recipe.input),...Object.entries(recipe.output)]
  .some(([item,n])=>n!>0&&goods[item as Item].life>0))return;
 return foodFlowInputs(world,container,input,1,true);
}
type FoodFlowOperation<T=FoodFlowReceipt>=T extends {type:'source_added'}?Omit<T,'outputs'>&{output:Inventory}
 :T extends {type:'processed'}?Omit<T,'outputs'|'inputs'>&{output:Inventory;inputs:FoodFlowAmount[]|undefined}:never;
export function recordFoodFlow(world:World,receipt:FoodFlowOperation):void {
 const capture=active.get(world);if(!capture)return;
 const {output,...body}=receipt;
 const outputs=(Object.entries(output) as [Item,number][]).filter(([,quantity])=>quantity>0).map(([item,quantity])=>{
  const target=amount(item,quantity);
  if(goods[item].life===0){target.nutrition=0;target.lots=[];}else capture.pending.set(target,[]);
  return target;
 });
 capture.foodFlows.push({...body,outputs} as FoodFlowReceipt);
}
/** Natural growth has no acting resident, plan or world event. The owner is
 * an asset identity, not a producer or recipient. Only the exact physical
 * transaction can attach the original fresh lots below. */
export function recordNaturalFoodFlow(world:World,receipt:Omit<NaturalFoodFlowReceipt,'residentId'|'eventId'|'planId'|'outputs'|'action'>&
 ({action:'fruit_growth'}|{action:'animal_product';species:'chicken'|'duck'|'goat'|'cow'})&{output:Inventory}):void {
 recordFoodFlow(world,{...receipt,residentId:null,eventId:null,planId:null});
}
/** Invoked only where foodTransaction actually creates a fresh output lot.
 * Transfers, initialization and unrelated production have no matching pending operation. */
export function recordFoodFlowOutputLot(world:World,container:string,item:Item,lot:FoodLot):void {
 const capture=active.get(world),receipt=capture?.foodFlows.at(-1);
 if(!capture||!receipt||receipt.container!==container||receipt.at!==world.minute)return;
 const target=receipt.outputs.find(a=>a.item===item),lots=target&&capture.pending.get(target);
 if(!lots)return;
 const observed=observedLot(world,item,lot,lot.quantity);if(observed)lots.push(observed);
}
/** End the same physical transaction, including a failure, without retaining hooks. */
export function finishFoodFlowAction(world:World):void {
 const capture=active.get(world);if(!capture)return;
 for(const [target,lots]of capture.pending)attachLots(target,lots);
 capture.pending.clear();
}

/** Metadata-only provenance: initialization is not a new physical production.
 * A repaired lot stays unknown through same-capture transfers/merges. Colliding
 * metadata is conservatively unknown, never certified by a current definition. */
const lossLotKey=(item:Item,lot:FoodLot)=>JSON.stringify([item,lot.producedAt,lot.expiresAt,lot.definition]);
export function markUnprovenFoodLossLot(world:World,item:Item,lot:FoodLot):void {
 const capture=active.get(world);if(capture&&typeof lot?.definition==='string')capture.unprovenLossLots.add(lossLotKey(item,lot));
}
export function foodLossContainerTypes(world:World):Map<string,FoodLossContainerType>|undefined {
 return active.has(world)?new Map():undefined;
}
type LossOriginals=Map<string,Partial<Record<Item,FoodLot[]>>>;
/** Read only already-existing ledgers before advanceFood's original initialization.
 * No container enumeration, stock repair, definition initialization or save fields. */
export function foodLossOriginals(world:World):LossOriginals|undefined {
 if(!active.has(world))return;
 const result:LossOriginals=new Map();
 for(const [container,ledger] of Object.entries(world.food?.lots??{})){
  const items:Partial<Record<Item,FoodLot[]>>={};
  for(const [item,lots] of Object.entries(ledger))if(Array.isArray(lots))items[item as Item]=lots.map(l=>({quantity:l?.quantity,producedAt:l?.producedAt,expiresAt:l?.expiresAt,definition:l?.definition}));
  result.set(container,items);
 }
 return result;
}
/** Called immediately after one real physical debit; public aggregate updates,
 * initialization, inventory transfers and cancellation refunds do not call it. */
export function recordFoodSpoilage(world:World,container:string,containerType:FoodLossContainerType|undefined,item:Item,
 quantity:number,expired:FoodLot[],originals:LossOriginals|undefined):void {
 const capture=active.get(world);if(!capture||!containerType||!finite(quantity)||quantity<=0)return;
 const target=amount(item,quantity),original=originals?.get(container)?.[item];
 // Matching the complete expired subset proves no initialization fabricated or
 // clipped this debit. Any malformed original metadata keeps batch facts unknown.
 const valid=(lot:FoodLot)=>!!lot&&finite(lot.quantity)&&lot.quantity>0&&finite(lot.producedAt)&&finite(lot.expiresAt)
  &&lot.producedAt<=lot.expiresAt&&lot.producedAt<=world.minute&&typeof lot.definition==='string'
  &&/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/.test(lot.definition);
 const prior=original?.filter(l=>l&&l.expiresAt<=world.minute);
 if(original?.every(valid)&&prior&&prior.length===expired.length&&prior.every((l,index)=>{
  const now=expired[index];return valid(now)&&l.quantity===now.quantity&&lossLotKey(item,l)===lossLotKey(item,now)
   &&!capture.unprovenLossLots.has(lossLotKey(item,l));
 })){
  const lots=prior.map(l=>{const value=(world.definitions[l.definition]?.data.nutrition as Record<string,unknown>|undefined)?.[item];
   return {quantity:l.quantity,producedAt:l.producedAt,expiresAt:l.expiresAt,definition:l.definition,nutrition:finite(value)&&Number.isFinite(value*l.quantity)?value*l.quantity:null};});
  attachLots(target,lots);
 }
 capture.foodLosses.push({type:'loss',cause:'spoilage',at:world.minute,occurrence:capture.foodLosses.length+1,containerType,container,amount:target});
}

/** Internal engine wrapper. A failed step returns no success evidence. */
export function captureDirectEating(world:World,step:()=>void):DirectEatingObservation {
 if(active.has(world))throw new Error('Direct eating observation cannot be nested for the same world.');
 const foodLosses:FoodLossReceipt[]=[],foodTransfers:FoodTransferReceipt[]=[],foodOwnershipChanges:FoodOwnershipReceipt[]=[];
 const fromMinute=world.minute,worldId=world.id,receipts:DirectEatingReceipt[]=[],foodFlows:FoodFlowReceipt[]=[],careMeals:CareMealReceipt[]=[],childCareMeals:ChildCareMealReceipt[]=[],emergencyCareMeals:EmergencyCareMealReceipt[]=[],longCareMeals:LongCareMealReceipt[]=[],publicDutyMeals:PublicDutyMealReceipt[]=[],journeyMeals:JourneyMealReceipt[]=[],familyJourneyMeals:FamilyJourneyMealReceipt[]=[];
 active.set(world,{foodOwnershipChanges,foodTransfers,foodLosses,unprovenLossLots:new Set(),receipts,foodFlows,careMeals,childCareMeals,emergencyCareMeals,longCareMeals,publicDutyMeals,journeyMeals,familyJourneyMeals,pending:new Map()});
 try{step();return {worldId,fromMinute,toMinute:world.minute,receipts,foodFlows,foodFlowCoverage:FOOD_FLOW_COVERAGE,foodLosses,foodLossCoverage:FOOD_LOSS_COVERAGE,foodTransfers,foodTransferCoverage:FOOD_TRANSFER_COVERAGE,foodOwnershipChanges,foodOwnershipCoverage:FOOD_OWNERSHIP_COVERAGE,careMeals,childCareMeals,emergencyCareMeals,longCareMeals,publicDutyMeals,journeyMeals,familyJourneyMeals};}
 finally{active.delete(world);}
}

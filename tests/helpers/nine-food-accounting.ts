import type {Inventory,Item,World} from '../../src/shared/types.js';
import {goods,itemKeys} from '../../src/shared/items.js';
import {recordPrototypeFlow,type PrototypeFlowHistory,checkedFoodFlow,checkedFoodTransfer,foodTransferKey,foodOwnershipKey,checkedJourneyMeal,checkedFamilyJourneyMeal,checkedPublicDutyMeal,checkedEmergencyCareMeal} from '../../src/server/acceptance-evidence-schema.js';
import {FOOD_FLOW_COVERAGE,FOOD_LOSS_COVERAGE,FOOD_TRANSFER_COVERAGE,FOOD_OWNERSHIP_COVERAGE,type FoodOwnershipReceipt,type FoodOwnershipAmount,type DirectEatingObservation,type FoodFlowAmount,type FoodLossContainerType} from '../../src/world/food-consumption-evidence.js';
import {DAY} from '../../src/world/time.js';
import {checkedDirectEatingObservation} from '../../src/world/isolation-evidence.js';

export type FoodScope='nine-and-public'|'external'|'unknown';
export interface PhysicalStock {id:string;aliases:string[];type:FoodLossContainerType;ownerId:string|null;scope:FoodScope;units:Record<Item,number|null>;}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const empty=()=>Object.fromEntries(itemKeys.map(i=>[i,0])) as Record<Item,number|null>;
const data=(o:object,key:string):unknown=>{const d=Object.getOwnPropertyDescriptor(o,key);return d&&'value'in d?d.value:undefined;};
const sum=(a:number|null,b:number|null)=>a===null||b===null||!Number.isFinite(a+b)?null:a+b;

/** Read existing physical state only. Never call foodContainers, initialization,
 * repair, estate/recipe accessors or food-lot reconciliation from an audit.
 * The boundary is the exact nine initial identities plus public physical stores.
 * Foreign offers, shipments and aid stay external until actual local collection.
 * This measures custody/ownership, NOT availability, nutrition or sustainability. */
export function snapshotNineFood(w:World,founderIds:readonly string[]){
 if(founderIds.length!==9||new Set(founderIds).size!==9)throw new Error('Exactly nine distinct initial resident IDs are required');
 const founders=new Set(founderIds),containers:PhysicalStock[]=[],issues:string[]=[];
 const ids=new Map<string,PhysicalStock>(),bags=new Map<object,PhysicalStock>();
 const owned=(id:string|null|undefined):FoodScope=>id==null?'unknown':founders.has(id)||id==='commons'?'nine-and-public':'external';
 const add=(type:FoodLossContainerType,id:string,bag:unknown,ownerId:string|null,scope:FoodScope=owned(ownerId))=>{
  const units=empty();
  for(const item of itemKeys){
   // Missing sparse inventory entries mean no stock; an explicit invalid entry or
   // absent inventory is missing evidence. Do not invoke inventory accessors.
   const d=bag&&typeof bag==='object'?Object.getOwnPropertyDescriptor(bag,item):undefined;
   units[item]=!bag||typeof bag!=='object'?null:!d?0:'value'in d&&finite(d.value)?d.value:null;
   if(units[item]===null)issues.push(`Unknown quantity: ${id}/${item}`);
  }
  const byId=ids.get(id),byBag=bag&&typeof bag==='object'?bags.get(bag):undefined;
  const prior=byId??byBag;
  if(byId&&byBag&&byId!==byBag){
   // A late alias can join two already-seen IDs. Merge the complete component,
   // not just the new record, so it cannot leave a second counted stock behind.
   for(const alias of byBag.aliases){if(!byId.aliases.includes(alias))byId.aliases.push(alias);ids.set(alias,byId);}
   for(const [object,entry]of bags)if(entry===byBag)bags.set(object,byId);
   containers.splice(containers.indexOf(byBag),1);
   if(byId.ownerId!==byBag.ownerId||byId.scope!==byBag.scope){byId.scope='unknown';issues.push(`Conflicting ownership: ${id}`);}
   for(const item of itemKeys)if(byId.units[item]!==byBag.units[item]){byId.units[item]=null;issues.push(`Conflicting duplicate stock: ${id}/${item}`);}
  }
  if(prior){
   if(!prior.aliases.includes(id))prior.aliases.push(id);
   if(prior.scope!==scope||prior.ownerId!==ownerId){prior.scope='unknown';issues.push(`Conflicting ownership: ${id}`);}
   for(const item of itemKeys)if(prior.units[item]!==units[item]){prior.units[item]=null;issues.push(`Conflicting duplicate stock: ${id}/${item}`);}
   ids.set(id,prior);if(bag&&typeof bag==='object')bags.set(bag,prior);return;
  }
  const entry={id,aliases:[id],type,ownerId,scope,units};containers.push(entry);ids.set(id,entry);
  if(bag&&typeof bag==='object')bags.set(bag,entry);
 };
 const single=(type:FoodLossContainerType,id:string,item:Item,source:object,key:string,ownerId:string|null,scope?:FoodScope)=>add(type,id,{[item]:data(source,key)},ownerId,scope);
 for(const r of w.residents)add('person','person:'+r.id,r.inventory,r.id);
 for(const c of w.migration?.contacts??[])if(c.person)add('person','person:'+c.id,c.person.inventory,c.id);
 for(const m of w.foreignTrade?.merchants??[])add('person','person:'+m.id,m.person.inventory,m.id,'external');
 for(const e of w.estates){
  add('estate','estate:'+e.personId,e.inventory,e.personId);
  for(const p of e.parcels??[])add('estate-stock',p.id,p.inventory,p.ownerId);
 }
 for(const b of w.economy?.businesses??[])add('business','business:'+b.id,b.inventory,b.ownerId);
 for(const l of w.economy?.listings??[])if(l.side==='sale'&&l.status==='open')single('listing','listing:'+l.id,l.item,l,'quantity',w.economy!.businesses.find(b=>b.id===l.businessId)?.ownerId??null);
 for(const [id,bag]of Object.entries(w.civic?.stores??{}))add('public','public:'+id,bag,'commons');
 for(const p of w.civic?.reserves??[])add('public-reserve','public-reserve:'+p.id,p.inventory,'commons');
 for(const p of w.household?.pools??[])for(const c of p.credits)add('family-stock','family-stock:'+p.id+':'+c.ownerId,c.inventory,c.ownerId);
 for(const g of w.household?.gifts??[])if(g.status==='ready')for(const c of g.segments)add('family-gift','family-gift:'+g.id+':'+c.ownerId,c.inventory,c.ownerId);
 for(const e of w.culture?.events??[]){
  add('culture-prep','culture-prep:'+e.id,e.preparation.held,e.preparation.supplierId);
  for(const c of e.contributions)add('culture-food','culture-food:'+e.id+':'+c.id,c.inventory,c.donorId);
 }
 for(const b of w.industry?.batches??[])if(b.status==='working')add('craft','craft:'+b.id,b.input,b.ownerId);
 for(const c of w.employment?.contracts??[])if(c.batch)add('employment','employment:'+c.id,c.batch.inventory,c.employerId);
 for(const t of w.industry?.trees??[])if(t.status!=='cut')single('orchard-stock','orchard-stock:'+t.id,'fruit',t,'fruit',t.ownerId);
 const products={chicken:'egg',duck:'duckEgg',goat:'milk',cow:'milk'} as const;
 for(const a of w.industry?.animals??[])if(a.kind!=='sheep')single('animal-stock','animal-stock:'+a.id,products[a.kind],a,'product',a.ownerId);
 for(const d of w.outsideAid?.deliveries??[])add('aid','aid:'+d.id,d.inventory,d.merchantId,'external');
 for(const o of w.foreignTrade?.offers??[])single('offer','offer:'+o.id,o.item,o,'stock',o.merchantId,'external');
 for(const s of w.foreignTrade?.shipments??[])single('shipment','shipment:'+s.id,s.item,s,'goods',s.merchantId,'external');
 const scopedTotals=empty(),externalTotals=empty();
 for(const c of containers)for(const item of itemKeys){
  if(c.scope==='unknown'){if(c.units[item]!==0){scopedTotals[item]=null;externalTotals[item]=null;}continue;}
  const total=c.scope==='nine-and-public'?scopedTotals:externalTotals;
  const next=sum(total[item],c.units[item]);if(next===null&&total[item]!==null&&c.units[item]!==null)issues.push(`Quantity overflow: ${item}`);total[item]=next;
 }
 return {worldId:w.id,at:w.minute,founderIds:[...founderIds],containers,scopedTotals,externalTotals,issues};
}
export type NineFoodSnapshot=ReturnType<typeof snapshotNineFood>;
type SliceKey='foodTransfers'|'receipts'|'foodFlows'|'foodLosses'|'careMeals'|'childCareMeals'|'longCareMeals'|'journeyMeals'|'familyJourneyMeals'|'publicDutyMeals'|'emergencyCareMeals';
type MealKey=Exclude<SliceKey,'foodFlows'|'foodLosses'|'foodTransfers'>;
type Receipt<K extends SliceKey>=NonNullable<DirectEatingObservation[K]>[number];
export type BeneficiaryScope='nine'|'external'|'unknown';
const amountTotals=()=>({units:empty(),nutrition:0 as number|null});
const intakeTotals=()=>({...amountTotals(),hungerRelief:0 as number|null,completedServings:0});
const addAmounts=(total:ReturnType<typeof amountTotals>,amounts:FoodFlowAmount[])=>{
 for(const a of amounts){total.units[a.item]=sum(total.units[a.item],finite(a.quantity)?a.quantity:null);
  total.nutrition=sum(total.nutrition,finite(a.nutrition)?a.nutrition:null);}
};
function slice<K extends SliceKey>(key:K){return {key,observedMinutes:0,unobservedMinutes:0,receipts:[] as Receipt<K>[],scopes:[] as FoodScope[],destinationScopes:[] as (FoodScope|null)[],beneficiaryScopes:[] as (BeneficiaryScope|null)[]};}
const isMeal=(key:SliceKey):key is MealKey=>key!=='foodFlows'&&key!=='foodLosses'&&key!=='foodTransfers';
const mealAmounts=(r:Receipt<MealKey>):FoodFlowAmount[]=>'item'in r?[{item:r.item,quantity:r.quantity,nutrition:r.nutrition,lots:null}]:r.inputs;

const ownershipAmountTotals=()=>({units:empty(),nutrition:null});
const addOwnershipAmounts=(total:ReturnType<typeof ownershipAmountTotals>,amounts:FoodOwnershipAmount[],unknown=false)=>{
 for(const amount of amounts)total.units[amount.item]=sum(total.units[amount.item],unknown?null:amount.quantity);
};
interface OwnershipStockScope {container:string;fromScope:FoodScope;toScope:FoodScope;}

/** External evidence with exact accepted one-minute intervals. No observations
 * enter saves. scopedTotals is physical stock debited from nine + public custody;
 * nineIntakeTotals is food/water received by the fixed nine, regardless of payer.
 * Neither quantity is a complete consumption ledger or inferred from stock drift. */
export function createNineFoodEvidence(worldId:string,fromMinute:number){
 if(!worldId||!finite(fromMinute))throw new Error('Invalid food evidence start');
 let lastMinute=fromMinute,founderIds:readonly string[]|undefined;
 const prototypeTrials:PrototypeFlowHistory=new Map();
 const transferDeliveries=new Set<string>(),custodyWork=new Set<string>(),ownershipShares=new Set<string>();
 const eventIds=new Set<string>(),familyTransactions=new Set<string>(),publicServices=new Set<string>();
 const emergencyAgreements=new Map<string,{providerId:string;beneficiaryId:string;mealNumber:number;firstAt:number;lastAt:number;unobservedMinutes:number}>();
 const slices={foodTransfers:slice('foodTransfers'),directEating:slice('receipts'),foodFlows:slice('foodFlows'),foodLosses:slice('foodLosses'),careMeals:slice('careMeals'),childCareMeals:slice('childCareMeals'),longCareMeals:slice('longCareMeals'),journeyMeals:slice('journeyMeals'),familyJourneyMeals:slice('familyJourneyMeals'),publicDutyMeals:slice('publicDutyMeals'),emergencyCareMeals:slice('emergencyCareMeals')};
 const ownership={key:'foodOwnershipChanges' as const,observedMinutes:0,unobservedMinutes:0,receipts:[] as FoodOwnershipReceipt[],stockScopes:[] as OwnershipStockScope[][]};
 return {
  sample(before:NineFoodSnapshot,after:NineFoodSnapshot,observation?:DirectEatingObservation){
   if(before.worldId!==worldId||after.worldId!==worldId)throw new Error('Food evidence snapshot world mismatch');
   if(!finite(before.at)||!finite(after.at)||before.at!==lastMinute||after.at!==before.at+1)throw new Error('Food evidence requires consecutive one-minute snapshots');
   const ids=[...before.founderIds].sort(),other=[...after.founderIds].sort();
   if(ids.length!==9||new Set(ids).size!==9||ids.some(id=>typeof id!=='string'||!id)
    ||JSON.stringify(ids)!==JSON.stringify(other)||founderIds&&JSON.stringify(ids)!==JSON.stringify(founderIds))throw new Error('Food evidence founder boundary changed');
   const o=observation===undefined?undefined:checkedDirectEatingObservation(observation);
   if(o&&(o.worldId!==worldId||o.fromMinute!==before.at||o.toMinute!==after.at))throw new Error('Food evidence world/minute mismatch');
   if(o?.foodTransferCoverage!==undefined&&o.foodTransferCoverage!==FOOD_TRANSFER_COVERAGE&&o.foodTransferCoverage!=='outside_aid_collect_v1')throw new Error('Invalid food transfer coverage');
   if(o?.foodTransferCoverage!==undefined&&!Array.isArray(o.foodTransfers))throw new Error('Food transfer coverage requires an array');
   // Validate and detach EVERY slice before changing coverage, receipts or IDs.
   const nextPrototypeTrials:PrototypeFlowHistory=new Map(prototypeTrials);
   const nextCustodyWork=new Set<string>(),nextDeliveries=new Set<string>(),nextEvents=new Set<string>(),nextFamilies=new Set<string>(),nextServices=new Set<string>(),nextOwnershipShares=new Set<string>(),nextAgreements=new Map(emergencyAgreements);
   for(const s of Object.values(slices)){
    const receipts=o?.[s.key];
    if(receipts===undefined)continue;
    if(!Array.isArray(receipts))throw new Error('Invalid food evidence array');
    const localIds=new Set<string>();
    for(const r of receipts){
     if(!finite(r.at)||r.at<=before.at||r.at>after.at)throw new Error('Food receipt outside observation interval');
     if(s.key==='foodFlows'&&'action'in r&&(r.action==='harvest_house'||r.action==='custody_harvest'||r.action==='saveSeed'||r.action==='prototype_trial')){
      checkedFoodFlow(r);
      if(r.action==='prototype_trial')recordPrototypeFlow(nextPrototypeTrials,r);
      if(r.action==='custody_harvest'){
       const key=JSON.stringify([r.custodyId,r.workSerial]);
       if(custodyWork.has(key)||nextCustodyWork.has(key))throw new Error('Duplicate custody harvest work');
       nextCustodyWork.add(key);
      }
     }
     if(s.key==='foodTransfers'){
      const transfer=checkedFoodTransfer(r);
      const key=foodTransferKey(transfer);
      if(transferDeliveries.has(key)||nextDeliveries.has(key))throw new Error('Duplicate food transfer');
      nextDeliveries.add(key);
     }
     if(s.key==='journeyMeals')checkedJourneyMeal(r);
     if(s.key==='familyJourneyMeals')checkedFamilyJourneyMeal(r);
     if(s.key==='publicDutyMeals'){
      const meal=checkedPublicDutyMeal(r),service=JSON.stringify([meal.shiftId,meal.serviceNumber]);
      if(publicServices.has(service)||nextServices.has(service))throw new Error('Duplicate public duty service');
      nextServices.add(service);
     }
     if(s.key==='emergencyCareMeals'){
      const meal=checkedEmergencyCareMeal(r);
      if(meal.operation==='feed'){
       const prior=nextAgreements.get(meal.agreementId!),unobservedMinutes=slices.emergencyCareMeals.unobservedMinutes;
       if(prior&&(meal.providerId!==prior.providerId||meal.beneficiaryId!==prior.beneficiaryId
        ||meal.mealNumber!<=prior.mealNumber||prior.unobservedMinutes===unobservedMinutes&&meal.mealNumber!==prior.mealNumber+1
        ||meal.at<prior.lastAt||meal.at-prior.firstAt>=DAY))throw new Error('Invalid emergency care agreement sequence');
       // Missing slices can contain unobserved meals. Preserve the gap rather
       // than rejecting a later increasing counter or inventing those servings.
       nextAgreements.set(meal.agreementId!,{providerId:meal.providerId,beneficiaryId:meal.beneficiaryId,
        mealNumber:meal.mealNumber!,firstAt:prior?.firstAt??meal.at,lastAt:meal.at,unobservedMinutes});
      }
     }
     if('eventId'in r&&r.eventId!==null){
      if(typeof r.eventId!=='string'||!r.eventId||eventIds.has(r.eventId)||nextEvents.has(r.eventId))throw new Error('Duplicate food receipt identity');
      nextEvents.add(r.eventId);
     }
     const identity=JSON.stringify('cause'in r?[r.at,r.container,r.amount.item,r.occurrence]
      :'relocationId'in r?[r.relocationId,r.rationNumber,r.memberIndex]
      :'type'in r&&r.type==='transfer'?foodTransferKey(r):r.eventId===null?[r.at,r.container,r.action,'sourceId'in r?r.sourceId:null]:[r.eventId]);
     if(localIds.has(identity))throw new Error('Duplicate food receipt in one observation');localIds.add(identity);
    }
   }
   for(const receipt of o?.foodOwnershipChanges??[]){
    if(!finite(receipt.at)||receipt.at<=before.at||receipt.at>after.at)throw new Error('Food ownership receipt outside observation interval');
    const key=foodOwnershipKey(receipt);
    if(ownershipShares.has(key)||nextOwnershipShares.has(key)||eventIds.has(receipt.eventId)||nextEvents.has(receipt.eventId))throw new Error('Duplicate food ownership');
    nextOwnershipShares.add(key);nextEvents.add(receipt.eventId);
   }
   const ownerScope=(owner:string|null):FoodScope=>owner===null?'unknown':ids.includes(owner)||owner==='commons'?'nine-and-public':'external';
   const ownershipScopes=(o?.foodOwnershipChanges??[]).map(receipt=>receipt.stocks.map(stock=>({container:stock.container,fromScope:stock.ambiguous?'unknown' as const:ownerScope(stock.fromOwnerId),toScope:ownerScope(stock.toOwnerId)})));
   const groups=new Map<string,{first:Receipt<'familyJourneyMeals'>;members:Set<string>;providers:Map<string,number>}>();
   for(const r of o?.familyJourneyMeals??[]){
    const key=JSON.stringify([r.relocationId,r.rationNumber]);
    if(familyTransactions.has(key))throw new Error('Duplicate family journey transaction');
    let group=groups.get(key);
    if(!group){group={first:r,members:new Set(),providers:new Map()};groups.set(key,group);nextFamilies.add(key);}
    const first=group.first;
    if(r.at!==first.at||r.trigger!==first.trigger||r.definition!==first.definition||r.memberCount!==first.memberCount
     ||r.memberIndex!==group.members.size||group.members.has(r.beneficiaryId)
     ||r.providerPortion!==(group.providers.get(r.providerId)??0))throw new Error('Invalid family journey transaction');
    group.members.add(r.beneficiaryId);group.providers.set(r.providerId,(group.providers.get(r.providerId)??0)+1);
   }
   for(const group of groups.values())if(group.members.size!==group.first.memberCount)throw new Error('Incomplete family journey transaction');
   const scopeOf=(id:string):FoodScope=>{
    const a=before.containers.find(c=>c.aliases.includes(id))?.scope,b=after.containers.find(c=>c.aliases.includes(id))?.scope;
    return a&&b&&a!==b?'unknown':a??b??'unknown';
   };
   const pending=Object.values(slices).map(s=>{
    const receipts=o?.[s.key]??[];
    return {s,receipts,covered:Array.isArray(o?.[s.key])&&(s.key!=='foodFlows'||o!.foodFlowCoverage===FOOD_FLOW_COVERAGE)&&(s.key!=='foodLosses'||o!.foodLossCoverage===FOOD_LOSS_COVERAGE)&&(s.key!=='foodTransfers'||o!.foodTransferCoverage===FOOD_TRANSFER_COVERAGE),
     scopes:receipts.map((r):FoodScope=>{
      if(s.key==='foodFlows'&&'action'in r&&r.action==='prototype_trial'){
       const endpoints=[before,after].flatMap(snapshot=>snapshot.containers.filter(c=>c.aliases.includes(r.container)));
       const ownerScope:FoodScope=ids.includes(r.residentId)?'nine-and-public':'external';
       return endpoints.length&&endpoints.every(c=>c.ownerId===r.residentId&&c.scope===ownerScope)?ownerScope:'unknown';
      }
      if(s.key==='foodFlows'&&'action'in r&&r.action==='custody_harvest'){
       const ownerScope:FoodScope=ids.includes(r.estateOwnerId)||r.estateOwnerId==='commons'?'nine-and-public':'external';
       const endpoints=[before,after].flatMap(snapshot=>snapshot.containers.filter(c=>c.aliases.includes(r.container)));
       return endpoints.some(c=>c.ownerId!==r.estateOwnerId||c.scope!==ownerScope)?'unknown':ownerScope;
      }
      return s.key==='foodTransfers'?(r.container.startsWith('person:')&&ids.includes(r.container.slice(7))?'nine-and-public':'external'):scopeOf(r.container);}),
     destinationScopes:receipts.map((r):FoodScope|null=>{if(s.key!=='foodTransfers'||!('destinationContainer'in r))return null;const owner=r.action==='foreignTrade'&&r.operation==='estateCustody'?r.estateOwnerId:r.destinationContainer.startsWith('person:')?r.destinationContainer.slice(7):null;return owner!==null&&(ids.includes(owner)||r.action==='foreignTrade'&&r.operation==='estateCustody'&&owner==='commons')?'nine-and-public':'external';}),beneficiaryScopes:receipts.map((r):BeneficiaryScope|null=>{
      if(!isMeal(s.key))return null;
      const id='beneficiaryId'in r?r.beneficiaryId:'residentId'in r?r.residentId:null;
      return typeof id!=='string'||!id?'unknown':ids.includes(id)?'nine':'external';
     })};
   });
   for(const {s,receipts,covered,scopes,destinationScopes,beneficiaryScopes} of pending){
    if(covered)s.observedMinutes++;else s.unobservedMinutes++;
    (s.receipts as Receipt<SliceKey>[]).push(...receipts);s.scopes.push(...scopes);s.destinationScopes.push(...destinationScopes);s.beneficiaryScopes.push(...beneficiaryScopes);
   }
   if(Array.isArray(o?.foodOwnershipChanges)&&o.foodOwnershipCoverage===FOOD_OWNERSHIP_COVERAGE)ownership.observedMinutes++;
   else ownership.unobservedMinutes++;
   ownership.receipts.push(...o?.foodOwnershipChanges??[]);ownership.stockScopes.push(...ownershipScopes);
   for(const key of nextOwnershipShares)ownershipShares.add(key);
   for(const [key,value]of nextPrototypeTrials)prototypeTrials.set(key,value);
   for(const key of nextCustodyWork)custodyWork.add(key);
   for(const id of nextDeliveries)transferDeliveries.add(id);
   for(const id of nextEvents)eventIds.add(id);for(const key of nextFamilies)familyTransactions.add(key);
   for(const key of nextServices)publicServices.add(key);
   for(const [key,agreement]of nextAgreements)emergencyAgreements.set(key,agreement);
   founderIds=ids;lastMinute=after.at;
  },
  finish(){
   const data=structuredClone(slices);
   const result=Object.fromEntries(Object.entries(data).map(([name,s])=>{
    const totals={sourceAdded:amountTotals(),inputs:amountTotals(),outputs:amountTotals()},intake=intakeTotals(),inflow=amountTotals(),outflow=amountTotals();
    for(const [index,r]of s.receipts.entries()){
     if(s.key==='foodTransfers'){if('amount'in r){if(s.scopes[index]==='external'&&s.destinationScopes[index]==='nine-and-public')addAmounts(inflow,[r.amount]);if(s.scopes[index]==='nine-and-public'&&s.destinationScopes[index]==='external')addAmounts(outflow,[r.amount]);}continue;}
     if(isMeal(s.key)&&s.beneficiaryScopes[index]==='nine'){
      const meal=r as Receipt<MealKey>;
      // Nonfood service materials are debits, not beneficiary food intake.
      addAmounts(intake,mealAmounts(meal).filter(a=>goods[a.item].food>0||a.item==='water'));
      intake.hungerRelief=sum(intake.hungerRelief,finite(meal.hungerRelief)?meal.hungerRelief:null);intake.completedServings++;
     }
     if(s.scopes[index]!=='nine-and-public')continue;
     if('item'in r)addAmounts(totals.inputs,mealAmounts(r));
     else if('amount'in r)addAmounts(totals.inputs,[r.amount]);
     else if('type'in r){if(r.type==='processed'){addAmounts(totals.inputs,r.inputs);addAmounts(totals.outputs,r.outputs);}else addAmounts(totals.sourceAdded,r.outputs);}
     else addAmounts(totals.inputs,r.inputs);
    }
    const covered=s.unobservedMinutes===0&&s.observedMinutes>0;
    return [name,{...s,scopeInflowTotals:s.key==='foodTransfers'&&covered?inflow:null,scopeOutflowTotals:s.key==='foodTransfers'&&covered?outflow:null,scopedTotals:covered&&!s.scopes.includes('unknown')?totals:null,
     nineIntakeTotals:isMeal(s.key)&&covered&&!s.beneficiaryScopes.includes('unknown')?intake:null}];
   })) as {[K in keyof typeof data]:typeof data[K]&{scopeInflowTotals:ReturnType<typeof amountTotals>|null;scopeOutflowTotals:ReturnType<typeof amountTotals>|null;scopedTotals:null|{sourceAdded:ReturnType<typeof amountTotals>;inputs:ReturnType<typeof amountTotals>;outputs:ReturnType<typeof amountTotals>};nineIntakeTotals:ReturnType<typeof intakeTotals>|null}};
   const ownershipData=structuredClone(ownership),ownershipCovered=ownership.unobservedMinutes===0&&ownership.observedMinutes>0;
   const ownershipTotals={...ownershipAmountTotals(),completedActions:ownership.receipts.length},ownershipInflow=ownershipAmountTotals(),ownershipOutflow=ownershipAmountTotals();
   for(const [index,receipt]of ownershipData.receipts.entries())for(const [stockIndex,stock]of receipt.stocks.entries()){
    const {fromScope,toScope}=ownershipData.stockScopes[index][stockIndex];
    addOwnershipAmounts(ownershipTotals,stock.amounts);
    if(toScope==='nine-and-public'&&fromScope!=='nine-and-public')addOwnershipAmounts(ownershipInflow,stock.amounts,fromScope==='unknown');
    if(toScope==='external'&&fromScope!=='external')addOwnershipAmounts(ownershipOutflow,stock.amounts,fromScope==='unknown');
   }
   const foodOwnershipChanges={...ownershipData,totals:ownershipCovered?ownershipTotals:null,scopeInflowTotals:ownershipCovered?ownershipInflow:null,scopeOutflowTotals:ownershipCovered?ownershipOutflow:null};
   return {worldId,fromMinute,toMinute:lastMinute,founderIds:founderIds?[...founderIds]:null,...result,foodOwnershipChanges,completeFoodLedger:false as const,foodProduction:null,foodConsumption:null,
    accountingScopes:{foodOwnershipChanges:'Observed production inherit changes of existing food stock ownership only. Each stock uses its receipt owners against the fixed original nine IDs plus commons, regardless of death or residency. Crossings are ownership inflow/outflow, never physical transfers, source production or intake; ambiguous affected quantities and all nutrition remain unknown.',scopeInflowTotals:'Observed physical transfers from external custody into fixed nine personal or estate custody and public estate custody; not intake or production.',scopeOutflowTotals:'Observed physical transfers from fixed nine personal custody to external offers or shipments; not consumption.',scopedTotals:'Physical operation amounts in fixed nine + public custody; inputs are debits, not necessarily intake by the nine.',nineIntakeTotals:'Observed edible food and companion water received by the fixed nine only, independent of provider/custody; hunger relief is separate from original nutrition.'},
    uncovered:['non-food industry craft and non-food employment processing','plantCrop conversions','foreign production outside observed local sources','trade outside recorded reservations, collection and estate custody; aid outside completed outsideAid collect, and ownership changes outside successful production inherit','publicDuty outside receive and emergencyCare outside feed/rescueMeal are not meal intake evidence','travel consumption outside visitorJourney eat, visitorAid eatMail and family relocation rations; other unlisted uses/losses']};
  }
 };
}

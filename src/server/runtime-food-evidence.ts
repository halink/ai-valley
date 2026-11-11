import {randomUUID} from 'node:crypto';
import {foodOwnershipCoverage,checkedFoodOwnershipChanges,foodTransferCoverage,checkedFoodTransfer,array,foodLossCoverage,checkedFoodLoss,foodFlowCoverage,checkedFoodFlow,checkedCareMeal,checkedChildCareMeal,checkedEmergencyCareMeal,checkedLongCareMeal,checkedPublicDutyMeal,checkedJourneyMeal,checkedFamilyJourneyMeal} from './acceptance-evidence-schema.js';
import type {FoodOwnershipReceipt,FOOD_OWNERSHIP_COVERAGE,FoodTransferReceipt,FoodTransferCoverage,FoodLossReceipt,FOOD_LOSS_COVERAGE,DirectEatingObservation,DirectEatingReceipt,FoodFlowReceipt,FoodFlowCoverage,CareMealReceipt,ChildCareMealReceipt,EmergencyCareMealReceipt,LongCareMealReceipt,PublicDutyMealReceipt,JourneyMealReceipt,FamilyJourneyMealReceipt} from '../world/food-consumption-evidence.js';

export type RuntimeFoodEvent=Readonly<{schema:1;sessionId:string;sequence:number;worldId:string}&(
 |{type:'food_session_started';fromMinute:number}
 |{type:'food_step_committed';fromMinute:number;toMinute:number;revision:number;foodOwnershipChanges?:readonly FoodOwnershipReceipt[];foodOwnershipCoverage?:typeof FOOD_OWNERSHIP_COVERAGE;foodTransfers?:readonly FoodTransferReceipt[];foodTransferCoverage?:FoodTransferCoverage;receipts:readonly Readonly<DirectEatingReceipt>[];foodLosses?:readonly FoodLossReceipt[];foodLossCoverage?:typeof FOOD_LOSS_COVERAGE;foodFlows?:readonly FoodFlowReceipt[];foodFlowCoverage?:FoodFlowCoverage;careMeals?:readonly CareMealReceipt[];childCareMeals?:readonly ChildCareMealReceipt[];emergencyCareMeals?:readonly EmergencyCareMealReceipt[];longCareMeals?:readonly LongCareMealReceipt[];publicDutyMeals?:readonly PublicDutyMealReceipt[];journeyMeals?:readonly JourneyMealReceipt[];familyJourneyMeals?:readonly FamilyJourneyMealReceipt[]}
 |{type:'food_session_stopped';toMinute:number})>;
export type RuntimeFoodEvidenceOptions={observe:(event:RuntimeFoodEvent)=>void};

/** External, opt-in receipts for committed runtime steps. Not a total food ledger. */
export class RuntimeFoodEvidence {
 private sessionId:string|null=null;
 private worldId:string|null=null;
 private sequence=0;
 private throughMinute:number|null=null;
 private phase:'not_started'|'observing'|'stopped'|'failed'='not_started';
 private failure:'observer_threw'|'async_observer'|'coverage_discontinuity'|null=null;
 constructor(private options:RuntimeFoodEvidenceOptions){}
 status(){return {sessionId:this.sessionId,worldId:this.worldId,phase:this.phase,lastSequence:this.sequence,
  throughMinute:this.throughMinute,failure:this.failure};}
 get observing(){return this.phase==='observing';}
 private emit(body:Omit<Extract<RuntimeFoodEvent,{type:'food_session_started'}>,'schema'|'sessionId'|'sequence'|'worldId'>
  |Omit<Extract<RuntimeFoodEvent,{type:'food_step_committed'}>,'schema'|'sessionId'|'sequence'|'worldId'>
  |Omit<Extract<RuntimeFoodEvent,{type:'food_session_stopped'}>,'schema'|'sessionId'|'sequence'|'worldId'>){
  if(!this.observing)return;
  const event=Object.freeze({...body,schema:1 as const,sessionId:this.sessionId!,worldId:this.worldId!,sequence:++this.sequence});
  try{
   const result:unknown=this.options.observe(event);
   if(result&&typeof (result as PromiseLike<unknown>).then==='function'){
    void Promise.resolve(result).catch(()=>{});this.phase='failed';this.failure='async_observer';
   }
  }catch{this.phase='failed';this.failure='observer_threw';}
 }
 start(worldId:string,minute:number){
  if(this.observing)return;
  this.sessionId=randomUUID();this.worldId=worldId;this.sequence=0;this.throughMinute=minute;
  this.phase='observing';this.failure=null;this.emit({type:'food_session_started',fromMinute:minute});
 }
 committed(observation:DirectEatingObservation,revision:number){
  if(!this.observing)return;
  if(observation.worldId!==this.worldId||observation.fromMinute!==this.throughMinute||observation.toMinute<observation.fromMinute){
   this.phase='failed';this.failure='coverage_discontinuity';return;
  }
  let foodFlows:readonly FoodFlowReceipt[]|undefined,careMeals:readonly CareMealReceipt[]|undefined,childCareMeals:readonly ChildCareMealReceipt[]|undefined,emergencyCareMeals:readonly EmergencyCareMealReceipt[]|undefined,longCareMeals:readonly LongCareMealReceipt[]|undefined,publicDutyMeals:readonly PublicDutyMealReceipt[]|undefined,journeyMeals:readonly JourneyMealReceipt[]|undefined,familyJourneyMeals:readonly FamilyJourneyMealReceipt[]|undefined;
  const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};
  let coverage:FoodFlowCoverage|undefined;
  let losses:readonly FoodLossReceipt[]|undefined,lossCoverage:typeof FOOD_LOSS_COVERAGE|undefined;
  let transfers:readonly FoodTransferReceipt[]|undefined,transferCoverage:FoodTransferCoverage|undefined;
  let ownership:readonly FoodOwnershipReceipt[]|undefined,ownershipCoverage:typeof FOOD_OWNERSHIP_COVERAGE|undefined;
  try{
   if(Object.hasOwn(observation,'foodOwnershipCoverage')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodOwnershipCoverage')!;
    if(!('value' in descriptor)||!Object.hasOwn(observation,'foodOwnershipChanges'))throw new Error('invalid_evidence_schema');
    ownershipCoverage=foodOwnershipCoverage(descriptor.value) as typeof ownershipCoverage;
   }
   if(Object.hasOwn(observation,'foodOwnershipChanges')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodOwnershipChanges')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    ownership=checkedFoodOwnershipChanges(descriptor.value,observation.fromMinute,observation.toMinute);freeze(ownership);
   }
   if(Object.hasOwn(observation,'foodTransferCoverage')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodTransferCoverage')!;
    if(!('value' in descriptor)||!Object.hasOwn(observation,'foodTransfers'))throw new Error('invalid_evidence_schema');
    transferCoverage=foodTransferCoverage(descriptor.value) as typeof transferCoverage;
   }
   if(Object.hasOwn(observation,'foodTransfers')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodTransfers')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    transfers=array(checkedFoodTransfer)(descriptor.value) as FoodTransferReceipt[];freeze(transfers);
   }
   if(Object.hasOwn(observation,'foodLossCoverage')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodLossCoverage')!;
    if(!('value' in descriptor)||!Object.hasOwn(observation,'foodLosses'))throw new Error('invalid_evidence_schema');
    lossCoverage=foodLossCoverage(descriptor.value) as typeof lossCoverage;
   }
   if(Object.hasOwn(observation,'foodLosses')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodLosses')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    losses=array(checkedFoodLoss)(descriptor.value) as FoodLossReceipt[];freeze(losses);
   }
   if(Object.hasOwn(observation,'foodFlowCoverage')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodFlowCoverage')!;
    if(!('value' in descriptor)||!Object.hasOwn(observation,'foodFlows'))throw new Error('invalid_evidence_schema');
    coverage=foodFlowCoverage(descriptor.value) as typeof coverage;
   }
   if(Object.hasOwn(observation,'foodFlows')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'foodFlows')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    foodFlows=array(checkedFoodFlow)(descriptor.value) as FoodFlowReceipt[];freeze(foodFlows);
   }
   if(Object.hasOwn(observation,'careMeals'))careMeals=Object.freeze(observation.careMeals!.map(meal=>{const copy=checkedCareMeal(meal);freeze(copy);return copy;}));
   if(Object.hasOwn(observation,'childCareMeals'))childCareMeals=Object.freeze(observation.childCareMeals!.map(meal=>{const copy=checkedChildCareMeal(meal);freeze(copy);return copy;}));
   if(Object.hasOwn(observation,'emergencyCareMeals')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'emergencyCareMeals')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    emergencyCareMeals=array(checkedEmergencyCareMeal)(descriptor.value) as EmergencyCareMealReceipt[];freeze(emergencyCareMeals);
   }
   if(Object.hasOwn(observation,'longCareMeals')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'longCareMeals')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    longCareMeals=array(checkedLongCareMeal)(descriptor.value) as LongCareMealReceipt[];freeze(longCareMeals);
   }
   if(Object.hasOwn(observation,'publicDutyMeals')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'publicDutyMeals')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    publicDutyMeals=array(checkedPublicDutyMeal)(descriptor.value) as PublicDutyMealReceipt[];freeze(publicDutyMeals);
   }
   if(Object.hasOwn(observation,'journeyMeals')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'journeyMeals')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    journeyMeals=array(checkedJourneyMeal)(descriptor.value) as JourneyMealReceipt[];freeze(journeyMeals);
   }
   if(Object.hasOwn(observation,'familyJourneyMeals')){
    const descriptor=Object.getOwnPropertyDescriptor(observation,'familyJourneyMeals')!;
    if(!('value' in descriptor))throw new Error('invalid_evidence_schema');
    familyJourneyMeals=array(checkedFamilyJourneyMeal)(descriptor.value) as FamilyJourneyMealReceipt[];freeze(familyJourneyMeals);
   }
  }catch{this.phase='failed';this.failure='observer_threw';return;}
  this.throughMinute=observation.toMinute;
  this.emit({type:'food_step_committed',fromMinute:observation.fromMinute,toMinute:observation.toMinute,revision,
   ...(ownership===undefined?{}:{foodOwnershipChanges:ownership}),
   ...(ownershipCoverage===undefined?{}:{foodOwnershipCoverage:ownershipCoverage}),
   ...(transfers===undefined?{}:{foodTransfers:transfers}),
   ...(transferCoverage===undefined?{}:{foodTransferCoverage:transferCoverage}),
   ...(foodFlows===undefined?{}:{foodFlows}),
   ...(losses===undefined?{}:{foodLosses:losses}),
   ...(lossCoverage===undefined?{}:{foodLossCoverage:lossCoverage}),
   ...(coverage===undefined?{}:{foodFlowCoverage:coverage}),
   ...(careMeals===undefined?{}:{careMeals}),
   ...(childCareMeals===undefined?{}:{childCareMeals}),
   ...(emergencyCareMeals===undefined?{}:{emergencyCareMeals}),
   ...(longCareMeals===undefined?{}:{longCareMeals}),
   ...(publicDutyMeals===undefined?{}:{publicDutyMeals}),
   ...(journeyMeals===undefined?{}:{journeyMeals}),
   ...(familyJourneyMeals===undefined?{}:{familyJourneyMeals}),
   receipts:Object.freeze(observation.receipts.map(receipt=>Object.freeze({...receipt})))});
 }
 stop(worldId:string,minute:number){
  if(!this.observing)return;
  if(worldId!==this.worldId||minute!==this.throughMinute){this.phase='failed';this.failure='coverage_discontinuity';return;}
  this.emit({type:'food_session_stopped',toMinute:minute});
  if(this.observing)this.phase='stopped';
 }
}
export type RuntimeFoodEvidenceStatus=ReturnType<RuntimeFoodEvidence['status']>;

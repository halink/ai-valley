import {mvpSleepProblem} from './mvp-rooms.js';
import {advanceMvpThirst,mvpDrinkReason,completeMvpDrink} from './mvp-drinking.js';
import {recordCompletedMovement} from './completed-movement.js';
import {completedWorkIdentity} from '../shared/work-completion.js';
import {procurementCapable,publicCargoDeliveryReason} from './public-food-procurement.js';
import {initializeSocialAppointments,advanceSocialAppointments,socialAppointmentReason,socialAppointmentTarget,socialAppointmentTravelReason,socialAppointmentWork,completeSocialAppointment,socialAppointmentReceiptId,recordSocialAppointmentFailure} from './social-appointments.js';
import {isSocialAppointmentStop} from '../shared/social-appointments.js';
import {observeFoodSources,foodSourceShareReason,foodSourceShareTarget,completeFoodSourceShare,foodSourceShareWork,foodSourceShareReceiptId} from './food-source-sharing.js';
import {readSpeechTone,readSpeechText} from '../shared/speech-tone.js';
import {barterTerms,sameBarterTerms} from '../shared/barter.js';
import {barterActionReason} from './barter.js';
import {canSeeOutdoorPoint} from './outdoor-observation.js';
import {canInspectSpring,canContactSpring} from './spring-observation.js';
import {berryApproachPath,canInspectBerry,canContactBerry} from './berry-observation.js';
import {initializePersonalFoodGifts,advancePersonalFoodGifts,personalFoodGiftTarget,personalFoodGiftTravelReason,personalFoodGiftWork,completePersonalFoodGift,personalFoodGiftReceiptId,personalFoodGiftReason} from './personal-food-gifts.js';
import {isPersonalFoodGiftStop} from '../shared/personal-food-gifts.js';
import {initializeAdultPresence,advanceAdultPresence,adultPresenceTarget,adultPresenceReason,adultPresenceWork,completeAdultPresence} from './adult-presence.js';
import {isRescueDecision,isRescueWithdrawal} from '../shared/health.js';
import {advanceVisitorJourneyNeeds} from './visitor-journey.js';
import {isLastWishWithdrawal} from '../shared/last-wishes.js';
import {lastWishTarget,completeLastWish,burialWishReason,knownLastWish} from './last-wishes.js';
import {initializePregnancyPreparation,pregnancyReceiptId,pregnancyTarget,pregnancyReason,pregnancyWork,completePregnancyPreparation,recordPregnancyRest} from './pregnancy-preparation.js';
import {isPregnancyWithdrawal} from '../shared/pregnancy-preparation.js';
import {initializeRegionSurveys,advanceRegionSurveys,regionSurveyTarget,regionSurveyReason,completeRegionSurvey} from './region-survey.js';
import {disasterContains} from '../shared/frontier-hazards.js';
import {isWaterSupportWithdrawal} from '../shared/water-support.js';
import {initializeWaterSupply,waterSupplyTarget,waterSupplyWorkReason,completeWaterSupply,waterReceiptId} from './water-supply.js';
import {initializeLandRights,advanceLandRights,landRightsTarget,completeLandRights} from './land-rights.js';
import {advanceBusinessRelocations,businessRelocationTarget,completeBusinessRelocation} from './business-relocation.js';
import {currentPremisesLease,premisesWorkReason} from '../shared/premises.js';
import {advancePremises,premisesTarget,completePremises} from './premises.js';
import {initializeEmergencyCare,advanceEmergencyCare,emergencyCareTarget,completeEmergencyCare} from './emergency-care.js';
import {advanceVisitorAidNeeds} from './visitor-aid.js';
import {initializeOutsideAid,advanceOutsideAid,outsideAidTarget,completeOutsideAid} from './outside-aid.js';
import {initializeFamilyRelocation,familyRelocationTarget,completeFamilyRelocation,advanceFamilyRelocation,syncFamilyEscorts,familyEscortContinues,familyRelocationReason} from './family-relocation.js';
import {travellingFamily,familyPassenger} from '../shared/family-relocation.js';
import {observeGateDirections} from './visitor-guidance.js';
import {initializeCommons,advanceCommons,commonsTarget,completeCommons,commonsReason} from './commons.js';
import {hasReceipt} from './receipts.js';
import {copyForSimulation} from './simulation-copy.js';
import {endDecisionProtection,needHealthDrain,noteSurvivalRelief,protectedNeedMinutes,recordProtectionLoss,settleDecisionProtection,SURVIVAL_FORECAST_MINUTES} from './decision-protection.js';
import {cropYieldAt,recordFieldHarvest} from './frontier-nutrients.js';
import {aboardFerry,ferryTarget,completeFerry,workFerry,initializeFerries,advanceFerries,learnDocks} from './ferry.js';
import {buildingMigrationTarget,completeBuildingMigration,workBuildingMigration,advanceBuildingMigrations} from './building-migration.js';
import {promiseTarget,completePromise} from './known-promises.js';
import {initializePhysiology,physiology} from './physiology.js';
import {routeFood} from './food-routes.js';
import {initializeCulture,advanceCulture,cultureTarget,cultureWorkError,completeCulture} from './culture.js';
import {initializeSocial,advanceSocial,socialTarget,completeSocial} from './social-life.js';
import {initializeHousehold,advanceHousehold,householdGiftActivityReason,householdTarget,completeHousehold} from './household.js';
import {initializeDebt,advanceDebt,debtTarget,completeDebt} from './debt.js';
import {initializeAdoption,advanceAdoption,adoptionTarget,completeAdoption,adoptionReason} from './adoption.js';
import {initializeAgency,agencyReason,completeAgency,advanceAgency,settleAgencyAction} from './agency.js';
import {deathProof,canObserve} from './knowledge.js';
import {initializeFunerary,advanceFunerary,funeraryTarget,completeFunerary,knownBodyLocation} from './funerary.js';
import {reserveBody,bodyPickup,syncBodies} from './bodies.js';
import {initializeLongCare,advanceLongCare,longCareTarget,longCareWorkError,completeLongCare} from './long-care.js';
import {residentBed,sleepBuilding,cookingBuilding} from '../shared/rooms.js';
import {syncMedicalTransport,transportContinues,passenger,noteGroundTransportStep,expressiveTransportChoice} from './medical-transport.js';
import {coLocated} from './proximity.js';
import {canApproachSocialTarget,canContactSocialTarget,socialApproachPath} from './social-observation.js';
import {initializeHealth,advanceHealth,healthTarget,healthReason,healthWorkError,completeHealth,movementRate} from './health.js';
import {syncAnimalTransport} from './industry.js';
import {advanceFood,initializeFood,foodTransaction,foodValue} from './food.js';
import {captureDirectEating,recordDirectEating,foodFlowInputs,recordFoodFlow,finishFoodFlowAction,type DirectEatingObservation} from './food-consumption-evidence.js';
import {initializeRooms,beginRoomTick,moveInRoom,prepareRoomExit} from './rooms.js';
import {initializeIndustry,advanceIndustry,industryTarget,industryWorkError,completeIndustry} from './industry.js';
import {itemLabels,goods} from '../shared/items.js';
import {initializeEducation,advanceEducation,educationTarget,educationWorkError,completeEducation,educationConflict} from './education.js';
import type {Action, Activity, Building, BuildingKind, Inventory, Plan, Resident, Vec, World} from '../shared/types.js';
import {emitEvent} from './events.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {visibleStreetDirectory} from './street-directory.js';
import {advanceLife,recordDeath} from './life.js';
import {careActionReason,isBasicCareWithdrawal,executeSocialAction} from './social.js';
import {careSelfWithdrawal,careExpressionWait} from './care-withdrawal.js';
import {ageAllowsAction,familyCareRoute} from './family.js';
import {advanceMigration} from './migration.js';
import {advancePublicDuties,completeDuty,dutyTarget,dutyWorkError,publicKitchenReason} from './public-duties.js';
import {ensureCensus} from '../shared/demography.js';
import {initializeEconomy,advanceEconomy,economyTarget,completeEconomy} from './economy.js';
import {initializeCivic,advanceCivic,civicTarget,completeCivic,civicWorkError} from './civic.js';
import {initializeProduction,advanceProduction,productionTarget,completeProduction,productionParcels} from './production.js';
import {initializeEmployment,advanceEmployment,employmentTarget,employmentWorkError,completeEmployment,employmentKitchenReason} from './employment.js';
import {initializeForeignTrade,advanceForeignTrade,foreignReason,foreignTarget,completeForeignTrade} from './foreign-trade.js';
import {initializeConstruction,advanceConstruction,constructionTarget,constructionWorkError,completeConstruction} from './construction.js';
import {isSelfCareAction} from './self-care.js';
import {calendar,DAY,ageYears,knownAgeYears} from './time.js';
import {advanceFrontierHazards,frontierHazardTarget,completeFrontierHazard,frontierRetreatStepAllowed} from './frontier-hazards.js';

import {designTarget,designWorkError,completeDesign} from './resident-designs.js';

const names:Record<string,string>=itemLabels;
const buildingNames:Record<BuildingKind,string>={home:'木屋',lodge:'会馆',workshop:'工坊',clinic:'诊所',school:'学堂',barn:'畜舍',greenhouse:'温室',store:'商铺'};
const has=(inventory:Inventory,cost:Inventory,multiplier=1)=>Object.entries(cost).every(([k,v])=>(inventory[k as keyof Inventory]??0)>=(v??0)*multiplier);
function transfer(from:Inventory,to:Inventory,cost:Inventory){for(const [k,v]of Object.entries(cost)){const item=k as keyof Inventory;from[item]=(from[item]??0)-v;to[item]=(to[item]??0)+v;}}
function consume(inventory:Inventory,cost:Inventory,multiplier=1){for(const [k,v]of Object.entries(cost)){const item=k as keyof Inventory;inventory[item]=(inventory[item]??0)-v*multiplier;}}
const allowedAboard=(a:Action)=>['wait','eat','talk','ferry'].includes(a.type)||isRescueDecision(a)||isWaterSupportWithdrawal(a)||isPregnancyWithdrawal(a)||isLastWishWithdrawal(a)||isSocialAppointmentStop(a)||isPersonalFoodGiftStop(a);
const selfCareTransportBlocked=(w:World,r:Resident,a:Action)=>isSelfCareAction(a)&&(aboardFerry(w,r.id)&&!allowedAboard(a)||(travellingFamily(w,r.id)||familyPassenger(w,r.id)||passenger(w,r.id))&&a.type!=='wait');
const living=(r:Resident)=>r.status==='alive'&&r.residency!=='outside';
function nearby(a:Resident,b:Resident){return living(a)&&living(b)&&a.inside===b.inside&&distance(a.at,b.at)<=2;}
function failure(world:World,r:Resident,error:string,failedAction?:Action){const action=failedAction??r.activity?.action??r.plan?.actions[0];if(action?.type==='socialAppointment')recordSocialAppointmentFailure(world,r,action,error);settleAgencyAction(r,r.activity?.planId??r.plan?.id??'',error);r.activity=null;r.plan=null;if(!world.rooms){r.inside=null;r.roomAt=null;}r.lastFailure=error;r.decisionDue=world.minute;r.revision++;}
function definitionFor(world:World,plan:Plan,action:Action):string {
 const key=action.type==='cook'?'recipe/meal':action.type==='plant'||action.type==='harvest'||action.type==='water'?'crop/turnip':action.type==='build'?`building/${action.kind}`:'action/routine';
 if(key==='action/routine')return plan.definition;
 const bound=world.definitions[plan.definition]?.dependencies.find(k=>k.startsWith(`${key}@`));
 return bound??'';
}
/** A submitted plan represents one individual's choice; it never authorizes another person's choice. */
export function submitPlan(world:World,plan:Plan):{ok:boolean;error?:string} {
 if(hasReceipt(world,`plan:${plan.id}`))return {ok:true};
 const actor=world.residents.find(r=>r.id===plan.actorId);
 if(!actor||!living(actor)||(!actor.canDecide||!actor.canExpress)&&!(plan.actions.length===1&&(expressiveTransportChoice(world,actor,plan.actions[0])||!!careSelfWithdrawal(world,actor,plan.actions[0])||careExpressionWait(world,actor,plan.actions[0]))))return {ok:false,error:'人物当前无法提交新决定'};
 if(actor.revision!==plan.actorRevision)return {ok:false,error:'人物状态已变化，迟到的决定失效'};
 if(plan.actions.some(a=>a.type==='shareFoodSource')&&(plan.actions.length!==1||plan.actions.some(a=>a.type==='shareFoodSource'&&(a.receiptId!==foodSourceShareReceiptId(actor)||foodSourceShareReason(world,actor,a)))))return {ok:false,error:'须本人单独选择尚未使用的亲见地址，并与指定听者合法当面接触'};
 if(plan.actions.some(a=>a.type==='socialAppointment')&&(plan.actions.length!==1||plan.actions.some(a=>a.type==='socialAppointment'&&(socialAppointmentReason(world,actor,a)||a.operation==='offer'&&a.receiptId!==socialAppointmentReceiptId(actor)))))return {ok:false,error:'日常约见须本人单独选择当前有效条款'};
 if(plan.actions.some(a=>a.type==='personalFoodGift')&&plan.actions.length!==1)return {ok:false,error:'个人赠粮须由本人单独决定，不夹带其他行动'};
 if(plan.actions.some(a=>a.type==='personalFoodGift'&&a.operation==='offer'&&(a.receiptId!==personalFoodGiftReceiptId(world,actor,a.ageTerms===undefined?1:2)||personalFoodGiftReason(world,actor,a))))return {ok:false,error:'原赠粮提议选择已失效，须重新决定'};
 if(plan.actions.some(a=>a.type==='adultPresence')&&plan.actions.length!==1)return {ok:false,error:'有限在场须单独决定，不可附带其他行动'};
 if(plan.actions.length!==1&&plan.actions.some(a=>isBasicCareWithdrawal(world,a)||!!careSelfWithdrawal(world,actor,a)))return {ok:false,error:'停止照护须是本人单独的停止决定，不能附带其他行动'};
 if(aboardFerry(world,actor.id)&&plan.actions.some(a=>!allowedAboard(a)&&!careSelfWithdrawal(world,actor,a)))return {ok:false,error:'已登船，须实际靠泊并上岸后才能独立走动或工作'};
 if(plan.actions.some(isRescueWithdrawal)&&plan.actions.length!==1)return {ok:false,error:'拒绝或撤回护送须是本人单独的停止决定'};
 if(plan.actions.some(isLastWishWithdrawal)&&plan.actions.length!==1)return {ok:false,error:'撤回身后意愿或拒绝须是本人单独的停止决定'};
 if(plan.actions.some(isWaterSupportWithdrawal)&&plan.actions.length!==1)return {ok:false,error:'撤回授权、取消或拒绝赠桶须是本人单独的停止决定，不能附带其他行动'};
 if(plan.actions.length!==1&&plan.actions.some(a=>a.type==='outsideAid'&&a.operation==='carryMail'))return {ok:false,error:'结束来访并捎信回程须单独决定，不能附带谷内后续行动'};
 if(plan.actions.length!==1&&plan.actions.some(a=>a.type==='familyRelocation'&&(a.operation==='depart'||a.operation==='resume')))return {ok:false,error:'家庭启程须是一次单独的本人决定，不能附带后续独立移动'};
 if((travellingFamily(world,actor.id)||familyPassenger(world,actor.id))&&plan.actions.some(a=>a.type!=='wait'&&!careSelfWithdrawal(world,actor,a)&&!isWaterSupportWithdrawal(a)&&!isPregnancyWithdrawal(a)&&!isLastWishWithdrawal(a)&&!isSocialAppointmentStop(a)&&!isPersonalFoodGiftStop(a)&&!(a.type==='familyRelocation'&&['withdraw','decline'].includes(a.operation))))return {ok:false,error:'家庭同行期间须先明确停止同行，再独立移动或工作'};
 if(passenger(world,actor.id)&&plan.actions.some(a=>a.type!=='wait'&&!careSelfWithdrawal(world,actor,a)&&!isWaterSupportWithdrawal(a)&&!isPregnancyWithdrawal(a)&&!isLastWishWithdrawal(a)&&!isSocialAppointmentStop(a)&&!isPersonalFoodGiftStop(a)&&!(a.type==='health'&&a.operation==='cancelRescue')))return {ok:false,error:'护送中的乘员须先明确停止护送，再安排独立移动或工作'};
 if((actor.plan||actor.activity)&&!plan.actions.every(a=>!!careSelfWithdrawal(world,actor,a)||careExpressionWait(world,actor,a)||isPregnancyWithdrawal(a)||isLastWishWithdrawal(a)||isRescueWithdrawal(a)||isSocialAppointmentStop(a)||isPersonalFoodGiftStop(a)))return {ok:false,error:'已有尚未完成的安排'};
 if(!world.definitions[plan.definition]||world.definitions[plan.definition].kind!=='action')return {ok:false,error:'未知的行为定义版本'};
 if(plan.createdAt>world.minute||!plan.id||plan.actions.length<1||plan.actions.length>10)return {ok:false,error:'计划的时间、标识或长度无效'};
 for(const action of plan.actions)if(action.type==='accept'&&action.offerTerms!==undefined){
  const offer=world.offers.find(o=>o.id===action.offerId);
  if(!offer||!sameBarterTerms(action.offerTerms,offer))return {ok:false,error:'原报价内容已经改变，须本人重新选择'};
 }
 if(world.mode==='formal'&&plan.actions.some(action=>!ageAllowsAction(world,actor,action)&&!expressiveTransportChoice(world,actor,action)&&!careSelfWithdrawal(world,actor,action)&&!careExpressionWait(world,actor,action)||action.type==='visitorJourney'||action.type==='travelToValley'||action.type==='travelWithFamily'||action.type==='stayOutside'))return {ok:false,error:'这项行动不符合本人当前的年龄或居留状态'};
 const pregnancyActions=plan.actions.filter(a=>a.type==='pregnancyPreparation');
 if(pregnancyActions.length&&(plan.actions.length!==1||pregnancyActions.some(a=>a.receiptId!==pregnancyReceiptId(world,actor))))return {ok:false,error:'孕期准备须是本人单独的有效决定，不能更改或重复使用旧回执'};
 const waterActions=plan.actions.filter(a=>a.type==='waterSupply');
 if(waterActions.some(a=>a.receiptId!==waterReceiptId(world,actor)))return {ok:false,error:'供水选择已失效，不能把旧回执重新编号'};
 // An accepted withdrawal is effective now, before another resident can finish
 // pending provision or delivery. It never schedules physical work or transport.
 const only=plan.actions[0],careStop=careSelfWithdrawal(world,actor,only);
 if(only.type==='publicDuty'&&(only.operation==='receive'||only.operation==='inspect')){const error=dutyTarget(world,actor,only,1).error;if(error)return {ok:false,error};}
 if(isSocialAppointmentStop(only)){
  const error=completeSocialAppointment(world,actor,only);if(error)return {ok:false,error};
  world.processed.push(`plan:${plan.id}`);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.revision++;world.revision++;return {ok:true};
 }
 if(isPersonalFoodGiftStop(only)){
  const error=completePersonalFoodGift(world,actor,only);if(error)return {ok:false,error};
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute;actor.revision++;world.revision++;return {ok:true};
 }
 if(only.type==='adultPresence'&&['stop','stopVerification'].includes(only.operation)&&!careStop)return {ok:false,error:'该在场停止不属于本人或已过原期限'};
 if(isBasicCareWithdrawal(world,only)&&!careStop)return {ok:false,error:'这一次照护停止已失效或不属于本人'};
 if(careStop){
  const error=careStop.type==='adultPresence'?completeAdultPresence(world,actor,careStop):careStop.type==='longCare'?completeLongCare(world,actor,careStop):careStop.type==='emergencyCare'?completeEmergencyCare(world,actor,careStop):careStop.type==='promise'?completePromise(world,actor,careStop):executeSocialAction(world,actor,careStop).error;
  if(error)return {ok:false,error};
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute;actor.revision++;world.revision++;return {ok:true};
 }
 if(careExpressionWait(world,actor,only)&&only.type==='wait'){
  world.processed.push(`plan:${plan.id}`);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute+only.minutes;actor.revision++;world.revision++;return {ok:true};
 }
 if(only.type==='wait'&&expressiveTransportChoice(world,actor,only)){
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute+only.minutes;actor.revision++;world.revision++;return {ok:true};
 }
 if(isRescueWithdrawal(only)&&only.type==='health'){
  const error=completeHealth(world,actor,only);if(error)return {ok:false,error};
  const cancelled=(a:Action)=>a.type==='health'&&(only.offerId!==undefined&&a.offerId===only.offerId||only.transportId!==undefined&&a.transportId===only.transportId);
  if(actor.activity&&cancelled(actor.activity.action))actor.activity=null;
  if(actor.plan){actor.plan.actions=actor.plan.actions.filter(a=>!cancelled(a));if(!actor.plan.actions.length&&!actor.activity)actor.plan=null;}
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute;actor.revision++;world.revision++;return {ok:true};
 }
 if(isLastWishWithdrawal(only)){
  const error=completeLastWish(world,actor,only);if(error)return {ok:false,error};
  const cancelled=(a:Action)=>a.type==='lastWish'&&a.wishId===only.wishId;
  if(actor.activity&&cancelled(actor.activity.action))actor.activity=null;
  if(actor.plan){actor.plan.actions=actor.plan.actions.filter(a=>!cancelled(a));if(!actor.plan.actions.length&&!actor.activity)actor.plan=null;}
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute;actor.revision++;world.revision++;return {ok:true};
 }
 if(isPregnancyWithdrawal(only)){
  const error=completePregnancyPreparation(world,actor,only);if(error)return {ok:false,error};
  const cancelled=(a:Action)=>a.type==='pregnancyPreparation'&&'arrangementId'in a&&a.arrangementId===only.arrangementId;
  if(actor.activity&&cancelled(actor.activity.action)||actor.plan?.actions.some(cancelled)){actor.activity=null;actor.plan=null;}
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute;actor.revision++;world.revision++;return {ok:true};
 }
 if(isWaterSupportWithdrawal(only)&&only.type==='waterSupply'){
  const error=completeWaterSupply(world,actor,only);if(error)return {ok:false,error};
  world.processed.push(`plan:${plan.id}`);actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;actor.decisionDue=world.minute;actor.revision++;world.revision++;return {ok:true};
 }
 actor.plan=structuredClone(plan);actor.plan.actions=plan.actions.map(a=>structuredClone(a));
 // Direct API callers bind at submission; final numbered choices already carry
 // their observed terms. Never retrofit evidence onto a loaded pending action.
 for(const action of actor.plan.actions)if(action.type==='accept'&&action.offerTerms===undefined){
  const offer=world.offers.find(o=>o.id===action.offerId);if(offer)action.offerTerms=barterTerms(offer);
 }
 let waterSequence=world.waterSupply?.receipts.filter(p=>p.actorId===actor.id).length??0;
 for(const a of actor.plan.actions)if(a.type==='waterSupply')a.receiptId=`water:${actor.id}:${waterSequence++}`;
 actor.intention=plan.intention.slice(0,180);actor.lastDecisionAt=world.minute;actor.lastFailure=null;
 world.processed.push(`plan:${plan.id}`);world.revision++;
 return {ok:true};
}

function kitchenUseReason(world:World,r:Resident,b:Building|undefined,start=world.minute,end=world.minute+.000001):string|null {
 if(!b||b.condition<=0||!(b.id===r.homeId&&b.residents.includes(r.id)||b.kind==='lodge'&&b.ownerId==='commons'||currentPremisesLease(world,b.id,start)?.tenantId===r.id&&currentPremisesLease(world,b.id,start)?.terms.station==='kitchen'))return '这处厨房已损坏或本人没有使用权';
 return premisesWorkReason(world,r.id,b.id,'kitchen',start,end)??publicKitchenReason(world,r,b.id)??employmentKitchenReason(world,r,b.id);
}
function targetFor(world:World,r:Resident,a:Action,definition:string,elapsed=0):{target:Vec;adjacent?:boolean;duration:number;error?:string;cargo?:Activity['cargo'];buildingId?:string} {
 const fail=(error:string)=>({target:r.at,duration:0,error});
 if(selfCareTransportBlocked(world,r,a))return fail('须先实际结束原同行或护送，才能另行本人自理');
 if(world.mode==='formal'&&(isSelfCareAction(a)||knownAgeYears(r.bornAt,world.minute)===null)&&(!ageAllowsAction(world,r,a)||isSelfCareAction(a)&&!r.canExpress))return fail('当前年龄、能力或本人自理权限已不支持这项行动');
 if(a.type==='offer'||a.type==='accept'){const error=barterActionReason(world,r,a,elapsed);if(error)return fail(error);}
 if(a.type==='pregnancyPreparation')return pregnancyTarget(world,r,a);
 if(a.type==='regionSurvey')return regionSurveyTarget(world,r,a);
 if(a.type==='waterSupply')return waterSupplyTarget(world,r,a);
 if(a.type==='frontierHazard')return frontierHazardTarget(world,r,a);
 if(a.type==='design')return designTarget(world,r,a);
 if(a.type==='ferry')return ferryTarget(world,r,a);
 if(a.type==='buildingMigration')return buildingMigrationTarget(world,r,a);
 if(a.type==='promise')return promiseTarget(world,r,a);
 if(a.type==='agency'){const error=agencyReason(world,r,a);return error?fail(error):{target:{...r.at},duration:1};}
 if(a.type==='culture')return cultureTarget(world,r,a);
 if(a.type==='social')return socialTarget(world,r,a);
 if(a.type==='household')return householdTarget(world,r,a);
 if(a.type==='debt')return debtTarget(world,r,a);
 if(a.type==='socialAppointment')return socialAppointmentTarget(world,r,a);
 if(a.type==='shareFoodSource')return foodSourceShareTarget(world,r,a);
 if(a.type==='personalFoodGift')return personalFoodGiftTarget(world,r,a);
 if(a.type==='adultPresence')return adultPresenceTarget(world,r,a,elapsed);
 if(a.type==='emergencyCare')return emergencyCareTarget(world,r,a);
 if(a.type==='familyRelocation')return familyRelocationTarget(world,r,a);
 if(a.type==='adoption')return adoptionTarget(world,r,a);
 if(a.type==='lastWish')return lastWishTarget(world,r,a);
 if(a.type==='funerary')return funeraryTarget(world,r,a);
 if(a.type==='longCare')return longCareTarget(world,r,a);
 if(a.type==='health')return healthTarget(world,r,a);
 if(a.type==='industry')return industryTarget(world,r,a,false,world.minute-elapsed);
 if(a.type==='education')return educationTarget(world,r,a);
 if(a.type==='landRights')return landRightsTarget(world,r,a);
 if(a.type==='construction')return constructionTarget(world,r,a);
 if(a.type==='build'&&world.mode==='formal')return fail('建设已改为分阶段工程，请本人重新选择用途、地点和施工条件');
 if(a.type==='employment')return employmentTarget(world,r,a);
 if(a.type==='outsideAid')return outsideAidTarget(world,r,a);
 if(a.type==='foreignTrade')return foreignTarget(world,r,a);
 if(a.type==='businessRelocation')return businessRelocationTarget(world,r,a);
 if(a.type==='premises')return premisesTarget(world,r,a);
 if(a.type==='economy')return economyTarget(world,r,a);
 if(a.type==='civic')return civicTarget(world,r,a);
 if(a.type==='commons')return commonsTarget(world,r,a);
 if(a.type==='production')return productionTarget(world,r,a);
 if(a.type==='tendChild'||a.type==='fosterChild'||a.type==='familyConsent'||a.type==='inviteHome'||a.type==='homeReply')return familyCareRoute(world,r,a);
 if(a.type==='publicDuty')return dutyTarget(world,r,a);
 if(a.type==='move')return {target:a.to,duration:0};
 if(a.type==='wait'||a.type==='sleep'){
  if(!Number.isFinite(a.minutes)||a.minutes<1||a.minutes>720)return fail('休息时长须在 1–720 分钟之间');
  if(a.type==='sleep'){const b=sleepBuilding(world,r,a);if(!b||!a.buildingId&&world.rooms&&residentBed(world,r,b)===null)return fail('尚未拥有可使用的真实床位，当前住处存在床位缺口');return {target:b.door,duration:a.minutes};}
  return {target:r.at,duration:a.minutes};
 }
 if(a.type==='mvpDrink'){const error=mvpDrinkReason(world,r);return error?fail(error):{target:{...r.at},duration:5};}
 if(a.type==='eat')return Object.hasOwn(goods,a.item)&&goods[a.item].food>0&&has(r.inventory,{[a.item]:1})?{target:r.at,duration:5}:fail('没有这份可以食用的实际食品');
 if(a.type==='gather'){
  const resource=world.resources.find(v=>v.id===a.resourceId);
  if(!resource||!r.knownResources.includes(resource.id))return fail('尚未找到这处资源');
  if(!Number.isInteger(a.quantity)||a.quantity<1||a.quantity>12)return fail('采集数量不合法');
  // Old selected actions can still travel to a known address. Hidden live
  // stock must not be probed by preflight errors; verify it on actual contact.
  if(resource.kind==='spring'?canInspectSpring(world,r,resource):resource.kind==='bush'?canInspectBerry(world,r,resource):true){
   if(resource.kind==='spring'&&resource.floodDamage?.clearedAt===null)return fail('泉水已淤塞，须退水后实际清理才可安全取用');
   if(resource.amount<a.quantity)return fail('资源已不足，须重新决定');
  }
  return {target:resource.at,adjacent:true,duration:a.quantity*(resource.kind==='tree'?(world.industry?.tools.some(t=>t.ownerId===r.id&&!t.location&&t.kind==='axe'&&t.durability>0)?5:8):resource.kind==='rock'?12:resource.kind==='bush'?3:2)};
 }
 if(a.type==='plant'||a.type==='water'||a.type==='harvest'){
  const p=world.plots.find(p=>p.id===a.plotId);if(!p||p.ownerId!==r.id)return fail('没有这块田的使用权');
  if(a.type==='harvest'&&(!p.crop||!world.definitions[p.crop.definition]||p.crop.growth<Number(world.definitions[p.crop.definition].data.growthDays)))return fail('作物已经不存在或尚未成熟');
  if(a.type==='water'&&(!p.crop||!has(r.inventory,{water:1})))return fail('当前没有作物或本人清水不足');
  if(a.type==='plant'&&(p.crop||!has(r.inventory,world.definitions[definition]?.cost??{seed:1})||!(world.definitions[definition]?.data.seasons as string[]|undefined)?.includes(calendar(world.minute).season)))return fail('当前田地、种子或季节不支持播种');
  return {target:p.at,duration:a.type==='plant'?15:a.type==='water'?8:10};
 }
 if(a.type==='cook'){
  if(!Number.isInteger(a.quantity)||a.quantity<1||a.quantity>6)return fail('烹饪数量不合法');
  if(!has(r.inventory,world.definitions[definition]?.cost??{},a.quantity))return fail('烹饪所需实际材料已经不足');
  if(a.buildingId!==undefined&&a.buildingId!==r.homeId&&!r.knownBuildings.includes(a.buildingId))return fail('尚未知道这处厨房的地址');
  const b=a.buildingId!==undefined?world.buildings.find(b=>b.id===a.buildingId):world.buildings.find(b=>b.id===r.homeId&&b.condition>0&&b.residents.includes(r.id))||world.buildings.find(b=>r.knownBuildings.includes(b.id)&&b.kind==='lodge'&&b.ownerId==='commons'&&b.condition>0);
  if(!b)return fail('没有可使用的已知厨房');const problem=kitchenUseReason(world,r,b);if(problem)return fail(problem);return {target:b.door,duration:Number(world.definitions[definition]?.minutes??20)*a.quantity,buildingId:b.id};
 }
 if(a.type==='build')return {target:{x:a.at.x+Math.floor(Number(world.definitions[definition]?.data.width??6)/2),y:a.at.y+Number(world.definitions[definition]?.data.height??5)},duration:Number(world.definitions[definition]?.minutes??360)};
 if(a.type==='separate')return {target:r.at,duration:1};
 if(isBasicCareWithdrawal(world,a))return {target:r.at,duration:0};
 if(a.type==='care'){const error=careActionReason(world,r,a,false);if(error)return fail(error);}
 if(a.type==='respond'){const p=world.proposals.find(p=>p.id===a.proposalId);if(p?.actorId===r.id&&!a.accept)return {target:r.at,duration:1};}
 if(a.type==='leave')return {target:world.map.entrance,duration:1};
 if(a.type==='settle'||a.type==='lodge'){const b=world.buildings.find(b=>b.id===a.buildingId);if(!b)return fail('没有这处住所');return {target:b.door,duration:15};}
 let targetId='targetId'in a?a.targetId:undefined;
 if(a.type==='accept'){const offer=world.offers.find(o=>o.id===a.offerId&&o.targetId===r.id);if(!offer)return fail('没有交给本人的报价');targetId=offer.actorId;}
 if(a.type==='respond'){const proposal=world.proposals.find(p=>p.id===a.proposalId&&p.targetId===r.id);if(!proposal)return fail('没有交给本人的提议');targetId=proposal.actorId;}
 const target=world.residents.find(p=>p.id===targetId);
 if(!target||!r.knownPeople.includes(target.id))return fail('未认识该人物');
 if(a.type==='bury'){
  const known=!!deathProof(world,r,target.id);
  if(target.status!=='dead'||!known)return fail('尚未实际发现该人物死亡');
  const knownPlace=knownBodyLocation(world,r,target.id);if(!knownPlace)return fail('本人尚无可据以寻找遗体的实际地点');
  const wishError=burialWishReason(world,r,target.id,a.wishId);if(wishError)return fail(wishError);
  const wish=a.wishId?knownLastWish(world,r,target.id):undefined;
  const grave=world.graves.filter(g=>(!wish?.graveId||g.id===wish.graveId)&&!g.personId&&(!g.reservedBy||g.reservedBy===r.id)).sort((g,h)=>distance(g.at,target.at)-distance(h.at,target.at)).find(g=>findPath(world,knownPlace.at,g.at,true)!==null);
  if(!grave)return fail('没有可达的空墓位');
  return {target:knownPlace.at,adjacent:!knownPlace.inside,duration:120+(wish?30:0),cargo:{bodyId:target.id,graveId:grave.id,pickedUp:false}};
 }
 // A late model reply retains the place actually seen when its menu was built.
 if(a.observedTarget&&a.observedTarget.id===targetId)return {target:{...a.observedTarget.at},adjacent:!a.observedTarget.inside,duration:a.type==='care'?30:a.type==='learn'?60:3};
 // A name in memory does not reveal someone's live whereabouts across the map.
 if(['talk','offer','accept'].includes(a.type)&&!canApproachSocialTarget(world,r,target))return fail('当前没有实际可见且可接近的交流对象，须先前往寻找');
 if(!living(target)||target.inside!==r.inside||distance(target.at,r.at)>12)return fail('当前视野内没有找到对方，须先前往寻找');
 a.observedTarget={id:target.id,at:{...target.at},inside:target.inside,roomAt:target.roomAt?{...target.roomAt}:null,atMinute:world.minute};
 return {target:{...target.at},adjacent:!target.inside,duration:a.type==='care'?30:a.type==='learn'?60:3};
}
function begin(world:World,r:Resident,elapsed=0){
 const plan=r.plan;if(!plan)return;
 const action=plan.actions.shift();if(!action){r.plan=null;r.decisionDue=world.minute;return;}
 if(aboardFerry(world,r.id)&&!allowedAboard(action)){failure(world,r,'本人仍在船上，须靠泊并上岸');return;}
 const definition=definitionFor(world,plan,action);
 if(!world.definitions[definition]){failure(world,r,'行为引用的定义版本不存在');return;}
 const route=targetFor(world,r,action,definition,elapsed);if(route.error){failure(world,r,route.error,action);return;}
 if(action.type==='cook'&&route.buildingId)action.buildingId=route.buildingId;
 let path=findPath(world,r.at,route.target,route.adjacent,Infinity,action.type==='frontierHazard'&&(action.operation==='retreat'||action.operation==='shelter')||action.type==='health'&&action.operation==='rescue'&&action.evacuationDangerId?frontierRetreatStepAllowed(world,r):undefined);
 if(route.adjacent&&['talk','offer','accept'].includes(action.type))path=socialApproachPath(world,r.at,route.target);
 if(action.type==='gather'){
  const berry=world.resources.find(s=>s.id===action.resourceId&&s.kind==='bush');
  if(berry)path=berryApproachPath(world,r.at,berry);
 }
 // Spring work cannot reach across a closed fence just because its source is
 // adjacent. If the ordinary endpoint has no legal contact, follow the real
 // gate route onto the source, stopping one step before it. Other routes keep
 // their existing semantics; completion still checks the live edge again.
 const springId=action.type==='gather'?action.resourceId:action.type==='waterSupply'&&action.operation==='fillSpring'||action.type==='frontierHazard'&&action.operation==='clearSpring'?action.sourceId:undefined;
 const spring=springId?world.resources.find(s=>s.id===springId&&s.kind==='spring'):undefined;
 if(path&&spring&&!walkable(world,spring.at,path.at(-1)??r.at)){
  const approach=findPath(world,r.at,spring.at);path=approach===null?null:approach.slice(0,-1);
 }
 if(path===null){failure(world,r,'目标目前没有可达路线',action);return;}
 const outdoors=['move','gather','plant','water','harvest','build','construction','landRights','regionSurvey','industry','leave','settle','lodge'].includes(action.type);
 if((path.length||outdoors)&&!world.rooms){r.inside=null;r.roomAt=null;}
 r.activity={planId:plan.id,action,startedAt:world.minute,remaining:route.duration,path,target:{...route.target},definition,travelProgress:0,...(route.cargo?{cargo:route.cargo}:{})};
 const mvpBedError=mvpSleepProblem(world,r);if(mvpBedError){failure(world,r,mvpBedError);return;}
 const exitError=prepareRoomExit(world,r,true);if(exitError){failure(world,r,exitError);return;}
 const bodyError=reserveBody(world,r,r.activity);if(bodyError){failure(world,r,bodyError);return;}
 if(action.type==='socialAppointment')r.activity.appointmentStartedAt=world.minute-elapsed;
 const preparedExit=prepareRoomExit(world,r);if(preparedExit){failure(world,r,preparedExit);return;}
}
export function buildAllowed(world:World,r:Resident,a:Extract<Action,{type:'build'}>,definition:string):{ok:boolean;error?:string;building?:Building} {
 const def=world.definitions[definition];if(!def||def.kind!=='building')return {ok:false,error:'未知建筑定义'};
 const w=Number(def.data.width),h=Number(def.data.height);
 if(!Number.isInteger(a.at.x)||!Number.isInteger(a.at.y)||w<1||h<1)return {ok:false,error:'建筑坐标无效'};
 const parcels=productionParcels(world);
 if(!parcels?.some(p=>p.ownerId===r.id&&a.at.x>=p.x&&a.at.y>=p.y&&a.at.x+w<=p.x+p.width&&a.at.y+h+1<=p.y+p.height))return {ok:false,error:'须在已有本人建设使用权的地块内施工'};
 if(!has(r.inventory,def.cost??{}))return {ok:false,error:'实际携带的建筑材料不足'};
 for(let y=a.at.y;y<a.at.y+h;y++)for(let x=a.at.x;x<a.at.x+w;x++){
  const p={x,y};if(!walkable(world,p)||world.map.tiles[y*world.map.width+x]!=='grass'||world.plots.some(q=>same(q.at,p))||world.graves.some(g=>same(g.at,p))||world.resources.some(v=>v.amount>0&&same(v.at,p))||world.residents.some(v=>v.status==='alive'&&same(v.at,p)))return {ok:false,error:'占地含有道路、资源、墓位、耕地、建筑或人物'};
 }
 const building:Building={id:`building-${world.id}-${world.revision+1}`,kind:a.kind,name:`${r.name}的${buildingNames[a.kind]}`,at:{...a.at},width:w,height:h,door:{x:a.at.x+Math.floor(w/2),y:a.at.y+h},ownerId:r.id,definition,capacity:Number(def.data.capacity),residents:[],condition:100};
 // Test the candidate against all existing doors and water access before touching state or assets.
 const candidate={...world,buildings:[...world.buildings,building]};
 if([...world.buildings.map(b=>b.door),building.door].some(p=>findPath(candidate,world.map.entrance,p)===null)||world.resources.filter(v=>v.kind==='spring').every(v=>findPath(candidate,world.map.entrance,v.at,true)===null))return {ok:false,error:'工程将阻断既有通行或唯一水源'};
 return {ok:true,building};
}
function completeAtomic(world:World,r:Resident,a:Action,definition:string,elapsed=0):string|null {
 if(a.type==='frontierHazard')return completeFrontierHazard(world,r,a);
 if(a.type==='design')return completeDesign(world,r,a);
 if(a.type==='lastWish')return completeLastWish(world,r,a);
 if(a.type==='funerary')return completeFunerary(world,r,a);
 if(a.type==='pregnancyPreparation')return completePregnancyPreparation(world,r,a);
 if(a.type==='socialAppointment')return completeSocialAppointment(world,r,a);
 if(a.type==='shareFoodSource')return completeFoodSourceShare(world,r,a);
 if(a.type==='personalFoodGift')return completePersonalFoodGift(world,r,a);
 if(a.type==='adultPresence')return completeAdultPresence(world,r,a);
 if(a.type==='emergencyCare')return completeEmergencyCare(world,r,a);
 if(a.type==='longCare')return completeLongCare(world,r,a);
 if(a.type==='health')return completeHealth(world,r,a);
 if(a.type==='culture')return completeCulture(world,r,a);
 if(a.type==='social')return completeSocial(world,r,a);
 if(a.type==='household')return completeHousehold(world,r,a);
 if(a.type==='debt')return completeDebt(world,r,a);
 if(a.type==='familyRelocation')return completeFamilyRelocation(world,r,a);
 if(a.type==='adoption')return completeAdoption(world,r,a);
 if(a.type==='ferry')return completeFerry(world,r,a);
 if(a.type==='buildingMigration')return completeBuildingMigration(world,r,a);
 if(a.type==='promise')return completePromise(world,r,a);
 if(a.type==='agency')return completeAgency(world,r,a);
 if(a.type==='industry')return completeIndustry(world,r,a);
 if(a.type==='education')return completeEducation(world,r,a);
 if(a.type==='regionSurvey')return completeRegionSurvey(world,r,a);
 if(a.type==='landRights')return completeLandRights(world,r,a);
 if(a.type==='construction')return completeConstruction(world,r,a);
 if(a.type==='employment')return completeEmployment(world,r,a);
 if(a.type==='outsideAid')return completeOutsideAid(world,r,a);
 if(a.type==='foreignTrade')return completeForeignTrade(world,r,a);
 if(a.type==='businessRelocation')return completeBusinessRelocation(world,r,a);
 if(a.type==='premises')return completePremises(world,r,a);
 if(a.type==='economy')return completeEconomy(world,r,a);
 if(a.type==='civic')return completeCivic(world,r,a);
 if(a.type==='waterSupply')return completeWaterSupply(world,r,a,world.minute-elapsed,world.minute);
 if(a.type==='commons')return completeCommons(world,r,a);
 if(a.type==='production')return completeProduction(world,r,a);
 if(a.type==='publicDuty')return completeDuty(world,r,a);
 const def=world.definitions[definition];
 const social=executeSocialAction(world,r,a);if(social.handled)return social.ok?null:social.error??'行为当前无法完成';
 const record=(text:string,kind:'action'|'construction'|'trade'|'production'='action',actors=[r.id])=>emitEvent(world,{kind,actors,place:{...r.at},text});
 if(a.type==='move'||a.type==='wait'||a.type==='sleep')return null;
 if(a.type==='mvpDrink')return completeMvpDrink(world,r);
 if(a.type==='eat'){
  if(!has(r.inventory,{[a.item]:1}))return '食物已经不足';const nutrition=foodValue(world,'person:'+r.id,a.item),before=r.hunger;consume(r.inventory,{[a.item]:1});r.hunger=Math.max(0,r.hunger-nutrition);const event=record(`${r.name}吃了一份${names[a.item]}。`);
  recordDirectEating(world,{at:world.minute,residentId:r.id,eventId:event.id,planId:r.activity!.planId,container:'person:'+r.id,item:a.item,quantity:1,nutrition,hungerRelief:before-r.hunger});return null;
 }
 if(a.type==='gather'){
  const resource=world.resources.find(v=>v.id===a.resourceId);if(!resource||distance(resource.at,r.at)>1||resource.kind==='spring'&&!canContactSpring(world,r,resource)||resource.kind==='bush'&&!canContactBerry(world,r,resource)||resource.amount<a.quantity)return '资源或实际位置已经变化';
  if(resource.kind==='spring'&&resource.floodDamage?.clearedAt===null)return '泉水已淤塞，不能取得安全清水';
  if(resource.kind==='tree'){const axe=world.industry?.tools.find(t=>t.ownerId===r.id&&!t.location&&t.kind==='axe'&&t.durability>0);if(axe)axe.durability=Math.max(0,axe.durability-1);}
  resource.amount-=a.quantity;resource.lastHarvest=world.minute;const item=resource.kind==='tree'?'wood':resource.kind==='rock'?'stone':resource.kind==='bush'?'berry':'water';r.inventory[item]=(r.inventory[item]??0)+a.quantity;r.energy=Math.max(0,r.energy-a.quantity*0.5);const event=record(`${r.name}采集了 ${a.quantity} 份${names[item]}。`);
  if(item==='berry')recordFoodFlow(world,{type:'source_added',action:'gather_berry',at:world.minute,residentId:r.id,eventId:event.id,planId:r.activity!.planId,container:'person:'+r.id,definition,sourceId:resource.id,output:{berry:a.quantity}});return null;
 }
 if(a.type==='plant'||a.type==='water'||a.type==='harvest'){
  const p=world.plots.find(v=>v.id===a.plotId);if(!p||p.ownerId!==r.id||distance(p.at,r.at)>1)return '田地位置或使用权已经变化';
  if(a.type==='plant'){
   if(p.crop)return '田里已有作物';
   if(!(def.data.seasons as string[]).includes(calendar(world.minute).season))return '这个季节不适合种植芜菁';
   if(!has(r.inventory,def.cost??{seed:1}))return '没有实际种子';consume(r.inventory,def.cost??{seed:1});p.crop={definition,planted:world.minute,growth:0,wateredDay:-1,lastGrowthDay:Math.floor(world.minute/DAY)};r.skills.farming+=0.005;record(`${r.name}播下了芜菁种子。`);return null;
  }
  if(!p.crop)return '田里还没有作物';
  if(a.type==='water'){
   if(!has(r.inventory,{water:1}))return '没有携带清水';
   // Narrate the actual planted version, not the routine action's turnip dependency.
   // Legacy or unknown definitions without a display name remain generic.
   const name=world.definitions[p.crop.definition]?.data?.name;
   const cropName=typeof name==='string'&&name.trim()?name.trim():'作物';
   consume(r.inventory,{water:1});p.crop.wateredDay=Math.floor(world.minute/DAY);record(`${r.name}为田里的${cropName}浇了水。`);return null;
  }
  const cropDefinition=p.crop.definition,cropDef=world.definitions[cropDefinition];if(p.crop.growth<Number(cropDef.data.growthDays))return '作物尚未成熟';
  const item=(cropDef.data.output??'turnip') as keyof Inventory;
  const amount=cropYieldAt(world,p,Number(cropDef.data.yield));
  r.inventory[item]=(r.inventory[item]??0)+amount;
  p.crop=null;r.skills.farming+=.02;recordFieldHarvest(world,p.id,amount);
  const event=record(`${r.name}收获了 ${amount} 份${names[item]}。`,world.scenario==='frontier'?'production':'action');
  recordFoodFlow(world,{type:'source_added',action:'harvest',at:world.minute,residentId:r.id,eventId:event.id,planId:r.activity!.planId,container:'person:'+r.id,definition:cropDefinition,sourceId:p.id,output:{[item]:amount}});return null;
 }
 if(a.type==='cook'){
  if(!has(r.inventory,def.cost??{},a.quantity))return '烹饪需要实际芜菁与清水';
  const inputs=foodFlowInputs(world,'person:'+r.id,def.cost??{},a.quantity);consume(r.inventory,def.cost??{},a.quantity);r.inventory.meal=(r.inventory.meal??0)+a.quantity*Number(def.data.yield);const event=record(`${r.name}在厨房做好 ${a.quantity} 份餐食。`);
  recordFoodFlow(world,{type:'processed',action:'cook',at:world.minute,residentId:r.id,eventId:event.id,planId:r.activity!.planId,container:'person:'+r.id,definition,inputs,output:{meal:a.quantity*Number(def.data.yield)}});return null;
 }
 if(a.type==='build'){
  const valid=buildAllowed(world,r,a,definition);if(!valid.ok||!valid.building)return valid.error??'无法建造';consume(r.inventory,def.cost??{});world.buildings.push(valid.building);r.knownBuildings.push(valid.building.id);r.skills.building+=0.1;record(`${r.name}用自己的材料完成了${valid.building.name}。`,'construction');return null;
 }
 if(a.type==='talk'){
  const target=world.residents.find(v=>v.id===a.targetId);if(!target||!canContactSocialTarget(world,r,target)||!r.canExpress)return '对方已经不在能够交谈的位置';
  const previous=[...world.events].reverse().find(e=>e.kind==='conversation'&&e.conversationId?.startsWith('conversation-')&&(e.roomId??null)===r.inside&&e.actors.includes(r.id)&&e.actors.includes(target.id)&&world.minute-e.at<45&&(r.inside?!!e.roomAt&&!!r.roomAt&&distance(e.roomAt,r.roomAt)<5:distance(e.place,r.at)<5));
  const conversationId=previous?.conversationId??`conversation-${world.id}-${world.revision+1}`;
  const speechTone=readSpeechTone(a.tone),speechText=readSpeechText(a.text.slice(0,320));
  const event=emitEvent(world,{kind:'conversation',actors:[r.id,target.id],place:{...r.at},conversationId,...(speechTone?{speechTone}:{}),...(speechText!==undefined?{speechText}:{}),text:`${r.name}：${a.text.slice(0,320)}`});
  // Hearing a chosen tone is a fact; the listener decides its personal meaning separately.
  for(const [from,to] of [[r,target],[target,r]]){let relation=from.relations.find(v=>v.targetId===to.id);if(!relation){relation={targetId:to.id,affection:0,trust:0,conflict:0,evidence:[]};from.relations.push(relation);}relation.evidence.push(event.id);if(relation.evidence.length>80)relation.evidence=relation.evidence.slice(-80);}
  if(!target.plan&&!target.activity)target.decisionDue=Math.min(target.decisionDue,world.minute);
  return null;
 }
 if(a.type==='offer'){
  const error=barterActionReason(world,r,a,elapsed);if(error)return error;
  const target=world.residents.find(v=>v.id===a.targetId);if(!target||!canContactSocialTarget(world,r,target))return '须另一位在场的实际当事人，不能与自己虚构交换';
  if(!has(r.inventory,a.give))return '报价物品或本人实际库存无效';
  if(world.offers.some(o=>o.actorId===r.id&&o.targetId===target.id&&o.status==='open'))return '对方还有未处理的报价';
  world.offers.push({id:`offer-${world.id}-${world.revision+1}`,actorId:r.id,targetId:target.id,give:structuredClone(a.give),want:structuredClone(a.want),expiresAt:world.minute+240,status:'open',definition});
  record(`${r.name}向${target.name}提出交换报价，等待对方自己决定。`,'trade',[r.id,target.id]);return null;
 }
 if(a.type==='accept'){
  const error=barterActionReason(world,r,a,elapsed);if(error)return error;
  const offer=world.offers.find(o=>o.id===a.offerId);if(!offer||offer.status!=='open'||offer.expiresAt<=world.minute||offer.targetId!==r.id)return '报价已经失效';
  const other=world.residents.find(v=>v.id===offer.actorId);if(!other||!canContactSocialTarget(world,r,other))return '交易须有两位不同的实际在场当事人';
  if(!has(other.inventory,offer.give)||!has(r.inventory,offer.want))return '任一方的实际库存已不足';
  routeFood(world,'person:'+other.id,'person:'+r.id,offer.give);routeFood(world,'person:'+r.id,'person:'+other.id,offer.want);transfer(other.inventory,r.inventory,offer.give);transfer(r.inventory,other.inventory,offer.want);other.revision++;offer.status='accepted';record(`${r.name}接受${other.name}的报价，双方当面交付了物品。`,'trade',[r.id,other.id]);return null;
 }
 return '该行为尚未开放';
}
function observe(world:World,r:Resident){
 if(!canObserve(world,r))return;
 if(r.inside){for(const other of world.residents){if(other.id===r.id||!coLocated(world,r,other,10))continue;if(!r.knownPeople.includes(other.id))r.knownPeople.push(other.id);if(other.status==='dead'&&!world.graves.some(g=>g.personId===other.id)&&!deathProof(world,r,other.id,true))emitEvent(world,{kind:'death',actors:[other.id,r.id],place:{...other.at},witnesses:[r.id],text:`${r.name}在室内发现并确认了${other.name}的死亡。`});}return;}
 observeFoodSources(world,r);
 observeGateDirections(world,r);
 const sign=visibleStreetDirectory(world,r);
 if(sign){
  if(!r.knownResources.includes(sign.water.id))r.knownResources.push(sign.water.id);
  if(!r.knownBuildings.includes(sign.hall.id))r.knownBuildings.push(sign.hall.id);
 }
 for(const res of world.resources)if(distance(r.at,res.at)<=7&&!r.knownResources.includes(res.id)&&(!['spring','bush'].includes(res.kind)||canSeeOutdoorPoint(world,r,res.at,7)))r.knownResources.push(res.id);
 for(const b of world.buildings)if(distance(r.at,b.door)<=10&&!r.knownBuildings.includes(b.id))r.knownBuildings.push(b.id);
 for(const other of world.residents){if(other.id===r.id||other.residency==='outside'||other.inside||distance(r.at,other.at)>5)continue;
  if(!r.knownPeople.includes(other.id))r.knownPeople.push(other.id);
  if(other.status==='dead'&&!world.graves.some(g=>g.personId===other.id)&&!deathProof(world,r,other.id,true))emitEvent(world,{kind:'death',actors:[other.id,r.id],place:{...other.at},witnesses:[r.id],text:`${r.name}在这里发现并确认了${other.name}的死亡。`});
 }
}
function processActivity(world:World,r:Resident,minutes:number){
 if(!procurementCapable(world,r)&&(r.plan?.actions??[]).some(a=>a.type==='civic'&&a.operation==='deliverReserve'||a.type==='foreignTrade'&&(a.reserveId||world.foreignTrade?.shipments.some(s=>s.id===a.shipmentId&&s.publicReserveId)))){failure(world,r,'公共采购经办资格失效，旧行动不能自动恢复');return;}
 // An invalid future barter in an already chosen multi-step plan must not
 // silently resume after age/capacity recovers while an earlier step runs.
 for(const action of r.plan?.actions??[])if(action.type==='offer'||action.type==='accept'){
  const error=barterActionReason(world,r,action,minutes);if(error){failure(world,r,error);return;}
 }
 if(!r.activity)begin(world,r,minutes);
 const activity=r.activity;if(!activity)return;
 if(selfCareTransportBlocked(world,r,activity.action)){failure(world,r,'须先实际结束原同行或护送，不能执行另行本人自理');return;}
 if(travellingFamily(world,r.id)&&activity.action.type!=='wait'&&!isWaterSupportWithdrawal(activity.action)&&!isPregnancyWithdrawal(activity.action)&&!(activity.action.type==='familyRelocation'&&(activity.action.operation==='withdraw'||activity.action.operation==='decline'))){failure(world,r,'家庭同行期间须先实际停止同行，不能执行另行移动或工作');return;}
 if(world.mode==='formal'&&activity.action.type==='build'){failure(world,r,'旧的一次性建造已停用，请重新决定分阶段工程');return;}
 if(world.mode==='formal'&&(isSelfCareAction(activity.action)||knownAgeYears(r.bornAt,world.minute)===null)&&(!ageAllowsAction(world,r,activity.action)||isSelfCareAction(activity.action)&&!r.canExpress)){failure(world,r,'当前年龄、能力或本人自理权限已不支持继续执行');return;}
 if(r.status!=='alive'||!r.canDecide){failure(world,r,'当前身体或决定能力不支持继续执行');return;}
 if(activity.action.type==='offer'||activity.action.type==='accept'){const error=barterActionReason(world,r,activity.action,minutes);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='foreignTrade'){const a=activity.action;if(a.reserveId||world.foreignTrade?.shipments.some(s=>s.id===a.shipmentId&&s.publicReserveId)){const error=foreignReason(world,r,a);if(error){failure(world,r,error);return;}}}
 if(activity.action.type==='civic'&&activity.action.operation==='deliverReserve'){const error=publicCargoDeliveryReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='household'){const error=householdGiftActivityReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='socialAppointment'){const error=socialAppointmentTravelReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='shareFoodSource'){const error=foodSourceShareReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='personalFoodGift'){const error=personalFoodGiftTravelReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='adoption'){const error=adoptionReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='adultPresence'){const error=adultPresenceReason(world,r,activity.action,true);if(error){failure(world,r,error);advanceAdultPresence(world);return;}}
 if(activity.action.type==='care'){
  const target=world.residents.find(v=>v.id===(activity.action as Extract<Action,{type:'care'}>).targetId);
  const error=careActionReason(world,r,activity.action,activity.path.length===0);
  if(!target||error){failure(world,r,error??'照护权限或紧急条件已经改变');return;}
 }
 if(activity.action.type==='familyRelocation'&&(activity.action.operation==='escort'||activity.action.operation==='returnChild')){const error=familyRelocationReason(world,r,activity.action);if(error){failure(world,r,error);syncFamilyEscorts(world);return;}}
 if(activity.action.type==='pregnancyPreparation'){const error=pregnancyReason(world,r,activity.action,false);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='regionSurvey'){const error=regionSurveyReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='waterSupply'){const error=waterSupplyWorkReason(world,r,activity.action,minutes);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='commons'){const error=commonsReason(world,r,activity.action);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='sleep'&&!sleepBuilding(world,r,activity.action)){failure(world,r,activity.action.buildingId?'临时借床期限或使用权已经失效':'原住处的床位使用权已经失效');return;}
 if(activity.action.type==='cook'&&activity.path.length===0&&activity.room?.mode!=='exit'){
  const b=cookingBuilding(world,r,activity),error=kitchenUseReason(world,r,b,world.minute-minutes,world.minute);
  if(error||!b||!same(b.door,r.at)){failure(world,r,error??'没有实际到达所选厨房');return;}
 }
 if(activity.action.type==='health'){const error=healthReason(world,r,activity.action);if(error){failure(world,r,error);syncMedicalTransport(world);return;}}
 const mvpBedError=mvpSleepProblem(world,r);if(mvpBedError){failure(world,r,mvpBedError);return;}
 const interior=moveInRoom(world,r,minutes);syncMedicalTransport(world);syncBodies(world);syncFamilyEscorts(world);if(interior.error){failure(world,r,interior.error);syncMedicalTransport(world);return;}
 if(r.activity!==activity)return;
 if(interior.moving){endDecisionProtection(world,r,'decision');return;}
 if(activity.path.length){
  let available=minutes*movementRate(world,r),progress=activity.travelProgress??0;
  const canStep=activity.action.type==='health'&&activity.action.operation==='rescue'&&activity.action.evacuationDangerId?(from:Vec,to:Vec)=>distance(from,to)===1&&frontierRetreatStepAllowed(world,r)(from,to):activity.action.type==='frontierHazard'&&(activity.action.operation==='retreat'||activity.action.operation==='shelter')?frontierRetreatStepAllowed(world,r):(from:Vec,to:Vec)=>walkable(world,to,from);
  while(available>1e-9&&activity.path.length){const next=activity.path[0];
   if(activity.action.type==='health'){syncMedicalTransport(world);if(r.activity!==activity)return;const error=healthReason(world,r,activity.action);if(error){failure(world,r,error);syncMedicalTransport(world);return;}}
   if(!canStep(r.at,next)){failure(world,r,'原路线出现阻挡，需要重新决定');return;}
   endDecisionProtection(world,r,'decision');
   const duration=world.map.tiles[next.y*world.map.width+next.x]==='road'?.75:1,needed=(1-progress)*duration;
   if(available+1e-9<needed){progress+=available/duration;available=0;break;}
   const completedFrom={...r.at};
   available-=needed;progress=0;r.at=activity.path.shift()!;r.inside=null;recordCompletedMovement(world,r.id,completedFrom,r.at);noteGroundTransportStep(world,r);
   if(activity.cargo?.pickedUp){const body=world.residents.find(v=>v.id===activity.cargo!.bodyId);if(body){body.at={...r.at};body.inside=null;}}
   observe(world,r);
  }
  activity.travelProgress=progress;
  syncMedicalTransport(world);syncBodies(world);syncFamilyEscorts(world);return;
 }
 if(activity.action.type==='socialAppointment'){const error=socialAppointmentWork(world,r,activity.action,minutes);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='shareFoodSource'){const error=foodSourceShareWork(world,r,activity.action,minutes);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='personalFoodGift'){const error=personalFoodGiftWork(world,r,activity.action,minutes);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='adultPresence'){const error=adultPresenceWork(world,r,activity.action,minutes);if(error){failure(world,r,error);advanceAdultPresence(world);return;}}
 if(activity.action.type==='pregnancyPreparation'){const error=pregnancyWork(world,r,activity.action,minutes);if(error){failure(world,r,error);return;}}
 if(activity.action.type==='publicDuty'){
  const problem=dutyWorkError(world,r,activity.action);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.action.type==='civic'){
  const problem=civicWorkError(world,r,activity.action);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.action.type==='employment'){
  const problem=employmentWorkError(world,r,activity.action,minutes);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.action.type==='culture'){const problem=cultureWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='longCare'){const problem=longCareWorkError(world,r,activity.action);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='health'){const problem=healthWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='industry'){const problem=industryWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='education'){const problem=educationWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='design'){const problem=designWorkError(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='ferry'){const problem=workFerry(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='buildingMigration'){const problem=workBuildingMigration(world,r,activity.action,minutes);if(problem){failure(world,r,problem);return;}}
 if(activity.action.type==='construction'){
  const problem=constructionWorkError(world,r,activity.action,minutes);
  if(problem){failure(world,r,problem);return;}
 }
 if(activity.cargo&&!activity.cargo.pickedUp){const error=bodyPickup(world,r,minutes);if(error)failure(world,r,error);return;}
 if(activity.action.type==='sleep'||activity.action.type==='cook'){
  const b=activity.action.type==='sleep'?sleepBuilding(world,r,activity.action):cookingBuilding(world,r,activity);
  if(!b||!same(b.door,r.at)){failure(world,r,'没有实际到达可使用的室内位置');return;}
  if(activity.action.type==='cook'){const problem=premisesWorkReason(world,r.id,b.id,'kitchen',world.minute-minutes,world.minute)??publicKitchenReason(world,r,b.id)??employmentKitchenReason(world,r,b.id);if(problem){failure(world,r,problem);return;}}
  r.inside=b.id;
 }
 endDecisionProtection(world,r,'decision');
 if(activity.action.type==='sleep'){recordPregnancyRest(world,r,minutes);const rules=physiology(world,r);r.energy=Math.min(100,r.energy+minutes*rules.sleepEnergy);if(r.hunger<rules.sleepFedThreshold)r.health=Math.min(100,r.health+minutes*rules.sleepHealth);}
 activity.remaining-=minutes;if(activity.remaining>0)return;
 const error=complete(world,r,activity.action,activity.definition,minutes);if(error){failure(world,r,error);return;}
 if(familyEscortContinues(world,r)||transportContinues(world,r)||activity.path.length||activity.room?.mode==='exit'||activity.action.type==='industry'&&activity.action.operation==='moveAnimal'&&world.industry?.animals.some(n=>n.id===(activity.action as import('../shared/industry.js').IndustryAction).animalId&&n.carrierId===r.id))return;
 if(world.mode==='formal'){
  const action=activity.action;
  const rest=action.type==='sleep'||action.type==='wait';
  r.recentActions=[...(r.recentActions??[]).slice(-3),{type:action.type,at:world.minute,...(rest?{minutes:action.minutes,energy:Math.round(r.energy)}:{})}];
 }
 settleAgencyAction(r,activity.planId);r.activity=null;r.revision++;world.revision++;
 if(!r.plan?.actions.length){r.plan=null;if(activity.action.type!=='outsideAid'||activity.action.operation!=='carryMail')r.decisionDue=world.minute;}
}
/** Advances only committed model arrangements and physical consequences. No intentions are generated here. */
export function stepWorld(world:World,minutes:number,options:{exactEndMinute?:number;decisionChoices?:(world:World,resident:Resident)=>Action[]}={}):void {
 if(world.clock.paused||!Number.isFinite(minutes)||minutes<=0)return;
 const exact=options.exactEndMinute;
 if(exact!==undefined&&(!Number.isFinite(exact)||exact<=world.minute||exact-world.minute!==minutes))throw new Error('invalid_exact_step_endpoint');
 // A caller may use large isolated-test steps; real runtime never catches up downtime.
 ensureCensus(world);initializePhysiology(world);
 if(world.mode==='formal'){initializeSocialAppointments(world);initializePersonalFoodGifts(world);initializeAdultPresence(world);initializePregnancyPreparation(world);initializeEconomy(world);initializeCivic(world);initializeCommons(world);initializeWaterSupply(world);initializeProduction(world);initializeEmployment(world);initializeForeignTrade(world);initializeOutsideAid(world);initializeConstruction(world);initializeLandRights(world);initializeRegionSurveys(world);initializeEducation(world);initializeIndustry(world);initializeFerries(world);initializeRooms(world);initializeFood(world);initializeHealth(world);initializeLongCare(world);initializeEmergencyCare(world);initializeFunerary(world);initializeAgency(world);initializeAdoption(world);initializeFamilyRelocation(world);initializeDebt(world);initializeHousehold(world);initializeSocial(world);initializeCulture(world);}
 let left=minutes;
 while(exact!==undefined?world.minute<exact:left>0){
  const remaining=exact!==undefined?exact-world.minute:left,dt=Math.min(1,remaining),previousDay=Math.floor(world.minute/DAY);
  world.minute=exact!==undefined&&dt===remaining?exact:world.minute+dt;left-=dt;advanceFood(world);advanceCommons(world);syncFamilyEscorts(world);advanceFamilyRelocation(world,dt);beginRoomTick(world);syncMedicalTransport(world);
  const beforeRelief=new Map(world.residents.map(r=>[r.id,{hunger:r.hunger,energy:r.energy}]));
  for(const r of world.residents){if(!living(r)){
    if(world.mode==='formal'&&r.residency==='outside'&&(r.activity&&isSelfCareAction(r.activity.action)||r.plan?.actions.some(isSelfCareAction)))failure(world,r,'已经离开谷内，原本人自理安排停止');
    continue;
   }if(r.health<=0){recordDeath(world,r);continue;}
   const hadChoice=!!(r.plan||r.activity);
   advanceMvpThirst(world,r,dt);
   processActivity(world,r,dt);
   const bodyRules=physiology(world,r);r.hunger=Math.min(100,r.hunger+bodyRules.hungerPerMinute*dt);
   if(r.activity?.action.type!=='sleep'||r.activity.path.length||r.activity.room?.path.length)r.energy=Math.max(0,r.energy-bodyRules.energyPerMinute*dt);
   const protectedMinutes=options.decisionChoices&&(!hadChoice||r.lastFailure!==null)?protectedNeedMinutes(world,r,dt,()=>hasTimelySelfRescue(world,r,options.decisionChoices!(world,r))):0;
   const drain=needHealthDrain(world,r);
   for(const source of ['hunger','exhaustion'] as const){
    const loss=Math.min(r.health,drain[source]*(dt-protectedMinutes));r.health-=loss;recordProtectionLoss(r,source,loss);
    if(r.decisionProtection?.endedAt===null)r.decisionProtection.prevented[source]+=drain[source]*protectedMinutes;
   }
   if(r.health<=0){recordDeath(world,r);continue;}
   observe(world,r);learnDocks(world,r);
  }
  advanceVisitorAidNeeds(world,!!options.decisionChoices);
  advanceVisitorJourneyNeeds(world,!!options.decisionChoices);
  const beforeHazards=new Map(world.residents.map(r=>[r.id,r.health]));
  if(world.frontierHazards)advanceFrontierHazards(world,dt,(r,reason)=>{
   if(r.plan||r.activity)failure(world,r,reason);
   else{r.lastFailure=reason;r.decisionDue=Math.min(r.decisionDue,world.minute);r.revision++;}
  });
  for(const r of world.residents)recordProtectionLoss(r,'hazard',(beforeHazards.get(r.id)??r.health)-r.health);
  const healthPeople=[...world.residents,...(world.migration?.contacts.flatMap(c=>c.journey?.staged&&c.person?[c.person]:[])??[])];
  const beforeHealth=new Map(healthPeople.map(r=>[r.id,r.health]));
  advanceHealth(world,dt);
  for(const r of healthPeople)recordProtectionLoss(r,'illnessOrInjury',(beforeHealth.get(r.id)??r.health)-r.health);
  syncAnimalTransport(world);
  advanceLife(world,dt);syncBodies(world);
  for(const r of world.residents){const before=beforeRelief.get(r.id);if(before)noteSurvivalRelief(world,r,before);settleDecisionProtection(world,r);}
  if(world.mode==='formal'){
   advanceMigration(world);
   advancePremises(world);advanceEconomy(world);
   advanceEmployment(world);advanceBusinessRelocations(world);
   advanceForeignTrade(world);advanceOutsideAid(world);
   advanceLandRights(world);advanceRegionSurveys(world);advanceConstruction(world);advanceBuildingMigrations(world);
   advanceEducation(world);
   advanceIndustry(world);advanceFerries(world,dt);
   advanceProduction(world);
   advanceCivic(world);advanceEmergencyCare(world);advanceAdultPresence(world);advancePersonalFoodGifts(world);advanceSocialAppointments(world);
   advancePublicDuties(world);
   advanceFunerary(world);advanceAdoption(world);advanceHousehold(world);advanceDebt(world);advanceSocial(world);advanceCulture(world);
   for(const plan of advanceLongCare(world))submitPlan(world,plan);
   for(const plan of advanceAgency(world))submitPlan(world,plan);
   ensureCensus(world);
  }
  for(const offer of world.offers)if(offer.status==='open'&&(offer.expiresAt<=world.minute||!world.residents.some(r=>r.id===offer.actorId&&living(r))))offer.status='expired';
  const day=Math.floor(world.minute/DAY);
  if(day!==previousDay){
   const previousWeather=world.weather;world.weather=((day*17+world.seed)%11)<3?'rain':'sun';
   for(const p of world.plots){if(!p.crop)continue;const def=world.definitions[p.crop.definition];if((def.data.seasons as string[]).includes(calendar(world.minute-1).season)&&(p.crop.wateredDay===previousDay||previousWeather==='rain'))p.crop.growth=Math.min(Number(def.data.growthDays),p.crop.growth+1);p.crop.lastGrowthDay=day;}
   if(!world.production)for(const res of world.resources)if(res.regrowthDays>0&&res.amount<res.max&&world.minute-res.lastHarvest>=res.regrowthDays*DAY){res.amount=Math.min(res.max,res.amount+1);res.lastHarvest=world.minute;}
  }
 }
 world.revision++;
}

/** Optional observer-only receipts; simulation and saved state are unchanged. */
export function stepWorldWithFoodEvidence(world:World,minutes:number,options:Parameters<typeof stepWorld>[2]={}):DirectEatingObservation {
 return captureDirectEating(world,()=>stepWorld(world,minutes,options));
}

/** Read-only forecast of actions actually present in the resident's normal menu.
 * It executes the existing movement, bed, inventory, expiry and work checks in a
 * disposable world. It neither chooses nor queues an action in the live world.
 * Other residents' already-chosen actions advance too; no new model decisions
 * or unaccepted gifts/commitments are assumed.
 */
export function hasTimelySelfRescue(world:World,resident:Resident,choices:Action[]):boolean{
 if(resident.status!=='alive'||resident.residency==='outside'||!(resident.health>0)||!resident.canDecide||!resident.canExpress)return false;
 const eligible=choices.filter(a=>!selfCareTransportBlocked(world,resident,a)&&(world.mode!=='formal'||ageAllowsAction(world,resident,a.type==='sleep'?{...a,minutes:60}:a))).filter(a=>a.type==='eat'||a.type==='sleep'||a.type==='harvest'
  ||a.type==='gather'&&world.resources.some(s=>s.id===a.resourceId&&s.kind==='bush')
  ||a.type==='commons'&&['takeFood','borrowBed'].includes(a.operation)
  ||a.type==='publicDuty'&&a.operation==='receive'
  ||a.type==='economy'&&['retrieve','buy','cancel','close'].includes(a.operation)
  ||a.type==='household'&&['withdraw','acceptGift','close'].includes(a.operation)
  ||a.type==='culture'&&['take','reclaim'].includes(a.operation)
  ||a.type==='outsideAid'&&a.operation==='collect'
  ||a.type==='foreignTrade'&&a.operation==='collect'
  ||a.type==='production'&&['collectEstate','emergencyEstateRation'].includes(a.operation)||a.type==='accept'||a.type==='cook'
  ||a.type==='industry'&&['shoreRest','harvestFruit','harvestHouse','collectAnimal','fish'].includes(a.operation));
 // Prove the common inventory-only case without cloning/stepping the whole
 // valley for every hungry resident. Any uncertain interaction falls through
 // to the authoritative forecast below. This must remain read-only.
 const rules=physiology({...world,definitions:{...world.definitions}},resident),mealMinutes=5;
 const otherActions=world.residents.filter(r=>r.id!==resident.id&&living(r)).flatMap(r=>[...(r.plan?.actions??[]),...(r.activity?[r.activity.action]:[])]);
 const localActions=new Set(['move','wait','sleep','eat','gather','plant','water','harvest','cook','talk']);
 const hazards=world.frontierHazards;
 const ageAtMeal=knownAgeYears(resident.bornAt,world.minute+mealMinutes);
 const safeHorizon=(world.mode!=='formal'||ageAtMeal===null||ageAtMeal>=6)
  &&!world.health?.cases.some(c=>c.personId===resident.id&&c.stage!=='resolved')
  &&ageYears(resident.bornAt,world.minute+mealMinutes)<rules.elderYears
  &&!aboardFerry(world,resident.id)&&!passenger(world,resident.id)
  &&(!resident.pregnancy||resident.pregnancy.dueAt>world.minute+mealMinutes)
  &&otherActions.every(a=>localActions.has(a.type))
  &&(!hazards||hazards.ecologyVersion===1&&hazards.nextDisasterAt>world.minute+mealMinutes
   &&!hazards.disasters.some(d=>d.phase!=='ended'&&d.startsAt<=world.minute+mealMinutes&&disasterContains(d,resident.at))
   // Wildlife moves at most one tile per one-minute world step and strikes
   // within two tiles. Include one extra step for fractional tick boundaries.
   &&!hazards.beasts.some(b=>b.status!=='dead'&&distance(b.at,resident.at)<=mealMinutes+3));
 if(safeHorizon&&resident.energy-rules.energyPerMinute*mealMinutes>=Math.max(20,rules.energyDanger)
  &&resident.health>rules.hungerHealthDrain*mealMinutes){
  for(const a of eligible){if(a.type!=='eat'||(resident.inventory[a.item]??0)<1)continue;
   const firstLots=[...(world.food?.lots['person:'+resident.id]?.[a.item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt);
   let left=1,lasting=true;for(const lot of firstLots){if(left<=0)break;if(lot.expiresAt<=world.minute+mealMinutes){lasting=false;break;}left-=lot.quantity;}
   if(lasting&&resident.hunger+rules.hungerPerMinute*mealMinutes-foodValue(world,'person:'+resident.id,a.item)<=rules.hungerDanger)return true;
  }
 }
 // Rest cannot invent nutrition. With no other committed actor/care action
 // and no food-producing choice, a hungry resident has no rescue to simulate.
 if(resident.hunger>rules.hungerDanger&&eligible.every(a=>a.type==='sleep'||a.type==='industry'&&a.operation==='shoreRest'||a.type==='commons'&&a.operation==='borrowBed')
  &&otherActions.length===0&&!world.longCare?.agreements.some(c=>c.beneficiaryId===resident.id&&c.status==='active'))return false;
 eligible.sort((a,b)=>Number(b.type==='eat')-Number(a.type==='eat'));
 for(const candidate of eligible){
  const w=copyForSimulation(world);w.clock.paused=false;
  const r=w.residents.find(p=>p.id===resident.id)!;
  delete r.decisionProtection;r.plan=null;r.activity=null;r.lastFailure=null;
  const initial={hunger:r.hunger,energy:r.energy};
  let serial=0;
  const plan=(action:Action)=>{r.plan={id:'survival-preview:'+serial++,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine']??'action/routine@1',intention:'',actions:[structuredClone(action)]};};
  plan(candidate.type==='sleep'?{...candidate,minutes:60}:candidate);
  for(let minute=0;minute<SURVIVAL_FORECAST_MINUTES;minute++){
   stepWorld(w,1);
   const drain=needHealthDrain(w,r);
   if(r.status!=='alive'||r.health<=0||!r.canDecide||!r.canExpress||r.lastFailure)break;
   if(drain.hunger+drain.exhaustion===0&&(r.hunger<initial.hunger||r.energy>initial.energy))return true;
   if(!r.plan&&!r.activity){
    const item=(Object.keys(r.inventory) as Array<keyof Inventory>).find(i=>(r.inventory[i]??0)>=1&&goods[i].food>0);
    if(drain.hunger>0&&item)plan({type:'eat',item});
    else if(drain.exhaustion>0&&candidate.type==='commons'&&candidate.operation==='borrowBed')plan({type:'sleep',buildingId:candidate.buildingId,minutes:60});
    else if(drain.exhaustion>0&&choices.some(a=>a.type==='sleep'))plan({...choices.find(a=>a.type==='sleep') as Extract<Action,{type:'sleep'}>,minutes:60});
    else break;
   }
  }
 }
 return false;
}

/** A syntactically valid reply is not a usable decision if its first action
 * already fails current stock, permission, route or workplace checks. */
export function planStartError(world:World,plan:Plan):string|null{
 const preview=copyForSimulation(world);
 const actor=preview.residents.find(r=>r.id===plan.actorId);
 if(!actor)return '人物当前无法提交新决定';
 if(plan.actions.length===1&&(careSelfWithdrawal(preview,actor,plan.actions[0])||careExpressionWait(preview,actor,plan.actions[0])))return null;
 if(plan.actions.some(a=>isBasicCareWithdrawal(preview,a)))return '这一次照护停止须是本人单独的当前有效决定';
 if(plan.actions.length===1&&expressiveTransportChoice(preview,actor,plan.actions[0]))return plan.actions[0].type==='health'?healthReason(preview,actor,plan.actions[0]):null;
 if(plan.actions.length===1&&isWaterSupportWithdrawal(plan.actions[0])&&plan.actions[0].type==='waterSupply')return waterSupplyWorkReason(preview,actor,plan.actions[0],0);
 actor.plan=structuredClone(plan);actor.activity=null;actor.lastFailure=null;
 beginRoomTick(preview);
 processActivity(preview,actor,1);
 return actor.lastFailure;
}

function complete(world:World,r:Resident,a:Action,definition:string,elapsed=0):string|null{
 const identity=r.activity?completedWorkIdentity(r.id,r.activity,a):null;
 const before=identity?new Set(world.events.map(e=>e.id)):null;
 try{
  const error=foodTransaction(world,()=>completeAtomic(world,r,a,definition,elapsed));
  if(!error&&identity&&before){
   // These supported branches emit one success fact. Ambiguous/no-event results stay silent.
   const facts=world.events.filter(e=>!before.has(e.id)&&(e.kind==='action'||e.kind==='production')&&e.actors.length===1&&e.actors[0]===r.id);
   if(facts.length===1)facts[0].workCompleted=identity;
  }
  return error;
 }
 finally{finishFoodFlowAction(world);}
}

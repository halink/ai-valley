/** Authoritative state. Minutes always mean world minutes; wall-clock never ages a resident. */
export type Vec = {x:number;y:number};
/** Outside-map position, never a local tile or an accessible valley stock. */
export interface RegionalLocation {routeId:string;origin:string;progress:number;duration:number;}
export type Season = 'spring'|'summer'|'autumn'|'winter';
export type Item = import('./items.js').GoodsKey;
export type Inventory = Partial<Record<Item,number>>;
export type Tile = 'grass'|'path'|'water'|'sand'|'cliff'|'soil'|'bridge'|'road';
export type BuildingKind = 'home'|'lodge'|'workshop'|'clinic'|'school'|'barn'|'greenhouse'|'store';
export interface Building {lastHazardDamage?:{disasterId:string;eventId:string};id:string;kind:BuildingKind;name:string;at:Vec;width:number;height:number;door:Vec;ownerId:string|'commons';definition:string;capacity:number;residents:string[];condition:number;conversions?:Array<{projectId:string;from:BuildingKind;to:BuildingKind;oldDefinition:string;definition:string;completedAt:number}>;extensions?:Array<{projectId:string;definition:string;completedAt:number;addedArea:number}>;}
/** A remembered address is not a live feed of the building or its household. */
export interface KnownBuilding {
 id:string;kind:BuildingKind;name:string;door:Vec;ownerId?:string;
 observed?:{atMinute:number;condition:number;capacity?:number;ownResidence?:boolean;ownBed?:boolean};
}
export interface Resource {id:string;kind:'tree'|'rock'|'bush'|'spring';at:Vec;amount:number;max:number;regrowthDays:number;lastHarvest:number;floodDamage?:{disasterId:string;at:number;clearedAt:number|null};}
export interface Plot {id:string;at:Vec;ownerId:string;crop:null|{definition:string;planted:number;growth:number;wateredDay:number;lastGrowthDay:number};}
export interface PartnershipEnd {kind:'dating'|'married';startedAt:number|null;marriedAt:number|null;endedAt:number|null;reason:'death';deceasedId:string|null;}
export interface Relation {partnerSince?:number;marriedAt?:number;pastPartnerships?:Array<PartnershipEnd&{eventId:string}>;targetId:string;affection:number;trust:number;conflict:number;lastInterpretation?:import('./social-life.js').PersonalInterpretation;kin?:'parent'|'child'|'sibling';adoptive?:'parent'|'child'|'sibling';partner?:'dating'|'married';evidence:string[];}
export interface Memory {speechText?:string;speechTone?:import('./speech-tone.js').SpeechTone;eventId:string;receivedAt:number;source:'witness'|'heard'|'self';text:string;}
export type PopulationChange = 'visit'|'endVisit'|'settle'|'moveHome'|'depart'|'birth'|'death'|'dating'|'marriage'|'separate'|'adult'|'guardian'|'adoption';
export interface PersonObservation {id:string;at:Vec;inside:string|null;roomAt:Vec|null;atMinute:number;}
export type Action = DomainAction & {observedTarget?:PersonObservation};
type DomainAction =
 | import('./social-appointments.js').SocialAppointmentAction
 | import('./food-source-sharing.js').ShareFoodSourceAction
 | import('./personal-food-gifts.js').PersonalFoodGiftAction
 | import('./adult-presence.js').AdultPresenceAction
 | import('./pregnancy-preparation.js').PregnancyPreparationAction
 | import('./region-survey.js').RegionSurveyAction
 | import('./water-supply.js').WaterSupplyAction
 | import('./emergency-care.js').EmergencyCareAction
 | import('./outside-aid.js').OutsideAidAction
 | import('./designs.js').DesignAction
 | import('./frontier-hazards.js').FrontierHazardAction
 | import('./ferry.js').FerryAction
 | import('./building-migration.js').BuildingMigrationAction
 | {type:'promise';operation:'inspect'|'withdraw';promiseId:string}
 | import('./culture.js').CultureAction
 | import('./social-life.js').SocialAction
 | import('./household.js').HouseholdAction
 | import('./debt.js').DebtAction
 | import('./adoption.js').AdoptionAction
 | import('./family-relocation.js').FamilyRelocationAction
 | import('./agency.js').AgencyAction
 | import('./funerary.js').FuneraryAction
 | import('./last-wishes.js').LastWishAction
 | import('./long-care.js').LongCareAction
 | import('./health.js').HealthAction
 | import('./industry.js').IndustryAction
 | import('./education.js').EducationAction
 | import('./land-rights.js').LandRightsAction
 | import('./construction.js').ConstructionAction
 | import('./employment.js').EmploymentAction
 | import('./foreign-trade.js').ForeignAction
 | import('./business-relocation.js').BusinessRelocationAction
 | import('./premises.js').PremisesAction
 | import('./economy.js').EconomyAction
 | import('./civic.js').CivicAction
 | import('./commons.js').CommonsAction
 | import('./production.js').ProductionAction
 | import('./public-duties.js').PublicDutyAction
 | {type:'travelWithFamily';partnerId:string}
 | import('./visitor-journey.js').VisitorJourneyAction
 | {type:'travelToValley'} | {type:'stayOutside'}
 | {type:'inviteHome';targetId:string} | {type:'homeReply';targetId:string;accept:boolean}
 | {type:'familyConsent';targetId:string;accept:boolean;offerId?:string}
 | {type:'tendChild'|'fosterChild';targetId:string}
 | {type:'move';to:Vec}
 | {type:'wait';minutes:number}
 | {type:'gather';resourceId:string;quantity:number}
 | {type:'plant'|'water'|'harvest';plotId:string}
 | {type:'eat';item:Item}
 | {type:'sleep';minutes:number;buildingId?:string}
 | {type:'cook';quantity:number;buildingId?:string}
 | {type:'talk';targetId:string;text:string;tone:import('./speech-tone.js').SpeechTone}
 | {type:'build';kind:BuildingKind;at:Vec}
 | {type:'offer';targetId:string;give:Inventory;want:Inventory}
 | {type:'accept';offerId:string;offerTerms?:OfferTerms}
 | {type:'care';targetId:string;proposalId?:string}
 | {type:'learn';targetId:string;skill:'farming'|'building'|'care'}
 | {type:'propose';targetId:string;proposal:'dating'|'marriage'|'child'|'care'}
 | {type:'respond';proposalId:string;accept:boolean}
 | {type:'separate';targetId:string}
 | {type:'bury';targetId:string;wishId?:string}
 | {type:'leave'}
 | {type:'lodge';buildingId:string}
 | {type:'settle';buildingId:string};
export interface Plan {id:string;actorId:string;actorRevision:number;createdAt:number;definition:string;intention:string;actions:Action[];}
export interface Activity {appointmentStartedAt?:number;appointmentWork?:{from:number;through:number;minutes:number};foodSourceShareWork?:{from:number;through:number;minutes:number};foodGiftWork?:{from:number;through:number;minutes:number};presenceWork?:{from:number;through:number;minutes:number;provider:PersonObservation;person:PersonObservation};room?:import('./rooms.js').RoomJourney;planId:string;action:Action;startedAt:number;remaining:number;path:Vec[];target:Vec;definition:string;cargo?:{bodyId:string;graveId?:string;storageId?:string;storageSlot?:number;pickedUp:boolean;pickupRemaining?:number};travelProgress?:number;}
export type CompletedAction = {type:Action['type'];at:number;minutes?:number;energy?:number};
export interface Resident {foodSourceKnowledge?:import('./food-source-sharing.js').FoodSourceKnowledge;regionalLocation?:RegionalLocation;knownDocks?:string[];physiologyDefinition?:string;
 decisionProtection?:import('./decision-protection.js').DecisionProtection;
 recentActions?:CompletedAction[];
 adoptiveParents?:string[];
 agency?:import('./agency.js').AgencyState;
 partnerDeathNotices?:Record<string,{eventId:string;sourceEventId:string;receivedAt:number}>;
 deathKnowledge?:Record<string,{eventId:string;source:'witness'|'document';confirmedAt:number;location:{at:Vec;roomId:string|null;roomAt?:Vec|null;atMinute:number;eventId:string}|null}>;
 body?:{reservedBy:string|null;carriedBy:string|null;storedAt:string|null;storageSlot?:number|null};
 roomAt?:Vec|null;
 id:string;name:string;appearance:{hair:number;shirt:number;skin:number};at:Vec;inside:string|null;
 bornAt:number;status:'alive'|'dead';residency:'resident'|'visitor'|'outside';homeId:string|null;traits:string[];
 hunger:number;energy:number;health:number;inventory:Inventory;coins:number;skills:{farming:number;building:number;care:number};
 relations:Relation[];memories:Memory[];knownPeople:string[];knownResources:string[];knownBuildings:string[];
 plan:Plan|null;activity:Activity|null;intention:string;revision:number;decisionDue:number;lastDecisionAt:number;lastFailure:string|null;
 parents:string[];guardianIds:string[];pregnancy:null|{otherParentId:string;conceivedAt:number;dueAt:number;definition:string};
 canDecide:boolean;canExpress:boolean;refusesCare:boolean;deathAt:number|null;deathCause?:'oldAge'|'illHealth'|'accident';
 deathDetail?:string;
 lifeStage?:'infant'|'child'|'teen'|'adult'|'elder';
 homeInvitation?:{hostId:string;buildingId:string;expiresAt:number};
 guardianOffer?:{id?:string;createdAt?:number;volunteerId:string;guardianId?:string;guardianApproved:boolean;childApproved:boolean;childApprovedAt?:number|null;expiresAt:number};
}
export interface WorldEvent {workCompleted?:import('./work-completion.js').WorkCompleted;foodSourceShare?:{speakerId:string;listenerId:string;source:import('./food-source-sharing.js').FoodSourceSight};speechText?:string;speechTone?:import('./speech-tone.js').SpeechTone;waterSupply?:import('./water-history.js').WaterSupplyFact;hazardFact?:{disasterId:string;phase:'warning'|'active'|'ended'|'damage'|'injury'|'retreat'|'shelter'|'repair';targetId?:string;before?:number;after?:number};regionalLocation?:RegionalLocation;relationshipEnd?:PartnershipEnd;decisionProtection?:{phase:'started'|'ended';state:import('./decision-protection.js').DecisionProtection;after:{health:number;hunger:number;energy:number}};designId?:string;observerOnly?:boolean;animalIds?:string[];interpretation?:{observerId:string;targetId:string;sourceEventId:string;source:Memory['source']};bodyLocation?:{personId:string;at:Vec;roomId:string|null;roomAt?:Vec|null};roomId?:string|null;roomAt?:Vec|null;id:string;at:number;populationChange?:PopulationChange;kind:'production'|'education'|'duty'|'arrival'|'action'|'conversation'|'relationship'|'birth'|'death'|'burial'|'departure'|'construction'|'trade'|'system'|'care'|'hazard';actors:string[];place:Vec;text:string;witnesses:string[];conversationId?:string;audit?:{rule:string;authority:string;evidence:string;scope:string[];resources:Inventory;providerId:string;termination:string};}
export interface Offer {id:string;actorId:string;targetId:string;give:Inventory;want:Inventory;expiresAt:number;status:'open'|'accepted'|'expired';definition:string;}
/** The exact proposal selected by an acceptor, independent of later world edits. */
export type OfferTerms=Omit<Offer,'status'>;
export interface Proposal {id:string;actorId:string;targetId:string;kind:'dating'|'marriage'|'child'|'care';createdAt:number;expiresAt:number;status:'open'|'accepted'|'declined'|'expired';definition:string;}
export interface Grave {reservedBy?:string|null;condition?:number;lastMaintainedAt?:number;epitaph?:string;id:string;at:Vec;personId:string|null;buriedAt:number|null;}
export interface EstateParcel {id:string;ownerId:string;inventory:Inventory;location:{at:Vec;inside:string|null;roomAt:Vec|null;label?:string;regional?:RegionalLocation};createdAt:number;source:string;claimId:string|null;}
export interface Estate {spouseIds?:string[];location?:EstateParcel['location'];parcels?:EstateParcel[];personId:string;inventory:Inventory;coins:number;status:'protected'|'settled';heirs:string[];}
export interface ModelCharge {startedAt:number;input:number;output:number;finishedAt?:number;}
/** Bounded opt-in receipt for an explicitly rejected, already counted local
 * request start. It does not represent a model call, decision, refund or bill. */
export interface ModelAdmissionCancellation {actorId:string;model:string;requestNumber:number;revision:number;atMs:number;monotonicNs:string;
 count:number;baselineRequests:number;baselineCancellations:number;previousReceiptHash:string|null;}
export interface ModelMetrics {admissionCancellation?:ModelAdmissionCancellation;regionalDecisions?:number;localDecisions?:number;requests:number;successes:number;failures:number;inputTokens:number;outputTokens:number;lastLatencyMs:number;unmeteredFailures?:number;lastError:string|null;inFlight:string[];model:string;configured:boolean;lastAttemptModel?:string;usageWindow?:Record<string,ModelCharge[]>;routing?:{primary:string;primaryConfigured:boolean;backup:string;backupConfigured:boolean};}
export interface World {ferries?:import('./ferry.js').FerryState;buildingMigrations?:import('./building-migration.js').BuildingUpgrade[];regions?:Array<{id:string;name:string;openedAt:number;width:number;height:number;access:Vec;sourceIds:string[];fishKeys:string[]}>;
 pregnancyPreparation?:import('./pregnancy-preparation.js').PregnancyPreparationState;
 regionSurveys?:import('./region-survey.js').RegionSurveyState;
 waterSupply?:import('./water-supply.js').WaterSupplyState;
 socialAppointments?:import('./social-appointments.js').SocialAppointments;
 personalFoodGifts?:import('./personal-food-gifts.js').PersonalFoodGifts;
 adultPresence?:import('./adult-presence.js').AdultPresenceState;
 emergencyCare?:import('./emergency-care.js').EmergencyCareState;
 outsideAid?:import('./outside-aid.js').OutsideAidState;
 scenario?:'frontier';
 designs?:import('./designs.js').DesignState;
 frontierHazards?:import('./frontier-hazards.js').FrontierHazardState;
 culture?:import('./culture.js').CultureState;
 social?:import('./social-life.js').SocialLife;
 household?:import('./household.js').HouseholdState;
 debt?:import('./debt.js').DebtState;
 adoption?:import('./adoption.js').AdoptionState;
 familyRelocation?:import('./family-relocation.js').FamilyRelocationState;
 infrastructure?:import('./infrastructure.js').InfrastructureState;
 funerary?:import('./funerary.js').FuneraryState;
 lastWishes?:import('./last-wishes.js').LastWishesState;
 longCare?:import('./long-care.js').LongCareState;
 health?:import('./health.js').HealthState;
 food?:import('./food.js').FoodState;
 rooms?:import('./rooms.js').RoomState;
 industry?:import('./industry.js').IndustryState;
 education?:import('./education.js').EducationState;
 landRights?:import('./land-rights.js').LandRightsState;
 construction?:import('./construction.js').ConstructionState;
 employment?:import('./employment.js').EmploymentState;
 foreignTrade?:import('./foreign-trade.js').ForeignTradeState;
 economy?:import('./economy.js').EconomyState;
 civic?:import('./civic.js').CivicState;
 commons?:import('./commons.js').CommonsState;
 production?:import('./production.js').ProductionState;
 migration?:import('../world/migration.js').MigrationState;
 duties?:import('./public-duties.js').PublicDuties;
 population?:import('./demography.js').PopulationBook;
 schemaVersion:1;id:string;revision:number;seed:number;mode:'validation'|'formal';minute:number;lastWallAt:number;
 clock:{paused:boolean;reason:string|null;realMinutesPerDay:number};weather:'sun'|'rain';
 map:{width:number;height:number;tiles:Tile[];name:string;entrance:Vec;settlement?:Vec};
 residents:Resident[];buildings:Building[];resources:Resource[];plots:Plot[];graves:Grave[];
 events:WorldEvent[];offers:Offer[];proposals:Proposal[];estates:Estate[];processed:string[];
 definitions:Record<string,ContentDefinition>;activeDefinitions:Record<string,string>;metrics:ModelMetrics;
}
export interface ContentDefinition {id:string;version:number;kind:'building'|'recipe'|'action'|'life';dependencies:string[];cost?:Inventory;minutes?:number;data:Record<string,unknown>;}
export interface FormalOpportunity {id:string;label:string;action:Action;chooseDuration?:boolean;}
export interface DecisionContext {
 relationshipMemories?:import('./relationship-memory.js').RelationshipMemories;
 foreign?:{origin:string;notice:string;choices:FormalOpportunity[]};
 outside?:{origin:string;notice:string;choices:FormalOpportunity[]};
 formal?:{/** Current read-only harvest/meal forecasts, never saved authority. */harvestMeals?:{atMinute:number;plots:Array<{plotId:string;minutes:number}>};socialAppointmentNotes?:string;personalFoodGiftNotes?:string;/** Current narrow selfcare menu; independent of display-only knownAge. */unknownAgeSelfCare?:FormalOpportunity[];personalFoodProcessing?:import('./personal-food-processing.js').PersonalFoodProcessing;personalFoodFreshness?:import('./personal-food-freshness.js').PersonalFoodFreshness;foodCoverage?:import('./food-coverage.js').ResidentFoodCoverage;aboard?:boolean;passenger?:boolean;expressiveEvacuationOnly?:boolean;careWithdrawalOnly?:boolean;familyTravelling?:boolean;frontier?:boolean;age:number;/** Display only; null means unknown, absent supports old decision contexts. */knownAge?:number|null;productiveFarming?:boolean;familyNotes?:string;hasBed?:boolean;sleepRecoveryPerHour?:number;planSteps?:number;opportunities:FormalOpportunity[]};
 actor:Pick<Resident,'id'|'name'|'traits'|'hunger'|'energy'|'health'|'inventory'|'skills'|'intention'|'at'|'homeId'|'lastFailure'|'recentActions'> & {coins?:number;agency?:Resident['agency'];barterEligible?:boolean};
 bounds:{width:number;height:number};minute:number;season:Season;weather:World['weather'];
 people:Array<Pick<Resident,'id'|'name'|'at'|'intention'|'status'> & {inside?:string|null;roomAt?:Vec|null;relation:Relation|null;talkEligible?:boolean;interactionEligible?:boolean;barterEligible?:boolean;talkDistance?:number;bodyObservation?:import('./body-observation.js').BodyObservation}>;
 buildings:KnownBuilding[];resources:Array<Omit<Resource,'floodDamage'>&{waterBlocked?:boolean}>;plots:Array<Plot&{observed?:import('./crop-observation.js').CropObservation}>;knownLand:Array<{id:string;at:Vec}>;offers:Offer[];proposals:Proposal[];memories:Memory[];
}
export interface ModelDecision {intention:string;actions:Action[];}
export interface Snapshot {mapRevision?:string;world:World;foodCoverage?:import('./food-coverage.js').SettlementFoodCoverage;serverTime:string;version:string;capabilities:{active:string[];pending:string[]};}

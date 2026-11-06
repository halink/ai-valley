/** Authoritative state. Minutes always mean world minutes; wall-clock never ages a resident. */
export type Vec = {x:number;y:number};
export type Season = 'spring'|'summer'|'autumn'|'winter';
export type Item = import('./items.js').GoodsKey;
export type Inventory = Partial<Record<Item,number>>;
export type Tile = 'grass'|'path'|'water'|'sand'|'cliff'|'soil'|'bridge'|'road';
export type BuildingKind = 'home'|'lodge'|'workshop'|'clinic'|'school'|'barn'|'greenhouse'|'store';
export interface Building {id:string;kind:BuildingKind;name:string;at:Vec;width:number;height:number;door:Vec;ownerId:string|'commons';definition:string;capacity:number;residents:string[];condition:number;conversions?:Array<{projectId:string;from:BuildingKind;to:BuildingKind;oldDefinition:string;definition:string;completedAt:number}>;extensions?:Array<{projectId:string;definition:string;completedAt:number;addedArea:number}>;}
export interface Resource {id:string;kind:'tree'|'rock'|'bush'|'spring';at:Vec;amount:number;max:number;regrowthDays:number;lastHarvest:number;}
export interface Plot {id:string;at:Vec;ownerId:string;crop:null|{definition:string;planted:number;growth:number;wateredDay:number;lastGrowthDay:number};}
export interface Relation {targetId:string;affection:number;trust:number;conflict:number;lastInterpretation?:import('./social-life.js').PersonalInterpretation;kin?:'parent'|'child'|'sibling';adoptive?:'parent'|'child'|'sibling';partner?:'dating'|'married';evidence:string[];}
export interface Memory {eventId:string;receivedAt:number;source:'witness'|'heard'|'self';text:string;}
export type PopulationChange = 'visit'|'endVisit'|'settle'|'moveHome'|'depart'|'birth'|'death'|'dating'|'marriage'|'separate'|'adult'|'guardian'|'adoption';
export interface PersonObservation {id:string;at:Vec;inside:string|null;roomAt:Vec|null;atMinute:number;}
export type Action = DomainAction & {observedTarget?:PersonObservation};
type DomainAction =
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
 | import('./agency.js').AgencyAction
 | import('./funerary.js').FuneraryAction
 | import('./long-care.js').LongCareAction
 | import('./health.js').HealthAction
 | import('./industry.js').IndustryAction
 | import('./education.js').EducationAction
 | import('./construction.js').ConstructionAction
 | import('./employment.js').EmploymentAction
 | import('./foreign-trade.js').ForeignAction
 | import('./economy.js').EconomyAction
 | import('./civic.js').CivicAction
 | import('./production.js').ProductionAction
 | import('./public-duties.js').PublicDutyAction
 | {type:'travelWithFamily';partnerId:string}
 | {type:'travelToValley'} | {type:'stayOutside'}
 | {type:'inviteHome';targetId:string} | {type:'homeReply';targetId:string;accept:boolean}
 | {type:'familyConsent';targetId:string;accept:boolean}
 | {type:'tendChild'|'fosterChild';targetId:string}
 | {type:'move';to:Vec}
 | {type:'wait';minutes:number}
 | {type:'gather';resourceId:string;quantity:number}
 | {type:'plant'|'water'|'harvest';plotId:string}
 | {type:'eat';item:Item}
 | {type:'sleep';minutes:number}
 | {type:'cook';quantity:number}
 | {type:'talk';targetId:string;text:string;tone:'friendly'|'neutral'|'hostile'}
 | {type:'build';kind:BuildingKind;at:Vec}
 | {type:'offer';targetId:string;give:Inventory;want:Inventory}
 | {type:'accept';offerId:string}
 | {type:'care';targetId:string}
 | {type:'learn';targetId:string;skill:'farming'|'building'|'care'}
 | {type:'propose';targetId:string;proposal:'dating'|'marriage'|'child'|'care'}
 | {type:'respond';proposalId:string;accept:boolean}
 | {type:'separate';targetId:string}
 | {type:'bury';targetId:string}
 | {type:'leave'}
 | {type:'lodge';buildingId:string}
 | {type:'settle';buildingId:string};
export interface Plan {id:string;actorId:string;actorRevision:number;createdAt:number;definition:string;intention:string;actions:Action[];}
export interface Activity {room?:import('./rooms.js').RoomJourney;planId:string;action:Action;startedAt:number;remaining:number;path:Vec[];target:Vec;definition:string;cargo?:{bodyId:string;graveId?:string;storageId?:string;storageSlot?:number;pickedUp:boolean;pickupRemaining?:number};travelProgress?:number;}
export type CompletedAction = {type:Action['type'];at:number;minutes?:number;energy?:number};
export interface Resident {knownDocks?:string[];physiologyDefinition?:string;
 recentActions?:CompletedAction[];
 adoptiveParents?:string[];
 agency?:import('./agency.js').AgencyState;
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
 guardianOffer?:{volunteerId:string;guardianId?:string;guardianApproved:boolean;childApproved:boolean;expiresAt:number};
}
export interface WorldEvent {designId?:string;observerOnly?:boolean;animalIds?:string[];interpretation?:{observerId:string;targetId:string;sourceEventId:string;source:Memory['source']};bodyLocation?:{personId:string;at:Vec;roomId:string|null;roomAt?:Vec|null};roomId?:string|null;roomAt?:Vec|null;id:string;at:number;populationChange?:PopulationChange;kind:'production'|'education'|'duty'|'arrival'|'action'|'conversation'|'relationship'|'birth'|'death'|'burial'|'departure'|'construction'|'trade'|'system'|'care'|'hazard';actors:string[];place:Vec;text:string;witnesses:string[];conversationId?:string;audit?:{rule:string;authority:string;evidence:string;scope:string[];resources:Inventory;providerId:string;termination:string};}
export interface Offer {id:string;actorId:string;targetId:string;give:Inventory;want:Inventory;expiresAt:number;status:'open'|'accepted'|'expired';definition:string;}
export interface Proposal {id:string;actorId:string;targetId:string;kind:'dating'|'marriage'|'child'|'care';createdAt:number;expiresAt:number;status:'open'|'accepted'|'declined'|'expired';definition:string;}
export interface Grave {reservedBy?:string|null;condition?:number;lastMaintainedAt?:number;epitaph?:string;id:string;at:Vec;personId:string|null;buriedAt:number|null;}
export interface EstateParcel {id:string;ownerId:string;inventory:Inventory;location:{at:Vec;inside:string|null;roomAt:Vec|null;label?:string};createdAt:number;source:string;claimId:string|null;}
export interface Estate {location?:EstateParcel['location'];parcels?:EstateParcel[];personId:string;inventory:Inventory;coins:number;status:'protected'|'settled';heirs:string[];}
export interface ModelCharge {startedAt:number;input:number;output:number;finishedAt?:number;}
export interface ModelMetrics {requests:number;successes:number;failures:number;inputTokens:number;outputTokens:number;lastLatencyMs:number;unmeteredFailures?:number;lastError:string|null;inFlight:string[];model:string;configured:boolean;lastAttemptModel?:string;usageWindow?:Record<string,ModelCharge[]>;routing?:{primary:string;primaryConfigured:boolean;backup:string;backupConfigured:boolean};}
export interface World {ferries?:import('./ferry.js').FerryState;buildingMigrations?:import('./building-migration.js').BuildingUpgrade[];regions?:Array<{id:string;name:string;openedAt:number;width:number;height:number;access:Vec;sourceIds:string[];fishKeys:string[]}>;
 scenario?:'frontier';
 designs?:import('./designs.js').DesignState;
 frontierHazards?:import('./frontier-hazards.js').FrontierHazardState;
 culture?:import('./culture.js').CultureState;
 social?:import('./social-life.js').SocialLife;
 household?:import('./household.js').HouseholdState;
 debt?:import('./debt.js').DebtState;
 adoption?:import('./adoption.js').AdoptionState;
 infrastructure?:import('./infrastructure.js').InfrastructureState;
 funerary?:import('./funerary.js').FuneraryState;
 longCare?:import('./long-care.js').LongCareState;
 health?:import('./health.js').HealthState;
 food?:import('./food.js').FoodState;
 rooms?:import('./rooms.js').RoomState;
 industry?:import('./industry.js').IndustryState;
 education?:import('./education.js').EducationState;
 construction?:import('./construction.js').ConstructionState;
 employment?:import('./employment.js').EmploymentState;
 foreignTrade?:import('./foreign-trade.js').ForeignTradeState;
 economy?:import('./economy.js').EconomyState;
 civic?:import('./civic.js').CivicState;
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
export interface FormalOpportunity {id:string;label:string;action:Action;}
export interface DecisionContext {
 foreign?:{origin:string;notice:string;choices:FormalOpportunity[]};
 outside?:{origin:string;notice:string;choices:FormalOpportunity[]};
 formal?:{aboard?:boolean;passenger?:boolean;frontier?:boolean;age:number;productiveFarming?:boolean;familyNotes?:string;hasBed?:boolean;sleepRecoveryPerHour?:number;planSteps?:number;opportunities:FormalOpportunity[]};
 actor:Pick<Resident,'id'|'name'|'traits'|'hunger'|'energy'|'health'|'inventory'|'skills'|'intention'|'at'|'homeId'|'lastFailure'|'recentActions'> & {coins?:number;agency?:Resident['agency']};
 bounds:{width:number;height:number};minute:number;season:Season;weather:World['weather'];
 people:Array<Pick<Resident,'id'|'name'|'at'|'intention'|'status'> & {inside?:string|null;roomAt?:Vec|null;relation:Relation|null}>;
 buildings:Building[];resources:Resource[];plots:Plot[];knownLand:Array<{id:string;at:Vec}>;offers:Offer[];proposals:Proposal[];memories:Memory[];
}
export interface ModelDecision {intention:string;actions:Action[];}
export interface Snapshot {mapRevision?:string;world:World;serverTime:string;version:string;capabilities:{active:string[];pending:string[]};}

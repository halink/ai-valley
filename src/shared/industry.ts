import type {Inventory,Vec} from './types.js';
import type {AnimalActivity} from './animal-behavior.js';
export type StationKind='bench'|'forge'|'mill'|'dairy'|'loom'|'preserver';
export const toolKits={axe:'axeKit',pick:'pickKit',rod:'rodKit',spear:'spearKit'} as const;
export type ToolKind=keyof typeof toolKits;
export type AnimalKind='chicken'|'goat'|'sheep'|'duck'|'cow';
export interface IndustryAction {
 type:'industry';processDefinition?:string;recipeDefinition?:string;stationDefinition?:string;operation:'craft'|'install'|'uninstall'|'equip'|'collectTool'|'upgrade'|'repairTool'|'plantTree'|'tendTree'|'harvestFruit'|'cutTree'|'feedCrate'|'waterCrate'|'placeAnimal'|'feedAnimal'|'waterAnimal'|'collectAnimal'|'breedAnimal'|'moveAnimal'|'tameAnimal'|'plantHouse'|'tendHouse'|'harvestHouse'|'fish'|'shoreRest'|'hunt'|'mine'|'deepen';
 phase?:'pickup'|'delivery';stationId?:string;toolId?:string;batchId?:string;depth?:number;recipeId?:string;station?:StationKind;tool?:ToolKind;buildingId?:string;pastureId?:string;plotId?:string;treeId?:string;animalId?:string;beastId?:string;partnerId?:string;kind?:AnimalKind;cropId?:string;bed?:number;at?:Vec;mineId?:string;minutes?:number;
}
export interface CraftRecipe {id:string;name:string;input:Inventory;output:Inventory;minutes:number;station:StationKind|null;skill:'farming'|'building'|'care';minimum:number;}
export interface CraftBatch {definition?:string;id:string;ownerId:string;buildingId:string;recipe:CraftRecipe;input:Inventory;actionKey:string;worked:number;lastAt:number;status:'working'|'completed'|'cancelled';createdAt:number;}
export interface OrchardTree {definition?:string;id:string;ownerId:string;plotId:string;at:Vec;plantedAt:number;growth:number;lastWateredDay:number;lastMinute:number;fruit:number;fruitProgress:number;status:'growing'|'mature'|'cut';}
export interface Livestock {definition?:string;id:string;ownerId:string;kind:AnimalKind;sex:'female'|'male';bornAt:number;carrierId?:string|null;at?:Vec;inside?:string|null;roomAt?:Vec|null;destinationId?:string|null;barnId:string;pastureId?:string;pen?:number;hunger:number;thirst:number;health:number;status:'alive'|'dead';deathAt:number|null;deathDetail?:string;product:number;progress:number;pregnancy:null|{sireId:string;dueAt:number};lastMinute:number;energy?:number;activity?:AnimalActivity;lactatesUntil?:number;}
export interface Pasture {id:string;barnId:string;tiles:Vec[];forage:number;capacity:number;lastMinute:number;}
export interface ToolAsset {designId?:string;definition?:string;location?:{at:Vec;inside:string|null;roomAt:Vec|null;label?:string}|null;id:string;ownerId:string;kind:ToolKind;level:number;durability:number;maxDurability:number;}
export interface MineSite {definition?:string;id:string;at:Vec;resourceId:string;depth:number;remaining:number[];exploredBy:Record<string,number>;}
export type ShoalActivity='feeding'|'resting'|'evadingFlood';
export interface FishPool {habitatBounds?:Vec;definition?:string;habitat?:'lake'|'river'|'coast';amount:number;progress:number;lastMinute:number;
 shoal?:{anchor:Vec;at:Vec;nextMoveAt:number;activity:ShoalActivity}|null;
}
export interface GreenhouseBed {id:string;buildingId:string;index:number;crop:null|{ownerId:string;definition:string;growth:number;wateredDay:number;lastMinute:number};}
export interface FixtureRemoval {salvageFraction?:number;id:string;proposalId:string;stationId:string;buildingId:string;station:StationKind;definition:string;cost:Inventory;minutes:number;worked:number;wage:number;paid:number;account:string;startsAt:number;expiresAt:number;status:'active'|'expired'|'completed';contributions:Record<string,number>;lastAt?:number;}
export interface LivestockCargo {definition:string;id:string;container:string;kind:AnimalKind;sex:'female'|'male';bornAt:number;hunger:number;thirst:number;health:number;status:'crated'|'released'|'dead';lastMinute:number;releasedAt:number|null;deathAt:number|null;deathLocation?:{at:Vec|null;inside:string|null;roomAt:Vec|null;origin:string|null;label:string};}
export interface IndustryState {livestockCargo?:LivestockCargo[];removals?:FixtureRemoval[];pastures?:Pasture[];fishingExperience?:Record<string,number>;frontierShore?:Vec;
 nextSerial:number;batches:CraftBatch[];trees:OrchardTree[];animals:Livestock[];tools:ToolAsset[];mines:MineSite[];
 stations:Array<{uninstallMinutes?:number;salvageFraction?:number;definition?:string;installedCost?:Inventory;removalWorked?:number;id:string;buildingId:string;kind:StationKind;installedAt:number}>;beds:GreenhouseBed[];
 fishing:Record<string,FishPool>;
 sources:{fishingRegisteredAt?:number;fishingOpeningUnits?:number;registeredAt:number;livestockCrates:Inventory;regionalLivestockAt?:number;mineralUnits:number};
 totals:{crafted:number;fruit:number;animalProducts:number;animalBirths:number;animalDeaths:number;fish:number;ore:number;gameMeat?:number};
}

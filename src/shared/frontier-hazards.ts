import type {Vec} from './types.js';
import type {AnimalActivity} from './animal-behavior.js';

export type FrontierHazardAction =
 | {type:'frontierHazard';operation:'shelter';dangerId:string;buildingId:string}
 | {type:'frontierHazard';operation:'retreat';dangerId:string;to:Vec}
 | {type:'frontierHazard';operation:'repair';buildingId:string}
 | {type:'frontierHazard';operation:'clearSpring';sourceId:string;damageId:string};

export const beastNames = {boar:'野猪',wolf:'灰狼',deer:'鹿',hare:'野兔',fox:'赤狐',duck:'野鸭'} as const;
/** Existing physical loot rule, shared with the finite source-evidence validator. */
export const huntedMeatYield = {boar:5,wolf:2,deer:6,hare:1,fox:2,duck:1} as const;
export const disasterNames = {flashFlood:'河水暴涨',windstorm:'山谷风暴'} as const;

export type WildlifeAlert = {attackAt:number}&(
 {residentId:string;animalId?:never;preyId?:never}|{animalId:string;residentId?:never;preyId?:never}|
 {preyId:string;residentId?:never;animalId?:never});
export interface WildBeast {
 id:string;species:keyof typeof beastNames;at:Vec;den:Vec;
 nextMoveAt:number;cooldownUntil:number;
 health:number;hunger:number;bornAt:number;status:'alive'|'dead';deathAt?:number;
 deathCause?:'hunted'|'starvation'|'oldAge'|'thirst'|'predation'|'disease';
 thirst?:number;energy?:number;sex?:'female'|'male';activity?:AnimalActivity;
 path?:{to:Vec;steps:Vec[]};pregnancy?:{dueAt:number;sireId:string};
 alert?:WildlifeAlert;
 habitatId?:string;motherId?:string;sireId?:string;lastBredAt?:number;
 migration?:{fromId:string;toId:string;startedAt:number;reason:string};nextMigrationAt?:number;
 disease?:{since:number;severity:number;cause:'contact'|'stress';sourceId?:string};diseaseExposure?:number;
}

export interface PredatorHabitat {
 id:string;species:'wolf'|'fox';at:Vec;capacity:number;
 registered:number;born:number;deaths:number;arrived:number;departed:number;
}
export interface PredatorEcology {
 version:1;registeredAt:number;lastReviewAt:number;habitats:PredatorHabitat[];
}

export type LocalWildSpecies='boar'|'deer'|'hare'|'duck';
/** Counts start at registration, not at the beginning of an unknown saved history. */
export interface WildlifePopulation {
 version:1;registeredAt:number;lastReviewAt:number;
 species:Record<LocalWildSpecies,{capacity:number;registered:number;born:number;deaths:number;tamed:number}>;
}

export interface WildFoodPatch {
 id:string;kind:'roots'|'smallGame'|'browse'|'seeds';at:Vec;amount:number;capacity:number;progress:number;
}

export interface FrontierDisaster {
 id:string;kind:keyof typeof disasterNames;at:Vec;radius:number;
 phase:'warning'|'active'|'ended';warningAt:number;startsAt:number;endsAt:number;
 intensity:number;warned:string[];exposure:Record<string,number>;lastSteppedAt?:number;
 /** Absent on legacy records: retain their original radial geometry. */
 footprint?:Vec[];
 weatherEvidence?:{from:number;through:number;rainfall:number;runoff:number;wind:number;strongWindMinutes:number;waterAt?:Vec};
}

export interface WeatherHazards {
 version:1;enabled:boolean;registeredAt:number;lastAt:number;sampledFrom?:number;
 rainfall:number;runoff:number;strongWindMinutes:number;wind:number;
 nextFloodAt:number;nextStormAt:number;
}

/** Geometry is shared by human, wildlife, fishing and navigation rules. */
export function disasterContains(d:FrontierDisaster,at:Vec):boolean {
 return d.footprint?d.footprint.some(p=>p.x===at.x&&p.y===at.y):Math.abs(d.at.x-at.x)+Math.abs(d.at.y-at.y)<=d.radius;
}

export interface FrontierHazardState {
 beasts:WildBeast[];disasters:FrontierDisaster[];shore:Vec|null;woodland:Vec;
 nextDisasterAt:number;nextSerial:number;
 foodPatches:WildFoodPatch[];nextBeastSerial:number;ecologyVersion?:number;
 predatorEcology?:PredatorEcology;wildlifePopulation?:WildlifePopulation;lastWildlifeAt?:number;
 weather?:WeatherHazards;
 totals:{injuries:number;accidentalDeaths:number;damagedBuildings:number;damagedPlots:number;repairs:number;
  livestockAttacks:number;livestockKilled:number;wildlifeDeaths:number;hunted:number};
}

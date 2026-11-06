import type {Vec} from './types.js';
import type {AnimalActivity} from './animal-behavior.js';

export type FrontierHazardAction =
 | {type:'frontierHazard';operation:'shelter';dangerId:string;buildingId:string}
 | {type:'frontierHazard';operation:'retreat';dangerId:string;to:Vec}
 | {type:'frontierHazard';operation:'repair';buildingId:string};

export const beastNames = {boar:'野猪',wolf:'灰狼',deer:'鹿',hare:'野兔',fox:'赤狐',duck:'野鸭'} as const;
export const disasterNames = {flashFlood:'河水暴涨',windstorm:'山谷风暴'} as const;

export type WildlifeAlert = {attackAt:number}&(
 {residentId:string;animalId?:never;preyId?:never}|{animalId:string;residentId?:never;preyId?:never}|
 {preyId:string;residentId?:never;animalId?:never});
export interface WildBeast {
 id:string;species:keyof typeof beastNames;at:Vec;den:Vec;
 nextMoveAt:number;cooldownUntil:number;
 health:number;hunger:number;bornAt:number;status:'alive'|'dead';deathAt?:number;
 deathCause?:'hunted'|'starvation'|'oldAge'|'thirst'|'predation';
 thirst?:number;energy?:number;sex?:'female'|'male';activity?:AnimalActivity;
 path?:{to:Vec;steps:Vec[]};pregnancy?:{dueAt:number;sireId:string};
 alert?:WildlifeAlert;
}

export interface WildFoodPatch {
 id:string;kind:'roots'|'smallGame'|'browse'|'seeds';at:Vec;amount:number;capacity:number;progress:number;
}

export interface FrontierDisaster {
 id:string;kind:keyof typeof disasterNames;at:Vec;radius:number;
 phase:'warning'|'active'|'ended';warningAt:number;startsAt:number;endsAt:number;
 intensity:number;warned:string[];exposure:Record<string,number>;
}

export interface FrontierHazardState {
 beasts:WildBeast[];disasters:FrontierDisaster[];shore:Vec|null;woodland:Vec;
 nextDisasterAt:number;nextSerial:number;
 foodPatches:WildFoodPatch[];nextBeastSerial:number;ecologyVersion?:number;
 totals:{injuries:number;accidentalDeaths:number;damagedBuildings:number;damagedPlots:number;repairs:number;
  livestockAttacks:number;livestockKilled:number;wildlifeDeaths:number;hunted:number};
}

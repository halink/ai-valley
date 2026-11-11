import type {Season} from './types.js';
import {fishNames,type FishHabitat} from './fishing-rules.js';
export type FishSpecies=keyof typeof fishNames;
export const fishSpecies=Object.keys(fishNames) as FishSpecies[];
export const fishItems={perch:'perch',carp:'carp',catfish:'catfish',bream:'bream',snapper:'snapper',cod:'cod',crucian:'crucian'} as const;
/** Counts are allocations of existing stock at registration, not reconstructed historical catches. */
export const habitatSpecies:Record<FishHabitat,FishSpecies[]>={lake:['perch','bream','catfish','crucian'],river:['carp','bream','catfish','crucian'],coast:['snapper','cod','bream','perch']};
export const fishBreeding:Record<FishSpecies,Season[]>={perch:['spring'],carp:['spring','summer'],catfish:['summer'],bream:['spring','summer'],snapper:['summer','autumn'],cod:['winter'],crucian:['spring','winter']};
export interface FishSpeciesStock {amount:number;progress:number;opening:number;born:number;caught:number;eaten:number;arrived:number;departed:number;}

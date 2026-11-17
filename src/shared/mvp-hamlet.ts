import type {Vec,World} from './types.js';

export const MVP_HALL='mvp-home';
export const MVP_HOMES={lin:'mvp-herb-house',qiao:'mvp-craft-house',couple:'mvp-plum-house'} as const;
export const MVP_RESIDENTS=['lin','qiao','yan','tang'] as const;
export const COMPACT_MVP_MAP={width:32,height:24} as const;
export const WIDE_MVP_MAP={width:48,height:36} as const;

export interface MvpGardenLayout {
 version:1;
 well?:Vec;
 trees:{at:Vec;kind:'pine'|'plum'|'deciduous'}[];
}

export function isWideMvpMap(map:World['map']):boolean {
 return map.width===WIDE_MVP_MAP.width&&map.height===WIDE_MVP_MAP.height;
}

export function isSupportedMvpMap(map:World['map']):boolean {
 return !!map&&Array.isArray(map.tiles)&&map.tiles.length===map.width*map.height
  &&(isWideMvpMap(map)||map.width===COMPACT_MVP_MAP.width&&map.height===COMPACT_MVP_MAP.height);
}

export function hasMvpHamlet(world:World):boolean {
 return world.mode==='validation'&&world.id.startsWith('godot-mvp-')
  &&world.buildings.some(building=>building.id===MVP_HOMES.couple);
}

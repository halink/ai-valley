export const roofColors=['wood','clay','blue','thatch','green','slate'] as const;
export interface BuildingArt {roof?:typeof roofColors[number];}
export function validBuildingArt(art:unknown):art is BuildingArt{return !!art&&typeof art==='object'&&!Array.isArray(art)&&Object.entries(art).every(([key,value])=>key==='roof'&&roofColors.includes(value as BuildingArt['roof'] & string));}

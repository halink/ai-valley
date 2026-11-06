import type {BuildingKind, ContentDefinition} from '../shared/types.js';

export interface BuildingParcel {
  ownerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each world receives its own mutable copy of the initial rules. */
export function startingDefinitions(parcels: BuildingParcel[]): Record<string, ContentDefinition> {
  const definitions: Record<string, ContentDefinition> = {
    'action/routine@1': {id:'action/routine', version:1, kind:'action', dependencies:[], data:{}},
    'crop/turnip@1': {
      id:'crop/turnip', version:1, kind:'recipe', dependencies:[], cost:{seed:1}, minutes:4*1440,
      data:{growthDays:4, seasons:['spring','autumn'], yield:3},
    },
    'recipe/meal@1': {
      id:'recipe/meal', version:1, kind:'recipe', dependencies:[], cost:{turnip:2, water:1},
      minutes:20, data:{yield:1},
    },
    'life/basic@1': {
      id:'life/basic', version:1, kind:'life', dependencies:[], data:{adultYears:18, gestationDays:84},
    },
  };
  const sizes: Record<BuildingKind,[number,number,number]> = {
    home:[6,5,2], lodge:[8,6,4], workshop:[7,5,0], clinic:[6,5,2],
    school:[7,5,0], barn:[7,5,0], greenhouse:[7,5,0], store:[6,5,0],
  };
  for (const [kind,[width,height,capacity]] of Object.entries(sizes)) {
    const home = kind === 'home';
    definitions[`building/${kind}@1`] = {
      id:`building/${kind}`, version:1, kind:'building', dependencies:['action/routine@1'],
      cost:{wood:home?24:36, stone:home?12:18}, minutes:360, data:{width,height,capacity},
    };
  }
  definitions['action/routine@1'].dependencies = Object.keys(definitions).filter(key => key !== 'action/routine@1');
  definitions['land/start@1'] = {id:'land/start', version:1, kind:'action', dependencies:[], data:{parcels}};
  return definitions;
}

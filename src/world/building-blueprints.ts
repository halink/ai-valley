import {mayUseDesignedBuilding} from './resident-designs.js';
import type {BuildingKind,Resident,World} from '../shared/types.js';
const names:Record<BuildingKind,string>={home:'住宅',lodge:'公共旅舍',workshop:'工坊',clinic:'照护所',school:'校舍',barn:'畜舍',greenhouse:'温室',store:'店铺'};
/** New named building types reuse an implemented functional template, with their own immutable size, cost and art metadata. */
export function buildingBlueprints(w:World,actor?:Resident){return Object.entries(w.activeDefinitions).filter(([id,definition])=>id.startsWith('building/')&&(!actor||mayUseDesignedBuilding(w,actor,definition))).map(([id,definition])=>{const def=w.definitions[definition],kind=(def?.data.template??id.slice(9)) as BuildingKind;return def?.kind==='building'&&Object.hasOwn(names,kind)?{definition,kind,name:String(def.data.name??names[kind]),def}:null;}).filter((p):p is NonNullable<typeof p>=>!!p);}

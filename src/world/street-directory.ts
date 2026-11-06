import type {Building,Resident,Resource,World} from '../shared/types.js';
import {distance} from './navigation.js';

export interface StreetDirectory {
  water: Pick<Resource,'id'|'at'>;
  hall: Pick<Building,'id'|'name'|'door'>;
}
const directories = new WeakMap<World['map'],Map<string,StreetDirectory>>();

/** Directions on the founding streets' door plaques contain addresses, with no live stock or occupancy. */
export function registeredStreet(world:World,home:Building):StreetDirectory|undefined {
  if(world.mode!=='formal'||!/^hearth-\d+$/.test(home.id))return;
  let entries=directories.get(world.map);
  if(!entries){entries=new Map();directories.set(world.map,entries);}
  const stored=entries.get(home.id);if(stored)return stored;
  const well=world.resources.filter(r=>r.kind==='spring').sort((a,b)=>distance(a.at,home.door)-distance(b.at,home.door))[0];
  const institution=world.buildings.filter(b=>b.ownerId==='commons'&&(b.kind==='clinic'||b.kind==='lodge'))
    .sort((a,b)=>distance(a.door,home.door)-distance(b.door,home.door))[0];
  if(!well||!institution||distance(well.at,home.door)>24||distance(institution.door,home.door)>32)return;
  const result={water:{id:well.id,at:{...well.at}},hall:{id:institution.id,name:institution.name,door:{...institution.door}}};
  entries.set(home.id,result);return result;
}

export function visibleStreetDirectory(world:World,resident:Resident):StreetDirectory|undefined {
  if(world.mode!=='formal'||resident.inside)return;
  const home=world.buildings.find(b=>b.id===resident.homeId);
  if(!home||distance(resident.at,home.door)>2)return;
  return registeredStreet(world,home);
}

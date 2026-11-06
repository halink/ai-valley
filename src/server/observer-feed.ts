import { entityFields, type ObserverUpdate } from '../shared/observer.js';
import type { Snapshot } from '../shared/types.js';

// A reconnect first receives a baseline. Later frames only carry changed collections and records.
export function observerFrame(current: Snapshot, previous?: Snapshot): ObserverUpdate {
  const {world, mapRevision, version, serverTime, capabilities} = current;
  const {map, definitions, activeDefinitions, ...dynamic} = world;
  const frame: ObserverUpdate = {worldId:world.id, mapRevision:mapRevision!, version, serverTime, capabilities, world:{...dynamic}};
  if (!previous || previous.mapRevision !== mapRevision) {
    frame.world.definitions = definitions;
    frame.world.activeDefinitions = activeDefinitions;
    return frame;
  }
  frame.baseRevision = previous.world.revision;
  for (const field of entityFields) {
    const oldItems = new Map<string, {id:string}>(previous.world[field].map(item=>[item.id,item]));
    const upsert: {id:string}[]=[];
    const patch: Array<Record<string,unknown>>=[];
    for(const item of world[field]){
      const old=oldItems.get(item.id);
      oldItems.delete(item.id);
      if(!old){upsert.push(item);continue;}
      const changed:Record<string,unknown>={id:item.id};
      for(const [key,value] of Object.entries(item)){
        const before=(old as Record<string,unknown>)[key];
        if(value!==before && (typeof value!=='object' || JSON.stringify(value)!==JSON.stringify(before))) changed[key]=value;
      }
      // Full replacement is needed if an optional field disappeared.
      const missing=Object.keys(old).some(key=>!Object.hasOwn(item,key));
      if(missing)upsert.push(item);
      else if(Object.keys(changed).length>1)patch.push(changed);
    }
    delete frame.world[field];
    if (upsert.length || oldItems.size || patch.length) {
      frame.changes ??= {};
      Object.assign(frame.changes, {[field]:{upsert, remove:[...oldItems.keys()], patch}});
    }
  }
  for (const field of ['events','graves','processed','estates','offers','proposals','clock','population','migration','duties','economy','civic','production','employment','foreignTrade','construction','education','industry','rooms','food','health','longCare','funerary','infrastructure','adoption','debt','household','social','culture','regions','buildingMigrations','ferries','frontierHazards','designs'] as const) {
    if (JSON.stringify(world[field]) === JSON.stringify(previous.world[field])) delete frame.world[field];
  }
  if (JSON.stringify(definitions) !== JSON.stringify(previous.world.definitions)) frame.world.definitions = definitions;
  if (JSON.stringify(activeDefinitions) !== JSON.stringify(previous.world.activeDefinitions)) frame.world.activeDefinitions = activeDefinitions;
  return frame;
}

import {roomLayout} from '../shared/rooms.js';
import type {World} from '../shared/types.js';
/** Derived from the same authoritative layout as indoor pathing; never saved. */
export function roomObservation(world:World){
 return {worldId:world.id,revision:world.revision,rooms:world.buildings.filter(b=>['home','lodge'].includes(b.kind)).map(b=>({buildingId:b.id,...roomLayout(world,b)}))};
}

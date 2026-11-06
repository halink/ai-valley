import type {Resident,Vec,World} from '../shared/types.js';
import {distance} from './navigation.js';import {roomLayout} from '../shared/rooms.js';
export interface PhysicalLocation {at:Vec;inside:string|null;roomAt?:Vec|null;}
/** A room coordinate is not a duplicate outdoor doorway. */
export function nearLocation(w:World,r:Resident,place:PhysicalLocation,range=2){if(r.residency==='outside'||r.inside!==place.inside)return false;if(w.rooms&&place.inside){const room=w.buildings.find(p=>p.id===place.inside);if(!room)return false;const entry=roomLayout(w,room).entry;return distance(r.roomAt??entry,place.roomAt??entry)<=range;}return distance(r.at,place.at)<=range;}
export function coLocated(w:World,a:Resident,b:Resident,range=2){return b.residency!=='outside'&&nearLocation(w,a,b,range);}

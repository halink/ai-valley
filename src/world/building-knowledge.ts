import type {Building,KnownBuilding,Resident,World} from '../shared/types.js';
import {residentBed} from '../shared/rooms.js';
import {canObserve} from './knowledge.js';
import {distance} from './navigation.js';

/** Same-room observation or the nearby outdoor doorway; no seeing through other rooms. */
export function canInspectBuilding(w:World,r:Resident,b:Building):boolean {
 return canObserve(w,r)&&(r.inside===b.id||r.inside===null&&distance(r.at,b.door)<=8);
}

/** Explicit allow-list: never spread an authoritative Building into personal knowledge. */
export function knownBuildings(w:World,r:Resident):KnownBuilding[]{
 return w.buildings.filter(b=>r.knownBuildings.includes(b.id)).map(b=>{
  const place:KnownBuilding={id:b.id,kind:b.kind,name:b.name,door:{...b.door}};
  // Public use and one's own title are known rights, not another household's private register.
  if(b.ownerId==='commons'||b.ownerId===r.id)place.ownerId=b.ownerId;
  if(canInspectBuilding(w,r,b)){
   place.observed={atMinute:w.minute,condition:b.condition};
   if(b.ownerId==='commons'||b.ownerId===r.id||b.id===r.homeId||r.inside===b.id)place.observed.capacity=b.capacity;
   if(b.id===r.homeId){
    place.observed.ownResidence=b.residents.includes(r.id);
    place.observed.ownBed=b.condition>0&&place.observed.ownResidence&&(!w.rooms||residentBed(w,r,b)!==null);
   }
  }
  return place;
 });
}

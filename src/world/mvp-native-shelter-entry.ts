import {mvpShelterRoom} from '../shared/rooms.js';
import type {Activity,Resident,Vec,World} from '../shared/types.js';
import {same} from './navigation.js';
import {SHELTER_WAIT} from './mvp-shelter.js';

export interface NativeShelterEntry {
 readonly actorId:string;readonly planId:string;readonly buildingId:string;
 readonly door:Readonly<Vec>;readonly entry:Readonly<Vec>;readonly minute:number;
}
type Candidate=Readonly<NativeShelterEntry&{activity:Activity}>;
const active=new WeakMap<World,NativeShelterEntry[]>();
/** Staging only, not durable history. No snapshot/event payload is involved. */
export function captureNativeShelterEntries<T>(w:World,advance:()=>T){
 if(active.has(w))throw Error('native_shelter_entry_capture_duplicate');
 const staged:NativeShelterEntry[]=[];
 active.set(w,staged);
 try{return {result:advance(),entries:Object.freeze(staged)};}
 finally{active.delete(w);}
}
/** The ordinary engine reaches this immediately before its actual room move. */
export function prepareNativeShelterEntry(w:World,r:Resident):Candidate|null{
 if(!active.has(w)||w.mode!=='validation'||Object.hasOwn(w,'simulationOnly')||w.clock.paused)return null;
 const a=r.activity;
 if(!a||a.action.type!=='mvpShelter'||a.path.length||a.room||a.mvpShelterEnteredAt!==undefined||
  r.inside!==null||r.roomAt!=null||r.plan?.id!==a.planId)return null;
 const room=mvpShelterRoom(w,r);
 if(!room||!same(r.at,room.building.door)||!same(a.target,room.building.door))return null;
 return {activity:a,actorId:r.id,planId:a.planId,buildingId:room.building.id,
  door:{...room.building.door},entry:{...room.target},minute:w.minute};
}
export function matchesNativeShelterEntry(w:World,r:Resident,p:NativeShelterEntry){
 const a=r.activity,room=mvpShelterRoom(w,r);
 return !!a&&!!room&&w.minute===p.minute&&r.id===p.actorId&&a.action.type==='mvpShelter'&&a.planId===p.planId&&
  r.plan?.id===p.planId&&r.inside===p.buildingId&&!!r.roomAt&&same(r.roomAt,p.entry)&&same(r.at,p.door)&&
  room.building.id===p.buildingId&&same(room.target,p.entry)&&same(room.building.door,p.door)&&same(a.target,p.door)&&
  a.mvpShelterEnteredAt===p.minute&&a.remaining===SHELTER_WAIT&&!a.path.length&&!a.room&&
  w.rooms?.tick===w.minute&&w.rooms.claims.some(c=>c.buildingId===p.buildingId&&c.key===room.key&&
   c.group===room.group&&c.people.includes(r.id));
}
/** Called only after the room move and physical claim succeeded, before dwell. */
export function noteNativeShelterEntry(w:World,r:Resident,p:Candidate|null){
 const s=active.get(w);
 if(!s||!p||r.activity!==p.activity||!matchesNativeShelterEntry(w,r,p))return;
 const {activity:_draft,...fact}=p;
 s.push(Object.freeze({...fact,door:Object.freeze(fact.door),entry:Object.freeze(fact.entry)}));
}

/** Opt-in, transient observations. Never stored on World or used by decisions. */
import type {World,Vec} from '../shared/types.js';
export const MOVEMENT_LIMIT=256;
type RoomPoint=Vec&{roomId:string|null};
type Move<P extends Vec>={seq:number;actorId:string;minute:number;from:P;to:P};
type State<P extends Vec>={epoch:string;worldId:string;mapKey:string;minute:number;revision:number;seq:number;steps:Move<P>[];positions:Map<string,string>};
type PositionKeys=(world:World)=>Map<string,string>;
const pointKey=(at:Vec,inside:string|null)=>`${at.x},${at.y},${inside??''}`;
const mapKey=(w:World)=>`${w.map.width},${w.map.height}:${w.map.tiles.join(',')}:${w.buildings.map(b=>`${b.id}:${b.at.x},${b.at.y},${b.width},${b.height},${b.door.x},${b.door.y}`).join(';')}`;
const positions=(w:World)=>new Map(w.residents.map(r=>[r.id,pointKey(r.at,r.inside)]));
const roomPositions=(w:World)=>new Map(w.residents.map(r=>[r.id,pointKey(r.inside&&r.roomAt?r.roomAt:r.at,r.inside)]));
const supported=(w:World)=>w.map.tiles.length<=4096&&w.residents.length<=64&&w.buildings.length<=64;
const outdoorStreams=new WeakMap<World,State<Vec>>();
const residentStreams=new WeakMap<World,State<RoomPoint>>();
function fresh<P extends Vec>(w:World,keys:PositionKeys):State<P>{
 return {epoch:globalThis.crypto.randomUUID(),worldId:w.id,mapKey:mapKey(w),minute:w.minute,revision:w.revision,seq:0,steps:[],positions:keys(w)};
}
export function enableCompletedMovement(w:World){
 if(!supported(w))return;
 outdoorStreams.set(w,fresh(w,positions));
 if(w.mvpRooms?.version===1)residentStreams.set(w,fresh(w,roomPositions));
}
function state<P extends Vec>(w:World,streams:WeakMap<World,State<P>>,keys:PositionKeys){
 let s=streams.get(w);if(!s)return;
 if(!supported(w)){streams.delete(w);return;}
 if(s.worldId!==w.id||s.mapKey!==mapKey(w)||w.minute<s.minute||w.revision<s.revision||s.seq>=Number.MAX_SAFE_INTEGER-1){s=fresh(w,keys);streams.set(w,s);}
 s.minute=w.minute;s.revision=w.revision;return s;
}
function append<P extends Vec>(w:World,s:State<P>,actorId:string,from:P,to:P){
 s.steps.push({seq:++s.seq,actorId,minute:w.minute,from:{...from},to:{...to}});
 if(s.steps.length>MOVEMENT_LIMIT)s.steps.splice(0,s.steps.length-MOVEMENT_LIMIT);
}
const adjacent=(from:Vec,to:Vec)=>Math.abs(from.x-to.x)+Math.abs(from.y-to.y)===1;
/** These hooks run only after an actual cell or doorway has been reached. */
export function recordCompletedMovement(w:World,actorId:string,from:Vec,to:Vec){
 recordResidentMovement(w,actorId,from,to,null);
 let s=state(w,outdoorStreams,positions);if(!s)return;
 if(s.positions.get(actorId)!==pointKey(from,null)){s=fresh(w,positions);outdoorStreams.set(w,s);}
 s.positions.set(actorId,pointKey(to,null));
 if(adjacent(from,to))append(w,s,actorId,from,to);
}
export function recordResidentMovement(w:World,actorId:string,from:Vec,to:Vec,fromRoom:string|null,toRoom=fromRoom){
 let s=state(w,residentStreams,roomPositions);if(!s)return;
 const validEdge=fromRoom===toRoom?adjacent(from,to):fromRoom===null||toRoom===null;
 if(!validEdge||s.positions.get(actorId)!==pointKey(from,fromRoom)){
  residentStreams.set(w,fresh(w,roomPositions));
  return;
 }
 s.positions.set(actorId,pointKey(to,toRoom));
 append(w,s,actorId,{...from,roomId:fromRoom},{...to,roomId:toRoom});
}
/** Transaction drafts get isolated evidence; a failed commit cannot leak steps. */
export function forkCompletedMovement(current:World,draft:World){
 const outdoor=outdoorStreams.get(current);
 if(outdoor)outdoorStreams.set(draft,{...outdoor,positions:new Map(outdoor.positions),steps:outdoor.steps.slice()});
 const residents=residentStreams.get(current);
 if(residents)residentStreams.set(draft,{...residents,positions:new Map(residents.positions),steps:residents.steps.slice()});
}
function snapshot<P extends Vec>(w:World,streams:WeakMap<World,State<P>>,keys:PositionKeys){
 let s=state(w,streams,keys);if(!s)return undefined;
 // An unobserved relocation starts a new stream at the authoritative positions.
 const current=keys(w);
 if(s.positions.size!==current.size||[...current].some(([id,value])=>s!.positions.get(id)!==value)){
  s=fresh(w,keys);
  streams.set(w,s);
 }
 return {epoch:s.epoch,worldId:w.id,revision:w.revision,
  firstSeq:s.steps[0]?.seq??s.seq+1,lastSeq:s.seq,limit:MOVEMENT_LIMIT,
  steps:s.steps.map(e=>({...e,from:{...e.from},to:{...e.to}}))};
}
export function completedMovementSnapshot(w:World){
 const record=snapshot(w,outdoorStreams,positions);
 return record&&{version:1 as const,...record};
}
export function residentMovementSnapshot(w:World){
 const record=snapshot(w,residentStreams,roomPositions);
 return record&&{version:2 as const,...record};
}

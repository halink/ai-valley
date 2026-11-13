/** Opt-in, transient observations. Never stored on World or used by decisions. */
import type {World,Vec} from '../shared/types.js';
export const MOVEMENT_LIMIT=256;
type Move={seq:number;actorId:string;minute:number;from:Vec;to:Vec};
type State={epoch:string;worldId:string;mapKey:string;minute:number;revision:number;seq:number;steps:Move[];positions:Map<string,string>};
const pointKey=(at:Vec,inside:string|null)=>`${at.x},${at.y},${inside??''}`;
const mapKey=(w:World)=>`${w.map.width},${w.map.height}:${w.map.tiles.join(',')}:${w.buildings.map(b=>`${b.id}:${b.at.x},${b.at.y},${b.width},${b.height},${b.door.x},${b.door.y}`).join(';')}`;
const positions=(w:World)=>new Map(w.residents.map(r=>[r.id,pointKey(r.at,r.inside)]));
const supported=(w:World)=>w.map.tiles.length<=4096&&w.residents.length<=64&&w.buildings.length<=64;
const streams=new WeakMap<World,State>();
function fresh(w:World):State{return {epoch:globalThis.crypto.randomUUID(),worldId:w.id,mapKey:mapKey(w),minute:w.minute,revision:w.revision,seq:0,steps:[],positions:positions(w)};}
export function enableCompletedMovement(w:World){if(supported(w))streams.set(w,fresh(w));}
function state(w:World){
 let s=streams.get(w);if(!s)return;
 if(!supported(w)){streams.delete(w);return;}
 if(s.worldId!==w.id||s.mapKey!==mapKey(w)||w.minute<s.minute||w.revision<s.revision||s.seq>=Number.MAX_SAFE_INTEGER-1){s=fresh(w);streams.set(w,s);}
 s.minute=w.minute;s.revision=w.revision;return s;
}
/** Called only immediately after successful outdoor engine cell settlement.
 * No callbacks, path inspection, prediction, or simulation state mutation. */
export function recordCompletedMovement(w:World,actorId:string,from:Vec,to:Vec){
 let s=state(w);if(!s)return;
 if(s.positions.get(actorId)!==pointKey(from,null)){s=fresh(w);streams.set(w,s);}
 s.positions.set(actorId,pointKey(to,null));
 // Unsupported jumps are not advertised as walkable routes.
 if(Math.abs(from.x-to.x)+Math.abs(from.y-to.y)!==1)return;
 s.steps.push({seq:++s.seq,actorId,minute:w.minute,from:{...from},to:{...to}});
 if(s.steps.length>MOVEMENT_LIMIT)s.steps.splice(0,s.steps.length-MOVEMENT_LIMIT);
}
/** Transaction drafts get isolated evidence; a failed commit cannot leak steps. */
export function forkCompletedMovement(current:World,draft:World){
 const s=streams.get(current);if(s)streams.set(draft,{...s,positions:new Map(s.positions),steps:s.steps.slice()});
}
export function completedMovementSnapshot(w:World){
 let s=state(w);if(!s)return undefined;
 // Unobserved transitions (indoors, transport, teleport, removal) are resets.
 if(s.positions.size!==w.residents.length||w.residents.some(r=>s!.positions.get(r.id)!==pointKey(r.at,r.inside))){s=fresh(w);streams.set(w,s);}
 return {version:1 as const,epoch:s.epoch,worldId:w.id,revision:w.revision,
  firstSeq:s.steps[0]?.seq??s.seq+1,lastSeq:s.seq,limit:MOVEMENT_LIMIT,
  steps:s.steps.map(e=>({...e,from:{...e.from},to:{...e.to}}))};
}

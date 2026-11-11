import type {BodyObservation,BodySign} from '../shared/body-observation.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import type {Resident,Vec,World} from '../shared/types.js';
import {canObserve} from './knowledge.js';
import {distance,same,walkable} from './navigation.js';

const sleeping=(p:Resident)=>p.activity?.action.type==='sleep'&&!p.activity.path.length&&!p.activity.room?.path.length;
const point=(p:Vec|undefined|null,width:number,height:number):p is Vec=>!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<width&&p.y<height;

/** Conservative close contact, not the broad nearby-person list. Missing room
 * coordinates never become a doorway. No shore-to-boat or remote observation. */
export function canObserveBody(w:World,observer:Resident,person:Resident):boolean {
 if(observer.id===person.id||!canObserve(w,observer)||sleeping(observer)||person.status!=='alive'||person.residency==='outside'||observer.inside!==person.inside)return false;
 if(w.ferries?.trips.some(t=>t.aboard.includes(observer.id)||t.aboard.includes(person.id)))return false;
 if(!point(observer.at,w.map.width,w.map.height)||!point(person.at,w.map.width,w.map.height))return false;
 if(person.inside!==null){
  const b=w.buildings.find(b=>b.id===person.inside);
  if(!w.rooms||!b||!same(observer.at,b.door)||!same(person.at,b.door))return false;
  const layout=roomLayout(w,b),a=observer.roomAt,p=person.roomAt;
  if(!point(a,layout.width,layout.height)||!point(p,layout.width,layout.height)||distance(a,p)>2||layout.blocked.some(q=>same(q,a)||same(q,p)))return false;
  const path=roomPath(layout,a,p);return path!==null&&path.length<=2;
 }
 if(observer.roomAt!=null||person.roomAt!=null||distance(observer.at,person.at)>2)return false;
 // Reuse physical obstacles, but never invent a long detour as close contact.
 // Checking from the occupied tile permits observation within an actual flood.
 const a=observer.at,p=person.at;
 if(!walkable(w,a,a)||!walkable(w,p,p))return false;
 if(same(a,p))return true;
 const next=[{x:a.x-1,y:a.y},{x:a.x+1,y:a.y},{x:a.x,y:a.y-1},{x:a.x,y:a.y+1}];
 return next.some(q=>walkable(w,q,a)&&(same(q,p)||distance(q,p)===1&&walkable(w,p,q)));
}

/** Existing body state supplies only coarse simulated outward signs. It does
 * not establish a medical diagnosis, legal capacity assessment or hidden need.
 * No thirst signal exists for residents, so none is inferred from water stock. */
export function observeBody(w:World,observer:Resident,person:Resident):BodyObservation|undefined {
 if(!canObserveBody(w,observer,person))return undefined;
 const signs:BodySign[]=[];
 if(sleeping(person))signs.push('sleeping');
 else {
  if(!person.canDecide)signs.push('choice-support');
  if(!person.canExpress)signs.push('expression-support');
  if(person.hunger>=70)signs.push('hunger');
  if(person.energy<=15)signs.push('exhaustion');
  if(person.health<=35)signs.push('weakness');
 }
 return signs.length?{atMinute:w.minute,signs}:undefined;
}

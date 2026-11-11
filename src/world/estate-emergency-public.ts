import {hasTimelyCommonsFood} from './commons.js';
import type {Action,Activity,Inventory,Item,Resident,World} from '../shared/types.js';
import type {PublicShift} from '../shared/public-duties.js';
import {goods} from '../shared/items.js';
import {actionRoom,occupiesKitchen,roomLayout,roomPath} from '../shared/rooms.js';
import {ageAllowsAction} from './family.js';
import {aboardFerry} from './ferry.js';
import {movementRate} from './health.js';
import {passenger} from './medical-transport.js';
import {findPath} from './navigation.js';
import {physiology} from './physiology.js';
import {dutyTarget} from './public-duties.js';

/** A cupboard is not a right to take its contents. Only an actual, local service
 * that this child can finish may displace their limited estate self-help. */
export function hasTimelyPublicFood(w:World,r:Resident):boolean {
 // The executor initializes rooms even for old saves. Without their physical
 // positions there is no proof that a legacy worker is actually at the post.
 if(w.mode!=='formal'||!w.rooms||aboardFerry(w,r.id)||passenger(w,r.id))return false;
 if(hasTimelyCommonsFood(w,r))return true;
 // Legacy rule lookup may register defaults. Never mutate a preview's world.
 const preview={...w,definitions:{...w.definitions}},rate=movementRate(preview,r);
 if(!(rate>0))return false;
 for(const shift of w.duties?.shifts??[]){
  if(shift.role!=='kitchen')continue;
  const b=w.buildings.find(b=>b.id===shift.buildingId);
  if(!b||!r.knownBuildings.includes(b.id)||r.inside!==null&&r.inside!==b.id)continue;
  const action:Action={type:'publicDuty',operation:'receive',shiftId:shift.id};
  if(!ageAllowsAction(w,r,action))continue;
  // Shares the executor's staffing, consent, materials, funding and seat rules.
  const route=dutyTarget(w,r,action);if(route.error)continue;
  const path=findPath(w,r.at,route.target);if(path===null)continue;
  let minutes=Math.ceil(path.reduce((n,p)=>n+(w.map.tiles[p.y*w.map.width+p.x]==='road'?.75:1),0)/rate)+route.duration;
  const activity:Activity={planId:'estate-public-preview',action,startedAt:w.minute,remaining:route.duration,path,target:route.target,definition:w.activeDefinitions['action/routine']};
  const room=w.rooms?actionRoom(w,r,activity):null;
  if(w.rooms){
   if(!room)continue;
   const layout=roomLayout(w,b);
   if(r.inside===b.id&&path.length){
    const exit=roomPath(layout,r.roomAt??layout.entry,layout.entry);if(exit===null)continue;
    minutes+=Math.ceil(exit.length/rate);
   }
   const inside=roomPath(layout,r.inside===b.id&&!path.length?r.roomAt??layout.entry:layout.entry,room.target);
   if(inside===null||w.rooms.claims.some(c=>c.buildingId===b.id&&c.key===room.key&&c.group!==room.group))continue;
   minutes+=Math.ceil(inside.length/rate);
  }
  if(w.minute+minutes>shift.end)continue;
  if(w.residents.some(p=>p.id!==r.id&&occupiesKitchen(w,p,b.id)))continue;
  // A client en route has not claimed clientId yet. Their already-committed
  // request may take the sole seat or the last ingredients on the next tick.
  if(w.residents.some(p=>p.id!==r.id&&p.status==='alive'&&p.residency!=='outside'
   &&[...(p.activity?[p.activity.action]:[]),...(p.plan?.actions??[])].some(a=>a.type==='publicDuty'&&a.operation==='receive'&&a.shiftId===shift.id)))continue;
  const worker=w.residents.find(p=>p.id===shift.workerId)!;
  if(!staysAtPost(worker,shift,minutes)||!survivesUntilService(preview,r,minutes)||!survivesUntilService(preview,worker,minutes,true))continue;
  const bag=shift.funding?w.civic?.stores[b.id]??{}:worker.inventory,container=shift.funding?'public:'+b.id:'person:'+worker.id;
  if(lastingIngredients(w,container,bag,{turnip:2,water:1},w.minute+minutes))return true;
 }
 return false;
}

/** Existing commitments can disprove availability; never invent future staffing. */
function staysAtPost(r:Resident,shift:PublicShift,minutes:number):boolean {
 const duration=(a:Action)=>a.type==='wait'?a.minutes:a.type==='publicDuty'&&a.shiftId===shift.id?(a.operation==='stay'?15:a.operation==='attend'?1:null):null;
 const activity=r.activity;
 if(activity&&(activity.path.length||activity.room?.path.length||activity.room?.mode==='exit'||duration(activity.action)===null))return false;
 let stays=activity?.remaining??0;
 for(const action of r.plan?.actions??[]){
  if(stays>=minutes)return true;
  const time=duration(action);if(time===null)return false;
  stays+=time;
 }
 // Completing a wait leaves a present worker at the station until they decide.
 return true;
}

/** Project ordinary hunger/exhaustion loss before relief, without pausing needs. */
function survivesUntilService(w:World,r:Resident,minutes:number,worker=false):boolean {
 const rules=physiology(w,r);let health=r.health,hunger=r.hunger,energy=r.energy;
 for(let minute=1;minute<minutes;minute++){
  hunger=Math.min(100,hunger+rules.hungerPerMinute);energy=Math.max(0,energy-rules.energyPerMinute);
  health-=(hunger>rules.hungerDanger?rules.hungerHealthDrain:0)+(energy<rules.energyDanger?rules.energyHealthDrain:0);
  if(health<=0||worker&&(health<45||energy<10))return false;
 }
 return health>0;
}

/** Bound the freshness ledger by physical stock; unknown ages cannot prove food. */
function lastingIngredients(w:World,id:string,bag:Inventory,cost:Inventory,at:number):boolean {
 for(const [key,needed]of Object.entries(cost)){
  const item=key as Item;let left=bag[item]??0,usable=0;
  if(left<needed!)return false;
  if(goods[item].life<=0)continue;
  const lots=[...(w.food?.lots[id]?.[item]??[])].sort((a,b)=>a.expiresAt-b.expiresAt||a.producedAt-b.producedAt);
  for(const lot of lots){
   const quantity=Math.min(left,Math.max(0,lot.quantity));left-=quantity;
   if(Number.isFinite(lot.expiresAt)&&lot.expiresAt>at)usable+=quantity;
  }
  if(usable<needed!)return false;
 }
 return true;
}

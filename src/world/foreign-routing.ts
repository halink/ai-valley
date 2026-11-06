import type {Resident,Vec,World} from '../shared/types.js';
import type {ForeignOffer,ForeignShipment} from '../shared/foreign-trade.js';
import {distance,findPath,same,walkable} from './navigation.js';

export function deliveryPoint(w:World,r:Resident,id?:string):{at:Vec;name:string}|null {
 if(!id)return {at:{...w.foreignTrade!.station},name:'谷口驿站'};
 const b=w.buildings.find(b=>b.id===id);
 if(b&&r.knownBuildings.includes(id)&&b.ownerId===r.id&&b.condition>0&&['home','store','workshop','barn','greenhouse'].includes(b.kind))return {at:{...b.door},name:b.name+'门外交接处'};
 const a=w.infrastructure?.assets.find(a=>a.id===id&&a.kind==='dock'&&a.retiredAt===null&&a.condition>0);
 // A nearby pier is visible, but no distant building or newly built port is globally revealed.
 return a&&!r.inside&&distance(r.at,a.access)<=12?{at:{...a.access},name:a.name+'陆路转运处'}:null;
}
export const cargoStation=(w:World,s:Pick<ForeignOffer,'stationAt'>|undefined):Vec=>s?.stationAt??w.foreignTrade!.station;
export const atCargoStation=(w:World,r:Resident,s:Pick<ForeignOffer,'stationAt'>|undefined,range=8)=>!r.inside&&distance(r.at,cargoStation(w,s))<=range;
function regionalMinutes(w:World,s:ForeignShipment){return w.foreignTrade!.merchants.find(m=>m.id===s.merchantId)!.routeMinutes;}
function estimateLocal(w:World,at:Vec,to:Vec){const path=findPath(w,at,to);return path?.reduce((sum,p)=>sum+(w.map.tiles[p.y*w.map.width+p.x]==='road'?1.5:2),0)??Infinity;}

export function dispatchCargo(w:World,s:ForeignShipment){
 const at={...cargoStation(w,s)},gate=w.foreignTrade!.station;
 s.route={at,phase:'localOut',updatedAt:w.minute,dueAt:w.minute,progress:0};
 s.arrivesAt=w.minute+estimateLocal(w,at,gate)+regionalMinutes(w,s);
 if(!Number.isFinite(s.arrivesAt))s.arrivesAt=null;
}
export function beginCargoReturn(w:World,s:ForeignShipment){
 const old=s.route;s.status='returning';s.returned=true;s.nextCheckAt=w.minute;
 if(old?.at){
  s.route={at:{...old.at},phase:s.side==='import'?'localOut':'localIn',updatedAt:w.minute,dueAt:w.minute,progress:0};
  const target=s.side==='import'?w.foreignTrade!.station:cargoStation(w,s);
  const minutes=estimateLocal(w,old.at,target)+(s.side==='import'?regionalMinutes(w,s):0);
  s.arrivesAt=Number.isFinite(minutes)?w.minute+minutes:null;
 }else {
  s.route={at:null,phase:s.side==='import'?'regionalOut':'regionalIn',updatedAt:w.minute,dueAt:w.minute+regionalMinutes(w,s),progress:0};
  s.arrivesAt=s.route.dueAt;
 }
}

/** The already hired regional carrier routes the same consignment. Routing never chooses a new trade. */
export function advanceCargo(w:World,s:ForeignShipment):boolean {
 const gate=w.foreignTrade!.station,station=cargoStation(w,s);
 // Existing accepted contracts retain their old gate and regional deadline on upgrade.
 s.route??={at:null,phase:s.side==='import'&&s.status==='inTransit'||s.side==='export'&&s.status==='returning'?'regionalIn':'regionalOut',updatedAt:w.minute,dueAt:s.arrivesAt??w.minute,progress:0};
 const route=s.route;let cursor=route.updatedAt,budget=Math.max(0,w.minute-cursor);route.updatedAt=w.minute;
 if(route.phase==='done')return true;
 if(route.phase==='regionalIn'||route.phase==='regionalOut'){
  if(w.minute<route.dueAt)return false;
  if(route.phase==='regionalOut'){route.phase='done';route.at=null;s.blockedSince=null;return true;}
  if(!walkable(w,gate)){s.blockedSince??=w.minute;s.nextCheckAt=w.minute+1;return false;}
  cursor=Math.max(cursor,route.dueAt);budget=Math.max(0,w.minute-cursor);route.at={...gate};route.phase='localIn';
 }
 const target=route.phase==='localOut'?gate:station;
 if(!route.at)return false;
 const blocked=()=>{s.blockedSince??=w.minute;s.nextCheckAt=w.minute+1;route.progress=0;return false;};
 if(same(route.at,target)){
  if(!walkable(w,target,route.at))return blocked();
 }else {
  const path=findPath(w,route.at,target);if(path===null)return blocked();
  for(const step of path){
   if(!walkable(w,step,route.at))return blocked();
   const cost=w.map.tiles[step.y*w.map.width+step.x]==='road'?1.5:2;
   const need=cost-route.progress;
   if(budget<need){route.progress+=budget;s.blockedSince=null;return false;}
   budget-=need;cursor+=need;route.progress=0;route.at={...step};
  }
 }
 s.blockedSince=null;s.nextCheckAt=w.minute;
 if(route.phase==='localOut'){
  route.phase='regionalOut';route.at=null;route.dueAt=cursor+regionalMinutes(w,s);s.arrivesAt=route.dueAt;
  if(w.minute<route.dueAt)return false;
 }
 route.phase='done';return true;
}

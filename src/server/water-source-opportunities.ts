import type {FormalOpportunity,Resident,World} from '../shared/types.js';
import {distance} from '../world/navigation.js';
import {canInspectSpring} from '../world/spring-observation.js';
import {visibleStreetDirectory} from '../world/street-directory.js';
import {visibleGateDirectory} from '../world/visitor-guidance.js';

export const MAX_WATER_SOURCE_CHOICES=2;
export function isWaterSourceChoice(c:Pick<FormalOpportunity,'id'>){
 return c.id==='move.known-spring'||c.id==='visit.water'||c.id.startsWith('waterSource.');
}
/** Addresses are not live stock or route knowledge. Keep a nearby option and
 * fairly rotate the remaining known sources once, before the final agenda.
 * No path search or hidden amount/damage query selects a remote destination. */
export function waterSourceOpportunities(w:World,r:Resident):FormalOpportunity[]{
 if(w.mode!=='formal'||r.status!=='alive'||r.residency==='outside'||!r.canDecide||!r.canExpress)return [];
 const street=visibleStreetDirectory(w,r),gate=visibleGateDirectory(w,r),known=new Set(r.knownResources);
 const sources=w.resources.filter(s=>s.kind==='spring'&&(known.has(s.id)||street?.water.id===s.id||gate?.water?.id===s.id))
  .sort((a,b)=>distance(r.at,a.at)-distance(r.at,b.at)||a.id.localeCompare(b.id));
 const candidates:FormalOpportunity[]=[];
 for(const s of sources){
  if(canInspectSpring(w,r,s)){
   // Only a current, personal view authorizes stock-dependent menu content.
   const quantity=Math.min(3,Math.floor(s.amount));
   if(quantity<1||s.floodDamage?.clearedAt===null)continue;
   candidates.push({id:'waterSource.gather.'+s.id,label:`去(${s.at.x},${s.at.y})采集${quantity}份眼前清水；水量与通路到场重验`,action:{type:'gather',resourceId:s.id,quantity}});
  }else{
   // Prefer the posted address when signage is the actor's only evidence.
   const at=known.has(s.id)?s.at:street?.water.id===s.id?street.water.at:gate!.water!.at;
   candidates.push({id:'waterSource.inspect.'+s.id,label:`走到已知的取水点（${at.x},${at.y}）看看，至少${distance(r.at,at)}格；水量与路况到场核实，到场后另行决定是否采水`,action:{type:'move',to:{...at}}});
  }
 }
 const selected=candidates.slice(0,1),others=candidates.slice(1);
 if(others.length)selected.push(others[Math.floor(w.minute/30)%others.length]);
 // Preserve the established primary direction identifiers for callers.
 return selected.map((c,i)=>i===0&&c.action.type==='move'?{...c,id:r.residency==='visitor'?'visit.water':'move.known-spring'}:c);
}

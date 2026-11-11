import {disasterContains,type FrontierDisaster} from '../shared/frontier-hazards.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import {distance,findPath,same,walkable} from './navigation.js';
import {frontierRetreatStepAllowed,seenFrontierDangers} from './frontier-hazards.js';
import type {Resident,Vec,World} from '../shared/types.js';
import {buildingSheltersFrom,canSeeDisaster} from './building-safety.js';
import {canObserve} from './knowledge.js';
import {coLocated} from './proximity.js';
import {knownAgeYears} from './time.js';
import {healthDefinition} from './process-definitions.js';
import {healthDefaults} from '../shared/process-definitions.js';

/** This is only a guardian's local disaster evacuation, not a new medical
 * exception for strangers, older children or noncritical incapacitated adults. */
export function guardianEvacuationReason(w:World,r:Resident,p:Resident,dangerId:string,requireThreat=true):string|null {
 const age=knownAgeYears(p.bornAt,w.minute);
 if(age===null)return '幼儿年龄无法核实，不能继续监护灾害护送或改用其他权限';
 if(r.id===p.id||r.status!=='alive'||p.status!=='alive'||r.residency==='outside'||p.residency==='outside'||!r.canDecide||!r.canExpress||(knownAgeYears(r.bornAt,w.minute)??-1)<18||age>=6||!p.guardianIds.includes(r.id)||p.refusesCare)return '幼儿本人意愿或当前监护护送权限已经改变';
 if(!requireThreat)return null;
 if(p.inside){
  const b=w.buildings.find(b=>b.id===p.inside);
  if(!w.rooms||!b||r.inside!==b.id||!r.roomAt||!p.roomAt||!same(r.at,b.door)||!same(p.at,b.door))return '须在幼儿所在房间的真实合法位置接触，不能从门外或缺失位置接出';
  const permitted=(person:Resident)=>b.ownerId==='commons'||b.ownerId===person.id||b.residents.includes(person.id)||!!commonsStay(w,person,b.id)||!!residentialStay(w,person.id,b.id);
  const layout=roomLayout(w,b);
  if(!permitted(r)||!permitted(p)||layout.blocked.some(at=>same(at,r.roomAt!)||same(at,p.roomAt!))||roomPath(layout,r.roomAt,p.roomAt)===null||roomPath(layout,p.roomAt,layout.entry)===null)return '原房间的接触权限、真实接近路线或出口已经失效';
 }
 const d=w.frontierHazards?.disasters.find(d=>d.id===dangerId),b=p.inside?w.buildings.find(b=>b.id===p.inside):undefined;
 if(!d||!canObserve(w,r)||!coLocated(w,r,p,12)||!canSeeDisaster(w,r,d)||!disasterContains(d,p.at)||b&&buildingSheltersFrom(b,d))return '原先亲见的幼儿灾害威胁已经消退、位置变化或不再能现场确认';
 return null;
}

/** A temporary ground carry is not treatment or a medical transport assessment.
 * A mild or moderate case does not erase this option, but severe/critical or
 * uncertain physical states need a separately authorized medical decision.
 * Reuse at selection, pickup and every carrying tick; old case-bound rules
 * remain authoritative when stricter than these conservative limits. */
export function guardianGroundPatientReason(w:World,p:Resident):string|null {
 if(!Number.isFinite(p.health)||p.health<45)return '幼儿当前身体状况不足以确认短程干地搬运适用，须另行核验救护安排';
 for(const c of w.health?.cases??[]){
  if(c.personId!==p.id||c.stage==='resolved')continue;
  const rules=c.rules??healthDefinition(w,c.definition??'health/rules@1').rules;
  const limit=Math.min(healthDefaults.severeSeverity,rules.severeSeverity,rules.criticalSeverity);
  if(!Number.isFinite(c.severity)||c.severity<0||!Number.isFinite(limit)||!Number.isFinite(rules.criticalHealth)||c.stage==='critical'||c.severity>=limit||p.health<=rules.criticalHealth)return '幼儿伤病已属重症、危重或身体信息不足，不能默认无床短程搬运安全；救护须另行决定';
 }
 return null;
}

export function guardianEvacuationDanger(w:World,r:Resident,p:Resident):FrontierDisaster|undefined {
 return w.frontierHazards?.disasters.find(d=>!guardianEvacuationReason(w,r,p,d.id));
}

/** A remembered address does not expose remote live flood geometry through
 * route success/failure. Plan against only the currently observable hazard
 * patch; the engine still checks authoritative hazards on every actual edge. */
export function guardianKnownAddressPath(w:World,r:Resident,target:Vec):Vec[]|null {
 const visible=(at:Vec)=>same(at,r.at)||!r.inside&&distance(at,r.at)<=8;
 const disasters=(w.frontierHazards?.disasters??[]).flatMap(d=>{
  if(!canSeeDisaster(w,r,d))return [];
  if(d.footprint){const footprint=d.footprint.filter(visible);return footprint.length?[{...d,footprint}]:[];}
  // Old radius records lack a precise observed footprint. Only retain a
  // currently occupied danger; other hazards are checked on actual approach.
  return disasterContains(d,r.at)?[d]:[];
 });
 const local:World={...w,...(w.frontierHazards?{frontierHazards:{...w.frontierHazards,disasters}}:{})};
 return findPath(local,r.at,target,false,Infinity,frontierRetreatStepAllowed(local,r));
}


/** A landing point is a temporary outdoor stop, never a bed, tenancy or care
 * mandate. Only the local eight-tile sight patch may be inspected. */
export const guardianGroundLimit=8;
export function guardianGroundReason(w:World,r:Resident,to:Vec):string|null {
 if(r.inside||!canObserve(w,r)||!to||!Number.isInteger(to.x)||!Number.isInteger(to.y)||distance(r.at,to)>guardianGroundLimit)return '须在门外亲自看见附近干地，不能远程保证落脚点';
 if(!walkable(w,to)||w.infrastructure?.assets.some(a=>a.retiredAt===null&&['bridge','dock'].includes(a.kind)&&a.tiles.some(t=>same(t.at,to)))||w.frontierHazards?.disasters.some(d=>d.phase!=='ended'&&disasterContains(d,to))||seenFrontierDangers(w,r).some(d=>!w.frontierHazards?.disasters.some(f=>f.id===d.id)&&distance(to,d.at)<=d.radius))return '原临时落脚点当前不是可站立且避开可见危险的干地';
 return null;
}

/** One bounded BFS, at most 145 tiles. No exterior search from inside rooms.
 * Every proposed edge is observable and respects flood exit/re-entry and gates. */
export function guardianGroundRoute(w:World,r:Resident,start:Vec=r.at,target?:Vec):{to:Vec;path:Vec[]}|null {
 if(r.inside||!canObserve(w,r)||distance(r.at,start)>guardianGroundLimit)return null;
 const canStep=frontierRetreatStepAllowed(w,r),queue=[{at:{...start},path:[] as Vec[]}],seen=new Set([`${start.x},${start.y}`]);
 const directions=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
 for(let head=0;head<queue.length;head++){
  const {at,path}=queue[head];
  if((!target||same(at,target))&&!guardianGroundReason(w,r,at))return {to:at,path};
  if(path.length===guardianGroundLimit)continue;
  for(const d of directions){const next={x:at.x+d.x,y:at.y+d.y},key=`${next.x},${next.y}`;
   if(seen.has(key)||distance(r.at,next)>guardianGroundLimit||!canStep(at,next))continue;
   seen.add(key);queue.push({at:next,path:[...path,next]});
  }
 }
 return null;
}

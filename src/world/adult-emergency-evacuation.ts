import {disasterContains,type FrontierDisaster} from '../shared/frontier-hazards.js';
import {commonsStay} from '../shared/commons.js';
import {residentialStay} from '../shared/premises.js';
import {roomLayout,roomPath} from '../shared/rooms.js';
import type {Resident,World} from '../shared/types.js';
import {buildingSheltersFrom,canSeeDisaster} from './building-safety.js';
import {canObserve} from './knowledge.js';
import {coLocated} from './proximity.js';
import {same} from './navigation.js';
import {ageYears} from './time.js';

/** This authority is only physical departure from a present disaster. It never
 * participates in rescueAuthority(), medication, beds or substitute consent.
 * Loss of expression alone is not loss of the adult's right to decide. */
export function adultEvacuationReason(w:World,r:Resident,p:Resident,dangerId:string,requireThreat=true):string|null {
 if(r.id===p.id||r.status!=='alive'||p.status!=='alive'||r.residency==='outside'||p.residency==='outside'||!r.canDecide||!r.canExpress||ageYears(r.bornAt,w.minute)<18||r.energy<10||r.health<=30||ageYears(p.bornAt,w.minute)<18||p.canDecide!==false)return '成人本人决定能力或施救者的现场撤险能力已经改变，不能继续例外移动';
 if(p.refusesCare||w.health?.evacuationRefusals?.some(x=>x.patientId===p.id&&x.dangerId===dangerId))return '本人已经拒绝这次危险下的撤离，不能因失能或换人再次接出';
 if(p.health<=20||w.health?.cases.some(c=>c.personId===p.id&&c.stage!=='resolved'&&(c.stage==='critical'||c.severity>=Math.min(85,c.rules?.criticalSeverity??85)||p.health<=(c.rules?.criticalHealth??20))))return '危重伤病须重新核验原有救护权限，不能扩展本次非危重短程撤险';
 if(!requireThreat)return null;
 if(p.plan||p.activity)return '本人尚有实际行动，须先确认已不能自行撤离';
 if(p.inside){
  const b=w.buildings.find(b=>b.id===p.inside);
  if(!w.rooms||!b||r.inside!==b.id||!r.roomAt||!p.roomAt||!same(r.at,b.door)||!same(p.at,b.door))return '须在成人所在房间的真实合法位置接触，不能隔墙或从缺失位置接出';
  const permitted=(person:Resident)=>b.ownerId==='commons'||b.ownerId===person.id||b.residents.includes(person.id)||!!commonsStay(w,person,b.id)||!!residentialStay(w,person.id,b.id);
  const layout=roomLayout(w,b);
  if(!permitted(r)||!permitted(p)||layout.blocked.some(at=>same(at,r.roomAt!)||same(at,p.roomAt!))||roomPath(layout,r.roomAt,p.roomAt)===null||roomPath(layout,p.roomAt,layout.entry)===null)return '当前房间的接触权限、实际路线或出口已经失效';
 }
 const d=w.frontierHazards?.disasters.find(d=>d.id===dangerId),b=p.inside?w.buildings.find(b=>b.id===p.inside):undefined;
 if(!d||d.phase!=='active'||d.startsAt>w.minute||d.endsAt<=w.minute||!(d.intensity>0)||!canObserve(w,r)||!coLocated(w,r,p,2)||!canSeeDisaster(w,r,d)||!disasterContains(d,p.at)||b&&buildingSheltersFrom(b,d))return '没有当场亲见且实际迫近的成人灾害威胁，预警和远方危险不足以授权';
 return null;
}
export function adultEvacuationDanger(w:World,r:Resident,p:Resident):FrontierDisaster|undefined {
 return w.frontierHazards?.disasters.find(d=>!adultEvacuationReason(w,r,p,d.id));
}

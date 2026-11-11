import {disasterContains,type FrontierDisaster} from '../shared/frontier-hazards.js';
import type {Building,Resident,World} from '../shared/types.js';
import {canObserve} from './knowledge.js';
import {canInspectBuilding} from './building-knowledge.js';
import {distance} from './navigation.js';

/** The same physical protection is used for exposure, shelter and medical entry.
 * Legacy floods retain their core radius; recorded footprints are authoritative. */
export function buildingSheltersFrom(b:Building,d:FrontierDisaster):boolean {
 return b.condition>=35&&(d.kind==='windstorm'||(d.footprint?!disasterContains(d,b.door):distance(b.door,d.at)>Math.floor(d.radius/2)));
}
export function canSeeDisaster(w:World,r:Resident,d:FrontierDisaster):boolean {
 return d.phase!=='ended'&&canObserve(w,r)&&distance(r.at,d.at)<=d.radius+9;
}
export function safeFrontierShelter(w:World,b:Building):boolean {
 return b.condition>=35&&!(w.frontierHazards?.disasters.some(d=>d.phase!=='ended'&&d.kind==='flashFlood'&&!buildingSheltersFrom(b,d)));
}
/** Planning requires an inspected doorway, not a remote live
 * building condition. Actual entry/work always checks the authoritative facts. */
export function medicalDestinationReason(w:World,r:Resident,b:Building|undefined,options:{provider?:Resident;physical?:boolean;menu?:boolean}={}):string|null {
 const provider=options.provider??r;
 if(!b||!['clinic','lodge'].includes(b.kind)||!provider.knownBuildings.includes(b.id)||b.ownerId!=='commons'&&b.ownerId!==provider.id)return '没有已知且有使用权的诊疗接收场所';
 const inspected=canInspectBuilding(w,r,b),physical=options.physical||r.inside===b.id;
 if((!options.menu||inspected||physical)&&b.condition<=0)return '原诊疗接收场所已经不能使用';
 const unsafe=(physical||inspected)&&w.frontierHazards?.disasters.some(d=>d.phase!=='ended'&&disasterContains(d,b.door)&&!buildingSheltersFrom(b,d));
 return unsafe?'诊疗接收场所正受未解除的灾害威胁，须在实际位置停止并重新决定':null;
}

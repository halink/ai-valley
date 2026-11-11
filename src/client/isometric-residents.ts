/** Read-only resident art and location evidence. No world advancement or inferred destinations. */
import type {Resident,Vec,World} from '../shared/types.js';
import {Pixels} from './isometric-pixels.js';
import {materials as m,residentColors} from './palette.js';
import {personVisual,personAnimationFrame,isWorkPose,type PersonVisual,type WorkPose} from './person-pose.js';
import {projectIsometric,projectedFacing,type Footprint} from './isometric-projection.js';
import {workPicture,type PixelMark} from './work-art.js';
import {graveState} from './isometric-living.js';
import {knownAgeYears} from '../world/time.js';
import {healthDefaults} from '../shared/process-definitions.js';
import {sleepBuilding} from '../shared/rooms.js';

export const RESIDENT_MARK_LIMIT=1024;
export type IsometricResidentPose=PersonVisual['pose']|'walk'|'infant'|'body';
const workPose=(pose:IsometricResidentPose):pose is WorkPose=>pose!=='walk'&&pose!=='infant'&&pose!=='body'&&isWorkPose(pose);
export interface IsometricResidentSpace {roomId?:string;/** Required for a room; use its already validated layout. */bounds?:Footprint;}
export type IsometricResidentHiddenReason='buried'|'outside'|'other-space';
export type IsometricResidentRecord=
 | {kind:'hidden';id:string;hiddenReason:IsometricResidentHiddenReason;reason:string}
 | {kind:'fallback';id:string;at:Vec|null;reason:string}
 | {kind:'render';id:string;at:Vec;anchor:Vec;footprint:Footprint;pose:IsometricResidentPose;description:string;animated:boolean;marks:(elapsed:number)=>PixelMark[]};
const point=(p:Vec|null|undefined):p is Vec=>!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y);
const equal=(a:Vec,b:Vec)=>a.x===b.x&&a.y===b.y;
const centered=(at:Vec)=>projectIsometric({x:at.x+.5,y:at.y+.5});
const inside=(at:Vec|null|undefined,b:Footprint):at is Vec=>point(at)&&at.x>=b.x&&at.y>=b.y&&at.x<b.x+b.width&&at.y<b.y+b.height;
const validBounds=(b:Footprint)=>[b.x,b.y,b.width,b.height].every(Number.isInteger)&&b.width>0&&b.height>0;
const phase=(time:number)=>Math.floor(Math.max(0,Number.isFinite(time)?time:0)/260)%4;
interface Motion {at:Vec;anchor:Vec;direction:Vec|null;moving:boolean;reason?:string;}
/** Only a valid, adjacent, recorded first step and its recorded fraction may displace the anchor. */
function motion(at:Vec,path:Vec[],progress:number|undefined,bounds:Footprint):Motion {
 const base={at:{...at},anchor:{...at},direction:null,moving:false};
 if(!Array.isArray(path))return {...base,reason:'行路记录缺少完整路径；不推算当前位置'};
 if(!path.length)return base;
 const next=path[0];
 if(!inside(next,bounds)||Math.abs(next.x-at.x)+Math.abs(next.y-at.y)!==1)return {...base,reason:'行路下一格无效或不相邻；不推算路径'};
 if(progress!==undefined&&(!Number.isFinite(progress)||progress<0||progress>1))return {...base,reason:'行路进度无效；不推算当前位置'};
 const fraction=progress??0,direction={x:next.x-at.x,y:next.y-at.y};
 return {at:{...at},anchor:{x:at.x+direction.x*fraction,y:at.y+direction.y*fraction},direction,moving:true};
}
function lying(r:Resident,anchor:Vec,carried:boolean,dead:boolean):PixelMark[] {
 const c=new Pixels(),p=centered(anchor),{shirt,skin,hair:base}=residentColors(r.appearance),hair=r.lifeStage==='elder'?m.rockLight:base;
 const small=r.lifeStage==='infant'?8:r.lifeStage==='child'?5:r.lifeStage==='teen'?2:0,y=p.y-(carried?14:0);
 // Clothes and the original appearance only: no invented bed, stretcher, blanket or grave goods.
 c.rect(m.rockInk,p.x+7-small/2,y-3,4,3);c.rect(m.rockShade,p.x+1,y-5,9-small/2,5);
 c.rect(shirt,p.x-6+small/2,y-7,9-small/2,7);c.rect(skin,p.x-5+small/2,y-2,9-small/2,2);
 c.rect(hair,p.x-13+small/2,y-9,8,8);c.rect(skin,p.x-11+small/2,y-7,7,6);c.rect(hair,p.x-13+small/2,y-9,3,8);
 c.rect(m.ink,p.x-8+small/2,y-5,dead?3:2);if(dead)c.rect(m.ink,p.x-7+small/2,y-4);
 return c.marks;
}
function infant(r:Resident,anchor:Vec):PixelMark[] {
 const c=new Pixels(),p=centered(anchor),{shirt,skin,hair}=residentColors(r.appearance);
 c.rect(m.rockInk,p.x-5,p.y-2,4,2);c.rect(m.rockInk,p.x+2,p.y-2,4,2);
 c.rect(shirt,p.x-4,p.y-7,9,6);c.rect(skin,p.x-6,p.y-6,2,4);c.rect(skin,p.x+5,p.y-6,2,4);
 c.rect(hair,p.x-4,p.y-15,8,7);c.rect(skin,p.x-3,p.y-12,7,6);c.rect(hair,p.x-4,p.y-15,8,3);
 c.rect(m.ink,p.x-1,p.y-10);c.rect(m.ink,p.x+2,p.y-10);return c.marks;
}
function standing(r:Resident,anchor:Vec,pose:IsometricResidentPose,visual:PersonVisual,elapsed:number,spear:boolean):PixelMark[] {
 const c=new Pixels(),p=centered(anchor),{shirt,skin,hair:base}=residentColors(r.appearance),hair=r.lifeStage==='elder'?m.rockLight:base;
 const small=r.lifeStage==='child'?5:r.lifeStage==='teen'?2:0,frame=phase(elapsed),step=pose==='walk'?[0,2,0,-2][frame]:0;
 const face=visual.facing,side=face==='east'||face==='west',dir=face==='west'?-1:1,back=face==='north';
 const rest=pose==='shoreRest',bend=pose==='ill'?3:rest?6:pose==='work'?[1,3,2,0][frame]:pose==='hunt'?2:0;
 const x=p.x+(pose==='hunt'?dir:0),head=p.y-25+small+bend;
 c.rect(m.rockInk,p.x-5-step,p.y-3,4,3);c.rect(m.rockInk,p.x+2+step,p.y-3-(step?1:0),4,3);
 c.rect(m.rockShade,p.x-4,p.y-8,8,5);c.rect(m.rockInk,p.x,p.y-6,1,3);
 c.rect(shirt,x-5,p.y-15+small+bend,10,Math.max(3,9-small-bend));
 if(rest)c.rect(m.rockShade,p.x+3,p.y-5,8,4);
 const arms=pose==='celebrate'?[[-6,-20+frame%2*2],[6,-22+frame%2*2]]:pose==='work'?[[-5,-10-bend],[5,-12-bend]]:pose==='hunt'?[[-1,-12],[9*dir,-13]]:pose==='ill'?[[-3,-9],[3,-9]]:[[-6,-13+small+step],[6,-13+small-step]];
 for(const [dx,dy] of arms)c.line(skin,{x:x+(dx<0?-5:5),y:p.y-12+small+bend},{x:x+dx,y:p.y+dy},2);
 c.rect(hair,x-5,head,10,10);c.rect(skin,x-4,head+4,8,8);c.rect(hair,x-5,head,10,4);
 if(back){c.rect(hair,x-5,head+3,10,7);c.rect(skin,x-2,head+10,4,2);}
 else if(side){c.rect(hair,x+(dir>0?-5:2),head+3,3,6);c.rect(skin,x+dir*5-(dir<0?1:0),head+6,2,3);c.rect(m.ink,x+dir*3,head+6,1,2);}
 else {c.rect(hair,x-5,head+3,2,5);c.rect(m.ink,x-2,head+6,1,2);c.rect(m.ink,x+2,head+6,1,2);}
 // Generic work is empty-handed effort, never a fabricated hammer, workstation or output.
 if(pose==='hunt'&&spear){const y=p.y-11-frame%2;c.line(m.woodShade,{x:x-dir*6,y},{x:x+dir*17,y:y-3},2);c.line(m.woodLight,{x:x-dir*5,y},{x:x+dir*15,y:y-3});c.rect(m.rockLight,x+dir*17-(dir<0?3:0),y-4,4,2);}
 return c.marks;
}
const labels:Partial<Record<IsometricResidentPose,string>>={idle:'居民当前原位置，不推断正在工作',walk:'沿已记录路线行走',work:'现场工作姿态，不表示已产出',infant:'婴儿原位置',body:'尚未安葬的遗体',carried:'实际携运中',sleep:'已核实睡眠位置的卧姿',ill:'当前重伤病姿态，不推断病因',celebrate:'现场文化活动姿态，不代表庆典已成功举行',hunt:'现场狩猎准备，不表示命中或捕获',shoreRest:'现场河岸休息'};

/** Prepare once per accepted immutable snapshot. Identity, depth and pick location stay with each original ID.
 * Pass the preview's pause-aware elapsed clock. A paused snapshot additionally fixes all phases at zero.
 * A fallback with at=null is an unknown-location count, NEVER a marker at an invented position.
 */
export function prepareIsometricResidents(w:World,space:IsometricResidentSpace={}):IsometricResidentRecord[] {
 const bounds=space.bounds??{x:0,y:0,width:w.map.width,height:w.map.height};
 if(!validBounds(bounds)||space.roomId&&!space.bounds)throw new Error('isometric_residents_space');
 const residents=new Map(w.residents.map(r=>[r.id,r]));
 if(residents.size!==w.residents.length)throw new Error('isometric_residents_duplicate');
 // Old/corrupt relationship ledgers must not silently become an empty list: an unknown
 // passenger could otherwise be painted at a stale coordinate. Keep the rest of the scene usable.
 const malformedRelations=w.health&&(!Array.isArray(w.health.transports)||w.health.transports.some(t=>!t||typeof t.id!=='string'||!t.id||typeof t.carrierId!=='string'||typeof t.patientId!=='string'||!['carrying','delivered','interrupted'].includes(t.phase)))
  ||w.ferries&&(!Array.isArray(w.ferries.trips)||w.ferries.trips.some(t=>!t||typeof t.id!=='string'||!t.id||!Array.isArray(t.aboard)||!t.aboard.every(id=>typeof id==='string')||!['posted','sailing','held','docked','completed','cancelled'].includes(t.phase)))
  ||w.familyRelocation&&(!Array.isArray(w.familyRelocation.agreements)||w.familyRelocation.agreements.some(c=>!c||typeof c.id!=='string'||!c.id||!Array.isArray(c.members)||c.members.some(member=>!member||typeof member.personId!=='string')));
 if(malformedRelations)return w.residents.map(r=>({kind:'fallback',id:r.id,at:null,reason:'居民携运或旅途关系账本不完整；不推断旧位置仍有效'}));
 const buried=new Set(w.graves.filter(g=>graveState(g,w.minute)==='buried').map(g=>g.personId));
 const activeTransports=(w.health?.transports??[]).filter(t=>t.phase==='carrying');
 const escorted=(w.familyRelocation?.agreements??[]).flatMap(c=>c.members.filter(m=>m.escorting).map(member=>({agreement:c,member})));
 const local=(r:Resident)=>r.residency!=='outside'&&!r.regionalLocation;
 const inSpace=(r:Resident)=>space.roomId?r.inside===space.roomId:!r.inside;
 const atOf=(r:Resident)=>space.roomId?r.roomAt:r.at;
 const fallback=(r:Resident,reason:string,at:Vec|null=null):IsometricResidentRecord=>({kind:'fallback',id:r.id,at:at?{...at}:null,reason});
 const hidden=(r:Resident,hiddenReason:IsometricResidentHiddenReason,reason:string):IsometricResidentRecord=>({kind:'hidden',id:r.id,hiddenReason,reason});
 const carrierIds=new Set<string>([...activeTransports.map(t=>t.carrierId),...escorted.map(e=>e.member.caregiverId).filter((id):id is string=>!!id),...w.residents.filter(r=>r.status==='dead'&&r.body?.carriedBy).map(r=>r.body!.carriedBy!)]);
 const carriedIds=new Set<string>([...activeTransports.map(t=>t.patientId),...escorted.map(e=>e.member.personId),...w.residents.filter(r=>r.status==='dead'&&r.body?.carriedBy).map(r=>r.id)]);
 return w.residents.map(r=>{
  if(r.status==='dead'&&buried.has(r.id))return hidden(r,'buried','已实际安葬');
  const transports=activeTransports.filter(t=>t.patientId===r.id),escorts=escorted.filter(e=>e.member.personId===r.id);
  const bodyCarrier=r.status==='dead'?r.body?.carriedBy:null;
  const claims=transports.length+escorts.length+(bodyCarrier?1:0);
  let owner=r,carried=false;
  if(claims){
   if(claims!==1)return fallback(r,'携运记录冲突；精确位置未知');
   const id=bodyCarrier??transports[0]?.carrierId??escorts[0]?.member.caregiverId;
   const carrier=id?residents.get(id):undefined;
   if(!carrier||carrier.id===r.id||carrier.status!=='alive'||!carrier.canDecide||!carrier.canExpress||!(carrier.health>0)||carrier.lifeStage==='infant'||carriedIds.has(carrier.id))return fallback(r,'携带者缺失、失能或循环携运；不沿用旧坐标');
   if(!bodyCarrier&&((knownAgeYears(carrier.bornAt,w.minute)??-1)<18||carrier.health<=30||carrier.energy<10))return fallback(r,'医疗或儿童携运者当前年龄或身体记录不支持实际携运；不沿用旧坐标');
   const payloads=activeTransports.filter(t=>t.carrierId===carrier.id).length+escorted.filter(e=>e.member.caregiverId===carrier.id).length+w.residents.filter(p=>p.status==='dead'&&p.body?.carriedBy===carrier.id).length;
   if(payloads!==1)return fallback(r,'同一携带者有多项冲突携运记录；不推算携运位置');
   if(!local(carrier))return hidden(r,'outside','随携带者在谷外或区域旅途中');
   if(!inSpace(carrier))return hidden(r,'other-space','携带者不在此场景');
   const a=carrier.activity,action=a?.action;
   const validBody=!!bodyCarrier&&a?.cargo?.pickedUp===true&&a.cargo.bodyId===r.id&&((action?.type==='bury'&&action.targetId===r.id)||(action?.type==='funerary'&&action.operation==='store'&&action.targetId===r.id));
   const t=transports[0],validPatient=!!t&&r.status==='alive'&&action?.type==='health'&&action.operation==='rescue'&&action.phase==='delivery'&&action.transportId===t.id&&action.targetId===r.id;
   const e=escorts[0],validChild=!!e&&r.status==='alive'&&action?.type==='familyRelocation'&&(action.operation==='escort'||action.operation==='returnChild')&&action.personId===r.id&&action.relocationId===e.agreement.id&&action.phase==='delivery';
   if(!validBody&&!validPatient&&!validChild)return fallback(r,'携运关系与携带者实际行动不一致；不沿用旧坐标');
   owner=carrier;carried=true;
  }else{
   if(!local(r))return hidden(r,'outside','在谷外或区域旅途中');
   if(r.status==='dead'&&r.body?.storedAt&&r.body.storedAt!==r.inside)return fallback(r,'遗体暂存记录与当前室内位置不一致');
   if(!inSpace(r))return hidden(r,'other-space','不在此场景');
  }
  const at=atOf(owner);
  if(!inside(at,bounds))return fallback(r,'未记录此场景内的有效精确位置');
  if(!r.appearance||![r.appearance.hair,r.appearance.shirt,r.appearance.skin].every(Number.isFinite))return fallback(r,'居民外观记录缺失',at);
  const trip=w.ferries?.trips.find(t=>t.aboard.includes(owner.id)&&['posted','sailing','held','docked'].includes(t.phase));
  if(trip)return fallback(r,'本人仍在渡船上；未绘制船上姿态，不在水面画步行',at);
  const families=(w.familyRelocation?.agreements??[]).filter(c=>c.status==='travelling'&&c.members.some(m=>m.personId===owner.id&&m.arrivedAt===null));
  if(families.length)return fallback(r,'家庭共同旅程采用独立进度；未绘制同行姿态，不采用个人旧路线',at);
  let movement:Motion={at:{...at},anchor:{...at},direction:null,moving:false};
  if(r.status!=='dead'||carried){
   const a=owner.activity;
   if(a){
    if(!Array.isArray(a.path)||a.room&&!Array.isArray(a.room.path))return fallback(r,'行路记录缺少完整路径；不推算当前位置',at);
    if(space.roomId){
     if(a.room?.path.length&&a.room.buildingId!==space.roomId)return fallback(r,'室内行路属于另一房间；不推算当前位置',at);
     if(a.room?.buildingId===space.roomId)movement=motion(at,a.room.path,a.room.progress,bounds);
    }else if(a.room?.path.length)return fallback(r,'室内路线与户外位置冲突；不借用户外旧路线',at);
    else movement=motion(at,a.path,a.travelProgress,bounds);
   }
  }
  if(movement.reason)return fallback(r,movement.reason,at);
  const critical=Array.isArray(w.health?.cases)&&w.health.cases.some(c=>c.personId===owner.id&&c.stage!=='resolved'&&c.severity>=(c.rules?.criticalSeverity??healthDefaults.criticalSeverity));
  if(movement.moving&&(!owner.canDecide||!owner.canExpress||owner.health<=0||critical))return fallback(r,'当前失能或危急记录与残留路径冲突；不画成继续行走',at);
  // Derive state from the original resident before translating any display anchor.
  let visual:PersonVisual;
  try{visual=r.status==='dead'?{pose:'idle',facing:'south',focus:null}:personVisual(w,r);}
  catch{return fallback(r,'居民活动相关记录不完整；不推断现场姿态',at);}
  if(movement.direction)visual.facing=projectedFacing(movement.direction);
  else if(visual.focus)visual.facing=projectedFacing(visual.focus);
  let pose:IsometricResidentPose=r.status==='dead'?'body':carried?'carried':visual.pose==='sleep'?'sleep':r.lifeStage==='infant'?(visual.pose==='ill'?'ill':'infant'):movement.moving?'walk':visual.pose;
  let atSleepDoor=false;
  if(!carried&&r.status==='alive'&&r.activity?.action.type==='sleep'&&visual.pose!=='sleep'&&!movement.moving){
   // The engine reports an exterior-door snapshot after the last outdoor step and
   // before entering the room. A known door is a valid standing location, not sleep.
   const home=sleepBuilding(w,r,r.activity.action);
   atSleepDoor=!!home&&!r.inside&&!r.activity.room&&point(home.door)&&point(r.activity.target)&&equal(r.at,home.door)&&equal(r.activity.target,home.door);
   if(!atSleepDoor)return fallback(r,'睡眠位置待核验；不把睡眠安排画成实际睡眠',at);
  }
  if(r.lifeStage==='infant'&&movement.moving&&!carried)return fallback(r,'婴儿记录存在独立步行路线；未确认携运关系',at);
  if(visual.pose==='carried'&&!carried)return fallback(r,'未能核实实际携运关系',at);
  // Do not animate a carrier as working on an unrelated task while a body/person is attached.
  if(!carried&&carrierIds.has(r.id)&&pose!=='walk'&&pose!=='body')pose=r.lifeStage==='infant'?'infant':'idle';
  const action=r.activity?.action,spear=pose==='hunt'&&action?.type==='industry'&&Array.isArray(w.industry?.tools)&&w.industry.tools.some(t=>t&&t.kind==='spear'&&t.ownerId===r.id&&!t.location&&t.durability>0&&(!action.toolId||t.id===action.toolId));
  if(pose==='hunt'&&!spear)return fallback(r,'狩猎行动缺少可核实的随身猎矛；不绘制虚构武器',at);
  const copy={...r,appearance:{...r.appearance}},anchor={...movement.anchor},paused=w.clock.paused;
  const marks=(elapsed:number)=>{
   const time=paused?0:elapsed;
   if(pose==='body'||pose==='sleep'||pose==='carried')return lying(copy,anchor,carried,pose==='body');
   if(pose==='ill'&&copy.lifeStage==='infant')return lying(copy,anchor,false,false);
   if(pose==='infant')return infant(copy,anchor);
   if(workPose(pose)){
    const p=centered(anchor),offset=visual.focus?projectIsometric(visual.focus):null,focus=offset?{x:offset.x/16,y:(offset.y+4)/16}:null;
    const picture=workPicture(copy,pose,personAnimationFrame(visual,time),visual.facing,focus),c=new Pixels();
    for(const mark of picture.marks)c.rect(mark.color,p.x+mark.x-picture.anchor.x,p.y+mark.y-picture.anchor.y,mark.width,mark.height);
    return c.marks;
   }
   return standing(copy,anchor,pose,visual,time,!!spear);
  };
  const footprint={x:Math.floor(Math.min(at.x,anchor.x)),y:Math.floor(Math.min(at.y,anchor.y)),width:Math.ceil(Math.max(at.x,anchor.x))+1-Math.floor(Math.min(at.x,anchor.x)),height:Math.ceil(Math.max(at.y,anchor.y))+1-Math.floor(Math.min(at.y,anchor.y))};
  const description=(atSleepDoor?'已到真实住宿门口，尚未到床，不表示睡眠':labels[pose]??'已记录的现场行动姿态')+(carried?' · 随实际携带者 '+owner.id:'')+'；不推进模拟';
  return {kind:'render',id:r.id,at:{...at},anchor,footprint,pose,description,animated:!paused&&(pose==='walk'||pose==='work'||pose==='celebrate'||pose==='hunt'||workPose(pose)),marks};
 });
}

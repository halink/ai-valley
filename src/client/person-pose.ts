import type {Resident,Vec,World} from '../shared/types.js';
import {atActionPosition,actionFocus} from './action-position.js';
import {residentActivity} from './resident-status.js';
export type WorkPose='chop'|'pick'|'sow'|'water'|'harvest'|'fish'|'mine'|'fetch';
export type PersonPose='idle'|'sleep'|'work'|'ill'|'carried'|'celebrate'|'shoreRest'|'hunt'|WorkPose;
export type PersonFacing='north'|'east'|'south'|'west';
export interface PersonVisual {pose:PersonPose;facing:PersonFacing;/** Confirmed target offset in tiles, never an invented destination. */focus:Vec|null;}
export const isWorkPose=(pose:PersonPose):pose is WorkPose=>['chop','pick','sow','water','harvest','fish','mine','fetch'].includes(pose);
export function personPose(w:World,r:Resident):PersonPose{
 if(r.status==='dead'||r.residency==='outside')return 'idle';
 if(w.health?.transports.some(t=>t.patientId===r.id&&t.phase==='carrying'))return 'carried';
 const a=r.activity?.action,status=residentActivity(w,r),working=atActionPosition(w,r)&&status.kind==='active';
 if(status.kind==='sleeping')return 'sleep';
 if(working&&a?.type==='industry'&&a.operation==='shoreRest')return 'shoreRest';
 if(working&&a?.type==='culture'&&['open','speak'].includes(a.operation)&&w.culture?.events.some(e=>e.id===a.eventId&&['planned','held'].includes(e.status)))return 'celebrate';
 if(w.health?.cases.some(c=>c.personId===r.id&&c.stage!=='resolved'&&c.severity>=(c.rules?.severeSeverity??50)))return 'ill';
 if(!working||!a)return 'idle';
 if(a.type==='gather'){
  const kind=w.resources.find(s=>s.id===a.resourceId)?.kind;
  return kind==='tree'?'chop':kind==='bush'?'pick':kind==='rock'?'mine':kind==='spring'?'fetch':'idle';
 }
 if(a.type==='plant')return 'sow';
 if(a.type==='water')return 'water';
 if(a.type==='harvest')return 'harvest';
 if(a.type==='production'&&a.operation==='plantCrop')return 'sow';
 if(a.type==='industry'){
  if(a.operation==='cutTree')return 'chop';
  if(a.operation==='harvestFruit')return 'pick';
  if(a.operation==='plantTree'||a.operation==='plantHouse')return 'sow';
  if(a.operation==='tendTree'||a.operation==='tendHouse')return 'water';
  if(a.operation==='harvestHouse')return 'harvest';
  if(a.operation==='fish')return actionFocus(w,r)?'fish':'idle';
  if(a.operation==='mine'||a.operation==='deepen')return 'mine';
  if(a.operation==='hunt')return 'hunt';
 }
 if(a.type==='cook'||a.type==='employment'&&a.operation==='work'||a.type==='construction'&&a.operation==='work'||a.type==='buildingMigration'&&a.operation==='work'||a.type==='ferry'&&['build','repair'].includes(a.operation)||a.type==='industry'&&['craft','feedAnimal','waterAnimal','tameAnimal','install','uninstall','repairTool','upgrade'].includes(a.operation))return 'work';
 return 'idle';
}
export function personVisual(w:World,r:Resident):PersonVisual{
 const pose=personPose(w,r),target=isWorkPose(pose)?actionFocus(w,r):null;
 const origin=r.inside&&w.rooms?r.roomAt:r.at;
 const focus=target&&origin?{x:target.x-origin.x,y:target.y-origin.y}:null;
 const next=r.activity?.room?.path[0]??r.activity?.path[0],from=r.activity?.room?.path.length?r.roomAt:r.at;
 const dx=focus?.x??(next&&from?next.x-from.x:0),dy=focus?.y??(next&&from?next.y-from.y:0);
 const facing:PersonFacing=Math.abs(dx)>Math.abs(dy)?dx<0?'west':'east':dy<0?'north':'south';
 return {pose,facing,focus};
}
/** Frame time is supplied by the scene's pause-aware clock. No catch or yield is implied. */
export function personAnimationFrame(visual:PersonVisual,elapsed:number,moving=false):number{
 const time=Math.max(0,Number.isFinite(elapsed)?elapsed:0);
 if(visual.pose==='fish')return [0,1,2,2,2,2,3,3][Math.floor(time/420)%8];
 if(isWorkPose(visual.pose))return Math.floor(time/240)%4;
 if(moving||['work','celebrate','hunt'].includes(visual.pose))return Math.floor(time/350)%2;
 return 0;
}
export const personOriginY=(pose:PersonPose)=>isWorkPose(pose)?44/64:1;

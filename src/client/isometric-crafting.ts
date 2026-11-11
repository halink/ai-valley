/** Read-only ordinary workshop craft evidence, never a production or tool simulator. */
import type {Resident,Vec,World} from '../shared/types.js';
import type {CraftRecipe} from '../shared/industry.js';
import type {RoomLayout} from '../shared/rooms.js';
import type {PersonVisual} from './person-pose.js';
import {projectIsometric} from './isometric-projection.js';
import {Pixels} from './isometric-pixels.js';
import {materials as m,residentColors} from './palette.js';
import type {PixelMark} from './work-art.js';
const same=(a:Vec|null|undefined,b:Vec|null|undefined)=>!!a&&!!b&&Number.isInteger(a.x)&&Number.isInteger(a.y)&&a.x===b.x&&a.y===b.y;
const bag=(v:unknown):v is Record<string,number>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).length>0&&Object.values(v).every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0);
function supportedRecipe(v:unknown):v is CraftRecipe {
 const r=v as CraftRecipe;return !!r&&typeof r.id==='string'&&typeof r.name==='string'&&(r.station===null||r.station==='bench')&&Number.isSafeInteger(r.minutes)&&r.minutes>0&&['farming','building','care'].includes(r.skill)&&Number.isFinite(r.minimum)&&r.minimum>=0&&r.minimum<=100&&bag(r.input)&&bag(r.output);
}
export interface OrdinaryCraftVisual {pose:'craft'|'ready';description:string;marks:(elapsed:number)=>PixelMark[];}
/** Resolve the original action, batch and room evidence once per accepted snapshot. */
export function ordinaryCraftVisual(w:World,r:Resident,layout:RoomLayout,visual:PersonVisual):OrdinaryCraftVisual|null {
 const a=r.activity,action=a?.action;
 if(!w.rooms||r.status!=='alive'||r.residency==='outside'||r.regionalLocation||!r.inside||r.lifeStage==='infant'||visual.pose!=='work'||action?.type!=='industry'||action.operation!=='craft')return null;
 if(!Number.isFinite(a!.remaining)||a!.remaining<=0||!Number.isFinite(a!.startedAt)||a!.startedAt<0||a!.startedAt>w.minute||!Number.isSafeInteger(action.minutes)||action.minutes!<=0||a!.path.length||a!.room?.path.length||a!.room?.mode==='exit')return null;
 const b=w.buildings.find(b=>b.id===action.buildingId);
 if(!b||b.kind!=='workshop'||b.id!==r.inside||!Number.isFinite(b.condition)||b.condition<=0||!same(r.at,b.door)||!same(a!.target,b.door)||a!.room&&a!.room.buildingId!==b.id||!w.industry||!Array.isArray(w.industry.batches))return null;
 const working=w.industry.batches.filter(c=>c.ownerId===r.id&&c.status==='working');
 const batch=action.batchId?w.industry.batches.find(c=>c.id===action.batchId):undefined;
 if(action.batchId&&!batch||working.length>1||working.length===1&&working[0]!==batch)return null;
 const definition=action.recipeDefinition&&w.definitions[action.recipeDefinition],recipe=batch?.recipe??(definition&&definition.data);
 if(!supportedRecipe(recipe)||recipe.id!==action.recipeId||(recipe.station??undefined)!==action.station||!definition||definition.id!=='recipe/industry/'+recipe.id||definition.kind!=='recipe')return null;
 const slot=layout.slots.find(s=>s.key===(recipe.station?'station:'+recipe.station:'table'));
 if(!slot||!same(r.roomAt,slot.at)||a!.room&&!same(a!.room.target,slot.at))return null;
 if(recipe.station){const stations=w.industry.stations.filter(s=>s.buildingId===b.id&&s.kind===recipe.station);if(stations.length!==1||typeof stations[0].id!=='string'||!stations[0].id||!Number.isFinite(stations[0].installedAt)||stations[0].installedAt<0||stations[0].installedAt>w.minute||(stations[0].removalWorked??0)!==0)return null;}
 if(batch){
  if(batch.ownerId!==r.id||batch.buildingId!==b.id||batch.status!=='working'||batch.definition!==action.recipeDefinition||batch.actionKey!==`${a!.planId}:${a!.startedAt}`||!Number.isFinite(batch.worked)||batch.worked<=0||batch.worked>=recipe.minutes||!Number.isFinite(batch.createdAt)||batch.createdAt<a!.startedAt||!Number.isFinite(batch.lastAt)||batch.lastAt<batch.createdAt||batch.lastAt>w.minute||!bag(batch.input)||Object.keys(batch.input).length!==Object.keys(recipe.input).length||Object.entries(recipe.input).some(([key,n])=>batch.input[key as keyof typeof batch.input]!==n))return null;
 }else if(Object.entries(recipe.input).some(([key,n])=>(r.inventory[key as keyof typeof r.inventory]??0)<n!))return null;
 const ready=!batch,at={...r.roomAt!},{shirt,skin,hair}=residentColors(r.appearance),elder=r.lifeStage==='elder',small=r.lifeStage==='child'?5:r.lifeStage==='teen'?2:0,paused=w.clock.paused;
 return {pose:ready?'ready':'craft',description:ready?'制作准备：已到真实桌台，尚无加工批次，不表示已开始制作':'普通制作：本人实际加工批次 '+batch!.id+'，位于原'+(recipe.station?'木工作台':'桌台')+'；空手相位不证明工具、火焰或成品已结算',marks:(elapsed:number)=>{
  const c=new Pixels(),p=projectIsometric({x:at.x+.5,y:at.y+.5}),time=paused||ready?0:Math.max(0,Number.isFinite(elapsed)?elapsed:0),phase=Math.floor(time/280)%4;
  c.rect(m.rockInk,p.x-5,p.y-3,4,3);c.rect(m.rockInk,p.x+2,p.y-3,4,3);c.rect(m.rockShade,p.x-4,p.y-8,8,5);
  c.rect(shirt,p.x-4,p.y-15+small,10,9-small);
  if(ready){c.rect(skin,p.x-6,p.y-13+small,2,6-small);c.rect(skin,p.x+6,p.y-13+small,2,6-small);}
  else {c.rect(shirt,p.x+3,p.y-16+small,4,4);c.rect(skin,p.x+6,p.y-16+small-(phase===2?1:0),5+phase%2,3);c.rect(shirt,p.x+3,p.y-12+small,3,4);c.rect(skin,p.x+5,p.y-12+small,7+(phase>=2?2:0),3);}
  c.rect(elder?m.rockLight:hair,p.x-4,p.y-25+small,10,10);c.rect(skin,p.x-2,p.y-21+small,8,8);c.rect(hair,p.x-4,p.y-25+small,10,4);c.rect(m.ink,p.x+4,p.y-19+small);
  return c.marks;
 }};
}

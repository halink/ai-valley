/** Read-only ordinary cooking art. A recorded action is not proof of food output. */
import type {Resident,Vec,World} from '../shared/types.js';
import {cookingBuilding,type RoomLayout} from '../shared/rooms.js';
import type {PersonVisual} from './person-pose.js';
import {projectIsometric} from './isometric-projection.js';
import {Pixels} from './isometric-pixels.js';
import {materials as m,residentColors} from './palette.js';
import type {PixelMark} from './work-art.js';

const same=(a:Vec|null|undefined,b:Vec|null|undefined)=>!!a&&!!b&&Number.isInteger(a.x)&&Number.isInteger(a.y)&&a.x===b.x&&a.y===b.y;
export interface OrdinaryCookingVisual {pose:'cook';description:string;marks:(elapsed:number)=>PixelMark[];}
/** The caller supplies the validated real room and original personVisual evidence.
 * Resolve once per accepted snapshot; animation never reads world collections. */
export function ordinaryCookingVisual(w:World,r:Resident,layout:RoomLayout,visual:PersonVisual):OrdinaryCookingVisual|null {
 const a=r.activity;
 if(!w.rooms||r.status!=='alive'||r.residency==='outside'||r.regionalLocation||!r.inside||r.lifeStage==='infant'||visual.pose!=='work'||a?.action.type!=='cook')return null;
 if(!Number.isFinite(a.remaining)||a.remaining<=0||!Number.isFinite(a.startedAt)||a.startedAt>w.minute||!Number.isInteger(a.action.quantity)||a.action.quantity<=0||a.path.length||a.room?.path.length||a.room?.mode==='exit')return null;
 const b=cookingBuilding(w,r,a),kitchen=layout.slots.find(s=>s.key==='kitchen'&&s.kind==='kitchen');
 if(!b||!['home','lodge'].includes(b.kind)||b.id!==r.inside||!same(r.at,b.door)||!same(a.target,b.door)||!kitchen||!same(r.roomAt,kitchen.at)||a.room&&a.room.buildingId!==b.id)return null;
 const at={...r.roomAt!},{shirt,skin,hair}=residentColors(r.appearance),elder=r.lifeStage==='elder',small=r.lifeStage==='child'?5:r.lifeStage==='teen'?2:0,paused=w.clock.paused;
 return {pose:'cook',description:'普通烹饪：已在真实厨房工位，尚有记录工时；手臂相位仅示意，不证明用火、器具、食材或成品已结算',marks:(elapsed:number)=>{
  const c=new Pixels(),p=projectIsometric({x:at.x+.5,y:at.y+.5}),time=paused?0:Math.max(0,Number.isFinite(elapsed)?elapsed:0),phase=Math.floor(time/280)%4;
  // Reach towards the recorded kitchen's rear counter, without inventing pots,
  // flames, utensils, ingredients or output. Feet stay at the original roomAt.
  c.rect(m.rockInk,p.x-5,p.y-3,4,3);c.rect(m.rockInk,p.x+2,p.y-3,4,3);c.rect(m.rockShade,p.x-4,p.y-8,8,5);
  c.rect(shirt,p.x-4,p.y-15+small,10,9-small);
  c.rect(shirt,p.x+3,p.y-16+small,4,4);c.rect(skin,p.x+6,p.y-16+small-(phase===2?1:0),7+(phase%2),3);
  c.rect(shirt,p.x+3,p.y-12+small,3,4);c.rect(skin,p.x+5,p.y-12+small,9+(phase>=2?2:0),3);
  c.rect(elder?m.rockLight:hair,p.x-4,p.y-25+small,10,10);c.rect(skin,p.x-2,p.y-21+small,8,8);c.rect(hair,p.x-4,p.y-25+small,10,4);c.rect(m.ink,p.x+4,p.y-19+small);
  return c.marks;
 }};
}

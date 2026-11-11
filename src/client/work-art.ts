import type {Resident,Vec} from '../shared/types.js';
import {materials as m,nearestSample,palette,residentColors} from './palette.js';
import type {PersonFacing,WorkPose} from './person-pose.js';

export interface PixelMark {x:number;y:number;width:number;height:number;color:string;}
export interface WorkPicture {width:64;height:64;anchor:{x:32;y:44};marks:PixelMark[];}
const shade=(hex:string,factor:number)=>nearestSample('#'+[16,8,0].map(shift=>Math.min(255,Math.round((parseInt(hex.slice(1),16)>>shift&255)*factor)).toString(16).padStart(2,'0')).join(''));
/** Original integer-pixel art, shared by canvas rendering and browser-free raster tests. */
export function workPicture(r:Resident,pose:WorkPose,frame:number,facing:PersonFacing='south',focus:Vec|null=null):WorkPicture{
 const marks:PixelMark[]=[],phase=((Math.floor(frame)%4)+4)%4;
 const rect=(color:string,x:number,y:number,width:number,height:number)=>marks.push({color,x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)});
 const line=(color:string,ax:number,ay:number,bx:number,by:number,size=1)=>{
  let x=Math.round(ax),y=Math.round(ay);const tx=Math.round(bx),ty=Math.round(by),dx=Math.abs(tx-x),dy=-Math.abs(ty-y),sx=x<tx?1:-1,sy=y<ty?1:-1;let error=dx+dy;
  for(let guard=0;guard<128;guard++){rect(color,x,y,size,size);if(x===tx&&y===ty)break;const e=2*error;if(e>=dy){error+=dy;x+=sx;}if(e<=dx){error+=dx;y+=sy;}}
 };
 const {shirt,skin,hair:baseHair}=residentColors(r.appearance),hair=r.lifeStage==='elder'?m.rockLight:baseHair;
 const dir=facing==='west'?-1:1,back=facing==='north',side=facing==='west'||facing==='east';
 const rawBend=['sow','fetch'].includes(pose)?[1,3,5,2][phase]:pose==='harvest'?[2,5,6,0][phase]:pose==='pick'?[0,1,2,1][phase]:pose==='chop'||pose==='mine'?[0,-1,2,1][phase]:0;
 const small=r.lifeStage==='child'?5:r.lifeStage==='teen'?2:0,bend=Math.min(rawBend,8-small);
 const lean=(phase===2&&pose!=='fish'?1:0)*(side?dir:0),cx=32+lean,headY=19+bend+small;
 const target={x:32+(focus?.x??0)*16,y:40+(focus?.y??0)*16};
 // Same-tile work is directed toward the resident's feet, not an invented neighboring tile.
 const arm={x:cx+(side?dir*5:4),y:33+bend+small};
 const skinShade=shade(skin,.78),shirtShade=shade(shirt,.68);
 rect(m.rockInk,27,42,4,2);rect(m.rockInk,34,42,4,2);
 rect(m.rockShade,28,37,8,5);rect(m.rockInk,31,38,2,4);
 rect(shirtShade,cx-5,30+bend+small,10,10-bend-small);
 rect(shirt,cx-5,29+bend+small,9,10-bend-small);rect(shade(shirt,1.25),cx-4,30+bend+small,2,6-bend/2);
 rect(skinShade,cx-(side?dir*5:6),32+bend+small,2,5);
 // Hair silhouette and a restrained profile distinguish north/south/east/west without rotating the body.
 rect(hair,cx-5,headY,10,10);rect(skin,cx-4,headY+4,8,8);
 rect(hair,cx-5,headY,10,4);rect(shade(hair,1.3),cx-4,headY+1,5,1);
 if(back){rect(hair,cx-5,headY+3,10,7);rect(skin,cx-2,headY+10,4,2);}
 else if(side){rect(hair,cx+(dir>0?-5:2),headY+3,3,6);rect(skin,cx+dir*5-(dir<0?1:0),headY+6,2,3);rect(m.ink,cx+dir*3,headY+6,1,2);rect(skinShade,cx+dir*3,headY+10,2,1);}
 else{rect(hair,cx-5,headY+3,2,5);rect(hair,cx+3,headY+3,2,4);rect(m.ink,cx-2,headY+6,1,2);rect(m.ink,cx+2,headY+6,1,2);rect(skinShade,cx,headY+10,2,1);}
 const armTo=(x:number,y:number)=>{line(shirtShade,arm.x-dir,arm.y-2,arm.x+dir,arm.y,2);line(skin,arm.x,arm.y,x,y,2);rect(skinShade,x,y+1,2,1);};
 if(pose==='chop'||pose==='mine'){
  const tips=side?[[arm.x+dir*5,24],[arm.x-dir*3,18],[target.x,Math.min(55,target.y-5)],[arm.x+dir*7,30]]:
   [[arm.x+5,24],[arm.x+3,17],[target.x,Math.max(7,Math.min(55,target.y-5))],[arm.x+6,30]];
  const [tx,ty]=tips[phase],hx=phase===2?arm.x+dir*2:arm.x+dir,hy=phase===1?arm.y-7:arm.y-1;
  armTo(hx,hy);line(m.woodShade,hx,hy,tx,ty,2);line(m.woodLight,hx,hy,tx,ty);
  if(pose==='chop'){rect(m.rockInk,tx-3,ty-2,7,5);rect(m.rock,tx-2,ty-2,6,4);rect(m.rockLight,tx+2,ty-1,2,3);rect(m.wood,tx,ty,1,3);}
  else{line(m.rockInk,tx-4,ty+1,tx+4,ty-1,2);line(m.rockLight,tx-3,ty,tx+3,ty-2);}
 }else if(pose==='pick'){
  const reach=phase===1||phase===2;
  const goal={x:reach?target.x+(focus?.x===0?dir*5:0):arm.x+dir*2,y:reach?Math.max(12,target.y-17):arm.y+3};
  const length=Math.hypot(goal.x-arm.x,goal.y-arm.y),scale=Math.min(1,10/Math.max(1,length)),x=arm.x+(goal.x-arm.x)*scale,y=arm.y+(goal.y-arm.y)*scale;
  armTo(x,y);rect(skin,x-1,y-1,3,2); // Empty hand: a reach is not a confirmed fruit yield.
 }else if(pose==='sow'||pose==='harvest'){
  const reach=phase===1||phase===2,x=reach?target.x+dir*3:arm.x+dir*2,y=reach?Math.min(58,target.y+(phase===2?2:1)):arm.y+3;
  armTo(x,y);rect(skin,x-1,y,3,2);
  // A worn seed pouch differs from the empty woven harvest basket; neither displays output.
  if(pose==='sow'){line(m.woodShade,cx-3,30+bend+small,cx+2,37);rect(m.woodShade,cx-1,36,5,5);rect(m.rootLight,cx,37,3,3);rect(m.woodLight,cx,37,3,1);}
  else{const bx=cx-dir*7-3,by=39;rect(m.woodShade,bx,by,7,4);rect(m.woodLight,bx+1,by,5,3);rect(m.woodShade,bx,by-2,1,3);rect(m.woodShade,bx+6,by-2,1,3);line(m.woodShade,bx,by-2,bx+6,by-2);rect(m.woodShade,bx+2,by+1,1,2);rect(m.woodShade,bx+4,by+1,1,2);}
 }else if(pose==='water'||pose==='fetch'){
  const pour=pose==='water'&&(phase===1||phase===2),x=arm.x+dir*(phase===3?2:3),y=arm.y+(phase===3?0:phase===2?2:1);
  armTo(x,y);rect(m.rockInk,x-2,y,7,6);rect(m.rock,x-1,y+1,5,4);rect(m.rockLight,x-1,y+1,4,1);
  line(m.rockShade,x-1,y,x-1,y-3);line(m.rockShade,x-1,y-3,x+3,y-3);line(m.rockShade,x+3,y-3,x+3,y);
  if(pose==='water'){
   const spout={x:x+dir*7,y:y+(pour?3:-2)};line(m.rockShade,x+(dir>0?4:-1),y+2,spout.x,spout.y,2);rect(m.rockLight,spout.x,spout.y,2,2);
   // Droplets describe pouring effort only; soil/crop state still comes from the snapshot.
   if(pour)for(let n=1;n<=3;n++){const t=n/4;rect(palette.spring.foam,spout.x+(target.x-spout.x)*t,spout.y+(Math.min(60,target.y+2)-spout.y)*t+(phase===2?1:0),1,2);}
  }
 }else if(pose==='fish'){
  // Cast, settle, patient float, and rod adjustment. No bite, lifted fish or splash is invented.
  const tip=side?(phase===0?{x:arm.x-dir*5,y:15}:phase===1?{x:arm.x+dir*11,y:18}:phase===2?{x:arm.x+dir*10,y:22}:{x:arm.x+dir*7,y:20}):
   phase===0?{x:arm.x+5,y:17}:phase===1?{x:32,y:back?11:31}:phase===2?{x:32,y:back?15:34}:{x:34,y:back?16:32};
  armTo(arm.x+dir*2,arm.y-2);line(m.woodShade,arm.x,arm.y,tip.x,tip.y,2);line(m.woodLight,arm.x,arm.y,tip.x,tip.y);
  const bobber=phase===0?{x:tip.x+dir*3,y:tip.y+8}:phase===1?{x:(tip.x+target.x)/2,y:target.y-6}:target;
  line(m.rootLight,tip.x,tip.y,bobber.x,bobber.y);rect(m.berryDark,bobber.x-1,bobber.y,3,2);rect(m.rootLight,bobber.x,bobber.y-1,1,1);
 }
 return {width:64,height:64,anchor:{x:32,y:44},marks};
}

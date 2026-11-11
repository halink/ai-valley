/** Read-only resource motifs. Availability comes only from the record, never season or elapsed time. */
import type {Resource,Season,Vec} from '../shared/types.js';
import type {OrchardTree} from '../shared/industry.js';
import {Pixels} from './isometric-pixels.js';
import {projectIsometric} from './isometric-projection.js';
import {materials as m,palette} from './palette.js';
import type {PixelMark} from './work-art.js';
export const RESOURCE_MARK_LIMIT=512;
const point=(at:Vec)=>!!at&&Number.isInteger(at.x)&&Number.isInteger(at.y);
const center=(at:Vec)=>projectIsometric({x:at.x+.5,y:at.y+.5});
const finite=(n:number)=>Number.isFinite(n)&&n>=0;
export function resourceArtSupported(r:Resource):boolean {
 return ['rock','bush','spring'].includes(r.kind)&&point(r.at)&&finite(r.amount)&&finite(r.max)&&r.amount<=r.max;
}
export function resourceLabel(r:Resource):string {
 const name=r.kind==='rock'?'石矿':r.kind==='bush'?'浆果丛':r.kind==='spring'?'泉':r.kind;
 return `${name} · 实际余量 ${r.amount}/${r.max}；图形表示有无存量，不是逐份数量`;
}
/** Tree resources keep the existing tree renderer. Unknown kinds return null for an explicit marker. */
export function resourceMarks(r:Resource,season:Season):PixelMark[]|null {
 if(!resourceArtSupported(r))return null;
 const c=new Pixels(),p=center(r.at),x=p.x,y=p.y,available=r.amount>0,s=palette[season];
 if(r.kind==='rock'){
  c.oval(m.earthShade,x,y,13,4);
  if(!available){for(const [dx,dy] of [[-7,-1],[2,1],[7,-2]]){c.rect(m.rockShade,x+dx,y+dy-2,4,3);c.rect(m.rockLight,x+dx,y+dy-2,3);}return c.marks;}
  c.polygon([{x:x-12,y:y-1},{x:x-9,y:y-13},{x:x-1,y:y-19},{x:x+9,y:y-14},{x:x+13,y:y-3},{x:x+5,y:y+3}],m.rockShade,m.rockInk);
  c.polygon([{x:x-9,y:y-13},{x:x-1,y:y-19},{x:x+9,y:y-14},{x:x+1,y:y-8},{x:x-11,y:y-5}],m.rockLight);
  c.polygon([{x:x+1,y:y-8},{x:x+9,y:y-14},{x:x+13,y:y-3},{x:x+5,y:y+3}],m.rock);
  c.line(m.rockInk,{x:x-3,y:y-14},{x:x-1,y:y-7});c.line(m.rockInk,{x:x-1,y:y-7},{x:x+4,y:y-5});
 }else if(r.kind==='bush'){
  c.oval(s.dark,x,y,13,3);c.line(m.barkShade,{x,y},{x,y:y-13},2);
  for(const [dx,dy,rx,ry] of [[-6,-7,6,6],[4,-9,8,7],[0,-15,5,5]]){c.oval(s.leafInk,x+dx,y+dy,rx,ry);c.oval(s.leafShade,x+dx,y+dy-1,rx-1,ry-1);c.oval(s.leaf,x+dx-1,y+dy-2,rx-2,ry-2);c.rect(s.leafLight,x+dx-2,y+dy-3,3);}
  if(available)for(const [dx,dy] of [[-7,-8],[1,-13],[7,-7]]){c.rect(m.berryDark,x+dx,y+dy,3,3);c.rect(m.berry,x+dx,y+dy,2,2);c.rect(m.berryLight,x+dx,y+dy);}
 }else{
  c.oval(m.rockInk,x,y-1,14,6);c.oval(m.rock,x,y-2,13,5);c.oval(m.rockLight,x-1,y-3,11,4);
  c.oval(available?s.deep:m.earthShade,x,y-2,9,3);
  if(available){c.rect(s.water,x-7,y-3,12,2);c.rect(s.foam,x-4,y-4,5);c.rect(s.foam,x+2,y-1,4);}
  else{c.rect(m.earth,x-5,y-3,6);c.line(m.rockShade,{x:x-2,y:y-3},{x:x+3,y:y-1});}
  // Natural exposed stone only. No pump, well, basin construction, or water delivery is inferred.
  for(const [dx,dy] of [[-11,-4],[9,-3],[1,2]])c.rect(m.rockShade,x+dx,y+dy,3,2);
 }
 return c.marks.length<=RESOURCE_MARK_LIMIT?c.marks:null;
}
export function orchardArtSupported(t:OrchardTree):boolean {
 return point(t.at)&&(t.status==='growing'||t.status==='mature')&&finite(t.growth)&&finite(t.fruit)&&(t.status!=='growing'||t.fruit===0);
}
export function orchardLabel(t:OrchardTree):string {
 return `果树 · ${t.status==='growing'?'生长中':t.status==='mature'?'成熟':t.status} · 实际果实 ${t.fruit}份；果实符号不是逐个数量，不推断品种`;
}
export function orchardMarks(t:OrchardTree,season:Season):PixelMark[]|null {
 if(!orchardArtSupported(t))return null;
 const c=new Pixels(),p=center(t.at),x=p.x,y=p.y,s=palette[season],mature=t.status==='mature';
 c.oval(s.dark,x,y,mature?12:6,2);c.line(m.barkShade,{x:x-1,y},{x,y:y-(mature?27:13)},mature?4:2);c.line(m.barkLight,{x,y:y-1},{x:x+1,y:y-(mature?26:12)});
 const lobes=mature?[[-8,-24,8,8],[4,-29,10,9],[10,-20,7,7],[-1,-18,10,8]]:[[-3,-12,4,4],[3,-15,4,4]];
 if(season==='winter'){
  for(const [dx,dy] of lobes){c.line(m.barkShade,{x,y:y-(mature?15:8)},{x:x+dx,y:y+dy},2);c.rect(s.grass,x+dx-2,y+dy-1,4);}
 }else for(const [dx,dy,rx,ry] of lobes){c.oval(s.leafInk,x+dx,y+dy,rx,ry);c.oval(s.leafShade,x+dx,y+dy-1,rx-1,ry-1);c.oval(s.leaf,x+dx-1,y+dy-2,rx-2,ry-2);c.rect(s.leafLight,x+dx-3,y+dy-3,4);}
 // Recorded fruit survives a seasonal art change. A season cannot create or silently remove stock.
 if(t.fruit>0)for(const [dx,dy] of [[-8,-24],[3,-29],[9,-19],[-1,-16]]){c.rect(m.rootShade,x+dx,y+dy,3,3);c.rect(m.rootLight,x+dx,y+dy,2,2);}
 return c.marks.length<=RESOURCE_MARK_LIMIT?c.marks:null;
}

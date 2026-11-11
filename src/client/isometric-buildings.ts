/** Read-only architecture. A building record is not a construction project or installed equipment. */
import type {Building,BuildingKind,Season,Vec,Item} from '../shared/types.js';
import type {ConstructionProject} from '../shared/construction.js';
import {validBuildingArt,type BuildingArt} from '../shared/building-art.js';
import {Pixels,type Ink} from './isometric-pixels.js';
import {projectIsometric,type Footprint} from './isometric-projection.js';
import {materials as m,palette} from './palette.js';
import type {PixelMark} from './work-art.js';

export const BUILDING_MARK_LIMIT=16000;
export const BUILDING_FOOTPRINT_LIMIT=80;
export const buildingNames:Record<BuildingKind,string>={home:'住宅',lodge:'旅舍',workshop:'工坊',clinic:'诊所',school:'学校',barn:'畜舍',greenhouse:'温室',store:'商店'};
const point=(p:Vec|undefined):p is Vec=>!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y);
const finite=(n:number)=>Number.isFinite(n)&&n>=0;
export function buildingFootprint(b:Pick<Building,'at'|'width'|'height'>):Footprint|null {
 return point(b.at)&&[b.width,b.height].every(n=>Number.isInteger(n)&&n>0)&&b.width+b.height<=BUILDING_FOOTPRINT_LIMIT?{...b.at,width:b.width,height:b.height}:null;
}
export function buildingArtSupported(b:Building):boolean {
 return !!buildingFootprint(b)&&Object.hasOwn(buildingNames,b.kind)&&point(b.door)&&finite(b.condition)&&b.condition<=100;
}
export function buildingLabel(b:Building):string {
 return `${Object.hasOwn(buildingNames,b.kind)?buildingNames[b.kind]:b.kind} · 建筑记录 · 状况 ${Number.isFinite(b.condition)?b.condition:'未记录'}/100；外观不表示设备、库存或服务正在运行`;
}
type Ramp=readonly [string,string,string,string];
const roofs:Record<NonNullable<BuildingArt['roof']>,Ramp>={
 clay:['#441910','#94230e','#d04f26','#e58d34'],blue:['#071d3a','#0a4371','#1177b5','#68d0ed'],
 green:['#06392e','#29553e','#467861','#9fce71'],thatch:['#512807','#934d10','#cd8825','#f4b126'],
 slate:['#2e2e2e','#464646','#808080','#afafaf'],wood:['#3f1d1a','#693127','#99542c','#e58d34'],
};
const style:Record<BuildingKind,{roof:keyof typeof roofs;wall:string;shade:string;light:string;z:number;peak:number}>={
 home:{roof:'clay',wall:m.wood,shade:m.bark,light:m.woodLight,z:29,peak:47},
 lodge:{roof:'thatch',wall:'#a66c36',shade:'#754624',light:'#d49c59',z:38,peak:55},
 workshop:{roof:'slate',wall:'#a47c64',shade:'#775747',light:'#c9a18a',z:27,peak:36},
 clinic:{roof:'green',wall:'#ead7ba',shade:'#c2ac90',light:'#fff1cf',z:30,peak:45},
 school:{roof:'blue',wall:'#ddbb83',shade:'#a78b63',light:'#f1d8a1',z:34,peak:51},
 barn:{roof:'clay',wall:'#aa4840',shade:'#763c36',light:'#d97854',z:31,peak:51},
 greenhouse:{roof:'blue',wall:'#71afbb',shade:'#468392',light:'#b7e1dc',z:24,peak:40},
 store:{roof:'green',wall:'#c6a577',shade:'#94724e',light:'#eed3a3',z:29,peak:42},
};
/** All geometry starts at the original tile corners. Eaves never change collision/depth footprints. */
export function buildingMarks(b:Building,season:Season,art?:unknown):PixelMark[]|null {
 if(!buildingArtSupported(b))return null;
 const c=new Pixels(),w=b.width,h=b.height,s=style[b.kind],z=s.z,ramp=roofs[validBuildingArt(art)&&art.roof?art.roof:s.roof];
 // Rasterize locally before the integer translation, avoiding coordinate-dependent half-pixel rounding.
 const anchor=projectIsometric(b.at),p=(x:number,y:number,elevation=0)=>projectIsometric({x,y},elevation);
 const [d,f,l]=[p(w,0),p(w,h),p(0,h)],[at,dt,ft,lt]=[p(0,0,z),p(w,0,z),p(w,h,z),p(0,h,z)];
 const ridgeA=p(0,h/2,s.peak),ridgeB=p(w,h/2,s.peak),glass=b.kind==='greenhouse';
 c.polygon([l,f,{x:f.x+5,y:f.y+3},{x:l.x+5,y:l.y+3}],palette[season].dark);
 const origin=p(0,0),wall=(lit:boolean):Ink=>(absoluteX,absoluteY)=>{
  const x=absoluteX-origin.x,y=absoluteY-origin.y;
  if(glass)return ((x+y)%13+13)%13<2?s.light:lit?s.wall:s.shade;
  const row=((y+(lit?1:-1)*Math.floor(x/2))%7+7)%7;
  return row===6?m.woodShade:row===0?s.light:lit?s.wall:s.shade;
 };
 c.polygon([d,f,ft,dt],wall(false),m.barkShade);c.polygon([l,f,ft,lt],wall(true),m.barkShade);
 for(const [lo,hi] of [[l,lt],[f,ft],[d,dt]]){c.line(m.barkShade,lo,hi,2);c.line(glass?'#d2e4d4':s.light,{x:lo.x+1,y:lo.y},{x:hi.x+1,y:hi.y});}
 const pane=(x:number,y:number,front:boolean,width:number,height:number,base:number,door=false)=>{
  const bl=p(x,y,base),br=p(x+(front?width:0),y+(front?0:width),base),tl={x:bl.x,y:bl.y-height},tr={x:br.x,y:br.y-height};
  c.polygon([bl,br,tr,tl],door?m.woodShade:'#31596e',m.barkShade);c.line(s.light,tl,tr);
  const mid={x:(bl.x+br.x)/2,y:(bl.y+br.y)/2};c.line(door?m.wood:s.light,mid,{x:mid.x,y:mid.y-height});
  if(door){c.line(m.woodLight,bl,br);c.rect(m.gold,mid.x+2,mid.y-height/2);}
  else{c.line('#8bd1de',{x:tl.x+1,y:tl.y+2},{x:tr.x-2,y:tr.y+3});c.line(s.light,{x:bl.x,y:bl.y-height/2},{x:br.x,y:br.y-height/2});}
 };
 // Windows are architecture motifs, not evidence of occupants or installed stations.
 if(!glass){
  if(w>=2)pane(.15,h,true,.52,10,z>32?16:10);
  if(w>=3)pane(w-.75,h,true,.52,10,z>32?16:10);
  if(h>=2)pane(w,.2,false,.55,11,10);
  if(b.kind==='lodge'&&w>=2)pane(w/2-.25,h,true,.5,8,26);
 }
 const front=b.door.y===b.at.y+h&&b.door.x>=b.at.x&&b.door.x<b.at.x+w;
 const side=b.door.x===b.at.x+w&&b.door.y>=b.at.y&&b.door.y<b.at.y+h;
 if(front)pane(b.door.x-b.at.x+.1,h,true,.8,b.kind==='barn'?26:22,0,true);
 else if(side)pane(w,b.door.y-b.at.y+.1,false,.8,b.kind==='barn'?26:22,0,true);
 if(glass){
  for(let x=0;x<=w;x++)c.line('#d2e4d4',p(x,h),p(x,h,z));
  for(let y=0;y<=h;y++)c.line('#91c7ca',p(w,y),p(w,y,z));
  c.line('#d2e4d4',p(0,h,12),p(w,h,12));c.line('#91c7ca',p(w,0,12),p(w,h,12));
 }
 if(b.kind==='barn'){
  c.line('#e5c6a0',p(.1,h,28),p(Math.min(1,w-.1),h,4),2);
  if(w>1)c.line('#e5c6a0',p(w-.1,h,28),p(Math.max(w-1,.1),h,4),2);
 }
 const roofInk=(lit:boolean):Ink=>(absoluteX,absoluteY)=>{
  const x=absoluteX-origin.x,y=absoluteY-origin.y;
  const row=((y+Math.floor(x/2))%5+5)%5,col=((x+Math.floor(y/5)*3)%11+11)%11;
  if(glass)return col<2?'#9cdce0':row===0?'#b7e1dc':lit?'#63a6b9':'#386c85';
  if(season==='winter')return row===4?palette.winter.dark:col===0?palette.winter.accent:palette.winter.grass;
  return ramp[row===4?1:col===0?1:row===0?3:lit?2:1];
 };
 c.polygon([dt,ft,ridgeB],glass?'#71afbb':s.shade,m.barkShade);
 c.polygon([at,dt,ridgeB,ridgeA],roofInk(false),glass?'#d2e4d4':ramp[0]);
 c.polygon([ridgeA,ridgeB,{x:ft.x,y:ft.y+2},{x:lt.x-2,y:lt.y+1}],roofInk(true),glass?'#d2e4d4':ramp[0]);
 c.line(glass?'#d2e4d4':season==='winter'?palette.winter.light:ramp[3],ridgeA,ridgeB);
 if(glass)for(let x=0;x<=w;x++){c.line('#d2e4d4',p(x,0,z),p(x,h/2,s.peak));c.line('#d2e4d4',p(x,h/2,s.peak),p(x,h,z));}
 // Flat façade symbols distinguish roles without inventing tools, supplies, patients or lessons.
 const sign=p(w,h/2,z+4);
 if(b.kind==='clinic'){c.rect('#e8edd2',sign.x-6,sign.y-10,12,12);c.rect('#367b85',sign.x-1,sign.y-8,3,8);c.rect('#367b85',sign.x-4,sign.y-5,9,3);}
 if(b.kind==='school'){c.rect('#634a32',sign.x-7,sign.y-10,14,10);c.polygon([{x:sign.x-5,y:sign.y-8},{x:sign.x,y:sign.y-6},{x:sign.x,y:sign.y-1},{x:sign.x-5,y:sign.y-3}],'#fff1cf');c.polygon([{x:sign.x,y:sign.y-6},{x:sign.x+5,y:sign.y-8},{x:sign.x+5,y:sign.y-3},{x:sign.x,y:sign.y-1}],'#d8c999');}
 if(b.kind==='workshop'){c.rect('#e0c597',sign.x-7,sign.y-6,14,7);c.rect('#665d53',sign.x-4,sign.y-5,8,2);c.rect('#665d53',sign.x-2,sign.y-3,4,2);}
 if(b.kind==='store'){
  const awning=(u:number)=>p(u,h,24);
  for(let i=0;i<Math.ceil(w*2);i++){const x=i/2,end=Math.min(w,x+.5),left=awning(x),right=awning(end);c.polygon([left,right,{x:right.x-7,y:right.y+5},{x:left.x-7,y:left.y+5}],i%2?'#e5d6b2':'#3d7863',m.barkShade);}
 }
 // Condition affects only recorded wear. No inferred fire, collapse, contents, smoke or repair activity.
 if(b.condition<70){const crack=p(Math.max(.3,w*.73),h,17);c.line(m.rockInk,crack,{x:crack.x-2,y:crack.y+5});c.line(m.rockInk,{x:crack.x-2,y:crack.y+5},{x:crack.x+1,y:crack.y+9});}
 if(b.condition<25){const crack=p(w,Math.max(.3,h*.7),19);c.line(m.rockInk,crack,{x:crack.x+3,y:crack.y+7},2);c.line(m.rockInk,{x:crack.x+3,y:crack.y+7},{x:crack.x+1,y:crack.y+12});}
 if(b.condition<=0){const cross=p(w*.5,h,9);c.line('#4e4140',{x:cross.x-3,y:cross.y-3},{x:cross.x+3,y:cross.y+3});c.line('#4e4140',{x:cross.x+3,y:cross.y-3},{x:cross.x-3,y:cross.y+3});}
 return c.marks.length<=BUILDING_MARK_LIMIT?c.marks.map(mark=>({...mark,x:mark.x+anchor.x,y:mark.y+anchor.y})):null;
}

export type ConstructionAppearance='reserved'|'foundation'|'frame'|'roofing';
/** Only the engine's three-stage NEW building schema is illustrated. Other project modes stay explicit. */
export function constructionAppearance(p:ConstructionProject,minute:number):ConstructionAppearance|null {
 if(p.mode!=='new'||p.base!==null||!p.reserved||!Object.hasOwn(buildingNames,p.kind)||!buildingFootprint(p)||!finite(minute)||!['planned','active','paused','abandoned'].includes(p.status)||p.finishedAt!==null||!Array.isArray(p.stages)||p.stages.length!==3||!Number.isInteger(p.stage)||p.stage<0||p.stage>2)return null;
 let begun=0,priorFinished=true,lastFinish=0;const materials:Record<string,number>={};
 for(const s of p.stages){
  if(!s||!finite(s.worked)||!finite(s.minutes)||s.minutes<=0||s.worked>s.minutes||!s.materials||Object.values(s.materials).some(n=>!finite(n!)))return null;
  if(s.startedAt===null){if(s.worked!==0||s.finishedAt!==null)return null;priorFinished=false;continue;}
  if(!priorFinished||!finite(s.startedAt)||s.startedAt<lastFinish||s.startedAt>minute||s.worked<=0)return null;
  if(s.finishedAt!==null&&(!finite(s.finishedAt)||s.finishedAt<s.startedAt||s.finishedAt>minute||s.worked!==s.minutes))return null;
  if(s.finishedAt===null&&s.worked===s.minutes)return null;
  for(const [item,n] of Object.entries(s.materials))materials[item]=(materials[item]??0)+n!;
  begun++;priorFinished=s.finishedAt!==null;if(s.finishedAt!==null)lastFinish=s.finishedAt;
 }
 if(begun===3&&priorFinished)return null;
 if(!p.incorporated||Object.values(p.incorporated).some(n=>!finite(n!))||!begun&&Object.values(p.incorporated).some(n=>n!>0))return null;
 if(Object.entries(materials).some(([item,n])=>!finite(p.incorporated?.[item as Item] as number)||p.incorporated[item as Item]!<n))return null;
 const expected=Math.min(2,p.stages.filter(s=>s.finishedAt!==null).length);if(p.stage!==expected)return null;
 return (['reserved','foundation','frame','roofing'] as const)[begun];
}
export function constructionLabel(p:ConstructionProject,minute:number):string {
 const state=constructionAppearance(p,minute),names={reserved:'仅预留边界',foundation:'实际基础施工',frame:'实际梁柱施工',roofing:'实际屋顶施工'};
 return `${p.name} · ${state?names[state]:'未支持或不一致的工程记录'} · ${p.status}；不是已完工建筑`;
}
export function constructionMarks(p:ConstructionProject,minute:number):PixelMark[]|null {
 const state=constructionAppearance(p,minute);if(!state)return null;
 const c=new Pixels(),w=p.width,h=p.height,q=(x:number,y:number,z=0)=>projectIsometric({x:p.at.x+x,y:p.at.y+y},z),corners=[q(0,0),q(w,0),q(w,h),q(0,h)];
 if(state==='reserved'){
  // A dashed survey outline is an observation overlay, not invented stakes or installed fencing.
  corners.forEach((a,i)=>{const b=corners[(i+1)%4],steps=Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));for(let n=0;n<=steps;n+=4)c.rect(m.gold,a.x+(b.x-a.x)*n/steps,a.y+(b.y-a.y)*n/steps,2);});
  return c.marks;
 }
 c.polygon(corners,m.earth,m.earthShade);
 for(const [x,y] of [[0,0],[w,0],[w,h],[0,h]]){const a=q(x,y);c.oval(m.rockShade,a.x,a.y-1,3,2);c.rect(m.rockLight,a.x-2,a.y-3,4,2);}
 if(state==='foundation')return c.marks;
 for(const [x,y] of [[0,0],[w,0],[w,h],[0,h]]){c.line(m.woodShade,q(x,y),q(x,y,26),3);c.line(m.woodLight,q(x,y),q(x,y,26));}
 for(const [a,b] of [[[0,0],[w,0]],[[w,0],[w,h]],[[w,h],[0,h]],[[0,h],[0,0]]] as const)c.line(m.woodLight,q(a[0],a[1],25),q(b[0],b[1],25),2);
 c.line(m.woodShade,q(0,h,3),q(w,h,25),2);
 if(state==='roofing'){
  c.line(m.woodShade,q(0,h/2,39),q(w,h/2,39),2);
  for(const x of [0,w/2,w]){c.line(m.woodLight,q(x,0,25),q(x,h/2,39));c.line(m.woodLight,q(x,h/2,39),q(x,h,25));}
  // Partial boarding is a phase motif. No completed roof is implied or inferred from percent work.
  c.polygon([q(0,h/2,39),q(w*.35,h/2,39),q(w*.35,h,25),q(0,h,25)],m.wood,m.woodShade);
 }
 return c.marks.length<=BUILDING_MARK_LIMIT?c.marks:null;
}

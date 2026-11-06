import {animal,livestockCrate} from './art.js';
import {crateLocation} from '../world/livestock-cargo.js';
import {estatePiles} from './estate-custody.js';
import type {Building,World} from '../shared/types.js';
import {roomLayout} from '../shared/rooms.js';
import {materials as m,palette,nearestSample} from './palette.js';
import {barnAnimalPoint} from './animal-observation.js';
export function roomHeat(w:World,b:Building){let kitchen=false,forge=false;for(const r of w.residents){if(r.inside!==b.id||!r.roomAt||!r.activity||r.activity.path.length||r.activity.room?.path.length||r.activity.room?.mode==='exit'||r.status!=='alive')continue;const a=r.activity.action;const contract=a.type==='employment'&&a.operation==='work'?w.employment?.contracts.find(c=>c.id===a.contractId):undefined;const duty=a.type==='publicDuty'&&a.operation==='attend'?w.duties?.shifts.find(s=>s.id===a.shiftId):undefined;kitchen||=a.type==='cook'||!!contract?.batch&&contract.terms.role==='cook'||duty?.role==='kitchen'&&duty.status==='on-duty';forge||=a.type==='industry'&&(a.operation==='upgrade'||a.operation==='craft'&&a.station==='forge'&&!!a.batchId)||!!contract?.batch&&contract.recipe?.station==='forge';}return {kitchen,forge};}
const swatches=new Map<string,string>();
/** The same floor plan supplies authoritative navigation and the visible room. */
export function roomPicture(w:World,b:Building){
 const heat=roomHeat(w,b),layout=roomLayout(w,b),canvas=document.createElement('canvas');canvas.width=layout.width*16;canvas.height=layout.height*16;
 const c=canvas.getContext('2d')!;c.imageSmoothingEnabled=false;
 const rect=(color:string,x:number,y:number,width:number,height:number)=>{let ink=swatches.get(color);if(!ink){ink=nearestSample(color);swatches.set(color,ink);}c.fillStyle=ink;c.fillRect(x,y,width,height);};
 rect(m.ink,0,0,canvas.width,canvas.height);rect(m.woodShade,8,8,canvas.width-16,canvas.height-16);
 rect('#c9a56f',12,10,canvas.width-24,44);rect(m.wood,12,54,canvas.width-24,canvas.height-68);rect(m.woodShade,12,49,canvas.width-24,5);rect(m.woodLight,12,49,canvas.width-24,1);
 for(let y=58;y<canvas.height-16;y+=6)for(let x=15+(y%5);x<canvas.width-16;x+=11){const n=(Math.imul(x+7,17027)^Math.imul(y+31,25733))>>>0;if(n%7<3)rect(n%2?m.woodShade:m.woodLight,x,y+1,n%4+1,1);}
 for(let y=56;y<canvas.height-14;y+=12){rect(m.woodShade,12,y,canvas.width-24,1);rect(m.woodLight,13,y+1,canvas.width-26,1);for(let x=12+(y%24?0:24);x<canvas.width-12;x+=48)rect(m.woodShade,x,y,1,12);}
 for(const x of [32,canvas.width-63]){rect(m.woodShade,x-3,14,32,30);rect('#f6d89c',x-1,15,28,27);rect(palette.spring.deep,x+2,17,22,23);rect(palette.spring.foam,x+3,18,9,9);rect(m.wood,x+12,16,2,25);rect(m.wood,x,28,27,2);}
 for(const s of layout.slots){const x=s.at.x*16+8,y=s.at.y*16+15;
  if(s.kind==='bed'){
   rect(m.woodShade,x-14,y-43,28,43);rect('#f6d89c',x-12,y-40,24,37);rect('#fff1b6',x-10,y-38,20,8);rect(b.kind==='clinic'?'#68d0ed':'#1177b5',x-12,y-26,24,23);rect('#68d0ed',x-11,y-25,22,3);rect(m.woodLight,x-15,y-44,30,4);rect(m.woodLight,x-15,y-4,30,4);rect(m.wood,x-15,y-3,30,1);rect(m.woodShade,x-13,y,2,2);rect(m.woodShade,x+11,y,2,2);for(let i=0;i<3;i++){rect('#1177b5',x-11,y-21+i*5,22,1);rect('#68d0ed',x-10+(i%2)*3,y-21+i*5,2,1);}rect(m.woodShade,x-12,y-27,24,1);rect(m.woodLight,x-11,y-39,22,1);
  }
  if(s.kind==='kitchen'&&['home','lodge'].includes(b.kind)){rect(m.rockShade,x-23,y-43,46,37);rect(m.rockLight,x-20,y-40,40,30);for(let row=0;row<4;row++){rect(m.rockShade,x-20,y-38+row*6,40,1);for(let col=-18+(row%2)*5;col<20;col+=9)rect(m.rockShade,x+col,y-38+row*6,1,6);}rect(m.ink,x-12,y-30,24,23);rect(m.woodShade,x-10,y-29,20,2);rect(m.rock,x-17,y-9,34,3);if(heat.kitchen){rect('#d37434',x-8,y-19,16,12);rect(m.gold,x-3,y-21,6,12);}}
 }
 const center=Math.floor(layout.width/2)*16;
 if(!['greenhouse','barn'].includes(b.kind)){
  rect(m.woodShade,center-31,94,62,35);rect(m.wood,center-29,96,58,25);rect(m.woodLight,center-28,96,56,3);for(const x of [center-20,center+18])rect(m.woodShade,x,122,4,12);
  for(let i=0;i<4;i++)rect(m.woodShade,center-26,101+i*5,52,1);rect('#f6d89c',center-18,102,13,9);rect('#3e993e',center-16,102,5,4);rect('#f6d89c',center+8,103,9,8);
  for(const [x,y]of [[center-32,139],[center,139],[center+32,139],[center,171]]){rect(m.woodShade,x-6,y-7,12,16);rect(m.wood,x-5,y-7,10,8);rect(m.woodLight,x-5,y-7,10,2);}
 }
 if(b.kind==='school'){rect(m.woodShade,center-33,13,66,35);rect('#073d18',center-30,16,60,29);for(let row=0;row<3;row++)rect('#f6d89c',center-23,21+row*7,20+row*5,1);}
 for(const station of w.industry?.stations.filter(s=>s.buildingId===b.id)??[]){const slot=layout.slots.find(s=>s.key==='station:'+station.kind)!;const x=slot.at.x*16+8,y=slot.at.y*16+15;
  if(station.kind==='bench')continue;
  rect(m.woodShade,x-19,y-30,38,27);rect(m.wood,x-17,y-29,34,19);rect(m.woodLight,x-16,y-29,32,3);
  if(station.kind==='forge'){rect(m.rockShade,x-17,y-40,34,31);rect(m.rockLight,x-14,y-38,28,3);rect(m.ink,x-10,y-26,20,16);if(heat.forge){rect('#d37434',x-7,y-20,14,10);rect(m.gold,x-2,y-22,5,10);}}
  if(station.kind==='loom')for(let i=-12;i<=12;i+=4){rect('#f6d89c',x+i,y-36,1,24);rect(m.woodLight,x-15,y-38,30,3);}
  if(station.kind==='mill'){rect(m.rockShade,x-13,y-39,26,16);rect(m.rockLight,x-11,y-38,22,4);}
  if(station.kind==='dairy'||station.kind==='preserver')for(let k=-1;k<=1;k++){rect('#f6d89c',x+k*10-3,y-36,7,13);rect(m.gold,x+k*10-3,y-37,7,3);}
 }
 if(b.kind==='greenhouse')for(let i=0;i<4;i++){const x=(i%2?10:4)*16,y=(i<2?6:10)*16;rect(m.woodShade,x-24,y,48,40);rect(m.earth,x-22,y+2,44,35);const crop=w.industry?.beds.find(p=>p.buildingId===b.id&&p.index===i)?.crop;
  if(crop)for(let j=0;j<6;j++){const px=x-16+(j%3)*14,py=y+10+Math.floor(j/3)*17;rect('#227037',px,py,2,9);rect('#3e993e',px-3,py+2,8,3);if(crop.growth>=3)rect('#f6d89c',px-2,py+5,6,5);}
 }
 if(b.kind==='barn')for(const n of w.industry?.animals.filter(n=>n.barnId===b.id&&n.status==='alive'&&!n.at)??[]){
  const point=barnAnimalPoint(w,b,n);if(!point)continue;
  const {x,y}=point;rect(m.woodShade,x-32,y-32,64,48);rect('#c9a56f',x-29,y-29,58,42);for(let k=-1;k<=1;k++)rect('#f6d89c',x+k*17-5,y+7,11,1);
  const art=animal(n.kind);c.drawImage(art,x-art.width/2,y-art.height);
  rect(m.woodShade,x-27,y-24,12,8);rect(n.hunger<50?'#8adb72':m.earth,x-26,y-23,10,5);rect(m.woodShade,x+16,y-2,12,8);rect(n.thirst<50?palette.spring.water:m.earth,x+17,y-1,10,5);
 }
 rect('#f6d89c',layout.entry.x*16-8,canvas.height-19,32,9);rect(m.woodLight,layout.entry.x*16-10,canvas.height-11,36,3);
 for(const e of w.culture?.events.filter(e=>e.buildingId===b.id&&e.preparation.completedAt!==null&&e.preparation.clearedAt===null)??[]){const color=e.kind==='wedding'?palette.spring.blossom:e.kind==='memorial'?palette.spring.foam:m.gold;rect(m.woodShade,16,54,canvas.width-32,1);for(let x=24;x<canvas.width-24;x+=16)for(let y=55;y<63;y++)rect(color,x+Math.floor((y-55)/2),y,Math.max(1,8-(y-55)),1);if(e.contributions.some(c=>Object.values(c.inventory).some(n=>n!>0))){rect(m.woodShade,center-13,101,26,16);rect(m.woodLight,center-12,100,24,3);rect(m.rootLight,center-8,98,6,4);rect(m.root,center+2,98,6,4);}}
 for(const p of estatePiles(w).filter(p=>p.inside===b.id&&p.roomAt)){const x=p.roomAt!.x*16,y=p.roomAt!.y*16;rect(m.woodShade,x-1,y+2,18,13);rect(m.wood,x,y+3,16,10);rect(m.woodLight,x,y+1,16,4);rect(m.woodShade,x,y+5,16,1);rect(m.gold,x+7,y+4,3,6);}
 for(const n of w.industry?.animals??[])if(n.status==='alive'&&n.at&&n.inside===b.id&&n.roomAt){
  const point=barnAnimalPoint(w,b,n);if(point){const art=animal(n.kind);c.drawImage(art,point.x-art.width/2,point.y-art.height);}
 }
 for(const crate of w.industry?.livestockCargo??[])if(crate.status==='crated'){const l=crateLocation(w,crate);if(l?.inside===b.id&&l.roomAt)c.drawImage(livestockCrate(),l.roomAt.x*16+7,l.roomAt.y*16-1);}
 return canvas;
}

import {validBuildingArt} from '../shared/building-art.js';
import type { Building, Season } from '../shared/types.js';

// Colour references include Carpenter's Shop, Standard Farm and Festival of Ice.
// The rasterizer below draws each building. References are credited in docs/art.md.
const wood = ['#3f1d1a', '#512807', '#693127', '#8b4727', '#99542c', '#bf7a2c', '#e58d34', '#f4a94d'];
const clay = ['#441910', '#58100f', '#740e14', '#94230e', '#b73c19', '#d04f26', '#e58d34'];
const blue = ['#071d3a', '#093261', '#0a4371', '#0f5494', '#1177b5', '#1da5d4', '#68d0ed'];
const thatch = ['#512807', '#934d10', '#b06312', '#cd8825', '#e6a21f', '#f4b126', '#f4a94d'];
const green = ['#06392e', '#0f443b', '#29553e', '#386747', '#467861', '#5a9144', '#9fce71'];
const slate = ['#2e2e2e', '#3d3d3d', '#464646', '#606060', '#808080', '#8b8b8b', '#afafaf'];
const stone = ['#492828', '#775757', '#977161', '#97796a', '#b78874', '#cea686', '#dcb799'];
const cream = '#ffe0c4';
const snow = ['#9bd5ff', '#c6f3ff', '#fdffff'];
const glass = ['#093261', '#466584', '#549dbf', '#56bbc4', '#68d0ed', '#c7ffff'];
type Point = [number, number];
type Ink = string | ((x:number, y:number) => string);
function noise(x:number, y:number) {
  let n = Math.imul(x + 31, 73856093) ^ Math.imul(y + 13, 19349663);
  n = Math.imul(n ^ (n >>> 13), 2246822519);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Rasterize on a whole-pixel grid, including sloping eaves and timber braces. */
class Sprite {
  readonly canvas = document.createElement('canvas');
  private pixels: ImageData;
  private colors = new Map<string, [number, number, number]>();
  constructor(width:number, height:number, readonly winter:boolean,readonly roofTint?:string[]) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.pixels = new ImageData(width, height);
  }
  dot(x:number, y:number, color:string) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    let rgb = this.colors.get(color);
    if (!rgb) {
      const value = parseInt(color.slice(1), 16);
      rgb = [value >>> 16, (value >>> 8) & 255, value & 255];
      this.colors.set(color, rgb);
    }
    const at = (y * this.canvas.width + x) * 4;
    this.pixels.data.set(rgb, at); this.pixels.data[at + 3] = 255;
  }
  box(x:number, y:number, w:number, h:number, ink:Ink) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      this.dot(x + i, y + j, typeof ink === 'string' ? ink : ink(x+i, y+j));
    }
  }
  line(x1:number, y1:number, x2:number, y2:number, color:string) {
    const length = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let i = 0; i <= length; i++) this.dot(x1 + (x2-x1)*i/length, y1 + (y2-y1)*i/length, color);
  }
  shape(points:Point[], ink:Ink, edge?:string) {
    const ys = points.map(p=>p[1]);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      const cuts:number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1,y1] = points[i], [x2,y2] = points[(i+1)%points.length];
        if ((y1<=y+.5 && y2>y+.5) || (y2<=y+.5 && y1>y+.5)) cuts.push(x1 + (y+.5-y1)*(x2-x1)/(y2-y1));
      }
      cuts.sort((a,b)=>a-b);
      for (let i = 0; i+1 < cuts.length; i+=2) for (let x=Math.ceil(cuts[i]-.5); x<cuts[i+1]-.5; x++) {
        this.dot(x,y,typeof ink==='string'?ink:ink(x,y));
      }
    }
    if (edge) points.forEach(([x,y],i)=>this.line(x,y,...points[(i+1)%points.length],edge));
  }
  finish() { this.canvas.getContext('2d')!.putImageData(this.pixels,0,0); return this.canvas; }
}

function planks(x:number,y:number, vertical=false) {
  const across = vertical ? x : y, along = vertical ? y : x;
  const seam = across % 6, grain = noise(Math.floor(along/6),Math.floor(across/6));
  if (seam===0) return wood[2];
  if (seam===1) return grain%4 ? wood[5] : wood[6];
  if (seam===5) return wood[3];
  return grain%8===0 && seam===3 ? wood[3] : wood[4];
}
function masonry(x:number,y:number, ramp=stone) {
  const row=Math.floor(y/5), offset=(row%2)*5, local=(x+offset)%10, seam=y%5;
  if (local===0 || seam===4) return ramp[1];
  if (seam===0 && local<8) return ramp[5];
  if (local===9 || seam===3) return ramp[2];
  return ramp[3 + noise(Math.floor((x+offset)/10),row)%2];
}
function wall(s:Sprite,x:number,y:number,w:number,h:number,texture:Ink) {
  s.box(x,y,w,h,wood[0]);s.box(x+2,y+2,w-4,h-4,texture);
}
function beam(s:Sprite,x1:number,y1:number,x2:number,y2:number) {
  s.line(x1-1,y1+1,x2-1,y2+1,wood[0]); s.line(x1,y1+1,x2,y2+1,wood[1]);
  s.line(x1,y1,x2,y2,wood[5]);s.line(x1+1,y1,x2+1,y2,wood[3]);
}
function windowPane(s:Sprite,x:number,y:number,w:number,h:number,shutters=false) {
  s.box(x-1,y-1,w+2,h+3,wood[0]);s.box(x,y,w,h,wood[6]);
  s.box(x+2,y+2,w-4,h-4,(px,py)=>{
    const diagonal=(px-x)+(py-y); return glass[diagonal%14<3?3:py-y<h/2?1:2];
  });
  const center=x+Math.floor(w/2);
  s.dot(x+3,y+3,glass[5]);
  s.line(x+3,y+6,x+6,y+3,glass[4]);
  s.box(center,y+2,1,h-4,wood[2]);s.box(x+2,y+Math.floor(h/2),w-4,1,wood[1]);
  s.box(x-2,y+h,w+4,2,wood[5]);
  if (shutters) for (const side of [x-5,x+w+1]) {
    s.box(side,y,4,h,green[1]);s.box(side+1,y+1,2,h-2,green[4]);
    for (let j=3;j<h-2;j+=4)s.box(side+1,y+j,2,1,green[2]);
  }
}
function door(s:Sprite,center:number,bottom:number,w=14) {
  const x=center-Math.floor(w/2),y=bottom-24;
  s.box(x-2,y-2,w+4,27,wood[1]);s.box(x-1,y-1,w+2,24,wood[6]);
  s.box(x,y,w,24,(px,py)=>planks(px,py,true));
  s.box(x+3,y+3,w-6,7,wood[1]);s.box(x+4,y+4,w-8,5,glass[1]);
  s.line(x+4,y+6,x+6,y+4,glass[4]);s.box(x+2,y+13,w-4,8,wood[3]);
  s.box(x+3,y+14,w-6,6,wood[4]);s.dot(x+w-3,y+13,cream);
  // Cast iron bracket and amber glass lantern next to the entrance.
  s.box(x-6,y+1,4,1,wood[1]);s.box(x-7,y+2,4,2,slate[1]);
  s.box(x-6,y+4,3,4,wood[1]);s.box(x-6,y+4,2,3,thatch[5]);s.dot(x-6,y+4,cream);
  s.box(x-7,y+7,4,1,slate[2]);
  s.box(x-4,bottom+1,w+8,3,stone[2]);s.box(x-3,bottom+1,w+6,1,stone[5]);
  s.box(x-6,bottom+4,w+12,3,stone[1]);s.box(x-5,bottom+4,w+10,1,stone[4]);
}
/** Every roof plane owns its lattice. Neighboring pitches catch light differently. */
function roof(s:Sprite,points:Point[],ramp:string[],slope=0,lit=true,cover=true) {
  ramp=s.roofTint??ramp;
  const minX=Math.min(...points.map(p=>p[0])), minY=Math.min(...points.map(p=>p[1]));
  s.shape(points,(x,y)=>{
    const v=Math.floor(y-minY+(x-minX)*slope+128), row=Math.floor(v/5), ry=v%5;
    const u=x-minX+(row%2)*4+64, col=Math.floor(u/9), rx=u%9, n=noise(col,row);
    if(s.winter && cover && (ry<2 || n%6!==0))return snow[ry===4||rx===8?0:ry===0||n%5===0?2:1];
    if(ry===4) return ramp[rx<2 && n%3===0 ? (lit?4:3) : (lit?2:1)];
    if(rx===8 || (ry===3 && rx===7)) return ramp[lit?3:2];
    if(ry===0 && rx<4+n%3) return ramp[lit?5:4];
    if((rx===1 || rx===2) && ry===1 && n%3===0)return ramp[lit?6:5];
    if(rx===5 && ry===2 && n%4===0)return ramp[lit?3:2];
    return ramp[(lit?4:3)+(n%6===0?1:0)];
  },ramp[0]);
}
function chimney(s:Sprite,x:number,top:number,w:number,h:number) {
  wall(s,x,top+2,w,h,(px,py)=>masonry(px,py,slate));
  s.box(x-2,top,w+4,4,slate[1]);s.box(x-1,top,w+2,2,s.winter?snow[1]:slate[5]);
  s.box(x+2,top+1,w-4,1,slate[0]);
}
function planter(s:Sprite,x:number,y:number,w:number,season:Season) {
  s.box(x,y,w,5,wood[1]);s.box(x+1,y+1,w-2,2,wood[5]);
  if(season==='winter'){s.box(x,y-1,w,2,snow[1]);return;}
  for(let i=1;i<w-1;i+=3){
    s.box(x+i,y-2-(i%2),2,3,green[3]);s.dot(x+i,y-2,green[6]);
    if(i%2)s.dot(x+i+1,y-3,season==='autumn'?thatch[5]:'#f1635c');
  }
}
function platform(s:Sprite,x:number,right:number,floor:number) {
  s.box(x,floor-5,right-x,7,wood[1]);s.box(x+1,floor-4,right-x-2,5,(px,py)=>planks(px,py,true));
  s.box(x-1,floor-6,right-x+2,3,wood[2]);s.box(x,floor-6,right-x,1,wood[6]);
}

function logHouse(s:Sprite,right:number,floor:number,entry:number,season:Season) {
  // Long log body with a covered veranda, red hipped roof and off-center attic.
  const eave=floor-39;
  chimney(s,right-20,eave-32,8,25);
  platform(s,8,right-2,floor);
  wall(s,12,eave-1,right-17,floor-eave-5,(x,y)=>{
    const ring=y%7;return ring===0?wood[1]:ring===1?wood[5]:ring===5?wood[3]:ring===6?wood[2]:wood[4+(noise(Math.floor(x/9),y)%7===0?1:0)];
  });
  for(const x of [12,right-12])for(let y=eave+2;y<floor-7;y+=7){s.box(x-2,y,8,5,wood[2]);s.box(x-1,y+1,6,3,wood[5]);s.box(x+1,y+2,3,1,wood[3]);}
  windowPane(s,24,eave+6,16,14);windowPane(s,right-24,eave+7,12,12);
  door(s,entry,floor-5);planter(s,21,eave+25,22,season);
  roof(s,[[4,eave],[20,eave-28],[right-18,eave-28],[right+2,eave]],clay);
  roof(s,[[right-18,eave-28],[right-7,eave-22],[right+4,eave-2],[right+2,eave]],clay,-.3,false);
  beam(s,4,eave+1,right+2,eave+1);
  const attic=32; s.shape([[attic-11,eave-11],[attic,eave-25],[attic+11,eave-11]],wood[5],wood[1]);
  windowPane(s,attic-4,eave-17,8,7);beam(s,attic-13,eave-10,attic,eave-26);beam(s,attic,eave-26,attic+12,eave-10);
  // Veranda stays open in front of the actual doorway.
  for(const x of [entry-16,right-9]){s.box(x,eave+14,3,floor-eave-20,wood[1]);s.box(x,eave+15,1,floor-eave-20,wood[5]);}
  roof(s,[[entry-16,eave+7],[right-8,eave+7],[right-2,eave+15],[entry-21,eave+15]],clay,0,false);
  s.line(entry-21,eave+16,right-2,eave+16,wood[1]);
}
function blueHouse(s:Sprite,right:number,floor:number,entry:number,season:Season) {
  // Tall front gable, an exposed pale timber frame and a lower lean-to.
  const eave=floor-35,peak=eave-42,left=entry-30,end=entry+27;
  platform(s,10,right-3,floor);
  wall(s,11,eave+4,left+5-11,floor-eave-10,(x,y)=>planks(x,y,true));
  roof(s,[[6,eave+8],[12,eave-9],[left+7,eave-14],[left+7,eave+8]],blue,-.15,false);
  windowPane(s,14,eave+13,9,12);
  const stucco=(x:number,y:number)=>{const n=noise(Math.floor(x/3),Math.floor(y/2));return n%11===0?'#cea686':n%6===0?'#dcb799':'#eabe9a';};
  wall(s,left,eave,end-left,floor-eave-5,stucco);
  s.shape([[left,eave+1],[entry,peak+7],[end,eave+1]],stucco,wood[2]);
  beam(s,entry-15,eave-1,entry-15,eave-14);beam(s,entry+14,eave-1,entry+14,eave-14);
  beam(s,entry-23,eave-1,entry-15,eave-10);beam(s,entry+14,eave-10,entry+22,eave-1);
  for(const x of [left+2,end-4])beam(s,x,eave+1,x,floor-6);
  beam(s,left,eave,end-1,eave);beam(s,left+2,eave+2,entry-3,eave+20);
  beam(s,entry+3,eave+20,end-3,eave+2);
  windowPane(s,entry-5,eave-17,10,13);windowPane(s,end-14,eave+10,10,13,true);
  door(s,entry,floor-5);planter(s,left+1,floor-9,14,season);
  chimney(s,end+1,peak+3,8,24);
  roof(s,[[entry,peak],[entry+12,peak-5],[end+14,eave-11],[end+3,eave+4]],blue,-.65);
  roof(s,[[left-4,eave+4],[left-10,eave-2],[entry-3,peak-4],[entry+12,peak-5],[entry,peak]],blue,.55,false);
  beam(s,left-4,eave+3,entry,peak);beam(s,entry,peak,end+3,eave+3);
  beam(s,entry,peak+9,entry,eave-19);
  s.box(left+6,floor-21,5,14,blue[1]);s.box(left+7,floor-20,3,12,blue[4]);
}
function stoneHouse(s:Sprite,right:number,floor:number,entry:number,season:Season) {
  // A rounded thatch bonnet and a full-height rubble chimney down one end wall.
  const eave=floor-37;
  wall(s,9,eave-2,right-14,floor-eave+3,(x,y)=>masonry(x,y));
  s.box(8,floor-4,right-12,5,stone[1]);s.box(9,floor-4,right-14,2,stone[4]);
  windowPane(s,29,eave+10,14,16,true);windowPane(s,right-24,eave+12,12,13,true);
  door(s,entry,floor-4);
  const points:Point[]=[[4,eave+2],[7,eave-10],[18,eave-24],[29,eave-28],[right-25,eave-26],[right-13,eave-21],[right-4,eave-10],[right+2,eave+2],[right-8,eave+5],[entry+8,eave+2],[entry-7,eave+4],[24,eave+3],[12,eave+5]];
  s.shape(points,(x,y)=>{
    const strand=Math.floor((x+y*.24)/3),length=noise(strand,4)%6;
    if(s.winter && y<eave-3+length)return snow[y>eave-9?0:length<3?1:2];
    if(y>eave-3+length)return thatch[2];
    return thatch[3+(noise(strand,Math.floor((y+length)/7))%3)];
  },thatch[0]);
  for(let x=17;x<right-15;x+=5)s.line(x,eave+2,x+3,eave-8-noise(x,6)%4,thatch[2]);
  chimney(s,13,eave-35,10,45);
  s.shape([[12,eave+3],[24,eave+3],[26,floor-15],[30,floor-9],[30,floor-2],[7,floor-2],[7,floor-10],[11,floor-16]],(x,y)=>masonry(x,y,slate),slate[1]);
  for(const x of [entry-11,entry+10]){
    const vine=season==='winter'?wood[4]:green[4];s.line(x,eave+7,x-1,floor-10,vine);
    if(season!=='winter')for(let y=eave+8;y<floor-10;y+=5){s.box(x-3,y,3,2,green[5]);s.box(x,y+2,3,2,green[3]);s.dot(x-1,y-1,'#bc4147');}
  }
  planter(s,right-27,floor-7,17,season);
}
function lodge(s:Sprite,right:number,floor:number,entry:number,season:Season) {
  const eave=floor-47, peak=eave-34;
  // Two wings flank a taller central entrance with an open timber lantern.
  platform(s,7,right-2,floor);
  wall(s,9,eave,right-14,floor-eave-5,(x,y)=>planks(x,y));
  roof(s,[[1,eave+4],[16,peak+7],[right-15,peak+7],[right+4,eave+4]],green);
  beam(s,2,eave+4,right+4,eave+4);
  for(const x of [15,32,right-40,right-23])windowPane(s,x,eave+12,12,17);
  planter(s,12,eave+32,35,season);planter(s,right-42,eave+32,34,season);
  const porch=25;
  wall(s,entry-porch,eave-4,porch*2,floor-eave, '#cea686');
  s.shape([[entry-porch-1,eave+1],[entry,peak-3],[entry+porch+1,eave+1]],(x,y)=>planks(x,y,true),wood[0]);
  roof(s,[[entry,peak-7],[entry+9,peak-12],[entry+porch+10,eave-6],[entry+porch+4,eave+2]],green,-.35,false);
  beam(s,entry-porch-4,eave+2,entry,peak-7);beam(s,entry,peak-7,entry+porch+4,eave+2);
  const clockY=eave-14;
  s.shape([[entry-5,clockY-7],[entry+4,clockY-7],[entry+7,clockY-4],[entry+7,clockY+4],[entry+4,clockY+7],[entry-4,clockY+7],[entry-7,clockY+4],[entry-7,clockY-4]],cream,wood[1]);
  s.line(entry,clockY-4,entry,clockY,wood[2]);s.line(entry,clockY,entry+3,clockY+1,wood[2]);
  for(const x of [entry-porch+2,entry+porch-5]){s.box(x,eave,4,floor-eave-7,wood[2]);s.box(x,eave,2,floor-eave-7,wood[5]);}
  door(s,entry,floor-6,21);
  s.box(entry-12,eave+6,25,9,wood[1]);s.box(entry-11,eave+7,23,6,wood[5]);
  s.shape([[entry-5,eave+11],[entry-1,eave+8],[entry+5,eave+9],[entry+1,eave+12]],green[2]);
}
function workshop(s:Sprite,right:number,floor:number,entry:number) {
  const eave=floor-40;
  // Deep open work bay, stepped metal roofs, a chimney stack and stacked logs.
  wall(s,9,eave,right-14,floor-eave+1,(x,y)=>masonry(x,y));
  const left=entry-15,end=entry+15;
  s.box(left,eave+3,end-left,floor-eave-4,wood[0]);s.box(left+3,eave+6,end-left-6,floor-eave-9,wood[1]);
  for(let x=left+5;x<end-4;x+=5)s.box(x,eave+9,1,12,wood[2]);
  s.box(left-2,eave+3,4,floor-eave-2,wood[3]);s.box(end-1,eave+3,4,floor-eave-2,wood[3]);
  // The open workshop reveals a shaded back bench, a hanging chain and hand tools.
  s.box(left+3,floor-10,end-left-6,8,(x,y)=>((x+y)%7===0?slate[1]:wood[2]));
  s.box(left+4,floor-16,end-left-9,3,wood[4]);s.box(left+5,floor-16,end-left-11,1,wood[5]);
  s.box(left+6,floor-13,2,6,wood[3]);s.box(end-8,floor-13,2,6,wood[3]);
  for(let y=eave+10;y<floor-22;y+=3){s.box(left+7,y,2,2,slate[3]);s.dot(left+7,y,slate[5]);}
  const pegX=left+13,pegY=eave+14;s.box(pegX,pegY,11,2,wood[4]);
  s.box(pegX+1,pegY+1,1,8,slate[4]);s.box(pegX,pegY+8,3,2,slate[3]);
  s.line(pegX+6,pegY+1,pegX+8,pegY+8,wood[5]);s.box(pegX+6,pegY+8,6,2,slate[5]);
  s.box(left-3,floor-1,end-left+6,3,slate[4]);s.box(left-5,floor+2,end-left+10,3,slate[3]);
  roof(s,[[3,eave+1],[9,eave-20],[left+6,eave-30],[left+6,eave+1]],slate,.15);
  roof(s,[[left-1,eave+4],[left+7,eave-12],[right-6,eave-22],[right+2,eave+4]],slate,.20,false);
  beam(s,3,eave+2,left+6,eave+2);beam(s,left,eave+5,right+2,eave+5);
  chimney(s,17,eave-37,13,25);s.box(16,eave-29,15,2,stone[1]);
  for(const top of [eave-31,eave-22]){s.box(17,top,13,1,slate[1]);s.dot(19,top,slate[5]);s.dot(27,top,slate[5]);}
  // Small clerestory windows under the uphill edge of the sawtooth roof.
  s.shape([[13,eave-18],[left+5,eave-28],[left+5,eave-20],[13,eave-10]],(x,y)=>x%6===0?slate[1]:x%6===1?glass[2]:(x+y)%5===0?glass[3]:glass[1],slate[1]);
  s.box(right-27,eave+12,17,14,wood[1]);s.box(right-25,eave+14,13,10,slate[1]);
  for(let x=right-22;x<right-12;x+=4)s.box(x,eave+13,1,12,slate[4]);
  for(let i=0;i<3;i++){
    const x=9+i*6, y=floor-5-(i===1?7:0);
    s.box(x,y-4,13,6,wood[1]);s.box(x+1,y-4,11,2,wood[4]);s.box(x+10,y-3,4,4,wood[5]);s.dot(x+12,y-2,wood[2]);
  }
  const bench=right-30;
  s.box(bench,floor-8,25,4,wood[1]);s.box(bench,floor-9,25,2,wood[5]);s.box(bench+3,floor-5,3,7,wood[2]);s.box(bench+20,floor-5,3,7,wood[2]);
  s.shape([[bench+3,floor-16],[bench+20,floor-16],[bench+18,floor-12],[bench+14,floor-11],[bench+14,floor-9],[bench+7,floor-9],[bench+9,floor-13]],slate[3],slate[0]);
  s.line(bench+4,floor-16,bench+19,floor-16,slate[6]);
}
function barn(s:Sprite,right:number,floor:number,entry:number) {
  const eave=floor-32;
  const frame:Point[]=[[9,floor],[9,eave],[18,eave-23],[entry-10,eave-37],[entry+13,eave-37],[right-14,eave-23],[right-5,eave],[right-5,floor]];
  s.shape(frame,(x,y)=>x%5===0?clay[2]:x%5===1?clay[5]:clay[3],wood[1]);
  s.shape([[9,eave],[18,eave-23],[entry-10,eave-37],[entry+13,eave-37],[right-14,eave-23],[right-5,eave],[right-12,eave],[right-20,eave-20],[entry+9,eave-30],[entry-8,eave-30],[25,eave-19],[16,eave]],s.winter?snow[1]:slate[4],slate[1]);
  windowPane(s,entry-5,eave-21,10,12);
  s.box(entry-18,eave+1,36,31,wood[1]);s.box(entry-16,eave+3,32,27,(x,y)=>planks(x,y,true));
  beam(s,entry,eave+3,entry,floor-1);beam(s,entry-16,eave+3,entry-1,floor-2);beam(s,entry+16,eave+3,entry+1,floor-2);
  s.box(entry-20,floor,40,3,stone[3]);s.box(15,eave+5,13,12,wood[2]);s.box(17,eave+6,9,10,wood[1]);
}
function greenhouse(s:Sprite,right:number,floor:number,entry:number) {
  const eave=floor-34,peak=eave-34;
  wall(s,7,eave,right-10,floor-eave,(x,y)=>masonry(x,y));
  const left=9,far=right-6;
  s.shape([[left,eave+3],[left+9,peak+9],[entry,peak],[far-7,peak+9],[far,eave+3],[far,floor-8],[left,floor-8]],(x,y)=>{
    const streak=(x+y)%17;return streak<3?glass[4]:streak===4?glass[3]:y<eave?glass[2]:green[4];
  },green[0]);
  for(let x=left+7;x<far;x+=12){s.line(x,eave,x,floor-8,green[1]);s.line(x+1,eave,x+1,floor-8,glass[4]);}
  for(let y=eave+1;y<floor-8;y+=13)s.line(left,y,far,y,green[1]);
  for(let x=left;x<=far;x+=14){const topX=entry+Math.round((x-entry)*.76);s.line(x,eave,topX,peak+Math.round(Math.abs(topX-entry)*.23),green[1]);}
  s.line(left,eave-1,far,eave-1,s.winter?snow[1]:glass[5]);door(s,entry,floor-3);
}
function streetBuilding(s:Sprite,b:Building,right:number,floor:number,entry:number,season:Season) {
  const eave=floor-39, school=b.kind==='school',clinic=b.kind==='clinic';
  const roofColor=school?clay:clinic?green:blue;
  wall(s,8,eave,right-11,floor-eave,(x,y)=>school?planks(x,y):y%7===0?stone[5]:cream);
  for(const x of [14,right-28])windowPane(s,x,eave+8,16,18);
  door(s,entry,floor-4);
  if(school){
    const peak=eave-30;
    roof(s,[[1,eave+2],[18,peak+9],[right-13,peak+9],[right+3,eave+2]],roofColor);
    wall(s,entry-9,peak-4,18,20,wood[4]);s.box(entry-5,peak,10,11,wood[0]);
    s.shape([[entry-3,peak+3],[entry+2,peak+3],[entry+4,peak+9],[entry-5,peak+9]],thatch[5],thatch[1]);
    roof(s,[[entry-13,peak-4],[entry,peak-14],[entry+13,peak-4]],roofColor);beam(s,1,eave+2,right+3,eave+2);
  } else if(clinic){
    roof(s,[[3,eave+2],[10,eave-16],[entry-14,eave-20],[entry-9,eave+2]],roofColor);
    roof(s,[[entry-13,eave+2],[entry-6,eave-28],[right-12,eave-28],[right+3,eave+2]],roofColor);
    s.box(entry-7,eave+3,14,10,wood[1]);s.box(entry-6,eave+4,12,8,cream);
    s.shape([[entry-4,eave+9],[entry-1,eave+5],[entry+4,eave+5],[entry+2,eave+9]],green[4]);
    planter(s,12,floor-7,22,season);
  } else {
    roof(s,[[4,eave-4],[9,eave-22],[right-9,eave-22],[right+3,eave-4]],roofColor,0,false);
    s.box(7,eave-6,right-11,6,wood[3]);s.box(8,eave-6,right-13,2,wood[5]);
    const canopy:Point[]=[[11,eave+2],[right-8,eave+2],[right-2,eave+15],[5,eave+15]];
    s.shape(canopy,(x,y)=>Math.floor((x+y*.2)/7)%2===0?cream:clay[5],wood[1]);
    for(let x=6;x<right;x+=7)s.box(x,eave+15,6,3,Math.floor((x-6)/7)%2?clay[3]:stone[5]);
    for(const x of [10,right-8])beam(s,x,eave+18,x,floor-2);
  }
}
function homeStyle(id:string) {
  const seedHomes:Record<string,number>={'home-lin':0,'home-qiao':1,'home-shen':2};
  if(id in seedHomes)return seedHomes[id];
  let hash=0;for(const c of id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
  return hash%3;
}
export function buildingExterior(building:Building,season:Season,art?:unknown) {
  const width=building.width*16,height=building.height*16;
  const s=new Sprite(width+12,height+16,season==='winter',validBuildingArt(art)&&art.roof?{wood,clay,blue,thatch,green,slate}[art.roof]:undefined);
  const right=width+4,floor=height+4;
  // Scene anchors the image four pixels northwest of the registered footprint.
  const entry=(building.door.x-building.at.x)*16+12;
  switch(building.kind){
    case 'home': [logHouse,blueHouse,stoneHouse][homeStyle(building.id)](s,right,floor,entry,season);break;
    case 'lodge': lodge(s,right,floor,entry,season);break;
    case 'workshop': workshop(s,right,floor,entry);break;
    case 'greenhouse': greenhouse(s,right,floor,entry);break;
    case 'barn': barn(s,right,floor,entry);break;
    default: streetBuilding(s,building,right,floor,entry,season);
  }
  return s.finish();
}

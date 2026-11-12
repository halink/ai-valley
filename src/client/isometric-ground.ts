/** Transitional, code-native storybook ground. Pure presentation, never world facts. */
import type {World,Season,Vec} from '../shared/types.js';
import {projectIsometric,type Footprint} from './isometric-projection.js';
export interface GroundShape {color:string;points:Vec[];}
export interface GroundPlan {base:GroundShape[];banks:GroundShape[];details:GroundShape[];tiles:number;}
const seasons:Record<Season,{grass:string;water:string;path:string}>={
 spring:{grass:'#b0b88b',water:'#71999a',path:'#d9c7a6'},
 summer:{grass:'#9fa97e',water:'#6b9294',path:'#d7c4a1'},
 autumn:{grass:'#b6ae83',water:'#789294',path:'#d6bd98'},
 winter:{grass:'#d8dcd2',water:'#8ca7a8',path:'#c9c4b5'},
};
const hash=(x:number,y:number,seed:number)=>(Math.imul(x+37,374761393)^Math.imul(y+113,668265263)^seed)>>>0;
const mix=(a:Vec,b:Vec,t:number):Vec=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
/** Every bank stays inside an existing water cell. Missing neighbors are not coastlines. */
export function planIsometricGround(w:World,b:Footprint,season:Season):GroundPlan {
 if(![b.x,b.y,b.width,b.height].every(Number.isInteger)||b.width<0||b.height<0||b.width>40||b.height>40)throw new Error('ground_bounds');
 const out:GroundPlan={base:[],banks:[],details:[],tiles:0},p=seasons[season];
 const tile=(x:number,y:number)=>x>=0&&y>=0&&x<w.map.width&&y<w.map.height?w.map.tiles[y*w.map.width+x]:undefined;
 for(let y=Math.max(0,b.y);y<Math.min(w.map.height,b.y+b.height);y++)for(let x=Math.max(0,b.x);x<Math.min(w.map.width,b.x+b.width);x++){
  const kind=tile(x,y);if(!kind)continue;
  const points=[{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}].map(v=>projectIsometric(v));
  const center=projectIsometric({x:x+.5,y:y+.5});
  const color=kind==='water'?p.water:kind==='path'?p.path:kind==='soil'?'#9d8060':kind==='sand'?'#dfcdaa':kind==='cliff'?'#98988c':kind==='road'?'#b6aea0':kind==='bridge'?'#80624c':p.grass;
  out.base.push({color,points});out.tiles++;
  if(kind==='water'){
   for(const [dx,dy,a,z] of [[0,-1,0,1],[1,0,1,2],[0,1,2,3],[-1,0,3,0]]){
    const neighbor=tile(x+dx,y+dy);if(!neighbor||neighbor==='water'||neighbor==='bridge')continue;
    const first=points[a],last=points[z],mid=mix(first,last,.5),inset=.15+(hash(x+dx,y+dy,w.seed)%4)*.025;
    out.banks.push({color:'#b6aea0',points:[first,last,mix(last,center,.08),mix(mid,center,inset),mix(first,center,.08)]});
    const inner=mix(mid,center,inset+.08);
    out.details.push({color:'#a6bcaf',points:[mix(first,center,.16),mix(last,center,.16),inner]});
   }
   // Sparse still brush marks, not animated current, fish, or water depth claims.
   if(hash(x,y,w.seed)%7===0)out.details.push({color:'#9bb5ae',points:[{x:center.x-3,y:center.y},{x:center.x+3,y:center.y-.4},{x:center.x+2,y:center.y+.4},{x:center.x-2,y:center.y+.6}]});
  }
  if(kind==='bridge'){
   for(const t of [.25,.5,.75])out.details.push({color:'#a38c70',points:[mix(points[0],points[1],t),mix(points[3],points[2],t),mix(points[3],points[2],t+.025),mix(points[0],points[1],t+.025)]});
  }
 }
 return out;
}
/** Batched same-color paths avoid anti-aliased seams between neighboring ground tiles.
 * The caller supplies the actual camera transform; geometry is never rounded to pixels. */
export function paintIsometricGround(ctx:CanvasRenderingContext2D,plan:GroundPlan,darkness:number){
 const dim=Math.max(0,Math.min(1,Number.isFinite(darkness)?darkness:0));
 for(const layer of [plan.base,plan.banks,plan.details]){
  const batches=new Map<string,GroundShape[]>();for(const shape of layer){const batch=batches.get(shape.color)??[];batch.push(shape);batches.set(shape.color,batch);}
  for(const [color,shapes] of batches){const n=parseInt(color.slice(1),16);ctx.fillStyle='#'+[16,8,0].map(shift=>Math.round((n>>shift&255)*(1-dim)).toString(16).padStart(2,'0')).join('');ctx.beginPath();
   for(const shape of shapes){ctx.moveTo(shape.points[0].x,shape.points[0].y);for(const p of shape.points.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();}ctx.fill();
  }
 }
}

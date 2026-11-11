import type {Vec,World} from './types.js';
import {pastureFenceBlocks} from './pasture-fence.js';
const same=(a:Vec,b:Vec)=>a.x===b.x&&a.y===b.y;
/** A fence is an edge, not an occupied grass cell. Its one gate is always usable for rescue. */
export function pastureEdgeOpen(w:World,from:Vec,to:Vec):boolean {
 for(const p of w.industry?.pastures??[]){
  if(!pastureFenceBlocks(p)||!p.gate)continue;
  const a=p.tiles.some(t=>same(t,from)),b=p.tiles.some(t=>same(t,to));
  if(a!==b&&!(same(from,p.gate.inside)&&same(to,p.gate.outside)||same(to,p.gate.inside)&&same(from,p.gate.outside)))return false;
 }
 for(const p of w.industry?.pastureProjects??[]){
  if(!p.fenceBuilt||['completed','removed'].includes(p.status))continue;
  const inside=(t:Vec)=>t.x>=p.at.x&&t.x<p.at.x+p.width&&t.y>=p.at.y&&t.y<p.at.y+p.height;
  const gate={x:p.door.x,y:p.door.y-1};
  if(inside(from)!==inside(to)&&!(same(from,gate)&&same(to,p.door)||same(to,gate)&&same(from,p.door)))return false;
 }
 return true;
}
/** Compile once per graph search rather than scanning every paddock for every grid edge. */
export function pastureEdgeChecker(w:World):(from:Vec,to:Vec)=>boolean {
 const cells=new Map<number,number>(),gates=new Map<number,{inside:number;outside:number}>();let serial=0;
 const index=(p:Vec)=>p.y*w.map.width+p.x;
 const add=(tiles:Vec[],inside:Vec,outside:Vec)=>{const id=++serial;for(const t of tiles)cells.set(index(t),id);gates.set(id,{inside:index(inside),outside:index(outside)});};
 for(const p of w.industry?.pastures??[])if(pastureFenceBlocks(p)&&p.gate)add(p.tiles,p.gate.inside,p.gate.outside);
 for(const p of w.industry?.pastureProjects??[])if(p.fenceBuilt&&!['completed','removed'].includes(p.status))add(Array.from({length:p.width*p.height},(_,i)=>({x:p.at.x+i%p.width,y:p.at.y+Math.floor(i/p.width)})),{x:p.door.x,y:p.door.y-1},p.door);
 if(!serial)return ()=>true;
 return (from,to)=>{const a=index(from),b=index(to),left=cells.get(a),right=cells.get(b);if(left===right)return true;
  for(const id of [left,right])if(id!==undefined){const gate=gates.get(id)!;if(!(gate.inside===a&&gate.outside===b||gate.inside===b&&gate.outside===a))return false;}return true;};
}

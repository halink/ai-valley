import type {Vec} from '../shared/types.js';

/** A fixed 2:1 diamond. Map coordinates describe tile corners, not sprite centres. */
export const ISOMETRIC_TILE = {width:32,height:16} as const;
export interface IsometricCamera {origin:Vec;zoom:number;}
export interface Footprint {x:number;y:number;width:number;height:number;}
export function projectIsometric(at:Vec,elevation=0):Vec {
 return {x:(at.x-at.y)*16,y:(at.x+at.y)*8-elevation};
}
export function unprojectIsometric(point:Vec):Vec {
 return {x:point.x/32+point.y/16,y:point.y/16-point.x/32};
}
export function screenToIsometric(point:Vec,camera:IsometricCamera):Vec|null {
 if(![point.x,point.y,camera.origin.x,camera.origin.y,camera.zoom].every(Number.isFinite)||camera.zoom<=0)return null;
 return unprojectIsometric({x:(point.x-camera.origin.x)/camera.zoom,y:(point.y-camera.origin.y)/camera.zoom});
}
/** Remove only a few ULPs of cancellation error at exact grid/pixel edges.
 * Genuine sub-cell offsets are retained; this is not a configurable hit slop. */
export function stableCoordinateFloor(value:number,operationMagnitude=Math.abs(value)):number {
 const edge=Math.round(value),tolerance=Number.EPSILON*Math.max(1,Math.abs(value),operationMagnitude)*8;
 return Math.floor(Math.abs(value-edge)<=tolerance?edge:value);
}
export function pickIsometricTile(point:Vec,camera:IsometricCamera,bounds:Footprint):Vec|null {
 const at=screenToIsometric(point,camera);
 if(!at)return null;
 const magnitude=(Math.abs(point.x)+Math.abs(camera.origin.x))/(camera.zoom*32)+(Math.abs(point.y)+Math.abs(camera.origin.y))/(camera.zoom*16);
 const tile={x:stableCoordinateFloor(at.x,magnitude),y:stableCoordinateFloor(at.y,magnitude)};
 return tile.x>=bounds.x&&tile.y>=bounds.y&&tile.x<bounds.x+bounds.width&&tile.y<bounds.y+bounds.height?tile:null;
}
export function projectedFacing(offset:Vec):'north'|'east'|'south'|'west' {
 const p=projectIsometric(offset);
 return Math.abs(p.x)>Math.abs(p.y)?p.x<0?'west':'east':p.y<0?'north':'south';
}
export interface DepthItem {key:string;footprint:Footprint;}
/** Separated footprints establish occlusion, including the sides of multi-tile houses.
 * Diagonally disjoint or overlapping footprints use a stable foot-depth fallback.
 * This study does not promise a solution for interpenetrating/cyclic architecture. */
export function orderIsometricObjects<T extends DepthItem>(input:readonly T[]):T[] {
 const depth=(v:T)=>v.footprint.x+v.footprint.y+(v.footprint.width+v.footprint.height)/2;
 const stable=(a:T,b:T)=>depth(a)-depth(b)||a.footprint.x-b.footprint.x||(a.key<b.key?-1:a.key>b.key?1:0);
 const remaining=[...input].sort(stable),result:T[]=[],edges=new Map<T,Set<T>>(remaining.map(v=>[v,new Set()]));
 const before=(a:Footprint,b:Footprint)=>a.x+a.width<=b.x||a.y+a.height<=b.y;
 for(let i=0;i<remaining.length;i++)for(let j=i+1;j<remaining.length;j++){
  const a=remaining[i],b=remaining[j],ab=before(a.footprint,b.footprint),ba=before(b.footprint,a.footprint);
  if(ab&&!ba)edges.get(b)!.add(a);else if(ba&&!ab)edges.get(a)!.add(b);
 }
 while(remaining.length){const index=remaining.findIndex(v=>!edges.get(v)!.size),next=remaining.splice(index<0?0:index,1)[0];result.push(next);for(const incoming of edges.values())incoming.delete(next);}
 return result;
}

/** Pure, opt-in geometry for untrimmed 2:1 storybook textures. No scene or world writes. */
import type {Building,Vec} from '../shared/types.js';
import type {StorybookAsset} from './storybook-assets.js';
import {stableCoordinateFloor} from './isometric-projection.js';

export const STORYBOOK_TILE=Object.freeze({width:32,height:16} as const);
export type StorybookWorldDirection='north'|'east'|'south'|'west';
export type StorybookFacing='northeast'|'southeast'|'southwest'|'northwest';
const facings:Readonly<Record<StorybookWorldDirection,StorybookFacing>>=Object.freeze({north:'northeast',east:'southeast',south:'southwest',west:'northwest'});
export interface StorybookFootprint {x:number;y:number;width:number;height:number;}
export interface StorybookCamera {origin:Vec;zoom:number;}
export interface StorybookFrameGeometry {rect:{x:number;y:number;width:number;height:number};foot:Vec;}

function finite(point:Vec):boolean{return !!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);}
function checked(point:Vec):Vec {if(!finite(point))throw new Error('storybook_geometry_coordinate');return point;}
function validFootprint(f:StorybookFootprint):boolean {
 return !!f&&[f.x,f.y,f.width,f.height].every(Number.isFinite)&&f.width>0&&f.height>0&&Number.isFinite(f.x+f.width)&&Number.isFinite(f.y+f.height);
}
function contains(f:StorybookFootprint,p:Vec):boolean {return finite(p)&&p.x>=f.x&&p.y>=f.y&&p.x<=f.x+f.width&&p.y<=f.y+f.height;}
function checkFootprint(f:StorybookFootprint):void {if(!validFootprint(f))throw new Error('storybook_geometry_footprint');}

/** Map north is -y, east is +x. Never quantize projected vectors back to four screen axes. */
export function storybookFacing(direction:StorybookWorldDirection):StorybookFacing {
 if(!Object.hasOwn(facings,direction))throw new Error('storybook_geometry_direction');
 return facings[direction];
}
/** A stationary or non-cardinal offset carries no single confirmed four-way facing. */
export function storybookFacingFromOffset(offset:Vec):StorybookFacing|null {
 checked(offset);
 if(offset.x===0&&offset.y!==0)return storybookFacing(offset.y<0?'north':'south');
 if(offset.y===0&&offset.x!==0)return storybookFacing(offset.x<0?'west':'east');
 return null;
}
/** Coordinates are tile corners; elevation is a known pixel offset, not generated terrain. */
export function projectStorybook(at:Vec,elevation=0):Vec {
 checked(at);if(!Number.isFinite(elevation))throw new Error('storybook_geometry_elevation');
 return checked({x:(at.x-at.y)*16,y:(at.x+at.y)*8-elevation});
}
/** Inversion requires the same known elevation. A screen point alone cannot recover height. */
export function unprojectStorybook(point:Vec,elevation=0):Vec {
 checked(point);if(!Number.isFinite(elevation))throw new Error('storybook_geometry_elevation');
 const y=point.y+elevation;
 return checked({x:point.x/32+y/16,y:y/16-point.x/32});
}
export function screenToStorybook(point:Vec,camera:StorybookCamera,elevation=0):Vec|null {
 if(!finite(point)||!camera||!finite(camera.origin)||!Number.isFinite(camera.zoom)||camera.zoom<=0||!Number.isFinite(elevation))return null;
 const local={x:(point.x-camera.origin.x)/camera.zoom,y:(point.y-camera.origin.y)/camera.zoom};
 if(!finite(local))return null;
 try{return unprojectStorybook(local,elevation);}catch{return null;}
}
/** Half-open tile picking on the ground plane; tall artwork is not a new occupied cell. */
export function pickStorybookTile(point:Vec,camera:StorybookCamera,bounds:StorybookFootprint):Vec|null {
 checkFootprint(bounds);
 if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isInteger))throw new Error('storybook_geometry_tile_bounds');
 const at=screenToStorybook(point,camera);if(!at)return null;
 const magnitude=(Math.abs(point.x)+Math.abs(camera.origin.x))/(camera.zoom*32)+(Math.abs(point.y)+Math.abs(camera.origin.y))/(camera.zoom*16);
 if(!Number.isFinite(magnitude))return null;
 const tile={x:stableCoordinateFloor(at.x,magnitude),y:stableCoordinateFloor(at.y,magnitude)};
 return tile.x>=bounds.x&&tile.y>=bounds.y&&tile.x<bounds.x+bounds.width&&tile.y<bounds.y+bounds.height?tile:null;
}
/** Copy the authoritative building record. Art dimensions must never resize its occupancy. */
export function storybookBuildingFootprint(building:Pick<Building,'at'|'width'|'height'>):StorybookFootprint {
 checked(building.at);
 const result={x:building.at.x,y:building.at.y,width:building.width,height:building.height};checkFootprint(result);
 if(!Object.values(result).every(Number.isSafeInteger))throw new Error('storybook_geometry_building_footprint');
 return result;
}
/** Frame foot is in untrimmed source pixels; groundAnchor is local to the true footprint. */
export function placeStorybookFrame(footprint:StorybookFootprint,groundAnchor:Vec,frame:StorybookFrameGeometry):{worldFoot:Vec;position:Vec;origin:Vec;topLeft:Vec} {
 checkFootprint(footprint);
 if(!contains({x:0,y:0,width:footprint.width,height:footprint.height},groundAnchor))throw new Error('storybook_geometry_ground_anchor');
 if(!frame||!frame.rect||![frame.rect.x,frame.rect.y,frame.rect.width,frame.rect.height].every(Number.isSafeInteger)||frame.rect.x<0||frame.rect.y<0||frame.rect.width<=0||frame.rect.height<=0||!contains({x:0,y:0,width:frame.rect.width,height:frame.rect.height},frame.foot))throw new Error('storybook_geometry_frame');
 const worldFoot=checked({x:footprint.x+groundAnchor.x,y:footprint.y+groundAnchor.y}),position=projectStorybook(worldFoot);
 return {worldFoot,position,origin:{x:frame.foot.x/frame.rect.width,y:frame.foot.y/frame.rect.height},topLeft:checked({x:position.x-frame.foot.x,y:position.y-frame.foot.y})};
}
/** Use parsed metadata only after comparing it with the recorded footprint. Never rescale a world
 * building to fit an atlas entry or silently mirror a missing direction. */
export function placeStorybookAsset(footprint:StorybookFootprint,asset:StorybookAsset,facing:StorybookFacing|null=null):{frame:StorybookFrameGeometry;worldFoot:Vec;position:Vec;origin:Vec;topLeft:Vec} {
 checkFootprint(footprint);
 if(asset.footprint.width!==footprint.width||asset.footprint.height!==footprint.height)throw new Error('storybook_geometry_asset_footprint');
 if(asset.kind==='directional'&&(!facing||!Object.hasOwn(asset.frames,facing)))throw new Error('storybook_geometry_asset_facing');
 const frame=asset.kind==='static'?asset.frame:asset.frames[facing!];
 return {frame,...placeStorybookFrame(footprint,asset.groundAnchor,frame)};
}

export interface StorybookDepthItem {key:string;footprint:StorybookFootprint;worldFoot:Vec;}
export interface StorybookDepthOrder<T> {
 items:T[];
 /** Positive-area ground intersections need explicit art/placement review, not hidden depth magic. */
 overlaps:Array<readonly [string,string]>;
 /** Each forced fallback names its unresolved predecessors; not a claim to enumerate SCCs. */
 cycleBreaks:Array<{key:string;predecessors:string[]}>;
}
/** Back-to-front footprint constraints, then projected foot y/x and key. Assign index to setDepth.
 * O(n²), intended for a culled scene. Not a performance or arbitrary-architecture guarantee. */
export function orderStorybookObjects<T extends StorybookDepthItem>(input:readonly T[]):StorybookDepthOrder<T> {
 const seen=new Set<string>();
 for(const item of input){
  if(!item||typeof item.key!=='string'||!item.key||seen.has(item.key))throw new Error('storybook_geometry_depth_key');seen.add(item.key);
  checkFootprint(item.footprint);if(!contains(item.footprint,item.worldFoot))throw new Error('storybook_geometry_depth_foot');projectStorybook(item.worldFoot);
 }
 const compare=(a:T,b:T)=>{
  const pa=projectStorybook(a.worldFoot),pb=projectStorybook(b.worldFoot);
  return pa.y-pb.y||pa.x-pb.x||(a.key<b.key?-1:a.key>b.key?1:0);
 };
 const remaining=[...input].sort(compare),items:T[]=[],overlaps:StorybookDepthOrder<T>['overlaps']=[],cycleBreaks:StorybookDepthOrder<T>['cycleBreaks']=[];
 const incoming=new Map<T,Set<T>>(remaining.map(item=>[item,new Set()]));
 const before=(a:StorybookFootprint,b:StorybookFootprint)=>a.x+a.width<=b.x||a.y+a.height<=b.y;
 for(let i=0;i<remaining.length;i++)for(let j=i+1;j<remaining.length;j++){
  const a=remaining[i],b=remaining[j],af=a.footprint,bf=b.footprint,ab=before(af,bf),ba=before(bf,af);
  if(ab&&!ba)incoming.get(b)!.add(a);else if(ba&&!ab)incoming.get(a)!.add(b);
  if(af.x<bf.x+bf.width&&bf.x<af.x+af.width&&af.y<bf.y+bf.height&&bf.y<af.y+af.height)overlaps.push([a.key,b.key]);
 }
 while(remaining.length){
  let index=remaining.findIndex(item=>incoming.get(item)!.size===0);
  if(index<0){index=0;cycleBreaks.push({key:remaining[0].key,predecessors:[...incoming.get(remaining[0])!].sort(compare).map(item=>item.key)});}
  const next=remaining.splice(index,1)[0];items.push(next);for(const dependencies of incoming.values())dependencies.delete(next);
 }
 return {items,overlaps,cycleBreaks};
}

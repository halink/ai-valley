/** Bounded texture-placement prototype. It reads the accepted snapshot, never advances it.
 * Synthetic markers are coordinate diagnostics, not finished residents/buildings or animation. */
import type {Snapshot, Vec} from '../shared/types.js';
import type {ObserverSelection} from './observer-map.js';
import type {StorybookAsset, StorybookFrame, StorybookManifest} from './storybook-assets.js';
import {storybookPixelsPerUnit} from './storybook-assets.js';
import {orderStorybookObjects, pickStorybookTile, placeStorybookAsset, placeStorybookFrame, screenToStorybook, storybookBuildingFootprint, storybookFacingFromOffset, type StorybookCamera, type StorybookFacing, type StorybookFootprint} from './storybook-geometry.js';
import {stableCoordinateFloor} from './isometric-projection.js';
import {prepareIsometricResidents} from './isometric-residents.js';
import {residentActivity} from './resident-status.js';
import type {StorybookAnimationRecord} from './storybook-animation.js';
import {storybookFacing} from './storybook-geometry.js';

export const STORYBOOK_PROTOTYPE_NOTICE='合成贴图技术原型 · 非正式美术 · 仅显示同一快照，无动画或成果播放；室内与未覆盖对象请用原视图。';
export const STORYBOOK_PROTOTYPE_LIMITS=Object.freeze({cells:32,objects:192,residents:512,records:8192});
export interface StorybookPixelAtlas {manifest:StorybookManifest;width:number;height:number;pixels:Uint8ClampedArray;}
export interface StorybookDraw {
 key:string; assetId:string; frame:StorybookFrame; facing:StorybookFacing|null;
 position:Vec; origin:Vec; topLeft:Vec; scale:number; size:{width:number;height:number}; depth:number; layer:'ground'|'contact'|'body'|'roof'|'marker';
 selection:ObserverSelection; label:string; fallback:string|null;
}
export interface StorybookPlan {
 worldId:string; revision:number; minute:number; paused:boolean; bounds:StorybookFootprint;
 draws:StorybookDraw[]; notices:string[]; unknownResidents:Array<{id:string;reason:string}>;
 overlaps:Array<readonly [string,string]>; cycleBreaks:Array<{key:string;predecessors:string[]}>;
 omittedObjects:number;
}
interface ObjectRecord {key:string;footprint:StorybookFootprint;worldFoot:Vec;draws:StorybookDraw[];}
const inside=(p:Vec,b:StorybookFootprint)=>p.x>=b.x&&p.y>=b.y&&p.x<b.x+b.width&&p.y<b.y+b.height;
const intersect=(a:StorybookFootprint,b:StorybookFootprint)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const finitePoint=(p:Vec|null|undefined):p is Vec=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
function validateBounds(b:StorybookFootprint,width:number,height:number){
 if(!b||!Object.values(b).every(Number.isSafeInteger)||b.x<0||b.y<0||b.width<1||b.height<1||b.width>STORYBOOK_PROTOTYPE_LIMITS.cells||b.height>STORYBOOK_PROTOTYPE_LIMITS.cells||b.x+b.width>width||b.y+b.height>height)throw new Error('storybook_prototype_window');
}
/** Caller supplies a small explicit window, not a world-sized canvas. No camera changes to original view. */
export function buildStorybookPlan(snapshot:Snapshot,atlas:StorybookPixelAtlas,bounds:StorybookFootprint,roomId:string|null=null):StorybookPlan {
 return buildPlan(snapshot,atlas,bounds,roomId);
}
/** Animation evidence must be sampled from this exact accepted snapshot. The old static path
 * remains unchanged; animated positions and fallbacks are authoritative, not patched over it. */
export function buildStorybookAnimationPlan(snapshot:Snapshot,atlas:StorybookPixelAtlas,bounds:StorybookFootprint,sample:{worldId:string|null;revision:number;records:readonly StorybookAnimationRecord[]},roomId:string|null=null):StorybookPlan {
 if(sample.worldId!==snapshot.world.id||sample.revision!==snapshot.world.revision)throw new Error('storybook_animation_plan_snapshot');
 if(sample.records.some(r=>r.spaceId!==roomId))throw new Error('storybook_animation_plan_space');
 const records=new Map(sample.records.map(r=>[r.id,r]));
 if(records.size!==sample.records.length||records.size!==snapshot.world.residents.length||snapshot.world.residents.some(r=>!records.has(r.id)))throw new Error('storybook_animation_plan_residents');
 return buildPlan(snapshot,atlas,bounds,roomId,records);
}
function buildPlan(snapshot:Snapshot,atlas:StorybookPixelAtlas,bounds:StorybookFootprint,roomId:string|null,animation?:ReadonlyMap<string,StorybookAnimationRecord>):StorybookPlan {
 const w=snapshot.world;
 if(!w||!w.map||![w.map.width,w.map.height].every(n=>Number.isSafeInteger(n)&&n>0)||!Array.isArray(w.map.tiles)||w.map.tiles.length!==w.map.width*w.map.height||![w.minute,w.revision].every(Number.isFinite))throw new Error('storybook_prototype_snapshot');
 validateBounds(bounds,w.map.width,w.map.height);
 if(roomId)throw new Error('绘本室内贴图尚未提供；请保留原视图，不把室内居民挪到门口。');
 if(!Array.isArray(w.buildings)||!Array.isArray(w.residents)||w.buildings.length>STORYBOOK_PROTOTYPE_LIMITS.records||w.residents.length>STORYBOOK_PROTOTYPE_LIMITS.residents)throw new Error('storybook_prototype_record_limit');
 const assets=new Map(atlas.manifest.assets.map(a=>[a.id,a])),draws:StorybookDraw[]=[],objects:ObjectRecord[]=[],notices=new Set<string>();
 const pixelsPerUnit=storybookPixelsPerUnit(atlas.manifest);
 const unknownResidents:StorybookPlan['unknownResidents']=[];let omittedObjects=0;
 const make=(key:string,asset:StorybookAsset,footprint:StorybookFootprint,layer:StorybookDraw['layer'],selection:ObserverSelection,label:string,fallback:string|null=null,facing:StorybookFacing|null=null):StorybookDraw=>{
  const p=placeStorybookAsset(footprint,asset,facing,pixelsPerUnit);
  return {key,assetId:asset.id,frame:p.frame,facing,position:p.position,origin:p.origin,topLeft:p.topLeft,scale:p.scale,size:p.size,depth:0,layer,selection:selection?{...selection}:null,label,fallback};
 };
 const marker=(key:string,footprint:StorybookFootprint,foot:Vec,selection:ObserverSelection,label:string,reason:string):StorybookDraw|null=>{
  notices.add(reason);const asset=assets.get('marker');
  if(!asset||asset.kind!=='static'){notices.add('缺少位置标记贴图；没有绘制该对象，请使用原视图。');return null;}
  // A diagnostic marker does not claim the size of the missing building/body artwork.
  const p=placeStorybookFrame(footprint,{x:foot.x-footprint.x,y:foot.y-footprint.y},asset.frame,pixelsPerUnit);
  return {key,assetId:asset.id,frame:asset.frame,facing:null,position:p.position,origin:p.origin,topLeft:p.topLeft,scale:p.scale,size:p.size,depth:0,layer:'marker',selection:selection?{...selection}:null,label,fallback:reason};
 };
 for(let y=bounds.y;y<bounds.y+bounds.height;y++)for(let x=bounds.x;x<bounds.x+bounds.width;x++){
  const tile=w.map.tiles[y*w.map.width+x],asset=assets.get('terrain-'+tile);
  if(!asset||asset.kind!=='static'){notices.add(`地表 ${tile} 缺少贴图，保留空白，不替换为草地。`);continue;}
  draws.push(make(`tile:${x},${y}`,asset,{x,y,width:1,height:1},'ground',null,`真实地表 ${tile} (${x},${y})`));
 }
 const keys=new Set<string>();
 const add=(object:ObjectRecord)=>{if(keys.has(object.key))throw new Error('storybook_prototype_duplicate');keys.add(object.key);if(objects.length<STORYBOOK_PROTOTYPE_LIMITS.objects)objects.push(object);else omittedObjects++;};
 // Residents have admission priority over buildings when the bounded sample is crowded.
 for(const r of prepareIsometricResidents(w)){
  const animated=animation?.get(r.id);
  if(animated?.kind==='hidden'||!animated&&r.kind==='hidden')continue;
  const resident=w.residents.find(p=>p.id===r.id)!;
  const anchor=animated?animated.anchor:r.kind==='render'?r.anchor:r.kind==='fallback'?r.at:null;
  if(!anchor){unknownResidents.push({id:r.id,reason:animated?.reason??(r.kind==='fallback'?r.reason:'位置未知')});continue;}
  if(!inside(anchor,bounds))continue;
  const footprint={x:anchor.x,y:anchor.y,width:1,height:1},worldFoot={x:anchor.x+.5,y:anchor.y+.5};
  let activity:string;
  try{activity=residentActivity(w,resident).label;}catch{activity='活动记录不完整';}
  const label=`${resident.name} · ${activity}`,key='person:'+r.id,selection={kind:'person' as const,id:r.id};
  let draw:StorybookDraw|null=null;
  if(animated){
   if(animated.kind==='frame'&&animated.artwork&&animated.direction){
    const asset=assets.get(animated.artwork.assetId),facing=storybookFacing(animated.direction);
    if(!asset||asset.kind!=='directional'||JSON.stringify(asset.frames[facing])!==JSON.stringify(animated.artwork.frame))throw new Error('storybook_animation_plan_frame');
    draw=make(key,asset,footprint,'body',selection,label,'合成动作诊断片，不是人物外观；不表示劳动成果。'+(animated.reason??''),facing);
   }else draw=marker(key,footprint,worldFoot,selection,label,animated.reason??'此人物状态未覆盖，请使用原视图。');
  }else if(r.kind==='render'&&r.pose==='walk'){
   const next=resident.activity?.path[0];
   const facing=next?storybookFacingFromOffset({x:next.x-resident.at.x,y:next.y-resident.at.y}):null;
   const asset=assets.get('resident-route');
   if(asset?.kind==='directional'&&facing)draw=make(key,asset,footprint,'body',selection,label,'合成路线方向标记，不是人物外观或行走动画。',facing);
  }
  if(!draw&&!animated)draw=marker(key,footprint,worldFoot,selection,label,r.kind==='fallback'?r.reason:`人物${r.kind==='render'?(r.pose==='idle'?'静止朝向未知':r.pose+'姿态'):'未知姿态'}缺少绘本素材；只标示已确认脚点，不绘制待机替代。`);
  add({key,footprint,worldFoot,draws:draw?[draw]:[]});
 }
 const buildingIds=new Set<string>();
 for(const b of w.buildings){
  if(buildingIds.has(b.id))throw new Error('storybook_prototype_duplicate');buildingIds.add(b.id);
  const footprint=storybookBuildingFootprint(b);if(!intersect(footprint,bounds))continue;
  const key='building:'+b.id,selection={kind:'building' as const,id:b.id},worldFoot={x:b.at.x+b.width/2,y:b.at.y+b.height};
  const layers=(['contact','body','roof'] as const).map(layer=>({layer,asset:assets.get('lodge-'+layer)}));
  const supported=b.kind==='lodge'&&b.condition===100&&layers.every(({asset})=>asset?.kind==='static'&&asset.footprint.width===b.width&&asset.footprint.height===b.height&&asset.groundAnchor.x===b.width/2&&asset.groundAnchor.y===b.height);
  if(supported){
   add({key,footprint,worldFoot,draws:layers.map(({layer,asset})=>make(key+':'+layer,asset!,footprint,layer,selection,b.name,'合成共屋分层定位片，不是正式建筑美术。'))});
  }else{
   const draw=marker(key,footprint,worldFoot,selection,b.name,'此建筑类型、占地或状态缺少贴图；只标原占地锚点，不缩放或美化损坏建筑。');
   add({key,footprint,worldFoot,draws:draw?[draw]:[]});
  }
 }
 const ordered=orderStorybookObjects(objects);
 for(const draw of draws)draw.depth=-2;
 for(const [index,object] of ordered.items.entries())for(const [layerIndex,draw] of object.draws.entries()){
  draw.depth=draw.layer==='contact'?-1:index*4+layerIndex;draws.push(draw);
 }
 draws.sort((a,b)=>a.depth-b.depth||(a.key<b.key?-1:a.key>b.key?1:0));
 if(ordered.overlaps.length||ordered.cycleBreaks.length)notices.add('存在占地交叠或遮挡环，深度仅为稳定诊断顺序，未通过视觉遮挡验收。');
 if(omittedObjects)notices.add(`对象预算省略 ${omittedObjects} 项，请使用原视图。`);
 notices.add('本原型不绘制资源、作物、设施、动物、项目或物资；不以空白表示它们不存在。');
 return {worldId:w.id,revision:w.revision,minute:w.minute,paused:w.clock.paused,bounds:{...bounds},draws,notices:[...notices],unknownResidents,overlaps:ordered.overlaps,cycleBreaks:ordered.cycleBreaks,omittedObjects};
}
export interface StorybookPick {selection:ObserverSelection;tile:Vec|null;label:string;fallback:string|null;}
/** Frontmost nontransparent source pixel wins, after undoing camera AND artwork density.
 * Alpha is sampled from source pixels, not a filtered GPU readback or an enlarged hit box. */
export function pickStorybookPlan(plan:StorybookPlan,atlas:StorybookPixelAtlas,screen:Vec,camera:StorybookCamera):StorybookPick|null {
 if(!screenToStorybook(screen,camera))return null;
 // Go straight to logical pixels: an extra isometric inverse/project roundtrip loses
 // precision at source texel boundaries, especially with non-binary densities/zoom.
 const p={x:(screen.x-camera.origin.x)/camera.zoom,y:(screen.y-camera.origin.y)/camera.zoom},tile=pickStorybookTile(screen,camera,plan.bounds);
 for(let i=plan.draws.length-1;i>=0;i--){
  const d=plan.draws[i];if(!d.selection)continue;
  if(!Number.isFinite(d.scale)||d.scale<=0)continue;
  const sourceX=(p.x-d.topLeft.x)/d.scale,sourceY=(p.y-d.topLeft.y)/d.scale;
  const magnitudeX=((Math.abs(screen.x)+Math.abs(camera.origin.x))/camera.zoom+Math.abs(d.topLeft.x))/d.scale;
  const magnitudeY=((Math.abs(screen.y)+Math.abs(camera.origin.y))/camera.zoom+Math.abs(d.topLeft.y))/d.scale;
  if(![sourceX,sourceY,magnitudeX,magnitudeY].every(Number.isFinite))continue;
  const x=stableCoordinateFloor(sourceX,magnitudeX),y=stableCoordinateFloor(sourceY,magnitudeY),r=d.frame.rect;
  if(x<0||y<0||x>=r.width||y>=r.height)continue;
  if(!(atlas.pixels[((r.y+y)*atlas.width+r.x+x)*4+3]>0))continue;
  return {selection:{...d.selection},tile,label:d.label,fallback:d.fallback};
 }
 return tile?{selection:null,tile,label:`地图 (${tile.x},${tile.y})`,fallback:null}:null;
}
/** Center a small initial sample on an existing map cell, clamped without altering world data. */
export function storybookWindow(snapshot:Snapshot,center:Vec,size=24):StorybookFootprint {
 const map=snapshot.world.map;
 if(!finitePoint(center)||!Number.isSafeInteger(size)||size<1||size>STORYBOOK_PROTOTYPE_LIMITS.cells)throw new Error('storybook_prototype_window');
 const width=Math.min(size,map.width),height=Math.min(size,map.height);
 return {x:Math.max(0,Math.min(map.width-width,Math.floor(center.x-width/2))),y:Math.max(0,Math.min(map.height-height,Math.floor(center.y-height/2))),width,height};
}

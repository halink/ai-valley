/** Opt-in Phaser 3.90 adapter for a dedicated caller-owned scene. No game, loader or transport. */
import type Phaser from 'phaser';
import type {ObserverMap} from './observer-map.js';
import {projectStorybook} from './storybook-geometry.js';
import {createStorybookObserver,type StorybookObserverHandle,type StorybookSurface,type StorybookPickListener,type StorybookPointerEvidence} from './storybook-observer.js';
import {pickStorybookPlan,type StorybookPixelAtlas,type StorybookPlan} from './storybook-render-plan.js';
export interface StorybookViewport {x:number;y:number;width:number;height:number;}
const mounted=new WeakMap<Phaser.Scene,{observer:ObserverMap;kind:'static'|'animation';handle:StorybookObserverHandle}>();
let sequence=0;
function plainCamera(scene:Phaser.Scene):boolean {
 const c=scene.cameras.main;
 // Phaser 3.90 exposes the BaseCamera rotation getter but omits it from its .d.ts.
 const rotation:unknown=Reflect.get(c,'rotation');
 return scene.cameras.cameras.length===1&&scene.cameras.cameras[0]===c&&c.x===0&&c.y===0&&c.scrollX===0&&c.scrollY===0&&c.zoomX===1&&c.zoomY===1&&rotation===0;
}
/** Caller owns scene startup and canvas. This module owns only its texture, display objects,
 * subscriptions and input callbacks, all destroyed synchronously without affecting other scenes. */
export function mountStorybookPrototype(scene:Phaser.Scene,observer:ObserverMap,atlas:StorybookPixelAtlas,viewport:StorybookViewport):StorybookObserverHandle {
 return mountStorybookSurface(scene,observer,atlas,viewport,'static',(owned,surface)=>createStorybookObserver(observer,owned,surface));
}
/** Shared surface for explicit adapters. No default client imports either mount. */
export function mountStorybookSurface<T extends StorybookObserverHandle>(scene:Phaser.Scene,observer:ObserverMap,atlas:StorybookPixelAtlas,viewport:StorybookViewport,kind:'static'|'animation',create:(owned:StorybookPixelAtlas,surface:StorybookSurface)=>T):T {
 const previous=mounted.get(scene);
 if(previous){if(previous.observer!==observer||previous.kind!==kind)throw new Error('storybook_scene_already_owned');return previous.handle as T;}
 if(!plainCamera(scene))throw new Error('storybook_requires_single_untransformed_camera');
 if(viewport.x<0||viewport.y<0||![viewport.x,viewport.y,viewport.width,viewport.height].every(Number.isFinite)||viewport.width<320||viewport.height<240||viewport.width>4096||viewport.height>4096)throw new Error('storybook_prototype_viewport');
 if(atlas.width!==atlas.manifest.atlas.width||atlas.height!==atlas.manifest.atlas.height||atlas.width<1||atlas.height<1||atlas.width>2048||atlas.height>2048||atlas.pixels.length!==atlas.width*atlas.height*4)throw new Error('storybook_prototype_texture');
 // Freeze the installed pixel evidence: caller mutations must not desynchronize picking and GPU content.
 atlas={...atlas,pixels:new Uint8ClampedArray(atlas.pixels)};
 const region={...viewport},key='storybook-prototype-'+(++sequence),release:Array<()=>void>=[];
 let disposed=false,plan:StorybookPlan|null=null,transform={origin:{x:0,y:0},zoom:1};
 const picks=new Set<StorybookPickListener>();
 let acquiredController:StorybookObserverHandle|null=null;
 const clean=()=>{if(disposed)return;disposed=true;picks.clear();while(release.length){try{release.pop()!();}catch{/* Other owned objects must still be released. */}}mounted.delete(scene);};
 try{
  const canvas=document.createElement('canvas');canvas.width=atlas.width;canvas.height=atlas.height;
  const context=canvas.getContext('2d');if(!context)throw new Error('storybook_canvas_unavailable');
  const pixels=context.createImageData(atlas.width,atlas.height);pixels.data.set(atlas.pixels);context.putImageData(pixels,0,0);
  const texture=scene.textures.addCanvas(key,canvas);if(!texture)throw new Error('storybook_texture_unavailable');
  release.push(()=>scene.textures.remove(key));
  // Phaser.Textures.FilterMode.LINEAR = 0. Explicit v2 artwork uses local filtering;
  // legacy v1 and the shared Game's pixelArt/antialias/roundPixels settings stay untouched.
  if(atlas.manifest.schemaVersion===2)texture.setFilter(0);
  for(const asset of atlas.manifest.assets){
   const frames=asset.kind==='static'?[[asset.id,asset.frame] as const]:Object.entries(asset.frames).map(([direction,frame])=>[asset.id+':'+direction,frame] as const);
   for(const [name,frame] of frames){const r=frame.rect;if(!texture.add(name,0,r.x,r.y,r.width,r.height))throw new Error('storybook_frame_unavailable');}
  }
  const group=scene.add.container(0,0).setScrollFactor(0);release.push(()=>group.destroy(true));
  const notice=scene.add.text(region.x,region.y,'',{fontFamily:'sans-serif',fontSize:'13px',color:'#3e382f',backgroundColor:'#f4ecd9',wordWrap:{width:region.width}}).setScrollFactor(0).setDepth(10000);
  release.push(()=>notice.destroy());
  const hitNotice=scene.add.text(region.x,region.y+region.height-48,'',{fontFamily:'sans-serif',fontSize:'13px',color:'#3e382f',backgroundColor:'#f4ecd9',wordWrap:{width:region.width}}).setScrollFactor(0).setDepth(10001);
  release.push(()=>hitNotice.destroy());
  const images=new Map<string,{image:Phaser.GameObjects.Image;frame:string}>();
  release.push(()=>images.clear());
  const clearImages=()=>{images.clear();group.removeAll(true);};
  const draw=(next:StorybookPlan|null,text:string)=>{
   if(disposed)return;
   if(!plainCamera(scene)){plan=null;clearImages();hitNotice.setText('');notice.setText('绘本原型不支持此相机变换；请使用原视图。');throw new Error('storybook_camera_changed');}
   plan=next;hitNotice.setText('');notice.setText(text+(next?`\n素材/范围提示 ${next.notices.length} 项；未知位置 ${next.unknownResidents.length} 人；不支持内容请用原视图。`:''));
   if(!next){clearImages();return;}
   const all=next.draws;
   // Fit actual art extents, including tall roofs, rather than cropping by cell footprint alone.
   const corners=[projectStorybook({x:next.bounds.x,y:next.bounds.y}),projectStorybook({x:next.bounds.x+next.bounds.width,y:next.bounds.y+next.bounds.height})];
   const left=Math.min(...all.map(d=>d.topLeft.x),...corners.map(p=>p.x)),right=Math.max(...all.map(d=>d.topLeft.x+d.size.width),...corners.map(p=>p.x));
   const top=Math.min(...all.map(d=>d.topLeft.y),...corners.map(p=>p.y)),bottom=Math.max(...all.map(d=>d.topLeft.y+d.size.height),...corners.map(p=>p.y));
   // Full per-object and scope diagnostics remain available in handle.plan for the caller UI.
   const inset=8,footer=56,header=Math.min(region.height/2,Math.max(52,notice.height+8));
   const zoom=Math.min(3,(region.width-inset*2)/Math.max(1,right-left),(region.height-header-footer-inset*2)/Math.max(1,bottom-top));
   transform={zoom,origin:{x:region.x+(region.width-(right-left)*zoom)/2-left*zoom,y:region.y+header+(region.height-header-footer-(bottom-top)*zoom)/2-top*zoom}};
   group.setPosition(transform.origin.x,transform.origin.y).setScale(zoom);
   const keys=new Set(next.draws.map(d=>d.key));
   for(const [id,item] of images)if(!keys.has(id)){item.image.destroy();images.delete(id);}
   for(const d of next.draws){
    const name=d.assetId+(d.facing?':'+d.facing:'');
    let item=images.get(d.key);
    if(!item){const image=scene.add.image(d.position.x,d.position.y,key,name);group.add(image);item={image,frame:name};images.set(d.key,item);}
    else if(item.frame!==name){item.image.setTexture(key,name);item.frame=name;}
    item.image.setPosition(d.position.x,d.position.y).setOrigin(d.origin.x,d.origin.y).setScale(d.scale).setDepth(d.depth);
   }
   group.sort('depth');
  };
  const pointer=(p:Phaser.Input.Pointer)=>{
   if(disposed||!plainCamera(scene)||!plan||p.x<region.x||p.y<region.y||p.x>=region.x+region.width||p.y>=region.y+region.height)return;
   // Keep the event's camera snapshot through every consumer. Inverting here and
   // passing only `at` discards the screen-origin cancellation error needed by picking.
   const original:StorybookPointerEvidence=Object.freeze({screen:Object.freeze({x:p.x,y:p.y}),camera:Object.freeze({origin:Object.freeze({...transform.origin}),zoom:transform.zoom})});
   const at={x:(p.x-transform.origin.x)/transform.zoom,y:(p.y-transform.origin.y)/transform.zoom};
   const hit=pickStorybookPlan(plan,atlas,original.screen,original.camera);
   hitNotice.setText(hit?hit.label+(hit.tile?` · 地图 (${hit.tile.x},${hit.tile.y})`:'')+(hit.fallback?' · '+hit.fallback:''):'');
   for(const listener of picks)listener({...at},original);
  };
  scene.input.on('pointerup',pointer);release.push(()=>scene.input.off('pointerup',pointer));
  const surface:StorybookSurface={present:draw,subscribePick(listener){picks.add(listener);return ()=>{picks.delete(listener);};},dispose:clean};
  const controller=create(atlas,surface);acquiredController=controller;
  const handle=controller;
  const cameraChanged=()=>{if(!plainCamera(scene)){controller.deactivate();notice.setText('绘本原型不支持此相机变换；请使用原视图。');}};
  scene.events.on('preupdate',cameraChanged);release.push(()=>scene.events.off('preupdate',cameraChanged));
  const shutdown=()=>handle.dispose();
  scene.events.on('shutdown',shutdown);release.push(()=>scene.events.off('shutdown',shutdown));
  scene.events.on('destroy',shutdown);release.push(()=>scene.events.off('destroy',shutdown));
  mounted.set(scene,{observer,kind,handle});return handle;
 }catch(error){acquiredController?.dispose();clean();throw error;}
}

/** Optional, independently disposable observer. The ordinary client is the only transport owner. */
import type {Vec} from '../shared/types.js';
import type {ObserverMap} from './observer-map.js';
import type {StorybookCamera,StorybookFootprint} from './storybook-geometry.js';
import {buildStorybookPlan,pickStorybookPlan,storybookWindow,STORYBOOK_PROTOTYPE_NOTICE,type StorybookPixelAtlas,type StorybookPlan} from './storybook-render-plan.js';
/** Original pointer and camera evidence, before inverse transforms lose cancellation precision. */
export interface StorybookPointerEvidence {
 readonly screen:Readonly<Vec>;
 readonly camera:Readonly<{origin:Readonly<Vec>;zoom:number}>;
}
export type StorybookPickListener=(at:Vec,original?:StorybookPointerEvidence)=>void;
export interface StorybookSurface {
 present(plan:StorybookPlan|null,notice:string):void;
 /** First argument stays in projected 32×16 logical units for existing surfaces.
  * Transformed surfaces additionally supply immutable original screen/camera evidence. */
 subscribePick(listener:StorybookPickListener):()=>void;
 dispose():void;
}
export interface StorybookObserverHandle {
 activate():void;deactivate():void;dispose():void;setWindow(bounds:StorybookFootprint):void;
 readonly plan:StorybookPlan|null;
}
/** No base-view cover, follow resolver, timers or extra navigation ownership. Indoor views fall back.
 * A caller must mount a separate surface explicitly; neither main nor development entry imports this. */
export function createStorybookObserver(observer:ObserverMap,atlas:StorybookPixelAtlas,surface:StorybookSurface):StorybookObserverHandle {
 let active=false,disposed=false,connected=false,snapshot=observer.currentSnapshot(),room=observer.currentRoom();
 let plan:StorybookPlan|null=null,bounds:StorybookFootprint|null=null,worldId=snapshot?.world.id;
 const cleanup:Array<()=>void>=[];
 const present=(next:StorybookPlan|null,notice:string)=>{
  try{surface.present(next,notice);}catch{
   plan=null;active=false;
   try{surface.present(null,'绘本原型绘制失败；请使用原视图。');}catch{/* A broken optional surface must not interrupt the original observer feed. */}
  }
 };
 const render=()=>{
  if(disposed)return;
  if(!active){plan=null;present(null,STORYBOOK_PROTOTYPE_NOTICE+' 未启用。');return;}
  if(!snapshot){plan=null;present(null,'等待现有观察入口的快照；原视图保持可用。');return;}
  try{
   const next=buildStorybookPlan(snapshot,atlas,bounds??storybookWindow(snapshot,observer.currentTile()),room);
   plan=next;
   present(next,STORYBOOK_PROTOTYPE_NOTICE+(connected?'':' 连接已断开，显示最后快照。')+(next.paused?' 世界停表。':'')+` 世界分钟 ${next.minute}；版本 ${next.revision}。`);
  }catch(error){plan=null;present(null,`绘本原型不可用：${error instanceof Error?error.message:'快照或素材不受支持'} 请使用原视图。`);}
 };
 const release=()=>{while(cleanup.length){try{cleanup.pop()!();}catch{/* Continue releasing independent resources. */}}};
 const handle:StorybookObserverHandle={
  activate(){if(disposed)return;active=true;render();},
  deactivate(){if(disposed)return;active=false;render();},
  dispose(){if(disposed)return;disposed=true;active=false;plan=null;release();},
  setWindow(value){if(disposed)return;bounds={...value};render();},
  get plan(){return plan;},
 };
 cleanup.push(()=>surface.dispose());
 try{
  cleanup.push(surface.subscribePick((at,original)=>{
   if(disposed||!active||!plan)return;
   const camera:StorybookCamera=original?.camera??{origin:{x:0,y:0},zoom:1};
   const hit=pickStorybookPlan(plan,atlas,original?.screen??at,camera);
   if(hit?.selection)observer.select(hit.selection);
  }));
  cleanup.push(observer.subscribe((value,status)=>{
   if(disposed)return;
   if(value?.world.id!==worldId){bounds=null;worldId=value?.world.id;}
   snapshot=value;connected=status;render();
  }));
  cleanup.push(observer.subscribeRoom(value=>{if(disposed)return;room=value;render();}));
  render();return handle;
 }catch(error){disposed=true;release();throw error;}
}

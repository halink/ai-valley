/** Optional client renderer. Receives the existing observer feed; owns no transport or world state. */
import type {ObserverMap} from './observer-map.js';
import {IsometricPreview,PREVIEW_FRAME_MS,PREVIEW_LIMITATIONS,previewSelection,previewHitLabel,previewHome} from './isometric-preview.js';
import {residentFollowText} from './resident-follow.js';
import type {PixelMark} from './work-art.js';
import type {Vec} from '../shared/types.js';
export interface IsometricObserverHandle {
 readonly model:IsometricPreview;
 activate():void;
 deactivate():void;
 dispose():void;
}
const mounted=new WeakMap<ObserverMap,IsometricObserverHandle>();
/** Repeated development/formal installation shares exactly one DOM and subscription set. */
export function mountIsometricObserver(observerMap:ObserverMap):IsometricObserverHandle {
 const existing=mounted.get(observerMap);if(existing)return existing;
 let disposed=false;
 const cleanup:Array<()=>void>=[];
 const attempt=(action:()=>void)=>{try{action();}catch(error){console.warn('Optional observer cleanup failed',error);}};
 const release=()=>{while(cleanup.length)attempt(cleanup.pop()!);mounted.delete(observerMap);};
 const listen=(target:EventTarget,type:string,listener:(event:any)=>void,options?:boolean|AddEventListenerOptions)=>{target.addEventListener(type,listener,options);cleanup.push(()=>target.removeEventListener(type,listener,options));};
 try{
const model=new IsometricPreview(),tray=document.createElement('section');
tray.className='isometric-observer';tray.setAttribute('aria-label','可选2.5D观察渲染器');
tray.innerHTML='<div class="preview-switch"><small>观察视图 · 同一快照</small><button type="button" data-view="2d" aria-pressed="true">2D</button><button type="button" data-view="iso" aria-pressed="false" disabled>2.5D（试用）</button><button type="button" data-reset disabled title="2.5D视图启用后可用">回到住宅</button></div><div class="preview-details" hidden><p class="preview-scope"></p><p class="preview-hit" role="status">拖动跨地块 · 滚轮缩放 · 点选原对象</p><details><summary>当前范围与限制</summary><p class="preview-limits"></p></details></div><p class="preview-notice" role="status" hidden></p>';
tray.querySelector('.preview-limits')!.textContent=PREVIEW_LIMITATIONS;
document.getElementById('observer-hud')!.append(tray);cleanup.push(()=>tray.remove());
const canvas=document.createElement('canvas');canvas.className='isometric-preview-canvas';canvas.hidden=true;canvas.tabIndex=0;canvas.setAttribute('aria-label','连续等距观察；方向键移动，Escape返回2D');
document.getElementById('app')!.prepend(canvas);cleanup.push(()=>canvas.remove());
let context:CanvasRenderingContext2D|null=null;
try{context=canvas.getContext('2d');}catch{/* Original 2D remains available when optional Canvas2D is denied. */}
const staticCanvas=document.createElement('canvas'),frameCanvas=document.createElement('canvas');
const details=tray.querySelector<HTMLElement>('.preview-details')!,notice=tray.querySelector<HTMLElement>('.preview-notice')!,hitText=tray.querySelector<HTMLElement>('.preview-hit')!,switchButton=tray.querySelector<HTMLButtonElement>('[data-view="iso"]')!,resetButton=tray.querySelector<HTMLButtonElement>('[data-reset]')!;
resetButton.disabled=true;
let active=false,timer:number|undefined,staticKey:unknown=null,geometry='';
let selectedResident:string|null=null,manualView=false;
let drag:{id:number;start:Vec;origin:Vec;moved:boolean}|null=null;
cleanup.push(()=>restore2D());
function cancelDrag(){const id=drag?.id;drag=null;if(id!==undefined&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
function draw(ctx:CanvasRenderingContext2D,marks:PixelMark[]){for(const mark of marks){ctx.fillStyle=mark.color;ctx.fillRect(mark.x,mark.y,mark.width,mark.height);}}
function paint(){
 if(!active||!context||!model.scene||!model.camera)return;
 const s=model.scene,c=model.camera,key=[s.width,s.height,s.camera.origin.x,s.camera.origin.y].join(',');
 if(staticKey!==s.terrain||key!==geometry){
  staticKey=s.terrain;geometry=key;staticCanvas.width=s.width;staticCanvas.height=s.height;frameCanvas.width=s.width;frameCanvas.height=s.height;
  const terrain=staticCanvas.getContext('2d')!;terrain.setTransform(1,0,0,1,s.camera.origin.x,s.camera.origin.y);draw(terrain,s.terrain);
 }
 const frame=frameCanvas.getContext('2d')!;frame.setTransform(1,0,0,1,0,0);frame.clearRect(0,0,s.width,s.height);frame.drawImage(staticCanvas,0,0);frame.setTransform(1,0,0,1,s.camera.origin.x,s.camera.origin.y);
 for(const object of s.objects)draw(frame,object.marks);
 context.setTransform(1,0,0,1,0,0);context.fillStyle='#f0d9ac';context.fillRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=false;
 context.setTransform(c.zoom,0,0,c.zoom,c.origin.x,c.origin.y);context.drawImage(frameCanvas,-s.camera.origin.x,-s.camera.origin.y);context.setTransform(1,0,0,1,0,0);
 const synthetic=model.snapshot?.version==='synthetic-observer-preview';
 tray.querySelector('.preview-scope')!.textContent=(synthetic?'隔离合成开局 · 暂停 · 非自主模型演示 · ':'')+model.summary+` · 当前问号 ${s.renderedMarkerCount} · ${model.roomId?'本房间':'全世界'}仅记录 ${s.unsupportedObjects}（其中位置未知 ${s.unknownLocationCount}）`;
 const follow=observerMap.currentFollow();if(follow)hitText.textContent=residentFollowText(follow);
}
function resize(){
 if(model.viewOccluded)return;
 cancelDrag();const rect=canvas.getBoundingClientRect();canvas.width=Math.max(1,Math.min(2560,Math.round(rect.width)));canvas.height=Math.max(1,Math.min(1600,Math.round(rect.height)));model.resize(canvas.width,canvas.height,manualView||(!selectedResident&&observerMap.currentFollow()?.status!=='following'));reframeSelection();paint();
}
function reframeSelection(){
 if(model.viewOccluded)return;
 const follow=observerMap.currentFollow();
 if(follow?.status==='following')model.followResident(follow.personId);
 else if(selectedResident&&!manualView)model.frameResident(selectedResident);
}
function restore2D(message=''){
 const wasActive=active;active=false;model.setActive(false);
 const priorTimer=timer;timer=undefined;attempt(()=>clearInterval(priorTimer));attempt(cancelDrag);
 attempt(()=>observerMap.setFollowResolver(null));
 attempt(()=>{if(wasActive&&!observerMap.currentRoom()&&!observerMap.currentFollow()&&model.centerTile)observerMap.frame(model.centerTile);});
 canvas.hidden=true;details.hidden=true;resetButton.disabled=true;
 attempt(()=>document.getElementById('canvas')!.classList.toggle('covered-by-preview',false));
 attempt(()=>document.querySelector('.map-hint')?.classList.toggle('covered-by-preview',false));
 attempt(()=>observerMap.cover(false));
 tray.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view==='2d')));notice.hidden=!message;notice.textContent=message;
}
function setActive(value:boolean,message=''){
 if(value===active&&!message)return;
 if(!value){restore2D(message);return;}
 if(!model.snapshot||!context||switchButton.disabled)return;
 const reason=model.roomReason(observerMap.currentRoom());if(reason){notice.hidden=false;notice.textContent=reason+'，当前保留原2D。';return;}
 active=true;model.setActive(true);cancelDrag();clearInterval(timer);timer=undefined;
 observerMap.setFollowResolver((world,id)=>{try{return model.observerFollowTarget(world,id);}catch{return null;}});
 canvas.hidden=false;details.hidden=false;resetButton.disabled=false;document.getElementById('canvas')!.classList.toggle('covered-by-preview',true);document.querySelector('.map-hint')?.classList.toggle('covered-by-preview',true);observerMap.cover(true);
 tray.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view==='iso')));notice.hidden=!message;notice.textContent=message;
 model.setRoom(observerMap.currentRoom());resize();if(!observerMap.currentRoom()&&!observerMap.currentFollow())model.center(observerMap.currentTile());reframeSelection();syncFollow();if(!active)return;paint();timer=window.setInterval(()=>safely(()=>{if(model.tick(performance.now()))paint();}),PREVIEW_FRAME_MS);
}
function safely(action:()=>void){if(disposed)return;try{action();}catch(error){console.warn('Optional isometric observer stopped',error);restore2D('等距观察暂不可用，已恢复原2D。下一有效快照可重试。');switchButton.disabled=true;}}
function syncFollow(){
 if(!active||model.viewOccluded)return;const priorRoom=model.roomId,reason=model.setRoom(observerMap.currentRoom());if(reason){setActive(false,reason+'，已恢复原2D房间。');return;}if(priorRoom!==model.roomId)cancelDrag();const state=observerMap.currentFollow();
 if(state?.status==='following'){manualView=false;const reason=model.followResident(state.personId);if(reason){setActive(false,`${reason}，已返回2D继续观察同一居民。`);return;}}
 paint();
}
const point=(event:PointerEvent|WheelEvent):Vec=>{const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*canvas.width/Math.max(1,rect.width),y:(event.clientY-rect.top)*canvas.height/Math.max(1,rect.height)};};
listen(canvas,'pointerdown',event=>safely(()=>{if(!active||!model.camera||event.button!==0||!event.isPrimary||drag)return;drag={id:event.pointerId,start:point(event),origin:{...model.camera.origin},moved:false};canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});}));
listen(canvas,'pointermove',event=>safely(()=>{
 if(!active||!drag||event.pointerId!==drag.id||!model.camera)return;const at=point(event),dx=at.x-drag.start.x,dy=at.y-drag.start.y;if(Math.hypot(dx,dy)>6)drag.moved=true;
 if(drag.moved){manualView=true;observerMap.stopFollowing();model.moveCamera({...model.camera,origin:{x:drag.origin.x+dx,y:drag.origin.y+dy}});paint();}
}));
listen(canvas,'pointerup',event=>safely(()=>{
 if(!drag||event.pointerId!==drag.id)return;const moved=drag.moved;cancelDrag();if(moved)return;const hit=model.pick(point(event));manualView=false;const selection=previewSelection(hit);selectedResident=selection?.kind==='person'?selection.id:null;observerMap.select(selection);reframeSelection();paint();hitText.textContent=model.snapshot?previewHitLabel(model.snapshot.world,hit):'等待快照';
}));
listen(canvas,'pointercancel',cancelDrag);listen(canvas,'lostpointercapture',()=>{drag=null;});
function zoom(delta:number,anchor={x:canvas.width/2,y:canvas.height/2}){cancelDrag();model.zoom(delta,anchor);reframeSelection();paint();}
listen(canvas,'wheel',event=>{event.preventDefault();safely(()=>zoom(event.deltaY>0?-.25:.25,point(event)));},{passive:false});
listen(canvas,'keydown',event=>safely(()=>{
 if(!active||!model.camera)return;const offsets:Record<string,Vec>={ArrowLeft:{x:24,y:0},ArrowRight:{x:-24,y:0},ArrowUp:{x:0,y:24},ArrowDown:{x:0,y:-24}},move=offsets[event.key];
 if(move){event.preventDefault();manualView=true;observerMap.stopFollowing();model.moveCamera({...model.camera,origin:{x:model.camera.origin.x+move.x,y:model.camera.origin.y+move.y}});paint();}
 if(event.key==='+'||event.key==='='){event.preventDefault();zoom(.25);}if(event.key==='-'){event.preventDefault();zoom(-.25);}
}));
function resetHome(){manualView=true;observerMap.stopFollowing();if(model.snapshot)observerMap.frame(previewHome(model.snapshot.world));model.home();paint();}
listen(tray,'click',event=>safely(()=>{const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b)return;if(b.dataset.view)setActive(b.dataset.view==='iso');else if(b.hasAttribute('data-reset')&&active)resetHome();}));
const capture=(event:MouseEvent)=>safely(()=>{
 if(!active||!(event.target instanceof Element))return;
 if(observerMap.isFullMapTarget(event.target)){manualView=true;setActive(false,'全图定位仍使用原2D。');return;}
 const b=event.target.closest<HTMLElement>('[data-action],[data-panel],[data-follow],[data-enter],[data-locate],[data-tile],[data-region],[data-project],[data-animal-map]');if(!b)return;cancelDrag();
 // Explicit observation navigation wins over a still-open resident card.
 // Main routes retain authority over follow/selection/room changes.
 if(['enter','locate','tile','region','project','animalMap'].some(key=>b.dataset[key]!==undefined)||b.dataset.panel==='atlas'||['home','exitroom','trade-station','stopfollow','closeselection'].includes(b.dataset.action??''))manualView=true;
 if(b.dataset.enter!==undefined){const reason=model.roomReason(b.dataset.enter);if(reason)setActive(false,reason+'，室内入口已切回原2D。');return;}
 const action=b.dataset.action;
 if(action==='home'||action==='zoomin'||action==='zoomout'){event.preventDefault();event.stopImmediatePropagation();if(action==='home'){resetHome();}else zoom(action==='zoomin'?.25:-.25);return;}
 if(b.dataset.follow){manualView=false;const reason=model.followResident(b.dataset.follow);if(reason)setActive(false,`${reason}，已返回2D。`);return;}
 if(b.dataset.locate){if(!model.locateBuilding(b.dataset.locate))setActive(false,'该建筑尚未支持，已返回2D。');return;}
 if(b.dataset.tile){const [x,y]=b.dataset.tile.split(',').map(Number);model.setRoom(null);if(!model.center({x,y}))setActive(false,'该位置暂不可绘制，已返回2D。');return;}
 if(b.dataset.animalMap!==undefined){if(!model.locateEcology(b.dataset.animalMap))setActive(false,'该动物的位置或姿态尚未支持，已返回2D。');return;}
 if(['region','project'].some(k=>b.dataset[k]!==undefined)||b.dataset.panel==='atlas'||action==='trade-station')setActive(false,'此定位入口仍使用完整2D。');
});
// Original document routes retain selection/follow/panel behavior. Reframe after them.
const afterRoute=(event:MouseEvent)=>safely(()=>{if(!active||!(event.target instanceof Element))return;const b=event.target.closest<HTMLElement>('[data-locate],[data-tile],[data-animal-map]');if(!b)return;if(b.dataset.animalMap)model.locateEcology(b.dataset.animalMap);if(b.dataset.locate)model.locateBuilding(b.dataset.locate);if(b.dataset.tile){const [x,y]=b.dataset.tile.split(',').map(Number);model.setRoom(null);model.center({x,y});}paint();});
listen(document,'click',capture,true);listen(document,'click',afterRoute);
const escape=(event:KeyboardEvent)=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setActive(false);tray.querySelector<HTMLButtonElement>('[data-view="2d"]')!.focus();}};listen(document,'keydown',escape,true);
const visibility=()=>model.setVisible(!document.hidden);listen(document,'visibilitychange',visibility);visibility();
if(observerMap.subscribeViewArea)cleanup.push(observerMap.subscribeViewArea((area,id)=>safely(()=>{
 if(id!==selectedResident)manualView=false;selectedResident=id;model.setViewArea(area);
 if(active&&!model.viewOccluded){resize();syncFollow();reframeSelection();paint();}
})));
const onResize=()=>safely(()=>{if(active)resize();});listen(window,'resize',onResize);
if(!context){notice.hidden=false;notice.textContent='当前设备不支持2.5D画布，继续使用原2D。';}
cleanup.push(observerMap.subscribe((snapshot,connected)=>safely(()=>{model.setConnected(connected);if(!snapshot)return;model.accept(snapshot);switchButton.disabled=!context;if(active)syncFollow();})));
cleanup.push(observerMap.subscribeRoom(()=>safely(()=>{if(!active)return;const latest=observerMap.currentSnapshot();if(latest)model.accept(latest);syncFollow();})));
cleanup.push(observerMap.subscribeFollow(()=>safely(()=>{if(!active)return;const latest=observerMap.currentSnapshot();if(latest)model.accept(latest);syncFollow();})));
const handle:IsometricObserverHandle={model,activate:()=>safely(()=>setActive(true)),deactivate:()=>safely(()=>setActive(false)),dispose:()=>{
 if(disposed)return;disposed=true;release();
}};
mounted.set(observerMap,handle);return handle;
 }catch(error){disposed=true;release();throw error;}
}

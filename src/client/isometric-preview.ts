/** Read-only observer controller sharing original outdoor and room identities. */
import type {Snapshot,World,Vec} from '../shared/types.js';
import {calendar,daylight,daylightLabels} from '../world/time.js';
import {residentFollowTarget,residentRoomPositionKnown} from './resident-follow.js';
import type {FollowTarget} from './resident-follow.js';
import {pickIsometricStudy,type StudySubject} from './isometric-study.js';
import {screenToIsometric,type IsometricCamera} from './isometric-projection.js';
import {IsometricViewport,fitWorldCamera,constrainWorldCamera,zoomWorldCamera,type IsometricViewportScene} from './isometric-viewport.js';
import {IsometricHomeInterior,homeInteriorSupport,fitRoomCamera,constrainRoomCamera,zoomRoomCamera,type IsometricHomeInteriorScene} from './isometric-interior.js';
export {fitWorldCamera,constrainWorldCamera,zoomWorldCamera};
export const PREVIEW_FRAME_MS=125;
export const PREVIEW_LIMITATIONS='2.5D试用观察 · 与2D共用快照，不推进模拟。户外支持八类建筑、真实新建阶段、林木/矿石/浆果/泉/果树，以及已核实位置的行走、工作、婴儿、重病、携运和未葬遗体。六种野兽、五种家畜、登记鱼群和墓位沿用同一记录。住宅、共屋与工坊室内复用真实布局及roomAt，支持原有姿态、实际到厨房的普通烹饪，以及工坊真实桌台/木工作台上已核实批次的普通制作；其他设备外观用记录标记，其他室内姿态/其他类型室内回2D。未知外观或预算不足用问号，未知位置与预算省略另计，不猜坐标或补造状态。全图、区域路线和未支持跟随回原2D。暂停人物使用静止第0相位；显示动作不证明成功或产出。浏览器、触控与GPU尚未验收，正式默认仍2D。';
const finite=(at:Vec)=>Number.isFinite(at.x)&&Number.isFinite(at.y);
export function previewHome(w:World):Vec {
 const b=w.buildings.find(b=>b.kind==='home'&&finite(b.at)&&b.at.x>=0&&b.at.y>=0&&b.at.x<w.map.width&&b.at.y<w.map.height);
 return b?{x:b.at.x+b.width/2,y:b.at.y+b.height/2}:w.map.settlement??{x:w.map.width/2,y:w.map.height/2};
}
export class IsometricPreview {
 snapshot:Snapshot|null=null;
 scene:IsometricViewportScene|IsometricHomeInteriorScene|null=null;
 camera:IsometricCamera|null=null;
 roomId:string|null=null;
 readonly viewport=new IsometricViewport();
 readonly interior=new IsometricHomeInterior();
 elapsed=0;
 private outdoorCamera:IsometricCamera|null=null;
 private roomName='';
 private roomKind='';
 private describeRoom(){const b=this.snapshot?.world.buildings.find(b=>b.id===this.roomId);this.roomName=this.roomId?(b?.name??this.roomId):'';this.roomKind=b?({home:'住宅',lodge:'共屋',workshop:'工坊'}[b.kind as 'home'|'lodge'|'workshop']??'建筑'):'';}
 private size={width:0,height:0};
 private active=false;
 private connected=false;
 private visible=true;
 private previous:number|null=null;
 private lastFrame=0;
 setActive(value:boolean){this.active=value;this.previous=null;}
 setVisible(value:boolean){if(this.visible!==value)this.previous=null;this.visible=value;}
 setConnected(value:boolean){if(this.connected!==value)this.previous=null;this.connected=value;}
 roomReason(id:string|null):string|null {
  if(!id)return null;if(!this.snapshot)return '尚无世界记录';const support=homeInteriorSupport(this.snapshot.world,id);return support.supported?null:support.reason;
 }
 private get layout(){if(!this.snapshot||!this.roomId)return null;const support=homeInteriorSupport(this.snapshot.world,this.roomId);if(!support.supported)throw new Error(support.reason);return support.layout;}
 /** Change only the viewing space. Original scene routes own room entry and follow. */
 setRoom(id:string|null):string|null {
  const reason=this.roomReason(id);if(reason)return reason;if(id===this.roomId)return null;
  const saved={roomId:this.roomId,roomName:this.roomName,roomKind:this.roomKind,camera:this.camera,outdoorCamera:this.outdoorCamera,scene:this.scene};
  try{
   if(!this.roomId)this.outdoorCamera=this.camera;
   this.roomId=id;this.describeRoom();
   if(this.snapshot&&this.size.width>0&&this.size.height>0){
    this.camera=id?fitRoomCamera(this.layout!,null,this.size.width,this.size.height):this.outdoorCamera?constrainWorldCamera(this.outdoorCamera,this.snapshot.world,this.size.width,this.size.height):fitWorldCamera(this.snapshot.world,previewHome(this.snapshot.world),this.size.width,this.size.height);
    if(this.active)this.rebuild();else this.scene=null;
   }
   return null;
  }catch(error){Object.assign(this,saved);throw error;}
 }
 accept(snapshot:Snapshot){
  if(snapshot===this.snapshot||this.snapshot?.world.id===snapshot.world.id&&snapshot.world.revision<this.snapshot.world.revision)return false;
  const w=snapshot.world;
  if(!Number.isInteger(w.map.width)||!Number.isInteger(w.map.height)||w.map.width<1||w.map.height<1)throw new Error('observer_map_dimensions');
  const saved={snapshot:this.snapshot,scene:this.scene,camera:this.camera,roomId:this.roomId,roomName:this.roomName,roomKind:this.roomKind,outdoorCamera:this.outdoorCamera,elapsed:this.elapsed,previous:this.previous,lastFrame:this.lastFrame};
  try{
   const changed=this.snapshot?.world.id!==w.id;
   if(changed||this.snapshot?.world.clock.paused!==w.clock.paused)this.previous=null;
   this.snapshot=snapshot;if(this.roomId)this.describeRoom();
   if(changed){this.roomId=null;this.roomName='';this.roomKind='';this.outdoorCamera=null;this.elapsed=0;this.lastFrame=0;if(this.camera)this.camera=fitWorldCamera(w,previewHome(w),this.size.width,this.size.height);}
   if(this.active&&this.camera)this.rebuild();else this.scene=null;
   return changed;
  }catch(error){Object.assign(this,saved);throw error;}
 }
 resize(width:number,height:number){
  if(!this.snapshot)return;
  const center=this.camera?screenToIsometric({x:this.size.width/2,y:this.size.height/2},this.camera):null,layout=this.layout;
  // The saved outdoor camera is re-centered in the new viewport independently of room coordinates.
  if(this.roomId&&this.outdoorCamera){const at=screenToIsometric({x:this.size.width/2,y:this.size.height/2},this.outdoorCamera);if(at)this.outdoorCamera=fitWorldCamera(this.snapshot.world,at,width,height,this.outdoorCamera.zoom);}
  this.size={width,height};
  this.camera=layout?fitRoomCamera(layout,center,width,height,this.camera?.zoom):fitWorldCamera(this.snapshot.world,center??previewHome(this.snapshot.world),width,height,this.camera?.zoom??1);
  if(this.active)this.rebuild();
 }
 rebuild(){
  if(!this.snapshot||!this.camera)return;
  if(this.roomId){this.interior.accept(this.snapshot,this.roomId);this.scene=this.interior.render(this.camera,this.size.width,this.size.height,this.elapsed);}
  else {this.viewport.accept(this.snapshot);this.scene=this.viewport.render(this.camera,this.size.width,this.size.height,this.elapsed);}
  this.camera=this.scene.displayCamera;
 }
 moveCamera(camera:IsometricCamera){
  if(!this.snapshot)return;const layout=this.layout;
  this.camera=layout?constrainRoomCamera(camera,layout,this.size.width,this.size.height):constrainWorldCamera(camera,this.snapshot.world,this.size.width,this.size.height);this.rebuild();
 }
 center(at:Vec){
  if(!this.snapshot||!this.camera||!finite(at))return false;
  const layout=this.layout,bounds=layout??this.snapshot.world.map;if(at.x<0||at.y<0||at.x>=bounds.width||at.y>=bounds.height)return false;
  this.camera=layout?fitRoomCamera(layout,at,this.size.width,this.size.height,this.camera.zoom):fitWorldCamera(this.snapshot.world,at,this.size.width,this.size.height,this.camera.zoom);this.rebuild();return true;
 }
 zoom(delta:number,anchor:Vec){if(this.snapshot&&this.camera){const layout=this.layout;this.moveCamera(layout?zoomRoomCamera(this.camera,layout,this.size.width,this.size.height,anchor,delta):zoomWorldCamera(this.camera,this.snapshot.world,this.size.width,this.size.height,anchor,delta));}}
 home(){if(this.snapshot){this.setRoom(null);this.center(previewHome(this.snapshot.world));}}
 /** Called by the observer's shared follow state before its UI receives this same immutable world. */
 observerFollowTarget(w:World,id:string):FollowTarget|null{
  const r=w.residents.find(r=>r.id===id);if(!r||r.status!=='alive'||r.residency==='outside')return null;
  if(r.regionalLocation)return {reason:'outside'};
  this.viewport.accept({world:w});const outdoor=this.viewport.residentTarget(id);
  if(outdoor?.anchor&&!outdoor.reason)return {roomId:null,roomName:null,precise:true};
  if(outdoor?.kind==='hidden'&&outdoor.hiddenReason==='outside')return {reason:'outside'};
  if(outdoor?.kind==='fallback'&&!outdoor.at||outdoor?.kind==='hidden'&&!r.inside)return {reason:'position-unavailable'};
  return null;
 }
 followResident(id:string):string|null {
  const w=this.snapshot?.world;if(!w)return '尚无世界记录';
  const r=w.residents.find(r=>r.id===id);
  if(!r||r.status!=='alive'||r.residency==='outside')return '该居民不在可观察范围';
  if(r.regionalLocation)return '区域旅途尚未接入等距观察';
  this.viewport.accept(this.snapshot!);const outdoor=this.viewport.residentTarget(id);
  if(outdoor?.anchor&&!outdoor.reason){
   const reason=this.setRoom(null);if(reason)return reason;this.viewport.prioritize('resident:'+id);
   if(!this.center({x:outdoor.anchor.x+.5,y:outdoor.anchor.y+.5}))return '人物位置超出可观察范围';
   return this.scene?.objects.some(o=>o.subject.kind==='resident'&&o.subject.id===id&&!o.subject.placeholder)?null:'该人物详细外观超出绘制预算';
  }
  // Only a fully verified outdoor record can override old personal coordinates. Room routing keeps its original gates.
  if(outdoor?.kind==='hidden'&&outdoor.hiddenReason!=='other-space')return outdoor.reason;
  const target=residentFollowTarget(w,id);if('reason'in target)return outdoor?.reason??'该居民不在可观察范围';
  if(!target.roomId)return outdoor?.reason??'没有可核实的等距户外人物位置';
  if(target.roomId&&!residentRoomPositionKnown(w,r))return '未记录居民室内精确位置';
  const reason=this.setRoom(target.roomId);if(reason)return reason;
  const at=target.roomId?r.roomAt:r.at;
  if(!at||!Number.isInteger(at.x)||!Number.isInteger(at.y))return '人物精确位置尚未支持';
  if(!this.center({x:at.x+.5,y:at.y+.5}))return '人物位置超出可观察范围';
  return this.scene?.objects.some(o=>o.subject.kind==='resident'&&o.subject.id===id&&!o.subject.placeholder)?null:'该人物姿态尚未支持，或超出绘制预算';
 }
 locateBuilding(id:string){
  const b=this.snapshot?.world.buildings.find(b=>b.id===id);if(!b)return false;
  this.viewport.prioritize('building:'+id);this.setRoom(null);if(!this.center({x:b.at.x+b.width/2,y:b.at.y+b.height/2}))return false;
  return !!this.scene?.objects.some(o=>o.subject.kind==='building'&&o.subject.id===id&&!o.subject.placeholder);
 }
 /** Keep original ecology identity, including a duck domesticated under the same ID. */
 locateEcology(value:string):boolean {
  const separator=value.indexOf('/'),kind=value.slice(0,separator),id=value.slice(separator+1),w=this.snapshot?.world;
  if(!w||separator<1||!id||!['animal','beast','fish'].includes(kind))return false;
  const resolved=kind==='beast'&&!w.frontierHazards?.beasts.some(b=>b.id===id)&&w.industry?.animals.some(a=>a.id===id)?'animal':kind;
  const animal=resolved==='animal'?w.industry?.animals.find(a=>a.id===id):null,beast=resolved==='beast'?w.frontierHazards?.beasts.find(b=>b.id===id):null;
  if(animal&&(animal.status!=='alive'||animal.inside||animal.carrierId))return false;
  if(beast&&beast.status!=='alive')return false;
  const at=animal?.at??beast?.at??(resolved==='fish'?w.industry?.fishing[id]?.shoal?.at:undefined);
  if(!at||!Number.isInteger(at.x)||!Number.isInteger(at.y))return false;
  this.setRoom(null);if(!this.center({x:at.x+.5,y:at.y+.5}))return false;
  return !!this.scene?.objects.some(o=>o.subject.kind===resolved&&o.subject.id===id&&!o.subject.placeholder);
 }
 get centerPoint(){return this.camera?screenToIsometric({x:this.size.width/2,y:this.size.height/2},this.camera):null;}
 get centerTile(){return this.roomId?null:this.centerPoint;}
 tick(now:number){
  if(!Number.isFinite(now))return false;
  const prior=this.previous;this.previous=now;
  if(!this.active||!this.visible||!this.connected||!this.snapshot||!this.scene||this.snapshot.world.clock.paused||prior===null)return false;
  this.elapsed+=Math.max(0,Math.min(PREVIEW_FRAME_MS,now-prior));
  if(this.elapsed-this.lastFrame<PREVIEW_FRAME_MS)return false;
  this.lastFrame=this.elapsed;this.scene=this.roomId?this.interior.animate(this.scene as IsometricHomeInteriorScene,this.elapsed):this.viewport.animate(this.scene,this.elapsed);return true;
 }
 pick(at:Vec){const hit=this.scene&&this.camera?pickIsometricStudy({...this.scene,camera:this.camera},at):null;return hit&&this.roomId?{...hit,roomId:this.roomId}:hit;}
 get summary(){
  if(!this.snapshot||!this.scene)return '等待世界快照';
  const w=this.snapshot.world,b=this.scene.bounds,date=calendar(w.minute),season={spring:'春',summer:'夏',autumn:'秋',winter:'冬'}[date.season],space=this.roomId?this.roomKind+'室内：'+this.roomName:'户外';
  return `${space} · ${season} · ${daylightLabels[daylight(w.minute).phase]} ${String(date.hour).padStart(2,'0')}:${String(date.minute).padStart(2,'0')} · 可见 (${b.x},${b.y})–(${b.x+b.width-1},${b.y+b.height-1}) · ${this.scene.objects.length} 个对象 · 预算标记 ${this.scene.budgetMarkerCount??0} · 预算省略 ${this.scene.omittedObjects}${this.scene.uncheckedObjects?'（含未检查候选 '+this.scene.uncheckedObjects+'）':''} · ${w.clock.paused?'暂停：相位静止':'仅显示记录，不表示产出'}`;
 }
}
export function previewSelection(hit:StudySubject|{kind:'tile';at:Vec}|null):import('./scene.js').SceneSelection {
 if(!hit||hit.kind==='tile')return null;
 if(hit.kind==='resident')return {kind:'person',id:hit.id};
 if(hit.kind==='building'||hit.kind==='project'||hit.kind==='animal'||hit.kind==='beast'||hit.kind==='fish')return {kind:hit.kind,id:hit.id};
 return null;
}
export function previewHitLabel(w:World,hit:StudySubject|{kind:'tile';at:Vec}|null){
 if(!hit)return '世界地图之外';
 const names:Partial<Record<StudySubject['kind'],string>>={resident:'居民',building:'建筑',tree:'林木',plot:'田地',resource:'资源',grave:'墓位',animal:'家畜',beast:'野兽',fish:'鱼群',project:'工程',infrastructure:'基础设施',estate:'原址物资',culture:'文化筹备',household:'家庭存储',cargo:'运输货物',pasture:'牧场',pastureProject:'牧场工程',orchard:'果树',crate:'运输笼',ferry:'船只',shore:'渔岸',roomSlot:'房间位置'};
 const name=hit.kind==='resident'?w.residents.find(r=>r.id===hit.id)?.name:hit.kind==='building'?w.buildings.find(b=>b.id===hit.id)?.name:null;
 const label=hit.kind==='tile'?'地表':(names[hit.kind]??'户外记录')+'：'+(name??hit.id);
 return `${label} · ${'roomId'in hit&&hit.roomId?'室内':''}(${hit.at.x}, ${hit.at.y})${'description'in hit&&hit.description?' · '+hit.description:''}${'placeholder'in hit&&hit.placeholder?' · 记录标记：'+hit.placeholder:''}`;
}

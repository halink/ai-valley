/** Read-only home/lodge/workshop interiors in the same pixel/projection space as the world viewport. */
import type {Snapshot,World,Vec,Resident} from '../shared/types.js';
import {roomLayout,type RoomLayout,type RoomSlot} from '../shared/rooms.js';
import {projectIsometric,unprojectIsometric,orderIsometricObjects,type Footprint,type IsometricCamera} from './isometric-projection.js';
import {Pixels,residentMarks,noise,type StudySubject,type StudyObject} from './isometric-study.js';
import {personVisual,type PersonVisual} from './person-pose.js';
import {ordinaryCookingVisual} from './isometric-cooking.js';
import {ordinaryCraftVisual} from './isometric-crafting.js';
import {materials as m,residentColors} from './palette.js';
import type {PixelMark} from './work-art.js';
import {VIEWPORT_LIMITS,type IsometricViewportScene} from './isometric-viewport.js';

export const HOME_INTERIOR_LIMITS={axis:64,cells:4096,slots:128,sourceAxis:2048} as const;
export type HomeInteriorSupport={supported:true;reason:null;layout:RoomLayout}|{supported:false;reason:string;layout:null};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const inRoom=(layout:Pick<RoomLayout,'width'|'height'>,at:Vec|null|undefined):at is Vec=>!!at&&[at.x,at.y].every(Number.isFinite)&&at.x>=0&&at.y>=0&&at.x<layout.width&&at.y<layout.height;
const validSize=(l:Pick<RoomLayout,'width'|'height'>)=>[l.width,l.height].every(n=>Number.isInteger(n)&&n>0&&n<=HOME_INTERIOR_LIMITS.axis)&&l.width*l.height<=HOME_INTERIOR_LIMITS.cells;
/** Bound the inputs before roomLayout's capacity loops. Do not fabricate rooms in legacy worlds. */
export function homeInteriorSupport(w:World,roomId:string):HomeInteriorSupport {
 const reject=(reason:string):HomeInteriorSupport=>({supported:false,reason,layout:null});
 if(!w?.rooms)return reject('未记录真实室内布局');
 if(!Array.isArray(w.buildings)||!Array.isArray(w.residents))return reject('房间记录不可用');
 const b=w.buildings.find(b=>b.id===roomId);
 if(!b)return reject('所在建筑记录已不可用');
 if(!['home','lodge','workshop'].includes(b.kind))return reject('此等距视图目前只支持住宅、共屋与工坊室内');
 if(![b.width,b.height].every(n=>Number.isInteger(n)&&n>0)||!Number.isInteger(b.capacity)||b.capacity<0)return reject('住宅、共屋或工坊布局尺寸无效');
 const beds=b.kind==='workshop'?0:b.capacity;
 const size={width:Math.max(16,b.width*2),height:Math.max(b.kind==='workshop'?16:13,Math.ceil(beds/2)*3+7,b.height*2+3)};
 const fixedSlots=b.kind==='lodge'?5:3;
 if(!validSize(size)||beds+fixedSlots>HOME_INTERIOR_LIMITS.slots)return reject('住宅、共屋或工坊布局超过等距室内显示上限');
 if(w.industry&&!Array.isArray(w.industry.stations))return reject('住宅、共屋或工坊工位记录不可用');
 if((w.industry?.stations.filter(s=>s.buildingId===b.id).length??0)+beds+fixedSlots>HOME_INTERIOR_LIMITS.slots)return reject('住宅、共屋或工坊工位超过等距室内显示上限');
 const layout=roomLayout(w,b),keys=new Set<string>();
 if(!validSize(layout)||!inRoom(layout,layout.entry)||layout.slots.some(s=>!s||typeof s.key!=='string'||keys.has(s.key)||!keys.add(s.key)||!inRoom(layout,s.at)))return reject('住宅、共屋或工坊布局或工位坐标无效');
 return {supported:true,reason:null,layout};
}
function cameraInput(camera:IsometricCamera,layout:RoomLayout,width:number,height:number){
 if(!validSize(layout)||![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=16384))throw new Error('isometric_interior_dimensions');
 if(![camera.origin.x,camera.origin.y,camera.zoom].every(Number.isFinite)||camera.zoom<=0)throw new Error('isometric_interior_camera');
}
function minZoom(layout:RoomLayout,width:number,height:number){
 // Small rooms already bound all floor/candidate work. Let them fit in full instead of inheriting outdoor zoom.
 if(layout.width<=VIEWPORT_LIMITS.cells&&layout.height<=VIEWPORT_LIMITS.cells)return Math.max(width,height)/HOME_INTERIOR_LIMITS.sourceAxis;
 return (width/32+height/16)/(VIEWPORT_LIMITS.cells-2-VIEWPORT_LIMITS.halo*2*(1/32+1/16));
}
export function constrainRoomCamera(camera:IsometricCamera,layout:RoomLayout,width:number,height:number):IsometricCamera {
 cameraInput(camera,layout,width,height);const zoom=Math.max(minZoom(layout,width,height),Math.min(8,camera.zoom));
 const center=unprojectIsometric({x:(width/2-camera.origin.x)/camera.zoom,y:(height/2-camera.origin.y)/camera.zoom});
 const p=projectIsometric({x:clamp(center.x,0,layout.width),y:clamp(center.y,0,layout.height)});
 return {zoom,origin:{x:width/2-p.x*zoom,y:height/2-p.y*zoom}};
}
/** Null centres the actual room. An omitted zoom fits it, subject to bounded rendering. */
export function fitRoomCamera(layout:RoomLayout,at:Vec|null,width:number,height:number,zoom?:number):IsometricCamera {
 const p=projectIsometric(at??{x:layout.width/2,y:layout.height/2});
 const fit=Math.min((width-32)/((layout.width+layout.height)*16+32),(height-32)/((layout.width+layout.height)*8+48));
 return constrainRoomCamera({zoom:zoom??Math.max(.1,fit),origin:{x:width/2-p.x*(zoom??Math.max(.1,fit)),y:height/2-p.y*(zoom??Math.max(.1,fit))}},layout,width,height);
}
export function zoomRoomCamera(camera:IsometricCamera,layout:RoomLayout,width:number,height:number,anchor:Vec,delta:number):IsometricCamera {
 cameraInput(camera,layout,width,height);if(![anchor.x,anchor.y,delta].every(Number.isFinite))throw new Error('isometric_interior_camera');
 const zoom=Math.max(minZoom(layout,width,height),Math.min(8,camera.zoom+delta));
 return constrainRoomCamera({zoom,origin:{x:anchor.x-(anchor.x-camera.origin.x)*zoom/camera.zoom,y:anchor.y-(anchor.y-camera.origin.y)*zoom/camera.zoom}},layout,width,height);
}
export function visibleRoomBounds(camera:IsometricCamera,layout:RoomLayout,width:number,height:number):Footprint {
 const c=constrainRoomCamera(camera,layout,width,height),h=VIEWPORT_LIMITS.halo;
 const points=[[-h,-h],[width/c.zoom+h,-h],[-h,height/c.zoom+h],[width/c.zoom+h,height/c.zoom+h]].map(([x,y])=>unprojectIsometric({x:x-c.origin.x/c.zoom,y:y-c.origin.y/c.zoom}));
 const x=clamp(Math.floor(Math.min(...points.map(p=>p.x))),0,layout.width),y=clamp(Math.floor(Math.min(...points.map(p=>p.y))),0,layout.height);
 return {x,y,width:clamp(Math.ceil(Math.max(...points.map(p=>p.x))),0,layout.width)-x,height:clamp(Math.ceil(Math.max(...points.map(p=>p.y))),0,layout.height)-y};
}
const quad=(b:Footprint,z=0)=>[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p=>projectIsometric(p,z));
function floorMarks(bounds:Footprint):PixelMark[] {
 const c=new Pixels();
 for(let y=bounds.y;y<bounds.y+bounds.height;y++)for(let x=bounds.x;x<bounds.x+bounds.width;x++){
  c.polygon(quad({x,y,width:1,height:1}),(x+y)%2?m.wood:m.bark);
  for(let n=0;n<3;n++){const p=projectIsometric({x:x+.25+n*.2,y:y+.35});c.rect(noise(x,y,n)%2?m.woodLight:m.woodShade,p.x,p.y,2);}
 }
 return c.marks;
}
function furniture(slot:RoomSlot):{footprint:Footprint;marks:PixelMark[]}|null {
 const c=new Pixels(),{x,y}=slot.at;
 const footprint=slot.kind==='bed'?{x:x-1,y:y-2,width:2,height:2}:slot.kind==='table'?{x:x-2,y:y-2,width:4,height:2}:slot.kind==='kitchen'?{x:x-1,y:y-2,width:2,height:2}:null;
 if(!footprint)return null;
 const box=(b:Footprint,z:number,top:string,front:string=m.wood,side:string=m.woodShade)=>{const [a,bp,cp,d]=quad(b,z),[,b0,c0,d0]=quad(b);c.polygon([bp,cp,c0,b0],side);c.polygon([d,cp,c0,d0],front);c.polygon([a,bp,cp,d],top);};
 if(slot.kind==='bed'){
  box(footprint,4,m.woodLight);box({...footprint,x:footprint.x+.1,y:footprint.y+.1,width:1.8,height:1.8},7,'#1177b5','#1177b5','#093261');
  c.polygon(quad({...footprint,x:footprint.x+.15,y:footprint.y+.12,width:1.7,height:.45},8),'#f6d89c');
  box({...footprint,height:.12},11,m.woodLight);box({...footprint,y:footprint.y+1.85,height:.15},8,m.woodLight);
 }else if(slot.kind==='table'){
  for(const p of quad({...footprint,x:footprint.x+.2,y:footprint.y+.2,width:3.6,height:1.6})){c.rect(m.woodShade,p.x-1,p.y-10,3,10);}
  box(footprint,12,m.woodLight);c.polygon(quad({...footprint,x:footprint.x+.08,y:footprint.y+.08,width:3.84,height:1.84},13),m.wood);
 }else{
  box(footprint,20,m.rockLight,m.rock,m.rockShade);const p=projectIsometric({x:x+.45,y},8);
  c.rect(m.rockInk,p.x-6,p.y-7,12,9);c.rect(m.rockShade,p.x-5,p.y-6,10,7); // Unlit opening; no fire, cookware, food or output is inferred.
 }
 return {footprint,marks:c.marks};
}
function placeholder(at:Vec):PixelMark[] {
 const c=new Pixels(),p=projectIsometric({x:at.x+.5,y:at.y+.5});
 c.rect('#d6a64b',p.x-5,p.y-13,11,13);c.rect('#292b32',p.x-4,p.y-12,9,11);c.rect('#d6a64b',p.x-2,p.y-10,4);c.rect('#d6a64b',p.x+2,p.y-9,1,3);c.rect('#d6a64b',p.x,p.y-7,2);c.rect('#d6a64b',p.x,p.y-6,1,2);c.rect('#d6a64b',p.x,p.y-2);return c.marks;
}
/** A simple lying pose at the recorded point, not a claim that a bed is occupied. */
function sleepMarks(r:Resident):PixelMark[] {
 const c=new Pixels(),p=projectIsometric({x:r.at.x+.5,y:r.at.y+.5}),{shirt,skin,hair}=residentColors(r.appearance),small=r.lifeStage==='child'?3:r.lifeStage==='teen'?1:0;
 c.rect(m.rockInk,p.x+7-small,p.y-5,4,3);c.rect(m.rockShade,p.x+1,p.y-7,8-small,5);
 c.rect(shirt,p.x-6+small,p.y-8,9-small,7);c.rect(skin,p.x-6+small,p.y-3,10-small,2);
 c.rect(r.lifeStage==='elder'?m.rockLight:hair,p.x-13+small,p.y-10,8,8);c.rect(skin,p.x-11+small,p.y-8,7,6);c.rect(hair,p.x-13+small,p.y-10,3,8);c.rect(m.ink,p.x-8+small,p.y-6,2);
 return c.marks;
}
interface InteriorEntry {key:string;subject:StudySubject;footprint:Footprint;make:(elapsed:number)=>PixelMark[]|null;animated:boolean;}
interface FloorChunk {marks:PixelMark[];}
export interface IsometricHomeInteriorScene extends IsometricViewportScene {roomId:string;}
export interface HomeInteriorStats {acceptedSnapshots:number;bucketBuilds:number;poseBuilds:number;floorBuilds:number;floorHits:number;cachedChunks:number;cachedMarks:number;visibleCandidates:number;omittedObjects:number;unsupportedObjects:number;unknownLocationCount:number;renderedMarkerCount:number;renderedMarks:number;animationUpdates:number;}
const intersects=(a:Footprint,b:Footprint)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export class IsometricHomeInterior {
 private world:World|null=null;
 private roomId:string|null=null;
 private layout:RoomLayout|null=null;
 private floorKey='';
 private chunks=new Map<string,FloorChunk>();
 private records=new Map<string,InteriorEntry>();
 private buckets=new Map<string,Set<string>>();
 private revision=0;
 private sceneEntries=new WeakMap<IsometricHomeInteriorScene,Map<string,InteriorEntry>>();
 private counters:HomeInteriorStats={acceptedSnapshots:0,bucketBuilds:0,poseBuilds:0,floorBuilds:0,floorHits:0,cachedChunks:0,cachedMarks:0,visibleCandidates:0,omittedObjects:0,unsupportedObjects:0,unknownLocationCount:0,renderedMarkerCount:0,renderedMarks:0,animationUpdates:0};
 get stats():Readonly<HomeInteriorStats>{return {...this.counters,cachedChunks:this.chunks.size,cachedMarks:[...this.chunks.values()].reduce((n,c)=>n+c.marks.length,0)};}
 /** Stage the entire replacement before committing it. Frozen source worlds are never written. */
 accept(snapshot:Snapshot,roomId:string):void {
  const w=snapshot.world;if(w===this.world&&roomId===this.roomId)return;
  if(!w||typeof w.id!=='string'||![w.revision,w.minute].every(Number.isFinite)||w.minute<0)throw new Error('isometric_interior_snapshot');
  const support=homeInteriorSupport(w,roomId);if(!support.supported)throw new Error('isometric_interior_unsupported: '+support.reason);
  const layout=support.layout,records=new Map<string,InteriorEntry>(),buckets=new Map<string,Set<string>>(),seen=new Set<string>();let unsupported=0,unknown=0,poses=0;
  const check=(kind:string,id:string)=>{const key=kind+':'+id;if(typeof id!=='string'||!id||seen.has(key))throw new Error('isometric_interior_duplicate');seen.add(key);};
  const add=(subject:StudySubject,marks:PixelMark[]|InteriorEntry['make'],footprint:Footprint={...subject.at,width:1,height:1},animated=false)=>{
   const key=subject.kind+':'+subject.id,entry={key,subject:{...subject,roomId,at:{...subject.at}},footprint:{...footprint},make:typeof marks==='function'?marks:()=>marks,animated};records.set(key,entry);
   const size=VIEWPORT_LIMITS.chunkSize;
   for(let y=Math.floor(footprint.y/size);y<Math.ceil((footprint.y+footprint.height)/size);y++)for(let x=Math.floor(footprint.x/size);x<Math.ceil((footprint.x+footprint.width)/size);x++){
    const bucket=x+','+y;if(!buckets.has(bucket))buckets.set(bucket,new Set());buckets.get(bucket)!.add(key);
   }
  };
  const mark=(kind:StudySubject['kind'],id:string,at:Vec|null|undefined,reason:string)=>{
   check(kind,id);unsupported++;if(!inRoom(layout,at)){unknown++;return;}add({kind,id,at,placeholder:reason},placeholder(at));
  };
  const workshop=w.buildings.find(b=>b.id===roomId)!.kind==='workshop',fixtures=w.industry?.stations.filter(s=>s.buildingId===roomId&&s.kind==='bench')??[];
  const bench=workshop&&fixtures.length===1&&typeof fixtures[0].id==='string'&&!!fixtures[0].id&&Number.isFinite(fixtures[0].installedAt)&&fixtures[0].installedAt>=0&&fixtures[0].installedAt<=w.minute&&(fixtures[0].removalWorked??0)===0&&layout.slots.find(s=>s.key==='station:bench');
  for(const slot of layout.slots){
   // Care and body bays are navigation destinations, not installed furniture.
   // Actual bodies continue through the separate resident-record marker path.
   if(slot.kind==='care'||slot.kind==='bodyBay')continue;
   // Bench and table share the authoritative footprint. Draw the installed bench once, with its real slot identity.
   if(bench&&slot.key==='table')continue;
   const art=furniture(bench&&slot.key==='station:bench'?{...slot,kind:'table'}:slot);if(!art){mark('roomSlot',slot.key,slot.at,'真实工位记录：'+slot.key+'；未绘制设施外观');continue;}
   check('roomSlot',slot.key);add({kind:'roomSlot',id:slot.key,at:slot.at,...(workshop&&slot.key==='station:bench'?{description:'已登记木工作台，与table共用真实工作位置；不表示有工具或在生产'}:{})},art.marks,art.footprint);
  }
  // A grave's person link may reserve a slot. Only an already-recorded burial time removes the indoor body.
  const residents=new Map(w.residents.map(r=>[r.id,r])),buried=new Set((w.graves??[])
   .filter(g=>typeof g.personId==='string'&&typeof g.buriedAt==='number'&&Number.isFinite(g.buriedAt)&&g.buriedAt>=0&&g.buriedAt<=w.minute)
   .map(g=>g.personId));
  for(const r of w.residents){
   if(r.residency==='outside'||r.regionalLocation)continue;
   if(r.status==='dead'){
    if(buried.has(r.id))continue;
    if(r.body?.carriedBy){const carrier=residents.get(r.body.carriedBy);if(carrier?.inside===roomId&&!carrier.regionalLocation||!carrier&&r.inside===roomId)mark('resident',r.id,null,'遗体搬运记录；未绘制携带姿态，不沿用旧室内坐标');continue;}
    if(r.body?.storedAt&&r.body.storedAt!==r.inside){if(r.inside===roomId||r.body.storedAt===roomId)mark('resident',r.id,null,'遗体暂存记录与室内坐标不一致；精确位置未知');continue;}
   }
   if(r.inside!==roomId)continue;
   // Equivalent to residentRoomPositionKnown, using the single validated layout instead of rebuilding it per person.
   if(!inRoom(layout,r.roomAt)){mark('resident',r.id,null,'未记录居民室内精确位置');continue;}
   if(r.status==='dead'){mark('resident',r.id,r.roomAt,'已故居民原位置记录；未绘制遗体姿态');continue;}
   const visual:PersonVisual=personVisual(w,r);poses++;
   // Preserve original pose evidence; relocating only the drawing anchor cannot make an activity active.
   const resident:Resident={...r,at:{...r.roomAt},appearance:{...r.appearance}};
   const sleeping=visual.pose==='sleep'&&r.lifeStage!=='infant',sleepingMarks=sleeping?sleepMarks(resident):null,cooking=ordinaryCookingVisual(w,r,layout,visual),crafting=ordinaryCraftVisual(w,r,layout,visual),ordinary=cooking??crafting;
   const make=(elapsed:number)=>sleepingMarks??ordinary?.marks(elapsed)??residentMarks(w,resident,elapsed,visual),marks=make(0);
   if(!marks||marks.length>VIEWPORT_LIMITS.residentMarks){mark('resident',r.id,r.roomAt,'居民记录：'+(r.lifeStage??'年龄阶段未知')+'，'+visual.pose+'；此姿态未绘制');continue;}
   check('resident',r.id);add({kind:'resident',id:r.id,at:r.roomAt,...(ordinary?{description:ordinary.description}:{})},make,undefined,!sleeping);
  }
  type Location={inside?:string|null;roomAt?:Vec|null;regional?:unknown};
  const containers=new Map<string,Location>();
  for(const r of [...w.residents,...(w.migration?.contacts??[]).map(c=>c.person)])if(r&&r.residency!=='outside')containers.set('person:'+r.id,{inside:r.inside,roomAt:r.roomAt,regional:r.regionalLocation});
  const stock=(id:string,inventory:Record<string,number|undefined>,location:Location|undefined)=>{if(location){containers.set(id,location);if(location.inside===roomId&&!location.regional&&Object.values(inventory).some(n=>n!>0))mark('estate',id,location.roomAt,'实际室内原址物资记录；未绘制物资外观');}};
  for(const e of w.estates??[]){stock('estate:'+e.personId,e.inventory,e.location);for(const p of e.parcels??[])stock(p.id,p.inventory,p.location);}
  for(const t of w.industry?.tools??[])if(t.location?.inside===roomId&&!t.location.regional)mark('estate','tool:'+t.id,t.location.roomAt,'实际室内工具记录；未绘制工具外观');
  for(const a of w.industry?.animals??[])if(a.status==='alive'){
   const carrier=a.carrierId?containers.get('person:'+a.carrierId):null;
   if(carrier?.inside===roomId&&!carrier.regional)mark('animal',a.id,carrier.roomAt,'随真实携带者的动物记录；未绘制动物或携带姿态');
   else if(a.carrierId&&!carrier&&a.inside===roomId)mark('animal',a.id,null,'动物携带者位置缺失；不沿用旧室内坐标');
   else if(!a.carrierId&&a.inside===roomId)mark('animal',a.id,a.roomAt,'室内动物记录：'+a.kind+'；未绘制动物外观');
   else if(!a.carrierId&&!a.at&&!a.inside&&a.barnId===roomId)mark('animal',a.id,null,'旧动物记录只有建筑归属，缺少室内精确位置');
  }
  // A building-only cargo address is not an exact room point. In particular, never use the 2D resolver's default entry.
  containers.set('public:'+roomId,{inside:roomId});
  for(const b of w.economy?.businesses??[])containers.set('business:'+b.id,{inside:b.buildingId});
  const businesses=new Map((w.economy?.businesses??[]).map(b=>[b.id,b.buildingId]));
  for(const l of w.economy?.listings??[])containers.set('listing:'+l.id,{inside:businesses.get(l.businessId)});
  const pools=new Map((w.household?.pools??[]).map(p=>[p.id,p]));
  for(const p of pools.values()){
   for(const c of p.credits)containers.set('family-stock:'+p.id+':'+c.ownerId,{inside:p.buildingId});
   if(p.buildingId===roomId&&(p.status==='open'||p.credits.some(c=>Object.values(c.inventory).some(n=>n!>0))))mark('household',p.id,null,'家庭共用储物记录；未记录室内精确位置');
  }
  for(const g of w.household?.gifts??[])for(const c of g.segments)containers.set('family-gift:'+g.id+':'+c.ownerId,{inside:pools.get(g.poolId)?.buildingId});
  for(const c of w.industry?.livestockCargo??[])if(c.status==='crated'){
   const location=containers.get(c.container);if(location?.inside===roomId&&!location.regional)mark('crate',c.id,location.roomAt,'真实运输笼记录；未绘制笼内动物或物资外观');
  }
  for(const e of w.culture?.events??[])if(e.buildingId===roomId&&e.preparation.completedAt!==null&&e.preparation.clearedAt===null)mark('culture',e.id,null,'室内筹备记录；未记录具体坐标，不表示活动正在举行');
  const floorKey=JSON.stringify([w.id,roomId,layout.width,layout.height]);
  if(this.floorKey!==floorKey)this.chunks=new Map();
  this.floorKey=floorKey;this.world=w;this.roomId=roomId;this.layout=layout;this.records=records;this.buckets=buckets;this.revision++;
  this.counters={...this.counters,acceptedSnapshots:this.counters.acceptedSnapshots+1,bucketBuilds:this.counters.bucketBuilds+1,poseBuilds:this.counters.poseBuilds+poses,unsupportedObjects:unsupported,unknownLocationCount:unknown};
 }
 private chunk(x:number,y:number):FloorChunk {
  const key=x+','+y,prior=this.chunks.get(key);if(prior){this.chunks.delete(key);this.chunks.set(key,prior);this.counters.floorHits++;return prior;}
  const l=this.layout!,s=VIEWPORT_LIMITS.chunkSize,c={marks:floorMarks({x:x*s,y:y*s,width:Math.min(s,l.width-x*s),height:Math.min(s,l.height-y*s)})};
  this.chunks.set(key,c);this.counters.floorBuilds++;
  let count=[...this.chunks.values()].reduce((n,c)=>n+c.marks.length,0);
  while(this.chunks.size>VIEWPORT_LIMITS.chunks||count>VIEWPORT_LIMITS.chunkMarks){const first=this.chunks.keys().next().value!;count-=this.chunks.get(first)!.marks.length;this.chunks.delete(first);}
  return c;
 }
 render(camera:IsometricCamera,width:number,height:number,elapsed=0):IsometricHomeInteriorScene {
  if(!this.layout||!this.world||!this.roomId)throw new Error('isometric_interior_empty');
  const displayCamera=constrainRoomCamera(camera,this.layout,width,height),bounds=visibleRoomBounds(displayCamera,this.layout,width,height);
  const origin={x:Math.ceil(displayCamera.origin.x/displayCamera.zoom),y:Math.ceil(displayCamera.origin.y/displayCamera.zoom)},sourceWidth=Math.ceil(width/displayCamera.zoom)+2,sourceHeight=Math.ceil(height/displayCamera.zoom)+2;
  const visible=(m:PixelMark)=>m.x+m.width>-origin.x&&m.x<sourceWidth-origin.x&&m.y+m.height>-origin.y&&m.y<sourceHeight-origin.y;
  const terrain:PixelMark[]=[],ids=new Set<string>(),s=VIEWPORT_LIMITS.chunkSize;
  for(let y=Math.floor(bounds.y/s);y<Math.ceil((bounds.y+bounds.height)/s);y++)for(let x=Math.floor(bounds.x/s);x<Math.ceil((bounds.x+bounds.width)/s);x++){
   terrain.push(...this.chunk(x,y).marks.filter(visible));for(const key of this.buckets.get(x+','+y)??[])ids.add(key);
  }
  const center=unprojectIsometric({x:(width/2-displayCamera.origin.x)/displayCamera.zoom,y:(height/2-displayCamera.origin.y)/displayCamera.zoom});
  const distance=(r:InteriorEntry)=>Math.abs(r.footprint.x+r.footprint.width/2-center.x)+Math.abs(r.footprint.y+r.footprint.height/2-center.y);
  const candidates=[...ids].map(id=>this.records.get(id)!).filter(r=>intersects(r.footprint,bounds)).sort((a,b)=>distance(a)-distance(b)||a.key.localeCompare(b.key));
  const selected=candidates.slice(0,VIEWPORT_LIMITS.objects),entries=new Map<string,InteriorEntry>();let omitted=candidates.length-selected.length;
  const animated=selected.filter(r=>r.animated),limit=Math.max(0,Math.floor((VIEWPORT_LIMITS.marks-terrain.length)/VIEWPORT_LIMITS.residentMarks)),admitted=new Set(animated.slice(0,limit).map(r=>r.key));
  let remaining=VIEWPORT_LIMITS.marks-terrain.length-admitted.size*VIEWPORT_LIMITS.residentMarks;const objects:StudyObject[]=[];
  for(const r of selected){
   if(r.animated&&!admitted.has(r.key)){omitted++;continue;}const marks=r.make(elapsed);
   if(!marks||marks.length>(r.animated?VIEWPORT_LIMITS.residentMarks:remaining)){omitted++;continue;}if(!marks.some(visible))continue;
   if(r.animated)entries.set(r.key,r);else remaining-=marks.length;
   objects.push({key:r.key,subject:r.subject,footprint:r.footprint,marks});
  }
  const scene:IsometricHomeInteriorScene={roomId:this.roomId,width:sourceWidth,height:sourceHeight,camera:{origin,zoom:1},displayCamera,bounds,terrain,objects:orderIsometricObjects(objects),snapshotRevision:this.revision,omittedObjects:omitted,unsupportedObjects:this.counters.unsupportedObjects,omitted,renderedMarkerCount:objects.filter(o=>!!o.subject.placeholder).length,unknownLocationCount:this.counters.unknownLocationCount};
  this.sceneEntries.set(scene,entries);this.counters={...this.counters,visibleCandidates:candidates.length,omittedObjects:omitted,renderedMarkerCount:scene.renderedMarkerCount,renderedMarks:terrain.length+objects.reduce((n,o)=>n+o.marks.length,0)};return scene;
 }
 animate(scene:IsometricHomeInteriorScene,elapsed:number):IsometricHomeInteriorScene {
  const entries=this.sceneEntries.get(scene);if(!this.world||scene.roomId!==this.roomId||scene.snapshotRevision!==this.revision||!entries)return scene;
  const objects=scene.objects.map(o=>{const entry=entries.get(o.key);if(!entry)return o;const marks=entry.make(elapsed);if(!marks||marks.length>VIEWPORT_LIMITS.residentMarks)return o;this.counters.animationUpdates++;return {...o,marks};});
  const result={...scene,objects};this.sceneEntries.set(result,entries);this.counters.renderedMarks=result.terrain.length+objects.reduce((n,o)=>n+o.marks.length,0);return result;
 }
}

/** Bounded, read-only continuous world renderer. Never allocates a world-sized image. */
import type {Snapshot,World,Vec,Season} from '../shared/types.js';
import {calendar,daylight} from '../world/time.js';
import {projectIsometric,unprojectIsometric,orderIsometricObjects,type IsometricCamera,type Footprint} from './isometric-projection.js';
import {terrain,treeMarks,plotMarks,noise,recordMarkerMarks,type IsometricStudy,type StudyObject,type StudySubject} from './isometric-study.js';
import type {PixelMark} from './work-art.js';
import {beastMarks,beastLabel,beastArtSupported,livestockMarks,livestockLabel,livestockArtSupported,fishMarks,fishLabel,fishComposition,graveMarks,graveLabel,LIVING_MARK_LIMIT} from './isometric-living.js';
import {estatePiles} from './estate-custody.js';
import {crateLocation} from '../world/livestock-cargo.js';
import {buildingMarks,buildingArtSupported,buildingLabel,constructionMarks,constructionLabel,buildingFootprint,BUILDING_FOOTPRINT_LIMIT} from './isometric-buildings.js';
import {resourceMarks,resourceArtSupported,resourceLabel,orchardMarks,orchardArtSupported,orchardLabel} from './isometric-resources.js';
import {prepareIsometricResidents,RESIDENT_MARK_LIMIT,type IsometricResidentHiddenReason} from './isometric-residents.js';
export const VIEWPORT_LIMITS={cells:40,halo:64,objects:192,objectChecks:384,marks:60000,residentMarks:RESIDENT_MARK_LIMIT,chunkSize:8,chunks:64,chunkMarks:100000,tileMarks:28} as const;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
function dimensions(width:number,height:number){if(![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=16384))throw new Error('isometric_viewport_dimensions');}
// Two rounded cell endpoints can add two cells to the continuous inverse AABB.
function minZoom(width:number,height:number){return (width/32+height/16)/(VIEWPORT_LIMITS.cells-2-VIEWPORT_LIMITS.halo*2*(1/32+1/16));}
export function constrainWorldCamera(camera:IsometricCamera,w:World,width:number,height:number):IsometricCamera{
 dimensions(width,height);if(![camera.origin.x,camera.origin.y,camera.zoom].every(Number.isFinite)||camera.zoom<=0)throw new Error('isometric_viewport_camera');
 const zoom=Math.max(minZoom(width,height),Math.min(8,camera.zoom));
 const center=unprojectIsometric({x:(width/2-camera.origin.x)/camera.zoom,y:(height/2-camera.origin.y)/camera.zoom});
 const p=projectIsometric({x:clamp(center.x,0,w.map.width),y:clamp(center.y,0,w.map.height)});
 return {zoom,origin:{x:width/2-p.x*zoom,y:height/2-p.y*zoom}};
}
export function fitWorldCamera(w:World,at:Vec,width:number,height:number,zoom=1):IsometricCamera{
 const p=projectIsometric(at);return constrainWorldCamera({zoom,origin:{x:width/2-p.x*zoom,y:height/2-p.y*zoom}},w,width,height);
}
export function zoomWorldCamera(camera:IsometricCamera,w:World,width:number,height:number,anchor:Vec,delta:number):IsometricCamera{
 const zoom=Math.max(minZoom(width,height),Math.min(8,camera.zoom+delta));
 return constrainWorldCamera({zoom,origin:{x:anchor.x-(anchor.x-camera.origin.x)*zoom/camera.zoom,y:anchor.y-(anchor.y-camera.origin.y)*zoom/camera.zoom}},w,width,height);
}
export function visibleWorldBounds(camera:IsometricCamera,w:World,width:number,height:number):Footprint{
 dimensions(width,height);const c=constrainWorldCamera(camera,w,width,height),h=VIEWPORT_LIMITS.halo;
 const points=[[-h,-h],[width/c.zoom+h,-h],[-h,height/c.zoom+h],[width/c.zoom+h,height/c.zoom+h]].map(([x,y])=>unprojectIsometric({x:x-c.origin.x/c.zoom,y:y-c.origin.y/c.zoom}));
 const x=clamp(Math.floor(Math.min(...points.map(p=>p.x))),0,w.map.width),y=clamp(Math.floor(Math.min(...points.map(p=>p.y))),0,w.map.height);
 return {x,y,width:clamp(Math.ceil(Math.max(...points.map(p=>p.x))),0,w.map.width)-x,height:clamp(Math.ceil(Math.max(...points.map(p=>p.y))),0,w.map.height)-y};
}
interface RecordEntry {key:string;subject:StudySubject;footprint:Footprint;make:(elapsed:number)=>PixelMark[]|null;animationBudget?:number;fallbackReason?:string;anchor?:Vec;paintBounds?:Footprint;}
type ResidentReason={kind:'fallback';reason:string}|{kind:'hidden';reason:string;hiddenReason:IsometricResidentHiddenReason};
interface Chunk {bounds:Footprint;signature:string;marks:PixelMark[];}
export interface ViewportStats {acceptedSnapshots:number;bucketBuilds:number;poseBuilds:number;cachedChunks:number;cachedMarks:number;chunkBuilds:number;chunkHits:number;chunkInvalidations:number;visibleCandidates:number;objectChecks:number;omittedObjects:number;unsupportedObjects:number;renderedMarks:number;animationUpdates:number;renderedMarkerCount:number;unknownLocationCount:number;}
export interface IsometricViewportScene extends IsometricStudy {displayCamera:IsometricCamera;snapshotRevision:number;omittedObjects:number;unsupportedObjects:number;omitted:number;renderedMarkerCount:number;unknownLocationCount:number;uncheckedObjects?:number;}
const intersects=(a:Footprint,b:Footprint)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
function markBounds(marks:PixelMark[]):Footprint{
 let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const m of marks){x=Math.min(x,m.x);y=Math.min(y,m.y);right=Math.max(right,m.x+m.width);bottom=Math.max(bottom,m.y+m.height);}return {x,y,width:right-x,height:bottom-y};
}
function signature(w:World,b:Footprint,season:Season){
 const values:string[]=[w.id,String(w.seed),String(w.map.width),String(w.map.height),season];
 for(let y=Math.max(0,b.y-1);y<Math.min(w.map.height,b.y+b.height+1);y++)for(let x=Math.max(0,b.x-1);x<Math.min(w.map.width,b.x+b.width+1);x++)values.push(w.map.tiles[y*w.map.width+x]);
 return values.join('|');
}
function shade(marks:PixelMark[],darkness:number){if(!darkness)return marks;const colors=new Map<string,string>();return marks.map(m=>{
 let color=colors.get(m.color);if(!color){const n=parseInt(m.color.slice(1),16);color='#'+[16,8,0].map(shift=>Math.round((n>>shift&255)*(1-darkness)).toString(16).padStart(2,'0')).join('');colors.set(m.color,color);}return {...m,color};
});}
export class IsometricViewport {
 private world:World|null=null;
 private records=new Map<string,RecordEntry>();
 private residentReasons=new Map<string,ResidentReason>();
 private buckets=new Map<string,Set<string>>();
 private chunks=new Map<string,Chunk>();
 private revision=0;
 private priorityKey:string|null=null;
 private sceneEntries=new WeakMap<IsometricViewportScene,Map<string,RecordEntry>>();
 private counters:ViewportStats={acceptedSnapshots:0,bucketBuilds:0,poseBuilds:0,cachedChunks:0,cachedMarks:0,chunkBuilds:0,chunkHits:0,chunkInvalidations:0,visibleCandidates:0,objectChecks:0,omittedObjects:0,unsupportedObjects:0,renderedMarks:0,animationUpdates:0,renderedMarkerCount:0,unknownLocationCount:0};
 get stats():Readonly<ViewportStats>{return {...this.counters,cachedChunks:this.chunks.size,cachedMarks:[...this.chunks.values()].reduce((n,c)=>n+c.marks.length,0)};}
 /** Selection affects admission order only. It never changes an object's coordinates or depth. */
 prioritize(key:string|null){this.priorityKey=key;}
 /** Resolve from the same accepted evidence used for art, including verified carrier locations. */
 residentTarget(id:string):{kind:'render'|'fallback'|'hidden';hiddenReason?:IsometricResidentHiddenReason;at:Vec|null;anchor:Vec|null;reason:string|null}|null{
  const r=this.records.get('resident:'+id);
  if(r)return {kind:r.subject.placeholder?'fallback':'render',at:{...r.subject.at},anchor:{...(r.anchor??r.subject.at)},reason:r.subject.placeholder??null};
  const result=this.residentReasons.get(id);return result?{...result,at:null,anchor:null}:null;
 }
 /** Build all replacement state locally. A failed snapshot changes nothing, even on retry. */
 accept(snapshot:Pick<Snapshot,'world'>):void {
  const w=snapshot.world;
  if(this.world===w)return;
  if(!w||typeof w.id!=='string'||![w.seed,w.minute,w.revision].every(Number.isFinite)||w.minute<0||!w.map||![w.map.width,w.map.height].every(n=>Number.isInteger(n)&&n>0)||!Array.isArray(w.map.tiles)||w.map.tiles.length!==w.map.width*w.map.height||!w.map.tiles.every(t=>typeof t==='string')||!w.definitions)throw new Error('isometric_viewport_snapshot');
  const season=calendar(w.minute).season,records=new Map<string,RecordEntry>(),buckets=new Map<string,Set<string>>(),residentReasons=new Map<string,ResidentReason>();let unsupported=0,poses=0,unknown=0;
  const add=(record:RecordEntry)=>{
   if(records.has(record.key))throw new Error('isometric_viewport_duplicate');records.set(record.key,record);
   const b=record.footprint;for(let y=Math.floor(b.y/8);y<=Math.floor((b.y+b.height-1)/8);y++)for(let x=Math.floor(b.x/8);x<=Math.floor((b.x+b.width-1)/8);x++){
    const key=x+','+y;if(!buckets.has(key))buckets.set(key,new Set());buckets.get(key)!.add(record.key);
   }
  };
  const seen=new Set<string>();
  const known=(at:Vec|undefined):at is Vec=>!!at&&[at.x,at.y].every(Number.isInteger)&&at.x>=0&&at.y>=0&&at.x<w.map.width&&at.y<w.map.height;
  const check=(kind:string,v:{id:string;at?:Vec})=>{if(!v||typeof v.id!=='string')throw new Error('isometric_viewport_record');const key=kind+':'+v.id;if(seen.has(key))throw new Error('isometric_viewport_duplicate');seen.add(key);};
  const entry=(kind:StudySubject['kind'],v:{id:string;at:Vec},make:RecordEntry['make'],width=1,height=1):RecordEntry=>({key:kind+':'+v.id,subject:{kind,id:v.id,at:{...v.at}},footprint:{...v.at,width,height},make});
  const marker=(kind:StudySubject['kind'],v:{id:string;at?:Vec},reason:string,width=1,height=1)=>{
   unsupported++;if(!known(v.at)){unknown++;return;}
   const at={...v.at},marks=recordMarkerMarks(at);
   // Keep a valid recorded footprint for cross-bucket visibility, without unbounded bucket allocation.
   const safe=Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0&&width+height<=BUILDING_FOOTPRINT_LIMIT&&at.x+width<=w.map.width&&at.y+height<=w.map.height;
   const record=entry(kind,{id:v.id,at},()=>marks,safe?width:1,safe?height:1);record.paintBounds=markBounds(marks);record.subject.placeholder=reason+(!safe?'；足迹无效或超出索引上限，仅标记原锚点':'');add(record);
  };
  const detailed=(kind:StudySubject['kind'],v:{id:string;at:Vec},make:RecordEntry['make'],description:string,width=1,height=1)=>{
   const record=entry(kind,v,make,width,height);record.subject.description=description;record.fallbackReason=description+'；详细外观未支持或超出单对象绘制上限';add(record);
  };
  for(const name of ['buildings','resources','plots','graves','residents'] as const)if(!Array.isArray(w[name]))throw new Error('isometric_viewport_records');
  for(const b of w.buildings){
   check('building',b);if(![b.width,b.height].every(n=>Number.isInteger(n)&&n>0&&n<=Math.max(w.map.width,w.map.height)))throw new Error('isometric_viewport_footprint');
   if(!b.door||![b.door.x,b.door.y].every(Number.isFinite))throw new Error('isometric_viewport_door');
   if(!buildingArtSupported(b)||!known(b.at)||b.at.x+b.width>w.map.width||b.at.y+b.height>w.map.height){marker('building',b,buildingLabel(b)+'；足迹或外观未支持',b.width,b.height);continue;}
   detailed('building',b,()=>buildingMarks(b,season,w.definitions[b.definition]?.data.art),buildingLabel(b),b.width,b.height);
  }
  for(const t of w.resources){
   check('resource',t);if(!known(t.at)){marker('resource',t,'资源位置未记录或超出世界范围');continue;}
   if(t.kind==='tree'){
    if(!Number.isFinite(t.amount))throw new Error('isometric_viewport_resource');
    if(t.amount<0||!Number.isFinite(t.max)||t.max<0||t.amount>t.max){marker('tree',t,'林木实际存量记录无效；不推定枯荣');continue;}
    detailed('tree',t,()=>treeMarks(t.at,season,noise(t.at.x,t.at.y)%3,t.amount<=0),'林木 · 实际余量 '+t.amount+'/'+t.max+'；外观不表示产出');
   }else if(!resourceArtSupported(t))marker('resource',t,resourceLabel(t)+'；详细外观未支持');
   else detailed('resource',t,()=>resourceMarks(t,season),resourceLabel(t));
  }
  for(const p of w.plots){check('plot',p);if(!known(p.at)){marker('plot',p,'Plot position unavailable');continue;}add(entry('plot',p,()=>plotMarks(w,p)));}
  for(const g of w.graves){check('grave',g);const marks=known(g.at)?graveMarks(g,w.minute):null;
   if(!marks){marker('grave',g,graveLabel(g,w.minute));continue;}
   const record=entry('grave',g,()=>marks);record.paintBounds=markBounds(marks);record.subject.description=graveLabel(g,w.minute);add(record);
  }
  for(const r of w.residents)check('resident',r);
  for(const r of prepareIsometricResidents(w)){
   if(r.kind==='hidden'){residentReasons.set(r.id,{kind:r.kind,reason:r.reason,hiddenReason:r.hiddenReason});continue;}
   if(r.kind==='fallback'){residentReasons.set(r.id,{kind:r.kind,reason:r.reason});marker('resident',{id:r.id,at:r.at??undefined},r.reason);continue;}
   poses++;const marks=r.marks(0);if(!marks.length||marks.length>RESIDENT_MARK_LIMIT){marker('resident',r,r.description+'；超出已验证人物绘制范围');continue;}
   const record=entry('resident',r,r.animated?r.marks:()=>marks);record.footprint={...r.footprint};record.anchor={...r.anchor};record.subject.description=r.description;
   record.animationBudget=r.animated?RESIDENT_MARK_LIMIT:undefined;if(!r.animated)record.paintBounds=markBounds(marks);add(record);
  }
  const living=(kind:'animal'|'beast'|'fish',v:{id:string;at?:Vec},make:RecordEntry['make'],description:string,supported=true)=>{
   if(!known(v.at)){marker(kind,v,description+'；没有有效户外位置');return;}
   if(!supported){marker(kind,v,description+'；外观尚未支持');return;}
   const record=entry(kind,{id:v.id,at:v.at},make);record.animationBudget=LIVING_MARK_LIMIT;record.subject.description=description;add(record);
  };
  for(const a of w.industry?.animals??[]){check('animal',a);if(a.status!=='alive'||a.inside)continue;
   if(a.carrierId){const carrier=w.residents.find(r=>r.id===a.carrierId);marker('animal',{id:a.id,at:carrier?.regionalLocation?undefined:a.at},'家畜由 '+a.carrierId+' 护送；护送姿态未接入，仅示实际记录位置');continue;}
   living('animal',a,e=>livestockMarks(a,e),livestockLabel(a),livestockArtSupported(a));
  }
  for(const b of w.frontierHazards?.beasts??[]){check('beast',b);if(b.status!=='alive')continue;living('beast',b,e=>beastMarks(b,e),beastLabel(b),beastArtSupported(b));}
  for(const [id,f] of Object.entries(w.industry?.fishing??{})){
   const record={id,at:f.shoal?.at};check('fish',record);const composition=fishComposition(f),reason=composition.reason;
   if(reason){marker('fish',record,reason);continue;}
   if(known(record.at)&&w.map.tiles[record.at.y*w.map.width+record.at.x]!=='water'){marker('fish',record,'鱼群记录不在当前水格，不移往猜测水面');continue;}
   living('fish',record,e=>fishMarks(f,e,composition),fishLabel(f));
  }
  for(const p of w.construction?.projects??[]){
   check('project',p);if(!p.reserved||p.status==='completed'||p.status==='removed')continue;
   const footprint=buildingFootprint(p),label=constructionLabel(p,w.minute);
   if(!known(p.at)||!footprint||p.at.x+p.width>w.map.width||p.at.y+p.height>w.map.height){marker('project',p,label+'；足迹不可用',p.width,p.height);continue;}
   detailed('project',p,()=>constructionMarks(p,w.minute),label,p.width,p.height);
  }

  // Match the original outdoor record visibility rules. These are neutral records, not drawn facilities or behaviors.
  const mark=(kind:StudySubject['kind'],v:{id:string;at?:Vec},label:string)=>{check(kind,v);marker(kind,v,label);};
  for(const v of w.infrastructure?.assets??[])if(v.retiredAt===null&&(v.condition<25||['dock','cemetery'].includes(v.kind)))mark('infrastructure',v,'基础设施记录：'+v.kind+'；未绘制外观');
  for(const v of estatePiles(w))if(!v.inside)mark('estate',v,'实际原址物资记录；未绘制物资外观');
  for(const v of w.culture?.events??[])if(v.preparation.completedAt!==null&&v.preparation.clearedAt===null)mark('culture',v,'文化活动筹备记录；不表示活动已举行');
  for(const v of w.household?.pools??[])if(v.status==='open'||v.credits.some(c=>c.coins>0||Object.values(c.inventory).some(n=>n!>0)))mark('household',v,'家庭共用存储记录；未绘制外观');
  for(const v of w.foreignTrade?.shipments??[])if(v.goods>0&&!['completed','cancelled'].includes(v.status))mark('cargo',{id:v.id,at:v.route?.at??undefined},'运输货物记录；仅采用已记录运输位置');
  for(const v of w.industry?.pastures??[]){if(v.status==='retired')continue;const at=v.tiles[0];mark('pasture',{id:v.id,at},'牧场记录：'+v.tiles.length+'块已记录地格；标记位于首块地格，不表示围栏形状');}
  for(const v of w.industry?.pastureProjects??[])if(v.fenceBuilt&&!['completed','removed'].includes(v.status))mark('pastureProject',v,'牧场工程记录；未绘制围栏或完成建筑');
  for(const v of w.industry?.trees??[])if(v.status!=='cut'){
   check('orchard',v);if(!known(v.at)||!orchardArtSupported(v)){marker('orchard',v,orchardLabel(v)+'；详细外观未支持');continue;}
   detailed('orchard',v,()=>orchardMarks(v,season),orchardLabel(v));
  }
  // The shared 2D resolver can retain valley coordinates on regional cargo. Explicitly exclude those records.
  const regionalContainers=new Set<string>();
  for(const r of [...w.residents,...(w.migration?.contacts??[]).map(c=>c.person)])if(r?.regionalLocation)regionalContainers.add('person:'+r.id);
  for(const e of w.estates){if(e.location?.regional)regionalContainers.add('estate:'+e.personId);for(const p of e.parcels??[])if(p.location.regional)regionalContainers.add(p.id);}
  const containers=new Set<string>();for(const v of w.industry?.livestockCargo??[])if(v.status==='crated'&&!containers.has(v.container)){
   containers.add(v.container);if(regionalContainers.has(v.container))continue;const location=crateLocation(w,v);if(location?.inside||location?.origin)continue;
   mark('crate',{id:v.id,at:location?.at??undefined},'运输笼记录；仅采用实际货物位置');
  }
  for(const v of w.ferries?.boats??[])mark('ferry',v,'船只记录；未绘制航行或靠泊姿态');
  if(w.industry?.frontierShore)mark('shore',{id:'village-fishing-shore',at:w.industry.frontierShore},'登记渔岸位置；未绘制设施');
  const chunks=new Map<string,Chunk>();let invalidated=0;
  for(const [key,c] of this.chunks){if(c.signature===signature(w,c.bounds,season))chunks.set(key,c);else invalidated++;}
  if(this.world?.id!==w.id)this.priorityKey=null;
  this.world=w;this.records=records;this.residentReasons=residentReasons;this.buckets=buckets;this.chunks=chunks;this.revision++;
  this.counters={...this.counters,acceptedSnapshots:this.counters.acceptedSnapshots+1,bucketBuilds:this.counters.bucketBuilds+1,poseBuilds:this.counters.poseBuilds+poses,chunkInvalidations:this.counters.chunkInvalidations+invalidated,unsupportedObjects:unsupported,unknownLocationCount:unknown};
 }
 private chunk(x:number,y:number):Chunk{
  const key=x+','+y,existing=this.chunks.get(key);if(existing){this.chunks.delete(key);this.chunks.set(key,existing);this.counters.chunkHits++;return existing;}
  const w=this.world!,bounds={x:x*8,y:y*8,width:Math.min(8,w.map.width-x*8),height:Math.min(8,w.map.height-y*8)},season=calendar(w.minute).season;
  const c={bounds,signature:signature(w,bounds,season),marks:terrain(w,bounds,season,{cutEdges:false,maxTileMarks:VIEWPORT_LIMITS.tileMarks})};
  this.chunks.set(key,c);this.counters.chunkBuilds++;
  let count=[...this.chunks.values()].reduce((n,v)=>n+v.marks.length,0);
  while(this.chunks.size>VIEWPORT_LIMITS.chunks||count>VIEWPORT_LIMITS.chunkMarks){const oldest=this.chunks.keys().next().value!;count-=this.chunks.get(oldest)!.marks.length;this.chunks.delete(oldest);}return c;
 }
 render(camera:IsometricCamera,width:number,height:number,elapsed=0):IsometricViewportScene{
  if(!this.world)throw new Error('isometric_viewport_empty');const w=this.world,displayCamera=constrainWorldCamera(camera,w,width,height),bounds=visibleWorldBounds(displayCamera,w,width,height),darkness=daylight(w.minute).darkness;
  // Cached chunks may cross the requested cell AABB. Keep only marks intersecting the source viewport.
  const origin={x:Math.ceil(displayCamera.origin.x/displayCamera.zoom),y:Math.ceil(displayCamera.origin.y/displayCamera.zoom)},sourceWidth=Math.ceil(width/displayCamera.zoom)+2,sourceHeight=Math.ceil(height/displayCamera.zoom)+2;
  const visible=(m:Footprint)=>m.x+m.width>-origin.x&&m.x<sourceWidth-origin.x&&m.y+m.height>-origin.y&&m.y<sourceHeight-origin.y;
  let ground:PixelMark[]=[];
  for(let y=Math.floor(bounds.y/8);y<Math.ceil((bounds.y+bounds.height)/8);y++)for(let x=Math.floor(bounds.x/8);x<Math.ceil((bounds.x+bounds.width)/8);x++)ground.push(...this.chunk(x,y).marks.filter(visible));
  const ids=new Set<string>();for(let y=Math.floor(bounds.y/8);y<Math.ceil((bounds.y+bounds.height)/8);y++)for(let x=Math.floor(bounds.x/8);x<Math.ceil((bounds.x+bounds.width)/8);x++)for(const key of this.buckets.get(x+','+y)??[])ids.add(key);
  // Exact static bounds are cheap to reject and never use one phase to cull an animated pose.
  const candidates=[...ids].map(key=>this.records.get(key)!).filter(r=>intersects(r.footprint,bounds)&&(!r.paintBounds||visible(r.paintBounds)));
  const center=unprojectIsometric({x:(width/2-displayCamera.origin.x)/displayCamera.zoom,y:(height/2-displayCamera.origin.y)/displayCamera.zoom});
  const distance=(r:RecordEntry)=>Math.abs(r.footprint.x+r.footprint.width/2-center.x)+Math.abs(r.footprint.y+r.footprint.height/2-center.y);
  candidates.sort((a,b)=>Number(b.key===this.priorityKey)-Number(a.key===this.priorityKey)||distance(a)-distance(b)||a.key.localeCompare(b.key));
  const entries=new Map<string,RecordEntry>();let omitted=0,checks=0,unchecked=0;
  // Reserve a neutral marker for each admitted record before detailed art. Animated art reserves its full future phase budget.
  const markerSize=recordMarkerMarks({x:0,y:0}).length;let remaining=VIEWPORT_LIMITS.marks-ground.length-Math.min(candidates.length,VIEWPORT_LIMITS.objects)*markerSize,budgetMarkers=0;
  const objects:StudyObject[]=[];
  for(let index=0;index<candidates.length;index++){
   // Refill slots skipped by truly screen-external art, while bounding expensive first-time art checks.
   if(objects.length>=VIEWPORT_LIMITS.objects||checks>=VIEWPORT_LIMITS.objectChecks){unchecked=candidates.length-index;omitted+=unchecked;break;}
   const r=candidates[index];checks++;
   let marks=r.make(elapsed),subject=r.subject;
   if(!marks||marks.length>(r.animationBudget??Infinity)){
    this.counters.unsupportedObjects++;subject={...subject,placeholder:r.fallbackReason??'当前记录的详细外观不可用；保留原身份与位置'};marks=recordMarkerMarks(subject.at);
    // Cache the failed art decision in this snapshot's private index, never on the source record.
    const fallback=marks;r.subject=subject;r.make=()=>fallback;r.animationBudget=undefined;
   }
   if(!r.animationBudget)r.paintBounds=markBounds(marks);
   if(!marks.some(visible))continue;
   const budget=subject.placeholder?marks.length:r.animationBudget??marks.length;
   if(budget>remaining+markerSize){
    subject={...subject,placeholder:'当前绘制预算不足；仅显示原记录位置，详细外观可回2D查看'};marks=recordMarkerMarks(subject.at);budgetMarkers++;
    if(!marks.some(visible)){omitted++;budgetMarkers--;continue;}
   }else{
    remaining+=markerSize-budget;if(r.animationBudget&&!subject.placeholder)entries.set(r.key,r);
   }
   if(remaining<0){omitted++;remaining+=markerSize;continue;}
   objects.push({key:r.key,subject,footprint:r.footprint,marks:shade(marks,darkness)});
  }
  const sorted=[...orderIsometricObjects(objects.filter(o=>o.subject.kind==='plot')),...orderIsometricObjects(objects.filter(o=>o.subject.kind!=='plot'))];
  ground=shade(ground,darkness);
  const scene:IsometricViewportScene={width:sourceWidth,height:sourceHeight,camera:{origin,zoom:1},displayCamera,bounds,terrain:ground,objects:sorted,snapshotRevision:this.revision,omittedObjects:omitted,unsupportedObjects:this.counters.unsupportedObjects,omitted,renderedMarkerCount:objects.filter(o=>!!o.subject.placeholder).length,unknownLocationCount:this.counters.unknownLocationCount,budgetMarkerCount:budgetMarkers,uncheckedObjects:unchecked};
  this.sceneEntries.set(scene,entries);this.counters={...this.counters,visibleCandidates:candidates.length,objectChecks:checks,omittedObjects:omitted,renderedMarkerCount:scene.renderedMarkerCount,renderedMarks:ground.length+objects.reduce((n,o)=>n+o.marks.length,0)};return scene;
 }
 animate(scene:IsometricViewportScene,elapsed:number):IsometricViewportScene{
  const entries=this.sceneEntries.get(scene);if(!this.world||scene.snapshotRevision!==this.revision||!entries)return scene;
  const nextEntries=new Map(entries);let unsupported=0;
  const darkness=daylight(this.world.minute).darkness,objects=scene.objects.map(o=>{const r=entries.get(o.key);if(!r)return o;const marks=r.make(elapsed);if(!marks||marks.length>r.animationBudget!){
   unsupported++;nextEntries.delete(o.key);return {...o,subject:{...o.subject,placeholder:'当前显示相位超出已验证绘制范围；保留原记录位置'},marks:shade(recordMarkerMarks(o.subject.at),darkness)};
  }this.counters.animationUpdates++;return {...o,marks:shade(marks,darkness)};});
  const result={...scene,objects,unsupportedObjects:scene.unsupportedObjects+unsupported,renderedMarkerCount:scene.renderedMarkerCount+unsupported};this.sceneEntries.set(result,nextEntries);this.counters.renderedMarks=result.terrain.length+objects.reduce((n,o)=>n+o.marks.length,0);return result;
 }
}

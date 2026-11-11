/** Independent, read-only art study. Not imported by the production scene. */
import type {Building,Plot,Resident,Season,Vec,World} from '../shared/types.js';
import {Pixels,type Ink} from './isometric-pixels.js';
export {Pixels} from './isometric-pixels.js';
import {graveMarks,graveLabel} from './isometric-living.js';
import {buildingMarks,buildingFootprint,buildingLabel,constructionMarks,constructionLabel} from './isometric-buildings.js';
import {resourceMarks,resourceLabel,orchardMarks,orchardLabel} from './isometric-resources.js';
import {prepareIsometricResidents,RESIDENT_MARK_LIMIT} from './isometric-residents.js';
import {calendar,DAY} from '../world/time.js';
import {materials as m,palette,residentColors} from './palette.js';
import {isWorkPose,personVisual,personAnimationFrame} from './person-pose.js';
import {workPicture,type PixelMark} from './work-art.js';
import {orderIsometricObjects,projectIsometric,projectedFacing,pickIsometricTile,stableCoordinateFloor,type Footprint,type IsometricCamera} from './isometric-projection.js';

export interface StudySubject {kind:'building'|'tree'|'plot'|'resident'|'grave'|'resource'|'animal'|'beast'|'fish'|'project'|'infrastructure'|'estate'|'culture'|'household'|'cargo'|'pasture'|'pastureProject'|'orchard'|'crate'|'ferry'|'shore'|'roomSlot';id:string;at:Vec;placeholder?:string;description?:string;roomId?:string;}
export interface StudyObject {key:string;footprint:Footprint;subject:StudySubject;marks:PixelMark[];}
export interface IsometricStudy {width:number;height:number;camera:IsometricCamera;bounds:Footprint;terrain:PixelMark[];objects:StudyObject[];omittedObjects?:number;unsupportedObjects?:number;renderedMarkerCount?:number;unknownLocationCount?:number;budgetMarkerCount?:number;}
export function noise(x:number,y:number,salt=0){let n=Math.imul(x+37,374761393)^Math.imul(y+113,668265263)^salt;n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;}
const cell=(at:Vec|null|undefined):Footprint=>({x:at?.x??NaN,y:at?.y??NaN,width:1,height:1});
const center=(at:Vec)=>projectIsometric({x:at.x+.5,y:at.y+.5});
/** A neutral record marker. It never represents a body, building, animal, or installed equipment. */
export function recordMarkerMarks(at:Vec):PixelMark[]{
 const p=center(at),c=new Pixels();
 c.rect('#d6a64b',p.x-5,p.y-13,11,13);c.rect('#292b32',p.x-4,p.y-12,9,11);
 c.rect('#d6a64b',p.x-2,p.y-10,4);c.rect('#d6a64b',p.x+2,p.y-9,1,3);c.rect('#d6a64b',p.x,p.y-7,2);c.rect('#d6a64b',p.x,p.y-6,1,2);c.rect('#d6a64b',p.x,p.y-2);
 return c.marks;
}
const valid=(at:Vec|null|undefined):at is Vec=>!!at&&Number.isInteger(at.x)&&Number.isInteger(at.y);
function inside(at:Vec,b:Footprint){return valid(at)&&at.x>=b.x&&at.y>=b.y&&at.x<b.x+b.width&&at.y<b.y+b.height;}
function quad(at:Vec,w=1,h=1,z=0){return [{x:at.x,y:at.y},{x:at.x+w,y:at.y},{x:at.x+w,y:at.y+h},{x:at.x,y:at.y+h}].map(p=>projectIsometric(p,z));}
export function terrain(w:World,b:Footprint,season:Season,options:{cutEdges?:boolean;maxTileMarks?:number}={}){
 const c=new Pixels(),p=palette[season],tile=(x:number,y:number)=>w.map.tiles[y*w.map.width+x];
 for(let y=b.y;y<b.y+b.height;y++)for(let x=b.x;x<b.x+b.width;x++){
  const start=c.marks.length;
  const kind=tile(x,y),corners=quad({x,y}),fill=kind==='water'?p.water:kind==='path'?p.path:kind==='soil'?m.earth:kind==='sand'?m.sand:kind==='cliff'?m.cliff:kind==='road'?m.rock:kind==='bridge'?m.wood:p.grass;
  c.polygon(corners,fill);
  for(let n=0;n<(kind==='grass'?7:3);n++){
   const u=(noise(x*17+n,y,w.seed)%80+10)/100,v=(noise(x,y*17+n,w.seed+1)%80+10)/100,q=projectIsometric({x:x+u,y:y+v});
   if(kind==='grass'){
    c.rect(n%3?p.accent:p.light,q.x,q.y,2);if(n===2){c.rect(p.dark,q.x+1,q.y-1,1,2);c.rect(p.light,q.x,q.y-2,1,2);}
   }else if(kind==='water'){c.rect(n?p.deep:p.foam,q.x,q.y,3);if(n===0)c.rect(p.foam,q.x+3,q.y-1,2);}
   else c.rect(kind==='soil'?m.earthShade:kind==='bridge'?m.woodShade:kind==='road'?m.rockLight:p.pathShade,q.x,q.y,2);
  }
  // Only real land-water boundaries get a bank. No invented plants or fish populations.
  if(kind==='water')for(const [dx,dy,a,edge] of [[0,-1,0,1],[1,0,1,2],[0,1,2,3],[-1,0,3,0]]){
   const other=tile(x+dx,y+dy);if(x+dx>=0&&x+dx<w.map.width&&y+dy>=0&&y+dy<w.map.height&&other&&other!=='water'&&other!=='bridge'){
    c.line(p.bank,corners[a],corners[edge],2);c.line(p.foam,{x:corners[a].x,y:corners[a].y+2},{x:corners[edge].x,y:corners[edge].y+2});
   }
  }
  // The cut edge belongs to this illustrative patch, not to world elevation.
  if(options.cutEdges!==false&&y===b.y+b.height-1)c.polygon([corners[3],corners[2],{x:corners[2].x,y:corners[2].y+6},{x:corners[3].x,y:corners[3].y+6}],kind==='water'?p.deep:m.earthShade);
  if(options.cutEdges!==false&&x===b.x+b.width-1)c.polygon([corners[1],corners[2],{x:corners[2].x,y:corners[2].y+6},{x:corners[1].x,y:corners[1].y+6}],kind==='water'?p.deep:m.earth);
  if(options.maxTileMarks!==undefined&&c.marks.length-start>options.maxTileMarks){c.marks.splice(start);c.polygon(corners,fill);}
 }
 return c.marks;
}
export function treeMarks(at:Vec,season:Season,variant:number,stump:boolean){
 const c=new Pixels(),p=palette[season],a=center(at),x=a.x,y=a.y;
 c.oval(p.dark,x+2,y,14,3);
 if(stump){c.rect(m.barkShade,x-6,y-10,12,10);c.oval(m.barkLight,x,y-10,6,3);c.rect(m.wood,x-4,y-11,7);return c.marks;}
 c.line(m.barkShade,{x:x-2,y},{x,y:y-28},5);c.line(m.bark,{x:x-1,y:y-2},{x:x+1,y:y-25},2);c.line(m.barkLight,{x,y:y-3},{x:x+2,y:y-26});
 c.line(m.barkShade,{x:x-6,y:y+1},{x,y:y-7},2);c.line(m.barkShade,{x:x+6,y},{x,y:y-8},2);
 if(variant%3===0){
  for(const [top,rx,h] of [[-45,7,13],[-38,11,16],[-30,15,16],[-22,18,15]])for(let n=0;n<h;n++){
   const half=Math.floor(rx*n/h),notch=n%5===0&&n>2?2:0;c.rect(p.pineInk,x-half+notch,y+top+n,Math.max(1,half*2+1-notch));
   if(half<2)continue;c.rect(p.pine,x+1-half+notch,y+top+n,Math.max(1,half*2-3-notch));if(n%4<2)c.rect(p.pineLight,x+1-half+notch,y+top+n,Math.max(1,half-1));
   if(season==='winter'&&n%6<2)c.rect(p.grass,x-half+notch,y+top+n,Math.max(2,half+2));
  }
 }else if(season==='winter'){
  for(const [dx,dy] of [[-14,-28],[-9,-38],[8,-39],[14,-31],[0,-43]]){c.line(m.barkShade,{x,y:y-22},{x:x+dx,y:y+dy},2);c.line(m.barkLight,{x,y:y-23},{x:x+dx,y:y+dy-1});}
 }else{
  const blossom=variant%3===2&&season==='spring',body=blossom?p.blossom:p.leaf,light=blossom?p.blossomLight:p.leafLight,shade=blossom?p.blossomShade:p.leafShade;
  const lobes=[[-1,-38,9,9],[-9,-31,8,8],[7,-31,9,9],[-13,-24,7,8],[-1,-24,11,12],[11,-22,7,8],[-5,-17,10,7],[5,-16,9,7]];
  for(const [dx,dy,rx,ry] of lobes)c.oval(p.leafInk,x+dx,y+dy,rx,ry);
  for(const [dx,dy,rx,ry] of lobes){c.oval(shade,x+dx,y+dy-1,rx-1,ry-1);c.oval(body,x+dx-1,y+dy-2,rx-2,ry-3);for(let i=0;i<4;i++)c.rect(light,x+dx-(noise(i,dx)%Math.max(1,rx-2))-1,y+dy-(noise(dy,i)%Math.max(1,ry-2))-1,3);}
 }
 return c.marks;
}
export function houseMarks(b:Building,season:Season){
 const c=new Pixels(),a=b.at,w=b.width,h=b.height,z=29;
 const point=(x:number,y:number,height=0)=>projectIsometric({x:a.x+x,y:a.y+y},height);
 const [p,q,r,s]=quad(a,w,h),[pt,qt,rt,st]=quad(a,w,h,z),ridgeA=point(0,h/2,47),ridgeB=point(w,h/2,47);
 const clay=['#441910','#58100f','#740e14','#94230e','#b73c19','#d04f26','#e58d34'];
 c.polygon([s,r,{x:r.x+7,y:r.y+4},{x:s.x+7,y:s.y+4}],palette[season].dark);
 c.polygon([q,r,rt,qt],(x,y)=>((y-Math.floor(x/2))%6+6)%6===0?m.woodShade:m.wood,m.barkShade);
 c.polygon([s,r,rt,st],(x,y)=>((y+Math.floor(x/2))%6+6)%6===0?m.woodShade:((y+Math.floor(x/2))%6+6)%6===1?m.woodLight:m.bark,m.barkShade);
 for(const [lo,hi] of [[s,st],[r,rt],[q,qt]]){c.line(m.barkShade,lo,hi,2);c.line(m.woodLight,{x:lo.x+1,y:lo.y},{x:hi.x+1,y:hi.y});}
 // Doors are attached only to a recorded exterior face; no synthetic doorway for unknown sides.
 const front=b.door.y===a.y+h&&b.door.x>=a.x&&b.door.x<a.x+w;
 const side=b.door.x===a.x+w&&b.door.y>=a.y&&b.door.y<a.y+h;
 const feature=(u:number,v:number,onFront:boolean,width:number,height:number,isDoor:boolean)=>{
  const left=point(u,v,isDoor?0:9),right=point(u+(onFront?width:0),v+(onFront?0:width),isDoor?0:9);
  const up=(p:Vec,n:number)=>({x:p.x,y:p.y-n});
  c.polygon([left,right,up(right,height),up(left,height)],isDoor?m.woodShade:'#093261',m.barkShade);
  c.line(m.woodLight,up(left,height),up(right,height));
  c.line(isDoor?m.wood:m.rootLight,up(left,2),up(right,2));
  const mid={x:(left.x+right.x)/2,y:(left.y+right.y)/2};
  c.line(isDoor?m.bark:m.woodLight,up(mid,2),up(mid,height-1));
  if(isDoor)c.rect(m.gold,right.x-3,right.y-height/2,1,2);
  else{c.line('#68d0ed',up(left,height-2),up(mid,height-4));c.line(m.woodLight,up(left,height/2),up(right,height/2));}
 };
 feature(.25,h,true,.5,12,false);if(w>2)feature(w-1,h,true,.5,12,false);feature(w,.35,false,.55,13,false);
 if(front)feature(b.door.x-a.x+.2,h,true,.6,23,true);else if(side)feature(w,b.door.y-a.y+.2,false,.6,23,true);
 c.polygon([qt,rt,ridgeB],m.woodShade,m.barkShade);
 c.line(m.woodLight,point(w,h/2,30),ridgeB);
 const roofInk=(lit:boolean):Ink=>(x,y)=>{
  const row=((y+Math.floor(x/2))%5+5)%5,col=((x+Math.floor(y/5)*3)%9+9)%9;
  if(season==='winter')return row===4?palette.winter.dark:col===0?palette.winter.accent:palette.winter.grass;
  return clay[row===4?lit?2:1:col===0?lit?3:2:row===0?lit?6:5:lit?5:4];
 };
 const eave=(p:Vec,dx:number,dy:number)=>({x:p.x+dx,y:p.y+dy});
 c.polygon([eave(pt,0,-2),eave(qt,3,0),ridgeB,ridgeA],roofInk(false),clay[0]);
 c.polygon([ridgeA,ridgeB,eave(rt,0,3),eave(st,-3,1)],roofInk(true),clay[0]);
 c.line(season==='winter'?palette.winter.light:clay[6],ridgeA,ridgeB);
 c.line(m.woodLight,eave(st,-3,2),eave(rt,0,4));
 return c.marks;
}
export function plotMarks(w:World,plot:Plot){
 const c=new Pixels(),crop=plot.crop,wet=!!crop&&crop.wateredDay===Math.floor(w.minute/DAY);
 c.polygon(quad(plot.at),wet?m.wetEarth:m.earth,m.furrow);
 for(const n of [.22,.5,.78])c.line(m.furrow,projectIsometric({x:plot.at.x+.1,y:plot.at.y+n}),projectIsometric({x:plot.at.x+.9,y:plot.at.y+n}));
 if(!crop||!Number.isFinite(crop.growth))return c.marks;
 const duration=Number(w.definitions[crop.definition]?.data.growthDays);
 if(!Number.isFinite(duration)||duration<=0)return c.marks;
 const growth=Math.max(0,Math.min(1,crop.growth/duration)),height=2+Math.floor(growth*6);
 // Generic foliage only. Unrecognised definitions never masquerade as turnips or ripe yield.
 for(const [dx,dy] of [[.3,.3],[.75,.3],[.3,.75],[.75,.75]]){const p=projectIsometric({x:plot.at.x+dx,y:plot.at.y+dy});c.rect(m.seedlingShade,p.x,p.y-height,1,height);c.rect(m.seedling,p.x-2,p.y-height,3,2);c.rect(m.seedlingLight,p.x+1,p.y-height-1,3,2);}
 return c.marks;
}
/** Legacy room-art adapter. Outdoor scenes use the evidence-resolved resident API below. */
export function residentMarks(w:World,r:Resident,elapsed:number,cachedVisual?:ReturnType<typeof personVisual>){
 const c=new Pixels(),p=center(r.at),visual=cachedVisual??personVisual(w,r);
 if(r.lifeStage==='infant'||(!isWorkPose(visual.pose)&&visual.pose!=='idle'))return null;
 if(isWorkPose(visual.pose)){
  const offset=visual.focus?projectIsometric(visual.focus):null,focus=offset?{x:offset.x/16,y:(offset.y+4)/16}:null;
  const picture=workPicture(r,visual.pose,personAnimationFrame(visual,elapsed),visual.focus?projectedFacing(visual.focus):'south',focus);
  for(const mark of picture.marks)c.rect(mark.color,p.x+mark.x-picture.anchor.x,p.y+mark.y-picture.anchor.y,mark.width,mark.height);
 }else{
  const {shirt,skin,hair}=residentColors(r.appearance),small=r.lifeStage==='child'?5:r.lifeStage==='teen'?2:0;
  c.rect(m.rockInk,p.x-5,p.y-3,4,3);c.rect(m.rockInk,p.x+2,p.y-3,4,3);c.rect(m.rockShade,p.x-4,p.y-8,8,5);
  c.rect(shirt,p.x-5,p.y-15+small,10,9-small);c.rect(skin,p.x-6,p.y-13+small,2,6-small);c.rect(skin,p.x+5,p.y-13+small,2,6-small);
  c.rect(r.lifeStage==='elder'?m.rockLight:hair,p.x-5,p.y-25+small,10,10);c.rect(skin,p.x-4,p.y-21+small,8,8);c.rect(hair,p.x-5,p.y-25+small,10,4);c.rect(m.ink,p.x-2,p.y-19+small);c.rect(m.ink,p.x+2,p.y-19+small);
 }
 return c.marks;
}
export interface StudyOptions {bounds:Footprint;/** Explicit art-sheet phase time, not a world-clock advance. */elapsed?:number;season?:Season;}
export function renderIsometricStudy(w:World,options:StudyOptions):IsometricStudy {
 const b={...options.bounds};
 if(![b.x,b.y,b.width,b.height].every(Number.isInteger)||b.x<0||b.y<0||b.width<1||b.height<1||b.width>32||b.height>32||b.x+b.width>w.map.width||b.y+b.height>w.map.height)throw new Error('isometric_study_bounds');
 const season=options.season??calendar(w.minute).season,objects:StudyObject[]=[],groundMarks=terrain(w,b,season,{maxTileMarks:28});let unsupported=0,unknown=0,omitted=0,budgetMarkers=0,remaining=60000-groundMarks.length;
 const seen=new Set<string>();
 for(const [kind,records] of [['building',w.buildings],['resource',w.resources],['plot',w.plots],['grave',w.graves],['resident',w.residents],['project',w.construction?.projects??[]],['orchard',w.industry?.trees??[]]] as const)for(const r of records){
  if(!r||typeof r.id!=='string')throw new Error('isometric_study_record');const key=kind+':'+r.id;if(seen.has(key))throw new Error('isometric_study_duplicate');seen.add(key);
 }
 const add=(subject:StudySubject,footprint:Footprint,marks:PixelMark[])=>{
  if(objects.length>=192){omitted++;return;}
  if(marks.length>remaining){subject={...subject,placeholder:'合成样板绘制预算不足；仅显示原记录位置'};marks=recordMarkerMarks(subject.at);budgetMarkers++;}
  if(marks.length>remaining){omitted++;budgetMarkers--;return;}remaining-=marks.length;objects.push({key:subject.kind+':'+subject.id,subject,footprint,marks});
 };
 const known=(at:Vec|null|undefined):at is Vec=>!!at&&valid(at)&&at.x>=0&&at.y>=0&&at.x<w.map.width&&at.y<w.map.height;
 const contained=(p:Footprint,bounds:Footprint)=>p.x>=bounds.x&&p.y>=bounds.y&&p.x+p.width<=bounds.x+bounds.width&&p.y+p.height<=bounds.y+bounds.height;
 const fallback=(subject:StudySubject,reason:string,footprint=cell(subject.at))=>{unsupported++;if(!known(subject.at)){unknown++;return;}if(inside(subject.at,b))add({...subject,placeholder:reason},footprint,recordMarkerMarks(subject.at));else omitted++;};
 const record=(subject:StudySubject,footprint:Footprint|null,make:()=>PixelMark[]|null)=>{
  if(!known(subject.at)){fallback(subject,'此记录没有可核实的世界坐标');return;}
  if(!footprint||!contained(footprint,{x:0,y:0,width:w.map.width,height:w.map.height})){if(inside(subject.at,b))fallback(subject,(subject.description??'记录')+'；足迹无效或越出世界');return;}
  if(footprint.x>=b.x+b.width||footprint.x+footprint.width<=b.x||footprint.y>=b.y+b.height||footprint.y+footprint.height<=b.y)return;
  if(!contained(footprint,b)){fallback(subject,'实体跨出本合成样板范围；完整外观请用连续观察',footprint);return;}
  const marks=make();if(!marks?.length){fallback(subject,(subject.description??'记录')+'；详细外观未支持或超出单对象绘制上限',footprint);return;}
  add(subject,footprint,marks);
 };
 for(const plot of w.plots)if(inside(plot.at,b))add({kind:'plot',id:plot.id,at:{...plot.at}},cell(plot.at),plotMarks(w,plot));
 for(const r of w.resources)record({kind:r.kind==='tree'?'tree':'resource',id:r.id,at:{...r.at},description:resourceLabel(r)},cell(r.at),()=>r.kind==='tree'?Number.isFinite(r.amount)&&r.amount>=0&&Number.isFinite(r.max)&&r.max>=r.amount?treeMarks(r.at,season,noise(r.at.x,r.at.y)%3,r.amount===0):null:resourceMarks(r,season));
 for(const building of w.buildings)record({kind:'building',id:building.id,at:{...building.at},description:buildingLabel(building)},buildingFootprint(building),()=>buildingMarks(building,season,w.definitions[building.definition]?.data.art));
 for(const grave of w.graves)record({kind:'grave',id:grave.id,at:{...grave.at},description:graveLabel(grave,w.minute)},cell(grave.at),()=>graveMarks(grave,w.minute));
 for(const p of w.construction?.projects??[])if(p.reserved&&p.status!=='completed'&&p.status!=='removed')record({kind:'project',id:p.id,at:{...p.at},description:constructionLabel(p,w.minute)},buildingFootprint(p),()=>constructionMarks(p,w.minute));
 for(const t of w.industry?.trees??[])if(t.status!=='cut')record({kind:'orchard',id:t.id,at:{...t.at},description:orchardLabel(t)},cell(t.at),()=>orchardMarks(t,season));
 for(const r of prepareIsometricResidents(w)){
  if(r.kind==='hidden')continue;
  if(r.kind==='fallback'){if(!r.at){unsupported++;unknown++;}else if(inside(r.at,b))fallback({kind:'resident',id:r.id,at:{...r.at}},r.reason);continue;}
  record({kind:'resident',id:r.id,at:{...r.at},description:r.description},r.footprint,()=>{const marks=r.marks(options.elapsed??0);return marks.length<=RESIDENT_MARK_LIMIT?marks:null;});
 }
 // Plot soil is ground cover and cannot cover feet or vertical objects on its tile.
 const ground=objects.filter(o=>o.subject.kind==='plot'),solid=objects.filter(o=>o.subject.kind!=='plot');
 const sorted=[...orderIsometricObjects(ground),...orderIsometricObjects(solid)];
 const top=projectIsometric({x:b.x,y:b.y}),left=projectIsometric({x:b.x,y:b.y+b.height});
 return {width:(b.width+b.height)*16+48,height:(b.width+b.height)*8+104,camera:{origin:{x:24-left.x,y:80-top.y},zoom:1},bounds:b,terrain:groundMarks,objects:sorted,unsupportedObjects:unsupported,unknownLocationCount:unknown,omittedObjects:omitted,renderedMarkerCount:objects.filter(o=>!!o.subject.placeholder).length,budgetMarkerCount:budgetMarkers};
}
/** Pick the foremost painted pixel first, then the ground diamond. A roof never selects the tile behind it. */
export function pickIsometricStudy(scene:IsometricStudy,screen:Vec):StudySubject|{kind:'tile';at:Vec}|null {
 const {camera}=scene;if(![screen.x,screen.y,camera.zoom].every(Number.isFinite)||camera.zoom<=0)return null;
 const x=stableCoordinateFloor((screen.x-camera.origin.x)/camera.zoom,(Math.abs(screen.x)+Math.abs(camera.origin.x))/camera.zoom),y=stableCoordinateFloor((screen.y-camera.origin.y)/camera.zoom,(Math.abs(screen.y)+Math.abs(camera.origin.y))/camera.zoom);
 for(let i=scene.objects.length-1;i>=0;i--){const object=scene.objects[i];if(object.marks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height))return {...object.subject,at:{...object.subject.at}};}
 const at=pickIsometricTile(screen,camera,scene.bounds);return at?{kind:'tile',at}:null;
}
/** Source-native compositing for static review. It is not a browser/game screenshot. */
export function rasterIsometricStudy(scene:IsometricStudy):Uint8Array {
 const {origin}=scene.camera;
 if(scene.camera.zoom!==1||!Number.isInteger(origin.x)||!Number.isInteger(origin.y))throw new Error('isometric_static_raster_camera');
 const data=new Uint8Array(scene.width*scene.height*4);
 for(const mark of [...scene.terrain,...scene.objects.flatMap(o=>o.marks)]){
  const rgb=parseInt(mark.color.slice(1),16);
  for(let y=Math.max(0,mark.y+origin.y);y<Math.min(scene.height,mark.y+origin.y+mark.height);y++)for(let x=Math.max(0,mark.x+origin.x);x<Math.min(scene.width,mark.x+origin.x+mark.width);x++){
   const i=(y*scene.width+x)*4;data[i]=rgb>>>16;data[i+1]=(rgb>>>8)&255;data[i+2]=rgb&255;data[i+3]=255;
  }
 }
 return data;
}

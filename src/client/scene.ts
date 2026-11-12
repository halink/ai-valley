import {observerCameraCenter,type ObserverViewArea} from './observer-view-area.js';
import {residentRoomPositionKnown,roomPositionKnown,type ResidentFollowState,type ResidentFollowResolver} from './resident-follow.js';
import {ObserverNavigation} from './observer-navigation.js';
import type {ObserverSelection} from './observer-map.js';
import {personVisual,personAnimationFrame,personOriginY,type PersonVisual} from './person-pose.js';
import {WorkFeedback,type WorkFeedbackReceipt} from './work-feedback.js';
import {roomHeat} from './rooms-art.js';
import {estatePiles} from './estate-custody.js';
import {roomLayout} from '../shared/rooms.js';
import {teachingPosition} from '../world/education.js';
import Phaser from 'phaser';
import type {Building, Resident, Snapshot, Season, Vec, World} from '../shared/types.js';
import {Outdoors} from './outdoors.js';
import {FORMAL_CENTER} from '../shared/formal-regions.js';
import {calendar,daylight,FAST_DAY_MINUTES} from '../world/time.js';
import * as Art from './art.js';
import {materials,palette} from './palette.js';
import {barnAnimalPoint,ecologyLocation,ecologySummary,resolveEcologySelection,type EcologySelection} from './animal-observation.js';
const rgb=(s:string)=>Number.parseInt(s.slice(1),16);

// Compatibility alias for existing scene consumers; new observers depend on ObserverSelection.
export type SceneSelection=ObserverSelection;
export class ValleyScene extends Phaser.Scene {
 private snapshot:Snapshot|null=null;
 private outdoors!:Outdoors;
 private roomLayer!:Phaser.GameObjects.Container;
 private actors=new Map<string,Phaser.GameObjects.Image>();
 private label!:Phaser.GameObjects.Text;
 private selector!:Phaser.GameObjects.Graphics;
 private night!:Phaser.GameObjects.Rectangle;
 private danger!:Phaser.GameObjects.Graphics;
 private rain!:Phaser.GameObjects.Graphics;
 private waterShine!:Phaser.GameObjects.Graphics;
 private season:Season|null=null;
 private worldId='';
 // Renderer-prepared coordinate space; the public committed room lives in navigation.
 private roomId:string|null=null;
 private roomPictureKey='';
 private roomCamera:{x:number;y:number;zoom:number}|null=null;
 private snapActors=false;
 private selected:SceneSelection=null;
 private drag:{x:number;y:number;camX:number;camY:number;moved:boolean}|null=null;
 private observationArea:ObserverViewArea|null=null;
 private observationResident:string|null=null;
 private manuallyPanned=false;
 setObservationArea(area:ObserverViewArea|null,residentId:string|null){
  if(this.observationResident!==residentId)this.manuallyPanned=false;
  const wasMobile=!!this.observationArea;
  this.observationResident=residentId;this.observationArea=area?{...area}:null;
  if(this.ready)this.observationBounds();
  if(area||wasMobile)this.reframeObservation();
 }
 private observationBounds(){
  if(this.roomId||!this.snapshot)return;
  const c=this.cameras.main,w=this.snapshot.world;
  // Presentation-only margin makes edge residents visible without changing map cells.
  const px=this.observationArea?c.width/c.zoom:0,py=this.observationArea?c.height/c.zoom:0;
  c.setBounds(-px,-py,w.map.width*16+px*2,w.map.height*16+py*2);
 }
 private fitObservedRoom(width:number,height:number){
  const area=this.observationArea;
  if(area&&(area.width<=0||area.height<=0))return;
  this.cameras.main.setZoom(Math.max(.25,Math.min(3.3,((area?.width??this.scale.width)-30)/width,((area?.height??this.scale.height)-(area?30:200))/height)));
  this.centerObserved(width/2,height/2);
 }
 private centerObserved(x:number,y:number){if(this.observationArea&&(this.observationArea.width<=0||this.observationArea.height<=0))return;this.observationBounds();const camera=this.cameras.main;const center=observerCameraCenter({x,y},this.observationArea,camera.zoom);camera.centerOn(center.x,center.y);}
 private reframeObservation(){
  if(!this.ready||this.navigation.followResolver||this.observationArea&&(this.observationArea.width<=0||this.observationArea.height<=0))return;
  if(this.navigation.followState?.status==='following'){this.centerFollow(true);return;}
  if(this.manuallyPanned||!this.observationResident||!this.snapshot)return;
  const resident=this.snapshot.world.residents.find(r=>r.id===this.observationResident);
  if(!resident||resident.regionalLocation||resident.status==='dead'||resident.residency==='outside'||(resident.inside??null)!==this.roomId)return;
  if(this.roomId&&!residentRoomPositionKnown(this.snapshot.world,resident))return;
  if(!this.roomId&&(!Number.isFinite(resident.at.x)||!Number.isFinite(resident.at.y)||resident.at.x<0||resident.at.y<0||resident.at.x>=this.snapshot.world.map.width||resident.at.y>=this.snapshot.world.map.height))return;
  const sprite=this.actors.get(resident.id);
  if(sprite?.visible&&Number.isFinite(sprite.x)&&Number.isFinite(sprite.y))this.centerObserved(sprite.x,sprite.y);
 }
 private ready=false;
 private animationClock=0;
 private animationLastTime:number|null=null;
 private workFeedback=new WorkFeedback();
 private workGlints:Array<{receipt:WorkFeedbackReceipt;started:number}>=[];
 private workSpark!:Phaser.GameObjects.Graphics;
 resetWorkFeedback(){this.workFeedback.reset();this.workGlints=[];}
 onSelection:(selection:SceneSelection)=>void=()=>{};
 onRoom:(building:Building|null)=>void=()=>{};
 onCamera:(zoom:number)=>void=()=>{};
 onFollow:(state:ResidentFollowState|null)=>void=()=>{};
 get followState(){return this.navigation.followState;}
 stopFollowing(manual=false){if(manual)this.manuallyPanned=true;this.navigation.clearFollowing();this.notifyFollow();}
 /** A covered observer owns its camera; removing it immediately revalidates ordinary 2D following. */
 setObserverFollowResolver(resolver:ResidentFollowResolver|null){
  this.navigation.setFollowResolver(resolver);
  if(!resolver&&this.snapshot){const target=this.navigation.observeFollowing(this.snapshot.world);if(target)this.changeRoom(target.roomId);this.notifyFollow();this.centerFollow(true);}
 }
 private notifyFollow(){if(this.navigation.publishFollow())this.onFollow(this.navigation.followState);}
 private notifyRoom(building:Building|null){if(this.snapshot)this.navigation.recordRoom(this.snapshot.world,building?.id??null);this.onRoom(building);}
 constructor(readonly navigation=new ObserverNavigation()){super('valley');}
 create(){
  this.cameras.main.setBackgroundColor(palette[this.season??'spring'].grass);this.cameras.main.roundPixels=true;
  this.outdoors=new Outdoors(this);this.roomLayer=this.add.container(0,0).setVisible(false);
  this.workSpark=this.add.graphics().setDepth(99998);this.waterShine=this.add.graphics().setDepth(1);this.rain=this.add.graphics().setDepth(100000);
  this.label=this.add.text(0,0,'',{fontFamily:'system-ui, sans-serif',fontSize:'11px',color:'#ffe4a1',backgroundColor:'#5b2b2a',padding:{x:5,y:3}}).setOrigin(.5,1).setDepth(100001).setVisible(false);
  this.selector=this.add.graphics().setDepth(100002);
  this.danger=this.add.graphics().setDepth(2);
  this.night=this.add.rectangle(-4096,-4096,16384,16384,rgb(materials.night),1).setOrigin(0).setAlpha(0).setDepth(99999);
  this.input.addPointer(1);
  this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{this.drag={x:p.x,y:p.y,camX:this.cameras.main.scrollX,camY:this.cameras.main.scrollY,moved:false};});
  this.input.on('pointermove',(p:Phaser.Input.Pointer)=>{
   if(this.drag&&p.isDown){const dx=p.x-this.drag.x,dy=p.y-this.drag.y;if(Math.hypot(dx,dy)>6){this.drag.moved=true;this.manuallyPanned=true;this.stopFollowing();this.cameras.main.scrollX=this.drag.camX-dx/this.cameras.main.zoom;this.cameras.main.scrollY=this.drag.camY-dy/this.cameras.main.zoom;}}
   if(!p.isDown)this.hover(p.worldX,p.worldY);
  });
  this.input.on('pointerup',(p:Phaser.Input.Pointer)=>{
   if(this.drag&&!this.drag.moved){this.manuallyPanned=false;this.pick(p.worldX,p.worldY);if(this.selected?.kind==='person'&&this.selected.id===this.observationResident)this.reframeObservation();}this.drag=null;
  });
  this.input.on('wheel',(_p:unknown,_o:unknown,_dx:number,dy:number)=>this.zoom(dy>0?-.15:.15));
  this.scale.on('resize',(size:Phaser.Structs.Size,_base:Phaser.Structs.Size,_display:Phaser.Structs.Size,previousWidth:number,previousHeight:number)=>{
   const camera=this.cameras.main;
   if(this.manuallyPanned){if(previousWidth&&previousHeight)camera.centerOn(camera.scrollX+previousWidth/2,camera.scrollY+previousHeight/2);return;}
   if(this.roomId){const b=this.snapshot?.world.buildings.find(b=>b.id===this.roomId),l=b&&this.snapshot?.world.rooms?roomLayout(this.snapshot.world,b):null;const width=l?l.width*16:256,height=l?l.height*16:208;this.fitObservedRoom(width,height);this.reframeObservation();return;}
   if(this.snapshot&&previousWidth&&previousHeight)camera.centerOn(camera.scrollX+previousWidth/2,camera.scrollY+previousHeight/2);
   this.reframeObservation();
  });
  this.ready=true;if(this.snapshot)this.accept(this.snapshot);
 }
 accept(snapshot:Snapshot){
  this.snapshot=snapshot;if(!this.ready)return;
  const w=snapshot.world,s=calendar(w.minute).season;
  if(this.worldId!==w.id){
   for(const [id,sprite] of this.actors){
    sprite.destroy();
    for(const frame of [0,1,2,3])this.textures.remove(`person-${id}-${frame}`);
   }
   this.actors.clear();this.resetWorkFeedback();this.animationClock=0;this.animationLastTime=null;this.worldId=w.id;this.selected=null;this.stopFollowing();this.roomCamera=null;this.snapActors=true;
   this.roomId=null;this.roomLayer.setVisible(false);this.outdoors.setVisible(true);this.notifyRoom(null);
   const at=this.centerTile();
   this.cameras.main.setBounds(0,0,w.map.width*16,w.map.height*16).setZoom(this.defaultZoom()).centerOn(at.x*16,at.y*16);
   this.onCamera(this.cameras.main.zoom);
  }
  for(const receipt of this.workFeedback.inspect(w))this.workGlints.push({receipt,started:this.animationClock});
  this.season=s;
  this.outdoors.accept(w,s,snapshot.mapRevision??w.id);
  const followTarget=this.navigation.observeFollowing(w);
  if(followTarget)this.changeRoom(followTarget.roomId);
  this.notifyFollow();
  if(!this.roomId)this.cameras.main.setBackgroundColor(palette[s].grass);
  if(this.roomId&&w.rooms){const b=w.buildings.find(b=>b.id===this.roomId);if(b){const key=JSON.stringify([b.id,b.width,b.height,b.capacity,roomHeat(w,b),estatePiles(w).filter(p=>p.inside===b.id),w.culture?.events.filter(e=>e.buildingId===b.id).map(e=>[e.id,e.preparation.completedAt,e.preparation.clearedAt,e.status,e.contributions.map(c=>c.inventory)]),w.industry?.stations.filter(s=>s.buildingId===b.id),w.industry?.animals.filter(n=>n.barnId===b.id||n.inside===b.id).map(n=>[n.id,n.status,n.kind,n.hunger<50,n.thirst<50,!!n.at,n.inside,n.roomAt]),w.industry?.beds.filter(p=>p.buildingId===b.id).map(p=>[p.index,p.crop?.definition,Math.floor(p.crop?.growth??0)])]);if(key!==this.roomPictureKey){this.roomPictureKey=key;this.roomLayer.removeAll(true);if(this.textures.exists('interior'))this.textures.remove('interior');this.textures.addCanvas('interior',Art.interior(b,w));this.roomLayer.add(this.add.image(0,0,'interior').setOrigin(0));}}}
  const roomPeople=this.roomId?w.residents.filter(r=>r.inside===this.roomId&&r.status==='alive'&&r.residency!=='outside'):[];
  const seats=new Map<string,number>();for(const t of w.ferries?.trips??[])t.aboard.forEach((id,index)=>seats.set(id,index));
  for(const r of w.residents){
   // Render only travel already reported by the world; never extrapolate toward a future tile.
   const next=r.activity?.path[0];
   const progress=next?Phaser.Math.Clamp(r.activity?.travelProgress??0,0,1):0;
   const seat=seats.get(r.id);const x=(r.at.x+(next?next.x-r.at.x:0)*progress)*16+8+(seat===undefined?0:(seat%4-1.5)*8);
   const y=(r.at.y+(next?next.y-r.at.y:0)*progress)*16+15+(seat===undefined?0:Math.floor(seat/4)*4-7);
   let sprite=this.actors.get(r.id);
   const visual=personVisual(w,r),look=JSON.stringify([r.status,r.lifeStage,r.appearance,visual]);
   if(sprite&&sprite.getData('look')!==look){for(const frame of [0,1,2,3])this.textures.remove(`person-${r.id}-${frame}`);this.addPersonTextures(r,visual);sprite.setTexture(`person-${r.id}-0`);sprite.setData('look',look);}
   if(!sprite){this.addPersonTextures(r,visual);sprite=this.add.image(x,y,`person-${r.id}-0`);this.actors.set(r.id,sprite);sprite.setData('look',look);}
   sprite.setOrigin(.5,personOriginY(visual.pose)).setData('visual',visual);
   const cycle=JSON.stringify([r.activity?.planId,r.activity?.startedAt,r.activity?.action,visual.pose]);
   if(sprite.getData('cycle')!==cycle){sprite.setData('cycle',cycle);sprite.setData('cycleStarted',this.animationClock);}

   const visible=(r.status==='alive'||r.status==='dead'&&!w.graves.some(g=>g.personId===r.id))&&r.residency!=='outside'&&(this.roomId?r.inside===this.roomId:!r.inside);
   sprite.setVisible(visible);
   sprite.setAngle(0);
   if(this.roomId){
    this.tweens.killTweensOf(sprite);
    const n=roomPeople.findIndex(a=>a.id===r.id),at=residentRoomPositionKnown(w,r)?r.roomAt:null,journey=r.activity?.room;
    const next=journey?.buildingId===this.roomId&&roomPositionKnown(w,this.roomId,journey.path[0])?journey.path[0]:undefined;
    const progress=next&&Number.isFinite(journey?.progress)?Phaser.Math.Clamp(journey!.progress,0,1):0;
    const x=at?(at.x+(next?next.x-at.x:0)*progress)*16+8:teachingPosition(w,r.id)?.x??105+(n%4)*22;
    const y=at?(at.y+(next?next.y-at.y:0)*progress)*16+15:teachingPosition(w,r.id)?.y??145+Math.floor(n/4)*24;
    sprite.setPosition(x,y).setDepth(1000+y);sprite.setData('targetX',null);sprite.setData('targetY',null);
   }
   else if(w.clock.paused||!visible||sprite.getData('targetX')!==x||sprite.getData('targetY')!==y){
    this.tweens.killTweensOf(sprite);sprite.setData('targetX',x);sprite.setData('targetY',y);
    if(this.snapActors||w.clock.paused||!visible||Math.hypot(sprite.x-x,sprite.y-y)>96)sprite.setPosition(x,y);
    else if(Math.hypot(sprite.x-x,sprite.y-y)>.01)this.tweens.add({targets:sprite,x,y,duration:w.clock.realMinutesPerDay<=FAST_DAY_MINUTES?900:1500,ease:'Linear',onUpdate:()=>sprite!.setDepth(sprite!.y)});
    sprite.setDepth(sprite.y);
   }
   const frame=personAnimationFrame(visual,this.animationClock-Number(sprite.getData('cycleStarted')??0),!w.clock.paused&&!!(r.activity?.path.length||r.activity?.room?.path.length));
   sprite.setTexture(`person-${r.id}-${frame}`);
  }
  for(const [id,sprite]of this.actors)if(!w.residents.some(r=>r.id===id)){sprite.destroy();this.actors.delete(id);for(const frame of [0,1,2,3])this.textures.remove(`person-${id}-${frame}`);}
  this.snapActors=false;
  this.centerFollow(true);
  const {darkness}=daylight(w.minute);
  this.night.setAlpha(this.roomId?0:darkness+(w.weather==='rain'?.06:0));
  this.danger.clear();
  if(!this.roomId)for(const hazard of w.frontierHazards?.disasters??[]){
   if(hazard.phase==='ended')continue;
   if(hazard.footprint){
    const color=hazard.kind==='flashFlood'?0x628fbd:0xe0a263;
    this.danger.fillStyle(color,hazard.phase==='active'?.22:.08).lineStyle(1,color,.45);
    for(const at of hazard.footprint)this.danger.fillRect(at.x*16,at.y*16,16,16).strokeRect(at.x*16,at.y*16,16,16);
    continue;
   }
   const x=hazard.at.x*16+8,y=hazard.at.y*16+8,r=(hazard.radius+.5)*16;
   const area=[{x:x-r,y},{x,y:y-r},{x:x+r,y},{x,y:y+r}];
   const color=hazard.kind==='flashFlood'?0x628fbd:0xe0a263;
   this.danger.fillStyle(color,hazard.phase==='active'?.22:.08).fillPoints(area,true);
   this.danger.lineStyle(1.5,color,.65).strokePoints(area,true);
  }
 }
 private addPersonTextures(r:Resident,visual:PersonVisual){for(let i=0;i<4;i++)if(!this.textures.exists(`person-${r.id}-${i}`))this.textures.addCanvas(`person-${r.id}-${i}`,Art.person(r,i,visual.pose,visual.facing,visual.focus));}
 private hover(x:number,y:number){
  const person=[...this.actors.entries()].find(([,s])=>s.visible&&Math.abs(s.x-x)<10&&Math.abs(s.y-y-12)<15);
  if(person){const w=this.snapshot?.world,r=w?.residents.find(r=>r.id===person[0]),schematic=this.roomId&&w&&r&&!residentRoomPositionKnown(w,r);this.label.setText((r?.name??'')+(schematic?'（位置示意）':'')).setPosition(person[1].x,person[1].y-30).setVisible(true);this.input.setDefaultCursor('pointer');}
  else{
   this.label.setVisible(false);
   const b=this.buildingAt(x,y),site=this.projectAt(x,y),subject=this.ecologyAt(x,y);
   const summary=subject&&this.snapshot?ecologySummary(this.snapshot.world,subject):null;
   this.input.setDefaultCursor(b||site||subject?'pointer':'grab');
   if(summary)this.label.setText(summary.name).setPosition(x,y-20).setVisible(true);
   else if(site&&!b)this.label.setText(site.name).setPosition(x,y-24).setVisible(true);
  }
 }
 private ecologyAt(x:number,y:number):EcologySelection|null {
  if(!this.roomId)return this.outdoors.subjectAt(x,y);
  const w=this.snapshot?.world,b=w?.buildings.find(b=>b.id===this.roomId);
  if(!w||!b)return null;
  for(const n of w.industry?.animals??[]){
   const point=n.status==='alive'&&barnAnimalPoint(w,b,n);
   if(point&&Math.abs(x-point.x)<15&&Math.abs(y-point.y+12)<13)return {kind:'animal',id:n.id};
  }
  return null;
 }
 private projectAt(x:number,y:number){return !this.roomId?this.snapshot?.world.construction?.projects.find(p=>p.reserved&&x>=p.at.x*16&&x<(p.at.x+p.width)*16&&y>=p.at.y*16&&y<(p.at.y+p.height)*16):undefined;}
 private buildingAt(x:number,y:number){return !this.roomId?this.snapshot?.world.buildings.find(b=>x>=b.at.x*16&&x<(b.at.x+b.width)*16&&y>=b.at.y*16&&y<(b.at.y+b.height)*16):undefined;}
 private pick(x:number,y:number){
  const person=[...this.actors.entries()].find(([,s])=>s.visible&&Math.abs(s.x-x)<12&&Math.abs(s.y-y-12)<17);
  if(person){if(this.navigation.followState?.personId!==person[0])this.stopFollowing();this.selected={kind:'person',id:person[0]};this.onSelection(this.selected);return;}
  this.stopFollowing();
  const subject=this.ecologyAt(x,y);if(subject){this.selected=subject;this.onSelection(subject);return;}
  const b=this.buildingAt(x,y);if(b){this.selected={kind:'building',id:b.id};this.onSelection(this.selected);return;}
  const p=this.projectAt(x,y);if(p){this.selected={kind:'project',id:p.id};this.onSelection(this.selected);return;}
  this.selected=null;this.onSelection(null);
 }
 clearSelection(){this.manuallyPanned=true;this.selected=null;this.stopFollowing();this.label.setVisible(false);}
 focusPerson(id:string,follow=true){
  if(!this.snapshot)return;
  this.manuallyPanned=false;
  this.selected={kind:'person',id};
  this.navigation.startFollowing(this.snapshot.world,id);
  this.accept(this.snapshot);
  if(!follow)this.stopFollowing();
 }
 focusBuilding(id:string){const b=this.snapshot?.world.buildings.find(b=>b.id===id);if(!b)return;this.manuallyPanned=true;this.stopFollowing();if(this.roomId)this.exitRoom();this.selected={kind:'building',id};this.cameras.main.centerOn((b.at.x+b.width/2)*16,(b.at.y+b.height/2)*16);}
 focusEcology(selection:EcologySelection){
  if(!this.snapshot)return;
  selection=resolveEcologySelection(this.snapshot.world,selection);
  const loc=ecologyLocation(this.snapshot.world,selection);
  if(!loc)return;
  if(loc.roomId)this.enterRoom(loc.roomId);else this.watchTile(loc.at);
  this.stopFollowing();this.selected=selection;
 }
 zoom(delta:number){if(this.roomId)return;const c=this.cameras.main;c.setZoom(Phaser.Math.Clamp(c.zoom+delta,.7,3.5));this.reframeObservation();this.onCamera(c.zoom);}
 cameraTile():Vec {
  if(this.roomId){
   const building=this.snapshot?.world.buildings.find(b=>b.id===this.roomId);
   if(building)return building.door;
  }
  const camera=this.cameras.main;
  return {x:Math.floor((camera.scrollX+camera.width/2)/Art.TILE),y:Math.floor((camera.scrollY+camera.height/2)/Art.TILE)};
 }
 private defaultZoom(){
  if(this.snapshot?.world.scenario==='frontier')return this.scale.width<700?1.2:1.4;
  if(this.snapshot?.world.mode==='formal')return this.scale.width<700?1.25:1;
  return this.scale.width<700?1.6:1.8;
 }
 private centerTile():Vec{return this.snapshot?.world.map.settlement??(this.snapshot?.world.mode==='formal'?FORMAL_CENTER:{x:35,y:29});}
 watchTile(at:Vec){
  this.manuallyPanned=true;
  if(this.roomId)this.exitRoom();
  this.clearSelection();
  this.cameras.main.centerOn(at.x*Art.TILE,at.y*Art.TILE);
 }
 home(){
  if(this.roomId)this.exitRoom();
  this.cameras.main.setZoom(this.defaultZoom());
  this.watchTile(this.centerTile());
 }
 enterRoom(id:string){
  if(!this.snapshot?.world.buildings.some(b=>b.id===id))return;
  this.manuallyPanned=true;this.stopFollowing();this.changeRoom(id);this.accept(this.snapshot);
 }
 exitRoom(){
  this.manuallyPanned=true;this.stopFollowing();if(!this.roomId||!this.snapshot)return;
  this.changeRoom(null);this.accept(this.snapshot);
 }
 /** Change only the viewing coordinate space. Manual entry points cancel follow separately. */
 private changeRoom(id:string|null){
  if(id===this.roomId||!this.snapshot)return;
  const w=this.snapshot.world,camera=this.cameras.main;
  const b=id?w.buildings.find(b=>b.id===id):null;
  if(id&&!b)return;
  if(!this.roomId)this.roomCamera={x:camera.scrollX+camera.width/2,y:camera.scrollY+camera.height/2,zoom:camera.zoom};
  this.roomId=id;this.roomPictureKey='';this.snapActors=true;
  for(const sprite of this.actors.values()){this.tweens.killTweensOf(sprite);sprite.setData('targetX',null);sprite.setData('targetY',null);}
  this.label.setVisible(false);this.selector.clear();this.waterShine.clear();this.rain.clear();
  this.roomLayer.setVisible(!!id);this.outdoors.setVisible(!id);
  if(b){
   camera.setBackgroundColor(materials.ink);this.roomLayer.removeAll(true);
   if(this.textures.exists('interior'))this.textures.remove('interior');this.textures.addCanvas('interior',Art.interior(b,w));
   this.roomLayer.add(this.add.image(0,0,'interior').setOrigin(0));
   const l=w.rooms?roomLayout(w,b):null,width=l?l.width*16:256,height=l?l.height*16:208;
   camera.removeBounds().setZoom(Math.max(.25,Math.min(3.3,(this.scale.width-30)/width,(this.scale.height-200)/height))).centerOn(width/2,height/2);
  }else{
   camera.setBackgroundColor(palette[this.season??'spring'].grass).setBounds(0,0,w.map.width*16,w.map.height*16);
   if(this.roomCamera)camera.setZoom(this.roomCamera.zoom).centerOn(this.roomCamera.x,this.roomCamera.y);
   this.roomCamera=null;
  }
  this.notifyRoom(b??null);this.onCamera(camera.zoom);
 }
 private centerFollow(frameUnknown=false){
  if(this.navigation.followResolver)return;
  const state=this.navigation.followState;if(state?.status!=='following')return;
  if(this.snapshot?.world.residents.find(r=>r.id===state.personId)?.regionalLocation)return;
  if(!state.precise){
   if(!frameUnknown)return;
   const w=this.snapshot?.world,b=w?.buildings.find(b=>b.id===state.roomId);if(!w||!b)return;
   const l=w.rooms?roomLayout(w,b):null,width=l?l.width*16:256,height=l?l.height*16:208;
   this.fitObservedRoom(width,height);return;
  }
  const sprite=this.actors.get(state.personId);if(sprite?.visible)this.centerObserved(sprite.x,sprite.y);
 }
 update(time:number){
  if(!this.snapshot||!this.ready)return;
  const w=this.snapshot.world;
  if(this.animationLastTime!==null&&!w.clock.paused)this.animationClock+=Math.max(0,Math.min(100,time-this.animationLastTime));
  this.animationLastTime=time;
  this.centerFollow();
  this.selector.clear();if(this.selected?.kind==='person'){const s=this.actors.get(this.selected.id),r=w.residents.find(r=>r.id===this.selected!.id);if(s?.visible&&(!this.roomId||r&&residentRoomPositionKnown(w,r))){this.selector.lineStyle(1,rgb(materials.gold),.9).strokeEllipse(s.x,s.y-2,18,7);}}
  if(this.selected&&(this.selected.kind==='animal'||this.selected.kind==='beast'||this.selected.kind==='fish')){
   this.selected=resolveEcologySelection(w,this.selected);
   const loc=ecologyLocation(w,this.selected);
   const at=this.roomId?(loc?.roomId===this.roomId?loc.roomPoint:undefined):this.outdoors.subjectPosition(this.selected);
   if(at)this.selector.lineStyle(1,rgb(materials.gold),.95).strokeEllipse(at.x,at.y-3,26,9);
  }
  if(!w.clock.paused)for(const r of w.residents){const s=this.actors.get(r.id);if(s?.visible){const visual=s.getData('visual') as PersonVisual,moving=!!(this.tweens.isTweening(s)||r.activity?.path.length||r.activity?.room?.path.length);s.setTexture(`person-${r.id}-${personAnimationFrame(visual,this.animationClock-Number(s.getData('cycleStarted')??0),moving)}`);}}
  this.workSpark.clear();this.workGlints=this.workGlints.filter(g=>this.animationClock-g.started<720);
  for(const {receipt,started} of this.workGlints){
   if(receipt.roomId!==this.roomId)continue;
   const at=this.roomId?receipt.roomAt:receipt.place;if(!at)continue;
   const age=this.animationClock-started,x=at.x*16+8,y=at.y*16-12-Math.floor(age/180),spread=1+Math.floor(age/240);
   this.workSpark.fillStyle(rgb(materials.gold),1-age/900).fillRect(x-1,y,3,1).fillRect(x,y-1,1,3).fillRect(x-spread-2,y+2,1,1).fillRect(x+spread+2,y-2,1,1);
  }
  if(!this.roomId){
   this.outdoors.draw(this.cameras.main,time);
   this.waterShine.clear().lineStyle(1,rgb(palette[this.season!].foam),.48);
   for(let i=0;i<35;i++){const x=Math.floor(Art.hash(i,4)*w.map.width),y=Math.floor(Art.hash(i,9)*w.map.height);if(w.map.tiles[y*w.map.width+x]==='water'){const off=Math.sin(time/1800+i)*3;this.waterShine.lineBetween(x*16+off,y*16+8,x*16+off+7,y*16+8);}}
   this.rain.clear();if(w.weather==='rain'){this.rain.lineStyle(1,rgb(materials.rain),.4);const c=this.cameras.main;for(let i=0;i<80;i++){const x=c.worldView.x+Art.hash(i,2)*c.worldView.width;const y=c.worldView.y+((time/8+i*79)%c.worldView.height);this.rain.lineBetween(x,y,x-2,y+8);}}
  }
 }
}

import {personPose} from './person-pose.js';
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

export type SceneSelection={kind:'person'|'building'|'project';id:string}|EcologySelection|null;
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
 private roomId:string|null=null;
 private roomPictureKey='';
 private roomCamera:{x:number;y:number;zoom:number}|null=null;
 private followId:string|null=null;
 private selected:SceneSelection=null;
 private drag:{x:number;y:number;camX:number;camY:number;moved:boolean}|null=null;
 private ready=false;
 private lastAnimation=0;
 onSelection:(selection:SceneSelection)=>void=()=>{};
 onRoom:(building:Building|null)=>void=()=>{};
 onCamera:(zoom:number)=>void=()=>{};
 constructor(){super('valley');}
 create(){
  this.cameras.main.setBackgroundColor(palette[this.season??'spring'].grass);this.cameras.main.roundPixels=true;
  this.outdoors=new Outdoors(this);this.roomLayer=this.add.container(0,0).setVisible(false);
  this.waterShine=this.add.graphics().setDepth(1);this.rain=this.add.graphics().setDepth(100000);
  this.label=this.add.text(0,0,'',{fontFamily:'system-ui, sans-serif',fontSize:'11px',color:'#ffe4a1',backgroundColor:'#5b2b2a',padding:{x:5,y:3}}).setOrigin(.5,1).setDepth(100001).setVisible(false);
  this.selector=this.add.graphics().setDepth(100002);
  this.danger=this.add.graphics().setDepth(2);
  this.night=this.add.rectangle(-4096,-4096,16384,16384,rgb(materials.night),1).setOrigin(0).setAlpha(0).setDepth(99999);
  this.input.addPointer(1);
  this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{this.drag={x:p.x,y:p.y,camX:this.cameras.main.scrollX,camY:this.cameras.main.scrollY,moved:false};});
  this.input.on('pointermove',(p:Phaser.Input.Pointer)=>{
   if(this.drag&&p.isDown&&!this.roomId){const dx=p.x-this.drag.x,dy=p.y-this.drag.y;if(Math.hypot(dx,dy)>6){this.drag.moved=true;this.followId=null;this.cameras.main.scrollX=this.drag.camX-dx/this.cameras.main.zoom;this.cameras.main.scrollY=this.drag.camY-dy/this.cameras.main.zoom;}}
   if(!p.isDown)this.hover(p.worldX,p.worldY);
  });
  this.input.on('pointerup',(p:Phaser.Input.Pointer)=>{
   if(this.drag&&!this.drag.moved)this.pick(p.worldX,p.worldY);this.drag=null;
  });
  this.input.on('wheel',(_p:unknown,_o:unknown,_dx:number,dy:number)=>this.zoom(dy>0?-.15:.15));
  this.scale.on('resize',(size:Phaser.Structs.Size,_base:Phaser.Structs.Size,_display:Phaser.Structs.Size,previousWidth:number,previousHeight:number)=>{
   const camera=this.cameras.main;
   if(this.roomId){const b=this.snapshot?.world.buildings.find(b=>b.id===this.roomId),l=b&&this.snapshot?.world.rooms?roomLayout(this.snapshot.world,b):null;const width=l?l.width*16:256,height=l?l.height*16:208;camera.setZoom(Math.min(3.3,(size.width-30)/width,(size.height-200)/height)).centerOn(width/2,height/2);return;}
   if(this.snapshot&&previousWidth&&previousHeight)camera.centerOn(camera.scrollX+previousWidth/2,camera.scrollY+previousHeight/2);
  });
  this.ready=true;if(this.snapshot)this.accept(this.snapshot);
 }
 accept(snapshot:Snapshot){
  this.snapshot=snapshot;if(!this.ready)return;
  const w=snapshot.world,s=calendar(w.minute).season;
  if(this.worldId!==w.id){
   for(const [id,sprite] of this.actors){
    sprite.destroy();
    for(const frame of [0,1])this.textures.remove(`person-${id}-${frame}`);
   }
   this.actors.clear();this.worldId=w.id;this.selected=null;this.followId=null;
   this.roomId=null;this.roomLayer.setVisible(false);this.outdoors.setVisible(true);this.onRoom(null);
   const at=this.centerTile();
   this.cameras.main.setBounds(0,0,w.map.width*16,w.map.height*16).setZoom(this.defaultZoom()).centerOn(at.x*16,at.y*16);
   this.onCamera(this.cameras.main.zoom);
  }
  this.season=s;
  if(!this.roomId)this.cameras.main.setBackgroundColor(palette[s].grass);
  this.outdoors.accept(w,s,snapshot.mapRevision??w.id);
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
   const pose=personPose(w,r),look=JSON.stringify([r.status,r.lifeStage,r.appearance,pose]);if(sprite&&sprite.getData('look')!==look){for(const frame of [0,1])this.textures.remove(`person-${r.id}-${frame}`);this.addPersonTextures(r,w);sprite.setTexture(`person-${r.id}-0`);sprite.setData('look',look);}
   if(!sprite){this.addPersonTextures(r,w);sprite=this.add.image(x,y,`person-${r.id}-0`).setOrigin(.5,1);this.actors.set(r.id,sprite);sprite.setData('look',look);}
   const visible=(r.status==='alive'||r.status==='dead'&&!w.graves.some(g=>g.personId===r.id))&&r.residency!=='outside'&&(this.roomId?r.inside===this.roomId:!r.inside);
   sprite.setVisible(visible);
   sprite.setAngle(0);
   if(this.roomId){this.tweens.killTweensOf(sprite);const n=roomPeople.findIndex(a=>a.id===r.id),next=r.activity?.room?.path[0],progress=next?r.activity!.room!.progress:0;const x=r.roomAt?(r.roomAt.x+(next?next.x-r.roomAt.x:0)*progress)*16+8:teachingPosition(w,r.id)?.x??105+(n%4)*22,y=r.roomAt?(r.roomAt.y+(next?next.y-r.roomAt.y:0)*progress)*16+15:teachingPosition(w,r.id)?.y??145+Math.floor(n/4)*24;sprite.setPosition(x,y).setDepth(1000+y);sprite.setData('targetX',null);sprite.setData('targetY',null);}
   else if(w.clock.paused||!visible||sprite.getData('targetX')!==x||sprite.getData('targetY')!==y){
    this.tweens.killTweensOf(sprite);sprite.setData('targetX',x);sprite.setData('targetY',y);
    if(w.clock.paused||!visible||Math.hypot(sprite.x-x,sprite.y-y)>96)sprite.setPosition(x,y);
    else if(Math.hypot(sprite.x-x,sprite.y-y)>.01)this.tweens.add({targets:sprite,x,y,duration:w.clock.realMinutesPerDay<=FAST_DAY_MINUTES?900:1500,ease:'Linear',onUpdate:()=>sprite!.setDepth(sprite!.y)});
    sprite.setDepth(sprite.y);
   }
   if(w.clock.paused||this.roomId)sprite.setTexture(`person-${r.id}-0`);
  }
  for(const [id,sprite]of this.actors)if(!w.residents.some(r=>r.id===id)){sprite.destroy();this.actors.delete(id);}
  const {darkness}=daylight(w.minute);
  this.night.setAlpha(this.roomId?0:darkness+(w.weather==='rain'?.06:0));
  this.danger.clear();
  if(!this.roomId)for(const hazard of w.frontierHazards?.disasters??[]){
   if(hazard.phase==='ended')continue;
   const x=hazard.at.x*16+8,y=hazard.at.y*16+8,r=(hazard.radius+.5)*16;
   const area=[{x:x-r,y},{x,y:y-r},{x:x+r,y},{x,y:y+r}];
   const color=hazard.kind==='flashFlood'?0x628fbd:0xe0a263;
   this.danger.fillStyle(color,hazard.phase==='active'?.22:.08).fillPoints(area,true);
   this.danger.lineStyle(1.5,color,.65).strokePoints(area,true);
  }
 }
 private addPersonTextures(r:Resident,w:World){for(let i=0;i<2;i++)if(!this.textures.exists(`person-${r.id}-${i}`))this.textures.addCanvas(`person-${r.id}-${i}`,Art.person(r,i,personPose(w,r)));}
 private hover(x:number,y:number){
  const person=[...this.actors.entries()].find(([,s])=>s.visible&&Math.abs(s.x-x)<10&&Math.abs(s.y-y-12)<15);
  if(person){const r=this.snapshot?.world.residents.find(r=>r.id===person[0]);this.label.setText(r?.name??'').setPosition(person[1].x,person[1].y-30).setVisible(true);this.input.setDefaultCursor('pointer');}
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
  if(person){this.selected={kind:'person',id:person[0]};this.onSelection(this.selected);return;}
  const subject=this.ecologyAt(x,y);if(subject){this.followId=null;this.selected=subject;this.onSelection(subject);return;}
  const b=this.buildingAt(x,y);if(b){this.selected={kind:'building',id:b.id};this.onSelection(this.selected);return;}
  const p=this.projectAt(x,y);if(p){this.selected={kind:'project',id:p.id};this.onSelection(this.selected);return;}
  this.selected=null;this.onSelection(null);
 }
 clearSelection(){this.selected=null;this.followId=null;this.label.setVisible(false);}
 focusPerson(id:string,follow=true){
  const r=this.snapshot?.world.residents.find(r=>r.id===id);if(!r)return;
  if(r.inside)this.enterRoom(r.inside);else if(this.roomId)this.exitRoom();
  this.selected={kind:'person',id};this.followId=follow?id:null;
  const sprite=this.actors.get(id);if(sprite){this.cameras.main.centerOn(sprite.x,sprite.y);this.label.setText(r.name).setPosition(sprite.x,sprite.y-30).setVisible(true);}
 }
 focusBuilding(id:string){const b=this.snapshot?.world.buildings.find(b=>b.id===id);if(!b)return;if(this.roomId)this.exitRoom();this.followId=null;this.selected={kind:'building',id};this.cameras.main.centerOn((b.at.x+b.width/2)*16,(b.at.y+b.height/2)*16);}
 focusEcology(selection:EcologySelection){
  if(!this.snapshot)return;
  selection=resolveEcologySelection(this.snapshot.world,selection);
  const loc=ecologyLocation(this.snapshot.world,selection);
  if(!loc)return;
  if(loc.roomId)this.enterRoom(loc.roomId);else this.watchTile(loc.at);
  this.followId=null;this.selected=selection;
 }
 zoom(delta:number){if(this.roomId)return;const c=this.cameras.main;c.setZoom(Phaser.Math.Clamp(c.zoom+delta,.7,3.5));this.onCamera(c.zoom);}
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
  const b=this.snapshot?.world.buildings.find(b=>b.id===id);if(!b)return;
  if(!this.roomId){
   const camera=this.cameras.main;
   this.roomCamera={x:camera.scrollX+camera.width/2,y:camera.scrollY+camera.height/2,zoom:camera.zoom};
  }
  this.roomId=id;this.roomPictureKey='';this.cameras.main.setBackgroundColor(materials.ink);this.followId=null;this.roomLayer.removeAll(true);
  if(this.textures.exists('interior'))this.textures.remove('interior');this.textures.addCanvas('interior',Art.interior(b,this.snapshot!.world));
  this.roomLayer.add(this.add.image(0,0,'interior').setOrigin(0));this.roomLayer.setVisible(true);this.outdoors.setVisible(false);
  this.waterShine.clear();this.rain.clear();const l=this.snapshot!.world.rooms?roomLayout(this.snapshot!.world,b):null,width=l?l.width*16:256,height=l?l.height*16:208;this.cameras.main.removeBounds().setZoom(Math.min(3.3,(this.scale.width-30)/width,(this.scale.height-200)/height)).centerOn(width/2,height/2);
  this.label.setVisible(false);this.selector.clear();this.onRoom(b);this.accept(this.snapshot!);
 }
 exitRoom(){if(!this.roomId)return;this.roomId=null;this.cameras.main.setBackgroundColor(palette[this.season??'spring'].grass);this.roomLayer.setVisible(false);this.outdoors.setVisible(true);const w=this.snapshot!.world;const c=this.cameras.main;c.setBounds(0,0,w.map.width*16,w.map.height*16);if(this.roomCamera){c.setZoom(this.roomCamera.zoom).centerOn(this.roomCamera.x,this.roomCamera.y);}this.onRoom(null);this.accept(this.snapshot!);}
 update(time:number){
  if(!this.snapshot||!this.ready)return;
  const w=this.snapshot.world;
  if(this.followId&&!this.roomId){const s=this.actors.get(this.followId);if(s?.visible)this.cameras.main.centerOn(s.x,s.y);}
  this.selector.clear();if(this.selected?.kind==='person'){const s=this.actors.get(this.selected.id);if(s?.visible){this.selector.lineStyle(1,rgb(materials.gold),.9).strokeEllipse(s.x,s.y-2,18,7);}}
  if(this.selected&&(this.selected.kind==='animal'||this.selected.kind==='beast'||this.selected.kind==='fish')){
   this.selected=resolveEcologySelection(w,this.selected);
   const loc=ecologyLocation(w,this.selected);
   const at=this.roomId?(loc?.roomId===this.roomId?loc.roomPoint:undefined):this.outdoors.subjectPosition(this.selected);
   if(at)this.selector.lineStyle(1,rgb(materials.gold),.95).strokeEllipse(at.x,at.y-3,26,9);
  }
  if(time-this.lastAnimation>350){this.lastAnimation=time;for(const r of w.residents){const s=this.actors.get(r.id);if(s){const moving=!w.clock.paused&&s.visible&&(this.tweens.isTweening(s)||r.activity?.room?.path.length||['work','celebrate','fish','hunt'].includes(personPose(w,r)));s.setTexture(`person-${r.id}-${moving?Math.floor(time/350)%2:0}`);}}}
  if(!this.roomId){
   this.outdoors.draw(this.cameras.main,time);
   this.waterShine.clear().lineStyle(1,rgb(palette[this.season!].foam),.48);
   for(let i=0;i<35;i++){const x=Math.floor(Art.hash(i,4)*w.map.width),y=Math.floor(Art.hash(i,9)*w.map.height);if(w.map.tiles[y*w.map.width+x]==='water'){const off=Math.sin(time/1800+i)*3;this.waterShine.lineBetween(x*16+off,y*16+8,x*16+off+7,y*16+8);}}
   this.rain.clear();if(w.weather==='rain'){this.rain.lineStyle(1,rgb(materials.rain),.4);const c=this.cameras.main;for(let i=0;i<80;i++){const x=c.worldView.x+Art.hash(i,2)*c.worldView.width;const y=c.worldView.y+((time/8+i*79)%c.worldView.height);this.rain.lineBetween(x,y,x-2,y+8);}}
  }
 }
}

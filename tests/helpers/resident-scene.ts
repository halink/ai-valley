import * as observerViewArea from '../../src/client/observer-view-area.js';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {residentRoomPositionKnown,roomPositionKnown} from '../../src/client/resident-follow.js';
import {ObserverNavigation} from '../../src/client/observer-navigation.js';
import * as personPoses from '../../src/client/person-pose.js';
import {WorkFeedback} from '../../src/client/work-feedback.js';
import {roomHeat} from '../../src/client/rooms-art.js';
import {estatePiles} from '../../src/client/estate-custody.js';
import {roomLayout} from '../../src/shared/rooms.js';
import {teachingPosition} from '../../src/world/education.js';
import {FORMAL_CENTER} from '../../src/shared/formal-regions.js';
import {calendar,daylight,FAST_DAY_MINUTES} from '../../src/world/time.js';
import {materials,palette} from '../../src/client/palette.js';
import * as ecology from '../../src/client/animal-observation.js';
import type {ValleyScene} from '../../src/client/scene.js';

// Exercise the real scene methods without a browser, GPU, socket or game server.
// These renderer spies verify control flow and coordinates, not Phaser drawing or layout.
class Picture {
 x=0;y=0;visible=true;texture='';origin={x:0,y:0};data=new Map<string,unknown>();
 setPosition(x:number,y:number){this.x=x;this.y=y;return this;}
 setVisible(value:boolean){this.visible=value;return this;}
 setData(key:string,value:unknown){this.data.set(key,value);return this;}
 getData(key:string){return this.data.get(key);}
 setOrigin(x:number,y:number){this.origin={x,y};return this;}setDepth(){return this;}setText(){return this;}setAngle(){return this;}
 setTexture(key:string){this.texture=key;return this;}setAlpha(){return this;}clear(){return this;}lineStyle(){return this;}
 fillStyle(){return this;}fillPoints(){return this;}strokePoints(){return this;}lineBetween(){return this;}
 fillRect(){return this;}strokeRect(){return this;}strokeEllipse(){return this;}
 add(){return this;}removeAll(){return this;}destroy(){this.visible=false;}
}
class Camera {
 scrollX=0;scrollY=0;zoom=1;width=1280;height=800;roundPixels=false;
 center={x:0,y:0};worldView={x:0,y:0,width:1280,height:800};
 setBackgroundColor(){return this;}setBounds(){return this;}removeBounds(){return this;}
 setZoom(value:number){this.zoom=value;return this;}
 centerOn(x:number,y:number){this.center={x,y};this.scrollX=x-this.width/2;this.scrollY=y-this.height/2;return this;}
}
type Handler=(...args:any[])=>void;
class Events {
 handlers=new Map<string,Handler>();
 on(event:string,handler:Handler){this.handlers.set(event,handler);}
 emit(event:string,...args:any[]){this.handlers.get(event)?.(...args);}
 addPointer(){}setDefaultCursor(){}
}
class Scene {
 cameras={main:new Camera()};input=new Events();scale=Object.assign(new Events(),{width:1280,height:800});
 textures={exists:()=>true,remove:()=>{},addCanvas:()=>{}};
 add={container:()=>new Picture(),graphics:()=>new Picture(),text:()=>new Picture(),rectangle:()=>new Picture(),image:(x:number,y:number)=>new Picture().setPosition(x,y)};
 tweenCalls=0;
 tweens={killTweensOf:()=>{},isTweening:()=>false,add:({targets,x,y}:{targets:Picture;x:number;y:number})=>{this.tweenCalls++;targets.setPosition(x,y);}};
}
class Outdoors {
 accept(){}setVisible(){}draw(){}subjectAt(){return null;}subjectPosition(){return null;}
}
const dependencies:Record<string,unknown>={
 './observer-view-area.js':observerViewArea,
 phaser:{Scene,Math:{Clamp:(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n))}},
 './observer-navigation.js':{ObserverNavigation},'./resident-follow.js':{residentRoomPositionKnown,roomPositionKnown},'./person-pose.js':personPoses,'./work-feedback.js':{WorkFeedback},'./rooms-art.js':{roomHeat},
 './estate-custody.js':{estatePiles},'../shared/rooms.js':{roomLayout},'../world/education.js':{teachingPosition},
 './outdoors.js':{Outdoors},'../shared/formal-regions.js':{FORMAL_CENTER},'../world/time.js':{calendar,daylight,FAST_DAY_MINUTES},
 './art.js':{TILE:16,person:()=>({}),interior:()=>({}),hash:()=>.5},'./palette.js':{materials,palette},'./animal-observation.js':ecology,
};
const code=ts.transpileModule(readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const output={exports:{} as {ValleyScene:new()=>ValleyScene}};
new Function('require','module','exports',code)((id:string)=>{if(!(id in dependencies))throw Error('Unstubbed scene dependency '+id);return dependencies[id];},output,output.exports);
export function residentSceneHarness(width=1280,height=800){
 const scene=new output.exports.ValleyScene();
 const engine=scene as unknown as Scene;
 engine.scale.width=engine.cameras.main.width=width;engine.scale.height=engine.cameras.main.height=height;
 const roomChanges:Array<string|null>=[];scene.onRoom=b=>roomChanges.push(b?.id??null);
 scene.create();
 return {scene,engine,roomChanges,camera:engine.cameras.main};
}

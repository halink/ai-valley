/** Independent synthetic pointer-route contracts, not browser/GPU acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import type Phaser from 'phaser';
import {animatedFixture} from './helpers/storybook-animated-fixture.js';
import {createStorybookObserver, type StorybookPointerEvidence} from '../src/client/storybook-observer.js';
import {createStorybookAnimatedObserver} from '../src/client/storybook-animated-observer.js';
import {mountStorybookSurface} from '../src/client/storybook-phaser.js';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {parseStorybookAnimationBundle} from '../src/client/storybook-animation-assets.js';

class Display {
 x=0;y=0;scale=1;height=52;text='';children:Display[]=[];
 setScrollFactor(){return this;} setDepth(){return this;} setOrigin(){return this;}
 setPosition(x:number,y:number){this.x=x;this.y=y;return this;} setScale(s:number){this.scale=s;return this;}
 setText(s:string){this.text=s;return this;} setTexture(){return this;}
 add(d:Display){this.children.push(d);return this;} sort(){return this;}
 removeAll(){this.children=[];return this;} destroy(){this.children=[];}
}
function harness(){
 const input=new EventEmitter(),events=new EventEmitter(),objects:Display[]=[],textures=new Set<string>();
 const camera={x:0,y:0,scrollX:0,scrollY:0,zoomX:1,zoomY:1,rotation:0};
 const make=()=>{const d=new Display();objects.push(d);return d;};
 const scene={cameras:{main:camera,cameras:[camera]},input,events,textures:{addCanvas(key:string){textures.add(key);return {setFilter(){return this;},add(){return {};}};},remove(key:string){textures.delete(key);}},add:{container:make,text:make,image:make}} as unknown as Phaser.Scene;
 const old=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})})}});
 return {scene,input,events,objects,textures,restore(){if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}};
}
for(const mode of ['static','animation'] as const){
 test(`${mode}: pre-existing one-argument surface still selects in logical coordinates`,()=>{
  const f=animatedFixture();
  const h=mode==='static'?createStorybookObserver(f.observer,f.atlas,f.surface):createStorybookAnimatedObserver(f.observer,f.atlas,f.bundle,f.surface,f.environment);
  h.activate();const d=h.plan!.draws.find(d=>d.selection?.id===f.r.id)!;
  let source:{x:number;y:number}|undefined;
  for(let y=0;y<d.frame.rect.height&&!source;y++)for(let x=0;x<d.frame.rect.width;x++)if(f.atlas.pixels[((d.frame.rect.y+y)*f.atlas.width+d.frame.rect.x+x)*4+3]){source={x,y};break;}
  assert.ok(source);for(const listener of f.picks)listener({x:d.topLeft.x+(source.x+.5)*d.scale,y:d.topLeft.y+(source.y+.5)*d.scale});
  assert.equal(f.selected.at(-1)?.id,f.r.id);h.dispose();assert.equal(f.picks.size,0);
 });
 test(`${mode}: real pointer route isolates listener coordinates and preserves frozen original evidence at source edges`,()=>{
  const g=harness();try{
   const f=animatedFixture();f.r.at={x:0,y:0};f.r.activity=null;
   const pin={packId:'synthetic-pointer-review',packVersion:'1.0.0'};
   const manifest=parseStorybookManifest({schemaVersion:2,...pin,projection:{tileWidth:32,tileHeight:16},atlas:{path:'assets/storybook/pointer-review.png',width:6,height:6,sha256:'0'.repeat(64),pixelsPerUnit:3},provenance:{source:'synthetic',author:'review',license:'test'},assets:[{id:'marker',kind:'static',footprint:{width:1,height:1},groundAnchor:{x:.5,y:.5},frame:{rect:{x:0,y:0,width:6,height:6},foot:{x:3,y:6}}}]},pin);
   const pixels=new Uint8ClampedArray(144);for(let y=0;y<6;y++)for(let x=0;x<6;x++)if(x%2===1)pixels[(y*6+x)*4+3]=255;
   const atlas={manifest,width:6,height:6,pixels};let evidence:StorybookPointerEvidence|undefined;let previous:StorybookPointerEvidence|undefined;let before:{x:number;y:number}|undefined;
   const handle=mountStorybookSurface(g.scene,f.observer,atlas,{x:0,y:0,width:390,height:844},mode,(owned,surface)=>{
    surface.subscribePick((at,original)=>{
     assert.ok(original);assert.notEqual(original,previous);previous=original;evidence=original;before={...at};
     for(const obj of [original,original.screen,original.camera,original.camera.origin])assert.ok(Object.isFrozen(obj));
     assert.equal(Reflect.set(original.screen,'x',0),false);assert.equal(Reflect.set(original.camera.origin,'x',0),false);assert.equal(Reflect.set(original.camera,'zoom',0),false);
     at.x=1e9;at.y=1e9;
    });
    surface.subscribePick((at,original)=>{assert.deepEqual(at,before);assert.equal(original,evidence);});
    return mode==='static'?createStorybookObserver(f.observer,owned,surface):createStorybookAnimatedObserver(f.observer,owned,parseStorybookAnimationBundle(manifest,null,pin),surface,f.environment);
   });
   handle.activate();handle.setWindow({x:0,y:0,width:32,height:32});
   const d=handle.plan!.draws.find(d=>d.selection?.id===f.r.id)!,group=g.objects[0];assert.deepEqual(d.topLeft,{x:-1,y:6});
   for(let edge=0;edge<=6;edge++)for(const delta of [-1e-7,0,1e-7]){
    const x=edge+delta,screen={x:(d.topLeft.x+x*d.scale)*group.scale+group.x,y:(d.topLeft.y+2.5*d.scale)*group.scale+group.y};
    f.selected.length=0;g.input.emit('pointerup',screen);
    const index=Math.floor(x),hit=index>=0&&index<6&&index%2===1;
    assert.equal(f.selected.at(-1)?.id??null,hit?f.r.id:null,`${mode} edge ${edge}, delta ${delta}`);
    assert.equal(g.objects[2].text.startsWith(f.r.name),hit);
    assert.deepEqual(evidence!.screen,screen);screen.x=-99;assert.notEqual(evidence!.screen.x,-99);
   }
   handle.dispose();assert.equal(g.input.listenerCount('pointerup')+g.textures.size+f.feeds.size+f.rooms.size,0);
  }finally{g.restore();}
 });
}

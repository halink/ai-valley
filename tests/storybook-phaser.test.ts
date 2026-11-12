/** Synthetic Phaser API contract mock. Does not instantiate Phaser, browser, GPU or canvas. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import type Phaser from 'phaser';
import {mountStorybookPrototype} from '../src/client/storybook-phaser.js';
import type {ObserverMap} from '../src/client/observer-map.js';
import type {Snapshot} from '../src/shared/types.js';
import {createWorld} from '../src/world/seed.js';
import {syntheticManifest,syntheticPin,syntheticAtlasPixels,SYNTHETIC_WIDTH,SYNTHETIC_HEIGHT} from '../src/client/storybook-synthetic-atlas.js';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {densityAtlas} from './helpers/storybook-density-fixture.js';
import {mountStorybookAnimationPrototype} from '../src/client/storybook-animation-phaser.js';
import {parseStorybookAnimationBundle} from '../src/client/storybook-animation-assets.js';
const atlas=()=>({manifest:parseStorybookManifest(syntheticManifest,syntheticPin),width:SYNTHETIC_WIDTH,height:SYNTHETIC_HEIGHT,pixels:syntheticAtlasPixels()});
class Display {
 children:Display[]=[];destroyed=false;depth=0;x=0;y=0;scale=1;origin={x:0,y:0};height=52;frame='';text='';
 setScrollFactor(){return this;}setDepth(v:number){this.depth=v;return this;}setText(v:string){this.text=v;return this;}
 setPosition(x:number,y:number){this.x=x;this.y=y;return this;}setScale(v:number){this.scale=v;return this;}
 setOrigin(x:number,y:number){this.origin={x,y};return this;}add(d:Display){this.children.push(d);return this;}
 removeAll(destroy=false){if(destroy)for(const child of this.children)child.destroy();this.children=[];return this;}
 sort(){this.children.sort((a,b)=>a.depth-b.depth);return this;}destroy(children=false){this.destroyed=true;if(children)this.removeAll(true);}
}
function harness(failTexture=false,failFrame=false){
 const snapshot:Snapshot={world:createWorld(5401),serverTime:'synthetic',version:'synthetic',capabilities:{active:[],pending:[]}};
 const snapshots=new Set<Function>(),rooms=new Set<Function>(),input=new EventEmitter(),events=new EventEmitter();
 const textures=new Set<string>(),objects:Display[]=[],frames:string[]=[],selected:unknown[]=[],filters:Array<{key:string;mode:number}>=[];
 let disposedTextures=0;
 const camera={x:0,y:0,scrollX:0,scrollY:0,zoomX:1,zoomY:1,rotation:0};
 const scene={cameras:{main:camera,cameras:[camera]},textures:{addCanvas(key:string){if(failTexture)return null;textures.add(key);return {setFilter(mode:number){filters.push({key,mode});return this;},add(name:string){if(failFrame)return null;frames.push(name);return {};}};},remove(key:string){textures.delete(key);disposedTextures++;}},add:{container(){const d=new Display();objects.push(d);return d;},text(){const d=new Display();objects.push(d);return d;},image(x:number,y:number,_key:string,frame:string){const d=new Display();d.x=x;d.y=y;d.frame=frame;objects.push(d);return d;}},input,events} as unknown as Phaser.Scene;
 const observer:ObserverMap={currentSnapshot:()=>snapshot,currentRoom:()=>null,currentTile:()=>({x:35,y:30}),currentFollow:()=>null,subscribe(fn){snapshots.add(fn);fn(snapshot,true);return ()=>{snapshots.delete(fn);};},subscribeRoom(fn){rooms.add(fn);fn(null);return ()=>{rooms.delete(fn);};},subscribeFollow(){throw Error('unneeded');},select:value=>selected.push(value),cover(){throw Error('must not cover');},frame(){throw Error('must not frame');},stopFollowing(){throw Error('must not stop');},setFollowResolver(){throw Error('must not override');},isFullMapTarget:()=>false};
 return {scene,observer,input,events,textures,objects,frames,snapshots,rooms,selected,filters,get disposedTextures(){return disposedTextures;}};
}
function fakeDocument(){
 const old=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>({createImageData:(width:number,height:number)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){}})})}});
 return ()=>{if(old)Object.defineProperty(globalThis,'document',old);else delete (globalThis as any).document;};
}
test('mocked Phaser adapter installs each frame, honors origins/depth, stays opt-in and synchronously disposes only owned objects',()=>{
 const restore=fakeDocument();try{
  const h=harness(),texture=atlas(),handle=mountStorybookPrototype(h.scene,h.observer,texture,{x:0,y:0,width:390,height:844});
  assert.equal(handle.plan,null);assert.equal(h.frames.length,16);assert.equal(h.input.listenerCount('pointerup'),1);assert.equal(h.events.listenerCount('shutdown'),1);
  assert.deepEqual(h.filters,[]); // Legacy atlas keeps its existing sampling mode.
  assert.equal(mountStorybookPrototype(h.scene,h.observer,texture,{x:0,y:0,width:390,height:844}),handle);
  handle.activate();const group=h.objects[0];assert.equal(group.children.length,handle.plan!.draws.length);assert.ok(group.scale>0);
  for(const [index,d] of handle.plan!.draws.entries()){const image=group.children[index];assert.equal(image.x,d.position.x);assert.equal(image.y,d.position.y);assert.deepEqual(image.origin,d.origin);assert.equal(image.depth,d.depth);assert.equal(image.frame,d.assetId+(d.facing?':'+d.facing:''));}
  const d=handle.plan!.draws.find(d=>d.selection?.id==='lin')!,r=d.frame.rect;let hit:{x:number;y:number}|null=null;
  for(let y=0;y<r.height&&!hit;y++)for(let x=0;x<r.width;x++)if(texture.pixels[((r.y+y)*texture.width+r.x+x)*4+3]){hit={x,y};break;}
  texture.pixels.fill(0); // Installed texture and hit evidence must remain consistent.
  h.input.emit('pointerup',{x:(d.topLeft.x+hit!.x+.5)*group.scale+group.x,y:(d.topLeft.y+hit!.y+.5)*group.scale+group.y});
  assert.deepEqual(h.selected,[{kind:'person',id:'lin'}]);assert.match(h.objects[2].text,/林禾/);assert.match(h.objects[2].text,/地图/);assert.match(h.objects[2].text,/缺少绘本素材/);
  handle.deactivate();assert.equal(group.children.length,0);handle.activate();h.events.emit('shutdown');
  assert.equal(h.textures.size+h.snapshots.size+h.rooms.size+h.input.listenerCount('pointerup')+h.events.listenerCount('shutdown')+h.events.listenerCount('destroy'),0);
  assert.ok(h.objects.every(o=>o.destroyed));assert.equal(h.disposedTextures,1);handle.dispose();assert.equal(h.disposedTextures,1);
  const again=mountStorybookPrototype(h.scene,h.observer,atlas(),{x:0,y:0,width:1440,height:900});assert.notEqual(again,handle);again.dispose();
 }finally{restore();}
});

for(const [width,height] of [[1440,900],[1280,720],[390,844]])test(`mocked ${width}×${height} v2 density keeps viewport fit, feet and source-alpha clicks stable`,()=>{
 const restore=fakeDocument();try{
  let reference:unknown;
  for(const density of [1,2,3]){
   const h=harness(),texture=densityAtlas(atlas(),density),handle=mountStorybookPrototype(h.scene,h.observer,texture,{x:0,y:0,width,height});
   assert.equal(h.filters.length,1);assert.equal(h.filters[0].mode,0);assert.ok(h.textures.has(h.filters[0].key));
   handle.activate();const group=h.objects[0],fit={x:group.x,y:group.y,scale:group.scale};
   if(reference)assert.deepEqual(fit,reference);else reference=fit;
   for(const [i,d] of handle.plan!.draws.entries()){
    const image=group.children[i];assert.equal(image.scale,1/density);assert.equal(image.x,d.position.x);assert.equal(image.y,d.position.y);
    assert.deepEqual(image.origin,d.origin);assert.equal(image.scale*d.frame.rect.width,d.size.width);assert.equal(image.scale*d.frame.rect.height,d.size.height);
    assert.equal(image.x-image.origin.x*d.size.width,d.topLeft.x);assert.equal(image.y-image.origin.y*d.size.height,d.topLeft.y);
   }
   const d=handle.plan!.draws.find(d=>d.selection?.id==='lin')!,r=d.frame.rect;let hit:{x:number;y:number}|null=null;
   for(let y=0;y<r.height&&!hit;y++)for(let x=0;x<r.width;x++)if(texture.pixels[((r.y+y)*texture.width+r.x+x)*4+3]){hit={x,y};break;}
   h.input.emit('pointerup',{x:(d.topLeft.x+(hit!.x+.5)*d.scale)*group.scale+group.x,y:(d.topLeft.y+(hit!.y+.5)*d.scale)*group.scale+group.y});
   assert.deepEqual(h.selected,[{kind:'person',id:'lin'}]);
   handle.dispose();assert.equal(h.textures.size,0);assert.equal(h.disposedTextures,1);
  }
 }finally{restore();}
});

test('v2 filter installation failure releases the owned texture without changing any scene globals',()=>{
 const restore=fakeDocument();try{
  const h=harness(),add=h.scene.textures.addCanvas.bind(h.scene.textures),camera={...h.scene.cameras.main};
  h.scene.textures.addCanvas=((...args:Parameters<typeof add>)=>{const texture=add(...args)!;texture.setFilter=()=>{throw Error('synthetic filter failure');};return texture;}) as typeof add;
  assert.throws(()=>mountStorybookPrototype(h.scene,h.observer,densityAtlas(atlas(),2),{x:0,y:0,width:390,height:844}),/filter failure/);
  assert.equal(h.textures.size+h.snapshots.size+h.rooms.size+h.input.listenerCount('pointerup'),0);assert.equal(h.disposedTextures,1);assert.deepEqual(h.scene.cameras.main,camera);
 }finally{restore();}
});

for(const mode of ['static','animated'] as const)test(`actual mocked ${mode} pointerup route preserves source edges before camera cancellation`,()=>{
 const restore=fakeDocument();try{
  for(const [width,height,ox,oy] of [[1440,900,0,0],[1280,720,0,0],[390,844,0,0],[390,844,123.45,81.23]])for(const axis of ['x','y'] as const)for(const parity of [0,1]){
   const h=harness(),snapshot=h.observer.currentSnapshot()!;
   for(const r of snapshot.world.residents)r.residency=r.id==='lin'?'resident':'outside';
   const lin=snapshot.world.residents.find(r=>r.id==='lin')!;lin.at={x:0,y:0};lin.activity=null;snapshot.world.buildings=[];
   const frame={rect:{x:0,y:0,width:6,height:6},foot:{x:3,y:6}};
   const manifest=parseStorybookManifest({schemaVersion:2,...syntheticPin,projection:{tileWidth:32,tileHeight:16},atlas:{path:'assets/storybook/edge.png',width:6,height:6,sha256:'0'.repeat(64),pixelsPerUnit:3},provenance:{source:'SYNTHETIC pointer edge cells',author:'Test fixture',license:'MIT'},assets:[{id:'marker',kind:'static',footprint:{width:1,height:1},groundAnchor:{x:.5,y:.5},frame}]},syntheticPin);
   const pixels=new Uint8ClampedArray(6*6*4);
   for(let y=0;y<6;y++)for(let x=0;x<6;x++)if((axis==='x'?x:y)%2===parity)pixels[(y*6+x)*4+3]=255;
   const texture={manifest,width:6,height:6,pixels},viewport={x:ox,y:oy,width,height};
   // A static-only bundle deliberately uses the animated observer's fallback marker
   // path: this exercises its real pick subscription, not a second direct picker call.
   const handle=mode==='static'?mountStorybookPrototype(h.scene,h.observer,texture,viewport):mountStorybookAnimationPrototype(h.scene,h.observer,texture,parseStorybookAnimationBundle(manifest,null,syntheticPin),viewport,{now:()=>0,visible:()=>true,reducedMotion:()=>false,subscribeChange:()=>()=>{}});
   handle.activate();handle.setWindow({x:0,y:0,width:32,height:32});
   const d=handle.plan!.draws.find(d=>d.selection?.id==='lin')!,group=h.objects[0];assert.ok(d);
   for(let edge=0;edge<=6;edge++)for(const delta of [-1e-7,0,1e-7]){
    const value=edge+delta,sx=axis==='x'?value:2.5,sy=axis==='y'?value:2.5;
    const screen={x:(d.topLeft.x+sx*d.scale)*group.scale+group.x,y:(d.topLeft.y+sy*d.scale)*group.scale+group.y};
    const index=Math.floor(value),expected=index>=0&&index<6&&index%2===parity?'lin':null;
    h.selected.length=0;h.input.emit('pointerup',screen);
    const actual=(h.selected[0] as {id:string}|undefined)?.id??null;
    assert.equal(actual,expected,JSON.stringify({mode,width,height,ox,oy,axis,parity,edge,delta,screen}));
    assert.equal(h.objects[2].text.startsWith('林禾'),expected==='lin','diagnostic hit text agrees with actual observer selection');
   }
   handle.dispose();assert.equal(h.input.listenerCount('pointerup')+h.textures.size+h.snapshots.size+h.rooms.size,0);
  }
 }finally{restore();}
});
test('mocked failed texture/frame acquisition releases only already acquired resources',()=>{
 const restore=fakeDocument();try{
  for(const [failTexture,failFrame] of [[true,false],[false,true]]){
   const h=harness(failTexture,failFrame);assert.throws(()=>mountStorybookPrototype(h.scene,h.observer,atlas(),{x:0,y:0,width:1280,height:720}),/unavailable/);
   assert.equal(h.textures.size+h.input.listenerCount('pointerup')+h.snapshots.size+h.rooms.size,0);assert.equal(h.disposedTextures,failTexture?0:1);
  }
 }finally{restore();}
});

test('late scene-listener registration failure releases observer subscriptions as well as surface',()=>{
 const restore=fakeDocument();try{
  for(const eventName of ['shutdown','destroy']){
   const h=harness(),on=h.events.on.bind(h.events);
   h.events.on=((event:string,...args:any[])=>{if(event===eventName)throw Error('synthetic late event failure');return on(event,args[0]);}) as typeof h.events.on;
   assert.throws(()=>mountStorybookPrototype(h.scene,h.observer,atlas(),{x:0,y:0,width:1280,height:720}),/late event failure/);
   assert.equal(h.textures.size+h.snapshots.size+h.rooms.size+h.input.listenerCount('pointerup')+h.events.listenerCount('shutdown'),0);
   assert.ok(h.objects.every(o=>o.destroyed));
  }
 }finally{restore();}
});

test('mock camera transforms are rejected at installation and disabled if changed later',()=>{
 const restore=fakeDocument();try{
  const h=harness();h.scene.cameras.main.zoomX=2;
  assert.throws(()=>mountStorybookPrototype(h.scene,h.observer,atlas(),{x:0,y:0,width:1280,height:720}),/untransformed_camera/);
  assert.equal(h.textures.size+h.snapshots.size,0);h.scene.cameras.main.zoomX=1;
  const handle=mountStorybookPrototype(h.scene,h.observer,atlas(),{x:0,y:0,width:1280,height:720});handle.activate();assert.ok(handle.plan);
  Object.assign(h.scene.cameras.main,{rotation:.2});h.events.emit('preupdate');assert.equal(handle.plan,null);assert.equal(h.objects[0].children.length,0);
  h.input.emit('pointerup',{x:30,y:30});assert.equal(h.selected.length,0);assert.match(h.objects[1].text,/不支持此相机/);
  handle.dispose();assert.equal(h.events.listenerCount('preupdate'),0);
 }finally{restore();}
});

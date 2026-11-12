import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import type {Snapshot} from '../src/shared/types.js';
import {observerViewArea} from '../src/client/observer-view-area.js';
const area={x:8,y:140,width:374,height:280,frameWidth:390,frameHeight:844};
function setup(){const w=createWorld();const r=w.residents[0];const h=residentSceneHarness(390,844);const snapshot:Snapshot={world:w,mapRevision:'synthetic',serverTime:'test',version:'test',capabilities:{active:[],pending:[]}};h.scene.accept(snapshot);return {...h,w,r,snapshot};}

test('review: clearing selection by a map click cannot reframe the stale UI resident before DOM observers run',()=>{
 const h=setup();h.scene.setObservationArea(area,h.r.id);h.camera.centerOn(600,700);
 const before={x:h.camera.scrollX,y:h.camera.scrollY};let selected:unknown='not called';h.scene.onSelection=value=>{selected=value;};
 h.engine.input.emit('pointerdown',{x:100,y:200});
 h.engine.input.emit('pointerup',{x:100,y:200,worldX:1e6,worldY:1e6});
 assert.equal(selected,null);
 assert.deepEqual({x:h.camera.scrollX,y:h.camera.scrollY},before,'pick must not use the old asynchronous shell selection');
 h.scene.setObservationArea(area,null);
 assert.deepEqual({x:h.camera.scrollX,y:h.camera.scrollY},before);
});

test('review: upper out-of-map coordinates and regional journeys are not precise local framing targets',()=>{
 for(const invalid of ['x','y','regional'] as const){
  const h=setup();
  if(invalid==='x')h.r.at.x=h.w.map.width;
  if(invalid==='y')h.r.at.y=h.w.map.height;
  if(invalid==='regional')(h.r as any).regionalLocation={regionId:'synthetic-away',at:{x:1,y:1}};
  h.scene.accept(h.snapshot);const before={...h.camera.center};
  h.scene.setObservationArea(area,h.r.id);
  assert.deepEqual(h.camera.center,before,invalid);
  assert.equal(h.scene.followState,null);
 }
});

test('review: occlusion calculation clips offscreen boxes, ignores invalid boxes, and rejects thin unusable slivers',()=>{
 assert.deepEqual(observerViewArea(100,100,[{x:-20,y:-10,width:120,height:50},{x:200,y:0,width:20,height:100},{x:NaN,y:0,width:50,height:50}]),{x:0,y:40,width:100,height:60,frameWidth:100,frameHeight:100});
 assert.equal(observerViewArea(100,100,[{x:0,y:0,width:100,height:53}]),null);
});

test('review: manual pan survives a resize in an already observed room without restarting follow',()=>{
 const h=setup();const b=h.w.buildings[0];h.scene.enterRoom(b.id);h.scene.setObservationArea(area,null);
 h.engine.input.emit('pointerdown',{x:100,y:200});h.engine.input.emit('pointermove',{x:180,y:220,isDown:true});
 const centre={x:h.camera.scrollX+h.camera.width/2,y:h.camera.scrollY+h.camera.height/2};
 h.engine.scale.width=h.camera.width=430;h.engine.scale.height=h.camera.height=900;
 h.engine.scale.emit('resize',{width:430,height:900},null,null,390,844);
 h.scene.setObservationArea({...area,width:414,frameWidth:430,frameHeight:900},null);
 assert.deepEqual(h.camera.center,centre);assert.equal(h.scene.followState,null);
 assert.equal(h.scene.navigation.roomId,b.id);
});

test('review: optional isometric zoom keeps the actual followed resident, not an inverse-projection identity, in the exposed centre',async()=>{
 const {observerPreviewHarness}=await import('./helpers/observer-preview-dom.js');
 const {isometricObserverRoute}=await import('../scripts/isometric-observer-route.js');
 const {projectIsometric}=await import('../src/client/isometric-projection.js');
 const route=isometricObserverRoute();const h=observerPreviewHarness();
 try{
  h.canvas.rect={left:0,top:0,width:390,height:844};h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);h.viewArea(area,route.personId);
  const anchor=h.model.viewport.residentTarget(route.personId)?.anchor;assert.ok(anchor);
  const p=projectIsometric({x:anchor.x+.5,y:anchor.y+.5});
  const check=()=>{assert.ok(Math.abs(p.x*h.model.camera!.zoom+h.model.camera!.origin.x-(area.x+area.width/2))<1e-6);assert.ok(Math.abs(p.y*h.model.camera!.zoom+h.model.camera!.origin.y-(area.y+area.height/2))<1e-6);};
  check();h.canvas.emit('wheel',{deltaY:-1,clientX:195,clientY:700});check();
  assert.equal(h.follow.state?.personId,route.personId);
 }finally{h.dispose();}
});

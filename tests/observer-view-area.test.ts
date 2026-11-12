import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observerViewArea,observerCameraCenter} from '../src/client/observer-view-area.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {createWorld} from '../src/world/seed.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {Snapshot} from '../src/shared/types.js';
const area={x:8,y:140,width:374,height:280,frameWidth:390,frameHeight:844};
function setup(){const w=createWorld();w.rooms={tick:w.minute,claims:[],beds:{}};const r=w.residents[0];const h=residentSceneHarness(390,844);const snapshot:Snapshot={world:w,mapRevision:'synthetic',serverTime:'test',version:'test',capabilities:{active:[],pending:[]}};h.scene.accept(snapshot);return {...h,w,r,snapshot};}
test('measured obstacles select exact largest exposed rectangle and reject unusable viewports',()=>{
 assert.deepEqual(observerViewArea(390,844,[{x:0,y:0,width:390,height:140},{x:0,y:420,width:390,height:424}]),{x:0,y:140,width:390,height:280,frameWidth:390,frameHeight:844});
 assert.equal(observerViewArea(390,844,[{x:0,y:0,width:390,height:844}]),null);
 assert.equal(observerViewArea(NaN,844,[]),null);
 assert.deepEqual(observerViewArea(390,844,[]),{x:0,y:0,width:390,height:844,frameWidth:390,frameHeight:844});
});
test('Phaser zoom-centred projection puts target in exposed centre at multiple zoom levels',()=>{
 for(const zoom of [.7,1,2,3.5])for(const p of [{x:0,y:0},{x:500,y:900}]){
  const c=observerCameraCenter(p,area,zoom);
  assert.ok(Math.abs((p.x-c.x)*zoom+195-(area.x+area.width/2))<1e-9);
  assert.ok(Math.abs((p.y-c.y)*zoom+422-(area.y+area.height/2))<1e-9);
 }
});
test('selected resident reframes on drawer resize/close without starting follow; drag suppresses future recenter',()=>{
 const h=setup();h.scene.setObservationArea(area,h.r.id);assert.equal(h.scene.followState,null);
 const first={...h.camera.center};h.scene.setObservationArea({...area,height:140},h.r.id);assert.notDeepEqual(h.camera.center,first);
 h.engine.input.emit('pointerdown',{x:100,y:200});h.engine.input.emit('pointermove',{x:150,y:220,isDown:true});
 const scroll={x:h.camera.scrollX,y:h.camera.scrollY};h.scene.setObservationArea({...area,height:360},h.r.id);
 assert.deepEqual({x:h.camera.scrollX,y:h.camera.scrollY},scroll);
 h.scene.setObservationArea(null,null);assert.equal(h.scene.followState,null);
});
test('ongoing follow retains identity through layout and zoom; unknown indoor location is never used as precise resident position',()=>{
 const h=setup();h.scene.focusPerson(h.r.id);h.scene.setObservationArea(area,h.r.id);h.scene.zoom(.25);h.scene.update(100);
 assert.equal(h.scene.followState?.personId,h.r.id);assert.equal(h.scene.followState?.status,'following');
 const b=h.w.buildings[0];h.r.inside=b.id;h.r.roomAt={...roomLayout(h.w,b).entry};h.scene.accept(h.snapshot);h.scene.setObservationArea({...area,height:220},h.r.id);
 assert.equal(h.scene.followState?.roomId,b.id);
 h.scene.stopFollowing();h.r.roomAt=undefined;h.scene.accept(h.snapshot);const before={...h.camera.center};h.scene.setObservationArea({...area,height:180},h.r.id);assert.deepEqual(h.camera.center,before);
});
test('production framing remains visible at four map edges under Phaser bounds clamp, including zoom',()=>{
 for(const zoom of [.7,2.5])for(const side of [0,1,2,3]){
  const h=setup();let bounds={x:0,y:0,width:h.w.map.width*16,height:h.w.map.height*16};
  h.camera.setBounds=((x:number,y:number,width:number,height:number)=>{bounds={x,y,width,height};return h.camera;}) as typeof h.camera.setBounds;
  h.camera.centerOn=(x:number,y:number)=>{
   const clamp=(scroll:number,start:number,size:number,view:number)=>{const low=start+(view/h.camera.zoom-view)/2;return Math.max(low,Math.min(low+Math.max(0,size-view/h.camera.zoom),scroll));};
   h.camera.scrollX=clamp(x-h.camera.width/2,bounds.x,bounds.width,h.camera.width);
   h.camera.scrollY=clamp(y-h.camera.height/2,bounds.y,bounds.height,h.camera.height);
   h.camera.center={x:h.camera.scrollX+h.camera.width/2,y:h.camera.scrollY+h.camera.height/2};return h.camera;
  };
  h.r.at={x:side%2?h.w.map.width-1:0,y:side<2?0:h.w.map.height-1};h.r.inside=null;
  h.scene.accept(h.snapshot);h.camera.setZoom(zoom);h.scene.setObservationArea(area,h.r.id);
  const sprite=(h.scene as any).actors.get(h.r.id);
  const screen={x:(sprite.x-h.camera.center.x)*zoom+195,y:(sprite.y-h.camera.center.y)*zoom+422};
  assert.ok(Math.abs(screen.x-(area.x+area.width/2))<1e-6);
  assert.ok(Math.abs(screen.y-(area.y+area.height/2))<1e-6);
  assert.equal(h.w.map.width,Math.round(h.w.map.width),'presentation bounds do not mutate world');
 }
});
test('no selection preserves observation; resize and restore never manufacture a follow',()=>{
 const h=setup();const before={...h.camera.center};h.scene.setObservationArea(area,null);assert.deepEqual(h.camera.center,before);
 h.scene.setObservationArea(area,h.r.id);
 h.engine.scale.width=h.camera.width=430;h.engine.scale.height=h.camera.height=900;
 h.engine.scale.emit('resize',{width:430,height:900},null,null,390,844);
 h.scene.setObservationArea({...area,width:414,frameWidth:430,frameHeight:900},h.r.id);
 assert.equal(h.scene.followState,null);
 h.scene.setObservationArea(null,h.r.id);const sprite=(h.scene as any).actors.get(h.r.id);
 assert.deepEqual(h.camera.center,{x:sprite.x,y:sprite.y});
});
test('fully occluded follow camera waits without losing follow, then resumes in measured area',()=>{
 const h=setup();h.scene.focusPerson(h.r.id);h.scene.setObservationArea(area,h.r.id);
 const before={...h.camera.center};h.scene.setObservationArea({...area,width:0,height:0},h.r.id);h.scene.update(10);
 assert.deepEqual(h.camera.center,before);assert.equal(h.scene.followState?.status,'following');
 h.scene.setObservationArea({...area,height:180},h.r.id);assert.notDeepEqual(h.camera.center,before);
});
test('explicit home/coordinate navigation is not undone by a later drawer change',()=>{
 const h=setup();h.scene.setObservationArea(area,h.r.id);h.scene.watchTile({x:10,y:12});
 const before={...h.camera.center};h.scene.setObservationArea({...area,height:180},h.r.id);assert.deepEqual(h.camera.center,before);
});
test('all 2D explicit viewing routes override a stale resident card until a new deliberate selection',()=>{
 for(const route of ['home','tile','building','enter','exit','clear','stop'] as const){
  const h=setup();h.scene.setObservationArea(area,h.r.id);
  if(route==='home')h.scene.home();
  if(route==='tile')h.scene.watchTile({x:10,y:12});
  if(route==='building')h.scene.focusBuilding(h.w.buildings[0].id);
  if(route==='enter')h.scene.enterRoom(h.w.buildings[0].id);
  if(route==='exit'){h.scene.enterRoom(h.w.buildings[0].id);h.scene.exitRoom();}
  if(route==='clear')h.scene.clearSelection();
  if(route==='stop'){h.scene.focusPerson(h.r.id);h.scene.stopFollowing(true);}
  const before={...h.camera.center};h.scene.setObservationArea({...area,height:180},h.r.id);assert.deepEqual(h.camera.center,before,route);assert.equal(h.scene.followState,null);
  h.scene.focusPerson(h.r.id);h.scene.setObservationArea(area,h.r.id);
  const refreshedFollow: import('../src/client/resident-follow.js').ResidentFollowState|null = h.scene.navigation.followState;
  assert.equal(refreshedFollow?.status,'following');
 }
});

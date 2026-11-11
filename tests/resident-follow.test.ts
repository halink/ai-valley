import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ResidentFollow,residentFollowTarget,residentFollowText} from '../src/client/resident-follow.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {observerFrame} from '../src/server/observer-feed.js';
import type {Snapshot,World} from '../src/shared/types.js';
import {roomLayout} from '../src/shared/rooms.js';
import {createWorld} from '../src/world/seed.js';
import {residentSceneHarness} from './helpers/resident-scene.js';

function fixture(){const w=createWorld();w.rooms={tick:w.minute,claims:[],beds:{}};return {w,r:w.residents[0],b:w.buildings[0],other:w.buildings[1],follow:new ResidentFollow()};}
function snapshot(w:World):Snapshot{return {world:w,mapRevision:'test-map',serverTime:'test',version:'test',capabilities:{active:[],pending:[]}};}
function freeze(value:unknown){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}}

test('follow uses only actual room presence through repeated indoor, outdoor and other-room transitions',()=>{
 const {w,r,b,other,follow}=fixture();
 assert.deepEqual(follow.start(w,r.id),{roomId:null,roomName:null,precise:true});
 for(let i=0;i<3;i++){
  r.inside=b.id;r.roomAt={...roomLayout(w,b).entry};
  assert.equal(follow.observe(w)?.roomId,b.id);assert.equal(follow.state?.personId,r.id);
  r.inside=other.id;assert.equal(follow.observe(w)?.roomId,other.id);
  r.inside=null;assert.equal(follow.observe(w)?.roomId,null);
 }
 assert.equal(follow.state?.status,'following');
});

test('a room journey destination or home is not proof of entering a room',()=>{
 const {w,r,b,follow}=fixture();
 r.activity={planId:'a',action:{type:'sleep',minutes:60},definition:'test',startedAt:w.minute,remaining:60,path:[],target:{...b.door},room:{buildingId:b.id,mode:'work',path:[],progress:0,target:{x:2,y:5}}};
 assert.equal(follow.start(w,r.id)?.roomId,null);
});

for(const reason of ['dead','outside','missing','room-unavailable','position-unavailable'] as const)test(`losing a target (${reason}) locks follow until explicitly restarted`,()=>{
 const {w,r,follow}=fixture();follow.start(w,r.id);
 if(reason==='dead')r.status='dead';
 else if(reason==='outside')r.residency='outside';
 else if(reason==='missing')w.residents=w.residents.filter(p=>p!==r);
 else if(reason==='room-unavailable')r.inside='removed-building';
 else r.at.x=w.map.width;
 assert.equal(follow.observe(w),null);assert.equal(follow.state?.reason,reason);
 assert.match(residentFollowText(follow.state!),/跟随已停止/);
 r.status='alive';r.residency='resident';r.inside=null;r.at.x=10;if(!w.residents.includes(r))w.residents.push(r);
 assert.equal(follow.observe(w),null,'reappearance or reconnect does not silently resume');
 assert.ok(follow.start(w,r.id));
});

test('legacy room presence preserves a room overview without inventing precise coordinates',()=>{
 const {w,r,b,follow}=fixture();r.inside=b.id;delete r.roomAt;delete w.rooms;
 const before=JSON.stringify(w);
 assert.deepEqual(follow.start(w,r.id),{roomId:b.id,roomName:b.name,precise:false});
 assert.match(residentFollowText(follow.state!),/未记录室内精确位置/);
 assert.equal(JSON.stringify(w),before);
 w.rooms={tick:w.minute,claims:[],beds:{}};assert.equal(follow.observe(w)?.precise,false);
 r.roomAt={x:NaN,y:4};assert.equal(follow.observe(w)?.precise,false);
 r.roomAt={x:-1,y:4};assert.equal(follow.observe(w)?.precise,false);
 r.roomAt={x:1000,y:4};assert.equal(follow.observe(w)?.precise,false);
});

test('world replacement and manual stop clear follow; same-world full and delta snapshots preserve identity',()=>{
 const {w,r,b,follow}=fixture(),first=snapshot(w);follow.start(w,r.id);
 const next=structuredClone(first);next.world.revision++;next.world.residents[0].inside=b.id;next.world.residents[0].roomAt={x:2,y:5};
 const combined=applyObserverUpdate(first,observerFrame(next,first))!;
 assert.deepEqual(follow.observe(combined.world),residentFollowTarget(next.world,r.id));
 assert.equal(follow.observe(structuredClone(next.world))?.roomId,b.id);
 follow.clear();assert.equal(follow.observe(w),null);assert.equal(follow.state,null);
 follow.start(w,r.id);follow.observe({...w,id:'replacement'});assert.equal(follow.state,null);
});

test('observing deep-frozen worlds never changes resident decisions, room claims, clocks or knowledge',()=>{
 const {w,r,b,follow}=fixture();r.inside=b.id;r.roomAt={x:2,y:5};const before=JSON.stringify(w);freeze(w);
 follow.start(w,r.id);for(let i=0;i<10;i++)follow.observe(w);residentFollowText(follow.state!);follow.clear();
 assert.equal(JSON.stringify(w),before);
});

test('scene follows both directions, snaps coordinate-space changes and restores outdoor zoom',()=>{
 const {w,r,b,other}=fixture(),{scene,camera,roomChanges,engine}=residentSceneHarness();w.clock.paused=false;
 scene.accept(snapshot(w));scene.zoom(.25);const outdoorZoom=camera.zoom;scene.focusPerson(r.id);
 const before=JSON.stringify(w);scene.accept(snapshot(w));assert.equal(JSON.stringify(w),before);
 for(let i=0;i<2;i++){
  r.inside=b.id;r.roomAt={x:3,y:5};scene.accept(snapshot(w));
  assert.equal(roomChanges.at(-1),b.id);assert.deepEqual(camera.center,{x:56,y:95});
  r.roomAt={x:5,y:6};scene.accept(snapshot(w));assert.deepEqual(camera.center,{x:88,y:111});
  r.inside=other.id;scene.accept(snapshot(w));assert.equal(roomChanges.at(-1),other.id);
  const tweens=engine.tweenCalls;r.inside=null;r.at={x:40+i,y:28};scene.accept(snapshot(w));
  assert.equal(roomChanges.at(-1),null);assert.equal(camera.zoom,outdoorZoom);
  assert.deepEqual(camera.center,{x:r.at.x*16+8,y:r.at.y*16+15});
  assert.equal(engine.tweenCalls,tweens,'room coordinates must not tween through outdoor space');
 }
});

test('scene freezes the last camera after death or departure even if the body/record later moves',()=>{
 for(const gone of ['dead','outside'] as const){
  const {w,r,b}=fixture(),{scene,camera,roomChanges}=residentSceneHarness();scene.accept(snapshot(w));scene.focusPerson(r.id);
  r.inside=b.id;r.roomAt={x:3,y:5};scene.accept(snapshot(w));const last={...camera.center};
  if(gone==='dead')r.status='dead';else r.residency='outside';r.inside=null;r.at={x:60,y:55};scene.accept(snapshot(w));scene.update(100);
  assert.deepEqual(camera.center,last);assert.equal(roomChanges.at(-1),b.id);assert.equal(scene.followState?.status,'stopped');
  r.status='alive';r.residency='resident';scene.accept(snapshot(w));scene.update(200);assert.deepEqual(camera.center,last);
  scene.focusPerson(r.id);assert.equal(roomChanges.at(-1),null);assert.equal(scene.followState?.status,'following');
 }
});

test('manual room exit stays outside and manual room entry stays inside until another explicit follow',()=>{
 const {w,r,b}=fixture(),{scene,roomChanges}=residentSceneHarness();scene.accept(snapshot(w));r.inside=b.id;r.roomAt={x:2,y:5};scene.focusPerson(r.id);
 scene.exitRoom();assert.equal(scene.followState,null);scene.accept(snapshot(w));assert.equal(roomChanges.at(-1),null);
 scene.focusPerson(r.id);assert.equal(roomChanges.at(-1),b.id);scene.enterRoom(b.id);assert.equal(scene.followState,null);
 r.inside=null;scene.accept(snapshot(w));assert.equal(roomChanges.at(-1),b.id);
});

test('unknown indoor positions restore the overview after manual panning and after precision disappears',()=>{
 const {w,r,b}=fixture(),{scene,camera,engine}=residentSceneHarness();r.inside=b.id;r.roomAt={x:3,y:5};scene.accept(snapshot(w));scene.focusPerson(r.id);
 const layout=roomLayout(w,b),overview={x:layout.width*8,y:layout.height*8};
 delete r.roomAt;scene.accept(snapshot(w));assert.deepEqual(camera.center,overview);assert.equal(scene.followState?.precise,false);
 engine.input.emit('pointerdown',{x:0,y:0});engine.input.emit('pointermove',{x:300,y:0,isDown:true});engine.input.emit('pointerup',{worldX:0,worldY:0});
 assert.equal(scene.followState,null);camera.centerOn(-100,-100);
 scene.focusPerson(r.id);assert.deepEqual(camera.center,overview);
 r.roomAt={x:-100,y:5};scene.accept(snapshot(w));assert.deepEqual(camera.center,overview);
});

test('scene handles missing target and vanished room without jumping, and new worlds clear stale follow',()=>{
 for(const removeRoom of [false,true]){
  const {w,r,b}=fixture(),{scene,camera,roomChanges}=residentSceneHarness();r.inside=b.id;r.roomAt={x:3,y:5};scene.accept(snapshot(w));scene.focusPerson(r.id);const last={...camera.center};
  if(removeRoom)w.buildings=w.buildings.filter(building=>building!==b);else w.residents=w.residents.filter(person=>person!==r);
  scene.accept(snapshot(w));scene.update(100);assert.deepEqual(camera.center,last);assert.equal(roomChanges.at(-1),b.id);
  assert.equal(scene.followState?.reason,removeRoom?'room-unavailable':'missing');
  const replacement=createWorld(19);scene.accept(snapshot(replacement));assert.equal(scene.followState,null);assert.equal(roomChanges.at(-1),null);
 }
});

test('scene execution on a deep-frozen fixture does not write world or resident data',()=>{
 const {w,r,b}=fixture(),{scene}=residentSceneHarness();r.inside=b.id;r.roomAt={x:3,y:5};freeze(w);const before=JSON.stringify(w);
 scene.accept(snapshot(w));scene.focusPerson(r.id);scene.update(1000);scene.exitRoom();scene.enterRoom(b.id);scene.home();
 assert.equal(JSON.stringify(w),before);
});

test('indoor interpolation uses valid progress in the actual room without trusting stale or malformed paths',()=>{
 const {w,r,b,other}=fixture(),{scene,camera}=residentSceneHarness();r.inside=b.id;r.roomAt={x:3,y:5};
 r.activity={planId:'a',action:{type:'sleep',minutes:60},definition:'test',startedAt:w.minute,remaining:60,path:[],target:{...b.door},room:{buildingId:b.id,mode:'work',path:[{x:4,y:5}],progress:.5,target:{x:4,y:5}}};
 scene.accept(snapshot(w));scene.focusPerson(r.id);assert.deepEqual(camera.center,{x:64,y:95});
 r.activity.room!.buildingId=other.id;scene.accept(snapshot(w));assert.deepEqual(camera.center,{x:56,y:95});
 r.activity.room!.buildingId=b.id;r.activity.room!.progress=NaN;scene.accept(snapshot(w));assert.deepEqual(camera.center,{x:56,y:95});
 r.activity.room!.progress=.5;r.activity.room!.path=[{x:10000,y:5}];scene.accept(snapshot(w));assert.deepEqual(camera.center,{x:56,y:95});
});

for(const indoor of [false,true])test(`dragging ${indoor?'indoors':'outdoors'} cancels follow and does not also pick another target`,()=>{
 const {w,r,b}=fixture(),{scene,engine,camera}=residentSceneHarness();scene.accept(snapshot(w));if(indoor){r.inside=b.id;r.roomAt={x:2,y:5};}scene.focusPerson(r.id);
 let selections=0;scene.onSelection=()=>selections++;
 engine.input.emit('pointerdown',{x:100,y:100});engine.input.emit('pointermove',{x:120,y:110,isDown:true});
 const dragged={x:camera.scrollX,y:camera.scrollY};engine.input.emit('pointerup',{worldX:0,worldY:0});scene.update(100);
 assert.equal(scene.followState,null);assert.equal(selections,0);assert.deepEqual({x:camera.scrollX,y:camera.scrollY},dragged);
});

test('picking another person or building releases follow while clicking the followed person retains it',()=>{
 const {w,r,b}=fixture(),{scene,engine}=residentSceneHarness();scene.accept(snapshot(w));scene.focusPerson(r.id);
 const click=(x:number,y:number)=>{engine.input.emit('pointerdown',{x:0,y:0});engine.input.emit('pointerup',{worldX:x,worldY:y});};
 click(r.at.x*16+8,r.at.y*16+3);assert.equal(scene.followState?.status,'following');
 const other=w.residents[1];click(other.at.x*16+8,other.at.y*16+3);assert.equal(scene.followState,null);
 scene.focusPerson(r.id);click((b.at.x+1)*16,(b.at.y+1)*16);assert.equal(scene.followState,null);
});

test('map navigation, explicit stop and clear selection release follow without moving residents',()=>{
 for(const action of ['home','watch','building','stop','clear'] as const){
  const {w,r,b}=fixture(),{scene}=residentSceneHarness();scene.accept(snapshot(w));scene.focusPerson(r.id);const before=JSON.stringify(w);
  if(action==='home')scene.home();else if(action==='watch')scene.watchTile({x:30,y:30});else if(action==='building')scene.focusBuilding(b.id);else if(action==='stop')scene.stopFollowing();else scene.clearSelection();
  scene.accept(snapshot(w));assert.equal(scene.followState,null);assert.equal(JSON.stringify(w),before);
 }
});

test('ferry follow uses the rendered passenger offset, not a route endpoint',()=>{
 const {w,r}=fixture(),{scene,camera}=residentSceneHarness();
 w.ferries={boats:[],builds:[],nextSerial:1,totals:{built:0,voyages:0,fares:0,refunds:0},trips:[{id:'t',boatId:'b',operatorId:r.id,sourceId:'a',destinationId:'b',headingId:'b',fare:0,departAt:w.minute,expiresAt:w.minute+10,capacity:4,phase:'sailing',seats:[],aboard:[r.id],pilotId:r.id,path:[],progress:0,returned:false,arrivedAt:null,reason:null}]};
 scene.accept(snapshot(w));scene.focusPerson(r.id);assert.deepEqual(camera.center,{x:r.at.x*16-4,y:r.at.y*16+8});
});

for(const [width,height] of [[1280,800],[390,844],[667,190]])test(`legacy and actual interiors keep positive zoom at ${width}x${height}`,()=>{
 const {w,r,b}=fixture(),{scene,camera,engine}=residentSceneHarness(width,height);delete w.rooms;delete r.roomAt;r.inside=b.id;scene.accept(snapshot(w));scene.focusPerson(r.id);
 assert.deepEqual(camera.center,{x:128,y:104});assert.ok(camera.zoom>0);assert.equal(scene.followState?.precise,false);
 engine.scale.emit('resize',{width,height},null,null,width,height);assert.ok(camera.zoom>0);
 w.rooms={tick:w.minute,claims:[],beds:{}};r.roomAt={x:3,y:5};scene.accept(snapshot(w));scene.update(10);assert.deepEqual(camera.center,{x:56,y:95});
 engine.scale.emit('resize',{width,height},null,null,width,height);scene.update(20);assert.ok(camera.zoom>0);assert.deepEqual(camera.center,{x:56,y:95});
});

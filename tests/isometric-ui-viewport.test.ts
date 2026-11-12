import assert from 'node:assert/strict';
import {test} from 'node:test';
import {IsometricPreview} from '../src/client/isometric-preview.js';
import {projectIsometric,screenToIsometric} from '../src/client/isometric-projection.js';
import {visibleWorldBounds,constrainWorldCamera} from '../src/client/isometric-viewport.js';
import {isometricObserverRoute} from '../scripts/isometric-observer-route.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
const route=isometricObserverRoute();
const area={x:8,y:150,width:374,height:240,frameWidth:390,frameHeight:844};
function setup(){const snapshot=structuredClone(route.snapshots[0]);const m=new IsometricPreview();m.setActive(true);m.accept(snapshot);m.resize(390,844);return {m,snapshot,r:snapshot.world.residents.find(r=>r.id===route.personId)!};}
function near(a:number,b:number){assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);}
function assertCentered(m:IsometricPreview,x=195,y=270){const r=m.snapshot!.world.residents.find(r=>r.id===route.personId)!;const actual=m.roomId?r.roomAt:m.viewport.residentTarget(r.id)?.anchor;assert.ok(actual,'a verified resident anchor must exist');const p=projectIsometric({x:actual.x+.5,y:actual.y+.5});near(p.x*m.camera!.zoom+m.camera!.origin.x,x);near(p.y*m.camera!.zoom+m.camera!.origin.y,y);}

test('isometric UI framing maps CSS area into canvas pixels and survives resize and drawer close',()=>{
 const {m,r}=setup();m.setViewArea(area);assert.ok(m.frameResident(r.id));assertCentered(m);
 const at=m.centerPoint!;m.resize(780,1688);assertCentered(m,390,540);near(m.centerPoint!.x,at.x);near(m.centerPoint!.y,at.y);
 m.setViewArea(null);assert.ok(m.frameResident(r.id));assertCentered(m,390,844);
});
test('edge resident stays in exposed area and culling uses the final offset camera, not a post-render translation',()=>{
 const {m,snapshot}=setup();const next=structuredClone(snapshot),r=next.world.residents.find(r=>r.id===route.personId)!;r.at={x:0,y:0};r.inside=null;r.activity=null;next.world.revision++;m.accept(next);m.setViewArea(area);
 assert.ok(m.frameResident(r.id));const p=projectIsometric({x:.5,y:.5});near(p.x*m.camera!.zoom+m.camera!.origin.x,195);near(p.y*m.camera!.zoom+m.camera!.origin.y,270);
 assert.deepEqual(m.camera,m.scene!.displayCamera);
 const offset={x:0,y:270-422};assert.deepEqual(m.scene!.bounds,visibleWorldBounds(m.camera!,snapshot.world,390,844,offset));
 for(const n of [0,125,250]){m.tick(n);assertCentered(m);assert.deepEqual(m.camera,m.scene!.displayCamera);}
 assert.throws(()=>constrainWorldCamera(m.camera!,snapshot.world,390,844,{x:391,y:0}),/isometric_ui_offset/);
});
test('UI framing never invents unknown room positions or moves to another room',()=>{
 const {m,snapshot}=setup();const next=structuredClone(snapshot),r=next.world.residents.find(r=>r.id===route.personId)!;m.setViewArea(area);const before=structuredClone(m.camera);r.inside=next.world.buildings[0].id;delete r.roomAt;next.world.revision++;m.accept(next);
 assert.equal(m.frameResident(r.id),false);assert.equal(m.roomId,null);assert.deepEqual(m.camera,before);
 r.status='dead';assert.equal(m.frameResident(r.id),false);r.status='alive';r.residency='outside';assert.equal(m.frameResident(r.id),false);
});
test('observer layout subscription reframes once, respects manual pan, restores on new selection and follows without world writes',()=>{
 const h=observerPreviewHarness();try{
  h.canvas.rect={left:0,top:0,width:390,height:844};h.accept(route.snapshots[0]);h.toggle();h.viewArea(area,route.personId);assertCentered(h.model);
  h.canvas.emit('pointerdown');h.canvas.emit('pointermove',{clientX:210,clientY:220});h.canvas.emit('pointerup',{clientX:210,clientY:220});
  const after=structuredClone(h.model.camera);h.viewArea({...area,height:150},route.personId);assert.deepEqual(h.model.camera,after,'layout must not undo deliberate pan');
  h.viewArea(area,null);h.viewArea(area,route.personId);assertCentered(h.model);
  h.startFollow(route.personId);h.viewArea({...area,height:100},route.personId);assertCentered(h.model,195,200);assert.equal(h.follow.state?.personId,route.personId);
  assert.equal(h.selections.length,0);assert.equal(h.frames.length,0);
 }finally{h.dispose();}
});

test('complete UI occlusion preserves camera/follow through resize and resumes on a usable area',()=>{
 const h=observerPreviewHarness();try{
  h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);h.viewArea(area,route.personId);
  const camera=structuredClone(h.model.camera),state=structuredClone(h.follow.state);
  h.viewArea({...area,width:0,height:0},route.personId);h.window.emit('resize');h.model.resize(700,900);h.model.tick(999);h.accept(route.snapshots[0]);
  assert.deepEqual(h.model.camera,camera);assert.deepEqual(h.follow.state,state);assert.equal(h.canvas.hidden,false);
  h.viewArea(area,route.personId);assertCentered(h.model);assert.deepEqual(h.follow.state,state);
 }finally{h.dispose();}
});

test('zoom immediately restores active framing but deliberate manual view keeps its zoom anchor',()=>{
 const h=observerPreviewHarness();try{
  h.accept(route.snapshots[0]);h.toggle();h.viewArea(area,route.personId);
  h.canvas.emit('wheel',{deltaY:-100,clientX:120,clientY:240});assertCentered(h.model);
  h.startFollow(route.personId);h.canvas.emit('keydown',{key:'+'});assertCentered(h.model);
  h.canvas.emit('pointerdown');h.canvas.emit('pointermove',{clientX:210,clientY:220});h.canvas.emit('pointerup',{clientX:210,clientY:220});
  const anchor={x:120,y:240},before=screenToIsometric(anchor,h.model.camera!)!;
  h.canvas.emit('wheel',{deltaY:-100,clientX:anchor.x,clientY:anchor.y});const after=screenToIsometric(anchor,h.model.camera!)!;
  near(before.x,after.x);near(before.y,after.y);assert.equal(h.follow.state,null);
 }finally{h.dispose();}
});

test('precise indoor resident uses the same room identity and final offset camera',()=>{
 const snapshot=structuredClone(route.snapshots.find(s=>s.world.residents.find(r=>r.id===route.personId)?.inside)!);
 const r=snapshot.world.residents.find(r=>r.id===route.personId)!,m=new IsometricPreview();m.setActive(true);m.accept(snapshot);m.resize(390,844);assert.equal(m.setRoom(r.inside!),null);
 m.setViewArea(area);assert.ok(m.frameResident(r.id));assertCentered(m);assert.equal(m.roomId,r.inside);assert.deepEqual(m.scene!.displayCamera,m.camera);
 const before=structuredClone(m.camera),other=snapshot.world.residents.find(p=>p.id!==r.id&&!p.inside);
 if(other){assert.equal(m.frameResident(other.id),false);assert.deepEqual(m.camera,before);assert.equal(m.roomId,r.inside);}
});

test('explicit tile and building navigation survives layout, rendering, real resize and zoom despite stale resident card',()=>{
 for(const navigation of ['tile','locate'] as const){
  const h=observerPreviewHarness();try{
   h.accept(route.snapshots[0]);h.toggle();h.viewArea(area,route.personId);
   const button=new ObserverElement();button.dataset[navigation]=navigation==='tile'?'10,10':route.buildingId;
   h.document.emit('click',{target:button});
   const b=h.model.snapshot!.world.buildings.find(b=>b.id===route.buildingId)!;
   const target=navigation==='tile'?{x:10,y:10}:{x:b.at.x+b.width/2,y:b.at.y+b.height/2},projected=projectIsometric(target);
   const camera=structuredClone(h.model.camera!);
   near(projected.x*camera.zoom+camera.origin.x,195);near(projected.y*camera.zoom+camera.origin.y,270);
   h.viewArea({...area,height:300},route.personId);assert.deepEqual(h.model.camera,camera,'pure layout preserves the actual located camera');
   h.window.emit('resize');h.model.tick(0);h.model.tick(125);
   const next=structuredClone(route.snapshots[0]);next.world.revision++;h.accept(next);
   assert.deepEqual(h.model.camera,camera,'rendering and accepted snapshots do not reuse the stale resident or new UI offset');
   const center=screenToIsometric({x:195,y:422},camera)!;
   h.canvas.rect={left:0,top:0,width:600,height:900};h.window.emit('resize');
   const resizedCenter=screenToIsometric({x:300,y:450},h.model.camera!)!;near(resizedCenter.x,center.x);near(resizedCenter.y,center.y);
   const before=screenToIsometric({x:120,y:240},h.model.camera!)!;
   h.canvas.emit('wheel',{deltaY:-100,clientX:120,clientY:240});const after=screenToIsometric({x:120,y:240},h.model.camera!)!;near(before.x,after.x);near(before.y,after.y);
   assert.equal(h.follow.state,null);
   h.startFollow(route.personId);const record=new ObserverElement();record.dataset.panel='people';h.document.emit('click',{target:record});h.viewArea(area,route.personId);assertCentered(h.model,300,270*900/844);
  }finally{h.dispose();}
 }
});

test('explicit room entry/exit retains actual camera through drawer changes, ticks and snapshots',()=>{
 const h=observerPreviewHarness();try{
  const snapshot=structuredClone(route.snapshots.find(s=>s.world.residents.find(r=>r.id===route.personId)?.inside)!);
  h.accept(snapshot);h.toggle();h.viewArea(area,route.personId);
  const enter=new ObserverElement();enter.dataset.enter=route.buildingId;h.document.emit('click',{target:enter});h.enter(route.buildingId);
  const indoor=structuredClone(h.model.camera);h.viewArea({...area,height:300},route.personId);h.model.tick(0);h.model.tick(125);
  const next=structuredClone(snapshot);next.world.revision++;h.accept(next);
  assert.deepEqual(h.model.camera,indoor,'manual room overview must not shift with UI layout or new snapshot');assert.equal(h.model.roomId,route.buildingId);
  const indoorCenter=screenToIsometric({x:195,y:422},h.model.camera!)!;
  h.canvas.rect={left:0,top:0,width:600,height:900};h.window.emit('resize');const resized=screenToIsometric({x:300,y:450},h.model.camera!)!;
  near(resized.x,indoorCenter.x);near(resized.y,indoorCenter.y);
  const exit=new ObserverElement();exit.dataset.action='exitroom';h.document.emit('click',{target:exit});h.enter(null);
  const outdoor=structuredClone(h.model.camera);h.viewArea(area,route.personId);h.model.tick(250);next.world.revision++;h.accept(structuredClone(next));
  assert.deepEqual(h.model.camera,outdoor);assert.equal(h.model.roomId,null);assert.equal(h.follow.state,null);
 }finally{h.dispose();}
});

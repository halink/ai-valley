/** Offline ordinary-engine and CPU observer tests, not browser or model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricWorkshopRoute} from '../scripts/isometric-workshop-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import {ordinaryCraftVisual} from '../src/client/isometric-crafting.js';
import {IsometricHomeInterior,homeInteriorSupport,fitRoomCamera} from '../src/client/isometric-interior.js';
import {personVisual} from '../src/client/person-pose.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import type {Resident,World} from '../src/shared/types.js';
const route=isometricWorkshopRoute();
const stage=(label='craft:working')=>structuredClone(route.snapshots[route.labels.indexOf(label)]);
const actor=(w:World)=>w.residents.find(r=>r.id===route.personId)!;
const room=(w:World)=>roomLayout(w,w.buildings.find(b=>b.id===route.buildingId)!);
const visual=(w:World)=>ordinaryCraftVisual(w,actor(w),room(w),personVisual(w,actor(w)));
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
function render(w:World){const view=new IsometricHomeInterior();view.accept({...stage(),world:w},route.buildingId);return {view,scene:view.render(fitRoomCamera(room(w),null,800,600),800,600)};}

test('original seed5402 actor discovers the existing workshop, crafts, installs a bench, leaves and crafts on return',()=>{
 assert.match(route.provenance,/only directly unpaused/);assert.match(route.provenance,/not autonomous/);assert.equal(route.plans.length,6);
 const seed=stage('seed').world,table=stage('table-craft:working').world,installed=stage('install:completed').world,arrived=stage('craft:on-site').world,working=stage().world,done=stage('craft:completed').world,exit=stage('exit:completed').world;
 assert.equal(actor(seed).inside,null);assert.equal(actor(seed).knownBuildings.includes(route.buildingId),false);assert.equal(actor(table).knownBuildings.includes(route.buildingId),true);
 assert.equal(seed.industry,undefined);assert.equal(table.industry!.stations.length,0);assert.deepEqual(room(table).slots.find(s=>s.key==='table')!.at,actor(table).roomAt);assert.equal(actor(table).inventory.wood,11);assert.equal(actor(table).inventory.fiber,undefined);
 assert.equal(installed.industry!.stations.filter(s=>s.buildingId===route.buildingId&&s.kind==='bench').length,1);assert.equal(actor(installed).inventory.wood,3);assert.equal(actor(installed).inventory.stone,4);assert.equal(actor(installed).inventory.fiber,3);
 assert.deepEqual(actor(arrived).roomAt,room(arrived).slots.find(s=>s.key==='station:bench')!.at);assert.equal(actor(arrived).activity!.remaining,40);assert.equal(actor(arrived).inventory.wood,3);
 assert.equal(actor(working).inventory.wood,0);assert.equal(actor(working).inventory.plank,undefined);assert.equal(actor(working).activity!.remaining,9.75);
 const batch=working.industry!.batches.find(b=>b.status==='working')!;assert.equal(batch.worked,30.25);assert.deepEqual(batch.input,{wood:3});assert.equal(batch.ownerId,route.personId);
 assert.equal(done.minute-arrived.minute,40);assert.equal(actor(done).inventory.plank,2);assert.equal(done.industry!.batches.at(-1)!.status,'completed');assert.equal(actor(done).activity,null);
 assert.equal(actor(exit).inside,null);assert.equal(actor(exit).roomAt,null);assert.deepEqual(actor(exit).inventory,actor(done).inventory);assert.deepEqual(seed.residents.map(r=>r.id),exit.residents.map(r=>r.id));
});

test('workshop preserves layout, coalesces the real bench/table footprint and picks original furniture/person identities',()=>{
 const s=stage(),w=s.world,before=structuredClone(w);freeze(w);const support=homeInteriorSupport(w,route.buildingId);assert.equal(support.supported,true);if(support.supported)assert.deepEqual(support.layout,room(w));
 assert.equal(room(w).height,16);assert.equal(room(w).slots.some(s=>s.kind==='bed'),false);
 const p=new IsometricPreview();p.setActive(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);assert.match(p.summary,/工坊室内/);
 const objects=p.scene!.objects;assert.ok(!objects.some(o=>o.subject.kind==='roomSlot'&&o.subject.id==='table'));assert.ok(!objects.some(o=>o.subject.id==='care'));
 for(const id of ['station:bench','kitchen',route.personId]){const object=objects.find(o=>o.subject.id===id)!;assert.ok(object);assert.equal(object.subject.placeholder,undefined);assert.ok(object.marks.some(m=>{const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident')assert.deepEqual(previewSelection(hit),{kind:'person',id:route.personId});return hit&&'id'in hit&&hit.id===id&&'roomId'in hit&&hit.roomId===route.buildingId;}),id);}
 assert.deepEqual(objects.find(o=>o.subject.id===route.personId)!.subject.at,actor(w).roomAt);assert.ok(objects.every(o=>['resident','roomSlot'].includes(o.subject.kind)));assert.deepEqual(w,before);
 const uninstalled=render(stage('table-craft:working').world).scene;assert.ok(uninstalled.objects.some(o=>o.subject.id==='table'));assert.ok(!uninstalled.objects.some(o=>o.subject.id==='station:bench'));
});

test('ordinary craft uses real table/bench batches, with neutral arrival before first input reservation',()=>{
 for(const label of ['table-craft:working','craft:working']){const w=stage(label).world,v=visual(w)!;assert.equal(personVisual(w,actor(w)).pose,'work');assert.equal(v.pose,'craft');assert.match(v.description,/不证明工具、火焰或成品已结算/);assert.notDeepEqual(v.marks(0),v.marks(560));}
 for(const label of ['table-craft:on-site','craft:on-site']){const w=stage(label).world,v=visual(w)!;assert.equal(v.pose,'ready');assert.match(v.description,/尚无加工批次/);assert.deepEqual(v.marks(0),v.marks(840));}
 for(const label of ['craft:entered','craft:completed','exit:exited'])assert.equal(visual(stage(label).world),null);
});

test('missing, foreign, stale, completed or inconsistent production evidence never becomes a craft gesture',()=>{
 const cases:Array<[string,(w:World,r:Resident)=>void]>=[
  ['no batch id',(_w,r)=>{if(r.activity!.action.type==='industry')delete r.activity!.action.batchId;}],
  ['missing batch',w=>{w.industry!.batches=[];}],['foreign batch',w=>{w.industry!.batches.at(-1)!.ownerId='someone-else';}],
  ['wrong building',w=>{w.industry!.batches.at(-1)!.buildingId='other';}],['wrong recipe',w=>{w.industry!.batches.at(-1)!.recipe.id='axe';}],
  ['wrong definition',w=>{w.industry!.batches.at(-1)!.definition='recipe/industry/axe@1';}],['wrong action',w=>{w.industry!.batches.at(-1)!.actionKey='other';}],
  ['completed',w=>{w.industry!.batches.at(-1)!.status='completed';}],['cancelled',w=>{w.industry!.batches.at(-1)!.status='cancelled';}],
  ['not worked',w=>{w.industry!.batches.at(-1)!.worked=0;}],['nonfinite work',w=>{w.industry!.batches.at(-1)!.worked=NaN;}],['overworked',w=>{w.industry!.batches.at(-1)!.worked=40;}],
  ['future work',w=>{w.industry!.batches.at(-1)!.lastAt=w.minute+1;}],['future creation',w=>{w.industry!.batches.at(-1)!.createdAt=w.minute+1;}],
  ['missing input',w=>{w.industry!.batches.at(-1)!.input={};}],['wrong input',w=>{w.industry!.batches.at(-1)!.input={wood:2};}],
  ['duplicate active',w=>{w.industry!.batches.push({...w.industry!.batches.at(-1)!,id:'duplicate'});}],
  ['missing station',w=>{w.industry!.stations=[];}],['removing station',w=>{w.industry!.stations[0].removalWorked=1;}],['future station',w=>{w.industry!.stations[0].installedAt=w.minute+1;}],
  ['room point',(_w,r)=>{r.roomAt=null;}],['off station',(_w,r)=>{r.roomAt!.x++;}],['outside',(_w,r)=>{r.inside=null;}],['wrong door',(_w,r)=>{r.at.x++;}],['wrong target',(_w,r)=>{r.activity!.target.x++;}],
  ['zero remaining',(_w,r)=>{r.activity!.remaining=0;}],['future action',(w,r)=>{r.activity!.startedAt=w.minute+1;}],['outdoor travel',(_w,r)=>{r.activity!.path=[{x:1,y:1}];}],
  ['indoor travel',(_w,r)=>{r.activity!.room={buildingId:route.buildingId,mode:'work',target:{...r.roomAt!},path:[{x:8,y:9}],progress:0};}],
  ['leaving',(_w,r)=>{r.activity!.room={buildingId:route.buildingId,mode:'exit',target:{...r.roomAt!},path:[],progress:0};}],
  ['other work',(_w,r)=>{r.activity!.action={type:'industry',operation:'repairTool',buildingId:route.buildingId};}],['infant',(_w,r)=>{r.lifeStage='infant';}],
 ];
 for(const [label,mutate] of cases){const w=stage().world;mutate(w,actor(w));assert.equal(visual(w),null,label);}
});

test('original observer follows entry, neutral arrival, batch work, completion and exit without hiding 2.5D',()=>{
 for(const labels of [['approach:completed','table-craft:entered','table-craft:on-site','table-craft:working','table-craft:completed'],['return:completed','craft:entered','craft:on-site','craft:working','craft:completed','exit:exited','exit:completed']]){
  const h=observerPreviewHarness();h.accept(stage(labels[0]));h.toggle();h.startFollow(route.personId);
  for(const label of labels.slice(1)){const s=stage(label);h.accept(s);assert.equal(h.canvas.hidden,false,label);assert.equal(h.follow.state?.personId,route.personId);assert.equal(h.follow.state?.status,'following');assert.equal(h.model.roomId,actor(s.world).inside??null);}
  assert.equal(h.warnings.length,0);h.dispose();
 }
});

test('unsupported workshop work has explicit markers and preserves identity on 2D handback',()=>{
 for(const operation of ['upgrade','repairTool','install'] as const){const s=stage(),r=actor(s.world);r.activity!.action={type:'industry',operation,buildingId:route.buildingId,station:'bench'};
  const object=render(s.world).scene.objects.find(o=>o.subject.id===r.id)!;assert.match(object.subject.placeholder!,/work/);assert.deepEqual(object.subject.at,r.roomAt);
  const h=observerPreviewHarness();h.accept(s);h.enter(route.buildingId);h.toggle();const button=new ObserverElement();button.dataset.follow=r.id;h.document.emit('click',{target:button});h.startFollow(r.id);assert.equal(h.canvas.hidden,true);assert.equal(h.follow.state?.personId,r.id);h.dispose();
 }
 const unknown=stage();actor(unknown.world).roomAt=null;const {scene}=render(unknown.world);assert.ok(scene.unknownLocationCount>0);assert.ok(!scene.objects.some(o=>o.subject.id===route.personId));
});

test('craft is immutable, pause-aware and detached from world collection reads while animation reuses floor/pose buckets',()=>{
 const w=stage().world,before=structuredClone(w);freeze(w);const v=visual(w)!;
 for(const t of [0,280,560,840,NaN,Infinity,-1])assert.ok(v.marks(t).every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)));
 const {view,scene}=render(w),stats=view.stats,next=view.animate(scene,560);assert.equal(next.terrain,scene.terrain);assert.deepEqual(next.objects.map(o=>o.subject),scene.objects.map(o=>o.subject));for(const key of ['floorBuilds','poseBuilds','bucketBuilds'] as const)assert.equal(view.stats[key],stats[key]);assert.deepEqual(w,before);
 const paused=structuredClone(w);paused.clock.paused=true;const p=visual(paused)!;assert.deepEqual(p.marks(0),p.marks(840));for(const key of ['buildings','residents','industry','rooms'] as const)Object.defineProperty(paused,key,{get(){throw new Error('animation scanned '+key);}});assert.doesNotThrow(()=>p.marks(560));
});

test('workshop sizes use actual nonresidential layout, while bad geometry and unsupported rooms remain rejected',()=>{
 for(const change of [{width:33},{height:32},{width:0},{height:NaN}]){const w=stage().world;Object.assign(w.buildings.find(b=>b.id===route.buildingId)!,change);Object.defineProperty(w,'industry',{get(){throw new Error('oversized room read stations');}});assert.equal(homeInteriorSupport(w,route.buildingId).supported,false);}
 const w=stage().world;w.buildings.find(b=>b.id===route.buildingId)!.capacity=1000;const support=homeInteriorSupport(w,route.buildingId);assert.equal(support.supported,true);if(support.supported)assert.equal(support.layout.height,16);
 const missing=stage().world;delete missing.rooms;assert.equal(homeInteriorSupport(missing,route.buildingId).supported,false);
});

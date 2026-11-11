/** CPU-only synthetic acceptance. No browser, model, network or saved world. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricLodgeRoute} from '../scripts/isometric-lodge-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import {IsometricHomeInterior,homeInteriorSupport,fitRoomCamera} from '../src/client/isometric-interior.js';
import {ordinaryCookingVisual} from '../src/client/isometric-cooking.js';
import {personVisual} from '../src/client/person-pose.js';
import {pickIsometricStudy} from '../src/client/isometric-study.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import type {World,Resident} from '../src/shared/types.js';
const route=isometricLodgeRoute();
const stage=(name:string)=>structuredClone(route.snapshots[route.labels.indexOf(name)]);
const person=(w:World)=>w.residents.find(r=>r.id===route.personId)!;
const layout=(w:World)=>roomLayout(w,w.buildings.find(b=>b.id===route.buildingId)!);
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
function render(w:World){const view=new IsometricHomeInterior();view.accept({...stage('cook:working'),world:w},route.buildingId);return {view,scene:view.render(fitRoomCamera(layout(w),null,800,600),800,600)};}

test('seed5401 explicit legal cook walks into the lodge, spends real kitchen time, converts original food, then exits',()=>{
 assert.deepEqual(route.labels,['seed','cook:entered','cook:on-site','cook:working','cook:completed','exit:exited','exit:completed']);
 assert.match(route.provenance,/not autonomous/);assert.equal(route.plans.length,2);assert.deepEqual(route.plans[0].action,{type:'cook',quantity:1,buildingId:route.buildingId});
 const initial=stage('seed').world,entered=stage('cook:entered').world,arrived=stage('cook:on-site').world,working=stage('cook:working').world,done=stage('cook:completed').world,exited=stage('exit:completed').world;
 assert.equal(person(initial).inside,null);assert.equal(person(entered).inside,route.buildingId);assert.notDeepEqual(person(entered).roomAt,person(arrived).roomAt);
 assert.deepEqual(person(arrived).roomAt,layout(arrived).slots.find(s=>s.key==='kitchen')!.at);assert.equal(person(arrived).activity!.remaining,20);
 assert.equal(person(working).activity!.remaining,9.75);assert.equal(done.minute-arrived.minute,20);assert.ok(route.plans[0].end-route.plans[0].start>20);
 for(const w of [entered,arrived,working])assert.deepEqual(person(w).inventory,person(initial).inventory,'no early input consumption or invented output');
 assert.deepEqual(person(done).inventory,{...person(initial).inventory,turnip:3,water:3,meal:2});
 assert.equal(person(done).inside,route.buildingId);assert.equal(person(done).activity,null);assert.equal(person(exited).inside,null);assert.equal(person(exited).roomAt,null);
 assert.deepEqual(person(exited).inventory,person(done).inventory);assert.deepEqual(initial.residents.map(r=>r.id),exited.residents.map(r=>r.id));
});

test('frozen lodge reuses authoritative layout and IDs, keeps real furniture selectable, and invents no fire or food objects',()=>{
 const w=stage('cook:working').world,before=structuredClone(w);freeze(w);const support=homeInteriorSupport(w,route.buildingId);assert.equal(support.supported,true);if(support.supported)assert.deepEqual(support.layout,layout(w));
 const {view,scene}=render(w),furniture=scene.objects.filter(o=>o.subject.kind==='roomSlot'),expected=layout(w).slots.filter(s=>['bed','table','kitchen'].includes(s.kind));
 assert.deepEqual(furniture.map(o=>o.subject.id).sort(),expected.map(s=>s.key).sort());
 for(const id of ['table','kitchen','bed:0']){const object=furniture.find(o=>o.subject.id===id)!;assert.ok(object);assert.ok(object.marks.some(m=>{const hit=pickIsometricStudy(scene,{x:m.x+scene.camera.origin.x,y:m.y+scene.camera.origin.y});return hit&&'id'in hit&&hit.id===id&&'roomId'in hit&&hit.roomId===route.buildingId;}),id);}
 const cook=scene.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===route.personId)!;assert.ok(cook);assert.equal(cook.subject.placeholder,undefined);assert.match(cook.subject.description!,/普通烹饪/);assert.deepEqual(cook.subject.at,person(w).roomAt);
 assert.ok(scene.objects.every(o=>o.subject.kind==='roomSlot'||o.subject.kind==='resident'));const stats=view.stats;
 const next=view.animate(scene,480);assert.equal(next.terrain,scene.terrain);assert.equal(view.stats.poseBuilds,stats.poseBuilds);assert.equal(view.stats.floorBuilds,stats.floorBuilds);assert.deepEqual(next.objects.map(o=>o.subject),scene.objects.map(o=>o.subject));assert.deepEqual(w,before);
});

test('ordinary cook is a conservative local gesture and never changes shared work semantics',()=>{
 const w=stage('cook:working').world,r=person(w),l=layout(w);assert.equal(personVisual(w,r).pose,'work');
 const visual=ordinaryCookingVisual(w,r,l,personVisual(w,r));assert.ok(visual);assert.equal(visual.pose,'cook');assert.match(visual.description,/普通烹饪/);
 const frames=[0,240,480,720].map(t=>visual.marks(t));assert.ok(frames.some(f=>JSON.stringify(f)!==JSON.stringify(frames[0])));assert.ok(frames.every(f=>f.length===frames[0].length));
 for(const frame of frames)assert.ok(frame.every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)));
 const mutations:Array<[string,(w:World,r:Resident)=>void]>=[
  ['missing room point',(_w,r)=>{r.roomAt=null;}],['off kitchen',(_w,r)=>{r.roomAt!.x++;}],['outside',(_w,r)=>{r.inside=null;}],
  ['wrong door',(_w,r)=>{r.at.x++;}],['wrong target',(_w,r)=>{r.activity!.target.x++;}],['remaining zero',(_w,r)=>{r.activity!.remaining=0;}],
  ['nonfinite remaining',(_w,r)=>{r.activity!.remaining=NaN;}],['future start',(w,r)=>{r.activity!.startedAt=w.minute+1;}],
  ['wrong building',(_w,r)=>{if(r.activity!.action.type==='cook')r.activity!.action.buildingId='missing';}],
  ['outdoor travel',(_w,r)=>{r.activity!.path=[{x:1,y:1}];}],['indoor travel',(_w,r)=>{r.activity!.room={buildingId:route.buildingId,mode:'work',target:{...r.roomAt!},path:[{x:8,y:5}],progress:0};}],
  ['exit journey',(_w,r)=>{r.activity!.room={buildingId:route.buildingId,mode:'exit',target:{...r.roomAt!},path:[],progress:0};}],['other work',(_w,r)=>{r.activity!.action={type:'industry',operation:'craft',buildingId:route.buildingId};}],
  ['zero quantity',(_w,r)=>{if(r.activity!.action.type==='cook')r.activity!.action.quantity=0;}],['fractional quantity',(_w,r)=>{if(r.activity!.action.type==='cook')r.activity!.action.quantity=.5;}],
  ['finished',(_w,r)=>{r.activity=null;}],['infant',(_w,r)=>{r.lifeStage='infant';}],
  ['ill',(w,r)=>{w.health={cases:[{personId:r.id,stage:'active',severity:80}],transports:[]} as unknown as World['health'];}],
  ['carried',(w,r)=>{w.health={cases:[],transports:[{patientId:r.id,phase:'carrying'}]} as unknown as World['health'];}],
 ];
 for(const [label,mutate] of mutations){const copy=structuredClone(w),p=person(copy);mutate(copy,p);assert.equal(ordinaryCookingVisual(copy,p,layout(copy),personVisual(copy,p)),null,label);}
});

test('observer follows the same identity through outdoor, lodge cook, completion and exit without handback',()=>{
 const h=observerPreviewHarness();h.accept(stage('seed'));h.toggle();h.startFollow(route.personId);
 for(const snapshot of route.snapshots.slice(1)){h.accept(snapshot);assert.equal(h.canvas.hidden,false);assert.equal(h.follow.state?.personId,route.personId);assert.equal(h.follow.state?.status,'following');assert.equal(h.model.roomId,person(snapshot.world).inside??null);}
 assert.equal(h.warnings.length,0);h.dispose();
});

test('unsupported lodge work, illness, carrying and infancy remain markers and hand follow back to 2D',()=>{
 for(const kind of ['work','ill','carried','infant'] as const){const s=stage('cook:working'),r=person(s.world);
  if(kind==='work'){r.activity!.action={type:'industry',operation:'craft',buildingId:route.buildingId};r.roomAt={...layout(s.world).slots.find(slot=>slot.key==='table')!.at};}
  if(kind==='ill')s.world.health={cases:[{personId:r.id,stage:'active',severity:80}],transports:[]} as unknown as World['health'];
  if(kind==='carried')s.world.health={cases:[],transports:[{patientId:r.id,phase:'carrying'}]} as unknown as World['health'];
  if(kind==='infant')r.lifeStage='infant';
  const {scene}=render(s.world),object=scene.objects.find(o=>o.subject.id===r.id)!;assert.match(object.subject.placeholder!,new RegExp(kind));assert.deepEqual(object.subject.at,r.roomAt);
  const h=observerPreviewHarness();h.accept(s);h.enter(route.buildingId);h.toggle();const button=new ObserverElement();button.dataset.follow=r.id;h.document.emit('click',{target:button});h.startFollow(r.id);assert.equal(h.canvas.hidden,true,kind);assert.equal(h.follow.state?.personId,r.id);h.dispose();
 }
});

test('lodge boundaries reject missing, excessive or malformed layouts before scanning stations',()=>{
 for(const patch of [{capacity:1e9},{width:33},{height:32},{capacity:NaN},{width:0}]){const w=stage('cook:working').world;Object.assign(w.buildings.find(b=>b.id===route.buildingId)!,patch);Object.defineProperty(w,'industry',{get(){throw new Error('oversized layout reached station scan');}});assert.equal(homeInteriorSupport(w,route.buildingId).supported,false);}
 const missing=stage('cook:working').world;delete missing.rooms;assert.equal(homeInteriorSupport(missing,route.buildingId).supported,false);
 for(const kind of ['barn','clinic','greenhouse'] as const){const w=stage('cook:working').world;w.buildings.find(b=>b.id===route.buildingId)!.kind=kind;assert.equal(homeInteriorSupport(w,route.buildingId).supported,false);}
});

test('cooking animation is pause-aware and detached from subsequent world collection reads',()=>{
 const w=stage('cook:working').world,r=person(w),l=layout(w),before=structuredClone(w);freeze(w);const visual=ordinaryCookingVisual(w,r,l,personVisual(w,r))!;
 for(const t of [0,280,560,840,NaN,Infinity,-1])assert.ok(visual.marks(t).every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)));assert.deepEqual(w,before);
 const paused=structuredClone(w);paused.clock.paused=true;const p=person(paused),v=ordinaryCookingVisual(paused,p,layout(paused),personVisual(paused,p))!;assert.deepEqual(v.marks(0),v.marks(840));
 for(const key of ['buildings','residents','health','rooms'] as const)Object.defineProperty(paused,key,{get(){throw new Error('animation scanned '+key);}});assert.doesNotThrow(()=>v.marks(280));
 const legacy=structuredClone(w),old=person(legacy);if(old.activity!.action.type==='cook')delete old.activity!.action.buildingId;assert.ok(ordinaryCookingVisual(legacy,old,layout(legacy),personVisual(legacy,old)),'legacy target doorway still resolves original kitchen');
});

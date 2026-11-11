/** Synthetic CPU/DOM evidence, not browser, live-save or autonomous-learning acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricSchoolRoute} from '../scripts/isometric-school-route.js';
import {roomLayout,actionRoom} from '../src/shared/rooms.js';
import {homeInteriorSupport,IsometricHomeInterior,fitRoomCamera} from '../src/client/isometric-interior.js';
import {IsometricPreview,PREVIEW_LIMITATIONS,previewSelection} from '../src/client/isometric-preview.js';
import {personVisual} from '../src/client/person-pose.js';
import {atActionPosition} from '../src/client/action-position.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import type {Snapshot} from '../src/shared/types.js';

const route=isometricSchoolRoute();
const stage=(label='both-on-site')=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const actor=(s:Snapshot,id=route.teacherId)=>s.world.residents.find(r=>r.id===id)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
function preview(s=stage()){
 const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;
}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('school shares the actual 16x13 layout, draws only the table and static kitchen, never a classroom set',()=>{
 const s=stage(),b=building(s),l=roomLayout(s.world,b),support=homeInteriorSupport(s.world,b.id);
 assert.equal(b.kind,'school');assert.equal(support.supported,true);assert.deepEqual(support.layout,l);assert.equal(l.width,16);assert.equal(l.height,13);assert.deepEqual(l.entry,{x:8,y:11});
 const p=preview(s);assert.match(p.summary,/学校室内/);assert.match(PREVIEW_LIMITATIONS,/不补造课桌、黑板、书本或教学手势/);assert.match(PREVIEW_LIMITATIONS,/在场不表示取得进度或完成学习/);
 const slots=p.scene!.objects.filter(o=>o.subject.kind==='roomSlot');assert.deepEqual(slots.map(o=>o.subject.id).sort(),['kitchen','table']);
 for(const o of slots)assert.deepEqual(o.subject.at,l.slots.find(slot=>slot.key===o.subject.id)!.at);
 assert.ok(l.slots.some(s=>s.key==='care'));assert.ok(!p.scene!.objects.some(o=>o.subject.id==='care'||o.subject.id.startsWith('bed:')));
 // Capacity is not a school bed count. Match the engine even for a large non-bed capacity.
 for(const capacity of [4,1000000]){const next=stage();building(next).capacity=capacity;const support=homeInteriorSupport(next.world,b.id);assert.equal(support.supported,true);assert.deepEqual(support.layout,l);assert.deepEqual(preview(next).scene!.objects,p.scene!.objects);}
});

test('actual teacher and learner room targets keep original neutral appearance without teaching or reading gestures',()=>{
 const s=stage(),p=preview(s),center=Math.floor(roomLayout(s.world,building(s)).width/2);
 for(const [id,target] of [[route.teacherId,{x:center,y:5}],[route.learnerId,{x:center-2,y:8}]] as const){
  const r=actor(s,id),o=p.scene!.objects.find(o=>o.subject.id===id)!;
  assert.equal(r.activity!.action.type,'education');assert.equal(atActionPosition(s.world,r),true);assert.deepEqual(actionRoom(s.world,r,r.activity!)!.target,target);assert.deepEqual(r.roomAt,target);
  assert.equal(personVisual(s.world,r).pose,'idle');assert.equal(o.subject.placeholder,undefined);assert.deepEqual(o.subject.at,r.roomAt);assert.match(o.subject.description!,/未绘制授课、读写或学习手势/);
  const neutral=stage();actor(neutral,id).activity=null;actor(neutral,id).plan=null;
  assert.deepEqual(preview(neutral).scene!.objects.find(o=>o.subject.id===id)!.marks,o.marks);
 }
});

test('lesson/enrollment records and actual gains never invent people, props or a completed-learning pose',()=>{
 const solo=stage('teacher-solo'),p=preview(solo);assert.equal(actor(solo,route.learnerId).inside,null);assert.ok(!p.scene!.objects.some(o=>o.subject.id===route.learnerId));
 const s=stage(),baseline=preview(s).scene!.objects;
 actor(s).inventory.wood=999;actor(s).inventory.stone=999;s.world.education!.lessons[0].materials={wood:999,stone:999};
 assert.deepEqual(preview(s).scene!.objects,baseline);assert.ok(baseline.every(o=>o.subject.kind==='roomSlot'||o.subject.kind==='resident'));
 for(const label of ['both-on-site','first-shared-work','half-learning','before-completion','learning:completed']){
  const objects=preview(stage(label)).scene!.objects;
  for(const id of [route.teacherId,route.learnerId]){const o=objects.find(o=>o.subject.id===id)!;assert.deepEqual(o.marks,baseline.find(o=>o.subject.id===id)!.marks,label);assert.match(o.subject.description!,/在场不表示正在授课、取得进度或完成学习/);}
 }
 const absent=stage();actor(absent,route.learnerId).inside=null;actor(absent,route.learnerId).roomAt=null;
 assert.ok(!preview(absent).scene!.objects.some(o=>o.subject.id===route.learnerId),'even an enrolled learner is not drawn without actual inside/roomAt');
});

test('school picking preserves the original person ID, room ID and room-slot key',()=>{
 const p=preview();
 for(const id of [route.teacherId,route.learnerId,'table','kitchen']){
  const o=p.scene!.objects.find(o=>o.subject.id===id)!;assert.ok(o,id);
  assert.ok(o.marks.some(m=>{
   const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});
   if(!hit||!('id'in hit)||hit.id!==id)return false;
   assert.equal('roomId'in hit&&hit.roomId,route.buildingId);
   if(hit.kind==='resident')assert.deepEqual(previewSelection(hit),{kind:'person',id});return true;
  }),id);
 }
});

test('school unknown position and unsupported infant, illness, cook/craft poses stay explicit, never snapped to an entrance',()=>{
 for(const mode of ['ill','infant','cook','craft'] as const){
  const s=stage(),r=actor(s),l=roomLayout(s.world,building(s));
  if(mode==='ill')s.world.health!.cases.push({id:'synthetic-render-only-ill',personId:r.id,stage:'acute',severity:80} as any);
  if(mode==='infant')r.lifeStage='infant';
  if(mode==='cook'){r.activity!.action={type:'cook',buildingId:route.buildingId,quantity:1};r.roomAt={...l.slots.find(slot=>slot.key==='kitchen')!.at};}
  if(mode==='craft'){r.activity!.action={type:'industry',operation:'craft',buildingId:route.buildingId,recipeId:'fiber',minutes:20};r.roomAt={...l.slots.find(slot=>slot.key==='table')!.at};}
  const p=preview(s),o=p.scene!.objects.find(o=>o.subject.id===r.id)!;assert.ok(o.subject.placeholder,mode);assert.deepEqual(o.subject.at,r.roomAt);assert.ok(p.followResident(r.id),mode);
 }
 for(const at of [null,{x:NaN,y:5},{x:16,y:5},{x:-1,y:5}]){const s=stage();actor(s).roomAt=at;const p=preview(s);assert.ok(p.scene!.unknownLocationCount>0);assert.ok(!p.scene!.objects.some(o=>o.subject.id===route.teacherId));assert.match(p.followResident(route.teacherId)!,/精确位置/);}
});

test('school snapshots stay frozen and animation does not reread education, people, layouts or stations',()=>{
 const s=stage();s.world.clock.paused=true;const before=structuredClone(s);freeze(s);
 const view=new IsometricHomeInterior();view.accept(s,route.buildingId);const l=roomLayout(s.world,building(s)),scene=view.render(fitRoomCamera(l,null,960,640),960,640),stats=view.stats;
 assert.deepEqual(view.animate(scene,1000).objects,scene.objects);assert.equal(view.stats.poseBuilds,stats.poseBuilds);assert.equal(view.stats.floorBuilds,stats.floorBuilds);assert.equal(view.stats.bucketBuilds,stats.bucketBuilds);assert.deepEqual(s,before);
 const mutable=stage();view.accept(mutable,route.buildingId);const next=view.render(scene.displayCamera,960,640);
 for(const field of ['buildings','rooms','residents','education','industry'] as const)Object.defineProperty(mutable.world,field,{get(){throw new Error('animation rescanned '+field);}});
 assert.doesNotThrow(()=>view.animate(next,700));
});

test('school manual entry/exit and Escape preserve the original default 2D route',()=>{
 const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(stage());assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);
 h.toggle();const enter=new ObserverElement();enter.dataset.enter=route.buildingId;h.document.emit('click',{target:enter});h.enter(route.buildingId);
 assert.equal(h.room(),route.buildingId);assert.equal(h.canvas.hidden,false);assert.match(h.model.summary,/学校室内/);
 h.canvas.emit('pointerdown',{pointerId:27});h.enter(null);assert.equal(h.canvas.captures.has(27),false);assert.equal(h.room(),null);assert.equal(h.canvas.hidden,false);
 h.enter(route.buildingId);h.document.emit('keydown',{key:'Escape'});assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.room(),route.buildingId);assert.deepEqual(h.warnings,[]);h.dispose();
});

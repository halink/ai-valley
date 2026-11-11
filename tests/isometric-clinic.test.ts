/** Synthetic, offline CPU evidence. These are not browser or real-world medical images. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricClinicRoute} from '../scripts/isometric-clinic-route.js';
import {roomLayout,actionRoom} from '../src/shared/rooms.js';
import {homeInteriorSupport,IsometricHomeInterior,fitRoomCamera} from '../src/client/isometric-interior.js';
import {IsometricPreview,PREVIEW_LIMITATIONS,previewSelection} from '../src/client/isometric-preview.js';
import {personVisual} from '../src/client/person-pose.js';
import {atActionPosition} from '../src/client/action-position.js';
import type {Snapshot} from '../src/shared/types.js';

const route=isometricClinicRoute();
const stage=(label='both-on-site')=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const actor=(s:Snapshot,id=route.doctorId)=>s.world.residents.find(r=>r.id===id)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
function preview(s=stage()){
 const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;
}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('clinic uses actual shared layout, capacity beds and no invented care or body-bay furniture',()=>{
 const s=stage(),b=building(s),l=roomLayout(s.world,b),support=homeInteriorSupport(s.world,b.id);
 assert.equal(b.kind,'clinic');assert.equal(support.supported,true);assert.deepEqual(support.layout,l);
 const p=preview(s);assert.match(p.summary,/诊所室内/);assert.match(PREVIEW_LIMITATIONS,/不补造药品、器械或病人/);assert.match(PREVIEW_LIMITATIONS,/治疗、给药与护理手势未支持/);
 const slots=p.scene!.objects.filter(o=>o.subject.kind==='roomSlot'),expected=l.slots.filter(s=>['bed','table','kitchen'].includes(s.kind));
 assert.deepEqual(slots.map(o=>o.subject.id).sort(),expected.map(s=>s.key).sort());assert.equal(slots.filter(o=>o.subject.id.startsWith('bed:')).length,b.capacity);
 for(const o of slots)assert.deepEqual(o.subject.at,l.slots.find(slot=>slot.key===o.subject.id)!.at);
 assert.ok(l.slots.some(s=>s.key==='care'));assert.equal(l.slots.filter(s=>s.kind==='bodyBay').length,2);
 assert.ok(!p.scene!.objects.some(o=>o.subject.id==='care'||o.subject.id.startsWith('bodyBay:')));
});

test('actual health role targets retain original appearance, never treatment gestures or a bed-occupying sleep pose',()=>{
 const s=stage(),p=preview(s);
 for(const [id,key] of [[route.doctorId,'care'],[route.patientId,'bed:0']]){
  const r=actor(s,id),o=p.scene!.objects.find(o=>o.subject.id===id)!;
  assert.equal(r.activity!.action.type,'health');assert.equal(atActionPosition(s.world,r),true);assert.deepEqual(actionRoom(s.world,r,r.activity!)!.target,roomLayout(s.world,building(s)).slots.find(s=>s.key===key)!.at);
  assert.equal(personVisual(s.world,r).pose,'idle');assert.equal(o.subject.placeholder,undefined);assert.deepEqual(o.subject.at,r.roomAt);assert.match(o.subject.description!,/未绘制治疗、给药或护理手势/);
  const neutral=stage();actor(neutral,id).activity=null;actor(neutral,id).plan=null;
  assert.deepEqual(preview(neutral).scene!.objects.find(o=>o.subject.id===id)!.marks,o.marks);
 }
});

test('a recorded patient or medicine does not create a drawable person, supplies, equipment or output',()=>{
 const solo=stage('doctor-solo'),p=preview(solo);assert.equal(actor(solo,route.patientId).inside,null);assert.ok(!p.scene!.objects.some(o=>o.subject.id===route.patientId));
 const s=stage(),baseline=preview(s).scene!.objects;
 actor(s).inventory.medicine=999;s.world.health!.appointments.find(a=>a.id===route.appointmentId)!.stock={medicine:999,water:999};
 assert.deepEqual(preview(s).scene!.objects,baseline);
 assert.ok(baseline.every(o=>o.subject.kind==='roomSlot'||o.subject.kind==='resident'));
 for(const label of ['both-on-site','first-shared-work','half-treatment','before-completion','treatment:completed']){
  const now=stage(label),objects=preview(now).scene!.objects;
  for(const id of [route.doctorId,route.patientId])assert.deepEqual(objects.find(o=>o.subject.id===id)!.marks,baseline.find(o=>o.subject.id===id)!.marks,label);
 }
});

test('clinic picking uses actual original person identity and room slot key',()=>{
 const p=preview();
 for(const id of [route.doctorId,route.patientId,'table','kitchen','bed:0']){
  const o=p.scene!.objects.find(o=>o.subject.id===id)!;assert.ok(o,id);
  assert.ok(o.marks.some(m=>{
   const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});
   if(!hit||!('id'in hit)||hit.id!==id)return false;
   assert.equal('roomId'in hit&&hit.roomId,route.buildingId);
   if(hit.kind==='resident')assert.deepEqual(previewSelection(hit),{kind:'person',id});return true;
  }),id);
 }
});

test('clinic unsupported illness, infant and work poses remain explicit, and unknown location never uses an entrance',()=>{
 for(const mode of ['ill','infant','cook','craft'] as const){
  const s=stage(),r=actor(s),l=roomLayout(s.world,building(s));
  if(mode==='ill')s.world.health!.cases.push({...s.world.health!.cases[0],id:'synthetic-render-only-ill',personId:r.id,severity:80});
  if(mode==='infant')r.lifeStage='infant';
  if(mode==='cook'){r.activity!.action={type:'cook',buildingId:route.buildingId,quantity:1};r.roomAt={...l.slots.find(slot=>slot.key==='kitchen')!.at};}
  if(mode==='craft'){r.activity!.action={type:'industry',operation:'craft',buildingId:route.buildingId,recipeId:'fiber',minutes:20};r.roomAt={...l.slots.find(slot=>slot.key==='table')!.at};}
  const p=preview(s),o=p.scene!.objects.find(o=>o.subject.id===r.id)!;assert.ok(o.subject.placeholder,mode);assert.deepEqual(o.subject.at,r.roomAt);assert.ok(p.followResident(r.id),mode);
 }
 const s=stage();actor(s).roomAt=null;const p=preview(s);assert.ok(p.scene!.unknownLocationCount>0);assert.ok(!p.scene!.objects.some(o=>o.subject.id===route.doctorId));assert.match(p.followResident(route.doctorId)!,/精确位置/);
});

test('frozen clinic snapshots and paused animation do not mutate source or rebuild room and medical data',()=>{
 const s=stage();s.world.clock.paused=true;const before=structuredClone(s);freeze(s);
 const view=new IsometricHomeInterior();view.accept(s,route.buildingId);const l=roomLayout(s.world,building(s)),scene=view.render(fitRoomCamera(l,null,960,640),960,640),stats=view.stats;
 assert.deepEqual(view.animate(scene,1000).objects,scene.objects);assert.equal(view.stats.poseBuilds,stats.poseBuilds);assert.equal(view.stats.floorBuilds,stats.floorBuilds);assert.equal(view.stats.bucketBuilds,stats.bucketBuilds);assert.deepEqual(s,before);
 const mutable=stage();view.accept(mutable,route.buildingId);const next=view.render(scene.displayCamera,960,640);
 for(const field of ['buildings','rooms','residents','health','industry'] as const)Object.defineProperty(mutable.world,field,{get(){throw new Error('animation rescanned '+field);}});
 assert.doesNotThrow(()=>view.animate(next,700));
});

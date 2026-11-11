/** Independent synthetic CPU review. DOM/canvas adapters are not browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricSchoolRoute} from '../scripts/isometric-school-route.js';
import {homeInteriorSupport} from '../src/client/isometric-interior.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {personVisual} from '../src/client/person-pose.js';
import {residentMarks} from '../src/client/isometric-study.js';
import {actionRoom,roomLayout} from '../src/shared/rooms.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import type {Snapshot} from '../src/shared/types.js';
const route=isometricSchoolRoute();
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
const inside=()=>{const s=route.snapshots.find(s=>person(s).inside===route.buildingId);assert.ok(s,'real engine store entry');return structuredClone(s);};
function model(s=inside()){const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('independent school: exact shared layout, no capacity-derived beds or navigation furniture',()=>{
 const s=inside(),b=building(s);assert.equal(b.kind,'school');b.capacity=1000000;
 const support=homeInteriorSupport(s.world,b.id);assert.equal(support.supported,true);assert.deepEqual(support.layout,roomLayout(s.world,b));
 const p=model(s),slots=p.scene!.objects.filter(o=>o.subject.kind==='roomSlot');
 assert.deepEqual(slots.map(o=>o.subject.id).sort(),['kitchen','table']);
 for(const o of slots)assert.deepEqual(o.subject.at,support.layout!.slots.find(slot=>slot.key===o.subject.id)!.at);
 assert.equal(p.scene!.objects.some(o=>o.subject.id==='care'||o.subject.id.startsWith('bed:')),false);
});

test('independent school: malformed geometry, missing room records and duplicate/unknown station keys fail closed',()=>{
 for(const field of ['width','height','capacity'] as const)for(const n of [NaN,Infinity,-1,1.5]){const s=inside();building(s)[field]=n;assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false,field+':'+n);}
 for(const n of [0,10000]){const s=inside();building(s).width=n;assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
 const legacy=inside();delete legacy.world.rooms;assert.equal(homeInteriorSupport(legacy.world,route.buildingId).supported,false);
 for(const kind of ['unknown','bench']){const s=inside();s.world.industry!.stations.push({id:'review',buildingId:route.buildingId,kind,installedAt:0} as any);if(kind==='bench')s.world.industry!.stations.push({...s.world.industry!.stations.at(-1)!});assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
});

test('independent school: neutral original people and recorded slots never imply classroom props or learning',()=>{
 const s=inside(),p=model(s),r=person(s),a=p.scene!.objects.find(o=>o.subject.id===r.id)!;
 assert.deepEqual(a.marks,residentMarks(s.world,{...r,at:{...r.roomAt!},appearance:{...r.appearance}},0,personVisual(s.world,r)));
 assert.match(a.subject.description!,/未绘制授课、读写或学习手势/);assert.match(a.subject.description!,/在场不表示正在授课、取得进度或完成学习/);
 assert.ok(p.scene!.objects.every(o=>['resident','roomSlot'].includes(o.subject.kind)));
 const changed=structuredClone(s);changed.world.education!.lessons=[];assert.deepEqual(model(changed).scene!.objects.find(o=>o.subject.id===r.id)!.marks,a.marks);
 s.world.industry!.stations.push({id:'review-school-bench',buildingId:route.buildingId,kind:'bench',installedAt:0});
 const station=model(s).scene!.objects.find(o=>o.subject.id==='station:bench')!;assert.match(station.subject.placeholder!,/未绘制设施外观/);
});

test('independent school: actual ValleyScene follow preserves room and identity through every engine transition and 2D handback',()=>{
 const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);
 let entered=false,exited=false,previous=person(route.snapshots[0]).inside;
 for(const s of route.snapshots.slice(1)){const transition=previous!==person(s).inside;if(transition)h.canvas.emit('pointerdown',{pointerId:17});h.accept(s);assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),person(s).inside);assert.equal(h.canvas.hidden,false);if(person(s).inside===route.buildingId)entered=true;else if(entered)exited=true;if(transition){assert.equal(h.canvas.captures.has(17),false);h.canvas.emit('pointerup',{pointerId:17});}previous=person(s).inside;}
 assert.ok(entered&&exited);h.toggle('2d');assert.equal(scene.followState?.personId,route.personId);assert.equal(h.intervals.size,0);assert.deepEqual(h.warnings,[]);h.dispose();
});

test('independent school: exact-position picks, source immutability and atomic failed replacement',()=>{
 const s=inside(),before=structuredClone(s);freeze(s);const p=model(s),actor=p.scene!.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===route.personId)!;
 assert.deepEqual(actor.subject.at,person(s).roomAt);let hits=0;
 for(const mark of actor.marks){const hit=p.pick({x:(mark.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(mark.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident'&&hit.id===route.personId){assert.equal(hit.roomId,route.buildingId);assert.deepEqual(previewSelection(hit),{kind:'person',id:route.personId});hits++;}}
 assert.ok(hits);p.tick(0);p.tick(500);assert.deepEqual(s,before);
 const old=p.scene!,snapshot=p.snapshot,stats=p.interior.stats,bad=inside();bad.world.residents.push(structuredClone(person(bad)));assert.throws(()=>p.accept(bad));assert.equal(p.scene,old);assert.equal(p.snapshot,snapshot);assert.deepEqual(p.interior.stats,stats);
 const next=inside();next.world.revision++;p.accept(next);assert.equal(p.interior.animate(old as any,900),old);
});

test('independent school: missing exact position, infant pose and unsupported room return to 2D without losing follow',()=>{
 for(const mode of ['position','infant','room']){const s=inside();if(mode==='position')person(s).roomAt=null;if(mode==='infant')person(s).lifeStage='infant';if(mode==='room')building(s).kind='greenhouse';
  const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);h.accept(s);assert.equal(h.canvas.hidden,true,mode);assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),route.buildingId);assert.equal(h.intervals.size,0);h.dispose();
 }
});

test('independent school: pause, visibility and disconnect freeze, with stable animation caches and bounded crowds',()=>{
 const h=observerPreviewHarness();h.accept(inside());h.toggle();h.startFollow(route.personId);const p=h.model,marks=()=>p.scene!.objects.find(o=>o.subject.id===route.personId)!.marks;p.tick(0);p.tick(350);const initial=structuredClone(marks());
 h.connection(false);p.tick(1000);assert.deepEqual(marks(),initial);h.connection(true);h.document.hidden=true;h.document.emit('visibilitychange');p.tick(2000);assert.deepEqual(marks(),initial);
 h.document.hidden=false;h.document.emit('visibilitychange');const paused=inside();paused.world.clock.paused=true;paused.world.revision++;h.accept(paused);const stopped=structuredClone(marks());p.tick(3000);p.tick(4000);assert.deepEqual(marks(),stopped);h.dispose();
 const s=inside(),r=person(s);s.world.residents=Array.from({length:700},(_,i)=>({...structuredClone(r),id:'school-review:'+i}));const q=model(s),stats=q.interior.stats,keys=q.scene!.objects.map(o=>o.key);assert.ok(q.scene!.omittedObjects>0);
 for(const t of [0,350,700,1050]){q.tick(t);assert.ok(q.scene!.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(q.scene!.terrain.length+q.scene!.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);assert.ok(q.interior.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(q.interior.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);}
 assert.equal(q.interior.stats.poseBuilds,stats.poseBuilds);assert.equal(q.interior.stats.bucketBuilds,stats.bucketBuilds);assert.equal(q.interior.stats.floorBuilds,stats.floorBuilds);
 const shuffled=structuredClone(s);shuffled.world.revision++;shuffled.world.residents.reverse();q.accept(shuffled);assert.deepEqual(q.scene!.objects.map(o=>o.key),keys);
});

const stage=(name:string)=>{const i=route.labels.indexOf(name);assert.ok(i>=0,name);return structuredClone(route.snapshots[i]);};
const lesson=(s:Snapshot)=>s.world.education!.lessons.find(l=>l.id===route.lessonId)!;
const enrollment=(s:Snapshot)=>lesson(s).enrollments.find(e=>e.id===route.enrollmentId)!;
const learner=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.learnerId)!;

test('independent school: exact single-building fixture leaves all original resident and world setup intact',()=>{
 const seed=stage('original-seed'),setup=stage('fixture');assert.equal(seed.world.buildings.some(b=>b.kind==='school'),false);
 assert.equal(setup.world.buildings.length,seed.world.buildings.length+1);assert.deepEqual(setup.world.buildings.slice(0,-1),seed.world.buildings);
 assert.deepEqual(setup.world.residents,seed.world.residents);assert.equal(building(setup).definition,'building/school@1');assert.equal(building(setup).ownerId,route.teacherId);
 const parcel=(setup.world.definitions['land/start@1'].data.parcels as any[]).find(p=>p.ownerId===route.teacherId);assert.deepEqual(building(setup).at,{x:parcel.x,y:parcel.y});
 const normalized=structuredClone(setup.world);normalized.buildings.pop();normalized.clock.paused=seed.world.clock.paused;assert.deepEqual(normalized,seed.world);
 assert.equal(route.plans.length,10);assert.ok(route.plans.every(p=>[route.teacherId,route.learnerId].includes(p.actorId)));
 const compact=inside();building(compact).width=1;building(compact).height=1;building(compact).capacity=1000000;
 assert.equal(homeInteriorSupport(compact.world,route.buildingId).layout!.height,13);assert.equal(roomLayout(compact.world,building(compact)).height,13);
});

test('independent school: solo attendance never spends materials, gains skill or pays tuition; shared pulses settle progressively',()=>{
 const enrolled=stage('enroll:completed'),solo=stage('teacher-solo'),first=stage('first-shared-work'),half=stage('half-learning'),before=stage('before-completion'),done=stage('learning:completed');
 assert.equal(enrollment(solo).worked,0);assert.equal(enrollment(solo).paid,0);assert.equal(enrollment(solo).gained,0);assert.equal(lesson(solo).materialsUsed,false);
 assert.equal(learner(solo).inside,null);assert.equal(learner(solo).skills.building,learner(enrolled).skills.building);
 assert.equal(enrollment(enrolled).reserved,12);assert.equal(enrollment(enrolled).payer,route.learnerId);
 assert.equal(lesson(first).materialsUsed,true);assert.ok(enrollment(first).worked>0);
 for(const key of ['wood','stone'] as const)assert.equal(person(first).inventory[key],person(solo).inventory[key]!-1);
 for(const s of [first,half,before,done]){
  const e=enrollment(s),l=lesson(s);assert.equal(e.paid,Math.floor(e.reserved*e.worked/l.minutes+1e-8));
  assert.ok(Math.abs(learner(s).skills.building-learner(solo).skills.building-e.gained)<1e-8);
 }
 assert.equal(enrollment(half).worked,30);assert.equal(enrollment(half).paid,6);
 assert.equal(enrollment(before).status,'enrolled');assert.equal(enrollment(before).worked,59.75);
 assert.equal(enrollment(done).status,'completed');assert.equal(enrollment(done).worked,60);assert.equal(enrollment(done).paid,12);assert.equal(enrollment(done).gained,.25);assert.equal(enrollment(done).settled,true);
 assert.equal(person(done).coins,person(solo).coins+12);assert.equal(learner(done).coins,learner(solo).coins);
 assert.deepEqual(person(done).inventory,person(first).inventory);
});

test('independent school: real role positions and both original identities survive follow, pointer transitions and 2D default',()=>{
 const shared=stage('first-shared-work');
 for(const label of ['teacher-solo','first-shared-work','half-learning','before-completion','learning:completed']){
  const s=stage(label),p=model(s);
  for(const r of s.world.residents.filter(r=>r.inside===route.buildingId)){
   const a=p.scene!.objects.find(o=>o.subject.id===r.id)!;
   assert.deepEqual(a.marks,residentMarks(s.world,{...r,at:{...r.roomAt!},appearance:{...r.appearance}},0,personVisual(s.world,r)),label+':'+r.id);
  }
 }

 for(const id of [route.teacherId,route.learnerId]){
  const r=shared.world.residents.find(r=>r.id===id)!;assert.deepEqual(r.roomAt,actionRoom(shared.world,r,r.activity!)!.target);
  const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);h.toggle();h.startFollow(id);
  let previous=route.snapshots[0].world.residents.find(r=>r.id===id)!.inside,entered=false,exited=false;
  for(const s of route.snapshots.slice(1)){
   const r=s.world.residents.find(r=>r.id===id)!,transition=previous!==r.inside;if(transition)h.canvas.emit('pointerdown',{pointerId:17});h.accept(s);
   assert.equal(scene.followState?.personId,id);assert.equal(h.room(),r.inside);assert.equal(h.canvas.hidden,false);
   if(r.inside===route.buildingId){entered=true;const a=h.model.scene!.objects.find(o=>o.subject.id===id)!;assert.deepEqual(a.subject.at,r.roomAt);assert.match(a.subject.description!,/在场不表示正在授课、取得进度或完成学习/);}else if(entered)exited=true;
   if(transition){assert.equal(h.canvas.captures.has(17),false);h.canvas.emit('pointerup',{pointerId:17});}previous=r.inside;
  }
  assert.ok(entered&&exited);h.toggle('2d');assert.equal(scene.followState?.personId,id);assert.equal(h.intervals.size,0);assert.deepEqual(h.warnings,[]);h.dispose();
 }
});

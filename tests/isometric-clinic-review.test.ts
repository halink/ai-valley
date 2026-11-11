/** Independent synthetic CPU review; DOM/canvas adapters are not browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeRooms} from '../src/world/rooms.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeHealth} from '../src/world/health.js';
import {createFormalWorld} from '../src/world/formal-seed.js';
import {homeInteriorSupport} from '../src/client/isometric-interior.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {roomLayout} from '../src/shared/rooms.js';
import {personVisual} from '../src/client/person-pose.js';
import {residentMarks} from '../src/client/isometric-study.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import type {Snapshot} from '../src/shared/types.js';
const roomId='review-clinic',personId='founder-1-1';
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===personId)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===roomId)!;
// Deliberately fabricated renderer fixtures. Only the separate route below proves engine travel.
function fixture():Snapshot{
 const world=createFormalWorld(5402),r=world.residents.find(r=>r.id===personId)!,home=world.buildings.find(b=>b.id===r.homeId)!;
 initializeRooms(world);initializeIndustry(world);initializeHealth(world);
 world.buildings.push({...structuredClone(home),id:roomId,kind:'clinic',capacity:4,residents:[],name:'Synthetic review clinic'});
 r.inside=roomId;r.roomAt={x:4,y:5};r.at={...home.door};r.activity=null;r.plan=null;world.clock.paused=false;
 return {world,mapRevision:world.id,serverTime:'synthetic-review',version:'synthetic-review',capabilities:{active:[],pending:[]}};
}
function model(s=fixture()){const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(roomId),null);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
const actor=(p:IsometricPreview)=>p.scene!.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===personId)!;

test('independent clinic: authoritative capacity beds and coordinates; navigation slots are not furniture',()=>{
 const s=fixture(),layout=roomLayout(s.world,building(s)),support=homeInteriorSupport(s.world,roomId);assert.equal(support.supported,true);assert.deepEqual(support.layout,layout);
 const slots=model(s).scene!.objects.filter(o=>o.subject.kind==='roomSlot');
 assert.deepEqual(slots.map(o=>o.subject.id).sort(),['bed:0','bed:1','bed:2','bed:3','kitchen','table']);
 for(const o of slots)assert.deepEqual(o.subject.at,layout.slots.find(slot=>slot.key===o.subject.id)!.at);
 assert.ok(layout.slots.some(s=>s.key==='care'));assert.equal(layout.slots.filter(s=>s.kind==='bodyBay').length,2);
 const zero=fixture();building(zero).capacity=0;assert.equal(model(zero).scene!.objects.filter(o=>o.subject.id.startsWith('bed:')).length,0);
});

test('independent clinic: malformed and oversized geometry, missing layouts, ambiguous stations fail closed',()=>{
 for(const field of ['width','height','capacity'] as const)for(const n of [NaN,Infinity,-1,1.5,1000000]){const s=fixture();building(s)[field]=n;assert.equal(homeInteriorSupport(s.world,roomId).supported,false,field+':'+n);}
 const legacy=fixture();delete legacy.world.rooms;assert.equal(homeInteriorSupport(legacy.world,roomId).supported,false);
 for(const kind of ['unknown','bench']){const s=fixture();s.world.industry!.stations.push({id:'review',buildingId:roomId,kind,installedAt:0} as any);if(kind==='bench')s.world.industry!.stations.push({...s.world.industry!.stations.at(-1)!});assert.equal(homeInteriorSupport(s.world,roomId).supported,false);}
});

test('independent clinic: existing person appearance and neutral marks, not medicine or care gestures',()=>{
 const s=fixture(),r=person(s),p=model(s),a=actor(p),visual=personVisual(s.world,r);
 assert.deepEqual(a.marks,residentMarks(s.world,{...r,at:{...r.roomAt!},appearance:{...r.appearance}},0,visual));
 assert.match(a.subject.description!,/未绘制治疗、给药或护理手势/);assert.match(a.subject.description!,/不表示正在诊疗或已经治愈/);
 const changed=fixture();person(changed).inventory.medicine=999;person(changed).inventory.water=999;changed.world.health!.appointments=[];
 assert.deepEqual(actor(model(changed)).marks,a.marks);assert.equal(actor(model(changed)).subject.description,a.subject.description);
 const station=fixture();station.world.industry!.stations.push({id:'clinic-bench',buildingId:roomId,kind:'bench',installedAt:0});
 const q=model(station);assert.ok(q.scene!.objects.find(o=>o.subject.id==='station:bench')!.subject.placeholder);assert.equal(q.scene!.objects.filter(o=>o.subject.id==='table').length,1);
});

test('independent clinic: exact original identity picking, deep freezing and atomic replacement',()=>{
 const s=fixture(),before=structuredClone(s);freeze(s);const p=model(s),a=actor(p);assert.deepEqual(a.subject.at,person(s).roomAt);let hits=0;
 for(const m of a.marks){const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident'&&hit.id===personId){assert.equal(hit.roomId,roomId);assert.deepEqual(previewSelection(hit),{kind:'person',id:personId});hits++;}}
 assert.ok(hits);p.tick(0);p.tick(500);assert.deepEqual(s,before);
 const old=p.scene!,snapshot=p.snapshot,stats=p.interior.stats,bad=fixture();bad.world.residents.push(structuredClone(person(bad)));assert.throws(()=>p.accept(bad));assert.equal(p.scene,old);assert.equal(p.snapshot,snapshot);assert.deepEqual(p.interior.stats,stats);
 const next=fixture();next.world.revision++;p.accept(next);assert.equal(p.interior.animate(old as any,900),old);
});

test('independent clinic: unknown location, infant and unsupported building hand back to 2D retaining identity',()=>{
 for(const mode of ['position','infant','room']){const s=fixture();if(mode==='position')person(s).roomAt=null;if(mode==='infant')person(s).lifeStage='infant';if(mode==='room')building(s).kind='barn';
  const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(fixture());h.toggle();h.startFollow(personId);h.accept(s);assert.equal(h.canvas.hidden,true,mode);assert.equal(scene.followState?.personId,personId);assert.equal(h.room(),roomId);assert.equal(h.intervals.size,0);h.dispose();
 }
});

test('independent clinic: pause, hidden, disconnect freeze and bounded stable crowd caches',()=>{
 const h=observerPreviewHarness();h.accept(fixture());h.toggle();h.startFollow(personId);const p=h.model,marks=()=>actor(p).marks;p.tick(0);p.tick(350);const initial=structuredClone(marks());
 h.connection(false);p.tick(1000);assert.deepEqual(marks(),initial);h.connection(true);h.document.hidden=true;h.document.emit('visibilitychange');p.tick(2000);assert.deepEqual(marks(),initial);
 h.document.hidden=false;h.document.emit('visibilitychange');const paused=fixture();paused.world.clock.paused=true;paused.world.revision++;h.accept(paused);const stopped=structuredClone(marks());p.tick(3000);p.tick(4000);assert.deepEqual(marks(),stopped);h.dispose();
 const s=fixture(),r=person(s);s.world.residents=Array.from({length:700},(_,i)=>({...structuredClone(r),id:'clinic-review:'+i}));const q=model(s),stats=q.interior.stats,keys=q.scene!.objects.map(o=>o.key);assert.ok(q.scene!.omittedObjects>0);
 for(const t of [0,350,700,1050]){q.tick(t);assert.ok(q.scene!.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(q.scene!.terrain.length+q.scene!.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);assert.ok(q.interior.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(q.interior.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);}
 assert.equal(q.interior.stats.poseBuilds,stats.poseBuilds);assert.equal(q.interior.stats.bucketBuilds,stats.bucketBuilds);assert.equal(q.interior.stats.floorBuilds,stats.floorBuilds);
 const shuffled=structuredClone(s);shuffled.world.revision++;shuffled.world.residents.reverse();q.accept(shuffled);assert.deepEqual(q.scene!.objects.map(o=>o.key),keys);
});

import {isometricClinicRoute} from '../scripts/isometric-clinic-route.js';
const route=isometricClinicRoute();
const stage=(label:string)=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const appointment=(s:Snapshot)=>s.world.health!.appointments.find(a=>a.id===route.appointmentId)!;

test('independent clinic: fixture discloses synthetic medicine/injury, solo attendance never settles treatment',()=>{
 const seed=stage('original-seed'),setup=stage('fixture');assert.ok(seed.world.buildings.some(b=>b.id===route.buildingId&&b.kind==='clinic'));assert.deepEqual(setup.world.buildings,seed.world.buildings);
 for(const r of seed.world.residents){const after=setup.world.residents.find(p=>p.id===r.id)!;const expected=structuredClone(r.inventory);if(r.id===route.doctorId)expected.medicine=(expected.medicine??0)+1;assert.deepEqual(after.inventory,expected);for(const key of ['at','inside','roomAt','skills','coins','knownBuildings'] as const)assert.deepEqual(after[key],r[key],key);}
 assert.equal(setup.world.health!.cases.find(c=>c.id===route.caseId)!.severity,50);assert.equal(setup.world.health!.appointments.length,0);
 const solo=stage('doctor-solo'),a=appointment(solo);assert.equal(a.status,'accepted');assert.equal(a.worked,0);assert.equal(a.paid,0);assert.equal(a.materialsUsed,false);assert.equal(a.stock.medicine,1);
 assert.equal(solo.world.residents.find(r=>r.id===route.patientId)!.inside,null);
 const first=appointment(stage('first-shared-work')),before=appointment(stage('before-completion')),done=appointment(stage('treatment:completed'));
 assert.ok(first.worked>0);assert.equal(first.materialsUsed,true);assert.deepEqual(first.stock,{});assert.ok(before.worked<before.minutes);assert.equal(before.status,'accepted');assert.equal(done.status,'completed');assert.equal(done.worked,done.minutes);assert.equal(done.paid,done.fee);
 assert.ok(stage('treatment:completed').world.health!.cases.find(c=>c.id===route.caseId)!.severity>0,'completed treatment is not cured');
});

test('independent clinic: genuine route exact role positions, follow transitions, pointer release and 2D handback',()=>{
 const shared=stage('first-shared-work'),b=shared.world.buildings.find(b=>b.id===route.buildingId)!,layout=roomLayout(shared.world,b);
 for(const [id,key]of [[route.doctorId,'care'],[route.patientId,'bed:0']])assert.deepEqual(shared.world.residents.find(r=>r.id===id)!.roomAt,layout.slots.find(s=>s.key===key)!.at);
 for(const id of [route.doctorId,route.patientId]){
  const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);h.toggle();h.startFollow(id);let previous=route.snapshots[0].world.residents.find(r=>r.id===id)!.inside,entered=false,exited=false;
  for(const s of route.snapshots.slice(1)){const r=s.world.residents.find(r=>r.id===id)!,transition=previous!==r.inside;if(transition)h.canvas.emit('pointerdown',{pointerId:17});h.accept(s);assert.equal(scene.followState?.personId,id);assert.equal(h.room(),r.inside);assert.equal(h.canvas.hidden,false);if(r.inside===route.buildingId){entered=true;const a=h.model.scene!.objects.find(o=>o.subject.id===id)!;assert.deepEqual(a.subject.at,r.roomAt);assert.match(a.subject.description!,/不表示正在诊疗或已经治愈/);}else if(entered)exited=true;if(transition){assert.equal(h.canvas.captures.has(17),false);h.canvas.emit('pointerup',{pointerId:17});}previous=r.inside;}
  assert.ok(entered&&exited);h.toggle('2d');assert.equal(scene.followState?.personId,id);assert.equal(h.intervals.size,0);assert.deepEqual(h.warnings,[]);h.dispose();
 }
});

test('independent clinic: body bay is not a body; actual dead resident stays a source-identity marker',()=>{
 const s=fixture(),r=person(s),layout=roomLayout(s.world,building(s));r.status='dead';r.roomAt={...layout.slots.find(s=>s.key==='bodyBay:0')!.at};
 const p=model(s),a=actor(p);assert.ok(a.subject.placeholder);assert.match(a.subject.placeholder!,/未绘制遗体姿态/);assert.deepEqual(a.subject.at,r.roomAt);assert.equal(p.scene!.objects.some(o=>o.subject.id.startsWith('bodyBay:')),false);
 r.roomAt=null;const unknown=model(s);assert.equal(unknown.scene!.objects.some(o=>o.subject.id===r.id),false);assert.ok(unknown.interior.stats.unknownLocationCount>0);
});

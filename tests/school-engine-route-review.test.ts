/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {schoolEngineRoute} from './helpers/school-engine-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {Snapshot} from '../src/shared/types.js';
const route=schoolEngineRoute();
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
const inside=()=>{const s=route.snapshots.find(s=>person(s).inside===route.buildingId);assert.ok(s,'real engine store entry');return structuredClone(s);};
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
 assert.equal(roomLayout(compact.world,building(compact)).height,13);
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

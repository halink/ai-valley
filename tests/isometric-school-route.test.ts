/** Exact synthetic-fixture accounting plus real engine navigation and learning boundaries. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isometricSchoolRoute} from '../scripts/isometric-school-route.js';
import {roomLayout,actionRoom} from '../src/shared/rooms.js';
import {accountBalance} from '../src/world/economy.js';
import type {World,Vec} from '../src/shared/types.js';

const route=isometricSchoolRoute();
const stage=(label:string)=>{const index=route.labels.indexOf(label);assert.ok(index>=0,label);return route.snapshots[index].world;};
const resident=(w:World,id=route.teacherId)=>w.residents.find(r=>r.id===id)!;
const lesson=(w:World)=>w.education!.lessons.find(a=>a.id===route.lessonId)!;
const enrollment=(w:World)=>lesson(w).enrollments.find(e=>e.id===route.enrollmentId)!;
const school=(w:World)=>w.buildings.find(b=>b.id===route.buildingId)!;

test('school route states the absent original school and exactly confines direct fixture changes',()=>{
 const original=stage('original-seed'),fixture=stage('fixture'),b=school(fixture);
 assert.equal(original.buildings.filter(b=>b.kind==='school').length,0);assert.equal(original.rooms,undefined);assert.equal(original.education,undefined);
 const expected=structuredClone(original);expected.buildings.push(structuredClone(route.fixtureDifferences.addedBuilding));expected.clock.paused=false;assert.deepEqual(fixture,expected);
 const d=fixture.definitions[b.definition].data;assert.equal(b.definition,'building/school@1');assert.equal(b.width,d.width);assert.equal(b.height,d.height);assert.equal(b.capacity,d.capacity);
 const parcel=(fixture.definitions['land/start@1'].data.parcels as Array<Vec&{ownerId:string}>).find(p=>p.ownerId===route.teacherId)!;
 assert.deepEqual(b.at,{x:parcel.x,y:parcel.y});assert.equal(b.ownerId,route.teacherId);assert.deepEqual(b.residents,[]);assert.equal(b.condition,100);
 assert.equal(resident(fixture).knownBuildings.includes(b.id),false);assert.equal(resident(stage('teacher-approach:completed')).knownBuildings.includes(b.id),true);
 assert.equal(route.plans.length,10);assert.match(route.provenance,/has no school/);assert.match(route.provenance,/synthetic/);
});

test('post only creates a real lesson; independent enrollment alone moves original tuition into escrow',()=>{
 const fixture=stage('fixture'),posted=stage('post:completed'),enrolled=stage('enroll:completed');
 assert.equal(lesson(posted).status,'scheduled');assert.deepEqual(lesson(posted).enrollments,[]);assert.equal(lesson(posted).taught,0);assert.equal(lesson(posted).materialsUsed,false);
 assert.deepEqual(lesson(posted).materials,{wood:1,stone:1});assert.equal(lesson(posted).teacherSkill,1);assert.equal(lesson(posted).minutes,60);
 const e=enrollment(enrolled);assert.equal(e.status,'enrolled');assert.equal(e.worked,0);assert.equal(e.gained,0);assert.equal(e.paid,0);assert.equal(e.reserved,12);assert.equal(e.payer,route.learnerId);
 assert.equal(resident(enrolled,route.learnerId).coins,resident(fixture,route.learnerId).coins-12);assert.equal(accountBalance(enrolled,e.account),12);
 for(const w of [posted,enrolled]){assert.equal(resident(w).inventory.wood,resident(fixture).inventory.wood);assert.equal(resident(w).inventory.stone,resident(fixture).inventory.stone);assert.equal(resident(w,route.learnerId).skills.building,0);}
});

test('real outdoor/indoor paths reach authoritative distinct roles and solo presence does not consume or teach',()=>{
 const fixture=stage('fixture'),solo=stage('teacher-solo'),both=stage('both-on-site');
 for(const [w,id]of [[solo,route.teacherId],[both,route.teacherId],[both,route.learnerId]] as const){
  const r=resident(w,id);assert.equal(r.inside,route.buildingId);assert.deepEqual(r.at,school(w).door);assert.deepEqual(r.roomAt,actionRoom(w,r,r.activity!)!.target);assert.equal(r.activity!.path.length,0);assert.equal(r.activity!.room?.path.length??0,0);
 }
 assert.equal(resident(solo,route.learnerId).inside,null);assert.ok(solo.minute>lesson(solo).start);
 for(const [label,id]of [['teacher-teach:teacher:entered',route.teacherId],['learner-study:learner:entered',route.learnerId]] as const){const w=stage(label),r=resident(w,id);assert.equal(r.inside,route.buildingId);assert.ok(r.activity!.room!.path.length>0);assert.deepEqual(r.roomAt,roomLayout(w,school(w)).entry);assert.equal(enrollment(w).worked,0);}
 for(const w of [solo,both]){assert.equal(lesson(w).taught,0);assert.equal(lesson(w).materialsUsed,false);assert.equal(enrollment(w).worked,0);assert.equal(enrollment(w).paid,0);assert.equal(enrollment(w).gained,0);assert.equal(resident(w,route.learnerId).skills.building,0);for(const k of ['wood','stone'] as const)assert.equal(resident(w).inventory[k],resident(fixture).inventory[k]);}
});

test('only shared engine time consumes once, pays proportional tuition and completes after the last quarter-minute',()=>{
 const fixture=stage('fixture');
 for(const [label,worked,paid]of [['first-shared-work',.25,0],['half-learning',30,6],['before-completion',59.75,11],['learning:completed',60,12]] as const){
  const w=stage(label),l=lesson(w),e=enrollment(w);assert.equal(e.worked,worked);assert.equal(e.paid,paid);assert.equal(l.taught,worked);assert.equal(l.materialsUsed,true);
  assert.ok(Math.abs(e.gained-.25*worked/60)<1e-8);assert.ok(Math.abs(resident(w,route.learnerId).skills.building-e.gained)<1e-8);
  for(const k of ['wood','stone'] as const)assert.equal(resident(w).inventory[k],resident(fixture).inventory[k]!-1);
  assert.equal(resident(w).coins,resident(fixture).coins+paid);assert.equal(accountBalance(w,e.account),12-paid);assert.equal(e.status,label==='learning:completed'?'completed':'enrolled');
 }
 const done=stage('learning:completed');assert.equal(resident(done,route.learnerId).activity,null);assert.equal(lesson(done).status,'scheduled','learner completion does not complete the entire lesson window');
 const funds=(w:World)=>w.residents.reduce((n,r)=>n+r.coins,0)+Object.values(w.economy?.escrows??{}).reduce((a,b)=>a+b,0);for(const s of route.snapshots)assert.equal(funds(s.world),funds(fixture));
});

test('teacher finishing and both genuine exit journeys add no more skill, tuition or consumed materials',()=>{
 const done=stage('learning:completed');
 for(const label of ['teacher-action:completed','teacher-exit:teacher:exited','teacher-exit:completed','learner-exit:learner:exited','learner-exit:completed']){const w=stage(label);assert.equal(enrollment(w).worked,60);assert.equal(enrollment(w).paid,12);assert.equal(enrollment(w).gained,.25);assert.equal(resident(w,route.learnerId).skills.building,.25);for(const k of ['wood','stone'] as const)assert.equal(resident(w).inventory[k],resident(done).inventory[k]);assert.equal(w.education!.lessons.length,1);}
 for(const [role,id]of [['teacher',route.teacherId],['learner',route.learnerId]] as const){const exited=stage(`${role}-exit:${role}:exited`),finished=stage(`${role}-exit:completed`);assert.equal(resident(exited,id).inside,null);assert.equal(resident(exited,id).roomAt,null);assert.equal(resident(finished,id).inside,null);assert.equal(resident(finished,id).roomAt,null);assert.deepEqual(resident(finished,id).at,finished.buildings.find(b=>b.id===resident(finished,id).homeId)!.door);}
});

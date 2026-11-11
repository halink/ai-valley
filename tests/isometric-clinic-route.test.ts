import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isometricClinicRoute} from '../scripts/isometric-clinic-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import {addHealthCase} from '../src/world/health.js';
import {accountBalance,totalCoins} from '../src/world/economy.js';
import type {World} from '../src/shared/types.js';

const route=isometricClinicRoute();
const stage=(label:string)=>{const index=route.labels.indexOf(label);assert.ok(index>=0,label);return route.snapshots[index].world;};
const resident=(w:World,id=route.doctorId)=>w.residents.find(r=>r.id===id)!;
const appointment=(w:World)=>w.health!.appointments.find(a=>a.id===route.appointmentId)!;
const injury=(w:World)=>w.health!.cases.find(c=>c.id===route.caseId)!;
const clinic=(w:World)=>w.buildings.find(b=>b.id===route.buildingId)!;

test('synthetic clinic route declares and exactly confines every fixture difference',()=>{
 const original=stage('original-seed'),fixture=stage('fixture'),building=clinic(fixture);
 assert.equal(original.buildings.filter(b=>b.kind==='clinic').length,3);
 assert.deepEqual(fixture.buildings,original.buildings);
 assert.equal(original.residents.some(r=>(r.inventory.medicine??0)>0),false);
 assert.equal(original.health?.cases.length??0,0);assert.equal(original.health?.appointments.length??0,0);
 assert.equal(building.kind,'clinic');assert.equal(building.definition,'building/clinic@1');
 const data=fixture.definitions[building.definition].data;
 assert.equal(building.width,data.width);assert.equal(building.height,data.height);assert.equal(building.capacity,data.capacity);
 assert.deepEqual(building.residents,[]);assert.equal(building.ownerId,'commons');
 const expected=structuredClone(original);resident(expected).inventory.medicine=1;
 addHealthCase(expected,resident(expected,route.patientId),'injury',50,route.fixtureDifferences.injury.source);expected.clock.paused=false;
 assert.deepEqual(fixture,expected);
 assert.equal(fixture.health!.appointments.length,0);assert.equal(injury(fixture).treatment,0);
 assert.equal(resident(fixture).knownBuildings.includes(building.id),false);
 assert.equal(resident(stage('approach:completed')).knownBuildings.includes(building.id),true);
 assert.deepEqual(fixture.residents.map(r=>r.id),original.residents.map(r=>r.id));
 assert.equal(route.plans.length,8);assert.match(route.provenance,/synthetic/);assert.match(route.provenance,/existing commons-clinic/);
});

test('offer reserves original water and test medicine; separate patient acceptance alone escrows the fee',()=>{
 const fixture=stage('fixture'),offered=stage('offer:completed'),accepted=stage('accept:completed');
 assert.equal(appointment(offered).status,'offered');assert.equal(appointment(offered).acceptedAt,null);
 assert.equal(accountBalance(offered,appointment(offered).account),0);
 assert.equal(resident(offered,route.patientId).coins,resident(fixture,route.patientId).coins);
 assert.equal(resident(offered).inventory.medicine,0);assert.equal(resident(offered).inventory.water,resident(fixture).inventory.water!-1);
 assert.deepEqual(appointment(offered).stock,{medicine:1,water:1});assert.equal(appointment(offered).materialsUsed,false);
 assert.equal(appointment(accepted).status,'accepted');assert.equal(appointment(accepted).acceptedAt,accepted.minute);
 assert.equal(resident(accepted,route.patientId).coins,resident(fixture,route.patientId).coins-10);
 assert.equal(accountBalance(accepted,appointment(accepted).account),10);
 assert.equal(appointment(accepted).worked,0);assert.equal(injury(accepted).treatment,0);
});

test('actual outdoor and indoor travel reaches exact care and bed:0; solo waiting earns and treats nothing',()=>{
 const solo=stage('doctor-solo'),both=stage('both-on-site');
 assert.ok(solo.minute>appointment(solo).start+2);assert.equal(resident(solo,route.patientId).inside,null);
 for(const [w,id,key]of [[solo,route.doctorId,'care'],[both,route.doctorId,'care'],[both,route.patientId,'bed:0']] as const){
  const r=resident(w,id);assert.equal(r.inside,route.buildingId);assert.deepEqual(r.at,clinic(w).door);
  assert.deepEqual(r.roomAt,roomLayout(w,clinic(w)).slots.find(s=>s.key===key)!.at);
  assert.equal(r.activity!.path.length,0);assert.equal(r.activity!.room?.path.length??0,0);
 }
 for(const [label,id]of [['doctor-treat:doctor:entered',route.doctorId],['patient-receive:patient:entered',route.patientId]] as const){
  const w=stage(label),r=resident(w,id);assert.equal(r.inside,route.buildingId);assert.ok(r.activity!.room!.path.length>0);
  assert.equal(appointment(w).worked,0);assert.equal(injury(w).treatment,0);
 }
 for(const w of [solo,both]){
  assert.equal(appointment(w).worked,0);assert.equal(appointment(w).paid,0);assert.equal(appointment(w).materialsUsed,false);
  assert.deepEqual(appointment(w).stock,{medicine:1,water:1});assert.equal(injury(w).treatment,0);
 }
 assert.equal(resident(solo).activity!.action.type,'health');
 assert.equal(resident(both,route.patientId).activity!.action.type,'health');
});

test('only shared work consumes materials and earns proportional money through the last quarter-minute',()=>{
 const fixture=stage('fixture');
 for(const [label,worked,paid]of [['first-shared-work',.25,0],['half-treatment',15,5],['before-completion',29.75,9],['treatment:completed',30,10]] as const){
  const w=stage(label),a=appointment(w);assert.equal(a.worked,worked);assert.equal(a.paid,paid);assert.equal(a.materialsUsed,true);assert.deepEqual(a.stock,{});
  assert.ok(Math.abs(injury(w).treatment-35*worked/30)<1e-8);
  assert.equal(resident(w).coins,resident(fixture).coins+paid);assert.equal(accountBalance(w,a.account),10-paid);
  assert.equal(a.status,label==='treatment:completed'?'completed':'accepted');
 }
 const done=stage('treatment:completed');assert.equal(injury(done).stage,'recovering');assert.ok(injury(done).severity>0);
 assert.equal(resident(done).activity,null);assert.equal(resident(done,route.patientId).activity,null);
 // The first engine step initializes external merchants; do not mislabel that
 // baseline initialization as a medical payment. Resident+escrow funds never change.
 const medicalMoney=(w:World)=>w.residents.reduce((n,r)=>n+r.coins,0)+Object.values(w.economy?.escrows??{}).reduce((a,b)=>a+b,0);
 for(const s of route.snapshots)assert.equal(medicalMoney(s.world),medicalMoney(fixture));
 for(const s of route.snapshots.slice(2))assert.equal(totalCoins(s.world),totalCoins(stage('approach:completed')));
});

test('both actual exit journeys retain identity and cannot add another treatment or payment',()=>{
 for(const [role,id]of [['doctor',route.doctorId],['patient',route.patientId]] as const){
  const exited=stage(`${role}-exit:${role}:exited`),done=stage(`${role}-exit:completed`);
  assert.equal(resident(exited,id).inside,null);assert.equal(resident(exited,id).roomAt,null);
  assert.equal(resident(done,id).inside,null);assert.equal(resident(done,id).roomAt,null);
  assert.deepEqual(resident(done,id).at,done.buildings.find(b=>b.id===resident(done,id).homeId)!.door);
  assert.equal(appointment(done).worked,30);assert.equal(appointment(done).paid,10);
  assert.equal(done.health!.appointments.length,1);assert.equal(done.health!.cases.length,1);
 }
});

/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clinicEngineRoute} from './helpers/clinic-engine-route.js';
import type {Snapshot} from '../src/shared/types.js';
const route=clinicEngineRoute();
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

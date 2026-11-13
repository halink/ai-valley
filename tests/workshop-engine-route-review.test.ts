/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workshopEngineRoute} from './helpers/workshop-engine-route.js';
import type {Snapshot} from '../src/shared/types.js';
const route=workshopEngineRoute();
const stage=(label='craft:working')=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const batch=(s:Snapshot)=>{const a=person(s).activity!.action;assert.equal(a.type,'industry');return s.world.industry!.batches.find(b=>b.id===(a as any).batchId)!;};

test('independent workshop: unmodified seed route yields real table/bench work and separate completed output',()=>{
 assert.equal(route.plans.length,6);
 for(const label of ['table-craft:working','craft:working']){
  const s=stage(label);assert.ok(batch(s).worked>0);assert.equal(batch(s).status,'working');
 }
 const seed=stage('seed'),table=stage('table-craft:completed'),done=stage('craft:completed');
 assert.equal(person(table).inventory.fiber,(person(seed).inventory.fiber??0)+batch(stage('table-craft:working')).recipe.output.fiber!);
 assert.equal(person(done).inventory.plank,(person(stage('craft:on-site')).inventory.plank??0)+batch(stage()).recipe.output.plank!);
 assert.equal(person(stage('exit:completed')).inside,null);
});

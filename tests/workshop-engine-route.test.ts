/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workshopEngineRoute} from './helpers/workshop-engine-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {World} from '../src/shared/types.js';
const route=workshopEngineRoute();
const stage=(label='craft:working')=>structuredClone(route.snapshots[route.labels.indexOf(label)]);
const actor=(w:World)=>w.residents.find(r=>r.id===route.personId)!;
const room=(w:World)=>roomLayout(w,w.buildings.find(b=>b.id===route.buildingId)!);

test('original seed5402 actor discovers the existing workshop, crafts, installs a bench, leaves and crafts on return',()=>{
 assert.match(route.provenance,/only directly unpaused/);assert.match(route.provenance,/not autonomous/);assert.equal(route.plans.length,6);
 const seed=stage('seed').world,table=stage('table-craft:working').world,installed=stage('install:completed').world,arrived=stage('craft:on-site').world,working=stage().world,done=stage('craft:completed').world,exit=stage('exit:completed').world;
 assert.equal(actor(seed).inside,null);assert.equal(actor(seed).knownBuildings.includes(route.buildingId),false);assert.equal(actor(table).knownBuildings.includes(route.buildingId),true);
 assert.equal(seed.industry,undefined);assert.equal(table.industry!.stations.length,0);assert.deepEqual(room(table).slots.find(s=>s.key==='table')!.at,actor(table).roomAt);assert.equal(actor(table).inventory.wood,11);assert.equal(actor(table).inventory.fiber,undefined);
 assert.equal(installed.industry!.stations.filter(s=>s.buildingId===route.buildingId&&s.kind==='bench').length,1);assert.equal(actor(installed).inventory.wood,3);assert.equal(actor(installed).inventory.stone,4);assert.equal(actor(installed).inventory.fiber,3);
 assert.deepEqual(actor(arrived).roomAt,room(arrived).slots.find(s=>s.key==='station:bench')!.at);assert.equal(actor(arrived).activity!.remaining,40);assert.equal(actor(arrived).inventory.wood,3);
 assert.equal(actor(working).inventory.wood,0);assert.equal(actor(working).inventory.plank,undefined);assert.equal(actor(working).activity!.remaining,9.75);
 const batch=working.industry!.batches.find(b=>b.status==='working')!;assert.equal(batch.worked,30.25);assert.deepEqual(batch.input,{wood:3});assert.equal(batch.ownerId,route.personId);
 assert.equal(done.minute-arrived.minute,40);assert.equal(actor(done).inventory.plank,2);assert.equal(done.industry!.batches.at(-1)!.status,'completed');assert.equal(actor(done).activity,null);
 assert.equal(actor(exit).inside,null);assert.equal(actor(exit).roomAt,null);assert.deepEqual(actor(exit).inventory,actor(done).inventory);assert.deepEqual(seed.residents.map(r=>r.id),exit.residents.map(r=>r.id));
});

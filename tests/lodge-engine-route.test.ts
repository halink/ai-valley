/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lodgeEngineRoute} from './helpers/lodge-engine-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {World} from '../src/shared/types.js';
const route=lodgeEngineRoute();
const stage=(name:string)=>structuredClone(route.snapshots[route.labels.indexOf(name)]);
const person=(w:World)=>w.residents.find(r=>r.id===route.personId)!;
const layout=(w:World)=>roomLayout(w,w.buildings.find(b=>b.id===route.buildingId)!);

test('seed5401 explicit legal cook walks into the lodge, spends real kitchen time, converts original food, then exits',()=>{
 assert.deepEqual(route.labels,['seed','cook:entered','cook:on-site','cook:working','cook:completed','exit:exited','exit:completed']);
 assert.match(route.provenance,/not autonomous/);assert.equal(route.plans.length,2);assert.deepEqual(route.plans[0].action,{type:'cook',quantity:1,buildingId:route.buildingId});
 const initial=stage('seed').world,entered=stage('cook:entered').world,arrived=stage('cook:on-site').world,working=stage('cook:working').world,done=stage('cook:completed').world,exited=stage('exit:completed').world;
 assert.equal(person(initial).inside,null);assert.equal(person(entered).inside,route.buildingId);assert.notDeepEqual(person(entered).roomAt,person(arrived).roomAt);
 assert.deepEqual(person(arrived).roomAt,layout(arrived).slots.find(s=>s.key==='kitchen')!.at);assert.equal(person(arrived).activity!.remaining,20);
 assert.equal(person(working).activity!.remaining,9.75);assert.equal(done.minute-arrived.minute,20);assert.ok(route.plans[0].end-route.plans[0].start>20);
 for(const w of [entered,arrived,working])assert.deepEqual(person(w).inventory,person(initial).inventory,'no early input consumption or invented output');
 assert.deepEqual(person(done).inventory,{...person(initial).inventory,turnip:3,water:3,meal:2});
 assert.equal(person(done).inside,route.buildingId);assert.equal(person(done).activity,null);assert.equal(person(exited).inside,null);assert.equal(person(exited).roomAt,null);
 assert.deepEqual(person(exited).inventory,person(done).inventory);assert.deepEqual(initial.residents.map(r=>r.id),exited.residents.map(r=>r.id));
});

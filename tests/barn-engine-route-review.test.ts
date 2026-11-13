/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {barnEngineRoute} from './helpers/barn-engine-route.js';
import {actionRoom} from '../src/shared/rooms.js';
import type {Snapshot} from '../src/shared/types.js';
const route=barnEngineRoute();
const stage=(label:string)=>{const index=route.labels.indexOf(label);assert.ok(index>=0,label);return structuredClone(route.snapshots[index]);};
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const barn=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
const animal=(s:Snapshot)=>s.world.industry!.animals.find(a=>a.id===route.animalId)!;

test('review: fixture full-world diff is exactly one barn, crate, fodder and unpause',()=>{
 const seed=stage('original-seed'),fixture=stage('fixture'),expected=structuredClone(seed.world);expected.buildings.push(structuredClone(barn(fixture)));const r=expected.residents.find(r=>r.id===route.personId)!;r.inventory.chickCrate=1;r.inventory.fodder=1;expected.clock.paused=false;assert.deepEqual(fixture.world,expected);
 const b=barn(fixture),d=fixture.world.definitions[b.definition].data;assert.equal(b.definition,'building/barn@1');assert.deepEqual([b.width,b.height,b.capacity],[d.width,d.height,d.capacity]);assert.equal(route.plans.length,5);assert.ok(route.plans.every(p=>p.actorId===route.personId));
});

test('review: real engine preserves crate identity, pen navigation, last-step consumption and animal uncertainty',()=>{
 const approach=stage('approach:completed'),placed=stage('place:completed'),crate=approach.world.industry!.livestockCargo!.find(c=>c.id===route.animalId)!;assert.equal(crate.status,'crated');assert.equal(placed.world.industry!.livestockCargo!.find(c=>c.id===crate.id)!.status,'released');assert.equal(person(placed).inventory.chickCrate,0);
 for(const key of ['id','kind','sex','bornAt'] as const)assert.equal(animal(placed)[key],crate[key]);
 for(const [label,item,need]of [['feed','fodder','hunger'],['water','water','thirst']] as const){const before=stage(label+':before-completion'),done=stage(label+':completed'),r=person(before);assert.equal(r.activity!.remaining,.25);assert.deepEqual(r.roomAt,actionRoom(before.world,r,r.activity!)!.target);assert.deepEqual(r.roomAt,route.penAt);assert.equal(done.world.minute-before.world.minute,.25);assert.equal(person(done).inventory[item],r.inventory[item]!-1);assert.ok(animal(done)[need]<animal(before)[need]);assert.equal(animal(done).lastCaredAt,done.world.minute);assert.equal(person(done).activity,null);}
 for(const label of ['place:completed','feed:completed','water:completed','exit:completed']){const s=stage(label),a=animal(s);assert.equal(a.barnId,route.buildingId);assert.equal(a.at,undefined);assert.equal(a.inside,undefined);assert.equal(a.roomAt,undefined);assert.equal(a.product,0);assert.equal(a.pregnancy,null);assert.equal(s.world.industry!.animals.length,1);}
 const exited=stage('exit:completed');assert.equal(person(exited).inside,null);assert.equal(person(exited).roomAt,null);assert.equal(person(exited).coins,person(stage('fixture')).coins);
});

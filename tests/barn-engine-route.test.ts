import {test} from 'node:test';
import assert from 'node:assert/strict';
import {barnEngineRoute} from './helpers/barn-engine-route.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {World} from '../src/shared/types.js';
const route=barnEngineRoute();
const stage=(label:string)=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return route.snapshots[i].world;};
const resident=(w:World)=>w.residents.find(r=>r.id===route.personId)!;
const animal=(w:World)=>w.industry!.animals.find(a=>a.id===route.animalId)!;
const barn=(w:World)=>w.buildings.find(b=>b.id===route.buildingId)!;

test('barn fixture declares exactly one building, chick crate, fodder and unpause; preserves original people',()=>{
 const original=stage('original-seed'),fixture=stage('fixture');
 assert.equal(original.buildings.filter(b=>b.kind==='barn').length,0);assert.equal(original.industry,undefined);
 const expected=structuredClone(original);expected.buildings.push(route.fixtureDifferences.addedBuilding);
 resident(expected).inventory.chickCrate=1;resident(expected).inventory.fodder=1;expected.clock.paused=false;
 assert.deepEqual(fixture,expected);
 const b=barn(fixture),data=fixture.definitions[b.definition].data;
 assert.equal(b.definition,'building/barn@1');assert.equal(b.width,data.width);assert.equal(b.height,data.height);assert.equal(b.capacity,data.capacity);
 assert.equal(resident(fixture).knownBuildings.includes(b.id),false);
 assert.equal(resident(stage('approach:completed')).knownBuildings.includes(b.id),true);
 assert.equal(route.plans.length,5);assert.match(route.provenance,/layout-derived/);
});

test('real placement consumes the initialized crate and retains its exact identity and age',()=>{
 const before=stage('approach:completed'),placed=stage('place:completed');
 const crate=before.industry!.livestockCargo!.find(c=>c.id===route.animalId)!;
 assert.equal(crate.status,'crated');assert.equal(crate.container,'person:'+route.personId);
 assert.equal(before.industry!.animals.length,0);assert.equal(placed.industry!.animals.length,1);
 assert.equal(placed.industry!.livestockCargo!.find(c=>c.id===route.animalId)!.status,'released');
 assert.equal(resident(before).inventory.chickCrate,1);assert.equal(resident(placed).inventory.chickCrate,0);
 const n=animal(placed);assert.equal(n.id,crate.id);assert.equal(n.bornAt,crate.bornAt);assert.equal(n.sex,crate.sex);assert.equal(n.kind,crate.kind);assert.equal(n.ownerId,route.personId);
 assert.equal(n.barnId,route.buildingId);assert.equal(n.pen,0);assert.equal(n.status,'alive');
 assert.equal(n.product,0);assert.equal(n.pregnancy,null);
});

test('actual resident entry reaches the real pen; normal housed animal has no invented indoor coordinate',()=>{
 const entering=stage('place:entered');assert.equal(resident(entering).inside,route.buildingId);assert.ok(resident(entering).activity!.room!.path.length>0);
 for(const label of ['place:completed','feed:before-completion','feed:completed','water:before-completion','water:completed']){
  const w=stage(label),r=resident(w),n=animal(w);
  assert.equal(r.inside,route.buildingId);assert.deepEqual(r.at,barn(w).door);
  assert.deepEqual(r.roomAt,roomLayout(w,barn(w)).slots.find(s=>s.key===(label==='place:completed'?'table':route.penKey))!.at);
  assert.equal(n.at,undefined);assert.equal(n.inside,undefined);assert.equal(n.roomAt,undefined);
  assert.equal(n.barnId,route.buildingId);assert.equal(n.pen,0);assert.equal(n.product,0);
 }
});

test('feed and water consume only at the last quarter-minute and relieve the same animal',()=>{
 for(const [label,item,need]of [['feed','fodder','hunger'],['water','water','thirst']] as const){
  const before=stage(label+':before-completion'),done=stage(label+':completed');
  assert.equal(resident(before).activity!.remaining,.25);assert.equal(done.minute-before.minute,.25);
  assert.equal(resident(done).inventory[item],resident(before).inventory[item]!-1);
  assert.ok(animal(done)[need]<animal(before)[need]);assert.equal(animal(done).lastCaredAt,done.minute);
  assert.equal(resident(done).activity,null);
 }
 assert.equal(resident(stage('feed:before-completion')).inventory.fodder,1);
 assert.equal(resident(stage('water:completed')).inventory.water,resident(stage('fixture')).inventory.water!-1);
});

test('real resident exit preserves the housed animal without teleporting it outdoors or inventing products',()=>{
 const exited=stage('exit:exited'),done=stage('exit:completed'),r=resident(done);
 assert.equal(resident(exited).inside,null);assert.equal(resident(exited).roomAt,null);
 assert.equal(r.inside,null);assert.equal(r.roomAt,null);assert.deepEqual(r.at,done.buildings.find(b=>b.id===r.homeId)!.door);
 assert.equal(done.industry!.animals.length,1);assert.equal(animal(done).barnId,route.buildingId);assert.equal(animal(done).at,undefined);assert.equal(animal(done).roomAt,undefined);
 assert.equal(animal(done).product,0);assert.equal(animal(done).pregnancy,null);assert.equal(r.coins,resident(stage('fixture')).coins);
});


test('walking and completed neutral indoor snapshots retain actual resident coordinates',()=>{
 const walking=resident(stage('feed:indoor-walking'));assert.equal(walking.inside,route.buildingId);assert.ok(walking.activity!.room!.path.length>0);assert.ok(walking.roomAt);
 for(const label of ['place:completed','feed:completed','water:completed']){const r=resident(stage(label));assert.equal(r.inside,route.buildingId);assert.ok(r.roomAt);assert.equal(r.activity,null);}
});

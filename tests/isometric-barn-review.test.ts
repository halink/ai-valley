/** Independent offline synthetic review; canvas adapters are not browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricBarnRoute} from '../scripts/isometric-barn-route.js';
import {homeInteriorSupport} from '../src/client/isometric-interior.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {personVisual} from '../src/client/person-pose.js';
import {actionRoom,roomLayout} from '../src/shared/rooms.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import type {Snapshot} from '../src/shared/types.js';
const route=isometricBarnRoute();
const stage=(label:string)=>{const index=route.labels.indexOf(label);assert.ok(index>=0,label);return structuredClone(route.snapshots[index]);};
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const barn=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
const animal=(s:Snapshot)=>s.world.industry!.animals.find(a=>a.id===route.animalId)!;
function model(s=stage('place:completed')){const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('review: pen height preflight matches shared geometry and rejects excess before scanning stations',()=>{
 for(const [width,height]of [[1,1],[7,5],[16,8],[20,10]]){const s=stage('place:completed');Object.assign(barn(s),{width,height,capacity:1000000});const support=homeInteriorSupport(s.world,route.buildingId);assert.equal(support.supported,true);assert.deepEqual(support.layout,roomLayout(s.world,barn(s)));}
 for(const [width,height]of [[12,20],[32,30],[1e9,1]]){const s=stage('place:completed');Object.assign(barn(s),{width,height});Object.defineProperty(s.world,'industry',{get(){throw Error('preflight scanned stations');}});assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
 const slots=stage('place:completed');slots.world.industry!.stations=Array.from({length:122},(_,i)=>({id:'review:'+i,buildingId:route.buildingId,kind:'bench',installedAt:0}));assert.match(homeInteriorSupport(slots.world,route.buildingId).reason!,/工位超过/);
});

test('review: missing rooms, malformed dimensions, unknown or duplicate station keys fail closed',()=>{
 const legacy=stage('place:completed');delete legacy.world.rooms;assert.equal(homeInteriorSupport(legacy.world,route.buildingId).supported,false);
 for(const field of ['width','height','capacity'] as const)for(const value of [-1,NaN,Infinity,1.5]){const s=stage('place:completed');barn(s)[field]=value;assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
 for(const kind of ['unknown','bench']){const s=stage('place:completed');s.world.industry!.stations=[{id:'review',buildingId:route.buildingId,kind,installedAt:0}] as any;if(kind==='bench')s.world.industry!.stations.push({...s.world.industry!.stations[0]});assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
});

test('review: actual housed animal never becomes a pen sprite or occupancy claim',()=>{
 const s=stage('place:completed'),p=model(s),layout=roomLayout(s.world,barn(s));
 assert.equal(p.scene!.unknownLocationCount,1);assert.ok(!p.scene!.objects.some(o=>o.subject.kind==='animal'));
 const pens=p.scene!.objects.filter(o=>o.subject.id.startsWith('pen:'));assert.equal(pens.length,4);
 for(const o of pens){assert.deepEqual(o.subject.at,layout.slots.find(x=>x.key===o.subject.id)!.at);assert.match(o.subject.placeholder!,/不是动物位置或数量/);assert.match(o.subject.placeholder!,/不表示.*占用/);assert.equal(previewSelection(o.subject),null);}
 const absent=structuredClone(s);absent.world.industry!.animals=[];assert.deepEqual(model(absent).scene!.objects,p.scene!.objects);
 for(const pen of [0,3,999]){const next=structuredClone(s);animal(next).pen=pen;assert.deepEqual(model(next).scene!.objects,p.scene!.objects);assert.equal(model(next).scene!.unknownLocationCount,1);}
});

test('review: explicit and carried animals are exact-record markers; missing positions remain unknown',()=>{
 const s=stage('place:completed'),a=animal(s),r=person(s);Object.assign(a,{inside:route.buildingId,roomAt:{x:3,y:9}});
 let p=model(s),o=p.scene!.objects.find(o=>o.subject.kind==='animal')!;assert.deepEqual(o.subject.at,a.roomAt);assert.ok(o.subject.placeholder);assert.equal(p.locateEcology('animal/'+a.id),false);
 a.carrierId=r.id;a.roomAt={x:1,y:1};p=model(s);o=p.scene!.objects.find(o=>o.subject.kind==='animal')!;assert.deepEqual(o.subject.at,r.roomAt);assert.match(o.subject.placeholder!,/携带/);
 a.carrierId='missing';p=model(s);assert.ok(!p.scene!.objects.some(o=>o.subject.kind==='animal'));assert.equal(p.scene!.unknownLocationCount,1);
 a.carrierId=null;a.roomAt={x:Infinity,y:1};p=model(s);assert.equal(p.scene!.unknownLocationCount,1);
});

test('review: exact original resident picks, frozen inputs, atomic rejection and stale animation',()=>{
 const s=stage('feed:indoor-walking'),before=structuredClone(s);freeze(s);const p=model(s),o=p.scene!.objects.find(o=>o.subject.id===route.personId)!;assert.deepEqual(o.subject.at,person(s).roomAt);
 assert.ok(o.marks.some(m=>{const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind!=='resident'||hit.id!==route.personId)return false;assert.equal(hit.roomId,route.buildingId);assert.deepEqual(previewSelection(hit),{kind:'person',id:route.personId});return true;}));
 p.tick(0);p.tick(350);assert.deepEqual(s,before);const old=p.scene!,stats=p.interior.stats,bad=stage('feed:indoor-walking');bad.world.residents.push(structuredClone(person(bad)));assert.throws(()=>p.accept(bad));assert.equal(p.scene,old);assert.equal(p.snapshot,s);assert.deepEqual(p.interior.stats,stats);
 const next=stage('feed:completed');p.accept(next);assert.equal(p.interior.animate(old as any,999),old);
});

test('review: actual scene follows entry, walking, unsupported husbandry and exit without losing identity',()=>{
 const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);h.toggle();h.startFollow(route.personId);
 let entered=false,exited=false,previous=person(route.snapshots[0]).inside,handbacks=0;
 for(let i=1;i<route.snapshots.length;i++){const s=route.snapshots[i],r=person(s),transition=previous!==r.inside;if(transition)h.canvas.emit('pointerdown',{pointerId:31});h.accept(s);assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),r.inside);
  if(r.inside===route.buildingId){entered=true;if(route.labels[i].endsWith('before-completion')){assert.equal(personVisual(s.world,r).pose,'work');assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);handbacks++;}else{if(h.canvas.hidden)h.toggle();assert.equal(h.canvas.hidden,false);assert.deepEqual(h.model.scene!.objects.find(o=>o.subject.id===r.id)!.subject.at,r.roomAt);}}
  else if(entered){exited=true;if(h.canvas.hidden)h.toggle();assert.equal(h.canvas.hidden,false);}
  if(transition){assert.equal(h.canvas.captures.has(31),false);h.canvas.emit('pointerup',{pointerId:31});}previous=r.inside;
 }
 assert.ok(entered&&exited);assert.equal(handbacks,2);assert.deepEqual(h.warnings,[]);h.dispose();
});

test('review: crowd budgets and animation caches remain bounded and deterministic',()=>{
 const s=stage('feed:indoor-walking'),r=person(s);s.world.residents=Array.from({length:700},(_,i)=>({...structuredClone(r),id:'barn-review:'+i}));const p=model(s),stats=p.interior.stats,keys=p.scene!.objects.map(o=>o.key);assert.ok(p.scene!.omittedObjects>0);
 for(const t of [0,350,700,1050]){p.tick(t);assert.ok(p.scene!.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(p.scene!.terrain.length+p.scene!.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);assert.ok(p.interior.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(p.interior.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);}
 for(const key of ['poseBuilds','floorBuilds','bucketBuilds'] as const)assert.equal(p.interior.stats[key],stats[key]);const reversed=structuredClone(s);reversed.world.revision++;reversed.world.residents.reverse();p.accept(reversed);assert.deepEqual(p.scene!.objects.map(o=>o.key),keys);
});

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

test('review: pen annotation below a real person preserves body pixels and original pick identity',()=>{
 const s=stage('water:completed'),p=model(s),objects=p.scene!.objects,actor=objects.find(o=>o.subject.id===route.personId)!,pen=objects.find(o=>o.subject.id===route.penKey)!;
 assert.deepEqual(actor.subject.at,pen.subject.at);assert.ok(objects.indexOf(pen)<objects.indexOf(actor));
 const overlaps=actor.marks.filter(m=>pen.marks.some(n=>m.x<n.x+n.width&&m.x+m.width>n.x&&m.y<n.y+n.height&&m.y+m.height>n.y));assert.ok(overlaps.length>0);
 let hits=0;for(const m of overlaps)for(let x=m.x;x<m.x+m.width;x++)for(let y=m.y;y<m.y+m.height;y++){
  if(!pen.marks.some(n=>x>=n.x&&x<n.x+n.width&&y>=n.y&&y<n.y+n.height))continue;
  const hit=p.pick({x:(x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(y+.5)*p.camera!.zoom+p.camera!.origin.y});assert.equal(hit?.kind,'resident');assert.equal('id'in hit!?hit.id:null,route.personId);hits++;
 }assert.ok(hits>0);
});

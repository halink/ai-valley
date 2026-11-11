/** Independent synthetic CPU review. DOM/canvas adapters are not browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStoreRoute} from '../scripts/isometric-store-route.js';
import {homeInteriorSupport} from '../src/client/isometric-interior.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {roomLayout} from '../src/shared/rooms.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import type {Snapshot} from '../src/shared/types.js';
const route=isometricStoreRoute();
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
const inside=()=>{const s=route.snapshots.find(s=>person(s).inside===route.buildingId);assert.ok(s,'real engine store entry');return structuredClone(s);};
function model(s=inside()){const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('independent store: exact shared layout, no capacity-derived beds or navigation furniture',()=>{
 const s=inside(),b=building(s);assert.equal(b.kind,'store');b.capacity=1000000;
 const support=homeInteriorSupport(s.world,b.id);assert.equal(support.supported,true);assert.deepEqual(support.layout,roomLayout(s.world,b));
 const p=model(s),slots=p.scene!.objects.filter(o=>o.subject.kind==='roomSlot');
 assert.deepEqual(slots.map(o=>o.subject.id).sort(),['kitchen','table']);
 for(const o of slots)assert.deepEqual(o.subject.at,support.layout!.slots.find(slot=>slot.key===o.subject.id)!.at);
 assert.equal(p.scene!.objects.some(o=>o.subject.id==='care'||o.subject.id.startsWith('bed:')),false);
});

test('independent store: malformed geometry, missing room records and duplicate/unknown station keys fail closed',()=>{
 for(const field of ['width','height','capacity'] as const)for(const n of [NaN,Infinity,-1,1.5]){const s=inside();building(s)[field]=n;assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false,field+':'+n);}
 for(const n of [0,10000]){const s=inside();building(s).width=n;assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
 const legacy=inside();delete legacy.world.rooms;assert.equal(homeInteriorSupport(legacy.world,route.buildingId).supported,false);
 for(const kind of ['unknown','bench']){const s=inside();s.world.industry!.stations.push({id:'review',buildingId:route.buildingId,kind,installedAt:0} as any);if(kind==='bench')s.world.industry!.stations.push({...s.world.industry!.stations.at(-1)!});assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
});

test('independent store: station and business evidence never invents goods, commerce props or production art',()=>{
 const s=inside();s.world.industry!.stations.push({id:'review-store-bench',buildingId:route.buildingId,kind:'bench',installedAt:0} as any);
 s.world.economy!.businesses.push({id:'review-business',ownerId:route.personId,buildingId:route.buildingId,name:'Synthetic stock',openedAt:0,closedAt:null,coins:999,inventory:{bread:999},sales:99,revenue:999});
 s.world.economy!.listings.push({id:'review-listing',businessId:'review-business',item:'bread',quantity:9,originalQuantity:9,side:'sale',price:3,postedAt:0,expiresAt:s.world.minute+100,status:'open'});
 const p=model(s),objects=p.scene!.objects,station=objects.find(o=>o.subject.id==='station:bench')!;
 assert.ok(station);assert.match(station.subject.placeholder!,/未绘制设施外观/);assert.deepEqual(station.subject.at,roomLayout(s.world,building(s)).slots.find(slot=>slot.key==='station:bench')!.at);
 assert.equal(objects.filter(o=>o.subject.id==='table').length,1);assert.ok(objects.every(o=>['resident','roomSlot'].includes(o.subject.kind)));
 assert.ok(objects.filter(o=>o.subject.kind==='resident').every(o=>o.subject.description===undefined));
});

test('independent store: actual ValleyScene follow preserves room and identity through every engine transition and 2D handback',()=>{
 const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);
 let entered=false,exited=false,previous=person(route.snapshots[0]).inside;
 for(const s of route.snapshots.slice(1)){const transition=previous!==person(s).inside;if(transition)h.canvas.emit('pointerdown',{pointerId:17});h.accept(s);assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),person(s).inside);assert.equal(h.canvas.hidden,false);if(person(s).inside===route.buildingId)entered=true;else if(entered)exited=true;if(transition){assert.equal(h.canvas.captures.has(17),false);h.canvas.emit('pointerup',{pointerId:17});}previous=person(s).inside;}
 assert.ok(entered&&exited);h.toggle('2d');assert.equal(scene.followState?.personId,route.personId);assert.equal(h.intervals.size,0);assert.deepEqual(h.warnings,[]);h.dispose();
});

test('independent store: exact-position picks, source immutability and atomic failed replacement',()=>{
 const s=inside(),before=structuredClone(s);freeze(s);const p=model(s),actor=p.scene!.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===route.personId)!;
 assert.deepEqual(actor.subject.at,person(s).roomAt);let hits=0;
 for(const mark of actor.marks){const hit=p.pick({x:(mark.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(mark.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident'&&hit.id===route.personId){assert.equal(hit.roomId,route.buildingId);assert.deepEqual(previewSelection(hit),{kind:'person',id:route.personId});hits++;}}
 assert.ok(hits);p.tick(0);p.tick(500);assert.deepEqual(s,before);
 const old=p.scene!,snapshot=p.snapshot,stats=p.interior.stats,bad=inside();bad.world.residents.push(structuredClone(person(bad)));assert.throws(()=>p.accept(bad));assert.equal(p.scene,old);assert.equal(p.snapshot,snapshot);assert.deepEqual(p.interior.stats,stats);
 const next=inside();next.world.revision++;p.accept(next);assert.equal(p.interior.animate(old as any,900),old);
});

test('independent store: missing exact position, infant pose and unsupported room return to 2D without losing follow',()=>{
 for(const mode of ['position','infant','room']){const s=inside();if(mode==='position')person(s).roomAt=null;if(mode==='infant')person(s).lifeStage='infant';if(mode==='room')building(s).kind='school';
  const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);h.accept(s);assert.equal(h.canvas.hidden,true,mode);assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),route.buildingId);assert.equal(h.intervals.size,0);h.dispose();
 }
});

test('independent store: pause, visibility and disconnect freeze, with stable animation caches and bounded crowds',()=>{
 const h=observerPreviewHarness();h.accept(inside());h.toggle();h.startFollow(route.personId);const p=h.model,marks=()=>p.scene!.objects.find(o=>o.subject.id===route.personId)!.marks;p.tick(0);p.tick(350);const initial=structuredClone(marks());
 h.connection(false);p.tick(1000);assert.deepEqual(marks(),initial);h.connection(true);h.document.hidden=true;h.document.emit('visibilitychange');p.tick(2000);assert.deepEqual(marks(),initial);
 h.document.hidden=false;h.document.emit('visibilitychange');const paused=inside();paused.world.clock.paused=true;paused.world.revision++;h.accept(paused);const stopped=structuredClone(marks());p.tick(3000);p.tick(4000);assert.deepEqual(marks(),stopped);h.dispose();
 const s=inside(),r=person(s);s.world.residents=Array.from({length:700},(_,i)=>({...structuredClone(r),id:'store-review:'+i}));const q=model(s),stats=q.interior.stats,keys=q.scene!.objects.map(o=>o.key);assert.ok(q.scene!.omittedObjects>0);
 for(const t of [0,350,700,1050]){q.tick(t);assert.ok(q.scene!.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(q.scene!.terrain.length+q.scene!.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);assert.ok(q.interior.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(q.interior.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);}
 assert.equal(q.interior.stats.poseBuilds,stats.poseBuilds);assert.equal(q.interior.stats.bucketBuilds,stats.bucketBuilds);assert.equal(q.interior.stats.floorBuilds,stats.floorBuilds);
 const shuffled=structuredClone(s);shuffled.world.revision++;shuffled.world.residents.reverse();q.accept(shuffled);assert.deepEqual(q.scene!.objects.map(o=>o.key),keys);
});

test('independent store: real engine sale stays outside and only completed settlement changes goods and ledger',()=>{
 const stage=(name:string)=>{const i=route.labels.indexOf(name);assert.ok(i>=0,name);return structuredClone(route.snapshots[i]);};
 const seed=stage('original-seed'),fixture=stage('fixture');assert.equal(seed.world.buildings.some(b=>b.kind==='store'),false);
 for(const r of seed.world.residents){const after=fixture.world.residents.find(p=>p.id===r.id)!;assert.deepEqual(after.inventory,r.inventory);assert.equal(after.coins,r.coins);assert.equal(after.roomAt,r.roomAt);}
 const before=stage('buy:before-completion'),done=stage('buy:completed');
 const buyer=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.buyerId)!;
 assert.equal(buyer(before).inside,null);assert.equal(buyer(done).inside,null);assert.deepEqual(buyer(before).at,building(before).door);
 assert.equal(buyer(done).inventory.berry,(buyer(before).inventory.berry??0)+1);
 assert.equal(buyer(done).coins,buyer(before).coins-3);
 assert.equal((done.world.economy!.trades??[]).length,(before.world.economy!.trades??[]).length+1);
 assert.equal(done.world.economy!.listings.find(l=>l.id===route.listingId)!.quantity,before.world.economy!.listings.find(l=>l.id===route.listingId)!.quantity-1);
 for(const s of [before,done]){const original=structuredClone(s);freeze(s);const p=model(s);assert.equal(p.scene!.objects.some(o=>o.subject.id===route.buyerId),false);p.tick(0);p.tick(800);assert.deepEqual(s,original);}
});

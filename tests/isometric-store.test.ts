/** Offline engine/CPU evidence. No browser, live model or real-save acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStoreRoute} from '../scripts/isometric-store-route.js';
import {homeInteriorSupport,IsometricHomeInterior,fitRoomCamera} from '../src/client/isometric-interior.js';
import {IsometricPreview,previewSelection,PREVIEW_LIMITATIONS} from '../src/client/isometric-preview.js';
import {roomLayout} from '../src/shared/rooms.js';
import {totalCoins} from '../src/world/economy.js';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import type {Snapshot,World} from '../src/shared/types.js';
const route=isometricStoreRoute();
const stage=(label='enter:on-site')=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const person=(w:World,id=route.personId)=>w.residents.find(r=>r.id===id)!;
const shop=(w:World)=>w.economy!.businesses.find(b=>b.id===route.businessId)!;
const listing=(w:World)=>w.economy!.listings.find(l=>l.id===route.listingId)!;
const layout=(w:World)=>roomLayout(w,w.buildings.find(b=>b.id===route.buildingId)!);
const preview=(s=stage())=>{const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;};
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('store fixture declares its one added building; all original people, money, goods and knowledge remain unchanged',()=>{
 const original=stage('original-seed').world,fixture=stage('fixture').world;
 assert.match(route.provenance,/explicitly added synthetic/);assert.match(route.provenance,/not autonomous/);assert.equal(original.buildings.some(b=>b.kind==='store'),false);
 assert.deepEqual(fixture.residents,original.residents);assert.equal(fixture.economy,undefined);assert.equal(fixture.rooms,undefined);assert.equal(fixture.industry,undefined);
 assert.deepEqual(fixture.buildings.slice(0,-1),original.buildings);
 const store=fixture.buildings.at(-1)!,definition=fixture.definitions[store.definition];
 assert.equal(store.kind,'store');assert.equal(store.width,definition.data.width);assert.equal(store.height,definition.data.height);assert.equal(store.capacity,0);assert.deepEqual(store.residents,[]);
 const expected=structuredClone(original);expected.buildings.push(store);expected.clock.paused=false;assert.deepEqual(fixture,expected);
 assert.equal(route.plans.length,10);assert.equal(person(fixture).knownBuildings.includes(store.id),false);assert.equal(person(stage('approach:completed').world).knownBuildings.includes(store.id),true);
});

test('real engine opens an empty shop, moves original stock and settles one outside purchase only after its final work',()=>{
 const seed=stage('fixture').world,open=stage('open:completed').world,stock=stage('stock:completed').world,listed=stage('list:completed').world,before=stage('buy:before-completion').world,done=stage('buy:completed').world;
 assert.deepEqual(shop(open).inventory,{});assert.equal(shop(open).coins,0);
 assert.equal(person(stock).inventory.berry,person(seed).inventory.berry!-2);assert.equal(shop(stock).inventory.berry,2);
 assert.equal(shop(listed).inventory.berry,0);assert.equal(listing(listed).quantity,2);
 assert.equal(listing(before).quantity,2);assert.equal(before.economy!.trades?.length??0,0);assert.equal(person(before,route.buyerId).coins,person(seed,route.buyerId).coins);
 assert.equal(person(before,route.buyerId).inside,null);assert.equal(person(done,route.buyerId).inside,null);assert.deepEqual(person(done,route.buyerId).at,done.buildings.find(b=>b.id===route.buildingId)!.door);
 assert.equal(person(done,route.buyerId).coins,person(seed,route.buyerId).coins-3);assert.equal(shop(done).coins,3);assert.equal(listing(done).quantity,1);assert.equal(person(done,route.buyerId).inventory.berry,person(seed,route.buyerId).inventory.berry!+1);
 assert.equal(done.economy!.trades!.length,1);assert.deepEqual({quantity:done.economy!.trades![0].quantity,gross:done.economy!.trades![0].gross,buildingId:done.economy!.trades![0].buildingId},{quantity:1,gross:3,buildingId:route.buildingId});
 for(const s of route.snapshots){assert.equal(s.world.residents.reduce((n,r)=>n+r.coins,0)+(s.world.economy?.businesses.reduce((n,b)=>n+b.coins,0)??0),seed.residents.reduce((n,r)=>n+r.coins,0));const berries=s.world.residents.reduce((n,r)=>n+(r.inventory.berry??0),0)+(s.world.economy?.businesses.reduce((n,b)=>n+(b.inventory.berry??0),0)??0)+(s.world.economy?.listings.filter(l=>l.item==='berry'&&l.side==='sale').reduce((n,l)=>n+l.quantity,0)??0);assert.equal(berries,seed.residents.reduce((n,r)=>n+r.inventory.berry!,0));}
 assert.equal(totalCoins(done),totalCoins(before));
 assert.equal(done.industry!.tools.length,0);assert.equal(done.industry!.batches.length,0);assert.equal(done.designs!.records.length,1);assert.equal(done.designs!.records[0].spec.kind,'tool');
});

test('store interior uses exact engine room coordinates, labels and original identities, with no invented counter or stock art',()=>{
 const s=stage(),w=s.world,support=homeInteriorSupport(w,route.buildingId);assert.equal(support.supported,true);assert.deepEqual(support.layout,layout(w));assert.equal(support.layout!.height,16);
 assert.deepEqual(person(w).roomAt,layout(w).slots.find(s=>s.key==='table')!.at);assert.equal(person(w).inside,route.buildingId);
 const p=preview(s);assert.match(p.summary,/商店室内/);assert.match(PREVIEW_LIMITATIONS,/不补造货架、库存或交易手势/);
 assert.deepEqual(p.scene!.objects.filter(o=>o.subject.kind==='roomSlot').map(o=>o.subject.id).sort(),['kitchen','table']);
 assert.deepEqual(p.scene!.objects.map(o=>o.subject.id).sort(),[route.personId,'kitchen','table'].sort());
 for(const id of [route.personId,'table','kitchen']){
  const o=p.scene!.objects.find(o=>o.subject.id===id)!;assert.equal(o.subject.placeholder,undefined);assert.equal(o.subject.description,undefined);
  assert.ok(o.marks.some(m=>{const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident')assert.deepEqual(previewSelection(hit),{kind:'person',id:route.personId});return hit&&'id'in hit&&hit.id===id;}),id);
 }
});

test('actual enter, table visit, wait and exit preserve continuous follow; buyer remains outside throughout commerce',()=>{
 const h=observerPreviewHarness();h.accept(stage('approach:completed'));h.toggle();h.startFollow(route.personId);
 for(const label of ['enter:entered','enter:on-site','enter:completed','wait:completed','exit:exited','exit:completed']){const s=stage(label);h.accept(s);assert.equal(h.canvas.hidden,false,label);assert.equal(h.model.roomId,person(s.world).inside);assert.equal(h.follow.state?.personId,route.personId);assert.equal(h.follow.state?.status,'following');}
 h.startFollow(route.buyerId);for(const label of ['buyer-approach:completed','buy:on-site','buy:before-completion','buy:completed','buyer-exit:completed']){h.accept(stage(label));assert.equal(h.model.roomId,null);assert.equal(h.canvas.hidden,false);assert.equal(h.follow.state?.personId,route.buyerId);}
 assert.equal(h.warnings.length,0);h.dispose();
});

test('a store layout does not imply an open business, stock, a customer, or completed trade',()=>{
 const baseline=preview().scene!;
 for(const label of ['open:completed','stock:completed','list:completed','buy:completed']){const p=preview(stage(label));assert.deepEqual(p.scene!.objects.filter(o=>o.subject.kind==='roomSlot'),baseline.objects.filter(o=>o.subject.kind==='roomSlot'));assert.equal(p.scene!.objects.some(o=>o.subject.id===route.businessId||o.subject.id===route.listingId),false);}
 const noBusiness=stage();delete noBusiness.world.economy;assert.deepEqual(preview(noBusiness).scene!.objects,baseline.objects);
 const closed=stage();shop(closed.world).closedAt=closed.world.minute;assert.deepEqual(preview(closed).scene!.objects,baseline.objects);
});

test('unsupported store work and missing position preserve explicit marker or 2D fallback without guessing an entrance',()=>{
 const work=stage(),r=person(work.world);r.activity!.action={type:'industry',operation:'craft',recipeId:'fiber',buildingId:route.buildingId,minutes:20};
 const object=preview(work).scene!.objects.find(o=>o.subject.id===r.id)!;assert.match(object.subject.placeholder!,/work/);assert.deepEqual(object.subject.at,r.roomAt);
 for(const s of [work,(()=>{const s=stage();person(s.world).roomAt=null;return s;})()]){const h=observerPreviewHarness();h.accept(s);h.startFollow(route.personId);h.toggle();assert.equal(h.canvas.hidden,true);assert.equal(h.follow.state?.personId,route.personId);h.dispose();}
 const missing=stage();person(missing.world).roomAt=null;const p=preview(missing);assert.ok(p.scene!.unknownLocationCount>0);assert.equal(p.scene!.objects.some(o=>o.subject.id===route.personId),false);
});

test('frozen store snapshots remain read-only; repeated and paused frames reuse pose, floor and bucket work',()=>{
 const s=stage('enter:entered'),before=structuredClone(s);freeze(s);const p=preview(s),stats=p.interior.stats,old=p.scene!;p.tick(0);p.tick(350);p.tick(700);
 for(const key of ['floorBuilds','poseBuilds','bucketBuilds'] as const)assert.equal(p.interior.stats[key],stats[key]);assert.equal(p.scene!.terrain,old.terrain);assert.deepEqual(s,before);
 const paused=stage('enter:entered');paused.world.clock.paused=true;const view=new IsometricHomeInterior();view.accept(paused,route.buildingId);const room=layout(paused.world),scene=view.render(fitRoomCamera(room,null,960,640),960,640),marks=scene.objects.find(o=>o.subject.id===route.personId)!.marks;
 for(const field of ['buildings','residents','rooms','industry','economy'] as const)Object.defineProperty(paused.world,field,{get(){throw new Error('animation scanned '+field);}});
 assert.deepEqual(view.animate(scene,840).objects.find(o=>o.subject.id===route.personId)!.marks,marks);
});

test('store width, height and station budgets fail closed before layout loops, while store capacity creates no beds',()=>{
 for(const change of [{width:33},{height:32},{width:0},{height:NaN},{capacity:-1}]){const w=stage().world;Object.assign(w.buildings.find(b=>b.id===route.buildingId)!,change);Object.defineProperty(w,'industry',{get(){throw new Error('unbounded geometry read stations');}});assert.equal(homeInteriorSupport(w,route.buildingId).supported,false);}
 const w=stage().world;w.buildings.find(b=>b.id===route.buildingId)!.capacity=1000000;assert.deepEqual(homeInteriorSupport(w,route.buildingId).layout,layout(w));assert.equal(layout(w).slots.some(s=>s.kind==='bed'),false);
 const absent=stage().world;delete absent.rooms;assert.equal(homeInteriorSupport(absent,route.buildingId).supported,false);
});

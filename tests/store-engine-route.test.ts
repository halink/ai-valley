/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {storeEngineRoute} from './helpers/store-engine-route.js';
import {totalCoins} from '../src/world/economy.js';
import type {World} from '../src/shared/types.js';
const route=storeEngineRoute();
const stage=(label='enter:on-site')=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const person=(w:World,id=route.personId)=>w.residents.find(r=>r.id===id)!;
const shop=(w:World)=>w.economy!.businesses.find(b=>b.id===route.businessId)!;
const listing=(w:World)=>w.economy!.listings.find(l=>l.id===route.listingId)!;

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

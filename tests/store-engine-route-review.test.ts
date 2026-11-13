/** Scripted offline engine regression; not browser or live-model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {storeEngineRoute} from './helpers/store-engine-route.js';
import type {Snapshot} from '../src/shared/types.js';
const route=storeEngineRoute();
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;

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
});

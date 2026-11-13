import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFishing,fishingKey,fishingStockAt,takeFish,waterAtShore} from '../src/world/fishing.js';
import {DAY,YEAR} from '../src/world/time.js';
import {stepWorld} from '../src/world/engine.js';

function fixture(){
 const w=createFrontierWorld(5401),shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!;
 w.industry!.fishing={[fishingKey(waterAtShore(w,shore)!)]:pool};
 return {w,shore,pool};
}

test('an extinct isolated stock is described as unable to breed rather than waiting to refill',()=>{
 const {w,pool}=fixture();
 for(const stock of Object.values(pool.species!)){stock!.amount=0;stock!.progress=0;}pool.amount=pool.progress=0;

 w.minute+=YEAR;advanceFishing(w);assert.equal(pool.amount,0);

});

test('legacy unclassified records and missing definitions remain unknown and unmodified',()=>{
 const {w,pool}=fixture();delete pool.species;pool.definition='ecology/fishing-process@999';
 const before=JSON.stringify(w);

 assert.equal(JSON.stringify(w),before);assert.equal(w.definitions[pool.definition],undefined);
});

test('observing a real last-species catch does not restore fish or influence later isolated breeding',()=>{
 const w=createFrontierWorld(5401),shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!;
 const before=pool.species!.carp!.amount;
 for(let n=0;n<before;n++)assert.equal(takeFish(w,shore,'carp','caught'),true);
 const unobserved=structuredClone(w),saved=JSON.stringify(w);
 assert.equal(JSON.stringify(w),saved);
 for(let day=0;day<7;day++){
  w.minute+=DAY;unobserved.minute+=DAY;advanceFishing(w);advanceFishing(unobserved);
  assert.deepEqual(w,unobserved);
 }
});

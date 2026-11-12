import assert from 'node:assert/strict';
import {test} from 'node:test';
import {industryPanel} from '../src/client/industry.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceFishing,fishingKey,fishingStockAt,takeFish,waterAtShore} from '../src/world/fishing.js';
import {DAY,YEAR} from '../src/world/time.js';
import {stepWorld} from '../src/world/engine.js';

function fixture(){
 const w=createFrontierWorld(5401),shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!;
 w.industry!.fishing={[fishingKey(waterAtShore(w,shore)!)]:pool};
 return {w,shore,pool};
}

test('two independent species half-progress values cannot be shown as one completed recovery',()=>{
 const {w,pool}=fixture();
 for(const stock of Object.values(pool.species!))stock!.progress=0;
 pool.species!.carp!.progress=.6;pool.species!.bream!.progress=.6;pool.progress=1.2;pool.amount--;pool.species!.carp!.amount--;pool.species!.carp!.caught++;
 const html=industryPanel(w);
 assert.doesNotMatch(html,/下一个自然恢复单位/);
 assert.match(html,/河鲤[^<]*繁殖累计进度 60%/);
 assert.match(html,/雨鲂[^<]*繁殖累计进度 60%/);
});

test('an extinct isolated stock is described as unable to breed rather than waiting to refill',()=>{
 const {w,pool}=fixture();
 for(const stock of Object.values(pool.species!)){stock!.amount=0;stock!.progress=0;}pool.amount=pool.progress=0;
 const before=industryPanel(w);assert.match(before,/本水域已耗尽，不能自行繁殖/);
 w.minute+=YEAR;advanceFishing(w);assert.equal(pool.amount,0);
 assert.match(industryPanel(w),/只能由符合条件的相连水域迁入/);
});

test('the fish observation uses each pool bound definition, not the active definition or twelve',()=>{
 const {w,pool}=fixture();
 w.definitions['ecology/fishing-process@2']={...structuredClone(w.definitions['ecology/fishing-process@1']),version:2,data:{capacity:20}};
 pool.definition='ecology/fishing-process@2';pool.amount=15;pool.species!.catfish!.amount+=3;pool.species!.catfish!.opening+=3;
 w.activeDefinitions['ecology/fishing-process']='ecology/fishing-process@1';
 assert.match(industryPanel(w),/实际种群 15\/20/);
});

test('a total-full pool does not hide a locally extinct species',()=>{
 const {w,pool}=fixture();
 for(const stock of Object.values(pool.species!))stock!.amount=0;
 pool.species!.catfish!.amount=12;pool.amount=12;
 assert.match(industryPanel(w),/河鲤 0 份 · 已耗尽，不能自行繁殖/);
});

test('legacy unclassified records and missing definitions remain unknown and unmodified',()=>{
 const {w,pool}=fixture();delete pool.species;pool.definition='ecology/fishing-process@999';
 const before=JSON.stringify(w),html=industryPanel(w);
 assert.match(html,/容量未知/);assert.match(html,/逐种数量和繁殖进度未知/);
 assert.equal(JSON.stringify(w),before);assert.equal(w.definitions[pool.definition],undefined);
});

test('observing a real last-species catch does not restore fish or influence later isolated breeding',()=>{
 const w=createFrontierWorld(5401),shore=w.industry!.frontierShore!,pool=fishingStockAt(w,shore)!;
 const before=pool.species!.carp!.amount;
 for(let n=0;n<before;n++)assert.equal(takeFish(w,shore,'carp','caught'),true);
 const unobserved=structuredClone(w),saved=JSON.stringify(w);
 assert.match(industryPanel(w),/河鲤 0 份 · 已耗尽，不能自行繁殖/);assert.equal(JSON.stringify(w),saved);
 for(let day=0;day<7;day++){
  industryPanel(w);w.minute+=DAY;unobserved.minute+=DAY;advanceFishing(w);advanceFishing(unobserved);
  assert.deepEqual(w,unobserved);
 }
});

for(const seed of [5401,5402,7777])test(`complete one-day stepWorld trajectory is unchanged by reading fish observation, seed ${seed}`,()=>{
 const observed=createFrontierWorld(seed);observed.clock.paused=false;
 const unobserved=structuredClone(observed);
 for(let minute=0;minute<DAY;minute++){
  if(minute%120===0)industryPanel(observed);
  stepWorld(observed,1);stepWorld(unobserved,1);
 }
 assert.deepEqual(observed,unobserved);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceWildlife} from '../src/world/frontier-wildlife.js';
import {availableWildFishAt,fishWindow,fishingStockAt,initializeFishing,wildFishAt,waterAtShore} from '../src/world/fishing.js';
import {WorldStore} from '../src/server/store.js';

const threats={warn:()=>{},injure:()=>{},notify:()=>{}};
function advance(w:ReturnType<typeof createFrontierWorld>,minutes:number){for(let i=0;i<minutes;i++){w.minute++;advanceWildlife(w,1,threats);}}
function duckFixture(){
 const w=createFrontierWorld(5401),s=w.frontierHazards!,duck=s.beasts.find(b=>b.species==='duck')!;
 w.residents=[];w.industry!.animals=[];s.disasters=[];s.beasts=[duck];s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[]};
 w.minute=22*60;w.weather='sun';duck.at={...s.shore!};duck.hunger=90;duck.thirst=20;duck.health=100;duck.energy=90;duck.nextMoveAt=w.minute;duck.cooldownUntil=1e12;
 const patch=s.foodPatches.find(p=>p.id==='habitat:duck')!;patch.amount=patch.capacity;patch.progress=0;
 return {w,s,duck,patch,pool:fishingStockAt(w,s.shore!)!};
}
test('a duck reaches its real seed patch when stocked fish have no current feeding window',()=>{
 const f=duckFixture();assert.ok(f.pool.amount>0);assert.equal(fishWindow(f.w,f.s.shore!).species,null);
 const amount=f.patch.amount,fish=f.pool.amount;advance(f.w,110);
 assert.ok(f.patch.amount<amount,'available seeds must be reached and physically eaten rather than shore oscillation');
 assert.ok(f.duck.hunger<70);assert.equal(f.pool.amount,fish);assert.equal(f.duck.status,'alive');
});

for(const missing of ['species','reach'] as const)test(`a stocked water sector cannot distract a duck when actual fish ${missing} is missing`,()=>{
 const f=duckFixture();f.w.minute=8*60;
 if(missing==='species'){f.pool.amount-=f.pool.species!.carp!.amount;f.pool.species!.carp!.amount=0;}
 else {const at={x:f.s.shore!.x+8,y:f.s.shore!.y};f.w.map.tiles[at.y*f.w.map.width+at.x]='water';f.pool.shoal!.at=at;}
 assert.ok(f.pool.amount>0);assert.equal(availableWildFishAt(f.w,f.s.shore!),false);
 const food=f.patch.amount,fish=f.pool.amount;f.duck.nextMoveAt=f.w.minute;advance(f.w,110);
 assert.ok(f.patch.amount<food);assert.equal(f.pool.amount,fish);assert.ok(f.duck.hunger<70);
});

test('a valid seed-food journey remains selected when the fish window opens while walking',()=>{
 const f=duckFixture();f.w.minute=5*60+58;f.duck.nextMoveAt=f.w.minute;advance(f.w,1);
 assert.equal(f.duck.activity?.targetId,f.patch.id);const food=f.patch.amount,fish=f.pool.amount;
 advance(f.w,90);assert.ok(f.patch.amount<food);assert.equal(f.pool.amount,fish,'opening a fish window must not steal the existing valid land-food goal');
});

test('a depleted seed target is abandoned for an actually available fish, consumed once',()=>{
 const f=duckFixture();advance(f.w,1);assert.equal(f.duck.activity?.targetId,f.patch.id);
 f.w.minute=8*60+1440;f.patch.amount=0;f.patch.progress=0;f.duck.nextMoveAt=f.w.minute;
 assert.equal(availableWildFishAt(f.w,f.s.shore!),'carp');const amount=f.pool.amount;
 for(let i=0;i<24&&f.pool.amount===amount;i++)advance(f.w,1);
 assert.equal(f.pool.amount,amount-1);assert.ok(f.duck.hunger<60);
 const before=JSON.stringify(f.s);advanceWildlife(f.w,1,threats);assert.equal(JSON.stringify(f.s),before);
 assert.equal(f.pool.amount,amount-1,'re-entry at the same minute cannot eat the fish again');
});

test('the actual-fish target query leaves quantities, progress and the world unchanged',()=>{
 const f=duckFixture();f.w.minute=8*60;const before=JSON.stringify(f.w);
 assert.equal(availableWildFishAt(f.w,f.s.shore!),'carp');assert.equal(JSON.stringify(f.w),before);
});

test('an old world missing fishing rules is not initialized by querying a duck target',()=>{
 const f=duckFixture();f.w.minute=8*60;delete f.w.definitions['ecology/fishing-process@1'];const before=JSON.stringify(f.w);
 assert.equal(availableWildFishAt(f.w,f.s.shore!),false);assert.equal(JSON.stringify(f.w),before);
 const stock=JSON.stringify(f.w.industry!.fishing);initializeFishing(f.w);
 assert.equal(JSON.stringify(f.w.industry!.fishing),stock);assert.equal(availableWildFishAt(f.w,f.s.shore!),'carp');
});

test('two ducks competing for the last real fish cannot duplicate stock or nutrition',()=>{
 const f=duckFixture();f.w.minute=8*60;f.duck.hunger=60;f.duck.nextMoveAt=f.w.minute;
 for(const stock of Object.values(f.pool.species!))stock!.amount=0;f.pool.species!.carp!.amount=1;f.pool.amount=1;
 f.s.beasts.push({...f.duck,id:'competing-duck',at:{...f.duck.at}});const eaten=f.pool.species!.carp!.eaten;
 advance(f.w,1);assert.equal(f.pool.amount,0);assert.equal(f.pool.species!.carp!.amount,0);assert.equal(f.pool.species!.carp!.eaten,eaten+1);
 assert.equal(f.s.beasts.filter(b=>b.hunger<30).length,1);assert.equal(wildFishAt(f.w,f.s.shore!),false);
 const before=JSON.stringify(f.s);advanceWildlife(f.w,1,threats);assert.equal(JSON.stringify(f.s),before);assert.equal(f.pool.amount,0);
});

test('an active flood makes stocked fish unavailable without spending either quantity',()=>{
 const f=duckFixture();f.w.minute=8*60;assert.equal(availableWildFishAt(f.w,f.s.shore!),'carp');
 f.s.disasters.push({id:'synthetic-flood',kind:'flashFlood',at:{...waterAtShore(f.w,f.s.shore!)!},radius:0,phase:'active',warningAt:0,startsAt:0,endsAt:1e12,intensity:20,warned:[],exposure:{}});
 const stock=JSON.stringify(f.pool);assert.equal(availableWildFishAt(f.w,f.s.shore!),false);assert.equal(wildFishAt(f.w,f.s.shore!),false);assert.equal(JSON.stringify(f.pool),stock);
});

test('a seed destination becoming blocked can be abandoned for reachable fish',()=>{
 const f=duckFixture();f.w.minute=8*60;f.duck.nextMoveAt=f.w.minute;f.duck.hunger=60;
 f.duck.activity={kind:'forage',reason:'existing real seed journey',target:{...f.patch.at},targetId:f.patch.id};
 f.w.map.tiles[f.patch.at.y*f.w.map.width+f.patch.at.x]='water';const seed=f.patch.amount,fish=f.pool.amount;
 for(let i=0;i<120&&f.pool.amount===fish;i++)advance(f.w,1);
 assert.equal(f.patch.amount,seed);assert.equal(f.pool.amount,fish-1);assert.ok(f.duck.hunger<40);
});

test('SQLite reload retains the selected seed route and same-minute re-entry does not feed twice',()=>{
 const f=duckFixture();advance(f.w,1);assert.equal(f.duck.activity?.targetId,f.patch.id);
 const store=new WorldStore(':memory:');try{
  store.commit(f.w,null);const w=store.load()!,before=JSON.stringify(w.frontierHazards);
  advanceWildlife(w,1,threats);assert.equal(JSON.stringify(w.frontierHazards),before);
  advance(w,110);advance(f.w,110);assert.deepEqual(w.frontierHazards,f.s);assert.deepEqual(w.industry!.fishing,f.w.industry!.fishing);
 }finally{store.close();}
});

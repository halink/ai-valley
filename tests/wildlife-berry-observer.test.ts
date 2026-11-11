import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld} from '../src/world/engine.js';
import {initializeProduction} from '../src/world/production.js';
import {WorldStore} from '../src/server/store.js';
// @ts-expect-error synthetic offline JS observer, not production schema.
import {createBerryObserver} from '../scripts/wildlife-berry-observer.mjs';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('berry setter observation preserves seven complete synthetic days and SQLite continuation exactly',()=>{
 const plain=createFrontierWorld(5402),observed=structuredClone(plain);plain.clock.paused=false;observed.clock.paused=false;
 const observer=createBerryObserver();observer.attach(observed);assert.equal(hash(plain),hash(observed));
 for(let i=0;i<7*1440;i++){stepWorld(plain,1);stepWorld(observed,1);if(i%60===0)assert.equal(hash(plain),hash(observed));}
 assert.equal(hash(plain),hash(observed));const store=new WorldStore(':memory:');try{store.commit(observed,null);const resumed=store.loadForRuntime()!;const resumeObserver=createBerryObserver();resumeObserver.attach(resumed);const expected=JSON.parse(JSON.stringify(observed));delete expected.events;delete expected.processed;const actual=JSON.parse(JSON.stringify(resumed));delete actual.events;delete actual.processed;assert.deepEqual(actual,expected);for(let i=0;i<60;i++){stepWorld(observed,1);stepWorld(resumed,1);}assert.deepEqual(resumed.frontierHazards,observed.frontierHazards);assert.deepEqual(resumed.resources,observed.resources);assert.deepEqual(resumeObserver.snapshot().issues,[]);}finally{store.close();}
 assert.deepEqual(observer.snapshot().issues,[]);assert.ok(observer.snapshot().totals.consumed>0);assert.ok(observer.snapshot().totals.regrown>0);
});

test('observer counts same-tick berry consumption and regrowth independently when net stock is unchanged',()=>{
 const w=createFrontierWorld(5402),s=w.frontierHazards!,deer=s.beasts.find(b=>b.species==='deer')!,bush=w.resources.find(r=>r.kind==='bush')!;
 w.minute=540;w.clock.paused=false;w.weather='sun';w.residents=[];w.industry!.animals=[];s.beasts=[deer];s.disasters=[];s.nextDisasterAt=1e12;s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[]};
 deer.at={...bush.at};deer.den={...bush.at};deer.hunger=60;deer.thirst=20;deer.energy=90;deer.nextMoveAt=w.minute;deer.cooldownUntil=1e12;deer.activity={kind:'roam',reason:'observer fixture'};
 initializeProduction(w);bush.amount=bush.max-1;w.production!.lastMinute=w.minute;w.production!.ecology[bush.id].progress=1;
 const plain=structuredClone(w),observer=createBerryObserver(),before=bush.amount;observer.attach(w);stepWorld(w,1);stepWorld(plain,1);
 assert.equal(hash(w),hash(plain));assert.equal(bush.amount,before);assert.equal(observer.snapshot().totals.consumed,1);assert.equal(observer.snapshot().totals.regrown,1);assert.deepEqual(observer.snapshot().issues,[]);
});

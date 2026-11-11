import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import type {ModelResult} from '../src/server/decisions.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {residentBed,roomLayout} from '../src/shared/rooms.js';
import {YEAR} from '../src/world/time.js';

function fixture(t:TestContext,dayMinutes=180){
 t.mock.timers.enable({apis:['setInterval']});
 let now=1_700_000_000_000;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline review forbids network');});
 const w=createFrontierWorld();w.scenario=undefined;w.frontierHazards=undefined;
 for(const p of w.residents){p.lastDecisionAt=w.minute;p.decisionDue=w.minute+1000;p.hunger=10;p.health=100;p.energy=100;}
 const [guardian,competitor,child]=w.residents;
 guardian.decisionDue=competitor.decisionDue=w.minute;competitor.hunger=40;
 child.canDecide=false;child.canExpress=false;child.guardianIds=[guardian.id];child.at={...guardian.at};child.inside=guardian.inside;child.hunger=90;child.health=40;
 const store=new WorldStore(':memory:');store.commit(w,null);
 const calls:string[]=[];
 const model=async(_key:string,c:{actor:{id:string}}):Promise<ModelResult>=>{calls.push(c.actor.id);return new Promise(()=>{});};
 const runtime=new ValleyRuntime(store,'offline-review',model,{dayMinutes,modelSlots:1});
 // Keep this competition between the supplied local actors, not seeded travellers.
 runtime.world.migration!.contacts=[];runtime.world.foreignTrade!.merchants=[];
 t.after(()=>{runtime.stop();store.close();});
 return {runtime,store,model,calls,guardianId:guardian.id,competitorId:competitor.id,
  get child(){return runtime.world.residents[2];},get guardian(){return runtime.world.residents[0];},
  tick(ms=1000){runtime.tick(now+=ms);}};
}
function setBirth(f:ReturnType<typeof fixture>,value:unknown){(f.child as unknown as {bornAt:unknown}).bornAt=value;}

for(const [label,birth] of [
 ['missing',undefined],['null',null],['NaN',NaN],['positive infinity',Infinity],['negative infinity',-Infinity],['numeric string','0'],['future',1],['unsafe',Number.MAX_SAFE_INTEGER+1],
] as const){
 test(`review: ${label} birth gives neither guardian priority nor slow-clock hold`,t=>{
  const f=fixture(t);setBirth(f,label==='future'?f.runtime.world.minute+1:birth);
  f.runtime.start();assert.equal(f.calls[0],f.competitorId);
  const before=f.runtime.world.minute;f.tick();assert.equal(f.runtime.world.clock.paused,false);assert.ok(f.runtime.world.minute>before);
 });
}
for(const [label,years,priority] of [['newborn',0,true],['just before six',6-1e-8,true],['exactly six',6,false],['adult',18,false]] as const){
 test(`review: ${label} preserves exact under-six scheduling boundary`,t=>{
  const f=fixture(t);setBirth(f,f.runtime.world.minute-years*YEAR);f.runtime.start();
  assert.equal(f.calls[0],priority?f.guardianId:f.competitorId);
  const before=f.runtime.world.minute;f.tick();assert.equal(f.runtime.world.clock.paused,priority);
  if(priority)assert.equal(f.runtime.world.minute,before);else assert.ok(f.runtime.world.minute>before);
 });
}
for(const kind of ['unknown','newborn'] as const){
 test(`review: fast-clock ${kind} critical dependent competes without immediate world hold`,t=>{
  const f=fixture(t,20);setBirth(f,kind==='unknown'?undefined:f.runtime.world.minute);f.child.health=10;
  // A genuinely urgent competing adult beats an unsupported infant label,
  // but not an observed critically ill infant's existing 2000-point class.
  f.runtime.world.residents[1].hunger=90;
  f.runtime.start();assert.equal(f.calls[0],kind==='unknown'?f.competitorId:f.guardianId);
  const before=f.runtime.world.minute;f.tick();assert.equal(f.runtime.world.clock.paused,false);assert.ok(f.runtime.world.minute>before);
 });
}
for(const exclusion of ['no guardian link','different room','outside','too far','healthy'] as const){
 test(`review: known infant still needs observed pressure (${exclusion})`,t=>{
  const f=fixture(t);setBirth(f,f.runtime.world.minute);
  if(exclusion==='no guardian link')f.child.guardianIds=[];
  if(exclusion==='different room')f.child.inside='review-unseen-room';
  if(exclusion==='outside')f.child.residency='outside';
  if(exclusion==='too far')f.child.at={x:f.guardian.at.x+13,y:f.guardian.at.y};
  if(exclusion==='healthy'){f.child.health=100;f.child.hunger=10;}
  f.runtime.start();assert.equal(f.calls[0],f.competitorId);f.tick();assert.equal(f.runtime.world.clock.paused,false);
 });
}

test('review: absent observed need does not become pressure for a known infant',t=>{
 const f=fixture(t);setBirth(f,f.runtime.world.minute);
 delete (f.child as Partial<typeof f.child>).hunger;delete (f.child as Partial<typeof f.child>).health;
 f.runtime.start();assert.equal(f.calls[0],f.competitorId);f.tick();assert.equal(f.runtime.world.clock.paused,false);
});

test('review: unknown dependent stays unknown across stop and SQLite reload',t=>{
 const f=fixture(t);setBirth(f,undefined);f.runtime.start();f.tick();f.runtime.stop();
 const next=new ValleyRuntime(f.store,'offline-review',f.model,{dayMinutes:180,modelSlots:1});
 try{assert.equal(next.world.residents[2].bornAt,undefined);f.calls.length=0;next.start();assert.equal(f.calls[0],f.competitorId);
  const before=next.world.minute;next.tick(Date.now()+1000);assert.equal(next.world.clock.paused,false);assert.ok(next.world.minute>before);
 }finally{next.stop();}
});

for(const source of ['hunger','exhaustion'] as const){
 test(`review: guardian of unknown-age dependent retains genuine own ${source} protection and reload deadline`,t=>{
  const f=fixture(t,20);setBirth(f,undefined);const p=f.guardian;
  p.health=1;p.hunger=source==='hunger'?98:10;p.energy=source==='exhaustion'?0:80;p.inventory={meal:2};
  if(source==='exhaustion'){
   p.health=.5;const b=f.runtime.world.buildings.find(b=>b.id===p.homeId)!;const bed=residentBed(f.runtime.world,p,b)!;
   p.at={...b.door};p.inside=b.id;p.roomAt={...roomLayout(f.runtime.world,b).slots.find(s=>s.key==='bed:'+bed)!.at};
  }
  const health=p.health;f.runtime.start();f.tick();const current=f.guardian,state=current.decisionProtection;
  assert.ok(state,`actual ${source} rescue must establish protection`);assert.ok(state.prevented[source]>0);assert.equal(current.health,health);
  assert.equal(state.expiresAt-state.startedAt,180);assert.equal(f.runtime.world.clock.paused,false);
  f.runtime.stop();const next=new ValleyRuntime(f.store,'offline-review',f.model,{dayMinutes:20,modelSlots:1});
  try{assert.equal(next.world.residents[0].decisionProtection?.expiresAt,state.expiresAt);assert.equal(next.world.residents[0].bornAt,p.bornAt);}finally{next.stop();}
 });
}

for(const source of ['hunger','exhaustion'] as const){
 test(`review: unknown-age actor keeps slow-clock own ${source} hold after grace`,t=>{
  const f=fixture(t);setBirth(f,undefined);delete (f.guardian as Partial<typeof f.guardian>).bornAt;
  f.guardian.hunger=source==='hunger'?90:10;f.guardian.energy=source==='exhaustion'?1:100;
  f.runtime.start();assert.equal(f.calls[0],f.guardianId);f.tick();assert.equal(f.runtime.world.clock.paused,false);
  const before=f.runtime.world.minute;f.tick(30_000);assert.equal(f.runtime.world.clock.paused,true);assert.equal(f.runtime.world.minute,before);
 });
}

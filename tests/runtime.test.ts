import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import {DecisionError,type ModelResult} from '../src/server/decisions.js';
import {createFormalWorld,createFrontierWorld} from '../src/world/formal-seed.js';
import {advancePublicDuties,completeDuty} from '../src/world/public-duties.js';
import {calendar,DAY,YEAR,daylight,gameMinutesFromWall} from '../src/world/time.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('an unrelated successful reply cannot unfreeze a resident with an unresolved model failure',async()=>{
 const store=new WorldStore(':memory:');
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{
  if(c.actor.id==='lin')throw new Error('model_http_503');
  return {decision:{intention:'休息',actions:[{type:'wait',minutes:100}]},inputTokens:1,outputTokens:1,latencyMs:1};
 });
 try{runtime.start();await flush();await flush();runtime.tick();
  assert.equal(runtime.world.metrics.successes,2);assert.equal(runtime.world.metrics.failures,1);
  assert.equal(runtime.world.clock.paused,true);assert.match(runtime.world.clock.reason!,/重试/);
  const time=runtime.world.minute;runtime.tick(Date.now()+10_000);assert.equal(runtime.world.minute,time);
 }finally{runtime.stop();store.close();}
});
test('committed event identity stays unique across runtime ticks and service restart',async()=>{
 const store=new WorldStore(':memory:');
 const runtime=new ValleyRuntime(store,'test-key',async()=>({decision:{intention:'吃点浆果再休息',actions:[{type:'eat',item:'berry'},{type:'eat',item:'berry'},{type:'wait',minutes:100}]},inputTokens:1,outputTokens:1,latencyMs:1}));
 try{
  runtime.start();await flush();await flush();
  let now=Date.now();for(let i=0;i<30;i++)runtime.tick(now+=2000);
  const ids=runtime.world.events.map(e=>e.id);assert.ok(ids.length>=6);assert.equal(new Set(ids).size,ids.length);
  assert.equal(store.history(runtime.world.id,Number.MAX_SAFE_INTEGER).length,ids.length);
  runtime.stop();const before=runtime.world.minute;const restarted=new ValleyRuntime(store,null);
  assert.equal(restarted.world.minute,before);restarted.tick(now+10_000_000);assert.equal(restarted.world.minute,before);restarted.stop();
 }finally{runtime.stop();store.close();}
});

test('interrupted model requests are recorded as unknown usage once across restart',()=>{
 const store=new WorldStore(':memory:');
 const runtime=new ValleyRuntime(store,'test-key',()=>new Promise<ModelResult>(()=>{}));
 runtime.start();const n=runtime.world.metrics.requests;assert.equal(n,2);const minute=runtime.world.minute;
 runtime.stop();assert.equal(runtime.world.metrics.failures,n);assert.equal(runtime.world.metrics.unmeteredFailures,n);
 const next=new ValleyRuntime(store,null);assert.equal(next.world.metrics.failures,n);assert.equal(next.world.minute,minute);next.stop();store.close();
});

test('healthy model waiting does not stall ongoing lives, but approaching irreversible need does',async()=>{
 const store=new WorldStore(':memory:');const base=(await import('../src/world/seed.js')).createWorld();
 for(const p of base.residents)p.lastDecisionAt=base.minute;store.commit(base,null);
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c)=>{
  if(c.actor.id==='lin')throw new Error('model_http_503');
  return {decision:{intention:'休息',actions:[{type:'wait',minutes:100}]},inputTokens:1,outputTokens:1,latencyMs:1};
 });
 try{runtime.start();await flush();await flush();runtime.tick(Date.now()+1000);
  assert.equal(runtime.world.clock.paused,false);assert.ok(runtime.world.minute>base.minute);
  assert.equal(runtime.world.metrics.lastError,'model_http_503');
  // A test-only fact change represents the person reaching urgent need, never a live admin action.
  runtime.world.residents.find(p=>p.id==='lin')!.hunger=85;
  const time=runtime.world.minute;runtime.tick(Date.now()+2000);assert.equal(runtime.world.clock.paused,true);assert.equal(runtime.world.minute,time);
 }finally{runtime.stop();store.close();}
});

test('a provider rate limit backs off the whole roster rather than immediately sending the next resident',async()=>{
 const store=new WorldStore(':memory:');
 const runtime=new ValleyRuntime(store,'test-key',async()=>{throw new Error('model_http_429');},{mode:'formal',modelSlots:2});
 try{
  runtime.start();await flush();await flush();runtime.tick();
  assert.equal(runtime.world.metrics.requests,2);
  assert.equal(runtime.world.metrics.failures,2);
  assert.equal(runtime.world.clock.paused,true);
 }finally{runtime.stop();store.close();}
});

test('formal residents with valid routes keep moving while an urgent resident corrects a malformed reply',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:'),base=createFormalWorld();
 for(const p of base.residents){p.lastDecisionAt=base.minute;p.decisionDue=base.minute+1000;}
 const [waiting,walker]=base.residents;
 waiting.hunger=86;waiting.decisionDue=base.minute;
 const to={x:walker.at.x,y:walker.at.y+1};
 walker.plan={id:'walk',actorId:walker.id,actorRevision:walker.revision,createdAt:base.minute,definition:'action/routine@1',intention:'走到附近',actions:[{type:'move',to}]};
 store.commit(base,null);
 const replies:(string|undefined)[]=[];
 const runtime=new ValleyRuntime(store,'test-key',async(_key,c,feedback)=>{
  if(c.actor.id!==waiting.id)return new Promise<ModelResult>(()=>{});
  replies.push(feedback);
  if(!feedback)throw new DecisionError('invalid_decision',{inputTokens:1,outputTokens:1,latencyMs:1},'请补充目标文字');
  return new Promise<ModelResult>(()=>{});
 },{dayMinutes:180});
 try{
  runtime.start();await flush();runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.paused,false);
  assert.ok(runtime.world.residents.find(r=>r.id===walker.id)?.activity?.travelProgress);
  runtime.tick(now+=4000);
  assert.deepEqual(replies,[undefined,'请补充目标文字']);
  assert.equal(runtime.world.residents.find(r=>r.id===waiting.id)?.plan,null);
  const minute=runtime.world.minute;runtime.tick(now+=27_000);
  assert.equal(runtime.world.clock.paused,true);
  assert.equal(runtime.world.minute,minute);
 }finally{runtime.stop();store.close();}
});

test('a fast world crosses midnight through a normal queue and holds after a sustained lack of decisions',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:'),base=createFormalWorld();
 base.minute=DAY-1;
 for(const p of base.residents){p.lastDecisionAt=base.minute;p.decisionDue=base.minute+1000;}
 const waiting=base.residents[0];waiting.hunger=85;waiting.decisionDue=base.minute-70;
 store.commit(base,null);
 const runtime=new ValleyRuntime(store,'test-key',()=>new Promise<ModelResult>(()=>{}));
 try{
  runtime.start();runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.realMinutesPerDay,20);
  assert.equal(runtime.world.clock.paused,false);
  assert.equal(runtime.world.minute,DAY+.2);
  assert.equal(calendar(runtime.world.minute).day,2);
  assert.equal(daylight(runtime.world.minute).phase,'night');
  const before=runtime.world.minute;runtime.tick(now+=180_000);
  assert.equal(runtime.world.minute,before);
  assert.match(runtime.world.clock.reason!,/持续未提供/);
 }finally{runtime.stop();store.close();}
});

test('a critical listener thinking after a conversation does not stop another resident walking',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:'),base=createFrontierWorld();
 const [listener,speaker,walker]=base.residents.filter(p=>base.minute-p.bornAt>=18*YEAR);
 const lodge=base.buildings.find(b=>b.kind==='lodge')!;
 for(const p of base.residents){p.lastDecisionAt=base.minute;p.decisionDue=base.minute+1000;}
 listener.at={...lodge.door};speaker.at={...lodge.door};
 listener.health=19;speaker.decisionDue=walker.decisionDue=base.minute;
 speaker.knownPeople.push(listener.id);
 const to={...lodge.door};
 walker.at={...base.buildings.find(b=>b.kind==='home'&&b.ownerId!==walker.id)!.door};
 store.commit(base,null);
 let spoke=false,startedWalking=false;
 const runtime=new ValleyRuntime(store,'test-key',async(_key,{actor})=>{
  if(actor.id===speaker.id&&!spoke){
   spoke=true;
   return {decision:{intention:'打个招呼',actions:[{type:'talk',targetId:listener.id,text:'早上好。',tone:'friendly'}]},inputTokens:1,outputTokens:1,latencyMs:1};
  }
  if(actor.id===walker.id&&!startedWalking){
   startedWalking=true;
   return {decision:{intention:'走去会馆',actions:[{type:'move',to}]},inputTokens:1,outputTokens:1,latencyMs:1};
  }
  return new Promise<ModelResult>(()=>{});
 });
 try{
  runtime.start();await flush();
  for(let i=0;i<4;i++)runtime.tick(now+=1000);
  assert.ok(runtime.world.events.some(e=>e.kind==='conversation'&&e.actors.includes(listener.id)&&e.text.includes('早上好')));
  assert.ok(runtime.world.metrics.inFlight.includes(listener.id));
  assert.equal(runtime.world.residents.find(p=>p.id===listener.id)?.plan,null);
  const minute=runtime.world.minute,at=runtime.world.residents.find(p=>p.id===walker.id)?.at;
  for(let i=0;i<3;i++)runtime.tick(now+=1000);
  assert.equal(runtime.world.clock.paused,false);
  assert.ok(runtime.world.minute>minute);
  assert.notDeepEqual(runtime.world.residents.find(p=>p.id===walker.id)?.at,at);
  assert.ok(runtime.world.metrics.inFlight.includes(listener.id));
 }finally{runtime.stop();store.close();}
});

test('a booked public shift can pass its grace period while the worker is waiting for a model reply',t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const store=new WorldStore(':memory:'),base=createFrontierWorld();
 base.minute=568;
 for(const p of base.residents){p.lastDecisionAt=base.minute;p.decisionDue=base.minute+1000;}
 const worker=base.residents.find(p=>base.minute-p.bornAt>=18*YEAR)!;
 advancePublicDuties(base);
 const shift=base.duties!.shifts.find(s=>s.role==='kitchen'&&s.start===600)!;
 const lodge=base.buildings.find(b=>b.id===shift.buildingId)!;
 worker.at={...lodge.door};worker.inventory.turnip=2;worker.inventory.water=1;worker.decisionDue=base.minute;
 assert.equal(completeDuty(base,worker,{type:'publicDuty',operation:'claim',shiftId:shift.id}),null);
 assert.equal(shift.status,'booked');
 store.commit(base,null);
 const runtime=new ValleyRuntime(store,'test-key',()=>new Promise<ModelResult>(()=>{}));
 try{
  runtime.start();
  for(let i=0;i<45;i++)runtime.tick(now+=1000);
  const saved=runtime.world.duties!.shifts.find(s=>s.id===shift.id)!;
  assert.ok(runtime.world.metrics.inFlight.includes(worker.id));
  assert.equal(runtime.world.clock.paused,false);
  assert.ok(runtime.world.minute>615);
  assert.equal(saved.status,'open');
  assert.equal(saved.workerId,null);
  assert.equal(saved.assignments[0].outcome,'absent');
 }finally{runtime.stop();store.close();}
});

test('a 20 minute cycle uses the same game day at dawn, daylight, dusk and night',()=>{
 assert.equal(gameMinutesFromWall(20*60_000,20),DAY);
 assert.deepEqual([5,8,18,21,24].map(hour=>daylight(hour*60).phase),['dawn','day','dusk','night','night']);
 assert.ok(daylight(6*60).darkness>daylight(7*60).darkness);
 assert.ok(daylight(20*60).darkness>daylight(19*60).darkness);
});

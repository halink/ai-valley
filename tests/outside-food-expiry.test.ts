import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';
import {advanceFood,initializeFood} from '../src/world/food.js';
import {applyOutsideDecision,initializeMigration,outsideDecisionContext} from '../src/world/migration.js';
import {initializeForeignTrade} from '../src/world/foreign-trade.js';
import {executeSocialAction} from '../src/world/social.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import type {ModelResult} from '../src/server/decisions.js';
import type {DecisionContext,World} from '../src/shared/types.js';
import {DAY} from '../src/world/time.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const travel={intention:'根据本人收到的消息决定来访',actions:[{type:'travelToValley' as const}]};
function fixture(){
  const w=createWorld();w.mode='formal';initializeMigration(w);initializeForeignTrade(w);
  for(const p of w.residents)p.inventory={};
  for(const c of w.migration!.contacts)c.person!.inventory={};
  for(const m of w.foreignTrade!.merchants)m.person.inventory={};
  const p=w.migration!.contacts[0].person!;p.inventory={meal:1,water:2};initializeFood(w);
  return {w,p,expiry:w.food!.lots['person:'+p.id].meal![0].expiresAt};
}

test('real food expiry invalidates an offered outside contact, rejects the old decision and remains single after reload',()=>{
  let {w,p,expiry}=fixture();
  assert.equal(expiry,w.minute+3*DAY,'use the actual original shelf life');
  const revision=p.revision,coins=p.coins;p.decisionDue=expiry+60;
  w.minute=expiry-1;advanceFood(w);
  assert.equal(p.inventory.meal,1);assert.equal(p.revision,revision);
  w.minute=expiry;advanceFood(w);
  assert.equal(p.inventory.meal,0);assert.equal(p.inventory.water,2);assert.equal(p.coins,coins);
  assert.equal(p.revision,revision+1);assert.equal(p.decisionDue,expiry);assert.equal(w.food!.spoiled.meal,1);
  assert.match(applyOutsideDecision(w,p.id,revision,travel).error!,/已经变化/);
  assert.equal(w.migration!.contacts[0].phase,'offered');assert.equal(w.migration!.contacts[0].journey,null);
  assert.equal(w.residents.some(r=>r.id===p.id),false);
  const store=new WorldStore(':memory:');
  try{
    store.commit(w,null);w=store.load()!;p=w.migration!.contacts[0].person!;
    advanceFood(w);advanceFood(w);
    assert.equal(p.revision,revision+1);assert.equal(p.inventory.meal,0);assert.equal(w.food!.spoiled.meal,1);
    assert.equal(applyOutsideDecision(w,p.id,revision,travel).ok,false);
    assert.match(outsideDecisionContext(w,p).outside!.notice,/当前未过期的完整食品：无/);
    assert.ok(applyOutsideDecision(w,p.id,p.revision,{intention:'重新核对后本人选择留下',actions:[{type:'stayOutside'}]}).ok);
    assert.equal(w.migration!.contacts[0].phase,'home');assert.equal(p.inventory.meal,0);
  }finally{store.close();}
});

test('a returning resident uses the resident record and expiry does not invalidate it twice through the road contact',()=>{
  const {w}=fixture(),r=w.residents[0];r.at={...w.map.entrance};r.inside=null;
  assert.ok(executeSocialAction(w,r,{type:'leave'}).ok);
  const c=w.migration!.contacts.find(c=>c.id===r.id)!;assert.equal(c.person,undefined);
  c.phase='offered';c.offeredAt=w.minute;r.inventory={meal:1};initializeFood(w);
  const expiry=w.food!.lots['person:'+r.id].meal![0].expiresAt,revision=r.revision;
  w.minute=expiry;advanceFood(w);
  assert.equal(r.revision,revision+1);assert.equal(r.inventory.meal,0);
  assert.equal(applyOutsideDecision(w,r.id,revision,travel).ok,false);
  assert.equal(w.residents.filter(p=>p.id===r.id).length,1);assert.equal(c.person,undefined);
  assert.ok(applyOutsideDecision(w,r.id,r.revision,{intention:'本人决定留在镇外',actions:[{type:'stayOutside'}]}).ok);
});

test('expiry invalidates stale input without cancelling a journey already chosen by the traveller',()=>{
  const {w,p,expiry}=fixture();w.minute=expiry-5;
  assert.ok(applyOutsideDecision(w,p.id,p.revision,travel).ok);
  const c=w.migration!.contacts[0],journey=structuredClone(c.journey),revision=p.revision;
  w.minute=expiry;advanceFood(w);
  assert.equal(p.inventory.meal,0);assert.equal(p.revision,revision+1);
  assert.equal(c.phase,'travelling');assert.deepEqual(c.journey,journey);assert.equal(p.residency,'outside');
});

test('a runtime request in flight cannot start travel after real food expiry and the fresh request uses the reduced stock',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const {w,p,expiry}=fixture();w.minute=expiry-.5;w.migration!.lastLifeAt=w.minute;w.migration!.nextPostAt=w.minute+DAY;
  for(const r of w.residents){r.lastDecisionAt=w.minute;r.decisionDue=w.minute+DAY;}
  for(const m of w.foreignTrade!.merchants)m.person.decisionDue=w.minute+DAY;
  const id=p.id,originalRevision=p.revision,store=new WorldStore(':memory:');store.commit(w,null);
  const calls:Array<{context:DecisionContext;resolve:(result:ModelResult)=>void}>=[];
  const runtime=new ValleyRuntime(store,'test-key',async(_key,context)=>new Promise<ModelResult>(resolve=>calls.push({context,resolve})),{dayMinutes:20,modelSlots:1});
  const contact=(world:World)=>world.migration!.contacts.find(c=>c.id===id)!;
  const answer=(decision:ModelResult['decision']):ModelResult=>({decision,inputTokens:1,outputTokens:1,latencyMs:1});
  try{
    runtime.start();assert.equal(calls.length,1);assert.equal(calls[0].context.actor.id,id);
    assert.equal(calls[0].context.actor.inventory.meal,1);assert.equal(contact(runtime.world).person!.revision,originalRevision);
    runtime.tick(now+=1000);
    assert.ok(runtime.world.minute>expiry);assert.equal(runtime.world.clock.paused,false);
    assert.equal(contact(runtime.world).person!.inventory.meal,0);
    assert.equal(contact(runtime.world).person!.revision,originalRevision+1);
    assert.equal(calls.length,1,'the old request is still in flight');
    calls[0].resolve(answer(travel));await flush();
    assert.equal(runtime.world.metrics.successes,0);assert.equal(runtime.world.metrics.failures,1);
    assert.match(runtime.world.metrics.lastError!,/外部人物或驿路机会已经变化/);
    assert.equal(contact(runtime.world).phase,'offered');assert.equal(contact(runtime.world).journey,null);
    assert.equal(runtime.world.residents.some(r=>r.id===id),false);
    runtime.tick(now+=5001);assert.equal(calls.length,2);
    assert.equal(calls[1].context.actor.id,id);assert.equal(calls[1].context.actor.inventory.meal,0);
    assert.match(calls[1].context.outside!.notice,/当前未过期的完整食品：无/);
    assert.equal(calls[0].context.actor.inventory.meal,1,'the first request really held the old snapshot');
    calls[1].resolve(answer({intention:'看见现有口粮后决定不启程',actions:[{type:'stayOutside'}]}));await flush();
    assert.equal(runtime.world.metrics.successes,1);assert.equal(runtime.world.metrics.failures,1);
    assert.equal(contact(runtime.world).phase,'home');assert.equal(contact(runtime.world).journey,null);
    assert.equal(contact(runtime.world).person!.inventory.meal,0);assert.equal(runtime.world.food!.spoiled.meal,1);
  }finally{runtime.stop();store.close();}
});

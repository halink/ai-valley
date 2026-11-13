import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {createMvpWorld,createMvpSession} from '../src/server/godot-mvp.js';
import {startPersistentMvp} from '../src/server/godot-mvp-persistent.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {mvpDrinkReason,mvpThirst,adoptMvpDrinking,validateMvpDrinking} from '../src/world/mvp-drinking.js';
import {decisionContext,decisionChoices,prompt} from '../src/server/decisions.js';
import {parseChoice} from '../src/server/affordances.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,World} from '../src/shared/types.js';
let serial=0;
function plan(w:World,a:Action){const r=w.residents[0];const p={id:`drink-test-${++serial}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'合成自主选择',actions:[a]};assert.equal(submitPlan(w,p).ok,true);return p;}
function finish(w:World){const r=w.residents[0];for(let i=0;i<200&&(r.plan||r.activity);i++)stepWorld(w,1);assert.equal(r.activity,null);assert.equal(r.plan,null);}
function fixture(t:any){const dir=mkdtempSync(join(testTmpdir(),'mvp-drink-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'synthetic.sqlite');}
test('real travel/gather then selected drinking survives restart with conservation and no duplicate execution',t=>{
 const database=fixture(t);let w=createMvpWorld();const r=w.residents[0],spring=w.resources.find(s=>s.kind==='spring')!;const initial=spring.amount;
 // Earn thirst through real elapsed simulation. No automatic water or ingestion.
 stepWorld(w,720);assert.ok(Math.abs(mvpThirst(w,r)!-50)<1e-8);assert.equal(w.mvpDrinking!.consumed[r.id],0);
 plan(w,{type:'gather',resourceId:spring.id,quantity:1});finish(w);assert.equal(r.inventory.water,1);assert.equal(spring.amount,initial-1);
 const choice=plan(w,{type:'mvpDrink'});stepWorld(w,1);assert.ok(r.activity);assert.equal(r.inventory.water,1,'not consumed before five-minute work');
 const store=new WorldStore(database);store.commit(w,null);store.close();const reopened=new WorldStore(database);w=reopened.load()!;const savedRevision=w.revision;finish(w);
 const restored=w.residents[0];assert.equal(restored.inventory.water,0);assert.equal(w.mvpDrinking!.consumed[restored.id],1);
 assert.equal(w.resources.find(s=>s.id===spring.id)!.amount+(restored.inventory.water??0)+w.mvpDrinking!.consumed[restored.id],initial);
 const consumed=w.mvpDrinking!.consumed[restored.id];submitPlan(w,choice);stepWorld(w,10);assert.equal(w.mvpDrinking!.consumed[restored.id],consumed);
 assert.ok(w.events.some(e=>e.text.includes('自行饮用1份')));reopened.commit(w,savedRevision);reopened.close();const finalStore=new WorldStore(database);const finalWorld=finalStore.load()!;assert.equal(finalWorld.mvpDrinking!.consumed[restored.id],1);assert.equal(finalWorld.residents[0].inventory.water,0);finalStore.close();
});
test('dry inventory, stale supply, no demand and formal worlds do not consume',()=>{
 const w=createMvpWorld(),r=w.residents[0];assert.match(mvpDrinkReason(w,r)!,/需求/);
 stepWorld(w,720);assert.match(mvpDrinkReason(w,r)!,/清水/);assert.equal(w.mvpDrinking!.consumed[r.id],0);
 plan(w,{type:'gather',resourceId:'mvp-spring',quantity:1});finish(w);plan(w,{type:'mvpDrink'});stepWorld(w,1);r.inventory.water=0;finish(w);assert.ok(r.lastFailure);assert.equal(w.mvpDrinking!.consumed[r.id],0);
 w.mode='formal';assert.match(mvpDrinkReason(w,r)!,/不支持/);const before=structuredClone(w.mvpDrinking);adoptMvpDrinking(w);assert.deepEqual(w.mvpDrinking,before);
});
test('own thirst and optional drink reach actual model choice menu, not an automatic action',()=>{
 const w=createMvpWorld(),r=w.residents[0];stepWorld(w,720);plan(w,{type:'gather',resourceId:'mvp-spring',quantity:1});finish(w);
 const c=decisionContext(w,r),choices=decisionChoices(c),drink=choices.find(c=>c.action.type==='mvpDrink');assert.ok(drink);assert.ok(c.mvpDrinking!.thirst>=50);assert.match(JSON.stringify(prompt(c,choices)),/本人MVP口渴/);
 assert.equal(parseChoice(JSON.stringify({choice:drink.id}),choices).actions[0].type,'mvpDrink');stepWorld(w,10);assert.equal(r.inventory.water,1);assert.equal(w.mvpDrinking!.consumed[r.id],0);
});
test('old MVP adoption starts hydrated once and persists, not elapsed offline thirst',async t=>{
 const database=fixture(t),old=createMvpWorld();delete old.mvpDrinking;old.minute+=1000;const store=new WorldStore(database);store.commit(old,null);store.close();
 const run=await startPersistentMvp({database,port:0,env:{}});assert.equal(run.runtime.world.mvpDrinking!.adoptedAt,old.minute);assert.ok(Object.values(run.runtime.world.mvpDrinking!.thirst).every(x=>x===0));await run.close();
 const next=await startPersistentMvp({database,port:0,env:{}});assert.equal(next.runtime.world.mvpDrinking!.adoptedAt,old.minute);await next.close();
});
test('short synthetic rule run includes drinking without model requests',()=>{
 const s=createMvpSession();for(let i=0;i<1000;i++)s.advance();assert.equal(s.snapshot().mvp.fault,null);assert.ok(Object.values(s.world.mvpDrinking!.consumed).every(x=>x>0));assert.equal(s.world.metrics.requests,0);
});
test('pause and explicit wait never drink; inability cancels completion',()=>{
 const w=createMvpWorld(),r=w.residents[0];stepWorld(w,720);plan(w,{type:'gather',resourceId:'mvp-spring',quantity:1});finish(w);
 w.clock.paused=true;const thirst=mvpThirst(w,r);stepWorld(w,60);assert.equal(mvpThirst(w,r),thirst);w.clock.paused=false;
 plan(w,{type:'wait',minutes:10});finish(w);assert.equal(r.inventory.water,1);assert.equal(w.mvpDrinking!.consumed[r.id],0);
 plan(w,{type:'mvpDrink'});stepWorld(w,1);r.canExpress=false;finish(w);assert.ok(r.lastFailure);assert.equal(r.inventory.water,1);
});
test('empty spring cannot conjure water; original slow regeneration remains a counted inflow',()=>{
 const w=createMvpWorld(),r=w.residents[0],spring=w.resources.find(s=>s.kind==='spring')!;spring.amount=0;spring.lastHarvest=w.minute;
 plan(w,{type:'gather',resourceId:spring.id,quantity:1});finish(w);assert.ok(r.lastFailure);assert.equal(r.inventory.water??0,0);
 const start=w.minute;stepWorld(w,Math.ceil((spring.lastHarvest+1440)/1440)*1440-start);assert.equal(spring.amount,1,'one pre-existing day-boundary replenishment, not free drinking');
 assert.equal((r.inventory.water??0)+spring.amount+w.mvpDrinking!.consumed[r.id],1);assert.equal(w.mvpDrinking!.consumed[r.id],0);
});
test('unsupported or corrupt saved hydration fails closed without rewriting DB',async t=>{
 const database=fixture(t),w=createMvpWorld();w.mvpDrinking!.thirst[w.residents[0].id]=-1;const store=new WorldStore(database);store.commit(w,null);store.close();
 await assert.rejects(startPersistentMvp({database,port:0,env:{}}),/godot_mvp_save_mismatch/);
 const read=new WorldStore(database);assert.equal(read.load()!.mvpDrinking!.thirst[w.residents[0].id],-1);read.close();
});

test('future versions and explicit null state are not adopted as old saves',()=>{
 const w=createMvpWorld();(w.mvpDrinking as any).version=2;assert.throws(()=>validateMvpDrinking(w),/invalid_drinking_state/);
 (w as any).mvpDrinking=null;assert.throws(()=>validateMvpDrinking(w),/invalid_drinking_state/);
 delete w.mvpDrinking;assert.doesNotThrow(()=>validateMvpDrinking(w));
});

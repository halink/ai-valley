import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';
import {parseChoice} from '../src/server/affordances.js';
import {submitPlan} from '../src/world/engine.js';
import {industryTarget} from '../src/world/industry.js';
import {DAY} from '../src/world/time.js';
import {PastureFoodChain,animalChoice} from './helpers/pasture-food-chain.js';

const built=()=>new PastureFoodChain().build().seedAnimalsAndAdmit().breakFence();

test('independent pasture review: hunger and thirst independently block an otherwise due synthetic milk interval',()=>{
 for(const blocked of ['hunger','thirst'] as const){
  const f=built();
  // Counterexample setup, not simulated maturation or a full production interval.
  f.goat.hunger=0;f.goat.thirst=0;f.goat[blocked]=80;f.goat.progress=DAY-1;
  const inventory=structuredClone(f.owner.inventory);
  f.tick();
  assert.ok(f.goat[blocked]>79,blocked);
  assert.equal(f.goat.progress,DAY-1,blocked);assert.equal(f.goat.product,0,blocked);
  assert.equal(f.world.food!.lots['animal-stock:'+f.goatId],undefined);
  assert.equal(f.flows.length,0);assert.deepEqual(f.owner.inventory,inventory);
 }
});

test('independent pasture review: missing personal fodder and water cannot turn visible needs into free care',()=>{
 const f=built();f.owner.inventory.fodder=0;f.owner.inventory.water=0;
 const before=structuredClone(f.owner.inventory),goat=structuredClone(f.goat),trough=structuredClone(f.pasture.trough);
 const choices=f.menu();
 for(const operation of ['feedAnimal','waterAnimal'] as const){
  assert.equal(animalChoice(choices,operation,f.goatId),undefined);
  assert.match(industryTarget(f.world,f.owner,{type:'industry',operation,animalId:f.goatId}).error!,/本人实际/);
 }
 assert.ok(!choices.some(c=>c.action.type==='industry'&&c.action.operation==='fillTrough'&&c.action.pastureId===f.pasture.id));
 assert.match(industryTarget(f.world,f.owner,{type:'industry',operation:'fillTrough',pastureId:f.pasture.id}).error!,/本人实有清水/);
 assert.deepEqual(f.owner.inventory,before);assert.deepEqual(f.goat,goat);assert.deepEqual(f.pasture.trough,trough);
 f.tick(30);assert.deepEqual(f.owner.inventory,before);assert.equal(f.goat.lastCaredAt,undefined);assert.equal(f.flows.length,0);
});

test('independent pasture review: losing ownership blocks disposition and repair but not voluntary finite care',()=>{
 const f=built(),other=f.world.residents.find(r=>r.id!==f.ownerId)!;
 f.goat.ownerId=other.id;f.pasture.ownerId=other.id;
 const inventory=structuredClone(f.owner.inventory),condition=f.pasture.fence!.condition;
 assert.match(industryTarget(f.world,f.owner,{type:'industry',operation:'collectAnimal',animalId:f.goatId}).error!,/主人/);
 assert.match(industryTarget(f.world,f.owner,{type:'industry',operation:'repairFence',pastureId:f.pasture.id,minutes:30}).error!,/责任人/);
 for(const operation of ['feedAnimal','waterAnimal'] as const)
  assert.equal(industryTarget(f.world,f.owner,{type:'industry',operation,animalId:f.goatId}).error,undefined);
 assert.equal(industryTarget(f.world,f.owner,{type:'industry',operation:'fillTrough',pastureId:f.pasture.id}).error,undefined);
 assert.deepEqual(f.owner.inventory,inventory);assert.equal(f.pasture.fence!.condition,condition);
 assert.equal(f.goat.lastCaredAt,undefined);assert.equal(f.flows.length,0);
});

test('independent pasture review: in-flight numbered feeding resumes after SQLite reopen and consumes exactly once',t=>{
 const dir=mkdtempSync(join(testTmpdir(),'valley-pasture-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=new PastureFoodChain(join(dir,'review.sqlite')).build().seedAnimalsAndAdmit().breakFence();
 const opening=f.owner.inventory.fodder!;
 f.industry('feedAnimal',f.goatId,'feedAnimal',false);
 let limit=100;
 while(!f.owner.activity||f.owner.activity.path.length){assert.ok(limit-->0);f.tick();}
 f.tick();assert.ok(f.owner.activity);assert.ok(f.owner.activity.remaining>0);
 assert.equal(f.owner.inventory.fodder,opening);assert.equal(f.goat.lastCaredAt,undefined);
 const accepted=structuredClone(f.owner.activity),plan=structuredClone(f.owner.plan);
 f.reload();assert.deepEqual(f.owner.activity,accepted);assert.deepEqual(f.owner.plan,plan);
 f.finish();assert.equal(f.owner.inventory.fodder,opening-1);assert.ok(f.goat.lastCaredAt);
 assert.equal(f.goat.product,0);assert.equal(f.goat.progress,DAY-120);
 f.reload();f.tick(10);assert.equal(f.owner.inventory.fodder,opening-1);assert.equal(f.flows.length,0);
 assert.equal(f.world.events.filter(e=>e.animalIds?.includes(f.goatId)&&/自愿用本人饲料/.test(e.text)).length,1);
 assert.equal(f.selections.filter(s=>s.action.type==='industry'&&s.action.operation==='feedAnimal').length,1);
 assert.equal(f.world.metrics.requests,0);
});

test('independent pasture review: a previously numbered admission fails at execution after natural fence failure',()=>{
 const f=new PastureFoodChain().build().seedAnimalsAndAdmit();
 f.walk(f.owner,f.barn.door);
 const choices=f.menu(),choice=choices.find(c=>c.action.type==='industry'&&c.action.operation==='moveAnimal'&&c.action.animalId===f.newcomerId&&c.action.pastureId===f.pasture.id);
 assert.ok(choice,'admission must first be offered by the ordinary final numbered menu');
 const actions=parseChoice(JSON.stringify({choice:choice.id}),choices).actions;
 f.breakFence();
 const inventories=f.world.residents.map(r=>structuredClone(r.inventory));
 const location={at:f.newcomer.at,inside:f.newcomer.inside,barnId:f.newcomer.barnId};
 const result=submitPlan(f.world,{id:'independent-stale-admission',actorId:f.ownerId,actorRevision:f.owner.revision,
  createdAt:f.world.minute,definition:f.world.activeDefinitions['action/routine'],intention:'离线执行围栏损坏前已解析的编号入场选择',actions});
 assert.equal(result.ok,true,JSON.stringify(result));
 let limit=100;while(f.owner.plan||f.owner.activity){assert.ok(limit-->0);f.tick();}
 assert.match(f.owner.lastFailure??'',/可用的放牧位置/);
 assert.equal(f.newcomer.pastureId,undefined);assert.ok(!f.newcomer.carrierId);
 assert.deepEqual({at:f.newcomer.at,inside:f.newcomer.inside,barnId:f.newcomer.barnId},location);
 assert.deepEqual(f.world.residents.map(r=>r.inventory),inventories);
 assert.equal(f.pasture.fence!.condition,0);assert.equal(f.goat.pastureId,f.pasture.id);
 assert.equal(f.world.metrics.requests,0);assert.equal(f.flows.length,0);
});

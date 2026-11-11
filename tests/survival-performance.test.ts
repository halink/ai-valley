import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import type {Action,Resident,World} from '../src/shared/types.js';
import {hasTimelySelfRescue,stepWorld,submitPlan} from '../src/world/engine.js';
import {needHealthDrain} from '../src/world/decision-protection.js';
import {copyForSimulation} from '../src/world/simulation-copy.js';
import {attachReceiptHistory,firstReceipt,hasReceipt} from '../src/world/receipts.js';
import {survivalBenchmarkWorld,survivalScenarios} from './fixtures/survival-performance.js';

const menu=(w:World,r:Resident)=>decisionChoices(decisionContext(w,r)).map(c=>c.action);

test('simulation copies preserve data and independently own terrain and nested mutable state',()=>{
 const source=survivalBenchmarkWorld('hunger-exhaustion'),before=structuredClone(source);
 const copy=copyForSimulation(source),other=copyForSimulation(source);
 assert.deepEqual(copy,before);
 assert.notEqual(copy.map.tiles,source.map.tiles);
 copy.map.tiles[0]=source.map.tiles[0]==='cliff'?'grass':'cliff';
 copy.map.entrance.x++;
 copy.map.settlement!.y++;
 copy.residents[0].inventory.meal=99;
 copy.food!.lots['person:'+copy.residents[0].id].meal![0].expiresAt=0;
 copy.definitions[copy.activeDefinitions['action/routine']].data.copyOnly=true;
 copy.processed.push('copy-only');
 copy.events.length=0;
 assert.deepEqual(source,before);
 assert.deepEqual(other,before);
});

test('simulation copies preserve coordinate aliases between geography and actor state',()=>{
 const source=survivalBenchmarkWorld('carried-meal');
 source.residents[0].at=source.map.entrance;
 const copy=copyForSimulation(source);
 assert.equal(copy.residents[0].at,copy.map.entrance);
 assert.notEqual(copy.map.entrance,source.map.entrance);
 copy.residents[0].at.x++;
 assert.equal(copy.map.entrance.x,source.map.entrance.x+1);
});

test('large primitive terrain is copied without passing it through structuredClone',t=>{
 const source=survivalBenchmarkWorld('hunger-exhaustion'),clone=globalThis.structuredClone;
 let calls=0;
 t.mock.method(globalThis,'structuredClone',((value:World)=>{
  calls++;assert.equal(value.map.tiles.length,0);
  return clone(value);
 }) as typeof structuredClone);
 const copy=copyForSimulation(source);
 assert.equal(calls,1);
 assert.ok(source.map.tiles.length>100_000);
 assert.deepEqual(copy.map.tiles,source.map.tiles);
 assert.notEqual(copy.map.tiles,source.map.tiles);
});

test('simulation copies keep committed receipt checks but isolate pending receipts',()=>{
 const source=survivalBenchmarkWorld('carried-meal'),committed=['purchase:previous'];
 attachReceiptHistory(source,{has:receipt=>committed.includes(receipt),first:prefix=>committed.find(receipt=>receipt.startsWith(prefix))});
 const copy=copyForSimulation(source);
 assert.equal(hasReceipt(copy,'purchase:previous'),true);
 assert.equal(firstReceipt(copy,'purchase'),'purchase:previous');
 copy.processed.push('purchase:preview');
 assert.equal(hasReceipt(copy,'purchase:preview'),true);
 assert.equal(hasReceipt(source,'purchase:preview'),false);
 assert.deepEqual(committed,['purchase:previous']);
});

for(const scenario of survivalScenarios){
 test(`official-map ${scenario} forecast and protected tick leave the source untouched`,()=>{
  const source=survivalBenchmarkWorld(scenario),expected= !['no-food-source','service-leaves'].includes(scenario);
  const choices=menu(source,source.residents[0]),before=structuredClone(source);
  assert.equal(hasTimelySelfRescue(source,source.residents[0],choices),expected);
  assert.deepEqual(source,before);
  const ordinary=structuredClone(source),optimized=copyForSimulation(source);
  stepWorld(ordinary,1.2,{decisionChoices:menu});
  stepWorld(optimized,1.2,{decisionChoices:menu});
  assert.deepEqual(optimized,ordinary);
  assert.deepEqual(source,before);
  assert.equal(optimized.residents[0].decisionProtection?.endedAt===null,expected);
 });
}

for(const condition of ['meal-and-bed','spoiling-food','provider-stays','provider-leaves'] as const){
 test(`ordinary and optimized copies execute identical real ${condition} actions`,()=>{
  const provider=condition.startsWith('provider');
  const source=survivalBenchmarkWorld(provider?condition==='provider-stays'?'service-stays':'service-leaves':'hunger-exhaustion');
  if(condition==='spoiling-food')for(const lot of source.food!.lots['person:'+source.residents[0].id].meal!)lot.expiresAt=source.minute+1;
  const actions:Action[]=provider?[menu(source,source.residents[0]).find(a=>a.type==='publicDuty'&&a.operation==='receive')!]:[{type:'eat',item:'meal'},{type:'sleep',minutes:60}];
  assert.ok(actions[0]);
  const ordinary=structuredClone(source),optimized=copyForSimulation(source),before=structuredClone(source);
  for(const w of [ordinary,optimized]){
   const r=w.residents[0];
   assert.equal(submitPlan(w,{id:'actual-rescue',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'实际完成同一行动',actions:structuredClone(actions)}).ok,true);
  }
  for(let minute=0;minute<30;minute++){stepWorld(ordinary,1);stepWorld(optimized,1);}
  assert.deepEqual(optimized,ordinary);
  assert.deepEqual(source,before);
  const r=optimized.residents[0];
  if(condition==='meal-and-bed'){assert.ok(r.hunger<95);assert.ok(r.energy>source.residents[0].energy);assert.ok(r.health>0);assert.deepEqual(needHealthDrain(optimized,r),{hunger:0,exhaustion:0});}
  else if(condition==='provider-stays')assert.ok(r.hunger<95);
  else assert.ok(r.lastFailure);
 });
}

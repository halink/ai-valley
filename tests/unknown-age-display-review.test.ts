import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext,prepareModelDecision} from '../src/server/decisions.js';
import {personalObservations} from '../src/server/personal-observations.js';
import {QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL} from '../src/server/model-completion.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {headcount} from '../src/shared/demography.js';

import {createFrontierWorld} from '../src/world/formal-seed.js';
import {YEAR} from '../src/world/time.js';
import type {Resident,Snapshot} from '../src/shared/types.js';
import type {Biography} from '../src/shared/history.js';

const models=[QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL] as const;
const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){const w=createFrontierWorld(5401),[actor,,child]=w.residents;decisionContext(w,actor);return {w,actor,child};}
function birth(r:Resident,value:unknown){r.bornAt=value as number;}
function snap():Snapshot{const {w}=fixture();return {world:w,mapRevision:'review-map',version:'review',serverTime:'review',capabilities:{active:[],pending:[]}};}

for(const [name,bad] of [['null',null],['NaN',NaN],['undefined',undefined],['future',1e8]] as const){
 test(`review: ${name} plus stale infancy retains registration without remote body or stock disclosure`,()=>{
  const {w,actor,child}=fixture();birth(child,bad);child.lifeStage='infant';child.at={x:actor.at.x+30,y:actor.at.y};
  child.hunger=97.314159;child.health=11.271828;child.inventory.meal=654321;child.inventory.water=765432;
  decisionContext(w,actor);const before=structuredClone(w),c=decisionContext(w,actor);
  assert.match(personalObservations(w,actor),new RegExp(child.name+'（年龄未知）'));
  assert.equal(c.people.some(p=>p.id===child.id),false);
  for(const model of models){const text=prepareModelDecision(c,undefined,model).messages.map(m=>m.content).join('\n');
   assert.match(text,/年龄未知/);assert.match(text,/不能从登记或亲属关系推断远处情况/);
   assert.doesNotMatch(text,/97\.314159|11\.271828|654321|765432|幼儿喂养需要/);
  }
  assert.deepEqual(w,before);
 });
 test(`review: ${name} JSON transition clears known age across observer delta and reconnect`,async()=>{
  let server=snap();const id=server.world.residents[0].id;server.world.residents[0].bornAt=server.world.minute-30*YEAR;
  let client=json(server);
  await settle();
  for(const value of [bad,server.world.minute,server.world.minute-30*YEAR]){
   const next=structuredClone(server);birth(next.world.residents[0],value);next.world.revision++;
   const wire=json(observerFrame(next,server));const merged=applyObserverUpdate(client,wire)!;
   assert.deepEqual(merged,json(next));
   if(value===undefined){assert.equal(Object.hasOwn(merged.world.residents[0],'bornAt'),false);assert.equal(wire.changes!.residents!.upsert.some(r=>r.id===id),true);}
   assert.deepEqual(applyObserverUpdate(client,json(observerFrame(next))),json(next),'reconnect baseline agrees with delta');
   await settle();

   await settle();client=merged;server=next;
  }

 });
}

test('review: modern explicit unknown beats legacy positive age; display metadata cannot change final menu',()=>{
 const {w,actor}=fixture(),c=decisionContext(w,actor),original=structuredClone(c),choices=decisionChoices(c);
 for(const value of [null,undefined,NaN,Infinity,-1]){
  c.formal!.knownAge=value as number|null;
  for(const model of models)assert.match(prepareModelDecision(c,undefined,model).messages[0].content,new RegExp('你是居民'+actor.name+'，年龄未知'));
  assert.deepEqual(decisionChoices(c),choices);assert.equal(c.formal!.sleepRecoveryPerHour,original.formal!.sleepRecoveryPerHour);
 }
 delete c.formal!.knownAge;
 for(const model of models)assert.match(prepareModelDecision(c,undefined,model).messages[0].content,new RegExp('你是居民'+actor.name+'，'+c.formal!.age+'岁'));
 assert.deepEqual(decisionChoices(c),choices);
 assert.equal(Object.hasOwn(actor,'knownAge'),false,'display metadata is not a persisted Resident property');
});

test('review: census unknown bucket changes neither headcount nor population book',()=>{
 const {w,actor}=fixture();const resident=(id:string,bornAt:unknown,extra:Partial<Resident>={}):Resident=>Object.assign(structuredClone(actor),{id,bornAt},extra);
 w.residents=[resident('newborn',w.minute),resident('adult',w.minute-18*YEAR),resident('elder',w.minute-65*YEAR),
  resident('unknown',undefined),resident('visitor',null,{residency:'visitor'}),resident('outside',NaN,{residency:'outside'}),resident('dead',null,{status:'dead'})];
 const before=structuredClone(w),count=headcount(w);
 assert.deepEqual(count,{residents:4,visitors:1});
 assert.deepEqual(w,before);
});

test('review: actual fractional sixth birthday removes infant advice; stage does not decide age label',()=>{
 const {w,actor,child}=fixture();child.bornAt=121440.001;child.lifeStage='infant';child.hunger=90;child.at={...actor.at};
 for(const [minute,years,feeding] of [[child.bornAt,0,true],[child.bornAt+6*YEAR-.25,5,true],[child.bornAt+6*YEAR,6,false]] as const){
  w.minute=minute;const c=decisionContext(w,child);
  assert.equal(c.formal!.knownAge,years);
  for(const model of models)assert.match(prepareModelDecision(c,undefined,model).messages[0].content,new RegExp('你是居民'+child.name+'，'+years+'岁'));
  const notes=personalObservations(w,actor);assert.equal(notes.includes('幼儿喂养需要'),feeding);
 }
});

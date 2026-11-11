import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decisionChoices,decisionContext,prepareModelDecision,prompt} from '../src/server/decisions.js';
import {personalObservations} from '../src/server/personal-observations.js';
import {DEEPSEEK_MODEL,GLM_MODEL,QWEN_MODEL} from '../src/server/model-completion.js';
import {WorldStore} from '../src/server/store.js';
import {ValleyRuntime} from '../src/server/runtime.js';
import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {censusPanel} from '../src/client/community.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {ageYears,knownAgeYears,YEAR} from '../src/world/time.js';
import type {DecisionContext,Resident,World} from '../src/shared/types.js';

const models=[QWEN_MODEL,DEEPSEEK_MODEL,GLM_MODEL] as const;
const invalid:Array<[string,(w:World)=>unknown]>=[['null',()=>null],['NaN',()=>NaN],['future',w=>w.minute+.25],['missing',()=>undefined],['string',()=>'-100'],['infinity',()=>Infinity],['unsafe',()=>-Number.MAX_SAFE_INTEGER-1]];
const json=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function fixture(){
 const w=createFrontierWorld(5401),[guardian,,child]=w.residents;
 child.bornAt=w.minute-2*YEAR;child.canDecide=child.canExpress=false;child.hunger=93.123;child.health=17.345;
 // Existing opportunity builders lazily install subsystem definitions. Warm
 // those once before checking that the display changes add no state writes.
 decisionContext(w,guardian);
 return {w,guardian,child};
}
function corrupt(r:Resident,value:unknown){r.bornAt=value as number;}
function registration(note:string,name:string){return note.slice(note.indexOf('你登记监护'+name));}

for(const [label,bad] of invalid)test(`unknown age display: ${label} keeps personal registration without inventing infancy or remote signs`,()=>{
 const {w,guardian,child}=fixture();corrupt(child,bad(w));const before=structuredClone(w);
 const close=registration(personalObservations(w,guardian),child.name);
 assert.match(close,/年龄未知/);assert.doesNotMatch(close,/（0岁）|幼儿喂养|93\.123|17\.345/);
 assert.match(close,/明显饥饿迹象/);assert.deepEqual(w,before);
 child.at={x:guardian.at.x+20,y:guardian.at.y};
 const away=registration(personalObservations(w,guardian),child.name);
 assert.match(away,/年龄未知/);assert.match(away,/不能从登记或亲属关系推断远处情况/);
 assert.doesNotMatch(away,/幼儿喂养|明显饥饿|身体显得虚弱|93\.123|17\.345/);
 const c=decisionContext(w,guardian);assert.equal(c.people.some(p=>p.id===child.id),false);
 for(const model of models){const text=prepareModelDecision(c,undefined,model).messages[0].content;
  assert.match(text,/年龄未知/);assert.doesNotMatch(text,new RegExp(child.name+'（0岁）'));assert.doesNotMatch(text,/幼儿喂养需要|93\.123|17\.345/);
 }
});

for(const [label,bad] of invalid)test(`unknown age display: ${label} self context and all prompts are explicit without changing menu filtering`,()=>{
 const {w,guardian}=fixture();corrupt(guardian,bad(w));const before=structuredClone(w),c=decisionContext(w,guardian);
 for(const model of models){const prepared=prepareModelDecision(c,undefined,model);assert.match(prepared.messages[0].content,new RegExp('你是居民'+guardian.name+'，年龄未知'));
  assert.doesNotMatch(prepared.messages[0].content,new RegExp('你是居民'+guardian.name+'，0岁'));
 }
 assert.equal(c.formal!.age,0,'the existing action-gating compatibility value is unchanged');
 const legacy=structuredClone(c);delete (legacy.formal as unknown as {knownAge?:number|null}).knownAge;
 assert.deepEqual(decisionChoices(c),decisionChoices(legacy),'display-only age must not alter action choices');
 assert.equal(c.formal!.sleepRecoveryPerHour,legacy.formal!.sleepRecoveryPerHour);
 assert.equal(ageYears(guardian.bornAt,w.minute),0);assert.equal(knownAgeYears(guardian.bornAt,w.minute),null);
 assert.deepEqual(w,before,'context, prompt and read-only summaries do not repair a date or rewrite authority');
});

test('unknown age display: genuine newborn and ordinary ages retain known labels and infant advice',()=>{
 const {w,guardian,child}=fixture();child.bornAt=w.minute;
 assert.match(personalObservations(w,guardian),new RegExp(child.name+'（0岁）'));assert.match(personalObservations(w,guardian),/幼儿喂养需要/);
 assert.match(prompt(decisionContext(w,child),[])[0].content,new RegExp('你是居民'+child.name+'，0岁'));
 for(const years of [5.5,6,13,18,30,65]){
  child.bornAt=w.minute-years*YEAR;const c=decisionContext(w,child);
  assert.equal(c.formal!.age,Math.floor(years));assert.match(prompt(c,[])[0].content,new RegExp('你是居民'+child.name+'，'+Math.floor(years)+'岁'));
  const note=registration(personalObservations(w,guardian),child.name);
  if(years<6)assert.match(note,/幼儿喂养需要/);else assert.doesNotMatch(note,/幼儿喂养需要/);
 }
});

test('unknown age display: exact fractional birthday is not shown early or rounded down at the birthday',()=>{
 const {w,guardian,child}=fixture();child.bornAt=121440.001;
 for(const years of [6,18]){
  const birthday=child.bornAt+years*YEAR;
  w.minute=birthday-.25;assert.match(prompt(decisionContext(w,child),[])[0].content,new RegExp('，'+(years-1)+'岁'));
  if(years===6)assert.match(personalObservations(w,guardian),/幼儿喂养需要/);
  w.minute=birthday;assert.match(prompt(decisionContext(w,child),[])[0].content,new RegExp('，'+years+'岁'));
  assert.doesNotMatch(personalObservations(w,guardian),/幼儿喂养需要/);
 }
});

test('unknown age display: legacy decision contexts remain usable and malformed legacy display ages stay unknown',()=>{
 const {w,guardian}=fixture(),c=decisionContext(w,guardian),formal=c.formal! as DecisionContext['formal']&{knownAge?:number|null};
 delete formal!.knownAge;
 for(const age of [0,18,65]){formal!.age=age;assert.match(prompt(c,[])[0].content,new RegExp('，'+age+'岁'));}
 for(const age of [null,undefined,NaN,Infinity,-1]){formal!.age=age as number;assert.match(prompt(c,[])[0].content,/年龄未知/);assert.doesNotMatch(prompt(c,[])[0].content,/，(?:null|undefined|NaN|Infinity|-1)岁/);}
});

for(const [label,bad] of invalid.filter(([label])=>['null','NaN','future','missing'].includes(label)))test(`unknown age display: ${label} survives synthetic SQLite and JSON observer baseline, delta and reconnect`,()=>{
 const {w,child}=fixture(),store=new WorldStore(':memory:');
 try{
  store.commit(w,null);const runtime=new ValleyRuntime(store,null,undefined,{mode:'formal'}),person=runtime.world.residents.find(r=>r.id===child.id)!;
  const first=json(runtime.snapshot());assert.doesNotMatch(censusPanel(first.world),/年龄未知 [1-9]/);
  corrupt(person,bad(runtime.world));runtime.world.revision++;
  const changed=runtime.snapshot(),delta=json(observerFrame(changed,first)),merged=applyObserverUpdate(first,delta)!;
  assert.deepEqual(merged,json(changed));assert.match(censusPanel(merged.world),/年龄未知 1 人/);
  assert.deepEqual(applyObserverUpdate(first,json(observerFrame(changed))),json(changed));
  store.commit(runtime.world,w.revision+1);const loaded=store.load()!,loadedChild=loaded.residents.find(r=>r.id===child.id)!;
  assert.equal(knownAgeYears(loadedChild.bornAt,loaded.minute),null);assert.match(censusPanel(loaded),/年龄未知 1 人/);
  assert.equal(loadedChild.lifeStage,person.lifeStage);assert.deepEqual(loadedChild.guardianIds,person.guardianIds);
  assert.equal(loadedChild.canDecide,person.canDecide);assert.equal(loadedChild.canExpress,person.canExpress);
  person.bornAt=runtime.world.minute;runtime.world.revision++;const recovered=json(runtime.snapshot());
  assert.deepEqual(applyObserverUpdate(merged,json(observerFrame(recovered,merged))),recovered);
  assert.match(censusPanel(recovered.world),/年龄未知 0 人/);
  assert.match(personalObservations(runtime.world,runtime.world.residents[0]),new RegExp(person.name+'（0岁）'));
 }finally{store.close();}
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {join} from 'node:path';

import {decisionChoices,decisionContext} from '../src/server/decisions.js';
import {HistoryQueryError,historyKey,normalizeHistory,parseHistoryQuery} from '../src/server/history-query.js';
import {WorldStore} from '../src/server/store.js';
import type {HistoryPage} from '../src/shared/history.js';
import type {World,WorldEvent} from '../src/shared/types.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {recordLivestockDeath} from '../src/world/livestock-life.js';
import {createWorld} from '../src/world/seed.js';

function fixture(){const w=createWorld();w.mode='formal';w.events=[];return w;}
function fact(w:World,id:string,extra:Partial<WorldEvent>={}):WorldEvent{
 return {id,at:w.minute,kind:'hazard',actors:[],place:{x:1,y:1},text:'原始动物事件 '+id,witnesses:[],...extra};
}

test('animal history uses exact recorded identities, de-duplicates shared events and combines existing filters',()=>{
 const w=fixture(),[r,other]=w.residents,store=new WorldStore(':memory:');
 w.events=[fact(w,'birth',{animalIds:['cub','mother','cub'],at:10}),fact(w,'similar',{animalIds:['cub-other'],at:11}),
  fact(w,'prose',{text:'cub 在远方出现',at:12}),fact(w,'care',{animalIds:['cub'],actors:[r.id],kind:'care',at:13}),
  fact(w,'fish-migration',{animalIds:['shoal:1,2','shoal:2,2'],at:14})];
 try{store.commit(w,null);const before=JSON.stringify(w);
  assert.deepEqual(store.historyPage(w.id,{animalId:'cub'}).events.map(e=>e.id),['care','birth']);
  assert.deepEqual(store.historyPage(w.id,{animalId:'mother'}).events.map(e=>e.id),['birth']);
  assert.deepEqual(store.historyPage(w.id,{animalId:'cub',personId:r.id,kind:'care',from:13,to:14,q:'care'}).events.map(e=>e.id),['care']);
  assert.equal(store.historyPage(w.id,{animalId:'cub',personId:other.id}).events.length,0);
  assert.equal(store.historyPage(w.id,{animalId:'cub',waterOnly:true}).events.length,0);
  assert.equal(store.historyPage(w.id,{animalId:'cub',populationOnly:true}).events.length,0);
  for(const id of ['shoal:1,2','shoal:2,2'])assert.deepEqual(store.historyPage(w.id,{animalId:id}).events.map(e=>e.id),['fish-migration']);
  assert.equal(store.historyPage(w.id,{animalId:'1,2'}).events.length,0);
  assert.equal(store.historyPage(w.id,{animalId:"cub' OR 1=1 --"}).events.length,0);
  assert.equal(JSON.stringify(w),before,'history reads do not deliver knowledge or change animals');
 }finally{store.close();}
});

test('animal pagination retains same-minute history while appending new events and binds cursors to the exact animal',()=>{
 const w=fixture(),store=new WorldStore(':memory:');
 w.events=Array.from({length:133},(_,i)=>fact(w,'animal-fact-'+i,{animalIds:['animal:a']}));
 try{store.commit(w,null);const head=store.historyPage(w.id,{animalId:'animal:a',limit:17});
  const previous=w.revision++;w.events.push(fact(w,'new-head',{animalIds:['animal:a']}));store.commit(w,previous);
  const ids=head.events.map(e=>e.id);let cursor=head.nextCursor;
  while(cursor){const page=store.historyPage(w.id,{animalId:'animal:a',limit:17,cursor});ids.push(...page.events.map(e=>e.id));cursor=page.nextCursor;}
  assert.equal(ids.length,133);assert.equal(new Set(ids).size,133);assert.ok(!ids.includes('new-head'));
  assert.equal(store.historyPage(w.id,{animalId:'animal:a'}).events[0].id,'new-head');
  for(const query of [{},{animalId:'animal:b'},{animalId:'animal:a',q:'animal'}])
   assert.throws(()=>store.historyPage(w.id,{...query,cursor:head.nextCursor!}),HistoryQueryError);
 }finally{store.close();}
});

test('animal query validates identities and leaves pre-existing plain and water cursor keys unchanged',()=>{
 assert.equal(parseHistoryQuery(new URLSearchParams('animal=shoal%3A1%2C2')).animalId,'shoal:1,2');
 for(const query of ['animal=','animal=%20','animal=a&animal=b','animal='+('a'.repeat(181))])
  assert.throws(()=>parseHistoryQuery(new URLSearchParams(query)),HistoryQueryError);
 assert.throws(()=>normalizeHistory({animalId:5} as never),HistoryQueryError);
 for(const waterOnly of [false,true]){
  const q=normalizeHistory({personId:'person',waterOnly});
  const old=createHash('sha256').update(JSON.stringify([q.personId,q.kind,q.conversationId,q.q,q.from,q.to,q.populationOnly,...(waterOnly?['water']:[])])).digest('base64url');
  assert.equal(historyKey(q),old);
 }
});

test('legacy animal indexing preserves raw event bytes, is idempotent, ignores untagged prose and rolls back with failed commits',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'animal-history-migration-')),path=join(dir,'synthetic.sqlite'),w=fixture();
 const events=[fact(w,'tagged',{animalIds:['old-duck','old-duck']}),fact(w,'untagged',{text:'old-duck'}),
  {...fact(w,'invalid-scalar'),animalIds:'old-duck'}];
 let store:WorldStore|undefined;
 try{const db=new DatabaseSync(path);db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,at REAL NOT NULL,body TEXT NOT NULL)');
  for(const e of events)db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(e.id,w.id,e.at,JSON.stringify(e));db.close();
  store=new WorldStore(path);assert.deepEqual(store.historyPage(w.id,{animalId:'old-duck'}).events.map(e=>e.id),['tagged']);
  store.commit(w,null);store.close();store=undefined;store=new WorldStore(path);
  const sql=new DatabaseSync(path);try{
   for(const e of events)assert.equal((sql.prepare('SELECT body FROM events WHERE id=?').get(e.id) as {body:string}).body,JSON.stringify(e));
   assert.equal((sql.prepare('SELECT count(*) AS n FROM event_animals').get() as {n:number}).n,1);
   sql.exec("CREATE TRIGGER fail_animal_history BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'animal_history_test_failure'); END");
   const previous=w.revision++;w.events.push(fact(w,'failed-append',{animalIds:['old-duck']}));
   assert.throws(()=>store!.commit(w,previous),/animal_history_test_failure/);
   assert.equal((sql.prepare("SELECT count(*) AS n FROM event_animals WHERE event_id='failed-append'").get() as {n:number}).n,0);
   assert.equal(store.historyPage(w.id,{animalId:'old-duck'}).events.length,1);
  }finally{sql.close();}
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('actual wild duck taming and death stay in one archive after restart and loss of current animal state',()=>{
 const w=createFrontierWorld(),s=w.frontierHazards!,duck=s.beasts.find(n=>n.species==='duck')!;
 const barn=w.buildings.find(b=>b.id==='frontier-barn')!,owner=w.residents.find(r=>r.id===barn.ownerId)!;
 w.events=[];w.clock.paused=false;s.nextDisasterAt=1e12;
 for(const r of w.residents)r.inside=r.homeId;for(const b of s.beasts)b.nextMoveAt=w.minute+10000;
 owner.at={...s.shore!};owner.inside=null;owner.knownBuildings.push(barn.id);owner.inventory.fodder=2;
 duck.at={...owner.at};duck.hunger=42;duck.nextMoveAt=w.minute+5;
 const wild=emitLedgerEvent(w,{kind:'hazard',actors:[],animalIds:[duck.id],place:{...duck.at},text:'合成测试中留存的野鸭实地状态'});
 const choice=decisionChoices(decisionContext(w,owner)).find(c=>c.action.type==='industry'&&c.action.operation==='tameAnimal');assert.ok(choice);
 assert.equal(submitPlan(w,{id:'history-taming',actorId:owner.id,actorRevision:owner.revision,createdAt:w.minute,
  definition:w.activeDefinitions['action/routine'],intention:'用饲料驯养近处的野鸭',actions:[choice.action]}).ok,true);stepWorld(w,27);
 const animal=w.industry!.animals.find(n=>n.id===duck.id)!;assert.ok(animal);
 const tame=w.events.find(e=>e.animalIds?.includes(duck.id)&&e.text.includes('驯养'))!;assert.ok(tame);

 recordLivestockDeath(w,animal,'合成测试中的已记录死亡');const death=w.events.at(-1)!;
 const dir=mkdtempSync(join(testTmpdir(),'animal-history-restart-')),path=join(dir,'synthetic.sqlite');let store=new WorldStore(path);
 try{store.commit(w,null);const previous=w.revision;w.minute+=1000;
  for(const r of w.residents)r.memories=[];
  for(let i=0;i<200;i++)emitLedgerEvent(w,{kind:'system',actors:[],place:{x:0,y:0},text:'另一条无关的留存记录'});
  w.industry!.animals=w.industry!.animals.filter(n=>n.id!==duck.id);store.commit(w,previous);store.close();store=new WorldStore(path);
  const restored=store.loadForRuntime()!;assert.ok(!restored.events.some(e=>e.id===wild.id||e.id===tame.id||e.id===death.id));
  const before=JSON.stringify(restored),memory=JSON.stringify(restored.residents.map(r=>r.memories));
  const history=store.historyPage(w.id,{animalId:duck.id}).events;
  for(const e of [wild,tame,death])assert.deepEqual(history.find(x=>x.id===e.id),e);

  assert.equal(JSON.stringify(restored),before);assert.equal(JSON.stringify(restored.residents.map(r=>r.memories)),memory);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

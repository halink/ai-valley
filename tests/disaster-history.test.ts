import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';

import {HistoryQueryError,historyKey,normalizeHistory,parseHistoryQuery} from '../src/server/history-query.js';
import {createObserverServer} from '../src/server/http.js';
import type {ValleyRuntime} from '../src/server/runtime.js';
import {WorldStore} from '../src/server/store.js';
import type {HistoryPage} from '../src/shared/history.js';
import type {World,WorldEvent} from '../src/shared/types.js';
import {emitLedgerEvent} from '../src/world/events.js';
import {createWorld} from '../src/world/seed.js';

function fixture(){const w=createWorld();w.mode='formal';w.events=[];return w;}
function fact(w:World,id:string,extra:Partial<WorldEvent>={}):WorldEvent{
 return {id,at:w.minute,kind:'hazard',actors:[],place:{x:1,y:1},text:'留存灾害原文 '+id,witnesses:[],hazardFact:{disasterId:'flood:one',phase:'damage'},...extra};
}

test('disaster pages match only the explicit exact identity, across event kinds and combined filters',()=>{
 const w=fixture(),store=new WorldStore(':memory:'),person=w.residents[0].id;
 w.events=[fact(w,'one',{kind:'care',actors:[person],animalIds:['duck'],at:4,hazardFact:{disasterId:'flood:one',phase:'retreat'}}),
  fact(w,'two',{at:4,hazardFact:{disasterId:'flood:one-more',phase:'repair'}}),
  fact(w,'three',{at:4,hazardFact:undefined,text:'flood:one 地点和时间相同，不代表因果'}),
  fact(w,'four',{at:8,hazardFact:{disasterId:'flood:one',phase:'repair'}})];
 try{store.commit(w,null);const before=JSON.stringify(w);
  assert.deepEqual(store.historyPage(w.id,{disasterId:'flood:one'}).events.map(e=>e.id),['four','one']);
  assert.deepEqual(store.historyPage(w.id,{disasterId:'flood:one',personId:person,animalId:'duck',kind:'care',from:4,to:5}).events.map(e=>e.id),['one']);
  assert.equal(store.historyPage(w.id,{disasterId:"flood:one%' OR 1=1 --"}).events.length,0);
  assert.equal(store.historyPage('another-world',{disasterId:'flood:one'}).events.length,0);
  assert.equal(JSON.stringify(w),before);
 }finally{store.close();}
});

test('persistent disaster pages outlive the 180-event window and current disaster state, with stable insertion-order pagination',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'disaster-history-')),path=join(dir,'synthetic.sqlite'),w=fixture();let store=new WorldStore(path);

 const phases: Array<NonNullable<WorldEvent['hazardFact']>['phase']>=['warning','active','ended','damage','injury','retreat','shelter','repair'];
 const linked=Array.from({length:137},(_,i)=>fact(w,'chain:'+i,{at:i%3,hazardFact:{disasterId:'flood:one',phase:phases[i%phases.length]}}));
 try{w.events=linked.slice();store.commit(w,null);const before=w.revision;w.minute+=10000;
  for(const r of w.residents)r.memories=[];
  for(let i=0;i<210;i++)emitLedgerEvent(w,{kind:'system',actors:[],place:{x:0,y:0},text:'无关记录 '+i});
  delete w.frontierHazards;store.commit(w,before);store.close();store=new WorldStore(path);
  const restored=store.loadForRuntime()!;assert.ok(!restored.events.some(e=>e.id.startsWith('chain:')));
  const first=store.historyPage(w.id,{disasterId:'flood:one',limit:17});
  const previous=w.revision++;w.events.push(fact(w,'new-after-head'));store.commit(w,previous);
  const read=first.events.slice();let cursor=first.nextCursor;
  while(cursor){const page=store.historyPage(w.id,{disasterId:'flood:one',limit:17,cursor});read.push(...page.events);cursor=page.nextCursor;}
  assert.deepEqual(read,[...linked].reverse());assert.equal(new Set(read.map(e=>e.id)).size,137);
  assert.equal(store.historyPage(w.id,{disasterId:'flood:one'}).events[0].id,'new-after-head');

 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('disaster query validation binds cursors to exact disaster, world and filters while preserving old non-disaster keys',()=>{
 assert.equal(parseHistoryQuery(new URLSearchParams('disaster=flood%3Aone')).disasterId,'flood:one');
 for(const query of ['disaster=','disaster=%20','disaster=a&disaster=b','disaster='+'a'.repeat(181)])assert.throws(()=>parseHistoryQuery(new URLSearchParams(query)),HistoryQueryError);
 assert.throws(()=>normalizeHistory({disasterId:123 as unknown as string}),HistoryQueryError);
 const w=fixture(),store=new WorldStore(':memory:');
 try{w.events=[fact(w,'a'),fact(w,'b')];store.commit(w,null);const cursor=store.historyPage(w.id,{disasterId:'flood:one',limit:1}).nextCursor!;
  for(const [worldId,q] of [[w.id,{}],[w.id,{disasterId:'flood:two'}],['other-world',{disasterId:'flood:one'}],[w.id,{disasterId:'flood:one',kind:'hazard' as const}]] as const)assert.throws(()=>store.historyPage(worldId,{...q,cursor}),HistoryQueryError);
  for(const waterOnly of [false,true]){const q=normalizeHistory({personId:'p',animalId:'a',waterOnly});const expected=createHash('sha256').update(JSON.stringify([q.personId,q.kind,q.conversationId,q.q,q.from,q.to,q.populationOnly,...(waterOnly?['water']:[]),...['animal','a']])).digest('base64url');assert.equal(historyKey(q),expected);
  }
 }finally{store.close();}
});

test('legacy disaster index does not rewrite event bodies; index additions roll back with failed world commits',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'disaster-index-')),path=join(dir,'synthetic.sqlite'),w=fixture();let store:WorldStore|undefined;
 const events=[fact(w,'legacy'),fact(w,'prose',{hazardFact:undefined,text:'flood:one'}),fact(w,'numeric',{hazardFact:{disasterId:7 as unknown as string,phase:'damage'}})];
 try{const db=new DatabaseSync(path);db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,at REAL NOT NULL,body TEXT NOT NULL)');
  for(const event of events)db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(event.id,w.id,event.at,JSON.stringify(event));db.close();
  store=new WorldStore(path);store.commit(w,null);store.close();store=new WorldStore(path);
  assert.deepEqual(store.historyPage(w.id,{disasterId:'flood:one'}).events.map(e=>e.id),['legacy']);assert.equal(store.historyPage(w.id,{disasterId:'7'}).events.length,0);
  const sql=new DatabaseSync(path);try{for(const event of events)assert.equal((sql.prepare('SELECT body FROM events WHERE id=?').get(event.id) as {body:string}).body,JSON.stringify(event));
   const plan=sql.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM events WHERE world_id=? AND json_extract(body,'$.hazardFact.disasterId')=? AND rowid<? ORDER BY rowid DESC LIMIT 61").all(w.id,'flood:one',9999);assert.match(JSON.stringify(plan),/event_disaster/);
   sql.exec("CREATE TRIGGER fail_disaster BEFORE UPDATE ON worlds BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END");const previous=w.revision++;w.events.push(fact(w,'failed'));assert.throws(()=>store!.commit(w,previous),/synthetic_failure/);
   assert.ok(!store.historyPage(w.id,{disasterId:'flood:one'}).events.some(e=>e.id==='failed'));
  }finally{sql.close();}
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('disaster HTTP route uses current-world stored history and remains GET/HEAD only without opening a socket',()=>{
 const w=fixture(),store=new WorldStore(':memory:');w.events=[fact(w,'http-linked')];store.commit(w,null);
 const runtime={world:w,subscribe:()=>()=>{}} as unknown as ValleyRuntime,server=createObserverServer(runtime,store,'/unused-static');
 const request=(url:string,method='GET')=>{let status=0,body='';const res={setHeader(){},writeHead(code:number){status=code;},end(value?:string){body=value??'';}};server.emit('request',{url,method,headers:{}},res);return {status,body};};
 try{const before=JSON.stringify(w),page=request('/ai-town/api/history/page?disaster=flood%3Aone');assert.equal(page.status,200);assert.equal(JSON.parse(page.body).events[0].id,'http-linked');
  assert.equal(request('/ai-town/api/history/page?disaster=x&disaster=y').status,400);assert.equal(request('/ai-town/api/history/page?disaster=missing').status,200);
  assert.deepEqual(request('/ai-town/api/history/page?disaster=flood%3Aone','HEAD'),{status:200,body:''});
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(request('/ai-town/api/history/page?disaster=flood%3Aone',method).status,405);
  assert.equal(JSON.stringify(w),before);
 }finally{server.emit('close');store.close();}
});

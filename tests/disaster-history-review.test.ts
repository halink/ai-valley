import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {HistoryQueryError,historyKey,normalizeHistory,parseHistoryQuery} from '../src/server/history-query.js';

import {createWorld} from '../src/world/seed.js';
import type {WorldEvent} from '../src/shared/types.js';
const event=(id:string,disasterId?:string,at=1):WorldEvent=>({id,at,kind:'hazard',actors:[],witnesses:[],place:{x:1,y:1},text:'原始记录 '+id,...(disasterId===undefined?{}:{hazardFact:{disasterId,phase:'damage'}})});

test('independent review: exact identity, insertion pagination and immutable legacy bytes survive reopen',()=>{
 const dir=mkdtempSync(join(testTmpdir(),'disaster-review-')),path=join(dir,'synthetic.sqlite'),w=createWorld();w.events=[];
 const records=[event('first','灾害:a',900),event('same-place-prose',undefined,900),event('prefix','灾害:a-extra',900),event('second','灾害:a',10),event('third','灾害:a',10)];
 records[1].text='灾害:a at the same place';
 const raw=records.map(e=>JSON.stringify(e,null,2));let store:WorldStore|undefined;
 try{
  const db=new DatabaseSync(path);db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,at REAL NOT NULL,body TEXT NOT NULL)');
  records.forEach((e,i)=>db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(e.id,w.id,e.at,raw[i]));db.close();
  store=new WorldStore(path);const head=store.historyPage(w.id,{disasterId:'灾害:a',limit:1});assert.deepEqual(head.events.map(e=>e.id),['third']);
  assert.throws(()=>store!.historyPage(w.id,{disasterId:'灾害:b',cursor:head.nextCursor!}),HistoryQueryError);
  assert.throws(()=>store!.historyPage(w.id,{cursor:head.nextCursor!}),HistoryQueryError);
  store.close();store=new WorldStore(path);
  const sql=new DatabaseSync(path);sql.prepare('INSERT INTO events VALUES(?,?,?,?)').run('new',w.id,0,JSON.stringify(event('new','灾害:a',0)));
  const older=store.historyPage(w.id,{disasterId:'灾害:a',limit:10,cursor:head.nextCursor!});assert.deepEqual(older.events.map(e=>e.id),['second','first']);
  assert.equal(store.historyPage(w.id,{disasterId:'灾害:a'}).events[0].id,'new');
  records.forEach((e,i)=>assert.equal((sql.prepare('SELECT body FROM events WHERE id=?').get(e.id) as {body:string}).body,raw[i]));sql.close();
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('independent review: disaster query rejects ambiguous identities and preserves old cursor hashes',()=>{
 for(const query of ['disaster=','disaster=%20','disaster=a&disaster=b','disaster='+ 'x'.repeat(181)])assert.throws(()=>parseHistoryQuery(new URLSearchParams(query)),HistoryQueryError);
 assert.equal(parseHistoryQuery(new URLSearchParams('disaster=a%26b')).disasterId,'a&b');
 for(const animalId of [undefined,'animal'])for(const waterOnly of [false,true]){
  const q=normalizeHistory({animalId,waterOnly,personId:'p'});
  const expected=createHash('sha256').update(JSON.stringify([q.personId,q.kind,q.conversationId,q.q,q.from,q.to,q.populationOnly,...(waterOnly?['water']:[]),...(animalId?['animal',animalId]:[])])).digest('base64url');assert.equal(historyKey(q),expected);
 }
});

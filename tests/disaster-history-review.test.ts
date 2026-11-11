import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testTmpdir} from '../scripts/repository-temporary.mjs';
import {WorldStore} from '../src/server/store.js';
import {HistoryQueryError,historyKey,normalizeHistory,parseHistoryQuery} from '../src/server/history-query.js';
import {disasterEventDetails,disasterHistoryOverview} from '../src/client/disaster-history.js';
import {archiveTimeline} from '../src/client/history.js';
import {weatherHazardsPanel} from '../src/client/weather-hazards.js';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot,WorldEvent} from '../src/shared/types.js';
import {clientMainHarness} from './helpers/client-main.js';
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
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

test('independent review: missing facts remain unknown, historical entry escapes IDs and rendering is read-only',()=>{
 const w=createWorld();w.events=[event('record','a"><script>')];w.frontierHazards=undefined;const before=JSON.stringify(w);
 const html=disasterHistoryOverview(w,'a"><script>')+archiveTimeline(w.events,w)+weatherHazardsPanel(w);
 assert.match(html,/当前状态未知/);assert.match(html,/未记录具体对象/);assert.match(html,/不能当作零损害/);assert.match(html,/data-disaster-history="a&quot;&gt;&lt;script&gt;"/);assert.doesNotMatch(html,/<script>/);
 assert.equal(disasterEventDetails(event('plain')), '');
 const partial=event('partial','a');partial.hazardFact!.before=0;assert.match(disasterEventDetails(partial),/0 → 未知（未记录）/);
 assert.equal(JSON.stringify(w),before);
});

function harnessFixture(){const world=createWorld();world.events=[];const snapshot:Snapshot={world,mapRevision:'review',version:'review',serverTime:'review',capabilities:{active:[],pending:[]}};
 const requests:Array<{url:URL;signal:AbortSignal;resolve:(value:Response)=>void}>=[];
 const fetcher=((input:URL,init:RequestInit)=>new Promise<Response>(resolve=>requests.push({url:new URL(input),signal:init.signal as AbortSignal,resolve}))) as typeof fetch;
 const reply=(i:number,id:string,disaster:string,more=false,status=200)=>requests[i].resolve(new Response(JSON.stringify({worldId:world.id,events:[event(id,disaster)],hasMore:more,nextCursor:more?'cursor-'+id:null,observedRevision:1}),{status}));
 return {world,snapshot,requests,fetcher,reply};}

test('independent review: real entry rejects late disaster responses and duplicate clicks, retains failed latest page and scroll',async()=>{
 const f=harnessFixture(),app=await clientMainHarness(f.snapshot,async()=>{throw Error('No lazy panel needed');},f.fetcher);
 app.click({disasterHistory:'A'});await settle();app.click({disasterHistory:'A'});await settle();assert.equal(f.requests.length,1);
 app.click({disasterHistory:'B'});await settle();assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.requests[1].url.searchParams.get('disaster'),'B');
 f.reply(1,'B-head','B',true);await settle();f.reply(0,'A-late','A');await settle();assert.match(app.el('panel-body').innerHTML,/B-head/);assert.doesNotMatch(app.el('panel-body').innerHTML,/A-late/);
 app.scroll(130);app.click({history:'disasterHistory',historyAction:'latest'});await settle();f.reply(2,'failure','B',false,503);await settle();
 assert.match(app.el('panel-body').innerHTML,/B-head/);assert.match(app.el('panel-body').innerHTML,/重试这一页/);assert.equal(app.el('panel-body').scrollTop,130);
 app.click({history:'disasterHistory',historyAction:'retry'});await settle();f.reply(3,'B-reloaded','B',true);await settle();assert.equal(app.el('panel-body').scrollTop,0);
 app.scroll(90);app.click({panel:'people'});await settle();app.click({disasterHistory:'B'});await settle();assert.equal(f.requests.length,4);assert.equal(app.el('panel-body').scrollTop,90);
 app.click({history:'disasterHistory',historyAction:'older'});app.click({history:'disasterHistory',historyAction:'older'});await settle();assert.equal(f.requests.length,5);assert.equal(f.requests[4].url.searchParams.get('cursor'),'cursor-B-reloaded');f.reply(4,'B-older','B');await settle();assert.match(app.el('panel-body').innerHTML,/B-older/);app.escape();
});

test('independent review: observer matching uses exact disaster identity and never refetches or changes world',async()=>{
 const f=harnessFixture(),before=JSON.stringify(f.snapshot),app=await clientMainHarness(f.snapshot,async()=>{throw Error('No lazy panel needed');},f.fetcher);
 app.click({disasterHistory:'A'});await settle();f.reply(0,'A-head','A');await settle();app.scroll(170);
 const next=structuredClone(f.snapshot);next.world.revision++;next.world.events=[event(f.world.id+':event:2','AB')];app.update(next);await settle();assert.doesNotMatch(app.el('panel-body').innerHTML,/有新记录 ·/);
 next.world.events.push(event(f.world.id+':event:3','A'));next.world.revision++;app.update(next);await settle();assert.match(app.el('panel-body').innerHTML,/有新记录 ·/);assert.match(app.el('panel-body').innerHTML,/A-head/);assert.equal(f.requests.length,1);assert.equal(app.el('panel-body').scrollTop,170);assert.equal(JSON.stringify(f.snapshot),before);app.escape();
});

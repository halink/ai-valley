import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HistoryReader,archiveControls,archiveTimeline} from '../src/client/history.js';
import {rememberArchivePosition} from '../src/client/archive-position.js';
import {createWorld} from '../src/world/seed.js';
import type {HistoryPage} from '../src/shared/history.js';
import type {WorldEvent} from '../src/shared/types.js';

function fixture(){
 const world=createWorld();world.events=[];world.revision=1;
 const pending:Array<{url:URL;signal:AbortSignal;reply:(value:unknown,status?:number)=>void}>=[];
 let changed=0;
 const fetcher=((input:URL,init:RequestInit)=>new Promise<Response>(resolve=>pending.push({url:new URL(input),signal:init.signal as AbortSignal,reply:(value,status=200)=>resolve(new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}}))}))) as typeof fetch;
 const reader=new HistoryReader('http://localhost/api/',()=>changed++,fetcher);
 const event=(revision:number,overrides:Partial<WorldEvent>={}):WorldEvent=>({id:world.id+':event:'+revision,at:revision,kind:'action',actors:[],place:{x:1,y:1},text:'记录 '+revision,witnesses:[],...overrides});
 const page=(revision:number,nextCursor:string|null=null,events=[event(revision)]):HistoryPage=>({worldId:world.id,events,nextCursor,hasMore:!!nextCursor,observedRevision:revision});
 const initialize=async()=>{const task=reader.configure(world.id);pending.at(-1)!.reply(page(1,'older-1'));await task;reader.observe(world,true);};
 return {world,pending,reader,event,page,initialize,changed:()=>changed};
}

test('latest reading set stays fixed through continuous matching arrivals and time; only an explicit refresh requests a new head',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
 const f=fixture(),{world,reader,pending,event,page}=f;try{
  await f.initialize();const original=reader.page,position=reader.positionRevision,changed=f.changed();
  for(let revision=2;revision<=8;revision++){world.revision=revision;world.events=[event(revision)];const before=JSON.stringify(world);reader.observe(world,true);t.mock.timers.tick(3000);assert.equal(JSON.stringify(world),before);}
  assert.equal(pending.length,1);assert.equal(reader.page,original);assert.equal(reader.positionRevision,position);assert.equal(reader.news,true);assert.equal(f.changed(),changed+1,'notify the UI once rather than requiring a world redraw');
  assert.match(archiveControls('chronicle',reader,world),/有新记录 · 回到最新/);
  const refresh=reader.latest();assert.equal(reader.page,original);assert.equal(reader.news,true);assert.equal(pending[1].url.searchParams.has('cursor'),false);
  pending[1].reply(page(8,'new-older'));await refresh;
  assert.equal(reader.page!.events[0].id,event(8).id);assert.equal(reader.news,false);assert.ok(reader.positionRevision>position);
 }finally{reader.destroy();}
});

test('arrivals during a manual refresh remain announced even when the observer window trims them before the response',async()=>{
 const f=fixture(),{reader,world,pending,page,event}=f;try{
  await f.initialize();const refresh=reader.latest();world.events=[event(4)];reader.observe(world,true);world.events=[];reader.observe(world,true);
  pending[1].reply(page(3));await refresh;assert.equal(reader.page!.observedRevision,3);assert.equal(reader.news,true);assert.equal(pending.length,2);
  const next=reader.latest();pending[2].reply(page(4));await next;assert.equal(reader.news,false);
 }finally{reader.destroy();}
});

test('failed latest refresh from an older page preserves the reading session and retries the head, never the old cursor',async()=>{
 const f=fixture(),{reader,world,pending,page,event}=f;try{
  await f.initialize();const older=reader.older();pending[1].reply(page(1,'older-2',[event(0)]));await older;
  world.events=[event(5)];reader.observe(world,true);const original=reader.page,position=reader.positionRevision,refresh=reader.latest();
  await reader.older();await reader.newer();assert.equal(reader.index,1);assert.equal(reader.page,original);
  pending[2].reply({},503);await refresh;assert.equal(reader.index,1);assert.equal(reader.page,original);assert.equal(reader.news,true);assert.ok(reader.error);assert.equal(reader.positionRevision,position);
  const retry=reader.retry();assert.equal(pending[3].url.searchParams.has('cursor'),false);pending[3].reply(page(5,'fresh-cursor'));await retry;
  assert.equal(reader.index,0);assert.equal(reader.error,null);assert.equal(reader.news,false);
  const olderFresh=reader.older();assert.equal(pending[4].url.searchParams.get('cursor'),'fresh-cursor');pending[4].reply(page(5));await olderFresh;
 }finally{reader.destroy();}
});

test('pagination cannot clear new-record notice or replace the head baseline with a later response revision',async()=>{
 const f=fixture(),{reader,world,pending,page,event}=f;try{
  await f.initialize();world.events=[event(2)];reader.observe(world,true);const older=reader.older();world.events=[];
  pending[1].reply(page(10,null,[event(0)]));await older;assert.equal(reader.news,true);await reader.newer();assert.equal(reader.news,true);assert.equal(pending.length,2);
 }finally{reader.destroy();}
});

test('inactive readers retain unseen arrival evidence without rendering or fetching, then announce it on return',async()=>{
 const f=fixture(),{reader,world,pending,event}=f;try{
  await f.initialize();const changed=f.changed();reader.deactivate();world.events=[event(2)];reader.observe(world,false);world.events=[];
  assert.equal(reader.news,false);assert.equal(f.changed(),changed);reader.observe(world,true);assert.equal(reader.news,true);assert.equal(f.changed(),changed+1);assert.equal(pending.length,1);
 }finally{reader.destroy();}
});

test('person and filter changes clear notices, preserve exact scope and ignore superseded successes and failures',async()=>{
 const f=fixture(),{reader,world,pending,page,event}=f;try{
  await f.initialize();world.events=[event(2)];reader.observe(world,true);assert.equal(reader.news,true);
  const oldRefresh=reader.latest(),person=reader.configure(world.id,{personId:'b'});assert.equal(reader.news,false);assert.equal(reader.page,undefined);assert.equal(pending[1].signal.aborted,true);
  pending[2].reply(page(2));await person;pending[1].reply(page(1));await oldRefresh;assert.equal(reader.page!.observedRevision,2);
  const first=reader.setFilters({kind:'care'}),second=reader.setFilters({kind:'death',q:'事实',from:10,to:20});assert.equal(pending[4].url.searchParams.get('person'),'b');assert.equal(reader.news,false);
  pending[4].reply(page(3));await second;pending[3].reply({},500);await first;assert.equal(reader.error,null);assert.equal(reader.query.kind,'death');
  const nonmatching=[event(4,{actors:['a'],kind:'death',at:15,text:'事实'}),event(5,{actors:['b'],kind:'care',at:15,text:'事实'}),event(6,{actors:['b'],kind:'death',at:20,text:'事实'}),event(7,{actors:['b'],kind:'death',at:15,text:'仅原话'})];
  world.events=nonmatching;reader.observe(world,true);assert.equal(reader.news,false);world.events=[event(8,{actors:['b'],kind:'death',at:15,text:'事实'})];reader.observe(world,true);assert.equal(reader.news,true);
 }finally{reader.destroy();}
});

test('world replacement invalidates pending requests, cached pages, filters and notices before a new archive is configured',async()=>{
 const f=fixture(),{reader,world,pending,page,event}=f;try{
  await f.initialize();world.events=[event(2)];reader.observe(world,true);const stale=reader.latest();
  const next={...world,id:world.id+'-replacement',events:[]};reader.observe(next,false);
  assert.equal(pending[1].signal.aborted,true);assert.equal(reader.page,undefined);assert.equal(reader.loading,false);assert.equal(reader.news,false);assert.equal(reader.error,null);
  pending[1].reply(page(50));await stale;assert.equal(reader.page,undefined);
  const fresh=reader.configure(next.id,{personId:'new-person'});pending[2].reply({...page(1),worldId:next.id});await fresh;
  assert.equal(reader.page!.worldId,next.id);assert.equal(reader.query.personId,'new-person');assert.equal(reader.news,false);
 }finally{reader.destroy();}
});

test('failed initial and wrong-world responses expose retry without accepting facts or automatically polling',async()=>{
 const f=fixture(),{reader,world,pending,page}=f;try{
  const initial=reader.configure(world.id);pending[0].reply({},503);await initial;assert.ok(reader.error);assert.equal(reader.page,undefined);
  const wrong=reader.retry();pending[1].reply({...page(2),worldId:'wrong'});await wrong;assert.ok(reader.error);assert.equal(reader.page,undefined);
  const retry=reader.retry();pending[2].reply(page(3));await retry;assert.equal(reader.error,null);assert.equal(reader.page!.observedRevision,3);assert.equal(pending.length,3);
 }finally{reader.destroy();}
});

test('reading beyond the bounded cache and back retains original page zero instead of fetching a newer head',async()=>{
 const f=fixture(),{reader,pending,page,event}=f;try{
  await f.initialize();const head=reader.page;
  for(let index=1;index<=7;index++){const task=reader.older();pending.at(-1)!.reply(page(10,'older-'+(index+1),[event(-index)]));await task;}
  while(reader.index>0){const count=pending.length,task=reader.newer();if(pending.length>count){assert.equal(pending.at(-1)!.url.searchParams.has('cursor'),true);pending.at(-1)!.reply(page(20,'older-'+(reader.index+1),[event(-reader.index)]));}await task;}
  assert.equal(reader.page,head);assert.equal(pending.filter(p=>!p.url.searchParams.has('cursor')).length,1);
 }finally{reader.destroy();}
});

function positionFixture(){
 let scrollTop=200,records=[{id:'above',top:0,height:150},{id:'reading',top:170,height:200},{id:'below',top:400,height:200}];
 const root={get scrollTop(){return scrollTop;},set scrollTop(value:number){scrollTop=value;},getBoundingClientRect:()=>({top:100,bottom:500}),querySelectorAll:()=>records.map(record=>({dataset:{historyEvent:record.id},getBoundingClientRect:()=>({top:100+record.top-scrollTop,bottom:100+record.top+record.height-scrollTop})}))} as unknown as HTMLElement;
 return {root,setRecords:(next:typeof records)=>{records=next;}};
}

test('observer-only archive layout changes restore the same partly visible event, not just the old pixel offset',()=>{
 const f=positionFixture(),restore=rememberArchivePosition(f.root);f.setRecords([{id:'above',top:0,height:170},{id:'reading',top:210,height:200},{id:'below',top:440,height:200}]);
 restore();assert.equal(f.root.scrollTop,240);
});

test('archive position restoration uses exact ids and falls back to pixels if the record is absent',()=>{
 const f=positionFixture(),restore=rememberArchivePosition(f.root);f.setRecords([{id:'reading-other',top:210,height:200}]);f.root.scrollTop=0;restore();assert.equal(f.root.scrollTop,200);
 const {world,event}=fixture();assert.match(archiveTimeline([event(1,{id:'"<record>'})],world),/data-history-event="&quot;&lt;record&gt;"/);
});

test('returning from a successful biography restores the archive records and entry scroll',async()=>{
 const {clientMainHarness}=await import('./helpers/client-main.js');
 const f=fixture(),person=f.world.residents[0],snapshot={world:f.world,mapRevision:'entry-boundary',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}};
 let historyRequests=0;
 const app=await clientMainHarness(snapshot,async()=>{throw new Error('no optional panel required');},(async(input:URL)=>{
  if(String(input).includes('/biography'))return new Response(JSON.stringify({worldId:f.world.id,person:{id:person.id,name:person.name,bornAt:person.bornAt,status:person.status,residency:person.residency,deathAt:null,homeId:person.homeId,parents:[],adoptiveParents:[],guardianIds:[]},recordCount:1,firstRecordAt:1,lastRecordAt:1,partners:[],history:f.page(1)}));
  historyRequests++;return new Response(JSON.stringify(f.page(1)));
 }) as typeof fetch);
 const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
 app.click({panel:'chronicle'});await settle();assert.match(app.el('panel-body').innerHTML,/记录 1/);app.el('panel-body').scrollTop=600;
 app.click({biography:person.id});for(let attempt=0;attempt<10&&!app.el('panel-body').innerHTML.includes('的生平');attempt++)await settle();assert.match(app.el('panel-body').innerHTML,/的生平/);assert.doesNotMatch(app.el('panel-body').innerHTML,/暂时无法读取/);
 const before=historyRequests;app.click({panel:'chronicle'});await settle();assert.equal(historyRequests,before);assert.match(app.el('panel-body').innerHTML,/记录 1/);assert.equal(app.el('panel-body').scrollTop,600);
 app.escape();f.reader.destroy();
});

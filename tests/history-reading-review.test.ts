import assert from 'node:assert/strict';
import {test} from 'node:test';
import {HistoryReader} from '../src/client/history.js';
import {rememberArchivePosition} from '../src/client/archive-position.js';
import {createWorld} from '../src/world/seed.js';
import type {HistoryPage} from '../src/shared/history.js';
import type {Snapshot,WorldEvent} from '../src/shared/types.js';
import {clientMainHarness} from './helpers/client-main.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 const world=createWorld();world.events=[];
 const event=(revision:number):WorldEvent=>({id:world.id+':event:'+revision,at:revision,kind:'action',actors:[],place:{x:1,y:1},text:'独立记录 '+revision,witnesses:[]});
 const page=(revision:number):HistoryPage=>({worldId:world.id,events:[event(revision)],hasMore:false,nextCursor:null,observedRevision:revision});
 const requests:Array<{signal:AbortSignal,resolve:(response:Response)=>void}>=[];
 const fetcher=((_input:unknown,init:RequestInit)=>new Promise<Response>(resolve=>requests.push({signal:init.signal as AbortSignal,resolve}))) as typeof fetch;
 const reader=new HistoryReader('http://review.test/api/',()=>{},fetcher);
 const reply=(index:number,value:unknown,status=200)=>requests[index].resolve(new Response(JSON.stringify(value),{status}));
 return {world,event,page,requests,reader,reply};
}

test('review: superseded explicit latest success cannot overwrite the newer request, even if transport ignores abort',async()=>{
 const f=fixture();try{
  const initial=f.reader.configure(f.world.id);f.reply(0,f.page(1));await initial;f.reader.observe(f.world,true);
  const first=f.reader.latest(),second=f.reader.latest();assert.equal(f.requests[1].signal.aborted,true);
  f.reply(2,f.page(3));await second;const revision=f.reader.positionRevision;
  f.reply(1,f.page(2));await first;assert.equal(f.reader.page!.observedRevision,3);assert.equal(f.reader.positionRevision,revision);
 }finally{f.reader.destroy();}
});

test('review: malformed or wrong-world manual replacement keeps current page and notice',async()=>{
 const f=fixture();try{
  const initial=f.reader.configure(f.world.id);f.reply(0,f.page(1));await initial;
  f.world.events=[f.event(2)];f.reader.observe(f.world,true);const original=f.reader.page,revision=f.reader.positionRevision;
  for(const invalid of [{...f.page(2),events:null},{...f.page(2),worldId:'another-world'}]){
   const task=f.reader.latest();f.reply(f.requests.length-1,invalid);await task;
   assert.equal(f.reader.page,original);assert.equal(f.reader.positionRevision,revision);assert.equal(f.reader.news,true);assert.ok(f.reader.error);
  }
 }finally{f.reader.destroy();}
});

test('review: destroy rejects late results without publishing a page or changed callback',async()=>{
 let changed=0,resolve!:(response:Response)=>void;
 const f=fixture(),reader=new HistoryReader('http://review.test/',()=>changed++,(()=>new Promise<Response>(yes=>resolve=yes)) as typeof fetch);
 const task=reader.configure(f.world.id);reader.destroy();const before=changed;resolve(new Response(JSON.stringify(f.page(1))));await task;
 assert.equal(reader.page,undefined);assert.equal(changed,before);
});

test('review: records below the viewport are not reading anchors while the biography overview grows',()=>{
 let scroll=0,eventTop=1000;
 const root={get scrollTop(){return scroll;},set scrollTop(value:number){scroll=value;},
  getBoundingClientRect:()=>({top:100,bottom:500}),
  querySelectorAll:()=>[{dataset:{historyEvent:'below'},getBoundingClientRect:()=>({top:eventTop-scroll,bottom:eventTop+100-scroll})}],
 } as unknown as HTMLElement;
 const restore=rememberArchivePosition(root);eventTop+=200;restore();assert.equal(scroll,0);
});

test('review: real client entry keeps the existing head through observer updates and resets only on explicit latest',async()=>{
 const f=fixture(),snapshot:Snapshot={world:f.world,mapRevision:'review',version:'review',serverTime:'review',capabilities:{active:[],pending:[]}};
 let requests=0,head=1;
 const app=await clientMainHarness(snapshot,async()=>{throw new Error('optional UI must not load');},async()=>{requests++;return new Response(JSON.stringify(f.page(head)));});
 app.click({panel:'chronicle'});await settle();assert.match(app.el('panel-body').innerHTML,/独立记录 1/);assert.equal(requests,1);
 app.el('panel-body').scrollTop=180;
 const next=structuredClone(snapshot);next.world.revision++;next.world.events=[f.event(2)];app.update(next);await settle();
 assert.equal(requests,1);assert.match(app.el('panel-body').innerHTML,/有新记录 · 回到最新/);assert.match(app.el('panel-body').innerHTML,/独立记录 1/);assert.doesNotMatch(app.el('panel-body').innerHTML,/独立记录 2/);assert.equal(app.el('panel-body').scrollTop,180);
 head=2;app.click({history:'chronicle',historyAction:'latest'});await settle();assert.equal(requests,2);assert.match(app.el('panel-body').innerHTML,/独立记录 2/);assert.doesNotMatch(app.el('panel-body').innerHTML,/有新记录 · 回到最新/);assert.equal(app.el('panel-body').scrollTop,0);app.escape();
});

test('review: configuring a different world does not let the old observed snapshot erase its successful response',async()=>{
 const f=fixture();try{
  const initial=f.reader.configure(f.world.id);f.reply(0,f.page(1));await initial;f.reader.observe(f.world,true);
  const nextWorld=f.world.id+'-new',next=f.reader.configure(nextWorld);
  f.reply(1,{...f.page(2),worldId:nextWorld});await next;
  assert.equal(f.reader.page?.worldId,nextWorld);assert.equal(f.reader.loading,false);assert.equal(f.reader.error,null);
 }finally{f.reader.destroy();}
});

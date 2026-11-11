import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PanelPositions} from '../src/client/panel-positions.js';
import {captureArchivePosition,restoreArchivePosition} from '../src/client/archive-position.js';
import {clientMainHarness} from './helpers/client-main.js';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot} from '../src/shared/types.js';

function viewport(){
 let scroll=0,limit=2000,top=400;
 const detail={dataset:{waterEvent:'event'},open:true};
 const record={dataset:{historyEvent:'event'},getBoundingClientRect:()=>({top:100+top-scroll,bottom:200+top-scroll})};
 const root={get scrollTop(){return scroll;},set scrollTop(v:number){scroll=Math.max(0,Math.min(limit,v));},
  getBoundingClientRect:()=>({top:100,bottom:500}),querySelectorAll:(selector:string)=>selector.startsWith('details')?[detail]:[record]} as unknown as HTMLElement;
 return {root,detail,set limit(v:number){limit=v;root.scrollTop=scroll;},set top(v:number){top=v;}};
}
const enter={entry:true,keep:false,ready:true},redraw={entry:false,keep:true,ready:true};
const blank={scroll:0,offset:0,waterOpen:[]};
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('review: return uses value-only event anchor and expanded water details after new DOM layout',()=>{
 const a=viewport();a.root.scrollTop=430;const value=captureArchivePosition(a.root);
 assert.equal(value.eventId,'event');assert.equal(value.offset,-30);
 a.detail.open=false;
 const b=viewport();b.top=620;b.detail.open=false;restoreArchivePosition(b.root,value);
 assert.equal(b.root.scrollTop,650);assert.equal(b.detail.open,true);assert.equal(a.detail.open,false);
});

test('review: repeated loading redraw and leaving again retain unclamped return target',()=>{
 const f=viewport(),positions=new PanelPositions(),view={key:'history',revision:2};
 positions.restore(f.root,view,enter,blank);f.root.scrollTop=430;positions.save(f.root);positions.deactivate();
 f.limit=0;positions.restore(f.root,view,{...enter,ready:false},blank);assert.equal(f.root.scrollTop,0);
 positions.restore(f.root,view,{...redraw,ready:false},captureArchivePosition(f.root));
 positions.save(f.root);positions.deactivate();f.limit=2000;
 positions.restore(f.root,view,enter,captureArchivePosition(f.root));assert.equal(f.root.scrollTop,430);
});

test('review: explicit interaction and actual scroll independently cancel delayed return',()=>{
 for(const interaction of ['input','scroll']){
  const f=viewport(),positions=new PanelPositions(),view={key:'history',revision:2};
  positions.restore(f.root,view,enter,blank);f.root.scrollTop=900;positions.save(f.root);positions.deactivate();
  f.limit=100;positions.restore(f.root,view,{...enter,ready:false},blank);
  if(interaction==='input')positions.interacted();else{f.root.scrollTop=25;positions.scrolled(f.root);}
  const expected=f.root.scrollTop;f.limit=2000;positions.restore(f.root,view,redraw,captureArchivePosition(f.root));
  assert.equal(f.root.scrollTop,expected);
 }
});

test('review: world clear and collection revision invalidate returns; cache is bounded at 40 views',()=>{
 const f=viewport(),positions=new PanelPositions();
 for(let i=0;i<41;i++){positions.restore(f.root,{key:String(i),revision:1},enter,blank);f.root.scrollTop=100+i;positions.save(f.root);}
 positions.restore(f.root,{key:'0',revision:1},enter,blank);assert.equal(f.root.scrollTop,0);
 positions.restore(f.root,{key:'1',revision:1},enter,blank);assert.equal(f.root.scrollTop,101);
 positions.restore(f.root,{key:'1',revision:2},enter,blank);assert.equal(f.root.scrollTop,0);
 positions.clear();positions.restore(f.root,{key:'40',revision:1},enter,blank);assert.equal(f.root.scrollTop,0);
});

function clientFixture(){
 const world=createWorld();world.events=[];
 const snapshot:Snapshot={world,mapRevision:'review-position',version:'review',serverTime:'review',capabilities:{active:[],pending:[]}};
 const requests:Array<{url:URL;resolve:(r:Response)=>void}>=[];
 const fetcher=((url:URL)=>new Promise<Response>(resolve=>requests.push({url:new URL(url),resolve}))) as typeof fetch;
 const reply=(index:number,text='review event')=>requests[index].resolve(new Response(JSON.stringify({worldId:world.id,observedRevision:1,events:[{id:world.id+':event:1',at:1,kind:'action',actors:[],place:{x:1,y:1},text,witnesses:[]}],hasMore:false,nextCursor:null})));
 return {world,snapshot,requests,fetcher,reply};
}

test('review: late hidden archive response cannot move another panel; return to replaced collection starts at top',async()=>{
 const f=clientFixture(),app=await clientMainHarness(f.snapshot,async()=>({}),f.fetcher);
 app.click({panel:'chronicle'});f.reply(0);await settle();app.scroll(350);
 app.click({history:'chronicle',historyAction:'latest'});await settle();app.click({panel:'people'});app.scroll(120);
 f.reply(1,'replacement');await settle();assert.equal(app.el('panel-body').scrollTop,120);
 app.click({panel:'chronicle'});assert.equal(app.el('panel-body').scrollTop,0);assert.match(app.el('panel-body').innerHTML,/replacement/);app.escape();
});

test('review: filtering while hidden invalidates the old return before and after response',async()=>{
 const f=clientFixture(),app=await clientMainHarness(f.snapshot,async()=>({}),f.fetcher);
 app.click({panel:'chronicle'});f.reply(0);await settle();app.scroll(350);
 app.filter('chronicle',{q:'new search'});app.click({panel:'people'});app.scroll(120);
 app.click({panel:'chronicle'});assert.equal(app.el('panel-body').scrollTop,0);
 assert.equal(f.requests[1].url.searchParams.get('q'),'new search');f.reply(1,'filtered');await settle();
 assert.equal(app.el('panel-body').scrollTop,0);assert.match(app.el('panel-body').innerHTML,/filtered/);app.escape();
});

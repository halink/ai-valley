import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clientMainHarness} from './helpers/client-main.js';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot,WorldEvent} from '../src/shared/types.js';
import {PanelPositions} from '../src/client/panel-positions.js';
import {captureArchivePosition} from '../src/client/archive-position.js';

const settle=async()=>{await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));};
async function fixture(){
 const world=createWorld();world.events=[];
 const snapshot:Snapshot={world,mapRevision:'return-test',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}};
 let hold=(url:URL)=>false,head=1;
 const requests:Array<{url:URL;pending:boolean;reply:(value?:unknown,status?:number)=>void}>=[];
 const fact=(id=head):WorldEvent=>({id:world.id+':event:'+id,at:id,kind:'action',actors:[world.residents[0].id],place:{x:1,y:1},text:'返回记录 '+id,witnesses:[]});
 const value=(url:URL)=>{
  if(url.pathname.endsWith('/biography')){const id=decodeURIComponent(url.pathname.split('/').at(-2)!),person=world.residents.find(r=>r.id===id)!;return {worldId:world.id,person:{id,name:person.name,bornAt:person.bornAt,status:person.status,residency:person.residency,deathAt:null,homeId:person.homeId,parents:[],adoptiveParents:[],guardianIds:[]},recordCount:1,firstRecordAt:1,lastRecordAt:1,partners:[]};}
  return {worldId:world.id,events:[fact()],observedRevision:head,hasMore:true,nextCursor:'older-'+head};
 };
 const fetcher=((input:URL)=>new Promise<Response>(resolve=>{const url=new URL(input),request={url,pending:true,reply:(result:unknown=value(url),status=200)=>{request.pending=false;resolve(new Response(JSON.stringify(result),{status}));}};requests.push(request);if(!hold(url))request.reply();})) as typeof fetch;
 const app=await clientMainHarness(snapshot,async()=>{throw new Error('No optional panel expected');},fetcher);
 const open=async(panel:string)=>{app.click({panel});await settle();};
 const bio=async(id=world.residents[0].id)=>{app.click({biography:id});await settle();};
 const changedPerson=()=>{const next=structuredClone(app.accepted.at(-1)!);next.world.revision++;next.world.residents[0].homeId=next.world.residents[0].homeId===null?'new-home':null;app.update(next);};
 return {world,snapshot,app,open,bio,requests,fact,changedPerson,setHead:(value:number)=>head=value,setHold:(fn:typeof hold)=>hold=fn,release:()=>{for(const request of requests.filter(r=>r.pending))request.reply();}};
}

test('successful archive and biography return to their own positions, including close/reopen and an intentional return to top',async()=>{
 const f=await fixture(),{app}=f;await f.open('chronicle');app.scroll(600);await f.bio();assert.equal(app.el('panel-body').scrollTop,0);app.scroll(240);
 await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,600);await f.bio();assert.equal(app.el('panel-body').scrollTop,240);
 app.escape();await f.bio();assert.equal(app.el('panel-body').scrollTop,240);app.scroll(0);app.escape();await f.bio();assert.equal(app.el('panel-body').scrollTop,0);app.escape();
});

test('switching person or submitting filters resets positions rather than copying the previous reading context',async()=>{
 const f=await fixture(),{app}=f;await f.open('chronicle');app.scroll(600);await f.bio();app.scroll(250);await f.bio(f.world.residents[1].id);assert.equal(app.el('panel-body').scrollTop,0);
 app.scroll(150);await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,600);
 app.filter('chronicle',{q:'返回',person:f.world.residents[0].id});await settle();assert.equal(app.el('panel-body').scrollTop,0);app.scroll(90);await f.bio();await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,90);
 app.click({history:'chronicle',historyAction:'older'});await settle();assert.equal(app.el('panel-body').scrollTop,0);app.escape();
});

test('late biography responses preserve the current archive and do not re-open or apply another view position',async()=>{
 const f=await fixture(),{app}=f;await f.open('chronicle');app.scroll(600);f.setHold(url=>url.pathname.endsWith('/biography'));await f.bio();assert.match(app.el('panel-body').innerHTML,/正在查阅/);
 await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,600);f.release();await settle();assert.equal(app.el('panel-title').textContent,'山谷年表');assert.equal(app.el('panel-body').scrollTop,600);assert.match(app.el('panel-body').innerHTML,/返回记录 1/);app.escape();
});

test('return waits through temporarily shorter biography loading and restores the original position once content is ready',async()=>{
 const f=await fixture(),{app}=f;await f.bio();app.scroll(500);await f.open('chronicle');app.scroll(180);f.changedPerson();f.setHold(url=>url.pathname.endsWith('/biography'));
 app.el('panel-body').scrollLimitForHTML=html=>html.includes('正在查阅留存的人物资料')?100:Infinity;
 await f.bio();assert.equal(app.el('panel-body').scrollTop,100);f.release();await settle();assert.equal(app.el('panel-body').scrollTop,500);await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,180);app.escape();
});

test('user scrolling or wheel intent cancels a deferred restoration rather than snapping back after loading',async()=>{
 for(const action of ['scroll','wheel','touchstart','pointerdown']){
  const f=await fixture(),{app}=f;await f.bio();app.scroll(500);await f.open('chronicle');f.changedPerson();f.setHold(url=>url.pathname.endsWith('/biography'));
  app.el('panel-body').scrollLimitForHTML=html=>html.includes('正在查阅留存的人物资料')?100:Infinity;
  await f.bio();assert.equal(app.el('panel-body').scrollTop,100);if(action==='scroll')app.scroll(35);else app.interact(action);
  f.release();await settle();assert.equal(app.el('panel-body').scrollTop,action==='scroll'?35:100,action);app.escape();
 }
});

test('closing during deferred restoration retains its intended view position without overwriting a different view',async()=>{
 const f=await fixture(),{app}=f;await f.bio();app.scroll(500);await f.open('chronicle');app.scroll(180);f.changedPerson();f.setHold(url=>url.pathname.endsWith('/biography'));
 app.el('panel-body').scrollLimitForHTML=html=>html.includes('正在查阅留存的人物资料')?100:Infinity;
 await f.bio();assert.equal(app.el('panel-body').scrollTop,100);app.escape();f.release();await settle();assert.equal(app.el('panel').classList.contains('hidden'),true);
 await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,180);await f.bio();assert.equal(app.el('panel-body').scrollTop,500);app.escape();
});

test('explicit latest that finishes while elsewhere invalidates the old saved position, while failure preserves it',async()=>{
 for(const fail of [false,true]){
  const f=await fixture(),{app}=f;await f.open('chronicle');app.scroll(600);f.setHold(url=>url.pathname.endsWith('/history/page'));f.setHead(2);
  app.click({history:'chronicle',historyAction:'latest'});await f.bio();const request=f.requests.find(r=>r.pending&&!r.url.searchParams.has('person'))!;
  request.reply(fail?{}:undefined,fail?503:200);await settle();await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,fail?600:0);app.escape();f.release();await settle();
 }
});

test('a replacement world clears saved entry positions even when it reuses person and event identities',async()=>{
 const f=await fixture(),{app}=f;await f.open('chronicle');app.scroll(600);await f.bio();app.scroll(200);app.escape();
 const next=structuredClone(f.snapshot);next.world.id+='-replacement';next.world.revision++;f.world.id=next.world.id;app.update(next);await settle();assert.equal(app.el('panel').classList.contains('hidden'),true);
 await f.open('chronicle');assert.equal(app.el('panel-body').scrollTop,0);await f.bio();assert.equal(app.el('panel-body').scrollTop,0);app.escape();
});

function rootFixture(){let scroll=0,limit=Infinity;const root={get scrollTop(){return scroll;},set scrollTop(value:number){scroll=Math.max(0,Math.min(value,limit));},querySelectorAll:()=>[]} as unknown as HTMLElement;return {root,setLimit:(n:number)=>{limit=n;root.scrollTop=scroll;}};}

test('pending restoration notices actual scroll changes before a delayed browser scroll event',()=>{
 const {root,setLimit}=rootFixture(),positions=new PanelPositions(),view={key:'world/biography/a',revision:1};
 positions.restore(root,view,{entry:true,keep:false,ready:true},captureArchivePosition(root));root.scrollTop=600;positions.save(root);setLimit(100);
 positions.restore(root,view,{entry:true,keep:false,ready:false},captureArchivePosition(root));root.scrollTop=30;const redraw=captureArchivePosition(root);setLimit(Infinity);
 positions.restore(root,view,{entry:false,keep:true,ready:true},redraw);assert.equal(root.scrollTop,30);
});

test('position cache is bounded and evicted entries start at top rather than borrowing another view',()=>{
 const {root}=rootFixture(),positions=new PanelPositions();
 for(let i=0;i<42;i++){positions.restore(root,{key:String(i),revision:1},{entry:true,keep:false,ready:true},captureArchivePosition(root));root.scrollTop=i+100;positions.save(root);}
 positions.restore(root,{key:'0',revision:1},{entry:true,keep:false,ready:true},captureArchivePosition(root));assert.equal(root.scrollTop,0);
 positions.restore(root,{key:'41',revision:1},{entry:true,keep:false,ready:true},captureArchivePosition(root));assert.equal(root.scrollTop,141);
});

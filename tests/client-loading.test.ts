import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot} from '../src/shared/types.js';
import * as renderers from '../src/client/panel-renderers.js';
import {clientMainHarness} from './helpers/client-main.js';

function fixture():Snapshot{return {world:createWorld(),mapRevision:'test-map',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}};}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred(){let resolve!:(value:typeof renderers)=>void,reject!:(error:Error)=>void;const promise=new Promise<typeof renderers>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('initial map and basic panels do not load optional renderers; archive failures remain visible',async()=>{
 let calls=0;const app=await clientMainHarness(fixture(),async()=>{calls++;return renderers;});
 assert.equal(app.accepted.length,1);assert.equal(calls,0);
 for(const panel of ['people','relations','places','about','culture']){app.click({panel});assert.doesNotMatch(app.el('panel-body').innerHTML,/正在加载观察面板/);}
 app.click({panel:'chronicle'});await settle();assert.match(app.el('panel-body').innerHTML,/暂时无法读取/);
 assert.equal(calls,0);app.escape();
});

test('repeated opens share a load and completion renders only the current panel with the latest snapshot',async()=>{
 const pending=deferred(),snapshot=fixture();let calls=0;
 const app=await clientMainHarness(snapshot,()=>{calls++;return pending.promise;});
 app.click({panel:'market'});app.click({panel:'market'});app.click({panel:'debt'});
 assert.match(app.el('panel-body').innerHTML,/正在加载观察面板/);
 const next=structuredClone(snapshot);next.world.revision++;next.world.minute+=60;app.update(next);
 await settle();assert.equal(calls,1);pending.resolve(renderers);await settle();
 assert.equal(app.el('panel-title').textContent,'借贷和遗产清算');
 assert.equal(app.el('panel-body').innerHTML,renderers.debtPanel(next.world));
 app.click({panel:'market'});assert.equal(app.el('panel-body').innerHTML,renderers.marketPanel(next.world));assert.equal(calls,1);
 app.escape();
});

test('closing, returning to a basic panel and changing resident while loading never restores stale content',async()=>{
 const pending=deferred(),snapshot=fixture();const app=await clientMainHarness(snapshot,()=>pending.promise);
 app.click({panel:'market'});app.click({action:'closepanel'});pending.resolve(renderers);await settle();
 assert.equal(app.el('panel').classList.contains('hidden'),true);
 const next=deferred(),other=await clientMainHarness(snapshot,()=>next.promise);
 other.click({panel:'market'});other.click({panel:'people'});const peopleHTML=other.el('panel-body').innerHTML;
 next.resolve(renderers);await settle();assert.equal(other.el('panel-body').innerHTML,peopleHTML);
 const profiles=deferred(),profile=await clientMainHarness(snapshot,()=>profiles.promise);
 profile.click({person:snapshot.world.residents[0].id});profile.click({person:snapshot.world.residents[1].id});
 profiles.resolve(renderers);await settle();
 assert.ok(profile.el('panel-body').innerHTML.includes(`<h3>${snapshot.world.residents[1].name}</h3>`));
 other.escape();profile.escape();
});

test('failed imports preserve map and basic controls, do not loop on updates and support explicit retry',async()=>{
 const first=deferred(),second=deferred(),snapshot=fixture();let calls=0;
 const app=await clientMainHarness(snapshot,()=>++calls===1?first.promise:second.promise);
 app.click({panel:'market'});first.reject(new Error('chunk unavailable'));await settle();
 assert.match(app.el('panel-body').innerHTML,/观察面板加载失败/);
 assert.match(app.el('panel-body').innerHTML,/刷新页面/);
 for(let i=0;i<3;i++){const next=structuredClone(snapshot);next.world.revision+=i+1;app.update(next);}
 await settle();assert.equal(calls,1);assert.equal(app.accepted.length,4);
 app.click({action:'home'});assert.equal(app.homeCalls,1);
 app.click({panel:'people'});assert.match(app.el('panel-body').innerHTML,/people-list/);
 app.click({panel:'market'});assert.match(app.el('panel-body').innerHTML,/观察面板加载失败/);
 app.click({action:'retry-panels'});app.click({action:'retry-panels'});await settle();assert.equal(calls,2);
 assert.match(app.el('panel-body').innerHTML,/正在加载观察面板/);
 second.resolve(renderers);await settle();assert.equal(app.el('panel-body').innerHTML,renderers.marketPanel(app.accepted.at(-1)!.world));
 app.escape();
});

test('all deferred panel branches and resident details still render from the real renderer exports',async()=>{
 const snapshot=fixture(),before=JSON.stringify(snapshot);const app=await clientMainHarness(snapshot,async()=>renderers);
 for(const panel of ['food','market','household','debt','finance','employment','infrastructure','cemetery','longCare','support','health','industry','ecology','designs','education','foreign','wild']){
  app.click({panel});await settle();assert.ok(app.el('panel-body').innerHTML.length>0,panel);
  assert.doesNotMatch(app.el('panel-body').innerHTML,/正在加载观察面板|观察面板加载失败/,panel);
 }
 app.click({person:snapshot.world.residents[0].id});assert.match(app.el('panel-body').innerHTML,/profile-head/);
 assert.equal(JSON.stringify(snapshot),before,'read-only panels must not mutate the snapshot');app.escape();
});

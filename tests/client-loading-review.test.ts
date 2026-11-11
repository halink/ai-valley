import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import type {Snapshot} from '../src/shared/types.js';
import * as renderers from '../src/client/panel-renderers.js';
import {clientMainHarness} from './helpers/client-main.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const fixture=():Snapshot=>({world:createWorld(),mapRevision:'review-map',version:'review',serverTime:'review',capabilities:{active:[],pending:[]}});
function deferred(){let resolve!:(value:typeof renderers)=>void,reject!:(reason:Error)=>void;const promise=new Promise<typeof renderers>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('review: failure after dismissal stays dismissed; reopening exposes explicit retry without another request',async()=>{
 const pending=deferred();let calls=0;
 const app=await clientMainHarness(fixture(),()=>{calls++;return pending.promise;});
 app.click({panel:'market'});app.escape();pending.reject(new Error('offline'));await settle();
 assert.equal(app.el('panel').classList.contains('hidden'),true);
 app.click({panel:'people'});assert.match(app.el('panel-body').innerHTML,/people-list/);
 app.click({panel:'market'});await settle();assert.equal(calls,1);
 assert.match(app.el('panel-body').innerHTML,/观察面板加载失败/);app.escape();
});

test('review: resident removed while loading does not revive a stale profile',async()=>{
 const pending=deferred(),snapshot=fixture();const app=await clientMainHarness(snapshot,()=>pending.promise);
 const id=snapshot.world.residents[0].id;app.click({person:id});
 const next=structuredClone(snapshot);next.world.revision++;next.world.residents=next.world.residents.filter(r=>r.id!==id);app.update(next);
 pending.resolve(renderers);await settle();
 assert.match(app.el('panel-body').innerHTML,/这份人物记录暂不可用/);
 assert.doesNotMatch(app.el('panel-body').innerHTML,/profile-head/);app.escape();
});

test('review: rejecting a background load never overwrites a basic panel',async()=>{
 const pending=deferred();const app=await clientMainHarness(fixture(),()=>pending.promise);
 app.click({panel:'health'});app.click({panel:'about'});
 const before=app.el('panel-body').innerHTML;pending.reject(new Error('offline'));await settle();
 assert.equal(app.el('panel-body').innerHTML,before);app.escape();
});

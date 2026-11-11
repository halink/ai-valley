import assert from 'node:assert/strict';
import {test} from 'node:test';
import {residentActivity,residentStatusProfile,socialAppointmentProfile} from '../src/client/resident-status.js';
import {stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {accepted,choice,finish,fixture,offered,queue,run} from './helpers/social-appointments.js';

const fact=(label:string,value:string)=>`<dt>${label}</dt><dd>${value}</dd>`;

test('appointment panel separates offered, accepted and remote withdrawn world facts from personal knowledge',()=>{
 const f=fixture(),c=offered(f);let html=socialAppointmentProfile(f.w,f.r);assert.ok(html.includes(fact('世界记录','提议待答复')));assert.ok(html.includes(fact('本人最后获知','提议待答复')));assert.ok(html.includes(fact('本人实际赴约','尚无实际赴约记录')));
 run(f.w,f.peer,choice(f.w,f.peer,'accept'));html=socialAppointmentProfile(f.w,f.peer);assert.ok(html.includes(fact('世界记录','双方已接受')));assert.ok(html.includes(fact('本人最后获知','双方已接受')));
 run(f.w,f.r,choice(f.w,f.r,'attend'));run(f.w,f.r,choice(f.w,f.r,'withdraw'));assert.equal(c.status,'withdrawn');assert.equal(c.known[f.peer.id],'accepted');html=socialAppointmentProfile(f.w,f.peer);assert.ok(html.includes(fact('世界记录','已撤回')));assert.ok(html.includes(fact('本人最后获知','双方已接受')));assert.match(html,/观察者记录/);assert.match(html,/远方撤回和缺席原因不会自动传知/);
});

test('actual appointment walking is travelling, never autonomous waiting or attendance before arrival',()=>{
 const f=fixture();accepted(f);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,1);const status=residentActivity(f.w,f.r);assert.equal(status.kind,'travelling');assert.match(status.label,/亲自赴约/);assert.match(status.detail,/尚未计作现场行动/);assert.ok(socialAppointmentProfile(f.w,f.r).includes(fact('本人实际赴约','尚无实际赴约记录')));finish(f.w,f.r);assert.notEqual(residentActivity(f.w,f.r).kind,'voluntary-wait');assert.match(socialAppointmentProfile(f.w,f.r),/到场，这次在场尚未结束/);
});

test('chosen wait displays actual accumulated minutes and continues after met without automatic talk',()=>{
 const f=fixture(),c=accepted(f,60,90);run(f.w,f.r,choice(f.w,f.r,'attend'));run(f.w,f.peer,choice(f.w,f.peer,'attend'));const duration=c.start-f.w.minute+6;assert.ok(duration>6);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'wait',{minutes:duration})).ok,true);stepWorld(f.w,3);
 assert.equal(residentActivity(f.w,f.r).kind,'voluntary-wait');assert.match(residentActivity(f.w,f.r).label,/自主等候约见/);assert.ok(socialAppointmentProfile(f.w,f.r).includes(fact('本人实际选择等候','3 游戏分钟')));
 stepWorld(f.w,c.start-f.w.minute+1);assert.equal(c.status,'met');assert.equal(residentActivity(f.w,f.r).kind,'voluntary-wait');assert.match(residentActivity(f.w,f.r).detail,/相遇也不会自动结束本段等待/);assert.ok(socialAppointmentProfile(f.w,f.r).includes(fact('世界记录','真实相遇')));assert.ok(socialAppointmentProfile(f.w,f.peer).includes(fact('本人最后获知','真实相遇')));assert.equal(f.w.events.filter(e=>e.kind==='conversation').length,0);finish(f.w,f.r);assert.ok(socialAppointmentProfile(f.w,f.r).includes(fact('本人实际选择等候',`${duration} 游戏分钟`)));assert.notEqual(residentActivity(f.w,f.r).kind,'voluntary-wait');
});

test('static appointment markup escapes hostile names and place names without browser execution',()=>{
 const f=fixture();f.peer.name='<img src=x onerror="boom"> & \'name\'';f.w.buildings[0].name='<script>boom()</script> & "place"';accepted(f);const html=socialAppointmentProfile(f.w,f.r);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.match(html,/&lt;img src=x onerror=&quot;boom&quot;&gt; &amp; &#39;name&#39;/);assert.match(html,/&lt;script&gt;boom\(\)&lt;\/script&gt; &amp; &quot;place&quot;/);assert.ok(residentStatusProfile(f.w,f.r).includes(html));
});

test('all appointment panel reads are pure and SQLite reload displays the same walking and knowledge state',()=>{
 const f=fixture();accepted(f);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,2);const before=structuredClone(f.w),html=socialAppointmentProfile(f.w,f.r),activity=residentActivity(f.w,f.r),profile=residentStatusProfile(f.w,f.r);for(const r of f.w.residents){socialAppointmentProfile(f.w,r);residentActivity(f.w,r);residentStatusProfile(f.w,r);}assert.deepEqual(f.w,before);
 const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.load()!,r=w.residents.find(p=>p.id===f.r.id)!;assert.equal(socialAppointmentProfile(w,r),html);assert.deepEqual(residentActivity(w,r),activity);assert.equal(residentStatusProfile(w,r),profile);const loadedBefore=structuredClone(w);residentStatusProfile(w,r);assert.deepEqual(w,loadedBefore);}finally{store.close();}
});

test('no appointment means no appointment panel or invented attendance',()=>{const f=fixture(),before=structuredClone(f.w);assert.equal(socialAppointmentProfile(f.w,f.r),'');assert.notEqual(residentActivity(f.w,f.r).kind,'voluntary-wait');assert.deepEqual(f.w,before);});

import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import type {Snapshot} from '../src/shared/types.js';

test('observer wire delta, unchanged omission, and reconnect render the same appointment facts',()=>{
 const f=fixture();accepted(f);const snapshot=():Snapshot=>({world:structuredClone(f.w),mapRevision:'appointments-test',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}}),wire=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
 let current=wire(snapshot());assert.deepEqual(applyObserverUpdate(current,wire(observerFrame(current))),current);
 const first=current;assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,2);let next=wire(snapshot()),delta=wire(observerFrame(next,current));assert.equal(Object.hasOwn(delta.world,'socialAppointments'),false,'unchanged appointment collection is omitted during actual walking');current=applyObserverUpdate(current,delta)!;assert.deepEqual(current,next);assert.equal(residentActivity(current.world,current.world.residents[0]).kind,'travelling');
 finish(f.w,f.r);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'wait',{minutes:8})).ok,true);stepWorld(f.w,3);next=wire(snapshot());delta=wire(observerFrame(next,current));assert.equal(Object.hasOwn(delta.world,'socialAppointments'),true);current=applyObserverUpdate(current,delta)!;assert.deepEqual(current,next);assert.ok(socialAppointmentProfile(current.world,current.world.residents[0]).includes(fact('本人实际选择等候','3 游戏分钟')));
 run(f.w,f.peer,choice(f.w,f.peer,'withdraw'));next=wire(snapshot());current=applyObserverUpdate(current,wire(observerFrame(next,current)))!;const reconnected=applyObserverUpdate(first,wire(observerFrame(next)))!;assert.deepEqual(current,next);assert.deepEqual(reconnected,next);assert.equal(residentStatusProfile(current.world,current.world.residents[0]),residentStatusProfile(reconnected.world,reconnected.world.residents[0]));const html=socialAppointmentProfile(current.world,current.world.residents[0]);assert.ok(html.includes(fact('世界记录','已撤回')));assert.ok(html.includes(fact('本人最后获知','双方已接受')));
});

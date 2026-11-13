import assert from 'node:assert/strict';
import {test} from 'node:test';

import {stepWorld} from '../src/world/engine.js';
import {WorldStore} from '../src/server/store.js';
import {accepted,choice,finish,fixture,offered,queue,run} from './helpers/social-appointments.js';

test('appointment records separate remote withdrawal from personal knowledge',()=>{
 const f=fixture(),c=offered(f);
 run(f.w,f.peer,choice(f.w,f.peer,'accept'));
 run(f.w,f.r,choice(f.w,f.r,'attend'));run(f.w,f.r,choice(f.w,f.r,'withdraw'));assert.equal(c.status,'withdrawn');assert.equal(c.known[f.peer.id],'accepted');
});

test('actual appointment walking is travelling, never autonomous waiting or attendance before arrival',()=>{
 const f=fixture();accepted(f);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,1);finish(f.w,f.r);
});

test('chosen wait accumulates real time and continues after met without automatic talk',()=>{
 const f=fixture(),c=accepted(f,60,90);run(f.w,f.r,choice(f.w,f.r,'attend'));run(f.w,f.peer,choice(f.w,f.peer,'attend'));const duration=c.start-f.w.minute+6;assert.ok(duration>6);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'wait',{minutes:duration})).ok,true);stepWorld(f.w,3);

 stepWorld(f.w,c.start-f.w.minute+1);assert.equal(c.status,'met');assert.equal(f.w.events.filter(e=>e.kind==='conversation').length,0);finish(f.w,f.r);
});

test('SQLite reload retains actual appointment walking and knowledge state',()=>{
 const f=fixture();accepted(f);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,2);
 const before=structuredClone(f.w),store=new WorldStore(':memory:');
 try{store.commit(f.w,null);const w=store.load()!,r=w.residents.find(p=>p.id===f.r.id)!;
 assert.deepEqual(w.socialAppointments,before.socialAppointments);assert.deepEqual(r.activity,before.residents.find(p=>p.id===f.r.id)!.activity);
 }finally{store.close();}
});

import {observerFrame} from '../src/server/observer-feed.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import type {Snapshot} from '../src/shared/types.js';

test('observer wire delta, unchanged omission, and reconnect retain the same appointment facts',()=>{
 const f=fixture();accepted(f);const snapshot=():Snapshot=>({world:structuredClone(f.w),mapRevision:'appointments-test',version:'test',serverTime:'test',capabilities:{active:[],pending:[]}}),wire=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
 let current=wire(snapshot());assert.deepEqual(applyObserverUpdate(current,wire(observerFrame(current))),current);
 const first=current;assert.equal(queue(f.w,f.r,choice(f.w,f.r,'attend')).ok,true);stepWorld(f.w,2);let next=wire(snapshot()),delta=wire(observerFrame(next,current));assert.equal(Object.hasOwn(delta.world,'socialAppointments'),false,'unchanged appointment collection is omitted during actual walking');current=applyObserverUpdate(current,delta)!;assert.deepEqual(current,next);
 finish(f.w,f.r);assert.equal(queue(f.w,f.r,choice(f.w,f.r,'wait',{minutes:8})).ok,true);stepWorld(f.w,3);next=wire(snapshot());delta=wire(observerFrame(next,current));assert.equal(Object.hasOwn(delta.world,'socialAppointments'),true);current=applyObserverUpdate(current,delta)!;assert.deepEqual(current,next);
 run(f.w,f.peer,choice(f.w,f.peer,'withdraw'));next=wire(snapshot());current=applyObserverUpdate(current,wire(observerFrame(next,current)))!;const reconnected=applyObserverUpdate(first,wire(observerFrame(next)))!;assert.deepEqual(current,next);assert.deepEqual(reconnected,next);
});

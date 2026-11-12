/** Offline DOM/transport adapters. These assertions do not claim browser or GPU acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {isometricObserverRoute} from '../scripts/isometric-observer-route.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import {clientMainHarness} from './helpers/client-main.js';
import type {ObserverMap} from '../src/client/observer-map.js';
import type {Snapshot} from '../src/shared/types.js';
import * as preview from '../src/client/isometric-preview.js';
import {paintIsometricGround} from '../src/client/isometric-ground.js';
import {residentFollowText} from '../src/client/resident-follow.js';
const route=isometricObserverRoute();
const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('formal optional entry: actual main installs once and shares the sole GET and SSE feed',async()=>{
 const seen:Array<Snapshot|null>=[];let adapter:ObserverMap|undefined,unsubscribe=()=>{};
 const h=await clientMainHarness(route.snapshots[0],async()=>({}),undefined,value=>{adapter=value as ObserverMap;unsubscribe=adapter.subscribe(s=>seen.push(s));});
 assert.equal(h.observerMountCalls,1);assert.equal(h.worldRequests,1);assert.equal(h.eventSources,1);
 assert.equal(seen[0],null);assert.equal(seen.at(-1),h.accepted.at(-1));assert.equal(adapter!.currentSnapshot(),route.snapshots[0]);
 const next=structuredClone(route.snapshots[1]);h.update(next);
 assert.equal(seen.at(-1),h.accepted.at(-1));assert.deepEqual(adapter!.currentSnapshot()!.world,next.world);
 assert.equal(h.observerMountCalls,1);assert.equal(h.worldRequests,1);assert.equal(h.eventSources,1);unsubscribe();
 assert.deepEqual(Object.keys(adapter!).sort(),['cover','currentFollow','currentRoom','currentSnapshot','currentTile','frame','isFullMapTarget','select','setFollowResolver','setViewArea','subscribeViewArea','stopFollowing','subscribe','subscribeFollow','subscribeRoom'].sort());
});

test('formal optional entry: failed optional mounting cannot stop original connection or later updates',async()=>{
 const h=await clientMainHarness(route.snapshots[0],async()=>({}),undefined,()=>{throw new Error('synthetic optional mount failure');});
 assert.equal(h.worldRequests,1);assert.equal(h.eventSources,1);assert.equal(h.accepted.length,1);assert.equal(h.warnings.length,1);
 h.update(route.snapshots[1]);assert.equal(h.accepted.length,2);h.click({action:'home'});assert.equal(h.homeCalls,1);
});

test('formal optional entry: default is passive 2D and repeated installation is idempotent',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);
 assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.model.scene,null);assert.equal(h.model.viewport.stats.bucketBuilds,0);assert.equal(h.base.classes.has('covered-by-preview'),false);
 const subscriptions=h.subscribers(),nodes=h.app.children.length;
 for(let i=0;i<12;i++)assert.equal(h.remount(),h.handle);
 assert.deepEqual(h.subscribers(),subscriptions);assert.equal(h.app.children.length,nodes);assert.equal(h.document.listeners.get('click')!.size,2);
 h.accept(route.snapshots[1]);assert.equal(h.model.viewport.stats.bucketBuilds,0);assert.equal(h.model.scene,null);h.dispose();
});

test('formal optional entry: development compatibility entry shares existing mount and disposal',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);let dispose=()=>{},calls=0;
 const text=source('src/client/development-preview.ts').replace(/^import .*;\n/gm,'').replaceAll('import.meta.hot','__hot');
 runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{observerMap:{},mountIsometricObserver:()=>{calls++;return h.remount();},__hot:{dispose:(fn:()=>void)=>{dispose=fn;}}});
 assert.equal(calls,1);assert.equal(h.app.children.length,2);assert.equal(h.document.listeners.get('click')!.size,2);assert.equal(h.canvas.hidden,true);
 dispose();assert.equal(h.canvas.removed,true);assert.deepEqual(h.subscribers(),[null,null,null]);
});

test('formal optional entry: repeated switching and Escape restore 2D without timers or input capture',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);
 for(let i=0;i<12;i++){h.handle.activate();h.handle.activate();assert.equal(h.canvas.hidden,false);assert.equal(h.intervals.size,1);assert.equal(h.covers.at(-1),true);h.canvas.emit('pointerdown',{pointerId:23});assert.equal(h.canvas.captures.has(23),true);h.document.emit('keydown',{key:'Escape'});assert.equal(h.canvas.captures.size,0);assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.covers.at(-1),false);assert.equal(h.base.classes.has('covered-by-preview'),false);}
 h.dispose();
});

test('formal optional entry: missing Canvas2D retains original view and an explicit unavailable notice',()=>{
 const h=observerPreviewHarness(undefined,undefined,false);h.accept(route.snapshots[0]);h.handle.activate();
 assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.tray.querySelector('[data-view="iso"]').disabled,true);assert.match(h.tray.querySelector('.preview-notice').textContent,/不支持2.5D/);assert.equal(h.covers.includes(true),false);h.dispose();
});

test('formal optional entry: bad active snapshots restore 2D and require a later valid snapshot plus user retry',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);h.handle.activate();const previous=h.model.snapshot;
 const bad=structuredClone(route.snapshots[0]);bad.world.map.width=0;h.accept(bad);
 assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.model.snapshot,previous);assert.equal(h.tray.querySelector('[data-view="iso"]').disabled,true);assert.equal(h.covers.at(-1),false);
 h.accept(route.snapshots[1]);assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.tray.querySelector('[data-view="iso"]').disabled,false);h.handle.activate();assert.equal(h.canvas.hidden,false);h.dispose();
});

test('formal optional entry: unsupported routes explicitly fall back instead of hiding or inventing scenes',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);
 for(const dataset of [{panel:'atlas'},{region:'outside'},{project:'unrestored'},{action:'trade-station'}] as Array<Record<string,string>>){h.handle.activate();const target=new ObserverElement();target.dataset=dataset;h.document.emit('click',{target});assert.equal(h.canvas.hidden,true);assert.match(h.tray.querySelector('.preview-notice').textContent,/2D/);assert.equal(h.intervals.size,0);}
 const inside=structuredClone(route.snapshots.find(s=>s.world.residents.find(r=>r.id===route.personId)?.inside)!);inside.world.buildings.find(b=>b.id===route.buildingId)!.kind='greenhouse';h.accept(inside);h.enter(route.buildingId);h.handle.activate();assert.equal(h.canvas.hidden,true);assert.equal(h.room(),route.buildingId);assert.match(h.tray.querySelector('.preview-notice').textContent,/2D/);h.dispose();
});

test('formal optional entry: disposing an active mount is idempotent, inert and allows clean reinstall',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);h.handle.activate();h.canvas.emit('pointerdown');h.dispose();h.dispose();
 assert.equal(h.canvas.captures.size,0);assert.equal(h.intervals.size,0);assert.equal(h.covers.at(-1),false);assert.deepEqual(h.subscribers(),[null,null,null]);
 for(const event of ['click','keydown','visibilitychange'])assert.equal(h.document.listeners.get(event)?.size??0,0);
 assert.equal(h.window.listeners.get('resize')?.size??0,0);h.handle.activate();h.toggle();assert.equal(h.intervals.size,0);assert.equal(h.canvas.hidden,true);
 const next=h.remount();assert.notEqual(next,h.handle);assert.equal(h.app.children.filter(e=>!e.removed).length,2);assert.equal(h.document.listeners.get('click')!.size,2);next.dispose();assert.deepEqual(h.subscribers(),[null,null,null]);
});

test('formal optional entry: production graph uses no development source, network owner or simulation controls',()=>{
 const main=source('src/client/main.ts'),observer=source('src/client/isometric-observer.ts');
 assert.match(main,/mountIsometricObserver\(observerMap\)/);assert.doesNotMatch(main,/(?:from|import)[^\n]*(?:development-preview|dev-observer)/);
 assert.doesNotMatch(observer,/\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|submitPlan|stepWorld)\b|from ['"][^'"]*\/(?:server|scripts)\/|from ['"][^'"]*\/main\.js|process\.env|localStorage/);
 assert.match(observer,/let active=false/);assert.match(observer,/subscribe\(/);assert.match(observer,/全图定位仍使用原2D/);
 assert.doesNotMatch(source('src/client/observer-map.ts'),/\b(?:pause|resume|resetWorld|submitPlan|stepWorld|model|fetch)\s*\(/);
});

function failedInstaller(){
 const app=new ObserverElement(),hud=new ObserverElement(),base=new ObserverElement(),hint=new ObserverElement(),document=new ObserverElement(),window=new ObserverElement();
 const subscriptions={snapshot:new Set<unknown>(),room:new Set<unknown>(),follow:new Set<unknown>()},warnings:unknown[][]=[],covers:boolean[]=[];let failFollow=true,failUnsubscribe=false,interval=0;
 const timers=new Set<number>();
 const subscribe=(name:keyof typeof subscriptions,listener:(...args:any[])=>void)=>{
  if(name==='follow'&&failFollow)throw new Error('synthetic late installation failure');
  subscriptions[name].add(listener);if(name==='snapshot')listener(route.snapshots[0],true);else listener(null);
  return ()=>{subscriptions[name].delete(listener);if(name==='room'&&failUnsubscribe)throw new Error('synthetic cleanup failure after removal');};
 };
 const adapter={currentSnapshot:()=>route.snapshots[0],currentRoom:()=>null,currentTile:()=>({x:415,y:230}),currentFollow:()=>null,stopFollowing(){},setFollowResolver(){},frame(){},select(){},isFullMapTarget:()=>false,cover:(value:boolean)=>covers.push(value),subscribe:(listener:(...args:any[])=>void)=>subscribe('snapshot',listener),subscribeRoom:(listener:(...args:any[])=>void)=>subscribe('room',listener),subscribeFollow:(listener:(...args:any[])=>void)=>subscribe('follow',listener)};
 Object.assign(document,{hidden:false,createElement:()=>new ObserverElement(),getElementById:(id:string)=>id==='app'?app:id==='observer-hud'?hud:base,querySelector:()=>hint});
 Object.assign(window,{setInterval:()=>{timers.add(++interval);return interval;}});
 const context:any={...preview,paintIsometricGround,residentFollowText,document,window,Element:ObserverElement,performance:{now:()=>0},clearInterval:(id:number)=>timers.delete(id),console:{warn:(...args:unknown[])=>warnings.push(args)}};
 const text=source('src/client/isometric-observer.ts').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';this.mount=mountIsometricObserver;',context);
 return {app,hud,base,document,window,subscriptions,warnings,covers,timers,mount:()=>context.mount(adapter) as import('../src/client/isometric-observer.js').IsometricObserverHandle,allowFollow:()=>{failFollow=false;},failUnsubscribe:()=>{failUnsubscribe=true;}};
}

test('formal optional entry: late failed installation reverses acquired resources before clean retry',()=>{
 const h=failedInstaller();assert.throws(()=>h.mount(),/late installation failure/);
 assert.equal(h.app.children.filter(e=>!e.removed).length,0);assert.equal(h.hud.children.filter(e=>!e.removed).length,0);
 for(const set of Object.values(h.subscriptions))assert.equal(set.size,0);
 for(const set of h.document.listeners.values())assert.equal(set.size,0);for(const set of h.window.listeners.values())assert.equal(set.size,0);
 h.allowFollow();const handle=h.mount();assert.equal(h.mount(),handle);assert.equal(h.app.children.filter(e=>!e.removed).length,1);assert.equal(h.hud.children.filter(e=>!e.removed).length,1);
 handle.activate();assert.equal(h.timers.size,1);handle.dispose();for(const set of Object.values(h.subscriptions))assert.equal(set.size,0);assert.equal(h.timers.size,0);assert.equal(h.covers.at(-1),false);
});

test('formal optional entry: one failed cleanup does not prevent remaining subscription, listener and DOM release',()=>{
 const h=failedInstaller();h.allowFollow();h.failUnsubscribe();const handle=h.mount();handle.activate();assert.equal(h.base.classes.has('covered-by-preview'),true);
 assert.doesNotThrow(()=>handle.dispose());assert.equal(h.warnings.length,1);assert.equal(h.timers.size,0);assert.equal(h.base.classes.has('covered-by-preview'),false);assert.equal(h.covers.at(-1),false);
 for(const set of Object.values(h.subscriptions))assert.equal(set.size,0);for(const set of h.document.listeners.values())assert.equal(set.size,0);for(const set of h.window.listeners.values())assert.equal(set.size,0);
 assert.equal(h.app.children.filter(e=>!e.removed).length,0);assert.equal(h.hud.children.filter(e=>!e.removed).length,0);handle.activate();assert.equal(h.timers.size,0);assert.doesNotThrow(()=>handle.dispose());
});

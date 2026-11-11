import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {isometricObserverRoute} from '../scripts/isometric-observer-route.js';
import {observerPreviewSnapshot,observerPreviewHandler} from '../scripts/dev-observer-server.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {screenToIsometric} from '../src/client/isometric-projection.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import {applyObserverUpdate} from '../src/shared/observer.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {personVisual} from '../src/client/person-pose.js';
import type {Snapshot} from '../src/shared/types.js';
const route=isometricObserverRoute();
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
function model(snapshot=route.snapshots[0]){const m=new IsometricPreview();m.setActive(true);m.setConnected(true);m.accept(snapshot);m.resize(960,640);return m;}
test('observer restoration: same real engine positions across blocks and home round trips, immutable snapshots',()=>{
 const m=model();let indoor=0;for(const [i,s] of route.snapshots.entries()){
  const before=structuredClone(s);freeze(s);m.accept(s);const r=s.world.residents.find(r=>r.id===route.personId)!,reason=m.followResident(r.id);
  assert.equal(reason,null,route.labels[i]);const o=m.scene!.objects.find(o=>o.subject.id===r.id)!;assert.ok(o);assert.deepEqual(previewSelection(o.subject),{kind:'person',id:r.id});if(r.inside){indoor++;assert.equal(m.roomId,r.inside);assert.deepEqual(o.subject.at,r.roomAt);assert.equal(o.subject.roomId,r.inside);}else {assert.equal(m.roomId,null);assert.deepEqual(o.subject.at,r.at);}
  m.tick(i*125);assert.deepEqual(s,before);
 }
 assert.ok(indoor>0);assert.ok(route.snapshots.some(s=>s.world.residents[0].at.x===398));assert.equal(route.snapshots.at(-1)!.world.residents[0].inside,null);
});
test('observer restoration: pause disconnect hidden inactive and stale frames cannot catch up or roll back position',()=>{
 const s=structuredClone(route.snapshots[0]);s.world.clock.paused=false;const m=model(s);m.tick(0);m.tick(125);
 for(const set of [(v:boolean)=>m.setConnected(v),(v:boolean)=>m.setVisible(v),(v:boolean)=>m.setActive(v)]){const elapsed=m.elapsed;set(false);m.tick(99999);m.tick(199999);set(true);m.tick(299999);assert.equal(m.elapsed,elapsed);m.tick(300124);assert.equal(m.elapsed,elapsed+125);}
 const newer=structuredClone(s);newer.world.revision+=3;m.accept(newer);const scene=m.scene;assert.equal(m.accept(s),false);assert.equal(m.scene,scene);assert.equal(m.snapshot,newer);
 const paused=structuredClone(newer);paused.world.clock.paused=true;m.accept(paused);const time=m.elapsed;m.tick(900000);m.tick(999999);assert.equal(m.elapsed,time);
});
test('observer restoration: center preserved across resize and inactive updates defer rendering',()=>{
 const m=model();m.center({x:398,y:233});for(const [w,h] of [[390,844],[2560,1600],[800,600]]){m.resize(w,h);const at=screenToIsometric({x:w/2,y:h/2},m.camera!)!;assert.ok(Math.abs(at.x-398)<1e-9&&Math.abs(at.y-233)<1e-9);}
 const builds=m.viewport.stats.bucketBuilds;m.setActive(false);const next=structuredClone(route.snapshots[0]);next.world.id='inactive-replacement';m.accept(next);assert.equal(m.scene,null);assert.equal(m.viewport.stats.bucketBuilds,builds);m.setActive(true);m.rebuild();assert.ok(m.scene);
});
test('observer restoration VM: opt in, original center, drag cancels follow, cancel cannot select, nearest-neighbor and cleanup',()=>{
 const h=observerPreviewHarness({x:398,y:233});assert.equal(h.canvas.hidden,true);h.accept(route.snapshots[0]);h.toggle();assert.equal(h.canvas.hidden,false);assert.equal(h.intervals.size,1);h.toggle();assert.equal(h.intervals.size,1);
 h.startFollow(route.personId);h.canvas.emit('pointerdown');h.canvas.emit('pointermove',{clientX:250});h.canvas.emit('pointerup',{clientX:250});assert.equal(h.follow.state,null);assert.equal(h.selections.length,0);
 h.canvas.emit('pointerdown');h.canvas.emit('pointercancel');h.canvas.emit('pointerup');assert.equal(h.selections.length,0);h.canvas.emit('pointerdown');h.canvas.emit('pointerup');assert.equal(h.selections.length,1);
 assert.equal(h.canvas.context.imageSmoothingEnabled,false);assert.ok(h.created.filter(e=>e!==h.canvas).every(e=>e.integerFills));h.toggle('2d');assert.ok(h.frames.length>0);h.dispose();assert.equal(h.canvas.removed,true);assert.equal(h.intervals.size,0);assert.deepEqual(h.subscribers(),[null,null,null]);assert.equal(h.base.classes.has('covered-by-preview'),false);
});
test('observer restoration VM: same identity remains isometric across actual home entry and exit; manual rooms preserve2D handback',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);h.toggle();h.startFollow(route.personId);let entered=0;
 for(const s of route.snapshots){h.accept(s);const r=s.world.residents.find(r=>r.id===route.personId)!;assert.equal(h.canvas.hidden,false,JSON.stringify(h.warnings));assert.equal(h.follow.state!.personId,route.personId);assert.equal(h.model.roomId,r.inside);if(r.inside){entered++;assert.equal(h.room(),r.inside);}}
 assert.ok(entered>0);assert.equal(h.intervals.size,1);assert.equal(h.room(),null);
 const button=new ObserverElement();button.dataset.enter=route.buildingId;assert.equal(h.document.emit('click',{target:button}).stopped,false);h.enter(route.buildingId);assert.equal(h.canvas.hidden,false);assert.equal(h.model.roomId,route.buildingId);
 h.document.emit('keydown',{key:'Escape'});assert.equal(h.canvas.hidden,true);assert.equal(h.room(),route.buildingId);assert.equal(h.intervals.size,0);h.toggle();assert.equal(h.canvas.hidden,false);h.enter(null);assert.equal(h.model.roomId,null);assert.equal(h.canvas.hidden,false);h.dispose();
});
test('observer home transitions: missing exact position and nonhome rooms fall back without changing original follow identity',()=>{
 const inside=structuredClone(route.snapshots.find(s=>s.world.residents.find(r=>r.id===route.personId)?.inside)!);inside.world.residents.find(r=>r.id===route.personId)!.roomAt=null;
 const h=observerPreviewHarness();h.accept(inside);h.startFollow(route.personId);h.toggle();assert.equal(h.canvas.hidden,true);assert.equal(h.follow.state!.personId,route.personId);assert.equal(h.room(),route.buildingId);assert.match(h.tray.querySelector('.preview-notice').textContent,/精确位置/);assert.equal(h.intervals.size,0);h.dispose();
 const p=model();const other=structuredClone(route.snapshots[0]);other.world.buildings.find(b=>b.id===route.buildingId)!.kind='barn';p.accept(other);const before=p.scene;assert.notEqual(p.setRoom(route.buildingId),null);assert.equal(p.roomId,null);assert.equal(p.scene,before);
});
test('observer home transitions: indoor resize preserves local view and restores separate outdoor camera',()=>{
 const p=model(route.snapshots.at(-1)!);p.center({x:398,y:233});const original=p.centerPoint!;assert.equal(p.setRoom(route.buildingId),null);p.center({x:5.5,y:6.5});p.resize(390,844);assert.ok(Math.abs(p.centerPoint!.x-5.5)<1e-9);assert.ok(Math.abs(p.centerPoint!.y-6.5)<1e-9);assert.equal(p.centerTile,null);p.setRoom(null);assert.ok(Math.abs(p.centerPoint!.x-original.x)<1e-9);assert.ok(Math.abs(p.centerPoint!.y-original.y)<1e-9);
});
test('observer restoration VM: native locate stays active, full-map and unsupported entry fallback, malformed snapshots recover',()=>{
 const h=observerPreviewHarness();h.accept(route.snapshots[0]);h.toggle();const button=new ObserverElement();button.dataset.locate=route.buildingId;assert.equal(h.document.emit('click',{target:button}).stopped,false);assert.equal(h.canvas.hidden,false);h.document.emit('click',{target:h.atlas});assert.equal(h.canvas.hidden,true);h.toggle();
 const bad=structuredClone(route.snapshots[0]);bad.world.map.width=0;assert.doesNotThrow(()=>h.accept(bad));assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);assert.equal(h.tray.querySelector('[data-view="iso"]').disabled,true);h.accept(route.snapshots[0]);h.toggle();assert.equal(h.canvas.hidden,false);h.dispose();
});
test('observer restoration: isolated web source selection cannot readenv or target arbitrary endpoints and production stays2D',async()=>{
 const {observerWebConfig,observerWebConfigForSource,observerReadOnlyAPI}=await import(new URL('../scripts/dev-observer-web.mjs',import.meta.url).href);
 for(const [method,url,status] of [['GET','/ai-town/api/world',0],['GET','/ai-town/api/events',0],['POST','/ai-town/api/world',405],['GET','/ai-town/api/model',404]] as const){let next=0;const response={statusCode:0,setHeader(){},end(){}};observerReadOnlyAPI({method,url},response,()=>next++);assert.equal(response.statusCode,status);assert.equal(next,status===0?1:0);}
 assert.equal(observerWebConfig.envFile,false);assert.equal(observerWebConfig.configFile,false);assert.equal(observerWebConfig.publicDir,false);assert.equal(observerWebConfig.plugins[0].apply,'serve');assert.equal(observerWebConfigForSource('live').server.proxy['/ai-town/api'],'http://127.0.0.1:3412');assert.equal(observerWebConfigForSource().server.proxy['/ai-town/api'],'http://127.0.0.1:3413');assert.throws(()=>observerWebConfigForSource('https://untrusted.invalid'));
 for(const name of ['src/client/main.ts','src/client/scene.ts','index.html','vite.config.ts'])assert.doesNotMatch(readFileSync(new URL('../'+name,import.meta.url),'utf8'),/(?:from|import)[^\n]*(?:isometric-study|development-preview|dev-observer)/);
 assert.match(readFileSync(new URL('../src/client/main.ts',import.meta.url),'utf8'),/mountIsometricObserver\(observerMap\)/);
});
test('observer restoration: synthetic backend only serves paused immutable GET snapshot and SSE; no store/model/control route',()=>{
 const snapshot=observerPreviewSnapshot(),before=structuredClone(snapshot);freeze(snapshot);const handler=observerPreviewHandler(snapshot);
 for(const [method,url,status] of [['GET','/ai-town/api/world',200],['GET','/ai-town/api/events',200],['POST','/ai-town/api/world',405],['GET','/ai-town/api/model',404]] as const){
  const request=Object.assign(new EventEmitter(),{method,url}),response={status:0,body:'',setHeader(){},writeHead(n:number){this.status=n;},write(text:string){this.body+=text;},end(text:string){this.body+=text;}};handler(request as any,response as any);assert.equal(response.status,status);if(status===200)assert.match(response.body,/synthetic-observer-preview/);if(url.endsWith('/events')&&status===200){assert.match(response.body,/^event: update/);const update=JSON.parse(response.body.split('data: ')[1].trim());assert.deepEqual(applyObserverUpdate(snapshot,update)!.world,snapshot.world);}request.emit('close');
 }
 assert.equal(snapshot.world.clock.paused,true);assert.deepEqual(snapshot,before);const source=readFileSync(new URL('../scripts/dev-observer-server.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"][^'"]*(?:store|runtime|model)[^'"]*['"]|process\.env|stepWorld|submitPlan|readFile/);
});
test('observer home transitions: indoor clock freezes on pause disconnect hide and inactive view',()=>{
 const s=structuredClone(route.snapshots.find(s=>s.world.residents.find(r=>r.id===route.personId)?.inside)!);s.world.clock.paused=false;const p=model(s);assert.equal(p.followResident(route.personId),null);p.tick(0);p.tick(125);
 for(const set of [(v:boolean)=>p.setConnected(v),(v:boolean)=>p.setVisible(v),(v:boolean)=>p.setActive(v)]){const before=p.elapsed;set(false);p.tick(10000);set(true);p.tick(20000);assert.equal(p.elapsed,before);p.tick(20125);assert.equal(p.elapsed,before+125);}
 const paused=structuredClone(s);paused.world.clock.paused=true;p.accept(paused);const before=p.elapsed,scene=p.scene;p.tick(50000);p.tick(999999);assert.equal(p.elapsed,before);assert.equal(p.scene,scene);assert.equal(p.roomId,route.buildingId);
});

test('observer home transitions: normal engine sleep is drawn only after actual bed arrival',()=>{
 const world=structuredClone(route.snapshots.at(-1)!.world),r=world.residents.find(r=>r.id===route.personId)!;world.clock.paused=false;
 const submitted=submitPlan(world,{id:'observer-home-sleep',actorId:r.id,actorRevision:r.revision,createdAt:world.minute,definition:world.activeDefinitions['action/routine'],intention:'Scripted offline sleep validation, not an autonomous model choice',actions:[{type:'sleep',minutes:5}]});assert.equal(submitted.ok,true);
 const p=new IsometricPreview();p.setActive(true);p.setConnected(true);let steps=0,sleeping=0,approaching=0;
 while(r.plan||r.activity){assert.ok(++steps<=180);stepWorld(world,1);assert.equal(r.lastFailure,null);const s:Snapshot={world:structuredClone(world),serverTime:'offline-engine-sleep',version:'synthetic-test',capabilities:{active:[],pending:[]}};p.accept(s);if(!p.camera)p.resize(800,600);assert.equal(p.followResident(r.id),null);const visual=personVisual(s.world,s.world.residents.find(v=>v.id===r.id)!);
  if(r.activity?.room?.path.length){approaching++;assert.notEqual(visual.pose,'sleep');}
  if(visual.pose==='sleep'){sleeping++;assert.equal(r.inside,route.buildingId);const object=p.scene!.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===r.id)!;assert.deepEqual(object.subject.at,r.roomAt);assert.equal(object.subject.placeholder,undefined);assert.equal(object.subject.roomId,route.buildingId);}
 }
 assert.ok(approaching>0);assert.ok(sleeping>0);
});
test('observer home transitions: animation and status text do not rescan source record collections',()=>{
 const s=structuredClone(route.snapshots.find(s=>s.world.residents.find(r=>r.id===route.personId)?.inside)!);s.world.clock.paused=false;const p=model(s);assert.equal(p.followResident(route.personId),null);p.tick(0);
 for(const key of ['buildings','residents','industry','health','estates','culture','household'] as const)Object.defineProperty(s.world,key,{get(){throw new Error('unexpected animation collection scan: '+key);}});
 assert.doesNotThrow(()=>p.tick(125));assert.match(p.summary,/住宅室内/);
});

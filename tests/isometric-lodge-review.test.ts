/** Independent CPU/source review. Renderer/event spies are not browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {isometricLodgeRoute} from '../scripts/isometric-lodge-route.js';
import {ordinaryCookingVisual} from '../src/client/isometric-cooking.js';
import * as preview from '../src/client/isometric-preview.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {roomLayout} from '../src/shared/rooms.js';
import {calendar,daylight,daylightLabels} from '../src/world/time.js';
import {paintIsometricGround} from '../src/client/isometric-ground.js';
import {residentFollowText} from '../src/client/resident-follow.js';
import {personVisual} from '../src/client/person-pose.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import type {Snapshot,Vec} from '../src/shared/types.js';

const route=isometricLodgeRoute();
const stage=(label='cook:working')=>structuredClone(route.snapshots[route.labels.indexOf(label)]);
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
function model(s=stage()){const p=new preview.IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
/** Actual receive, ValleyScene and preview controller, with only rendering/DOM/time adapters. */
function integrated(){
 const {scene,camera}=residentSceneHarness(),app=new ObserverElement(),base=new ObserverElement(),hint=new ObserverElement(),doc=new ObserverElement(),win=new ObserverElement();
 let roomId:string|null=null,dispose=()=>{},nextTimer=0;
 const maps=new Set<(s:Snapshot|null,c:boolean)=>void>(),rooms=new Set<()=>void>(),follows=new Set<()=>void>(),timers=new Map<number,()=>void>();
 const warnings:unknown[][]=[],order:string[]=[],frames:Vec[]=[],covers:boolean[]=[];
 const source=readFileSync(new URL('../src/client/main.ts',import.meta.url),'utf8');
 const ctx:any={scene,calendar,daylight,daylightLabels,names:{spring:'spring',summer:'summer',autumn:'autumn',winter:'winter'},icon:()=>'',snapshot:null,connected:false,selection:null,detailId:null,activePanel:null,panelPositions:{clear(){}},closePanel(){},el:()=>({classList:{add(){},toggle(){}},innerHTML:'',textContent:'',title:''}),updateStatus(){order.push('map');for(const fn of maps)fn(ctx.snapshot,ctx.connected);},renderSelection(){},observeArchives(){},renderPanel(){}};
 const receive=source.slice(source.indexOf('function receive('),source.indexOf('scene.onSelection='));
 runInNewContext(ts.transpileModule(receive,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.receive=receive;',ctx);
 let originalClick:(e:unknown)=>void=()=>{};ctx.document={addEventListener:(_type:string,fn:typeof originalClick)=>{originalClick=fn;}};
 const clickSource=source.slice(source.indexOf("document.addEventListener('click'"),source.indexOf("document.addEventListener('submit'"));
 runInNewContext(ts.transpileModule(clickSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 scene.onRoom=b=>{assert.equal((scene as any).snapshot,ctx.snapshot);roomId=b?.id??null;order.push('room:'+roomId);for(const fn of rooms)fn();};
 scene.onFollow=()=>{assert.equal((scene as any).snapshot,ctx.snapshot);order.push('follow');for(const fn of follows)fn();};
 const observerMap={currentSnapshot:()=>ctx.snapshot,currentRoom:()=>roomId,currentTile:()=>scene.cameraTile(),currentFollow:()=>scene.followState,setFollowResolver:scene.setObserverFollowResolver.bind(scene),stopFollowing:()=>scene.stopFollowing(),frame:(at:Vec)=>{frames.push(at);scene.watchTile(at);},cover:(on:boolean)=>covers.push(on),isFullMapTarget:()=>false,select:()=>scene.stopFollowing(),subscribe:(fn:(s:Snapshot|null,c:boolean)=>void)=>{maps.add(fn);fn(ctx.snapshot,false);return ()=>maps.delete(fn);},subscribeRoom:(fn:()=>void)=>{rooms.add(fn);fn();return ()=>rooms.delete(fn);},subscribeFollow:(fn:()=>void)=>{follows.add(fn);fn();return ()=>follows.delete(fn);}};
 const document=Object.assign(doc,{hidden:false,createElement:()=>new ObserverElement(),getElementById:(id:string)=>id==='app'||id==='observer-hud'?app:base,querySelector:()=>hint});
 const window=Object.assign(win,{setInterval:(fn:()=>void)=>{timers.set(++nextTimer,fn);return nextTimer;}});
 const extension=readFileSync(new URL('../src/client/isometric-observer.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const extensionContext:any={...preview,paintIsometricGround,observerMap,residentFollowText,document,window,Element:ObserverElement,console:{warn:(...args:unknown[])=>warnings.push(args)},performance:{now:()=>0},clearInterval:(id:number)=>timers.delete(id)};
 runInNewContext(ts.transpileModule(extension,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';this.observerHandle=mountIsometricObserver(observerMap);',extensionContext);dispose=()=>extensionContext.observerHandle.dispose();
 const canvas=app.children[0],tray=app.children[1];
 // Invoke the real handlers in DOM capture/original-bubble/after-bubble order.
 // This verifies routing logic, not native browser propagation or pointer behavior.
 const click=(dataset:Record<string,string>)=>{const target=new ObserverElement();target.dataset=dataset;let stopped=false;const event={target,preventDefault(){},stopImmediatePropagation(){stopped=true;}};const [capture,after]=[...doc.listeners.get('click')!];capture(event);if(!stopped)originalClick(event);if(!stopped)after(event);return stopped;};
 return {scene,camera,canvas,tray,document,window,frames,covers,warnings,order,timers,click,selection:()=>ctx.selection,room:()=>roomId,accept:(s:Snapshot)=>ctx.receive(s),toggle:(view='iso')=>tray.emit('click',{target:tray.querySelector(`[data-view="${view}"]`)}),dispose:()=>dispose()};
}

test('independent lodge: actual main receive + ValleyScene follow survives scripted engine entry, cook and exit',()=>{
 const h=integrated();h.accept(stage('seed'));assert.equal(h.canvas.hidden,true);h.toggle();h.scene.focusPerson(route.personId);
 let previous:string|null=null;
 for(const s of route.snapshots.slice(1)){
  const r=person(s),transition=previous!==r.inside;if(transition)h.canvas.emit('pointerdown',{pointerId:17});h.accept(s);
  assert.equal(h.scene.followState?.personId,r.id);assert.equal(h.room(),r.inside);assert.equal(h.canvas.hidden,false);
  if(previous!==r.inside)assert.equal(h.canvas.captures.has(17),false);
  if(transition)h.canvas.emit('pointerup',{pointerId:17});previous=r.inside;
 }
 assert.equal(h.warnings.length,0);assert.equal(h.timers.size,1);h.dispose();assert.equal(h.timers.size,0);
});

test('independent lodge: original manual enter/exit, locate and 2D handback retain room and identity routes',()=>{
 const h=integrated();h.accept(stage('exit:completed'));h.toggle();
 assert.equal(h.click({enter:route.buildingId}),false);assert.equal(h.room(),route.buildingId);assert.equal(h.canvas.hidden,false);
 const frames=h.frames.length;h.toggle('2d');assert.equal(h.room(),route.buildingId);assert.equal(h.frames.length,frames);assert.equal(h.timers.size,0);
 h.toggle();h.click({action:'exitroom'});assert.equal(h.room(),null);assert.equal(h.canvas.hidden,false);
 h.click({enter:route.buildingId});h.click({locate:route.buildingId});assert.equal(h.room(),null);assert.deepEqual(JSON.parse(JSON.stringify(h.selection())),{kind:'building',id:route.buildingId});
 assert.equal(h.warnings.length,0);h.dispose();
});

test('independent lodge: exact furniture and resident coordinates, no navigation furniture or output claims',()=>{
 const s=stage(),before=structuredClone(s);freeze(s);const p=model(s);assert.equal(p.setRoom(route.buildingId),null);
 const b=s.world.buildings.find(b=>b.id===route.buildingId)!,layout=roomLayout(s.world,b),objects=p.scene!.objects;
 assert.deepEqual(objects.filter(o=>o.subject.kind==='roomSlot').map(o=>o.subject.id).sort(),layout.slots.filter(slot=>['bed','table','kitchen'].includes(slot.kind)).map(slot=>slot.key).sort());
 const actor=objects.find(o=>o.subject.kind==='resident'&&o.subject.id===route.personId)!;assert.deepEqual(actor.subject.at,person(s).roomAt);assert.match(actor.subject.description!,/不证明/);
 for(const object of objects){assert.ok(['resident','roomSlot'].includes(object.subject.kind));if(object.subject.kind==='roomSlot')assert.deepEqual(object.subject.at,layout.slots.find(slot=>slot.key===object.subject.id)!.at);}
 let hits=0;for(const mark of actor.marks){const hit=p.pick({x:(mark.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(mark.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident'&&hit.id===route.personId){assert.deepEqual(preview.previewSelection(hit),{kind:'person',id:route.personId});hits++;}}
 assert.ok(hits>0);p.tick(0);p.tick(500);assert.deepEqual(s,before);
});

test('independent lodge: pause, disconnect and hidden page freeze cooking without rebuilding source collections',()=>{
 const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(stage());h.toggle();h.startFollow(route.personId);
 const p=h.model;p.tick(0);p.tick(280);const at=()=>p.scene!.objects.find(o=>o.subject.id===route.personId)!.marks;
 const before=structuredClone(at()),stats=p.interior.stats;
 h.connection(false);p.tick(5000);assert.deepEqual(at(),before);assert.equal(h.intervals.size,1);
 h.connection(true);h.document.hidden=true;h.document.emit('visibilitychange');p.tick(9000);assert.deepEqual(at(),before);
 h.document.hidden=false;h.document.emit('visibilitychange');const paused=stage();paused.world.revision++;paused.world.clock.paused=true;h.accept(paused);const frozen=structuredClone(at());p.tick(11000);p.tick(12000);assert.deepEqual(at(),frozen);assert.equal(h.intervals.size,1);
 assert.equal(p.interior.stats.floorBuilds,stats.floorBuilds);assert.equal(h.warnings.length,0);h.dispose();
});

test('independent lodge: unsupported and missing-position follow clearly hand back to original2D',()=>{
 for(const missing of [false,true]){const s=stage();if(missing)person(s).roomAt=null;else person(s).lifeStage='infant';
  const p=model(s);const reason=p.followResident(route.personId);assert.ok(reason);assert.match(reason!,missing?/精确位置/:/姿态/);
  const h=integrated();h.accept(stage('seed'));h.toggle();h.scene.focusPerson(route.personId);h.accept(s);assert.equal(h.canvas.hidden,true);assert.equal(h.scene.followState?.personId,route.personId);assert.equal(h.room(),route.buildingId);assert.equal(h.timers.size,0);h.dispose();
 }
});

test('independent lodge: snapshot replacement is atomic and cached old cooking scenes cannot animate',()=>{
 const p=model();assert.equal(p.setRoom(route.buildingId),null);const old=p.scene!,snapshot=p.snapshot,stats=p.interior.stats;
 const bad=stage();bad.world.residents.push(structuredClone(person(bad)));assert.throws(()=>p.accept(bad));assert.equal(p.scene,old);assert.equal(p.snapshot,snapshot);assert.deepEqual(p.interior.stats,stats);
 const done=stage('cook:completed');p.accept(done);assert.equal(p.interior.animate(old as any,800),old);assert.equal(p.scene!.objects.find(o=>o.subject.id===route.personId)!.subject.description,undefined);
 const h=integrated();h.accept(stage());h.scene.focusPerson(route.personId);h.toggle();const replacement=stage('seed');replacement.world.id='independent-lodge-replacement';replacement.mapRevision=replacement.world.id;replacement.world.residents=[];replacement.world.buildings=[];h.accept(replacement);assert.equal(h.scene.followState,null);assert.equal(h.room(),null);assert.equal(h.warnings.length,0);h.dispose();
});

test('independent lodge: animation resolves cooking once and respects deterministic object, mark and cache budgets',()=>{
 const s=stage(),r=person(s);s.world.residents=Array.from({length:240},(_,i)=>({...structuredClone(r),id:`review-cook-${String(i).padStart(3,'0')}`}));
 const p=model(s);assert.equal(p.setRoom(route.buildingId),null);const view=p.scene!,stats=p.interior.stats;assert.ok(view.omittedObjects>0);
 const budget=()=>{assert.ok(p.scene!.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(p.scene!.terrain.length+p.scene!.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);assert.ok(p.interior.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(p.interior.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);};budget();
 const keys=view.objects.map(o=>o.key);for(const t of [0,280,560,840,1120]){p.tick(t);budget();}
 assert.equal(p.interior.stats.poseBuilds,stats.poseBuilds);assert.equal(p.interior.stats.bucketBuilds,stats.bucketBuilds);assert.equal(p.interior.stats.floorBuilds,stats.floorBuilds);
 const shuffled=structuredClone(s);shuffled.world.revision++;shuffled.world.residents.reverse();p.accept(shuffled);assert.deepEqual(p.scene!.objects.map(o=>o.key),keys);budget();
});

test('independent lodge: cooking requires validated original evidence and never consults mutated source during animation',()=>{
 const s=stage(),r=person(s),layout=roomLayout(s.world,s.world.buildings.find(b=>b.id===route.buildingId)!);
 const v=ordinaryCookingVisual(s.world,r,layout,personVisual(s.world,r));assert.ok(v);const initial=v.marks(0),later=v.marks(280);assert.notDeepEqual(initial,later);
 r.roomAt={x:0,y:0};r.activity=null;s.world.buildings=[];assert.deepEqual(v.marks(0),initial);assert.deepEqual(v.marks(280),later);
 const wrong=stage(),actor=person(wrong);for(const remaining of [-1,0,NaN,Infinity]){actor.activity!.remaining=remaining;assert.equal(ordinaryCookingVisual(wrong.world,actor,layout,{pose:'work',facing:'south',focus:null}),null);}
});

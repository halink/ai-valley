/** Independent CPU/source review. Renderer/event spies are not browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {isometricObserverRoute} from '../scripts/isometric-observer-route.js';
import * as preview from '../src/client/isometric-preview.js';
import {homeInteriorSupport,IsometricHomeInterior,fitRoomCamera,HOME_INTERIOR_LIMITS} from '../src/client/isometric-interior.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {projectIsometric,screenToIsometric} from '../src/client/isometric-projection.js';
import {pickIsometricStudy} from '../src/client/isometric-study.js';
import {roomLayout} from '../src/shared/rooms.js';
import {calendar,daylight,daylightLabels} from '../src/world/time.js';
import {residentFollowText} from '../src/client/resident-follow.js';
import {personVisual} from '../src/client/person-pose.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import type {Snapshot,Vec} from '../src/shared/types.js';

const route=isometricObserverRoute();
const indoorIndex=route.snapshots.findIndex(s=>s.world.residents.find(r=>r.id===route.personId)!.inside);
const inside=()=>structuredClone(route.snapshots[indoorIndex]);
function freeze(value:unknown){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}}
function model(snapshot=route.snapshots[0]){const p=new preview.IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(snapshot);p.resize(960,640);return p;}
function close(actual:Vec|null,expected:Vec){assert.ok(actual);assert.ok(Math.abs(actual.x-expected.x)<1e-8&&Math.abs(actual.y-expected.y)<1e-8,JSON.stringify({actual,expected}));}

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
 const extensionContext:any={...preview,observerMap,residentFollowText,document,window,Element:ObserverElement,console:{warn:(...args:unknown[])=>warnings.push(args)},performance:{now:()=>0},clearInterval:(id:number)=>timers.delete(id)};
 runInNewContext(ts.transpileModule(extension,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';this.observerHandle=mountIsometricObserver(observerMap);',extensionContext);dispose=()=>extensionContext.observerHandle.dispose();
 const canvas=app.children[0],tray=app.children[1];
 // Invoke the real handlers in DOM capture/original-bubble/after-bubble order.
 // This verifies routing logic, not native browser propagation or pointer behavior.
 const click=(dataset:Record<string,string>)=>{const target=new ObserverElement();target.dataset=dataset;let stopped=false;const event={target,preventDefault(){},stopImmediatePropagation(){stopped=true;}};const [capture,after]=[...doc.listeners.get('click')!];capture(event);if(!stopped)originalClick(event);if(!stopped)after(event);return stopped;};
 return {scene,camera,canvas,tray,document,window,frames,covers,warnings,order,timers,click,selection:()=>ctx.selection,room:()=>roomId,accept:(s:Snapshot)=>ctx.receive(s),toggle:(view='iso')=>tray.emit('click',{target:tray.querySelector(`[data-view="${view}"]`)}),dispose:()=>dispose()};
}

test('independent home review: actual engine route retains identity and exact roomAt without mutating frozen worlds',()=>{
 const p=model();let entries=0,exits=0,prior:string|null=null;
 for(const [i,s] of route.snapshots.entries()){
  const before=structuredClone(s);freeze(s);p.accept(s);const r=s.world.residents.find(r=>r.id===route.personId)!;
  assert.equal(p.followResident(r.id),null,route.labels[i]);assert.equal(p.roomId,r.inside);
  const object=p.scene!.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===r.id);assert.ok(object,route.labels[i]);
  assert.deepEqual(object.subject.at,r.inside?r.roomAt:r.at);assert.deepEqual(preview.previewSelection(object.subject),{kind:'person',id:r.id});
  if(r.inside){assert.equal(object.subject.roomId,r.inside);if(!prior)entries++;}else if(prior)exits++;
  p.tick(i*125);assert.deepEqual(s,before);prior=r.inside;
 }
 assert.ok(entries>0&&exits>0);assert.equal(p.roomId,null);
});

test('independent home review: missing positions and home ownership cannot invent occupancy or bed/entry placement',()=>{
 const s=inside(),w=s.world,id=route.buildingId,r=w.residents.find(r=>r.id===route.personId)!;
 w.residents=w.residents.filter(v=>v.id===r.id);r.roomAt=null;r.homeId=id;
 const interior=new IsometricHomeInterior(),support=homeInteriorSupport(w,id);assert.ok(support.supported);assert.deepEqual(support.layout,roomLayout(w,w.buildings.find(b=>b.id===id)!));
 interior.accept(s,id);let view=interior.render(fitRoomCamera(support.layout,null,640,480),640,480);
 assert.equal(view.objects.some(o=>o.subject.kind==='resident'),false);assert.equal(view.unknownLocationCount,1);
 const p=model(s);assert.match(p.followResident(r.id)!,/精确位置/);
 for(const at of [{x:NaN,y:5},{x:-1,y:5},{x:support.layout.width,y:5}]){
  const copy=structuredClone(s);copy.world.residents[0].roomAt=at;interior.accept(copy,id);view=interior.render(fitRoomCamera(support.layout,null,640,480),640,480);assert.equal(view.objects.some(o=>o.subject.kind==='resident'),false);assert.equal(view.unknownLocationCount,1);
 }
 const outdoors=structuredClone(s);outdoors.world.residents[0].inside=null;outdoors.world.residents[0].roomAt={...support.layout.entry};interior.accept(outdoors,id);view=interior.render(fitRoomCamera(support.layout,null,640,480),640,480);assert.equal(view.objects.some(o=>o.subject.kind==='resident'),false);assert.equal(view.unknownLocationCount,0);
});

test('independent home review: room restrictions are explicit and oversized or duplicate slots fail closed',()=>{
 for(const kind of ['barn','clinic','school','greenhouse'] as const){const s=inside();s.world.buildings.find(b=>b.id===route.buildingId)!.kind=kind;const support=homeInteriorSupport(s.world,route.buildingId);assert.equal(support.supported,false);assert.ok(support.reason);}
 for(const patch of [{capacity:1e9},{width:0},{height:NaN}]){const s=inside();Object.assign(s.world.buildings.find(b=>b.id===route.buildingId)!,patch);assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
 const old=inside();delete old.world.rooms;assert.equal(homeInteriorSupport(old.world,route.buildingId).supported,false);
 const station=inside();station.world.industry!.stations.push({id:'review-station-a',buildingId:route.buildingId,kind:'bench'} as any,{id:'review-station-b',buildingId:route.buildingId,kind:'bench'} as any);assert.equal(homeInteriorSupport(station.world,route.buildingId).supported,false);
});

test('independent home review: resize preserves a separate outdoor center and old room scenes cannot animate replacement',()=>{
 const p=model(route.snapshots.at(-1)!),outdoor={x:398.25,y:233.75};p.center(outdoor);assert.equal(p.setRoom(route.buildingId),null);p.center({x:4.5,y:9.5});
 for(const [w,h] of [[390,844],[2560,1600],[840,600]]){p.resize(w,h);close(p.centerPoint,{x:4.5,y:9.5});assert.equal(p.centerTile,null);}
 const old=p.scene!;p.setRoom(null);close(p.centerPoint,outdoor);p.setRoom(route.buildingId);
 const replacement=structuredClone(route.snapshots.at(-1)!);replacement.world.id='independent-home-replacement';replacement.mapRevision=replacement.world.id;p.accept(replacement);assert.equal(p.roomId,null);assert.equal(p.viewport.animate(old,999),old);assert.equal(p.setRoom(route.buildingId),null);assert.equal(p.interior.animate(old as any,999),old);
});

test('independent home review: real receive and ValleyScene keep isometric follow through entry and exit, cancelling capture',()=>{
 const h=integrated();h.accept(route.snapshots[0]);h.toggle();h.scene.focusPerson(route.personId);
 let previous:string|null=null;
 for(const s of route.snapshots){
  const r=s.world.residents.find(r=>r.id===route.personId)!;if(r.inside!==previous){h.canvas.emit('pointerdown',{pointerId:7});assert.ok(h.canvas.captures.has(7));}
  h.order.length=0;h.accept(s);assert.equal(h.canvas.hidden,false);assert.equal(h.scene.followState?.personId,r.id);assert.equal(h.room(),r.inside);assert.equal(h.warnings.length,0);
  if(r.inside!==previous){assert.equal(h.canvas.captures.has(7),false);assert.ok(h.order.indexOf('room:'+r.inside)<h.order.indexOf('map'));h.canvas.emit('pointerup',{pointerId:7});assert.equal(h.scene.followState?.personId,r.id);}
  previous=r.inside;
 }
 assert.equal(h.timers.size,1);h.dispose();assert.equal(h.timers.size,0);
});

test('independent home review: manual room exit and2D handback never send room-local coordinates to world framing',()=>{
 const h=integrated();h.accept(route.snapshots.at(-1)!);h.scene.watchTile({x:398,y:233});h.toggle();h.scene.enterRoom(route.buildingId);assert.equal(h.canvas.hidden,false);
 const roomCamera={...h.camera.center};h.toggle('2d');assert.equal(h.room(),route.buildingId);assert.deepEqual(h.camera.center,roomCamera);assert.equal(h.frames.length,0);
 h.toggle();h.canvas.rect={left:0,top:0,width:1200,height:720};h.window.emit('resize');h.scene.exitRoom();assert.equal(h.room(),null);assert.equal(h.canvas.hidden,false);h.toggle('2d');assert.equal(h.frames.length,1);close(h.frames[0],{x:398,y:233});h.dispose();
});

test('independent home review: capture navigation cancels the previous coordinate-space drag',()=>{
 for(const dataset of [{locate:route.buildingId},{tile:'398,233'},{follow:route.personId}] as Record<string,string>[]){
  const h=observerPreviewHarness();h.accept(route.snapshots.at(-1)!);h.toggle();h.enter(route.buildingId);h.canvas.emit('pointerdown',{pointerId:8});assert.ok(h.canvas.captures.has(8));
  const b=new ObserverElement();b.dataset=dataset;h.document.emit('click',{target:b});assert.equal(h.canvas.captures.has(8),false,JSON.stringify(dataset));h.dispose();
 }
});

test('independent home review: actual manual enter, locate, tile and exit handlers retain original scene routes',()=>{
 const h=integrated();h.accept(route.snapshots.at(-1)!);h.toggle();assert.equal(h.click({enter:route.buildingId}),false);assert.equal(h.room(),route.buildingId);assert.equal(h.canvas.hidden,false);
 assert.equal(h.click({locate:route.buildingId}),false);assert.equal(h.room(),null);assert.deepEqual(JSON.parse(JSON.stringify(h.selection())),{kind:'building',id:route.buildingId});assert.equal(h.canvas.hidden,false);
 h.click({enter:route.buildingId});assert.equal(h.click({tile:'398,233'}),false);assert.equal(h.room(),null);h.toggle('2d');close(h.frames.at(-1)!,{x:398,y:233});
 h.toggle();h.click({enter:route.buildingId});assert.equal(h.click({action:'exitroom'}),false);assert.equal(h.room(),null);assert.equal(h.canvas.hidden,false);assert.equal(h.warnings.length,0);h.dispose();
});

test('independent home review: home reset clears the original highlight and follow both outdoors and indoors',()=>{
 const h=integrated();h.accept(route.snapshots.at(-1)!);h.toggle();
 for(const indoor of [false,true]){h.scene.focusPerson(route.personId);if(indoor)h.scene.enterRoom(route.buildingId);assert.ok((h.scene as any).selected);const calls=h.frames.length;assert.equal(h.click({action:'home'}),true);assert.equal(h.scene.followState,null);assert.equal((h.scene as any).selected,null);assert.equal(h.room(),null);assert.equal(h.frames.length,calls+1);close(h.frames.at(-1)!,preview.previewHome(route.snapshots.at(-1)!.world));assert.equal(h.canvas.hidden,false);}
 h.dispose();
});

test('independent home review: actual engine sleeping begins only at the recorded room position, not on its approach',()=>{
 const s=structuredClone(route.snapshots.at(-1)!),w=s.world,r=w.residents.find(r=>r.id===route.personId)!,p=model(s);
 const accepted=submitPlan(w,{id:'independent-sleep-route',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Scripted offline sleep appearance review',actions:[{type:'sleep',minutes:10}]});assert.equal(accepted.ok,true);
 let approached=false,slept=false;
 for(let i=0;i<160&&(r.plan||r.activity);i++){
  stepWorld(w,1);const visual=personVisual(w,r),next={...s,world:structuredClone(w)};p.accept(next);assert.equal(p.followResident(r.id),null);const object=p.scene!.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===r.id)!;assert.ok(object);assert.equal(object.subject.placeholder,undefined);
  if(r.activity?.room?.path.length){approached=true;assert.notEqual(visual.pose,'sleep');assert.ok(object.marks.length>8);}
  if(visual.pose==='sleep'){
   slept=true;assert.equal(r.inside,route.buildingId);assert.deepEqual(object.subject.at,r.roomAt);assert.equal(object.marks.length,8);
   const bad=structuredClone(next);bad.world.residents.find(v=>v.id===r.id)!.roomAt=null;const rejected=model(bad);assert.match(rejected.followResident(r.id)!,/精确位置/);
   const infant=structuredClone(next);infant.world.residents.find(v=>v.id===r.id)!.lifeStage='infant';const fallback=model(infant);assert.notEqual(fallback.followResident(r.id),null);break;
  }
 }
 assert.ok(approached&&slept,'real engine must record both indoor approach and actual sleep');
});

test('independent home review: ordinary room fit keeps all projected corners inside desktop and phone viewports',()=>{
 const s=inside(),support=homeInteriorSupport(s.world,route.buildingId);assert.ok(support.supported);
 for(const [width,height] of [[390,844],[960,640],[640,360]]){
  const c=fitRoomCamera(support.layout,null,width,height),interior=new IsometricHomeInterior();interior.accept(s,route.buildingId);const view=interior.render(c,width,height);
  for(const at of [{x:0,y:0},{x:support.layout.width,y:0},{x:0,y:support.layout.height},{x:support.layout.width,y:support.layout.height}]){const p=projectIsometric(at),x=p.x*c.zoom+c.origin.x,y=p.y*c.zoom+c.origin.y;assert.ok(x>=0&&x<=width&&y>=0&&y<=height,JSON.stringify({width,height,at,x,y}));}
  assert.ok(view.width<=HOME_INTERIOR_LIMITS.sourceAxis+2&&view.height<=HOME_INTERIOR_LIMITS.sourceAxis+2);assert.ok(view.terrain.length+view.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);
 }
});

test('independent home review: unsupported follow and room mutation restore original2D without losing resident or room',()=>{
 for(const mutate of [(s:Snapshot)=>{s.world.residents.find(r=>r.id===route.personId)!.roomAt=null;},(s:Snapshot)=>{s.world.buildings.find(b=>b.id===route.buildingId)!.kind='clinic';}]){
  const h=integrated();h.accept(route.snapshots[0]);h.toggle();h.scene.focusPerson(route.personId);const s=inside();mutate(s);h.accept(s);
  assert.equal(h.canvas.hidden,true);assert.equal(h.scene.followState?.personId,route.personId);assert.equal(h.room(),route.buildingId);assert.equal(h.timers.size,0);assert.equal(h.frames.length,0);h.dispose();
 }
 const h=integrated();h.accept(inside());h.scene.enterRoom(route.buildingId);h.toggle();const changed=inside();changed.world.revision++;changed.world.buildings.find(b=>b.id===route.buildingId)!.capacity=100;h.accept(changed);assert.equal(h.canvas.hidden,true);assert.equal(h.room(),route.buildingId);assert.equal(h.timers.size,0);
 const recovered=inside();recovered.world.revision=changed.world.revision+1;h.accept(recovered);h.toggle();assert.equal(h.canvas.hidden,false);h.dispose();
});

test('independent home review: interior replacement is atomic and old-room animation stays inert',()=>{
 const s=inside(),p=model(s);assert.equal(p.setRoom(route.buildingId),null);const original=p.snapshot,view=p.scene,camera=p.camera,stats=p.interior.stats;
 const bad=inside();bad.world.revision++;bad.world.residents.push(structuredClone(bad.world.residents.find(r=>r.id===route.personId)!));assert.throws(()=>p.accept(bad));assert.equal(p.snapshot,original);assert.equal(p.scene,view);assert.equal(p.camera,camera);assert.deepEqual(p.interior.stats,stats);
 const good=inside();good.world.revision=bad.world.revision;p.accept(good);assert.notEqual(p.scene,view);assert.equal(p.interior.animate(view as any,2000),view);
 const larger=structuredClone(good);larger.world.revision++;larger.world.buildings.find(b=>b.id===route.buildingId)!.capacity=6;p.accept(larger);assert.ok(p.scene!.objects.filter(o=>o.subject.kind==='roomSlot'&&o.subject.id.startsWith('bed:')).length>0);
});

test('independent home review: smaller same-world rooms publish the constrained camera used for drawing and picking',()=>{
 const s=inside(),home=s.world.buildings.find(b=>b.id===route.buildingId)!;home.width=15;home.height=12;
 const p=model(s);assert.equal(p.setRoom(home.id),null);assert.equal(p.center({x:29,y:26}),true);
 const smaller=structuredClone(s);smaller.world.revision++;Object.assign(smaller.world.buildings.find(b=>b.id===home.id)!,{width:3,height:2,capacity:1});p.accept(smaller);
 assert.deepEqual(p.camera,p.scene!.displayCamera);const support=homeInteriorSupport(smaller.world,home.id);assert.ok(support.supported);assert.ok(p.centerPoint!.x<=support.layout.width&&p.centerPoint!.y<=support.layout.height);
 for(const object of p.scene!.objects){
  const mark=object.marks[0],screen:{x:number;y:number}={x:(mark.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(mark.y+.5)*p.camera!.zoom+p.camera!.origin.y};
  assert.deepEqual(p.pick(screen),pickIsometricStudy({...p.scene!,camera:p.scene!.displayCamera},screen));
 }
});

test('independent home review: replacing a followed indoor world clears old identity and cannot leak a local center',()=>{
 const h=integrated();h.accept(inside());h.scene.focusPerson(route.personId);h.toggle();assert.equal(h.canvas.hidden,false);
 const next=structuredClone(route.snapshots.at(-1)!);next.world.id='review-replaced-world';next.mapRevision=next.world.id;next.world.buildings=next.world.buildings.filter(b=>b.id!==route.buildingId);next.world.residents=next.world.residents.filter(r=>r.id!==route.personId);
 h.accept(next);assert.equal(h.room(),null);assert.equal(h.scene.followState,null);assert.ok(h.frames.every(p=>p.x>100&&p.y>100));assert.equal(h.warnings.length,0);
 h.toggle();assert.equal(h.canvas.hidden,false);assert.equal(h.timers.size,1);h.dispose();assert.equal(h.canvas.captures.size,0);assert.equal(h.timers.size,0);
});

test('independent home review: deterministic budgets, copied identities and foremost painted pixel picking',()=>{
 const s=inside(),w=s.world,id=route.buildingId,template=w.residents.find(r=>r.id===route.personId)!;w.residents=Array.from({length:240},(_,i)=>({...structuredClone(template),id:'review-person-'+String(i).padStart(3,'0'),roomAt:{x:8,y:10},activity:null}));
 const support=homeInteriorSupport(w,id);assert.ok(support.supported);const interior=new IsometricHomeInterior();interior.accept(s,id);const camera=fitRoomCamera(support.layout,{x:8.5,y:10.5},640,480),view=interior.render(camera,640,480);
 assert.ok(view.omittedObjects>0);assert.ok(view.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(view.terrain.length+view.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);
 const actor=view.objects.filter(o=>o.subject.kind==='resident').at(-1)!;assert.ok(actor);assert.notEqual(actor.subject.at,w.residents.find(r=>r.id===actor.subject.id)!.roomAt);
 const p=projectIsometric({x:8.5,y:10.5}),screen={x:p.x*camera.zoom+camera.origin.x,y:(p.y-19)*camera.zoom+camera.origin.y},hit=pickIsometricStudy({...view,camera},screen);assert.equal(hit?.kind,'resident');assert.equal(hit&&'id'in hit?hit.id:null,actor.subject.id);assert.deepEqual(preview.previewSelection(hit),{kind:'person',id:actor.subject.id});
 const shuffled=structuredClone(s);shuffled.world.revision++;shuffled.world.residents.reverse();interior.accept(shuffled,id);const second=interior.render(camera,640,480);assert.deepEqual(second.objects.map(o=>o.key),view.objects.map(o=>o.key));assert.equal(second.omittedObjects,view.omittedObjects);
 const elapsed=interior.animate(second,5000);assert.ok(elapsed.terrain.length+elapsed.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);close(screenToIsometric({x:320,y:240},camera),{x:8.5,y:10.5});
});

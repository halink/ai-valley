/** Independent source/CPU review. No browser, network, saved world or model. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {IsometricViewport,fitWorldCamera,VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {IsometricPreview} from '../src/client/isometric-preview.js';
import {terrain,rasterIsometricStudy} from '../src/client/isometric-study.js';
import {buildingMarks} from '../src/client/isometric-buildings.js';
import {calendar,daylight,daylightLabels} from '../src/world/time.js';
import {applyObserverUpdate,type ObserverUpdate} from '../src/shared/observer.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
import type {Snapshot,World} from '../src/shared/types.js';
const snap=(world:World):Snapshot=>({world,mapRevision:'review-map',serverTime:'offline',version:'review',capabilities:{active:[],pending:[]}});
function fixture(){const {world}=isometricStudyFixture();world.minute=720;return world;}

test('independent review: chunk terrain equals whole-map pixel oracle at fractional camera crops',()=>{
 const w=fixture();w.buildings=[];w.resources=[];w.residents=[];w.plots=[];
 w.map={...w.map,width:32,height:32,tiles:Array.from({length:1024},(_,i)=>((i%32+Math.floor(i/32))%5===0?'water':'grass'))};
 const viewport=new IsometricViewport();viewport.accept(snap(w));
 const all=terrain(w,{x:0,y:0,width:32,height:32},calendar(w.minute).season,{cutEdges:false,maxTileMarks:VIEWPORT_LIMITS.tileMarks});
 for(const [x,y,z] of [[8,8,1.37],[15.99,16.01,2.1],[24,8,.9],[.1,.2,1.13]]){
  const c=fitWorldCamera(w,{x,y},257,193,z),s=viewport.render(c,257,193);
  assert.ok(-s.camera.origin.x<=-c.origin.x/c.zoom);assert.ok(-s.camera.origin.y<=-c.origin.y/c.zoom);
  assert.ok(s.width-s.camera.origin.x>=(257-c.origin.x)/c.zoom);assert.ok(s.height-s.camera.origin.y>=(193-c.origin.y)/c.zoom);
  const expected=rasterIsometricStudy({...s,terrain:all,objects:[]});
  assert.deepEqual(rasterIsometricStudy(s),expected,`whole-map crop ${x},${y},${z}`);
 }
});
test('independent review: long home art remains identical across chunks and camera pans',()=>{
 const w=fixture();w.map={...w.map,width:48,height:48,tiles:Array(48*48).fill('grass')};w.resources=[];w.plots=[];w.residents=[];
 const b=w.buildings[0];b.at={x:2,y:12};b.width=22;b.height=3;b.door={x:12,y:15};
 const v=new IsometricViewport();v.accept(snap(w));const expected=buildingMarks(b,calendar(w.minute).season);
 for(const x of [16,20,24]){const s=v.render(fitWorldCamera(w,{x,y:14},300,220,2),300,220);assert.ok(s.bounds.x>b.at.x);assert.deepEqual(s.objects.find(o=>o.subject.id===b.id)?.marks,expected);}
 const stats=v.stats;v.accept(snap(w));assert.equal(v.stats.bucketBuilds,stats.bucketBuilds);assert.equal(v.stats.poseBuilds,stats.poseBuilds);
});
test('independent review: placeholder residents remain selectable but following requests original2D',()=>{
 const w=fixture();w.residents[0].activity!.path=[{x:8,y:8}];const p=new IsometricPreview();p.accept(snap(w));p.setActive(true);p.resize(640,480);
 assert.ok(p.scene!.objects.some(o=>o.subject.id===w.residents[0].id&&o.subject.placeholder));assert.notEqual(p.followResident(w.residents[0].id),null);
 const h=observerPreviewHarness({x:6,y:6});h.accept(snap(w));h.toggle();h.startFollow(w.residents[0].id);assert.equal(h.canvas.hidden,true);assert.equal(h.follow.state?.personId,w.residents[0].id);h.dispose();
});
test('independent review: rejected active replacement preserves original animation and accepts later corrected same revision',()=>{
 const w=fixture();w.clock.paused=false;const p=new IsometricPreview();p.accept(snap(w));p.setActive(true);p.setConnected(true);p.resize(640,480);p.tick(0);p.tick(125);
 const original=p.snapshot,scene=p.scene,camera=p.camera,stats=p.viewport.stats,elapsed=p.elapsed,bad=structuredClone(w);bad.revision++;bad.buildings[0].door.x=NaN;
 assert.throws(()=>p.accept(snap(bad)));assert.equal(p.snapshot,original);assert.equal(p.scene,scene);assert.equal(p.camera,camera);assert.equal(p.elapsed,elapsed);assert.deepEqual(p.viewport.stats,stats);
 bad.buildings[0].door.x=3;p.accept(snap(bad));assert.notEqual(p.scene,scene);assert.equal(p.viewport.animate(scene!,500),scene);
 const accepted=p.scene;p.accept(snap(w));assert.equal(p.scene,accepted);
});
test('independent review: real main receive plus ValleyScene publishes new identity before room/follow and map notification',()=>{
 const {scene}=residentSceneHarness();let current:Snapshot|null=null;const order:string[]=[];
 const source=readFileSync(new URL('../src/client/main.ts',import.meta.url),'utf8');const receive=source.slice(source.indexOf('function receive('),source.indexOf('scene.onSelection='));
 const ctx:any={scene,calendar,daylight,daylightLabels,names:{spring:'spring',summer:'summer',autumn:'autumn',winter:'winter'},icon:()=>'',snapshot:null,connected:false,selection:null,detailId:null,activePanel:null,panelPositions:{clear(){}},closePanel(){},el:()=>({classList:{add(){},toggle(){}},innerHTML:'',textContent:'',title:''}),updateStatus(){current=ctx.snapshot;order.push('map');},renderSelection(){},observeArchives(){},renderPanel(){}};
 runInNewContext(ts.transpileModule(receive,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.receive=receive;',ctx);
 const w=fixture(),id=w.residents[0].id;ctx.receive(snap(w));scene.focusPerson(id);order.length=0;
 const next=structuredClone(w);next.revision++;next.residents[0].inside=next.buildings[0].id;next.residents[0].roomAt=null;
 scene.onRoom=b=>{assert.equal(ctx.snapshot.world.revision,next.revision);order.push('room:'+b?.id);};scene.onFollow=f=>{assert.equal(ctx.snapshot.world.revision,next.revision);assert.equal(f?.personId,id);order.push('follow');};
 let onUpdate:((event:{data:string})=>void)|undefined;let closed=0;const scheduled:number[]=[];
 const stream={addEventListener(_type:string,fn:typeof onUpdate){onUpdate=fn;},close(){closed++;}};
 Object.assign(ctx,{source:stream,stream,applyObserverUpdate,window:{setTimeout(_fn:unknown,ms:number){scheduled.push(ms);}},connect(){}});
 const dispatch=source.slice(source.indexOf(" source.addEventListener('update'"),source.indexOf(' source.onopen='));
 runInNewContext(ts.transpileModule(dispatch,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 onUpdate!({data:JSON.stringify({worldId:w.id,mapRevision:'review-map',baseRevision:w.revision,serverTime:'offline',version:'review',capabilities:{active:[],pending:[]},world:next})});
 assert.deepEqual(order,['room:'+next.buildings[0].id,'follow','map']);assert.equal(current,ctx.snapshot);
 const accepted=ctx.snapshot;ctx.receive(snap(w));assert.equal(ctx.snapshot,accepted);
 onUpdate!({data:JSON.stringify({worldId:w.id,mapRevision:'wrong-map',world:{revision:next.revision+1}})});
 assert.equal(ctx.snapshot,accepted);assert.equal(closed,1);assert.deepEqual(scheduled,[1000]);
});
test('independent review: protocol deltas retain identities and original room routing passes through',()=>{
 const w=fixture(),s=snap(w),id=w.residents[0].id;
 const update:ObserverUpdate={worldId:w.id,mapRevision:s.mapRevision!,baseRevision:w.revision,serverTime:'offline-next',version:'review',capabilities:s.capabilities,world:{revision:w.revision+1},changes:{residents:{upsert:[],remove:[],patch:[{id,at:{x:8,y:7}}]}}};
 const next=applyObserverUpdate(s,JSON.parse(JSON.stringify(update)))!;assert.equal(next.world.residents[1],w.residents[1]);assert.deepEqual(next.world.residents[0].at,{x:8,y:7});assert.notDeepEqual(w.residents[0].at,{x:8,y:7});assert.equal(applyObserverUpdate(next,{...update,baseRevision:999}),null);
 const h=observerPreviewHarness({x:6,y:6});h.accept(next);
 for(const kind of ['home','barn','clinic','workshop','school','lodge'] as const){const copy=structuredClone(next);copy.world.buildings[0].kind=kind;h.accept(copy);h.toggle();const button=new ObserverElement();button.dataset.enter=copy.world.buildings[0].id;assert.equal(h.document.emit('click',{target:button}).stopped,false);assert.equal(h.canvas.hidden,true);}
 h.dispose();assert.equal(h.intervals.size,0);assert.equal(h.document.listeners.get('click')?.size,0);
});
test('independent review: deterministic overflow accounts for all colocated records and cache reuse',()=>{
 const w=fixture();w.buildings=[];w.resources=[];w.residents=[];w.plots=[];
 w.graves=Array.from({length:257},(_,i)=>({id:`review-slot-${String(i).padStart(3,'0')}`,at:{x:6,y:6},personId:'unasserted',buriedAt:null}));
 const v=new IsometricViewport();v.accept(snap(w));const c=fitWorldCamera(w,{x:6,y:6},640,480),a=v.render(c,640,480);
 assert.equal(a.objects.length,VIEWPORT_LIMITS.objects);assert.equal(a.omittedObjects,257-VIEWPORT_LIMITS.objects);assert.equal(a.renderedMarkerCount,0);assert.ok(a.objects.every(o=>o.subject.description?.includes('待葬')));assert.equal(a.unknownLocationCount,0);
 assert.ok(a.terrain.length+a.objects.reduce((sum,o)=>sum+o.marks.length,0)<=VIEWPORT_LIMITS.marks);
 const before=v.stats;v.accept(snap(w));const b=v.render(c,640,480);assert.deepEqual(b.objects.map(o=>o.key),a.objects.map(o=>o.key));assert.equal(v.stats.bucketBuilds,before.bucketBuilds);assert.equal(v.stats.chunkBuilds,before.chunkBuilds);
 const replacement=structuredClone(w);replacement.revision++;replacement.graves.reverse();v.accept(snap(replacement));const d=v.render(c,640,480);assert.deepEqual(d.objects.map(o=>o.key),a.objects.map(o=>o.key));assert.equal(v.stats.chunkBuilds,before.chunkBuilds);
});
test('independent review: read-only guard covers the entire configured proxy prefix',async()=>{
 const {observerReadOnlyAPI}=await import(new URL('../scripts/dev-observer-web.mjs',import.meta.url).href);
 for(const url of ['/ai-town/api','/ai-town/api?x=1','/ai-town/apix','/ai-town/api/../control']){
  let next=0;const res={statusCode:0,setHeader(){},end(){}};observerReadOnlyAPI({method:'POST',url},res,()=>next++);assert.equal(next,0,url);assert.equal(res.statusCode,405,url);
 }
});
test('independent review: regional carried crates never reuse the carrier stale valley tile',()=>{
 const w=fixture(),r=w.residents[0];r.regionalLocation={origin:'outside-review',progress:2,duration:20} as unknown as NonNullable<typeof r.regionalLocation>;
 w.industry={animals:[],fishing:{},livestockCargo:[{id:'regional-crate',container:'person:'+r.id,status:'crated'}]} as unknown as NonNullable<World['industry']>;
 const location={at:{...r.at},inside:null,roomAt:null,regional:r.regionalLocation};
 w.estates=[{personId:'regional-dead',inventory:{goatCrate:1},location,parcels:[{id:'regional-parcel',inventory:{goatCrate:1},location}]}] as unknown as World['estates'];
 w.industry!.livestockCargo!.push({id:'regional-estate-crate',container:'estate:regional-dead',status:'crated'} as NonNullable<NonNullable<World['industry']>['livestockCargo']>[number],{id:'regional-parcel-crate',container:'regional-parcel',status:'crated'} as NonNullable<NonNullable<World['industry']>['livestockCargo']>[number]);
 const v=new IsometricViewport();v.accept(snap(w));const s=v.render(fitWorldCamera(w,r.at,640,480),640,480);
 for(const id of ['regional-crate','regional-estate-crate','regional-parcel-crate'])assert.ok(!s.objects.some(o=>o.subject.kind==='crate'&&o.subject.id===id),id+' has no actual valley position');
});

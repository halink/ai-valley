/** Independent synthetic CPU review; DOM/render adapters do not constitute browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricWorkshopRoute} from '../scripts/isometric-workshop-route.js';
import {ordinaryCraftVisual} from '../src/client/isometric-crafting.js';
import {homeInteriorSupport} from '../src/client/isometric-interior.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {roomLayout} from '../src/shared/rooms.js';
import {personVisual} from '../src/client/person-pose.js';
import {residentSceneHarness} from './helpers/resident-scene.js';
import {observerPreviewHarness} from './helpers/observer-preview-dom.js';
import type {Snapshot} from '../src/shared/types.js';
const route=isometricWorkshopRoute();
const stage=(label='craft:working')=>{const i=route.labels.indexOf(label);assert.ok(i>=0,label);return structuredClone(route.snapshots[i]);};
const person=(s:Snapshot)=>s.world.residents.find(r=>r.id===route.personId)!;
const building=(s:Snapshot)=>s.world.buildings.find(b=>b.id===route.buildingId)!;
const batch=(s:Snapshot)=>{const a=person(s).activity!.action;assert.equal(a.type,'industry');return s.world.industry!.batches.find(b=>b.id===(a as any).batchId)!;};
const visual=(s:Snapshot)=>ordinaryCraftVisual(s.world,person(s),roomLayout(s.world,building(s)),personVisual(s.world,person(s)));
function model(s=stage()){const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(route.buildingId),null);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('independent workshop: unmodified seed route yields real table/bench work and separate completed output',()=>{
 assert.equal(route.plans.length,6);
 for(const label of ['table-craft:working','craft:working']){
  const s=stage(label),v=visual(s);assert.equal(v?.pose,'craft');assert.ok(batch(s).worked>0);assert.equal(batch(s).status,'working');assert.match(v!.description,/不证明工具、火焰或成品/);assert.notDeepEqual(v!.marks(0),v!.marks(280));
 }
 for(const label of ['table-craft:completed','craft:completed','exit:completed'])assert.equal(visual(stage(label)),null);
 const seed=stage('seed'),table=stage('table-craft:completed'),done=stage('craft:completed');
 assert.equal(person(table).inventory.fiber,(person(seed).inventory.fiber??0)+batch(stage('table-craft:working')).recipe.output.fiber!);
 assert.equal(person(done).inventory.plank,(person(stage('craft:on-site')).inventory.plank??0)+batch(stage()).recipe.output.plank!);
 assert.equal(person(stage('exit:completed')).inside,null);
});

test('independent workshop: table and bench arrival without a batch are static ready evidence only',()=>{
 for(const label of ['table-craft:on-site','craft:on-site']){const s=stage(label),v=visual(s);assert.equal(v?.pose,'ready');assert.match(v!.description,/尚无加工批次/);assert.deepEqual(v!.marks(0),v!.marks(840));}
 const s=stage();delete (person(s).activity!.action as any).batchId;assert.equal(visual(s),null);
});

test('independent workshop: malformed batch/action/location evidence never advertises ordinary craft',()=>{
 const changes:Array<[string,(s:Snapshot)=>void]>=[
  ['missing batch',s=>s.world.industry!.batches=[]],['foreign owner',s=>batch(s).ownerId='not-the-person'],
  ['wrong building',s=>batch(s).buildingId='other'],['terminal batch',s=>batch(s).status='completed'],
  ['wrong action',s=>batch(s).actionKey='unrelated'],['wrong definition',s=>batch(s).definition='other'],
  ['zero work',s=>batch(s).worked=0],['NaN work',s=>batch(s).worked=NaN],['finished work',s=>batch(s).worked=batch(s).recipe.minutes],
  ['future timestamp',s=>batch(s).lastAt=s.world.minute+1],['old timestamp',s=>batch(s).lastAt=batch(s).createdAt-1],
  ['negative input',s=>batch(s).input.wood=-1],['missing input',s=>batch(s).input={}],['extra input',s=>batch(s).input.fiber=1],
  ['ambiguous working owner',s=>s.world.industry!.batches.push({...structuredClone(batch(s)),id:'duplicate'})],
  ['wrong station',s=>(person(s).activity!.action as any).station='forge'],['wrong slot',s=>person(s).roomAt={x:1,y:1}],
  ['walking',s=>person(s).activity!.path.push({x:1,y:1})],['room walking',s=>person(s).activity!.room={buildingId:route.buildingId,mode:'work',target:{...person(s).roomAt!},path:[{x:1,y:1}],progress:0}],
  ['exit',s=>person(s).activity!.room={buildingId:route.buildingId,mode:'exit',target:{...person(s).roomAt!},path:[],progress:0}],['wrong door',s=>person(s).at={x:0,y:0}],
  ['missing station id',s=>s.world.industry!.stations.find(t=>t.buildingId===route.buildingId)!.id=''],
  ['missing station',s=>s.world.industry!.stations=[]],['station removal',s=>s.world.industry!.stations.find(t=>t.buildingId===route.buildingId)!.removalWorked=1],
  ['negative station timestamp',s=>s.world.industry!.stations.find(t=>t.buildingId===route.buildingId)!.installedAt=-1],
  ['future station',s=>s.world.industry!.stations.find(t=>t.buildingId===route.buildingId)!.installedAt=s.world.minute+1],
 ];
 for(const [name,change] of changes){const s=stage();change(s);assert.equal(visual(s),null,name);}
});

test('independent workshop: physical bench drawn once, source identity picks and frozen snapshot stay intact',()=>{
 const s=stage(),before=structuredClone(s);freeze(s);const p=model(s),objects=p.scene!.objects;
 assert.equal(objects.filter(o=>o.subject.id==='station:bench').length,1);assert.equal(objects.filter(o=>o.subject.id==='table').length,0);
 const actor=objects.find(o=>o.subject.kind==='resident'&&o.subject.id===route.personId)!;
 assert.deepEqual(actor.subject.at,person(s).roomAt);assert.match(actor.subject.description!,/实际加工批次/);
 let hits=0;for(const mark of actor.marks){const hit=p.pick({x:(mark.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(mark.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind==='resident'&&hit.id===route.personId){assert.equal(hit.roomId,route.buildingId);assert.deepEqual(previewSelection(hit),{kind:'person',id:route.personId});hits++;}}
 assert.ok(hits>0);p.tick(0);p.tick(280);assert.deepEqual(s,before);
 const table=model(stage('table-craft:working'));assert.equal(table.scene!.objects.filter(o=>o.subject.id==='table').length,1);assert.equal(table.scene!.objects.filter(o=>o.subject.id==='station:bench').length,0);
});

test('independent workshop: malformed geometry and duplicate stations fail closed; unsupported stations are exact markers',()=>{
 for(const width of [NaN,Infinity,-1,0,1.5,10000]){const s=stage();building(s).width=width;assert.equal(homeInteriorSupport(s.world,route.buildingId).supported,false);}
 const duplicate=stage();duplicate.world.industry!.stations.push({...duplicate.world.industry!.stations.find(s=>s.buildingId===route.buildingId)!});assert.equal(homeInteriorSupport(duplicate.world,route.buildingId).supported,false);
 const unknown=stage();unknown.world.industry!.stations.find(s=>s.buildingId===route.buildingId)!.kind='unknown' as any;assert.equal(homeInteriorSupport(unknown.world,route.buildingId).supported,false);
 for(const installedAt of [-1,NaN,Infinity,stage().world.minute+1]){const s=stage();s.world.industry!.stations.find(t=>t.buildingId===route.buildingId)!.installedAt=installedAt;const p=model(s);assert.ok(p.scene!.objects.find(o=>o.subject.id==='station:bench')!.subject.placeholder);assert.equal(p.scene!.objects.filter(o=>o.subject.id==='table').length,1);assert.equal(visual(s),null);}
 const forge=stage();forge.world.industry!.stations.find(s=>s.buildingId===route.buildingId)!.kind='forge';const p=model(forge),marker=p.scene!.objects.find(o=>o.subject.id==='station:forge')!;assert.match(marker.subject.placeholder!,/未绘制设施外观/);assert.deepEqual(marker.subject.at,roomLayout(forge.world,building(forge)).slots.find(s=>s.key==='station:forge')!.at);
});

test('independent workshop: real scene follow preserves identity through entry, return, bench work and exit',()=>{
 const {scene}=residentSceneHarness(),h=observerPreviewHarness(undefined,scene);h.accept(stage('seed'));h.toggle();h.startFollow(route.personId);
 for(const s of route.snapshots.slice(1)){h.accept(s);assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),person(s).inside);assert.equal(h.canvas.hidden,false);}
 h.toggle('2d');assert.equal(scene.followState?.personId,route.personId);assert.equal(h.room(),null);assert.equal(h.intervals.size,0);assert.equal(h.warnings.length,0);h.dispose();
 for(const badPosition of [true,false]){const s=stage();if(badPosition)person(s).roomAt=null;else building(s).kind='barn';const h=observerPreviewHarness();h.accept(s);h.startFollow(route.personId);h.toggle();assert.equal(h.canvas.hidden,true);assert.equal(h.follow.state?.personId,route.personId);h.dispose();}
});

test('independent workshop: pause/visibility/disconnect freeze; accepted evidence is resolved once',()=>{
 const h=observerPreviewHarness();h.accept(stage());h.toggle();h.startFollow(route.personId);const p=h.model,marks=()=>p.scene!.objects.find(o=>o.subject.id===route.personId)!.marks;p.tick(0);p.tick(280);
 const current=structuredClone(marks()),stats=p.interior.stats;h.connection(false);p.tick(1000);assert.deepEqual(marks(),current);h.connection(true);h.document.hidden=true;h.document.emit('visibilitychange');p.tick(2000);assert.deepEqual(marks(),current);
 h.document.hidden=false;h.document.emit('visibilitychange');const paused=stage();paused.world.clock.paused=true;paused.world.revision++;h.accept(paused);const stopped=structuredClone(marks());p.tick(3000);p.tick(4000);assert.deepEqual(marks(),stopped);assert.equal(p.interior.stats.floorBuilds,stats.floorBuilds);h.dispose();
 const s=stage(),v=visual(s)!;const first=v.marks(0),second=v.marks(280);person(s).activity=null;person(s).roomAt=null;s.world.buildings=[];s.world.industry!.batches=[];assert.deepEqual(v.marks(0),first);assert.deepEqual(v.marks(280),second);
});

test('independent workshop: animation caching, mark bounds and stale scene invalidation',()=>{
 const s=stage(),r=person(s);s.world.residents=Array.from({length:700},(_,i)=>({...structuredClone(r),id:'review:'+i}));const p=model(s),stats=p.interior.stats;
 for(const t of [0,280,560,840]){p.tick(t);assert.ok(p.scene!.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(p.scene!.terrain.length+p.scene!.objects.reduce((n,o)=>n+o.marks.length,0)<=VIEWPORT_LIMITS.marks);assert.ok(p.interior.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(p.interior.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);}
 assert.equal(p.interior.stats.poseBuilds,stats.poseBuilds);assert.equal(p.interior.stats.bucketBuilds,stats.bucketBuilds);assert.equal(p.interior.stats.floorBuilds,stats.floorBuilds);
 const old=p.scene!;p.accept(stage('craft:completed'));assert.equal(p.interior.animate(old as any,1000),old);
});

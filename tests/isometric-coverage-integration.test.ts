/** Synthetic CPU integration only. No saved worlds, browser, or model calls. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {isometricResidentsFixture} from '../scripts/isometric-residents-fixture.js';
import {isometricBuildingsFixture,buildingFixtureScene} from '../scripts/isometric-buildings-fixture.js';
import {IsometricViewport,fitWorldCamera,VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {IsometricPreview,previewSelection} from '../src/client/isometric-preview.js';
import {pickIsometricStudy,renderIsometricStudy} from '../src/client/isometric-study.js';
import {prepareIsometricResidents} from '../src/client/isometric-residents.js';
import type {World,Snapshot,BuildingKind} from '../src/shared/types.js';
const snap=(world:World):Snapshot=>({world,serverTime:'synthetic',version:'integration',capabilities:{active:[],pending:[]}});
function view(w:World,at={x:13,y:10},width=1200,height=800){const v=new IsometricViewport();v.accept(snap(w));return {v,scene:v.render(fitWorldCamera(w,at,width,height),width,height)};}
function preview(w:World){const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(snap(w));p.resize(800,600);return p;}
const marks=(s:ReturnType<IsometricViewport['render']>)=>s.terrain.length+s.objects.reduce((n,o)=>n+o.marks.length,0);
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('coverage integration: all eight recorded building kinds render, locate, and retain original footprint/identity',()=>{
 for(const kind of ['home','lodge','workshop','clinic','school','barn','greenhouse','store'] satisfies BuildingKind[]){
  const {world}=isometricStudyFixture();world.buildings[0].kind=kind;const before=structuredClone(world);freeze(world);const p=preview(world);
  assert.equal(p.locateBuilding(world.buildings[0].id),true,kind);const o=p.scene!.objects.find(o=>o.subject.kind==='building')!;
  assert.equal(o.subject.placeholder,undefined);assert.equal(o.footprint.width,3);assert.equal(o.footprint.height,2);assert.deepEqual(o.subject.at,world.buildings[0].at);assert.deepEqual(previewSelection(o.subject),{kind:'building',id:world.buildings[0].id});
  assert.match(o.subject.description!,/建筑记录/);assert.deepEqual(world,before);
 }
});

test('coverage integration: non-tree resources preserve stock states and unknown kinds remain explicit markers',()=>{
 const {world,bounds}=isometricStudyFixture();world.buildings=[];world.residents=[];world.plots=[];
 world.resources=['rock','bush','spring','future-resource'].map((kind,i)=>({...world.resources[0],id:kind,kind:kind as World['resources'][number]['kind'],at:{x:2+i*2,y:5},amount:0}));
 for(const scene of [view(world,{x:6,y:5}).scene,renderIsometricStudy(world,{bounds})])for(const r of world.resources){
  const o=scene.objects.find(o=>o.subject.id===r.id)!;assert.ok(o);assert.deepEqual(o.subject.at,r.at);assert.equal(!!o.subject.placeholder,r.id==='future-resource');
  if(!o.subject.placeholder)assert.match(o.subject.description!,/实际余量 0\/20/);
 }
});

test('coverage integration: full building/resource/orchard/construction fixture matches the separately verified art API',()=>{
 const {world}=isometricBuildingsFixture(),expected=buildingFixtureScene(),v=new IsometricViewport();v.accept(snap(world));
 const sheet=renderIsometricStudy(world,{bounds:{x:0,y:0,width:32,height:30}});assert.equal(sheet.objects.length,23);
 for(const reference of expected.objects){const at={x:reference.footprint.x+reference.footprint.width/2,y:reference.footprint.y+reference.footprint.height/2},scene=v.render(fitWorldCamera(world,at,800,600,2),800,600),actual=scene.objects.find(o=>o.key===reference.key)!;
  assert.ok(actual,reference.key);assert.equal(actual.subject.placeholder,undefined,reference.key);assert.deepEqual(actual.marks,reference.marks);assert.deepEqual(actual.footprint,reference.footprint);assert.deepEqual(sheet.objects.find(o=>o.key===reference.key)?.marks,reference.marks);
 }
});

test('coverage integration: supported resident states use prepared positions, footprints and original IDs',()=>{
 const f=isometricResidentsFixture(),before=structuredClone(f.world);freeze(f.world);const prepared=prepareIsometricResidents(f.world),{v,scene}=view(f.world);
 for(const r of prepared){const focused=r.kind!=='hidden'&&r.at?v.render(fitWorldCamera(f.world,r.at,800,600,2),800,600):scene,o=focused.objects.find(o=>o.subject.kind==='resident'&&o.subject.id===r.id);
  if(r.kind==='hidden'){assert.equal(o,undefined);continue;}
  if(r.kind==='fallback'){if(r.at)assert.ok(o?.subject.placeholder,r.id);else assert.equal(o,undefined);continue;}
  assert.ok(o&&!o.subject.placeholder,r.id);assert.deepEqual(o.subject.at,r.at);assert.deepEqual(o.footprint,r.footprint);assert.equal(o.subject.description,r.description);
 }
 assert.deepEqual(f.world,before);assert.ok(scene.objects.some(o=>o.subject.id===f.body.id));assert.equal(scene.omittedObjects,0);
});

test('coverage integration: unburied dead remain visible until actual burial, including a reserved grave',()=>{
 const f=isometricResidentsFixture();f.world.graves=[{id:'pending',at:{x:9,y:9},personId:f.body.id,buriedAt:null}];
 assert.ok(view(f.world).scene.objects.some(o=>o.subject.id===f.body.id&&!o.subject.placeholder));
 f.world.graves[0].buriedAt=f.world.minute;assert.ok(!view(f.world).scene.objects.some(o=>o.subject.id===f.body.id));
});

test('coverage integration: unknown carried position counts once without a marker at the stale patient tile',()=>{
 const f=isometricResidentsFixture(),baseline=view(f.world).scene.unknownLocationCount;f.world.residents=f.world.residents.filter(r=>r.id!==f.carrier.id);f.patient.at={x:1,y:1};
 const {scene}=view(f.world);assert.ok(!scene.objects.some(o=>o.subject.id===f.patient.id));assert.equal(scene.unknownLocationCount,baseline+1);assert.ok(scene.unsupportedObjects>=1);
 const p=preview(f.world);assert.notEqual(p.followResident(f.patient.id),null);
});

test('coverage integration: following a carried resident uses carrier position and the saved fraction, not stale coordinates',()=>{
 const f=isometricResidentsFixture();f.patient.at={x:1,y:1};const p=preview(f.world);assert.equal(p.followResident(f.patient.id),null);
 assert.ok(Math.abs(p.centerPoint!.x-14.75)<1e-9);assert.ok(Math.abs(p.centerPoint!.y-8.5)<1e-9);
 const o=p.scene!.objects.find(o=>o.subject.id===f.patient.id)!;assert.deepEqual(o.subject.at,f.carrier.at);assert.equal(o.subject.placeholder,undefined);
});

test('coverage review: verified outdoor carriage overrides unusable stale patient coordinates or missing old rooms',()=>{
 for(const patch of [{at:{x:-1,y:-1}},{at:{x:NaN,y:NaN}},{inside:'missing-old-room',roomAt:null}]){
  const f=isometricResidentsFixture();Object.assign(f.patient,patch);const before=structuredClone(f.world);freeze(f.world);const p=preview(f.world);
  assert.equal(p.followResident(f.patient.id),null,JSON.stringify(patch));assert.equal(p.roomId,null);assert.ok(Math.abs(p.centerPoint!.x-14.75)<1e-9);assert.ok(Math.abs(p.centerPoint!.y-8.5)<1e-9);
  const o=p.scene!.objects.find(o=>o.subject.id===f.patient.id)!;assert.deepEqual(o.subject.at,f.carrier.at);assert.equal(o.subject.placeholder,undefined);assert.deepEqual(f.world,before);
 }
});

test('coverage review: carried following still rejects unknown, regional, dead and unimplemented room locations',()=>{
 for(const mutate of [
  (f:ReturnType<typeof isometricResidentsFixture>)=>{f.carrier.activity=null;},
  (f:ReturnType<typeof isometricResidentsFixture>)=>{f.carrier.regionalLocation={origin:'elsewhere',progress:1,duration:10} as NonNullable<typeof f.carrier.regionalLocation>;},
  (f:ReturnType<typeof isometricResidentsFixture>)=>{f.patient.regionalLocation={origin:'elsewhere',progress:1,duration:10} as NonNullable<typeof f.patient.regionalLocation>;},
  (f:ReturnType<typeof isometricResidentsFixture>)=>{f.patient.status='dead';},
  (f:ReturnType<typeof isometricResidentsFixture>)=>{f.patient.residency='outside';},
  (f:ReturnType<typeof isometricResidentsFixture>)=>{f.carrier.inside=f.home.id;f.carrier.roomAt={x:4,y:5};},
 ]){const f=isometricResidentsFixture();mutate(f);const p=preview(f.world);assert.notEqual(p.followResident(f.patient.id),null);assert.ok(!p.scene!.objects.some(o=>o.subject.id===f.patient.id&&!o.subject.placeholder)||f.patient.regionalLocation||f.patient.residency==='outside');}
});

test('coverage review: screen-external halo residents never consume visible object slots',()=>{
 const {world}=isometricStudyFixture(),template=structuredClone(world.residents[0]);world.map={...world.map,width:100,height:100,tiles:Array(10000).fill('grass')};world.buildings=[];world.resources=[];world.plots=[];world.graves=[];template.activity=null;
 world.residents=Array.from({length:192},(_,i)=>({...structuredClone(template),id:'screen-external-'+i,at:{x:52,y:48}}));world.residents.push({...structuredClone(template),id:'actual-visible',at:{x:53,y:53}});
 const v=new IsometricViewport();v.accept(snap(world));const scene=v.render(fitWorldCamera(world,{x:50,y:50},180,600,3),180,600);
 assert.equal(scene.objects.length,1);assert.equal(scene.objects[0].subject.id,'actual-visible');assert.equal(scene.omittedObjects,0);assert.ok(marks(scene)<=VIEWPORT_LIMITS.marks);
 assert.equal(v.stats.objectChecks,1,'known static off-screen bounds avoid art checks entirely');
});

test('coverage review: animated screen-external candidates refill visible slots without unbounded art work',()=>{
 const {world}=isometricStudyFixture(),template=structuredClone(world.residents[0]);world.map={...world.map,width:100,height:100,tiles:Array(10000).fill('grass')};world.buildings=[];world.resources=[];world.plots=[];world.graves=[];world.clock.paused=false;
 const moving=(i:number)=>({...structuredClone(template),id:'screen-external-'+i,at:{x:52,y:48},activity:{...structuredClone(template.activity!),action:{type:'wait' as const,minutes:15},target:{x:53,y:48},path:[{x:53,y:48}],travelProgress:0}});
 const target={...structuredClone(template),id:'actual-visible',at:{x:53,y:53},activity:null};world.residents=[...Array.from({length:192},(_,i)=>moving(i)),target];
 const v=new IsometricViewport(),camera=fitWorldCamera(world,{x:50,y:50},180,600,3);v.accept(snap(world));const scene=v.render(camera,180,600,260);
 assert.deepEqual(scene.objects.map(o=>o.subject.id),['actual-visible']);assert.equal(scene.omittedObjects,0);assert.equal(v.stats.objectChecks,193);assert.ok(marks(scene)<=VIEWPORT_LIMITS.marks);
 const dense=structuredClone(world);dense.revision++;dense.residents=[...Array.from({length:VIEWPORT_LIMITS.objectChecks+1},(_,i)=>moving(i)),target];v.accept(snap(dense));const bounded=v.render(camera,180,600,260);
 assert.equal(v.stats.objectChecks,VIEWPORT_LIMITS.objectChecks);assert.equal(bounded.uncheckedObjects,2);assert.equal(bounded.omittedObjects,2);assert.ok(marks(bounded)<=VIEWPORT_LIMITS.marks);
 v.prioritize('resident:'+target.id);const followed=v.render(camera,180,600,260);assert.ok(followed.objects.some(o=>o.subject.id===target.id));assert.ok(v.stats.objectChecks<=VIEWPORT_LIMITS.objectChecks);
});

test('coverage integration: followed resident is retained ahead of dense equal-distance candidates',()=>{
 const f=isometricResidentsFixture(),template=f.idle;f.world.buildings=[];f.world.residents=Array.from({length:300},(_,i)=>({...structuredClone(template),id:'dense-'+String(i).padStart(3,'0'),at:{x:13,y:10}}));
 const p=preview(f.world),id='dense-299';assert.equal(p.followResident(id),null);assert.ok(p.scene!.objects.some(o=>o.subject.id===id&&!o.subject.placeholder));assert.ok(p.scene!.omittedObjects>0);assert.ok(marks(p.scene!)<=VIEWPORT_LIMITS.marks);
});

test('coverage integration: animated density uses explicit budget markers and never hides admitted identities',()=>{
 const f=isometricResidentsFixture(),template=f.worker;f.world.buildings=[];
 f.world.residents=Array.from({length:200},(_,i)=>{const r=structuredClone(template);r.id='workers-'+String(i).padStart(3,'0');r.at={x:13,y:10};r.activity!.target={...r.at};return r;});
 const {v,scene}=view(f.world);assert.ok(scene.budgetMarkerCount!>0);assert.ok(scene.omittedObjects>0);assert.equal(scene.objects.filter(o=>o.subject.kind==='resident').length,VIEWPORT_LIMITS.objects);
 assert.ok(scene.objects.filter(o=>o.subject.kind==='resident').every(o=>o.subject.at.x===13&&o.subject.at.y===10));
 assert.equal(scene.renderedMarkerCount,scene.budgetMarkerCount);for(const time of [0,260,520,780,1e6]){const animated=v.animate(scene,time);assert.ok(marks(animated)<=VIEWPORT_LIMITS.marks);assert.deepEqual(animated.objects.map(o=>o.key),scene.objects.map(o=>o.key));}
});

test('coverage integration: pause-aware residents freeze without source scans and rendered pixel hits retain identity',()=>{
 const f=isometricResidentsFixture();f.world.clock.paused=true;const {v,scene}=view(f.world),before=v.stats;
 for(const key of ['residents','buildings','resources','plots','graves','industry','health'] as const)Object.defineProperty(f.world,key,{get(){throw new Error('unexpected source scan: '+key);}});
 assert.deepEqual(v.animate(scene,1e9).objects,scene.objects);assert.equal(v.stats.poseBuilds,before.poseBuilds);
 for(const id of [f.walk.id,f.baby.id,f.body.id]){const o=scene.objects.find(o=>o.subject.id===id)!;assert.ok(o.marks.some(m=>{const hit=pickIsometricStudy(scene,{x:m.x+scene.camera.origin.x+.5,y:m.y+scene.camera.origin.y+.5});return hit&&'id'in hit&&hit.id===id;}),id);}
});

test('coverage integration: unsupported multi-tile structures retain bounded recorded footprints across buckets',()=>{
 const {world}=isometricStudyFixture();world.map={...world.map,width:100,height:100,tiles:Array(10000).fill('grass')};world.resources=[];world.plots=[];world.residents=[];
 world.buildings=[{...world.buildings[0],kind:'future-building' as BuildingKind,at:{x:4,y:20},width:20,height:2,door:{x:15,y:22}}];
 const {v}=view(world),scene=v.render(fitWorldCamera(world,{x:24,y:21},180,120,3),180,120);assert.ok(scene.bounds.x>4);assert.equal(scene.unsupportedObjects,1);
 // A neutral marker has an exact anchor. Its footprint must remain indexed even when that marker is off-screen.
 const full=v.render(fitWorldCamera(world,{x:14,y:21},900,600,1.5),900,600),o=full.objects.find(o=>o.subject.kind==='building')!;assert.ok(o.subject.placeholder);assert.deepEqual(o.footprint,{x:4,y:20,width:20,height:2});assert.deepEqual(o.subject.at,{x:4,y:20});
});

test('coverage integration: final art null and viewport budgets disclose markers or explicit omissions',()=>{
 const {world}=isometricStudyFixture();world.map={...world.map,width:100,height:100,tiles:Array(10000).fill('grass')};world.resources=[];world.plots=[];world.residents=[];
 world.buildings=Array.from({length:30},(_,i)=>({...world.buildings[0],id:'large-'+i,at:{x:10,y:10},width:40,height:40,door:{x:12,y:50}}));
 const {scene}=view(world,{x:30,y:30});assert.ok(marks(scene)<=VIEWPORT_LIMITS.marks);assert.ok(scene.objects.every(o=>!!o.subject.placeholder));assert.ok(scene.unsupportedObjects+scene.omittedObjects>=30);
});

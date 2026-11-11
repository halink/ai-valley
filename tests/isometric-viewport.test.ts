import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {IsometricViewport,fitWorldCamera,constrainWorldCamera,zoomWorldCamera,visibleWorldBounds,VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {projectIsometric,screenToIsometric} from '../src/client/isometric-projection.js';
import {pickIsometricStudy,rasterIsometricStudy,terrain} from '../src/client/isometric-study.js';
import {calendar} from '../src/world/time.js';
import type {World,Snapshot} from '../src/shared/types.js';
const snapshot=(world:World):Snapshot=>({world,serverTime:'2026-01-01T00:00:00Z',version:'test',capabilities:{active:[],pending:[]}});
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
function setup(){const {world}=isometricStudyFixture();world.minute=720;const viewport=new IsometricViewport();viewport.accept(snapshot(world));return {world,viewport};}
const count=(scene:ReturnType<IsometricViewport['render']>)=>scene.terrain.length+scene.objects.reduce((n,o)=>n+o.marks.length,0);

test('frozen snapshot renders and animates without world writes, scans, or static rebuilds',()=>{
 const {world,viewport}=setup(),before=structuredClone(world);freeze(world);const camera=fitWorldCamera(world,{x:6,y:6},640,480),scene=viewport.render(camera,640,480),stats=viewport.stats;
 const animated=viewport.animate(scene,480);assert.deepEqual(world,before);assert.equal(animated.terrain,scene.terrain);assert.equal(viewport.stats.poseBuilds,stats.poseBuilds);assert.equal(viewport.stats.bucketBuilds,1);assert.equal(viewport.stats.chunkBuilds,stats.chunkBuilds);
 for(const o of scene.objects.filter(o=>o.subject.kind!=='resident'))assert.equal(animated.objects.find(v=>v.key===o.key),o);
 assert.ok(count(animated)<=60000);assert.ok(rasterIsometricStudy(animated).length>0);
});
test('native source crop uses integer origin and retains fractional display camera',()=>{
 const {world,viewport}=setup(),camera=fitWorldCamera(world,{x:6.123,y:5.812},511,337,1.37),scene=viewport.render(camera,511,337);
 assert.deepEqual(scene.camera,{origin:{x:Math.ceil(camera.origin.x/camera.zoom),y:Math.ceil(camera.origin.y/camera.zoom)},zoom:1});assert.equal(scene.width,Math.ceil(511/camera.zoom)+2);assert.equal(scene.height,Math.ceil(337/camera.zoom)+2);assert.deepEqual(scene.displayCamera,camera);
});
test('zoom keeps the world point under the anchor and bounded camera has no more than 40 cells per axis',()=>{
 const {world}=setup();world.map.width=500;world.map.height=500;
 for(const [width,height] of [[320,240],[1200,800],[390,844],[8000,3000]]){
  const c=fitWorldCamera(world,{x:250,y:250},width,height,.001),b=visibleWorldBounds(c,world,width,height);assert.ok(b.width<=40&&b.height<=40,JSON.stringify(b));
  const anchor={x:width*.6,y:height*.4},next=zoomWorldCamera(c,world,width,height,anchor,.5),a=screenToIsometric(anchor,c)!,n=screenToIsometric(anchor,next)!;assert.ok(Math.abs(a.x-n.x)<1e-9&&Math.abs(a.y-n.y)<1e-9);
  assert.deepEqual(constrainWorldCamera(c,world,width,height),c);
 }
});
test('complete cross-bucket home is retained when its anchor lies outside visible cells',()=>{
 const {world,viewport}=setup();world.map={...world.map,width:100,height:100,tiles:Array(10000).fill('grass')};world.buildings=[{...world.buildings[0],at:{x:4,y:20},width:20,height:2,door:{x:15,y:22}}];world.residents=[];world.resources=[];world.plots=[];viewport.accept(snapshot(structuredClone(world)));
 const scene=viewport.render(fitWorldCamera(world,{x:24,y:21},180,120,3),180,120);assert.ok(scene.bounds.x>4);const home=scene.objects.find(o=>o.subject.kind==='building')!;assert.ok(home);assert.equal(home.footprint.width,20);assert.ok(home.marks.some(m=>m.x<projectIsometric({x:scene.bounds.x,y:20}).x));
 const full=viewport.render(fitWorldCamera(world,{x:14,y:21},900,600,1.5),900,600);let picked=false;for(const mark of home.marks){const p={x:mark.x+full.camera.origin.x,y:mark.y+full.camera.origin.y};if(pickIsometricStudy(full,p)?.kind==='building'){picked=true;break;}}assert.ok(picked);
});
test('terrain cache survives new snapshots and daylight but invalidates neighbor tile and season changes',()=>{
 const {world,viewport}=setup(),c=fitWorldCamera(world,{x:6,y:6},640,480);const noon=viewport.render(c,640,480),initial=viewport.stats;
 const next=structuredClone(world);next.minute=22*60;viewport.accept(snapshot(next));const night=viewport.render(c,640,480);assert.equal(viewport.stats.chunkBuilds,initial.chunkBuilds);assert.notEqual(night.terrain[0].color,noon.terrain[0].color);
 const changed=structuredClone(next);changed.map.tiles[7]='water';viewport.accept(snapshot(changed));assert.ok(viewport.stats.chunkInvalidations>=2);viewport.render(c,640,480);const builds=viewport.stats.chunkBuilds;
 changed.minute=1440*28;viewport.accept(snapshot(structuredClone(changed)));viewport.render(c,640,480);assert.ok(viewport.stats.chunkBuilds>builds);
});
test('terrain chunks never add study cut-edge cliffs and each tile stays at most 28 marks',()=>{
 const {world}=setup();world.map.tiles.fill('water');const b={x:2,y:2,width:1,height:1},marks=terrain(world,b,calendar(world.minute).season,{cutEdges:false,maxTileMarks:28});assert.ok(marks.length<=28);const bottom=projectIsometric({x:3,y:3}).y;assert.ok(marks.every(m=>m.y+m.height<=bottom));
});
test('dense scenes, animated frames, and cache stay inside object and mark budgets',()=>{
 const {world,viewport}=setup();world.map={...world.map,width:128,height:128,tiles:Array(128*128).fill('grass')};world.resources=[];world.buildings=[];world.plots=[];world.residents=Array.from({length:300},(_,i)=>({...structuredClone(world.residents[0]),id:'dense-'+i,at:{x:50+i%10,y:50+Math.floor(i/10)%10},activity:null}));viewport.accept(snapshot(structuredClone(world)));
 const scene=viewport.render(fitWorldCamera(world,{x:55,y:55},1024,768,.01),1024,768);assert.ok(scene.objects.length<=192);assert.ok(scene.omittedObjects>0);assert.ok(count(scene)<=60000);
 for(const time of [0,240,480,720,840])assert.ok(count(viewport.animate(scene,time))<=60000);
 for(let n=0;n<32;n++)viewport.render(fitWorldCamera(world,{x:n*4,y:n*4},320,240,2),320,240);assert.ok(viewport.stats.cachedChunks<=64);assert.ok(viewport.stats.cachedMarks<=100000);
});
test('malformed snapshot acceptance rolls back cache, buckets, records, and counters on every retry',()=>{
 const {world,viewport}=setup(),camera=fitWorldCamera(world,{x:6,y:6},640,480),scene=viewport.render(camera,640,480),stats=viewport.stats,bad=structuredClone(world);bad.residents.push({...bad.residents[0]});
 for(let i=0;i<2;i++){assert.throws(()=>viewport.accept(snapshot(bad)),/duplicate/);assert.deepEqual(viewport.stats,stats);}
 assert.deepEqual(viewport.render(camera,640,480).objects,scene.objects);const next=structuredClone(world);next.revision++;viewport.accept(snapshot(next));assert.equal(viewport.animate(scene,500),scene);
});
test('unsupported graves and resource kinds are disclosed, never converted to made-up art',()=>{
 const {world,viewport}=setup();world.graves=[{id:'unknown',at:{x:2,y:2}} as World['graves'][number]];world.resources.push({...world.resources[0],id:'unknown-resource',kind:'unknown' as World['resources'][number]['kind']});viewport.accept(snapshot(structuredClone(world)));const scene=viewport.render(fitWorldCamera(world,{x:6,y:6},640,480),640,480);assert.ok(scene.unsupportedObjects>=2);assert.ok(scene.objects.some(o=>o.subject.kind==='grave'&&o.subject.placeholder));assert.ok(scene.objects.some(o=>o.subject.id==='unknown-resource'&&o.subject.placeholder));
});

test('animation reads cached visible poses without consulting world collections',()=>{
 const {world,viewport}=setup(),scene=viewport.render(fitWorldCamera(world,{x:6,y:6},640,480),640,480);
 for(const name of ['resources','residents','buildings','plots','graves','health','industry'] as const)Object.defineProperty(world,name,{get(){throw new Error('world collection read during animation: '+name);}});
 assert.doesNotThrow(()=>viewport.animate(scene,720));
});
test('unknown oversized structures are disclosed without unbounded art construction',()=>{
 const {world,viewport}=setup();world.map={...world.map,width:128,height:128,tiles:Array(128*128).fill('grass')};world.buildings=[{...world.buildings[0],width:100,height:100}];viewport.accept(snapshot(structuredClone(world)));const scene=viewport.render(fitWorldCamera(world,{x:50,y:50},640,480),640,480);assert.ok(scene.unsupportedObjects>0);assert.ok(scene.renderedMarkerCount>=0);assert.ok(!scene.objects.some(o=>o.subject.kind==='building'&&!o.subject.placeholder));
});

test('same successfully accepted world reference never rebuilds indexes during panning',()=>{
 const {world,viewport}=setup(),s=snapshot(world),before=viewport.stats;viewport.accept(s);viewport.accept(s);viewport.accept(snapshot(world));assert.equal(viewport.stats.bucketBuilds,before.bucketBuilds);assert.equal(viewport.stats.poseBuilds,before.poseBuilds);
 const bad=structuredClone(world);bad.residents.push({...bad.residents[0]});const failed=snapshot(bad);assert.throws(()=>viewport.accept(failed),/duplicate/);assert.throws(()=>viewport.accept(failed),/duplicate/);assert.equal(viewport.stats.bucketBuilds,before.bucketBuilds);
});
test('restored living art and remaining placeholders preserve exact identities and locations',()=>{
 const {world,viewport}=setup();world.buildings[0].kind='barn';world.residents[0].lifeStage='infant';world.graves=[{id:'grave-without-burial',at:{x:5,y:4},personId:world.residents[1].id,buriedAt:null}];
 world.industry={animals:[],fishing:{}} as unknown as World['industry'];world.frontierHazards={beasts:[]} as unknown as World['frontierHazards'];
 world.industry!.animals=[{id:'animal-known',kind:'goat',at:{x:5,y:5},status:'alive',inside:null} as NonNullable<World['industry']>['animals'][number],{id:'animal-unknown',kind:'goat',status:'alive',inside:null} as NonNullable<World['industry']>['animals'][number]];
 world.industry!.fishing={'recorded-pool':{amount:3,progress:0,lastMinute:0,shoal:{anchor:{x:9,y:5},at:{x:10,y:5},nextMoveAt:0,activity:'feeding'}},'unknown-pool':{amount:3,progress:0,lastMinute:0}};
 world.frontierHazards!.beasts=[{id:'beast-known',species:'wolf',at:{x:6,y:5},status:'alive'} as NonNullable<World['frontierHazards']>['beasts'][number]];
 const expected=structuredClone(world);freeze(world);viewport.accept(snapshot(structuredClone(world)));const scene=viewport.render(fitWorldCamera(world,{x:6,y:6},640,480),640,480);
 for(const [id,kind,at] of [['recorded-pool','fish',{x:10,y:5}]] as const){const o=scene.objects.find(o=>o.subject.id===id&&o.subject.kind===kind)!;assert.ok(o?.subject.placeholder,String(id));assert.deepEqual(o.subject.at,at);assert.equal(o.marks.length,7);}
 for(const [id,kind,at] of [[world.buildings[0].id,'building',world.buildings[0].at],[world.residents[0].id,'resident',world.residents[0].at],['grave-without-burial','grave',{x:5,y:4}],['animal-known','animal',{x:5,y:5}],['beast-known','beast',{x:6,y:5}]] as const){const o=scene.objects.find(o=>o.subject.id===id&&o.subject.kind===kind)!;assert.ok(o&&!o.subject.placeholder,String(id));assert.deepEqual(o.subject.at,at);assert.ok(o.marks.length>7);}
 assert.ok(!scene.objects.some(o=>o.subject.id==='animal-unknown'||o.subject.id==='unknown-pool'));assert.ok(scene.unknownLocationCount>=2);assert.ok(scene.renderedMarkerCount>=1);assert.deepEqual(world,expected);
 const grave=scene.objects.find(o=>o.subject.kind==='grave')!;assert.match(grave.subject.description!,/待葬/);assert.ok(grave.subject.description!.includes(world.residents[1].id));

});

test('all original outdoor record families disclose known positions and omit retired, dead and indoor records',()=>{
 const {world,viewport}=setup(),at={x:6,y:6},person=world.residents[0];person.at={...at};world.residents=[person];world.buildings=[];world.resources=[];world.plots=[];world.graves=[];world.estates=[];
 world.industry={trees:[{id:'orchard',at,status:'growing'},{id:'cut-orchard',at,status:'cut'}],tools:[],animals:[{id:'dead-animal',at,status:'dead'},{id:'indoor-animal',at,status:'alive',inside:'room'}],fishing:{},pastures:[{id:'pasture',tiles:[at,{x:7,y:6}]},{id:'retired-pasture',tiles:[at],status:'retired'}],pastureProjects:[{id:'pasture-project',at,fenceBuilt:true,status:'building'}],frontierShore:at,livestockCargo:[{id:'crate',container:'person:'+person.id,status:'crated'}]} as unknown as NonNullable<World['industry']>;
 world.infrastructure={assets:[{id:'dock',at,kind:'dock',condition:100,retiredAt:null},{id:'retired-dock',at,kind:'dock',condition:100,retiredAt:1}]} as unknown as NonNullable<World['infrastructure']>;
 world.culture={events:[{id:'prepared-culture',at,preparation:{completedAt:1,clearedAt:null}},{id:'unprepared-culture',at,preparation:{completedAt:null,clearedAt:null}}]} as unknown as NonNullable<World['culture']>;
 world.household={pools:[{id:'household',at,status:'open',credits:[]}]} as unknown as NonNullable<World['household']>;
 world.foreignTrade={shipments:[{id:'cargo',route:{at},goods:1,status:'travelling'},{id:'unknown-cargo',goods:1,status:'travelling'},{id:'completed-cargo',route:{at},goods:1,status:'completed'}]} as unknown as NonNullable<World['foreignTrade']>;
 world.ferries={boats:[{id:'ferry',at}],trips:[]} as unknown as NonNullable<World['ferries']>;
 world.frontierHazards={beasts:[{id:'dead-beast',at,status:'dead'}]} as unknown as NonNullable<World['frontierHazards']>;
 world.construction={projects:[{id:'construction',at,status:'building',reserved:true},{id:'unreserved-construction',at,status:'building',reserved:false}]} as unknown as NonNullable<World['construction']>;
 const before=structuredClone(world);freeze(world);viewport.accept(snapshot(structuredClone(world)));const scene=viewport.render(fitWorldCamera(world,at,640,480),640,480);
 for(const id of ['orchard','pasture','pasture-project','village-fishing-shore','crate','dock','prepared-culture','household','cargo','ferry','construction']){const o=scene.objects.find(o=>o.subject.id===id);assert.ok(o?.subject.placeholder,id);assert.deepEqual(o.subject.at,at);assert.equal(o.footprint.width,1);assert.equal(o.footprint.height,1);}
 for(const id of ['dead-animal','indoor-animal','cut-orchard','retired-pasture','retired-dock','unprepared-culture','completed-cargo','dead-beast','unreserved-construction','unknown-cargo'])assert.ok(!scene.objects.some(o=>o.subject.id===id),id);
 assert.equal(scene.unknownLocationCount,1);assert.deepEqual(world,before);
});

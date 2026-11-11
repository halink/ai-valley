import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isometricStudyFixture,isometricStudyAnimationFixture} from '../scripts/isometric-study-fixture.js';
import {projectIsometric,unprojectIsometric,screenToIsometric,pickIsometricTile,projectedFacing,orderIsometricObjects,stableCoordinateFloor} from '../src/client/isometric-projection.js';
import {pickIsometricStudy,rasterIsometricStudy,renderIsometricStudy,type IsometricStudy} from '../src/client/isometric-study.js';
import {personVisual} from '../src/client/person-pose.js';
import {materials as m} from '../src/client/palette.js';

const fixture=()=>{const {world,bounds}=isometricStudyFixture();return {world,bounds,scene:renderIsometricStudy(world,{bounds,elapsed:480})};};
function freeze(value:unknown){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}}
const hash=(scene:IsometricStudy)=>createHash('sha256').update(rasterIsometricStudy(scene)).digest('hex');

test('offline phase exporter uses a distinct synthetic copy and never unpauses or advances its source',()=>{
 const source=isometricStudyFixture(),before=structuredClone(source);freeze(source);const copy=isometricStudyAnimationFixture(source);
 assert.notEqual(copy.world,source.world);assert.notEqual(copy.world.clock,source.world.clock);assert.equal(copy.world.clock.paused,false);assert.equal(source.world.clock.paused,true);
 assert.match(copy.world.clock.reason!,/显示相位/);assert.equal(copy.world.minute,source.world.minute);assert.equal(copy.world.revision,source.world.revision);
 const a=renderIsometricStudy(copy.world,{bounds:copy.bounds,elapsed:0}),b=renderIsometricStudy(copy.world,{bounds:copy.bounds,elapsed:480});assert.notEqual(hash(a),hash(b));
 assert.equal(hash(renderIsometricStudy(source.world,{bounds:source.bounds,elapsed:0})),hash(renderIsometricStudy(source.world,{bounds:source.bounds,elapsed:480})));assert.deepEqual(source,before);
});

test('2:1 projection round-trips corners, centres and fractional positions, with explicit elevation',()=>{
 for(let x=-40;x<=40;x+=.5)for(let y=-30;y<=30;y+=.5){const at={x,y};assert.deepEqual(unprojectIsometric(projectIsometric(at)),at);}
 assert.deepEqual(projectIsometric({x:2,y:3}),{x:-16,y:40});assert.deepEqual(projectIsometric({x:2,y:3},12),{x:-16,y:28});
});

test('ground picking inverts offset and zoom without a tile-centre bias',()=>{
 const bounds={x:7,y:11,width:13,height:12};
 for(const zoom of [.5,1,1.25,3])for(let y=11;y<23;y++)for(let x=7;x<20;x++){
  const camera={origin:{x:173,y:-25},zoom},at={x:x+.5,y:y+.5},p=projectIsometric(at),screen={x:p.x*zoom+camera.origin.x,y:p.y*zoom+camera.origin.y};
  assert.deepEqual(screenToIsometric(screen,camera),at);assert.deepEqual(pickIsometricTile(screen,camera,bounds),{x,y});
 }
 const camera={origin:{x:0,y:0},zoom:1};
 for(const at of [{x:6.99,y:11},{x:20,y:11},{x:7,y:10.99},{x:7,y:23}])assert.equal(pickIsometricTile(projectIsometric(at),camera,bounds),null);
 assert.deepEqual(pickIsometricTile(projectIsometric({x:7,y:11}),camera,bounds),{x:7,y:11});
 for(const zoom of [0,-1,NaN,Infinity])assert.equal(screenToIsometric({x:0,y:0},{...camera,zoom}),null);
 assert.equal(screenToIsometric({x:NaN,y:0},camera),null);
});

test('projected target directions follow the fixed camera instead of unrotated map axes',()=>{
 assert.equal(projectedFacing({x:1,y:0}),'east');assert.equal(projectedFacing({x:0,y:1}),'west');
 assert.equal(projectedFacing({x:0,y:-1}),'east');assert.equal(projectedFacing({x:-1,y:0}),'west');
 assert.equal(projectedFacing({x:1,y:1}),'south');assert.equal(projectedFacing({x:-1,y:-1}),'north');
});

test('footprint depth places residents behind and in front of every visible house side',()=>{
 const box=(key:string,x:number,y:number,width=1,height=1)=>({key,footprint:{x,y,width,height}});
 const objects=[box('house',2,2,5,3),box('north',4,1),box('south',2,5),box('east',7,2),box('west',1,4)];
 const keys=orderIsometricObjects(objects).map(o=>o.key),house=keys.indexOf('house');
 for(const key of ['north','west'])assert.ok(keys.indexOf(key)<house);
 for(const key of ['south','east'])assert.ok(keys.indexOf(key)>house);
 assert.deepEqual(orderIsometricObjects([...objects].reverse()).map(o=>o.key),keys);
 assert.equal(new Set(keys).size,objects.length);
 assert.deepEqual(objects[0],box('house',2,2,5,3));
});

test('read-only snapshot rendering is deterministic across frames and all seasons',()=>{
 const {world,bounds}=fixture(),before=structuredClone(world);freeze(world);
 for(const season of ['spring','summer','autumn','winter'] as const)for(const elapsed of [0,240,480,720,840,2520]){
  const a=renderIsometricStudy(world,{bounds,elapsed,season}),b=renderIsometricStudy(world,{bounds,elapsed,season});assert.equal(hash(a),hash(b));
 }
 assert.deepEqual(world,before);
});

test('every paint mark has positive integer dimensions and lies within the study canvas',()=>{
 const {world,bounds}=fixture();
 for(const season of ['spring','summer','autumn','winter'] as const)for(const elapsed of [0,240,480,720,840,2520]){
  const scene=renderIsometricStudy(world,{bounds,elapsed,season}),origin=scene.camera.origin;
  for(const mark of [...scene.terrain,...scene.objects.flatMap(o=>o.marks)]){
   for(const n of [mark.x,mark.y,mark.width,mark.height])assert.ok(Number.isInteger(n));
   assert.ok(mark.width>0&&mark.height>0);assert.match(mark.color,/^#[0-9a-f]{6}$/i);
   assert.ok(mark.x+origin.x>=0&&mark.y+origin.y>=0);assert.ok(mark.x+origin.x+mark.width<=scene.width&&mark.y+origin.y+mark.height<=scene.height);
  }
 }
});

test('roof and canopy picking hits visible identity before the ground underneath',()=>{
 const {scene}=fixture();
 for(const kind of ['building','tree','resident','plot']){
  const object=scene.objects.find(o=>o.subject.kind===kind)!;
  let found=false;
  for(const mark of object.marks){
   const point={x:mark.x+scene.camera.origin.x+.5,y:mark.y+scene.camera.origin.y+.5},hit=pickIsometricStudy(scene,point);
   if(hit?.kind===kind&&'id' in hit&&hit.id===object.subject.id){found=true;break;}
  }
  assert.ok(found,kind+' must have a visible, selectable part');
 }
 const house=scene.objects.find(o=>o.subject.kind==='building')!,roof=house.marks.reduce((a,b)=>a.y<b.y?a:b);
 const point={x:roof.x+scene.camera.origin.x+.5,y:roof.y+scene.camera.origin.y+.5};
 assert.deepEqual(pickIsometricStudy(scene,point),house.subject);
 assert.notDeepEqual(pickIsometricTile(point,scene.camera,scene.bounds),house.subject.at);
 assert.equal(pickIsometricStudy(scene,{x:-100,y:-100}),null);
});

test('foremost opaque pixels win at actual overlapping objects and at scaled zoom',()=>{
 const {scene}=fixture();let collisions=0;
 for(let i=1;i<scene.objects.length;i++){
  const front=scene.objects[i];
  for(const mark of front.marks){
   const x=mark.x,y=mark.y;
   if(!scene.objects.slice(0,i).some(o=>o.marks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height)))continue;
   if(scene.objects.slice(i+1).some(o=>o.marks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height)))continue;
   const scaled={...scene,camera:{origin:{x:120,y:75},zoom:2.5}};
   assert.deepEqual(pickIsometricStudy(scaled,{x:(x+.5)*2.5+120,y:(y+.5)*2.5+75}),front.subject);collisions++;break;
  }
 }
 assert.ok(collisions>=3,'composition should exercise several visible occlusions');
});

test('ground layers never cover residents, and unoccupied plots never grow invented crops',()=>{
 const {world,bounds}=fixture();const empty=world.plots.find(p=>!p.crop)!,scene=renderIsometricStudy(world,{bounds});
 const firstSolid=scene.objects.findIndex(o=>o.subject.kind!=='plot'),lastPlot=scene.objects.map(o=>o.subject.kind).lastIndexOf('plot');assert.ok(lastPlot<firstSolid);
 assert.ok(!scene.objects.find(o=>o.subject.id===empty.id)!.marks.some(mark=>mark.color===m.seedling));
});

test('growth and watering use recorded crop duration and day, unknown definitions do not infer ripe plants',()=>{
 const {world,bounds}=fixture(),plot=world.plots[0];plot.crop={definition:'crop/turnip@1',growth:1,planted:0,wateredDay:-1,lastGrowthDay:0};
 const marks=()=>renderIsometricStudy(world,{bounds}).objects.find(o=>o.subject.id===plot.id)!.marks;
 const young=marks();plot.crop.growth=4;assert.notDeepEqual(marks(),young);
 plot.crop.definition='crop/unknown@1';assert.ok(!marks().some(mark=>mark.color===m.seedling));
 plot.crop.wateredDay=Math.floor(world.minute/1440);assert.ok(marks().some(mark=>mark.color===m.wetEarth));
 plot.crop.wateredDay--;assert.ok(!marks().some(mark=>mark.color===m.wetEarth));
});

test('labor frames require actual on-site action; travel, death, outside and indoor positions do not fabricate work',()=>{
 const {world,bounds}=fixture(),r=world.residents[0];world.clock.paused=false;assert.equal(personVisual(world,r).pose,'water');
 const marks=(time:number)=>renderIsometricStudy(world,{bounds,elapsed:time}).objects.find(o=>o.subject.id===r.id)?.marks;
 assert.equal(new Set([0,240,480,720].map(t=>JSON.stringify(marks(t)))).size,4);
 r.activity!.path=[{x:6,y:7}];assert.equal(personVisual(world,r).pose,'idle');assert.notDeepEqual(marks(0),marks(260));assert.match(renderIsometricStudy(world,{bounds}).objects.find(o=>o.subject.id===r.id)!.subject.description!,/行走/);r.activity!.path=[];
 r.status='dead';assert.ok(marks(0));assert.deepEqual(marks(0),marks(480));assert.match(renderIsometricStudy(world,{bounds}).objects.find(o=>o.subject.id===r.id)!.subject.description!,/遗体/);r.status='alive';r.residency='outside';assert.equal(marks(0),undefined);r.residency='resident';
 r.regionalLocation={routeId:'road',origin:'elsewhere',progress:1,duration:10};assert.equal(marks(0),undefined);delete r.regionalLocation;
 r.inside='study-home';assert.equal(marks(0),undefined);r.inside=null;r.at.x=NaN;assert.equal(marks(0),undefined);r.at.x=6.5;assert.equal(marks(0),undefined);
});

test('settled fishing line ends at the real projected adjacent water, without a fish or completion cue',()=>{
 const {world,bounds}=fixture(),r=world.residents[1],visual=personVisual(world,r);world.clock.paused=false;assert.equal(visual.pose,'fish');assert.deepEqual(visual.focus,{x:1,y:0});
 const scene=renderIsometricStudy(world,{bounds,elapsed:840}),marks=scene.objects.find(o=>o.subject.id===r.id)!.marks;
 const target=projectIsometric({x:r.at.x+1.5,y:r.at.y+.5});
 assert.ok(marks.some(p=>p.color===m.berryDark&&p.x===target.x-1&&p.y===target.y&&p.width===3&&p.height===2));
 const before=structuredClone(world);renderIsometricStudy(world,{bounds,elapsed:99999});assert.deepEqual(world,before);assert.equal(world.events.length,0);
});

test('known structures are illustrated and unknown or partial structures remain explicit, with strict patch bounds',()=>{
 const {world,bounds}=fixture(),house=world.buildings[0];house.kind='clinic';assert.ok(renderIsometricStudy(world,{bounds}).objects.some(o=>o.subject.kind==='building'&&!o.subject.placeholder));
 house.kind='unknown' as typeof house.kind;assert.ok(renderIsometricStudy(world,{bounds}).objects.some(o=>o.subject.kind==='building'&&o.subject.placeholder));
 house.kind='home';house.width=NaN;assert.ok(renderIsometricStudy(world,{bounds}).objects.some(o=>o.subject.kind==='building'&&o.subject.placeholder));house.width=3;
 const partial=renderIsometricStudy(world,{bounds:{x:2,y:2,width:2,height:2}});assert.ok(partial.objects.some(o=>o.subject.kind==='building'&&o.subject.placeholder));
 for(const bad of [{...bounds,width:33},{...bounds,x:-1},{...bounds,height:0},{...bounds,x:.5},{...bounds,width:Infinity}])assert.throws(()=>renderIsometricStudy(world,{bounds:bad}),/isometric_study_bounds/);
});

test('empty and occupied memorial stones remain distinct, without adding names or funerary events',()=>{
 const {world,bounds}=fixture();world.graves=[{id:'empty',at:{x:3,y:9},personId:null,buriedAt:null},{id:'occupied',at:{x:4,y:9},personId:'remembered',buriedAt:0}];const before=structuredClone(world),scene=renderIsometricStudy(world,{bounds});
 assert.ok(scene.objects.find(o=>o.subject.id==='occupied')!.marks.length>scene.objects.find(o=>o.subject.id==='empty')!.marks.length);assert.deepEqual(world,before);
});

test('formal entry and default scene never import this independent study',()=>{
 for(const file of ['src/client/main.ts','src/client/scene.ts','index.html'])assert.doesNotMatch(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/(?:from|import)[^\n]*(?:isometric-study|development-preview|dev-observer)/);
});


test('nonbinary zoom keeps exact grid edges stable without swallowing genuine outside points',()=>{
 const bounds={x:7,y:11,width:13,height:12};
 for(const zoom of [.1,.3,.6,.7,.9,1.1,1.2,1.3,1.7,2.2]){
  const camera={origin:{x:173,y:-25},zoom};
  const screen=(x:number,y:number)=>{const p=projectIsometric({x,y});return {x:camera.origin.x+p.x*zoom,y:camera.origin.y+p.y*zoom};};
  for(let y=11;y<23;y++)for(let x=7;x<20;x++)assert.deepEqual(pickIsometricTile(screen(x,y),camera,bounds),{x,y});
  for(const [x,y] of [[7-1e-9,11],[20,11],[20+1e-9,11],[7,11-1e-9],[7,23],[7,23+1e-9]])assert.equal(pickIsometricTile(screen(x,y),camera,bounds),null);
  assert.deepEqual(pickIsometricTile(screen(20-1e-9,23-1e-9),camera,bounds),{x:19,y:22});
 }
 assert.equal(stableCoordinateFloor(-1e-9),-1);
});

test('visible pixel edges retain their identity under nonbinary zoom',()=>{
 const {scene}=fixture();
 for(const zoom of [.1,.3,.7,1.1,1.3]){
  const camera={origin:{x:173,y:-25},zoom},scaled={...scene,camera};
  for(const object of scene.objects)for(const mark of object.marks.filter((_,i)=>i%19===0)){
   const base={x:mark.x+scene.camera.origin.x,y:mark.y+scene.camera.origin.y};
   const point={x:mark.x*zoom+camera.origin.x,y:mark.y*zoom+camera.origin.y};
   assert.deepEqual(pickIsometricStudy(scaled,point),pickIsometricStudy(scene,base));
  }
 }
});

test('infant and severe illness are distinct supported poses while unverified carried locations remain unknown',()=>{
 const {world,bounds}=fixture(),r=world.residents[0];
 const shown=()=>renderIsometricStudy(world,{bounds}).objects.some(o=>o.subject.kind==='resident'&&o.subject.id===r.id&&!o.subject.placeholder);
 r.lifeStage='infant';assert.equal(shown(),true);const infant=renderIsometricStudy(world,{bounds}).objects.find(o=>o.subject.id===r.id)!.marks;r.lifeStage='adult';assert.equal(shown(),true);assert.notDeepEqual(renderIsometricStudy(world,{bounds}).objects.find(o=>o.subject.id===r.id)!.marks,infant);
 world.health={cases:[],appointments:[],transportOffers:[],pulses:[],nextSerial:1,lastDay:0,totals:{injuries:0,illnesses:0,recovered:0,treated:0,paid:0,refunded:0},transports:[{id:'rescue',carrierId:world.residents[1].id,patientId:r.id,buildingId:'study-home',bed:0,basis:'consent',offerId:null,phase:'carrying',startedAt:world.minute-10,endedAt:null,reason:null}]};
 assert.equal(personVisual(world,r).pose,'carried');assert.equal(shown(),false);assert.ok(renderIsometricStudy(world,{bounds}).unknownLocationCount!>0);
 world.health.transports=[];world.health.cases=[{id:'injury',personId:r.id,kind:'injury',source:'synthetic',severity:80,stage:'acute',startedAt:world.minute,lastAt:world.minute,resolvedAt:null,treatment:0,capacity:null}];
 assert.equal(personVisual(world,r).pose,'ill');assert.equal(shown(),true);assert.match(renderIsometricStudy(world,{bounds}).objects.find(o=>o.subject.id===r.id)!.subject.description!,/重伤病/);
 world.health.cases[0].stage='resolved';assert.equal(shown(),true);
});


test('offline raster export rejects a runtime zoom or subpixel origin rather than silently ignoring it',()=>{
 const {scene}=fixture();
 assert.throws(()=>rasterIsometricStudy({...scene,camera:{...scene.camera,zoom:2}}),/isometric_static_raster_camera/);
 assert.throws(()=>rasterIsometricStudy({...scene,camera:{zoom:1,origin:{x:.5,y:0}}}),/isometric_static_raster_camera/);
});

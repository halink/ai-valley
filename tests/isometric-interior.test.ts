import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {World,Snapshot,Resident} from '../src/shared/types.js';
import {IsometricHomeInterior,homeInteriorSupport,fitRoomCamera,constrainRoomCamera,zoomRoomCamera,visibleRoomBounds,HOME_INTERIOR_LIMITS} from '../src/client/isometric-interior.js';
import {VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {pickIsometricStudy,rasterIsometricStudy} from '../src/client/isometric-study.js';
import {screenToIsometric} from '../src/client/isometric-projection.js';
import {residentRoomPositionKnown} from '../src/client/resident-follow.js';
import {personVisual} from '../src/client/person-pose.js';

const snapshot=(world:World):Snapshot=>({world,serverTime:'2026-01-01T00:00:00Z',version:'test',capabilities:{active:[],pending:[]}});
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}
function setup(){
 const {world}=isometricStudyFixture(),home=world.buildings[0];world.rooms={tick:0,claims:[],beds:{}};world.minute=720;world.estates=[];
 for(const [i,r] of world.residents.entries()){r.homeId=home.id;r.inside=home.id;r.roomAt={x:7+i,y:10};r.at={...home.door};r.activity=null;}
 home.capacity=2;home.residents=world.residents.map(r=>r.id);
 const view=new IsometricHomeInterior(),layout=roomLayout(world,home);return {world,home,view,layout};
}
const count=(scene:ReturnType<IsometricHomeInterior['render']>)=>scene.terrain.length+scene.objects.reduce((n,o)=>n+o.marks.length,0);
function draw(s:ReturnType<typeof setup>){s.view.accept(snapshot(s.world),s.home.id);return s.view.render(fitRoomCamera(s.layout,null,800,600),800,600);}

test('only authoritative bounded home, lodge and workshop layouts are supported, with early oversized rejection',()=>{
 const {world,home}=setup(),before=structuredClone(world);freeze(world);const support=homeInteriorSupport(world,home.id);assert.equal(support.supported,true);if(support.supported)assert.deepEqual(support.layout,roomLayout(world,home));assert.deepEqual(world,before);
 const missing=structuredClone(world);delete missing.rooms;assert.equal(homeInteriorSupport(missing,home.id).supported,false);assert.equal(homeInteriorSupport(world,'missing').supported,false);
 const lodge=structuredClone(world);lodge.buildings[0].kind='lodge';assert.equal(homeInteriorSupport(lodge,home.id).supported,true);
 for(const kind of ['barn','school','greenhouse'] as const){const other=structuredClone(world);other.buildings[0].kind=kind;assert.equal(homeInteriorSupport(other,home.id).supported,false);}
 for(const change of [{capacity:1e9},{width:1e9},{height:1e9},{capacity:NaN},{width:0},{height:1.5}]){
  const huge=structuredClone(world);Object.assign(huge.buildings[0],change);Object.defineProperty(huge,'industry',{get(){throw new Error('unbounded layout reached stations');}});
  const result=homeInteriorSupport(huge,home.id);assert.equal(result.supported,false);assert.ok(result.reason);
 }
 const max=structuredClone(world);Object.assign(max.buildings[0],{width:32,height:30});const result=homeInteriorSupport(max,home.id);assert.equal(result.supported,true);if(result.supported)assert.ok(result.layout.width*result.layout.height<=HOME_INTERIOR_LIMITS.cells);
});

test('frozen interiors reuse original data and produce selectable real furniture without care facilities',()=>{
 const s=setup(),before=structuredClone(s.world);freeze(s.world);const scene=draw(s),stats=s.view.stats,animated=s.view.animate(scene,480);
 assert.deepEqual(s.world,before);assert.equal(scene.roomId,s.home.id);assert.equal(animated.terrain,scene.terrain);assert.equal(s.view.stats.poseBuilds,stats.poseBuilds);assert.equal(s.view.stats.floorBuilds,stats.floorBuilds);
 assert.deepEqual(scene.objects.filter(o=>o.subject.kind==='roomSlot').map(o=>o.subject.id).sort(),['bed:0','bed:1','kitchen','table']);
 assert.ok(scene.objects.every(o=>o.subject.roomId===s.home.id));assert.ok(!scene.objects.some(o=>o.subject.id==='care'));
 for(const object of scene.objects){assert.ok(object.marks.every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)));}
 for(const id of ['bed:0','table','kitchen']){
  const object=scene.objects.find(o=>o.subject.id===id)!;assert.ok(object);
  assert.ok(object.marks.some(mark=>{const picked=pickIsometricStudy(scene,{x:mark.x+scene.camera.origin.x,y:mark.y+scene.camera.origin.y});return picked&&'id'in picked&&picked.id===id&&'roomId'in picked&&picked.roomId===s.home.id;}),id);
 }
 assert.ok(rasterIsometricStudy(scene).some(n=>n>0));assert.ok(count(scene)<=VIEWPORT_LIMITS.marks);
});

test('residents require actual inside plus roomAt, never home, bed, doorway, or stale outside coordinates',()=>{
 const s=setup(),base=s.world.residents[0],copy=(id:string,change:Partial<Resident>)=>({...structuredClone(base),id,...change});
 s.world.residents=[copy('known',{roomAt:{x:3.25,y:8.5}}),copy('missing',{roomAt:null}),copy('out-of-bounds',{roomAt:{x:999,y:2}}),copy('nonfinite',{roomAt:{x:NaN,y:2}}),copy('home-only',{inside:null,roomAt:null}),copy('other-room',{inside:'elsewhere'}),copy('outside',{residency:'outside'}),copy('regional',{regionalLocation:{origin:'elsewhere',progress:1,duration:4,routeId:'synthetic-route'}})];
 assert.equal(residentRoomPositionKnown(s.world,s.world.residents[0]),true);
 const scene=draw(s);assert.deepEqual(scene.objects.filter(o=>o.subject.kind==='resident').map(o=>o.subject.id),['known']);assert.equal(scene.unknownLocationCount,3);assert.equal(scene.unsupportedObjects,3);
 assert.deepEqual(scene.objects.find(o=>o.subject.id==='known')!.subject.at,{x:3.25,y:8.5});
});

test('real sleep and ordinary cooking render at roomAt while illness, carried and infant retain disclosures',()=>{
 const s=setup(),[sleeper,ill,carried]=s.world.residents;s.home.capacity=6;s.home.residents=s.world.residents.map(r=>r.id);s.layout=roomLayout(s.world,s.home);
 sleeper.roomAt={...s.layout.slots.find(s=>s.key==='bed:0')!.at};s.world.rooms!.beds[s.home.id]={[sleeper.id]:0};sleeper.activity={action:{type:'sleep',minutes:30},planId:'test',startedAt:0,remaining:30,path:[],target:{...s.home.door},definition:'action/routine@1'};
 s.world.health={cases:[{personId:ill.id,stage:'active',severity:80}],transports:[{patientId:carried.id,phase:'carrying'}]} as unknown as World['health'];
 const infant={...structuredClone(ill),id:'infant',lifeStage:'infant' as const,roomAt:{x:5,y:10}},cook={...structuredClone(ill),id:'cook',roomAt:{...s.layout.slots.find(s=>s.key==='kitchen')!.at},activity:{action:{type:'cook' as const,quantity:1},planId:'cook',startedAt:0,remaining:30,path:[],target:{...s.home.door},definition:'action/routine@1'}};
 s.world.residents.push(infant,cook);s.home.residents.push(infant.id,cook.id);
 assert.equal(personVisual(s.world,sleeper).pose,'sleep');assert.equal(personVisual(s.world,ill).pose,'ill');assert.equal(personVisual(s.world,carried).pose,'carried');assert.equal(personVisual(s.world,cook).pose,'work');
 const scene=draw(s),sleepObject=scene.objects.find(o=>o.subject.id===sleeper.id)!;assert.equal(sleepObject.subject.placeholder,undefined);assert.deepEqual(sleepObject.subject.at,sleeper.roomAt);assert.equal(sleepObject.marks.length,8);
 for(const [id,pose] of [[ill.id,'ill'],[carried.id,'carried'],[infant.id,'infant']]){
  const object=scene.objects.find(o=>o.subject.id===id)!;assert.ok(object.subject.placeholder?.includes(pose),id);assert.equal(object.marks.length,7);assert.deepEqual(object.subject.at,s.world.residents.find(r=>r.id===id)!.roomAt);
 }
 const cookingObject=scene.objects.find(o=>o.subject.id===cook.id)!;assert.equal(cookingObject.subject.placeholder,undefined);assert.match(cookingObject.subject.description!,/普通烹饪/);assert.deepEqual(cookingObject.subject.at,cook.roomAt);
 assert.equal(scene.unsupportedObjects,3);assert.equal(scene.renderedMarkerCount,3);
 const walking=structuredClone(s.world);walking.residents[0].roomAt={x:8,y:10};walking.residents[0].activity!.room={buildingId:s.home.id,mode:'work',target:{...sleeper.roomAt!},path:[{x:8,y:9}],progress:0};assert.equal(personVisual(walking,walking.residents[0]).pose,'idle');
 s.view.accept(snapshot(walking),s.home.id);const movingScene=s.view.render(scene.displayCamera,800,600),walkingObject=movingScene.objects.find(o=>o.subject.id===sleeper.id)!;assert.notDeepEqual(walkingObject.marks,sleepObject.marks);assert.ok(walkingObject.marks.length>sleepObject.marks.length);
});

test('buried and carried bodies never reuse stale indoor points as local body markers',()=>{
 const s=setup(),base=s.world.residents[0],dead=(id:string,body:Resident['body'],inside=s.home.id)=>({...structuredClone(base),id,status:'dead' as const,inside,body});
 const carrier=s.world.residents[1],outdoor=s.world.residents[2];outdoor.inside=null;outdoor.roomAt=null;
 s.world.residents.push(dead('local-body',undefined),dead('buried-body',undefined),dead('carried-body',{reservedBy:null,storedAt:null,carriedBy:carrier.id}),dead('leaving-body',{reservedBy:null,storedAt:null,carriedBy:outdoor.id}),dead('conflicting-storage',{reservedBy:null,storedAt:s.home.id,carriedBy:null},'other-room'));
 s.world.graves=[{id:'grave',personId:'buried-body',at:{x:0,y:0},buriedAt:20}];const scene=draw(s);
 assert.ok(scene.objects.find(o=>o.subject.id==='local-body')?.subject.placeholder);
 for(const id of ['buried-body','carried-body','leaving-body','conflicting-storage'])assert.ok(!scene.objects.some(o=>o.subject.id===id),id);
 assert.equal(scene.unknownLocationCount,2);assert.equal(scene.unsupportedObjects,3);
});

test('only a credible completed burial hides an indoor body; reservations and untrusted times preserve records',()=>{
 const s=setup(),base=s.world.residents[0],cases:Array<{id:string;buriedAt:unknown;hidden:boolean}>=[
  {id:'reserved-body',buriedAt:null,hidden:false},{id:'missing-time-body',buriedAt:undefined,hidden:false},
  {id:'negative-time-body',buriedAt:-1,hidden:false},{id:'nan-time-body',buriedAt:NaN,hidden:false},
  {id:'infinite-time-body',buriedAt:Infinity,hidden:false},{id:'future-time-body',buriedAt:s.world.minute+1,hidden:false},
  {id:'string-time-body',buriedAt:'20',hidden:false},{id:'zero-time-body',buriedAt:0,hidden:true},
  {id:'completed-body',buriedAt:20,hidden:true},{id:'current-time-body',buriedAt:s.world.minute,hidden:true},
 ];
 for(const c of cases){s.world.residents.push({...structuredClone(base),id:c.id,status:'dead'});s.world.graves.push({id:'grave:'+c.id,at:{x:0,y:0},personId:c.id,buriedAt:c.buriedAt as number|null,reservedBy:base.id});}
 s.world.residents.push({...structuredClone(base),id:'unreserved-body',status:'dead'},{...structuredClone(base),id:'reserved-unknown-body',status:'dead',roomAt:null});
 s.world.graves.push({id:'grave:unknown',at:{x:0,y:0},personId:'reserved-unknown-body',buriedAt:null,reservedBy:base.id});
 const before=structuredClone(s.world);freeze(s.world);const scene=draw(s);
 for(const c of cases){const object=scene.objects.find(o=>o.subject.id===c.id);assert.equal(!!object,!c.hidden,c.id);if(object){assert.ok(object.subject.placeholder);assert.deepEqual(object.subject.at,base.roomAt);assert.equal(object.subject.roomId,s.home.id);}}
 assert.ok(scene.objects.some(o=>o.subject.id==='unreserved-body'));assert.ok(!scene.objects.some(o=>o.subject.id==='reserved-unknown-body'));
 assert.equal(scene.unknownLocationCount,1);assert.deepEqual(s.world,before);
});

test('indoor estate, tools, animals, crates and preparations retain markers or explicit unknown counts',()=>{
 const s=setup(),at={x:5,y:10},inside=s.home.id,location={at:s.home.door,inside,roomAt:at};
 s.world.estates=[{personId:'departed',inventory:{wood:1},coins:0,status:'protected',heirs:[],location,parcels:[{id:'unknown-parcel',inventory:{wood:2},location:{...location,roomAt:null}}]}] as unknown as World['estates'];
 s.world.industry={stations:[{kind:'loom',buildingId:inside}],tools:[{id:'tool',location}],animals:[{id:'animal',status:'alive',kind:'goat',inside,roomAt:at},{id:'unknown-animal',status:'alive',kind:'goat',inside,roomAt:null},{id:'dead-animal',status:'dead',inside,roomAt:at}],livestockCargo:[{id:'resident-crate',status:'crated',container:'person:'+s.world.residents[0].id},{id:'estate-crate',status:'crated',container:'estate:departed'},{id:'unknown-crate',status:'crated',container:'public:'+inside},{id:'released-crate',status:'released',container:'public:'+inside}]} as unknown as World['industry'];
 s.world.culture={events:[{id:'prepared',buildingId:inside,preparation:{completedAt:1,clearedAt:null}},{id:'cleared',buildingId:inside,preparation:{completedAt:1,clearedAt:2}}]} as unknown as World['culture'];
 s.world.household={pools:[{id:'pool',buildingId:inside,status:'open',credits:[]}],gifts:[]} as unknown as World['household'];
 const before=structuredClone(s.world);freeze(s.world);const scene=draw(s);
 for(const id of ['station:loom','estate:departed','tool:tool','animal','resident-crate','estate-crate'])assert.ok(scene.objects.find(o=>o.subject.id===id)?.subject.placeholder,id);
 for(const id of ['unknown-parcel','unknown-animal','unknown-crate','prepared','pool','dead-animal','released-crate','cleared'])assert.ok(!scene.objects.some(o=>o.subject.id===id),id);
 assert.equal(scene.unknownLocationCount,5);assert.equal(scene.unsupportedObjects,11);assert.equal(scene.renderedMarkerCount,6);assert.deepEqual(s.world,before);
});

test('floor cache survives snapshots and changes only for actual room dimensions or identity',()=>{
 const s=setup(),scene=draw(s),initial=s.view.stats;const next=structuredClone(s.world);next.minute+=10;next.residents[0].roomAt={x:4,y:9};s.view.accept(snapshot(next),s.home.id);s.view.render(scene.displayCamera,800,600);
 assert.equal(s.view.stats.floorBuilds,initial.floorBuilds);assert.ok(s.view.stats.floorHits>initial.floorHits);
 s.view.accept(snapshot(next),s.home.id);assert.equal(s.view.stats.acceptedSnapshots,2);
 const changed=structuredClone(next);changed.buildings[0].width=9;s.view.accept(snapshot(changed),s.home.id);assert.equal(s.view.stats.cachedChunks,0);s.view.render(scene.displayCamera,800,600);assert.ok(s.view.stats.floorBuilds>initial.floorBuilds);
 const another=structuredClone(changed);another.id='another-world';s.view.accept(snapshot(another),s.home.id);assert.equal(s.view.stats.cachedChunks,0);
});

test('animation and panning do not scan world collections or rebuild poses and floors',()=>{
 const s=setup(),scene=draw(s),stats=s.view.stats;
 for(const name of ['buildings','rooms','residents','resources','industry','health','estates','culture','household'] as const)Object.defineProperty(s.world,name,{get(){throw new Error('world scan: '+name);}});
 assert.doesNotThrow(()=>s.view.animate(scene,720));assert.doesNotThrow(()=>s.view.render(scene.displayCamera,800,600,720));assert.equal(s.view.stats.poseBuilds,stats.poseBuilds);assert.equal(s.view.stats.bucketBuilds,stats.bucketBuilds);assert.equal(s.view.stats.floorBuilds,stats.floorBuilds);
});

test('failed acceptance is atomic and old room, snapshot, world and foreign scenes cannot animate',()=>{
 const s=setup(),scene=draw(s),stats=s.view.stats,bad=structuredClone(s.world);bad.residents.push(structuredClone(bad.residents[0]));
 for(let i=0;i<2;i++){assert.throws(()=>s.view.accept(snapshot(bad),s.home.id),/duplicate/);assert.deepEqual(s.view.stats,stats);}
 assert.throws(()=>s.view.accept(snapshot(s.world),'missing'),/unsupported/);assert.deepEqual(s.view.stats,stats);assert.notEqual(s.view.animate(scene,400),scene);
 assert.equal(s.view.animate({...scene},400).snapshotRevision,scene.snapshotRevision);const forged={...scene};assert.equal(s.view.animate(forged,400),forged);
 const other=new IsometricHomeInterior();other.accept(snapshot(s.world),s.home.id);assert.equal(other.animate(scene,400),scene);
 const next=structuredClone(s.world);next.revision++;s.view.accept(snapshot(next),s.home.id);assert.equal(s.view.animate(scene,400),scene);
 const newer=s.view.render(scene.displayCamera,800,600);next.buildings.push({...next.buildings[0],id:'second-home'});s.view.accept(snapshot(next),'second-home');assert.equal(s.view.animate(newer,400),newer);
 const second=s.view.render(scene.displayCamera,800,600),another=structuredClone(next);another.id='different-world';s.view.accept(snapshot(another),'second-home');assert.equal(s.view.animate(second,400),second);
});

test('dense occupants and large supported rooms remain within scene, floor and animation budgets',()=>{
 const s=setup();Object.assign(s.home,{width:32,height:30});s.layout=roomLayout(s.world,s.home);
 s.world.residents=Array.from({length:500},(_,i)=>({...structuredClone(s.world.residents[0]),id:'dense-'+i,roomAt:{x:30+i%6,y:29+Math.floor(i/6)%6}}));s.view.accept(snapshot(s.world),s.home.id);
 const camera=fitRoomCamera(s.layout,{x:32,y:32},1024,768,.001),scene=s.view.render(camera,1024,768);
 assert.ok(scene.omittedObjects>0);assert.ok(scene.objects.length<=VIEWPORT_LIMITS.objects);assert.ok(count(scene)<=VIEWPORT_LIMITS.marks);
 for(const time of [0,240,480,720,840])assert.ok(count(s.view.animate(scene,time))<=VIEWPORT_LIMITS.marks);
 for(let i=0;i<32;i++)s.view.render(fitRoomCamera(s.layout,{x:i*2,y:i*2},320,240,2),320,240);
 assert.ok(s.view.stats.cachedChunks<=VIEWPORT_LIMITS.chunks);assert.ok(s.view.stats.cachedMarks<=VIEWPORT_LIMITS.chunkMarks);
});

test('fractional cameras retain source ceil crop and exact raster correspondence with a larger viewport',()=>{
 const s=setup();s.view.accept(snapshot(s.world),s.home.id);
 const width=311,height=237,camera=fitRoomCamera(s.layout,{x:7.123,y:6.812},width,height,1.37),scene=s.view.render(camera,width,height);
 assert.deepEqual(scene.camera,{origin:{x:Math.ceil(camera.origin.x/camera.zoom),y:Math.ceil(camera.origin.y/camera.zoom)},zoom:1});assert.equal(scene.width,Math.ceil(width/camera.zoom)+2);assert.equal(scene.height,Math.ceil(height/camera.zoom)+2);assert.deepEqual(scene.displayCamera,camera);
 const margin=32,large=s.view.render({...camera,origin:{x:camera.origin.x+margin*camera.zoom,y:camera.origin.y+margin*camera.zoom}},width+2*margin*camera.zoom,height+2*margin*camera.zoom);
 const smallPixels=rasterIsometricStudy(scene),largePixels=rasterIsometricStudy(large),dx=large.camera.origin.x-scene.camera.origin.x,dy=large.camera.origin.y-scene.camera.origin.y;
 assert.equal(dx,margin);assert.equal(dy,margin);
 for(let y=0;y<scene.height;y++)assert.deepEqual(smallPixels.slice(y*scene.width*4,(y+1)*scene.width*4),largePixels.slice(((y+dy)*large.width+dx)*4,((y+dy)*large.width+dx+scene.width)*4));
});

test('room cameras fit real extents, preserve anchor zoom, constrain pan and reject invalid input',()=>{
 const s=setup(),small=fitRoomCamera(s.layout,null,390,650);s.view.accept(snapshot(s.world),s.home.id);const full=s.view.render(small,390,650);
 assert.deepEqual(full.bounds,{x:0,y:0,width:s.layout.width,height:s.layout.height});
 for(const mark of full.terrain){assert.ok(mark.x+full.camera.origin.x>=0);assert.ok(mark.x+mark.width+full.camera.origin.x<=full.width);assert.ok(mark.y+full.camera.origin.y>=0);assert.ok(mark.y+mark.height+full.camera.origin.y<=full.height);}
 Object.assign(s.home,{width:32,height:30});s.layout=roomLayout(s.world,s.home);
 for(const [width,height] of [[320,240],[1200,800],[390,844],[8000,3000]]){
  const c=fitRoomCamera(s.layout,{x:32,y:31},width,height,.001),b=visibleRoomBounds(c,s.layout,width,height);assert.ok(b.width<=40&&b.height<=40,JSON.stringify(b));assert.deepEqual(constrainRoomCamera(c,s.layout,width,height),c);
  const anchor={x:width*.55,y:height*.45},next=zoomRoomCamera(c,s.layout,width,height,anchor,.5),a=screenToIsometric(anchor,c)!,n=screenToIsometric(anchor,next)!;assert.ok(Math.abs(a.x-n.x)<1e-9&&Math.abs(a.y-n.y)<1e-9);
 }
 const c=fitRoomCamera(s.layout,null,640,480),center=screenToIsometric({x:320,y:240},c)!;assert.ok(Math.abs(center.x-s.layout.width/2)<1e-9);assert.ok(Math.abs(center.y-s.layout.height/2)<1e-9);
 assert.throws(()=>constrainRoomCamera({...c,zoom:NaN},s.layout,640,480),/camera/);assert.throws(()=>constrainRoomCamera(c,s.layout,0,480),/dimensions/);assert.throws(()=>zoomRoomCamera(c,s.layout,640,480,{x:NaN,y:0},1),/camera/);
});

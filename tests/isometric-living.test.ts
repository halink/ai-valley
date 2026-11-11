import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricLivingFixture} from '../scripts/isometric-living-fixture.js';
import {beastMarks,livestockMarks,fishMarks,fishComposition,graveState,graveMarks,LIVING_MARK_LIMIT} from '../src/client/isometric-living.js';
import {IsometricViewport,fitWorldCamera,VIEWPORT_LIMITS} from '../src/client/isometric-viewport.js';
import {IsometricPreview,previewHitLabel,previewSelection} from '../src/client/isometric-preview.js';
import {pickIsometricStudy} from '../src/client/isometric-study.js';
import {projectIsometric} from '../src/client/isometric-projection.js';
import type {Snapshot,World,Grave} from '../src/shared/types.js';
import type {WildBeast} from '../src/shared/frontier-hazards.js';
import type {Livestock} from '../src/shared/industry.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';
const freeze=(v:unknown)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}};
const snap=(world:World):Snapshot=>({world,serverTime:'synthetic',version:'synthetic',capabilities:{active:[],pending:[]}});
function render(world:World,x=13,y=10,width=1000,height=700){const v=new IsometricViewport();v.accept(snap(world));const scene=v.render(fitWorldCamera(world,{x,y},width,height),width,height);return {v,scene};}
const total=(s:ReturnType<IsometricViewport['render']>)=>s.terrain.length+s.objects.reduce((n,o)=>n+o.marks.length,0);

test('six wildlife and five livestock species retain snapshot IDs, coordinates, and distinct bounded silhouettes',()=>{
 const {world}=isometricLivingFixture(),copy=structuredClone(world);freeze(world);const {v,scene}=render(world);
 const records=[...world.frontierHazards!.beasts,...world.industry!.animals],signatures=new Set<string>();
 for(const record of records){const o=scene.objects.find(o=>o.subject.id===record.id)!;assert.ok(o&&!o.subject.placeholder,record.id);assert.deepEqual(o.subject.at,record.at);assert.equal(o.key,o.subject.kind+':'+record.id);assert.deepEqual(previewSelection(o.subject),{kind:o.subject.kind,id:record.id});signatures.add(JSON.stringify(o.marks.map(m=>[m.color,m.width,m.height])));assert.ok(o.marks.length<=LIVING_MARK_LIMIT);assert.match(previewHitLabel(world,o.subject),/示意/);}
 assert.equal(signatures.size,11);assert.deepEqual(world,copy);assert.ok(total(v.animate(scene,520))<=VIEWPORT_LIMITS.marks);
});

test('all activity phases are integer, bounded and anchored, unknown activities never invent a movement',()=>{
 const {world}=isometricLivingFixture();
 for(const b of world.frontierHazards!.beasts)for(const kind of ['roam','forage','drink','rest','flee','hunt','raid','defend','shelter','transport','migrate'] as const)for(const elapsed of [0,160,260,520,780,1e9]){
  const a={...b,activity:{kind,reason:'test',target:{x:b.at.x+1,y:b.at.y}}},marks=beastMarks(a,elapsed)!;assert.ok(marks.length<LIVING_MARK_LIMIT);const p=projectIsometric({x:b.at.x+.5,y:b.at.y+.5});assert.ok(marks.every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)&&m.width>0&&m.height>0&&Math.abs(m.x-p.x)<32&&Math.abs(m.y-p.y)<40));
 }
 const b=world.frontierHazards!.beasts[0];delete b.activity;assert.deepEqual(beastMarks(b,0),beastMarks(b,999));
 const a=world.industry!.animals[0];delete a.activity;assert.deepEqual(livestockMarks(a,0),livestockMarks(a,999));
 for(const kind of ['future-activity','','toString',undefined]){
  const activity={kind,reason:'unknown',target:{x:b.at.x+1,y:b.at.y}} as unknown as NonNullable<WildBeast['activity']>;
  assert.deepEqual(beastMarks({...b,activity},0),beastMarks({...b,activity},260));
  assert.deepEqual(livestockMarks({...a,activity},0),livestockMarks({...a,activity},260));
 }
 const pool=world.industry!.fishing['synthetic-pool-carp'];
 for(const activity of ['future-activity','','toString',undefined]){
  const f={...pool,shoal:{...pool.shoal!,activity}} as typeof pool;assert.deepEqual(fishMarks(f,0),fishMarks(f,300));
 }

});

test('grave art requires both a real person reference and a valid burial date, never treats reservation as burial',()=>{
 const {world}=isometricLivingFixture(),[empty,reserved,assigned,buried]=world.graves;
 assert.deepEqual(world.graves.map(g=>graveState(g,world.minute)),['empty','reserved','reserved','buried']);
 const high=(g:Grave)=>Math.min(...graveMarks(g,world.minute)!.map(m=>m.y))-projectIsometric({x:g.at.x+.5,y:g.at.y+.5}).y;
 assert.ok(high(empty)>-10);assert.ok(high(reserved)>-10);assert.ok(high(assigned)>-10);assert.equal(high(buried),-17);
 for(const patch of [{personId:null,buriedAt:0},{buriedAt:undefined},{buriedAt:-1},{buriedAt:NaN},{buriedAt:Infinity},{buriedAt:world.minute+1}])assert.equal(graveState({...buried,...patch} as Grave,world.minute),null);
 assert.ok(graveMarks({...buried,buriedAt:0},0));
});

test('fish show every registered positive species but never create fish identities, counts, or alternative locations',()=>{
 const {world}=isometricLivingFixture(),pool=world.industry!.fishing['synthetic-pool-mixed'],before=structuredClone(world);freeze(world);const {scene}=render(world);
 assert.equal(fishComposition(pool).stocks.length,7);const o=scene.objects.find(o=>o.subject.id==='synthetic-pool-mixed')!;assert.ok(o&&!o.subject.placeholder);assert.deepEqual(o.subject.at,pool.shoal!.at);assert.match(o.subject.description!,/14份/);assert.match(o.subject.description!,/不是逐条个体/);assert.equal(scene.objects.filter(o=>o.subject.id==='synthetic-pool-mixed').length,1);const ids=new Set<string>();for(const [id,f] of Object.entries(world.industry!.fishing)){const at=f.shoal!.at,part=render(world,at.x,at.y).scene;assert.ok(part.objects.some(o=>o.subject.kind==='fish'&&o.subject.id===id&&!o.subject.placeholder));ids.add(id);}assert.equal(ids.size,8);assert.deepEqual(world,before);
 const empty={...pool,amount:0,species:{}};assert.equal(fishComposition(empty).reason,null);assert.equal(fishMarks(empty,0)!.length,2);assert.equal(fishMarks({...pool,species:undefined},0),null);
 for(const malformed of [{...pool,amount:15},{...pool,amount:-1},{...pool,amount:NaN},{...pool,species:{newFish:{amount:14}}},{...pool,species:{carp:{amount:NaN}}}])assert.ok(fishComposition(malformed as typeof pool).reason);
});

test('unsupported, carried, dry-water and missing-position records have explicit markers or unknown counts',()=>{
 const {world}=isometricLivingFixture();world.residents=[];world.buildings=[];world.resources=[];world.graves=[];world.frontierHazards!.beasts=[{id:'unknown-beast',species:'new-beast',at:{x:4,y:5},status:'alive'} as unknown as WildBeast];
 const template=world.industry!.animals[0];world.industry!.animals=[{...template,id:'unknown-kind',kind:'new-animal'} as unknown as Livestock,{...template,id:'carried',carrierId:'carrier'},{...template,id:'unknown-at',at:undefined},{...template,id:'inside',inside:'barn'},{...template,id:'dead',status:'dead'}];
 const pool=world.industry!.fishing['synthetic-pool-carp'];world.industry!.fishing={dry:{...pool,shoal:{...pool.shoal!,at:{x:3,y:4}}},unknown:{...pool,shoal:null},legacy:{...pool,species:undefined,shoal:{...pool.shoal!,at:{x:8,y:5}}}};
 const {scene}=render(world);for(const id of ['unknown-beast','unknown-kind','carried','dry','legacy'])assert.ok(scene.objects.find(o=>o.subject.id===id)?.subject.placeholder,id);for(const id of ['inside','dead','unknown-at','unknown'])assert.ok(!scene.objects.some(o=>o.subject.id===id),id);assert.equal(scene.unknownLocationCount,2);assert.equal(scene.renderedMarkerCount,5);
});

test('fish and animal painted pixels select their original IDs at fractional cameras, including overlap',()=>{
 const {world}=isometricLivingFixture();world.resources=[];world.buildings=[];world.graves=[];const {v}=render(world);
 const camera=fitWorldCamera(world,{x:13,y:10},1000,700,1.37),scene=v.render(camera,1000,700);
 for(const o of scene.objects){const mark=o.marks.find(m=>m.width>1)!;const x=mark.x+.5,y=mark.y+.5;const expected=[...scene.objects].reverse().find(obj=>obj.marks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height))!;assert.deepEqual(pickIsometricStudy({...scene,camera}, {x:x*camera.zoom+camera.origin.x,y:y*camera.zoom+camera.origin.y}),expected.subject);}
 const b=world.frontierHazards!.beasts[0];world.industry!.animals=[{...world.industry!.animals[0],at:{...b.at}}];const overlap=render(world).scene;const foreground=overlap.objects.filter(o=>o.subject.at.x===b.at.x&&o.subject.at.y===b.at.y).at(-1)!;const m=foreground.marks.at(-1)!;assert.equal(pickIsometricStudy(overlap,{x:m.x+.5+overlap.camera.origin.x,y:m.y+.5+overlap.camera.origin.y})?.kind,foreground.subject.kind);
});

test('living animation reuses accepted entries, shades with recorded daylight, and respects pause/visibility/disconnect',()=>{
 const {world}=isometricLivingFixture();world.clock.paused=false;const p=new IsometricPreview();p.accept(snap(world));p.setActive(true);p.setConnected(true);p.resize(1000,700);p.center({x:13,y:10});p.tick(0);assert.equal(p.tick(260),true);
 const stats=p.viewport.stats,scene=p.scene!;for(const name of ['residents','resources','buildings','industry','frontierHazards','graves'] as const)Object.defineProperty(world,name,{get(){throw new Error('scan '+name);}});
 assert.equal(p.tick(520),true);assert.equal(p.viewport.stats.bucketBuilds,stats.bucketBuilds);assert.equal(p.viewport.stats.chunkBuilds,stats.chunkBuilds);assert.equal(p.scene!.terrain,scene.terrain);
 for(const change of [()=>p.setVisible(false),()=>{p.setVisible(true);p.setConnected(false);},()=>{p.setConnected(true);world.clock.paused=true;}]){change();const before=p.elapsed;p.tick(1000);p.tick(1250);assert.equal(p.elapsed,before);}
 const day=isometricLivingFixture().world,night=structuredClone(day);night.minute=23*60;const d=render(day).scene,n=render(night).scene;const id=day.industry!.animals[0].id;const dm=d.objects.find(o=>o.subject.id===id)!.marks,nm=n.objects.find(o=>o.subject.id===id)!.marks;assert.equal(dm.length,nm.length);assert.notEqual(dm[0].color,nm[0].color);assert.deepEqual(dm.map(({color,...m})=>m),nm.map(({color,...m})=>m));
});

test('dense living populations obey every frame budget and offscreen records never paint',()=>{
 const {world}=isometricLivingFixture();world.map={...world.map,width:120,height:120,tiles:Array(14400).fill('grass')};world.buildings=[];world.graves=[];world.resources=[];world.industry!.animals=[];world.industry!.fishing={};const b=world.frontierHazards!.beasts[0];world.frontierHazards!.beasts=Array.from({length:500},(_,i)=>({...b,id:'dense-'+i,at:{x:50+i%5,y:50+Math.floor(i/5)%5}}));world.frontierHazards!.beasts.push({...b,id:'far-away',at:{x:110,y:110}});
 const {v,scene}=render(world,52,52,640,480);assert.equal(scene.objects.length,VIEWPORT_LIMITS.objects);assert.equal(scene.omittedObjects,500-VIEWPORT_LIMITS.objects);assert.ok(!scene.objects.some(o=>o.subject.id==='far-away'));
 for(const elapsed of [0,160,260,520,780,1000000]){const next=v.animate(scene,elapsed);assert.ok(total(next)<=VIEWPORT_LIMITS.marks);assert.ok(next.objects.every(o=>o.marks.length<=LIVING_MARK_LIMIT));}
});

test('ecology locating keeps supported exact identities in isometric mode and falls back honestly for unsupported data',()=>{
 const {world}=isometricLivingFixture(),p=new IsometricPreview();p.accept(snap(world));p.setActive(true);p.resize(1000,700);
 for(const record of [...world.frontierHazards!.beasts.map(b=>['beast',b.id]),...world.industry!.animals.map(a=>['animal',a.id]),...Object.keys(world.industry!.fishing).map(id=>['fish',id])])assert.equal(p.locateEcology(record.join('/')),true);
 assert.equal(p.locateEcology('fish/missing'),false);const id=world.industry!.animals[0].id;assert.equal(p.locateEcology('beast/'+id),true);
 const h=observerPreviewHarness({x:13,y:10});h.accept(snap(world));h.toggle();const button=new ObserverElement();button.dataset.animalMap='beast/'+world.frontierHazards!.beasts[0].id;assert.equal(h.document.emit('click',{target:button}).stopped,false);assert.equal(h.canvas.hidden,false);
 button.dataset.animalMap='fish/unknown';h.document.emit('click',{target:button});assert.equal(h.canvas.hidden,true);h.dispose();
});

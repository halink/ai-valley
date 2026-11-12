import {storybookProductionImportViolations} from './helpers/storybook-production-boundary.js';
/** Offline synthetic contract tests, never a live model/save or browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createWorld} from '../src/world/seed.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import type {Snapshot,Vec} from '../src/shared/types.js';
import type {ObserverMap,ObserverSelection} from '../src/client/observer-map.js';
import {buildStorybookPlan,pickStorybookPlan,storybookWindow,type StorybookPixelAtlas,type StorybookPlan} from '../src/client/storybook-render-plan.js';
import {createStorybookObserver,type StorybookSurface} from '../src/client/storybook-observer.js';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {syntheticManifest,syntheticPin,syntheticAtlasPixels,SYNTHETIC_WIDTH,SYNTHETIC_HEIGHT} from '../src/client/storybook-synthetic-atlas.js';
import {projectStorybook} from '../src/client/storybook-geometry.js';
const atlas:StorybookPixelAtlas={manifest:parseStorybookManifest(syntheticManifest,syntheticPin),width:SYNTHETIC_WIDTH,height:SYNTHETIC_HEIGHT,pixels:syntheticAtlasPixels()};
const bounds={x:20,y:15,width:32,height:32};
function fixture():Snapshot {return {world:createWorld(5401),serverTime:'synthetic',version:'synthetic',capabilities:{active:[],pending:[]}};}
function freeze(v:unknown){if(v&&typeof v==='object'){Object.freeze(v);for(const value of Object.values(v))freeze(value);}}
function atPixel(d:StorybookPlan['draws'][number],pixel:{x:number;y:number},camera={origin:{x:0,y:0},zoom:1}){return {x:(d.topLeft.x+pixel.x+.5)*camera.zoom+camera.origin.x,y:(d.topLeft.y+pixel.y+.5)*camera.zoom+camera.origin.y};}
function opaquePixel(d:StorybookPlan['draws'][number]){const r=d.frame.rect;for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)if(atlas.pixels[((r.y+y)*atlas.width+r.x+x)*4+3])return {x,y};throw new Error('empty frame');}

test('real snapshot terrain, IDs, footprints and lodge layers are preserved without world writes',()=>{
 const s=fixture(),before=structuredClone(s);freeze(s);
 const plan=buildStorybookPlan(s,atlas,bounds);assert.deepEqual(s,before);
 assert.equal(plan.draws.filter(d=>d.layer==='ground').length,1024);
 for(const d of plan.draws.filter(d=>d.layer==='ground')){const [x,y]=d.key.slice(5).split(',').map(Number);assert.equal(d.assetId,'terrain-'+s.world.map.tiles[y*s.world.map.width+x]);}
 const b=s.world.buildings.find(b=>b.id==='lodge')!,layers=plan.draws.filter(d=>d.selection?.id===b.id);
 assert.deepEqual(layers.map(d=>d.layer),['contact','body','roof']);
 for(const d of layers){assert.deepEqual(d.position,projectStorybook({x:b.at.x+4,y:b.at.y+6}));assert.equal(d.selection!.kind,'building');}
 assert.ok(layers[0].depth<layers[1].depth&&layers[1].depth<layers[2].depth);
 for(const r of s.world.residents){const d=plan.draws.find(d=>d.selection?.id===r.id)!;assert.equal(d.assetId,'marker');assert.match(d.fallback!,/朝向未知/);assert.deepEqual(d.position,projectStorybook({x:r.at.x+.5,y:r.at.y+.5}));}
 assert.ok(plan.notices.some(n=>n.includes('不绘制资源')));
});

test('four confirmed directions use four unmirrored frames and only recorded travel fraction',()=>{
 for(const [offset,facing] of [[{x:0,y:-1},'northeast'],[{x:1,y:0},'southeast'],[{x:0,y:1},'southwest'],[{x:-1,y:0},'northwest']] as const){
  const s=fixture(),r=s.world.residents[0];r.at={x:29,y:28};r.activity={action:{type:'wait',minutes:5},target:{x:r.at.x+offset.x,y:r.at.y+offset.y},path:[{x:r.at.x+offset.x,y:r.at.y+offset.y}],travelProgress:.25,startedAt:s.world.minute,remaining:5,planId:'synthetic',definition:'action/routine@1'};
  const plan=buildStorybookPlan(s,atlas,bounds),d=plan.draws.find(d=>d.selection?.id===r.id)!;
  assert.equal(d.facing,facing);assert.equal(d.assetId,'resident-route');assert.match(d.fallback!,/不是人物外观/);
  assert.deepEqual(d.position,projectStorybook({x:r.at.x+offset.x*.25+.5,y:r.at.y+offset.y*.25+.5}));
  assert.deepEqual(buildStorybookPlan(s,atlas,bounds),plan); // no display clock or extrapolation
 }
});

test('bad route, missing positions, deaths, outside and indoor records never become cheerful idle at stale coordinates',()=>{
 const s=fixture(),[bad,unknown,outside]=s.world.residents;
 bad.activity={action:{type:'wait',minutes:5},target:{x:29,y:27},path:[{x:29,y:27}],travelProgress:.5,startedAt:s.world.minute,remaining:5,planId:'synthetic',definition:'action/routine@1'};
 unknown.at={x:NaN,y:0};outside.residency='outside';
 let p=buildStorybookPlan(s,atlas,bounds);
 assert.equal(p.draws.find(d=>d.selection?.id===bad.id)!.assetId,'marker');assert.equal(p.unknownResidents[0].id,unknown.id);assert.ok(!p.draws.some(d=>d.selection?.id===outside.id));
 bad.activity=null;bad.status='dead';p=buildStorybookPlan(s,atlas,bounds);assert.match(p.draws.find(d=>d.selection?.id===bad.id)!.fallback!,/body姿态/);
 bad.status='alive';bad.inside='lodge';bad.roomAt=null;p=buildStorybookPlan(s,atlas,bounds);assert.ok(!p.draws.some(d=>d.selection?.id===bad.id));
 assert.throws(()=>buildStorybookPlan(s,atlas,bounds,'lodge'),/不把室内居民挪到门口/);
});

test('missing terrain is blank, building dimension/condition mismatch falls back, and missing marker is reported',()=>{
 const s=fixture();s.world.buildings.find(b=>b.id==='lodge')!.width=7;
 const missing={...atlas,manifest:{...atlas.manifest,assets:atlas.manifest.assets.filter(a=>!['terrain-grass','marker'].includes(a.id))}};
 let p=buildStorybookPlan(s,missing,bounds);assert.ok(p.notices.some(n=>n.includes('保留空白')));assert.ok(p.notices.some(n=>n.includes('缺少位置标记')));assert.ok(!p.draws.some(d=>d.selection?.id==='lodge'));
 s.world.buildings.find(b=>b.id==='lodge')!.width=8;s.world.buildings.find(b=>b.id==='lodge')!.condition=40;p=buildStorybookPlan(s,atlas,bounds);assert.equal(p.draws.find(d=>d.selection?.id==='lodge')!.assetId,'marker');
 assert.throws(()=>buildStorybookPlan(s,atlas,{...bounds,width:33}),/window/);
 assert.deepEqual(storybookWindow(s,{x:0,y:0}),{x:0,y:0,width:24,height:24});
});

test('alpha pixel picking survives camera scaling, respects top layer, and empty pixels fall through',()=>{
 const plan=buildStorybookPlan(fixture(),atlas,bounds),d=plan.draws.find(d=>d.selection?.id==='lin')!;
 const isolated={...plan,draws:[d]},camera={origin:{x:351.5,y:-70.25},zoom:2.75};
 assert.deepEqual(pickStorybookPlan(isolated,atlas,atPixel(d,opaquePixel(d),camera),camera)!.selection,{kind:'person',id:'lin'});
 const top={...d,key:'top',depth:d.depth+1,selection:{kind:'building' as const,id:'lodge'}};
 assert.equal(pickStorybookPlan({...plan,draws:[d,top]},atlas,atPixel(d,opaquePixel(d)),{origin:{x:0,y:0},zoom:1})!.selection!.id,'lodge');
 const transparent={...atlas,pixels:new Uint8ClampedArray(atlas.pixels.length)};
 assert.equal(pickStorybookPlan(isolated,transparent,atPixel(d,opaquePixel(d)),{origin:{x:0,y:0},zoom:1})?.selection??null,null);
 assert.equal(pickStorybookPlan(plan,atlas,{x:Infinity,y:0},camera),null);
});

function harness(){
 let current:Snapshot|null=fixture(),room:string|null=null;
 const snapshotListeners=new Set<(s:Snapshot|null,c:boolean)=>void>(),roomListeners=new Set<(id:string|null)=>void>(),picks=new Set<(at:Vec)=>void>();
 let disposal=0,failRoom=false;const selected:ObserverSelection[]=[],frames:Array<{plan:StorybookPlan|null;notice:string}>=[];
 const observer:ObserverMap={currentSnapshot:()=>current,currentRoom:()=>room,currentTile:()=>({x:35,y:30}),currentFollow:()=>null,subscribe(listener){snapshotListeners.add(listener);listener(current,true);return ()=>{snapshotListeners.delete(listener);};},subscribeRoom(listener){if(failRoom)throw new Error('synthetic subscription failure');roomListeners.add(listener);listener(room);return ()=>{roomListeners.delete(listener);};},subscribeFollow(){throw new Error('unneeded follow subscription');},select:value=>selected.push(value),cover(){throw new Error('must not cover');},frame(){throw new Error('must not move base camera');},stopFollowing(){throw new Error('no automatic follow changes');},setFollowResolver(){throw new Error('no resolver ownership');},isFullMapTarget:()=>false};
 const surface:StorybookSurface={present:(plan,notice)=>frames.push({plan,notice}),subscribePick(listener){picks.add(listener);return ()=>{picks.delete(listener);};},dispose(){disposal++;}};
 return {observer,surface,selected,frames,snapshotListeners,roomListeners,picks,get disposal(){return disposal;},mount:()=>createStorybookObserver(observer,atlas,surface),fail:()=>{failRoom=true;},emit(value:Snapshot|null,c=true){current=value;for(const l of snapshotListeners)l(value,c);},room(value:string|null){room=value;for(const l of roomListeners)l(value);}};
}
test('observer is inactive by default, reuses source, selects original IDs, and repeated lifecycle fully cleans up',()=>{
 const h=harness(),handle=h.mount();assert.equal(handle.plan,null);assert.equal(h.snapshotListeners.size,1);assert.equal(h.roomListeners.size,1);
 for(let i=0;i<3;i++){handle.activate();assert.ok(handle.plan);handle.deactivate();assert.equal(handle.plan,null);}
 handle.activate();const d=handle.plan!.draws.find(d=>d.selection?.id==='lin')!;for(const pick of h.picks)pick(atPixel(d,opaquePixel(d)));assert.deepEqual(h.selected,[{kind:'person',id:'lin'}]);
 h.emit(fixture(),false);assert.match(h.frames.at(-1)!.notice,/连接已断开/);assert.equal(handle.plan!.paused,true);
 h.room('lodge');assert.equal(handle.plan,null);assert.match(h.frames.at(-1)!.notice,/请使用原视图/);h.room(null);assert.ok(handle.plan);
 handle.dispose();handle.dispose();assert.equal(h.disposal,1);assert.equal(h.snapshotListeners.size+h.roomListeners.size+h.picks.size,0);handle.activate();assert.equal(handle.plan,null);
 const again=h.mount();assert.equal(h.snapshotListeners.size,1);again.dispose();assert.equal(h.disposal,2);
});
test('late subscription failure releases earlier acquisitions and snapshot failure cannot retain stale pick targets',()=>{
 const h=harness();h.fail();assert.throws(()=>h.mount(),/subscription failure/);assert.equal(h.snapshotListeners.size+h.picks.size,0);assert.equal(h.disposal,1);
 const g=harness(),handle=g.mount();handle.activate();const bad=fixture();bad.world.map.width=0;g.emit(bad);assert.equal(handle.plan,null);for(const pick of g.picks)pick({x:0,y:0});assert.equal(g.selected.length,0);assert.match(g.frames.at(-1)!.notice,/不可用/);g.emit(fixture());assert.ok(handle.plan);handle.dispose();
});
test('prototype graph stays opt-in and contains no transport, model, storage, simulation or timer owner',()=>{
 for(const file of ['storybook-render-plan','storybook-observer','storybook-phaser','storybook-texture','storybook-synthetic-atlas']){
  const source=readFileSync(new URL(`../src/client/${file}.ts`,import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|submitPlan|stepWorld|setInterval|requestAnimationFrame|setTimeout|localStorage)\s*\(/);
 }
 for(const file of ['main','development-preview'])assert.deepEqual(storybookProductionImportViolations(readFileSync(new URL(`../src/client/${file}.ts`,import.meta.url),'utf8'),file==='main'),[]);
});

test('unchanged frontier nine-resident seed maps through a bounded sample without a world-sized image or extra residents',()=>{
 const snapshot={...fixture(),world:createFrontierWorld(5401)},before=structuredClone(snapshot.world);freeze(snapshot.world);
 const r=snapshot.world.residents[0],window=storybookWindow(snapshot,r.at,24),plan=buildStorybookPlan(snapshot,atlas,window);
 assert.equal(snapshot.world.residents.length,9);assert.equal(plan.draws.filter(d=>d.layer==='ground').length,24*24);
 for(const d of plan.draws)if(d.selection?.kind==='person')assert.ok(snapshot.world.residents.some(p=>p.id===d.selection!.id));
 assert.ok(plan.draws.some(d=>d.selection?.id===r.id));assert.deepEqual(snapshot.world,before);
});

test('a broken optional surface clears partial rendering without interrupting the original source',()=>{
 const h=harness(),present=h.surface.present;let fail=true;
 h.surface.present=(plan,notice)=>{if(plan&&fail){fail=false;throw Error('synthetic image failure');}present(plan,notice);};
 const handle=h.mount();assert.doesNotThrow(()=>handle.activate());assert.equal(handle.plan,null);assert.equal(h.frames.at(-1)!.plan,null);assert.match(h.frames.at(-1)!.notice,/绘制失败/);
 assert.doesNotThrow(()=>h.emit(fixture()));assert.equal(handle.plan,null);handle.activate();assert.ok(handle.plan);handle.dispose();
});

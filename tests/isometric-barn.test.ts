/** Explicit render-only fixtures. Not engine animal placement, a real save or browser acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {roomLayout} from '../src/shared/rooms.js';
import type {Snapshot} from '../src/shared/types.js';
import type {Livestock} from '../src/shared/industry.js';
import {IsometricHomeInterior,homeInteriorSupport,fitRoomCamera} from '../src/client/isometric-interior.js';
import {IsometricPreview,PREVIEW_LIMITATIONS,previewSelection,previewHitLabel} from '../src/client/isometric-preview.js';
import {observerPreviewHarness,ObserverElement} from './helpers/observer-preview-dom.js';

function fixture():Snapshot {
 const {world}=isometricStudyFixture(),b=world.buildings[0];
 Object.assign(b,{kind:'barn',definition:'building/barn@1',name:'合成畜舍显示夹具',width:7,height:5,capacity:0});
 world.rooms={tick:0,claims:[],beds:{}};world.industry={stations:[],animals:[],tools:[],livestockCargo:[],fishing:{}} as any;
 for(const r of world.residents){r.activity=null;r.plan=null;r.inside=null;r.roomAt=null;}
 const r=world.residents[0];r.inside=b.id;r.roomAt={x:8,y:11};r.at={...b.door};
 return {world,serverTime:'synthetic-barn-display',version:'test',capabilities:{active:[],pending:[]}};
}
const building=(s:Snapshot)=>s.world.buildings[0],person=(s:Snapshot)=>s.world.residents[0];
function animal(s:Snapshot,id:string,change:Partial<Livestock>={}):Livestock {
 return {id,ownerId:person(s).id,kind:'goat',sex:'female',bornAt:0,barnId:building(s).id,pen:0,hunger:20,thirst:20,health:100,status:'alive',deathAt:null,product:0,progress:0,pregnancy:null,lastMinute:s.world.minute,...change};
}
function preview(s=fixture()) {const p=new IsometricPreview();p.setActive(true);p.setConnected(true);p.accept(s);p.resize(960,640);assert.equal(p.setRoom(building(s).id),null);return p;}
function freeze(v:unknown){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}}

test('barn uses the exact shared geometry, static furniture and labelled pen navigation markers, never occupancy',()=>{
 const s=fixture(),b=building(s),support=homeInteriorSupport(s.world,b.id),p=preview(s),l=roomLayout(s.world,b);
 assert.equal(support.supported,true);assert.deepEqual(support.layout,l);assert.equal(l.width,16);assert.equal(l.height,13);
 assert.match(p.summary,/畜舍室内/);assert.match(PREVIEW_LIMITATIONS,/barnId\/pen不是室内精确坐标/);
 const slots=p.scene!.objects.filter(o=>o.subject.kind==='roomSlot');assert.deepEqual(slots.map(o=>o.subject.id).sort(),['kitchen','pen:0','pen:1','pen:2','pen:3','table']);
 for(const o of slots){assert.deepEqual(o.subject.at,l.slots.find(slot=>slot.key===o.subject.id)!.at);if(o.subject.id.startsWith('pen:')){assert.match(o.subject.placeholder!,/导航点/);assert.match(o.subject.placeholder!,/不是动物位置或数量/);assert.equal(o.marks.length,7);}}
 assert.ok(!p.scene!.objects.some(o=>o.subject.kind==='animal'||o.subject.id==='care'||o.subject.id.startsWith('bed:')));
 const largeCapacity=fixture();building(largeCapacity).capacity=1000000;assert.deepEqual(homeInteriorSupport(largeCapacity.world,b.id).layout,l);
});

test('barn preflight includes pen-driven height and slot budgets before roomLayout loops',()=>{
 for(const [width,height] of [[1,1],[8,8],[16,8],[20,10]]){const s=fixture(),b=building(s);Object.assign(b,{width,height});const support=homeInteriorSupport(s.world,b.id);assert.equal(support.supported,true);assert.deepEqual(support.layout,roomLayout(s.world,b));}
 // 12 by 20 would be 43 rows without pen expansion, but 30 pens require 65 rows.
 for(const [width,height] of [[12,20],[32,30],[1000000000,1]]){const s=fixture(),b=building(s);Object.assign(b,{width,height});Object.defineProperty(s.world,'industry',{get(){throw new Error('oversized barn reached station scan');}});assert.equal(homeInteriorSupport(s.world,b.id).supported,false);}
 const missing=fixture();delete missing.world.rooms;assert.equal(homeInteriorSupport(missing.world,building(missing).id).supported,false);
 for(const capacity of [-1,NaN,1.5]){const s=fixture();building(s).capacity=capacity;assert.equal(homeInteriorSupport(s.world,building(s).id).supported,false);}
});

test('barnId and pen never create an indoor animal or count; outdoor and other-room records are excluded',()=>{
 const s=fixture(),id=building(s).id;
 s.world.industry!.animals=[animal(s,'unlocated'),animal(s,'unlocated-pen',{pen:3}),animal(s,'outdoor',{at:{x:5,y:5},inside:null}),animal(s,'elsewhere',{at:{x:5,y:5},inside:'other-room',roomAt:{x:4,y:7}}),animal(s,'dead',{status:'dead'})];
 const p=preview(s);assert.ok(!p.scene!.objects.some(o=>o.subject.kind==='animal'));assert.equal(p.scene!.unknownLocationCount,2);assert.equal(p.scene!.unsupportedObjects,6);
 assert.equal(p.locateEcology('animal/unlocated'),false);assert.equal(p.roomId,id);
 const clean=fixture();assert.deepEqual(p.scene!.objects,preview(clean).scene!.objects,'no decorative animals appear merely because of ownership, products or pens');
});

test('explicit indoor animals remain honest exact-point markers while invalid or carried coordinates never reuse stale positions',()=>{
 const s=fixture(),b=building(s),r=person(s),outside=s.world.residents[1];
 s.world.industry!.animals=[animal(s,'exact',{at:{...b.door},inside:b.id,roomAt:{x:3,y:9}}),animal(s,'bad',{at:{...b.door},inside:b.id,roomAt:{x:Infinity,y:8}}),animal(s,'held',{carrierId:r.id,inside:b.id,roomAt:{x:1,y:1}}),animal(s,'left',{carrierId:outside.id,inside:b.id,roomAt:{x:2,y:2}}),animal(s,'lost-carrier',{carrierId:'missing',inside:b.id,roomAt:{x:2,y:2}})];
 const p=preview(s),objects=p.scene!.objects.filter(o=>o.subject.kind==='animal');assert.deepEqual(objects.map(o=>o.subject.id).sort(),['exact','held']);
 assert.deepEqual(objects.find(o=>o.subject.id==='exact')!.subject.at,{x:3,y:9});assert.deepEqual(objects.find(o=>o.subject.id==='held')!.subject.at,r.roomAt);assert.equal(p.scene!.unknownLocationCount,2);
 for(const o of objects)assert.ok(o.subject.placeholder);assert.equal(p.locateEcology('animal/exact'),false);
 const exact=objects.find(o=>o.subject.id==='exact')!;assert.ok(exact.marks.some(m=>{const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind!=='animal'||hit.id!=='exact')return false;assert.deepEqual(previewSelection(hit),{kind:'animal',id:'exact'});assert.equal(hit.roomId,b.id);assert.match(previewHitLabel(s.world,hit),/记录标记/);return true;}));
});

test('original resident picking and follow use actual roomAt, never a pen or care target',()=>{
 const s=fixture(),p=preview(s),r=person(s),o=p.scene!.objects.find(o=>o.subject.id===r.id)!;
 assert.equal(o.subject.placeholder,undefined);assert.deepEqual(o.subject.at,r.roomAt);assert.match(o.subject.description!,/在场不表示照料、繁育或产出完成/);assert.equal(p.followResident(r.id),null);
 assert.ok(o.marks.some(m=>{const hit=p.pick({x:(m.x+.5)*p.camera!.zoom+p.camera!.origin.x,y:(m.y+.5)*p.camera!.zoom+p.camera!.origin.y});if(hit?.kind!=='resident'||hit.id!==r.id)return false;assert.equal(hit.roomId,building(s).id);assert.deepEqual(previewSelection(hit),{kind:'person',id:r.id});return true;}));
 for(const at of [null,{x:NaN,y:5},{x:16,y:5}]){const bad=fixture();person(bad).roomAt=at;const q=preview(bad);assert.equal(q.scene!.unknownLocationCount,1);assert.ok(!q.scene!.objects.some(o=>o.subject.id===r.id));assert.match(q.followResident(r.id)!,/精确位置/);}
});

test('barn default remains 2D, manual entry/exit releases drag, Escape and unsupported animal navigation hand back to 2D',()=>{
 const s=fixture(),h=observerPreviewHarness();h.accept(s);assert.equal(h.canvas.hidden,true);assert.equal(h.intervals.size,0);h.toggle();h.enter(building(s).id);assert.equal(h.canvas.hidden,false);assert.match(h.model.summary,/畜舍室内/);
 h.canvas.emit('pointerdown',{pointerId:29});h.enter(null);assert.equal(h.canvas.captures.has(29),false);assert.equal(h.model.roomId,null);h.enter(building(s).id);h.document.emit('keydown',{key:'Escape'});assert.equal(h.canvas.hidden,true);assert.equal(h.room(),building(s).id);assert.equal(h.intervals.size,0);
 const withAnimal=fixture();withAnimal.world.industry!.animals=[animal(withAnimal,'unlocated')];h.accept(withAnimal);h.toggle();const button=new ObserverElement();button.dataset.animalMap='animal/unlocated';h.document.emit('click',{target:button});assert.equal(h.canvas.hidden,true);assert.match(h.tray.querySelector('.preview-notice').textContent,/位置或姿态尚未支持/);assert.deepEqual(h.warnings,[]);h.dispose();
});

test('frozen barn inputs and cached animation never initialize animals, layouts or simulation state',()=>{
 const s=fixture();s.world.industry!.animals=[animal(s,'unlocated')];const before=structuredClone(s);freeze(s);
 const view=new IsometricHomeInterior(),support=homeInteriorSupport(s.world,building(s).id);assert.ok(support.supported);view.accept(s,building(s).id);const scene=view.render(fitRoomCamera(support.layout!,null,960,640),960,640),stats=view.stats;
 assert.deepEqual(view.animate(scene,700).objects,scene.objects);assert.deepEqual(s,before);assert.equal(view.stats.poseBuilds,stats.poseBuilds);assert.equal(view.stats.floorBuilds,stats.floorBuilds);assert.equal(view.stats.bucketBuilds,stats.bucketBuilds);
 const next=fixture();view.accept(next,building(next).id);const drawn=view.render(scene.displayCamera,960,640);for(const field of ['buildings','rooms','residents','industry'] as const)Object.defineProperty(next.world,field,{get(){throw new Error('animation rescanned '+field);}});assert.doesNotThrow(()=>view.animate(drawn,700));
});

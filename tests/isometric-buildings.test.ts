import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildingMarks,buildingArtSupported,buildingFootprint,BUILDING_MARK_LIMIT,constructionAppearance,constructionMarks} from '../src/client/isometric-buildings.js';
import {resourceMarks,resourceArtSupported,orchardMarks,orchardArtSupported,RESOURCE_MARK_LIMIT} from '../src/client/isometric-resources.js';
import {fixtureBuildingKinds,syntheticBuilding,syntheticResource,syntheticOrchard,syntheticConstruction,isometricBuildingsFixture,buildingFixtureScene} from '../scripts/isometric-buildings-fixture.js';
import {pickIsometricStudy} from '../src/client/isometric-study.js';
import {projectIsometric,orderIsometricObjects} from '../src/client/isometric-projection.js';
import {materials} from '../src/client/palette.js';
import type {Building,Resource} from '../src/shared/types.js';
import type {PixelMark} from '../src/client/work-art.js';
const seasons=['spring','summer','autumn','winter'] as const;
const freeze=(v:unknown)=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}};
const normalize=(marks:PixelMark[],at:{x:number;y:number})=>{const p=projectIsometric(at);return marks.map(m=>({...m,x:m.x-p.x+0,y:m.y-p.y+0}));};
const actual=(marks:PixelMark[])=>{const pixels=new Map<string,string>();for(const m of marks)for(let y=m.y;y<m.y+m.height;y++)for(let x=m.x;x<m.x+m.width;x++)pixels.set(x+','+y,m.color);return JSON.stringify([...pixels].sort());};

test('eight actual building kinds have distinct bounded integer silhouettes in every season',()=>{
 for(const season of seasons){const signatures=new Set<string>();for(const kind of fixtureBuildingKinds){const b=syntheticBuilding(kind),marks=buildingMarks(b,season)!;assert.ok(buildingArtSupported(b));assert.ok(marks.length>0&&marks.length<=BUILDING_MARK_LIMIT);assert.ok(marks.every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)&&m.width>0&&m.height>0));assert.deepEqual(buildingFootprint(b),{...b.at,width:3,height:2});signatures.add(actual(marks));const corners=[b.at,{x:b.at.x+3,y:b.at.y+2}].map(p=>projectIsometric(p));assert.ok(Math.min(...marks.map(m=>m.y))>=corners[0].y-64);assert.ok(Math.max(...marks.map(m=>m.y+m.height))<=corners[1].y+8);}assert.equal(signatures.size,8);}
});
test('all source records remain frozen and unchanged; translation retains exact original anchors',()=>{
 const {world}=isometricBuildingsFixture(),before=structuredClone(world);freeze(world);
 for(const b of world.buildings){const original=buildingMarks(b,'summer')!,moved={...b,at:{x:b.at.x+8,y:b.at.y+4},door:{x:b.door.x+8,y:b.door.y+4}};assert.deepEqual(normalize(buildingMarks(moved,'summer')!,moved.at),normalize(original,b.at));}
 for(const r of world.resources)resourceMarks(r,'spring');for(const t of world.industry!.trees)orchardMarks(t,'autumn');for(const p of world.construction!.projects)constructionMarks(p,world.minute);assert.deepEqual(world,before);
});
test('unknown kinds, invalid geometry and absent or impossible condition never become healthy buildings',()=>{
 const b=syntheticBuilding('clinic');
 for(const patch of [{kind:'new-kind'},{kind:'toString'},{condition:NaN},{condition:Infinity},{condition:undefined},{condition:-1},{condition:101},{width:0},{width:1.5},{width:81},{door:undefined},{at:{x:NaN,y:2}}]){assert.equal(buildingArtSupported({...b,...patch} as Building),false);assert.equal(buildingMarks({...b,...patch} as Building,'spring'),null);}
 assert.equal(buildingMarks({...b,width:40,height:40},'spring'),null,'oversized pixel output is bounded');
});
test('wear is conditional on real condition and roof metadata never selects a different building kind',()=>{
 for(const kind of fixtureBuildingKinds){const b=syntheticBuilding(kind);assert.notDeepEqual(buildingMarks(b,'summer'),buildingMarks({...b,condition:60},'summer'));assert.notDeepEqual(buildingMarks({...b,condition:60},'summer'),buildingMarks({...b,condition:10},'summer'));assert.notDeepEqual(buildingMarks({...b,condition:10},'summer'),buildingMarks({...b,condition:0},'summer'));}
 const b=syntheticBuilding('school');assert.notDeepEqual(buildingMarks(b,'spring'),buildingMarks(b,'spring',{roof:'clay'}));for(const art of [{roof:'future'},{roof:'clay',extra:true},null,'blue'])assert.deepEqual(buildingMarks(b,'spring',art),buildingMarks(b,'spring'));
});
test('door position is never invented on a visible face when the recorded door is on a hidden face',()=>{
 const b=syntheticBuilding('clinic'),hidden={...b,door:{x:b.at.x+1,y:b.at.y-1}};
 assert.notDeepEqual(buildingMarks(b,'spring'),buildingMarks(hidden,'spring'));
 assert.deepEqual(buildingMarks(hidden,'spring'),buildingMarks({...hidden,door:{x:b.at.x-1,y:b.at.y+1}},'spring'));
 assert.notDeepEqual(buildingMarks(b,'spring'),buildingMarks({...b,door:{x:b.at.x+b.width,y:b.at.y+1}},'spring'));
});
test('natural resource availability follows amount, including dry springs and exhausted stone',()=>{
 for(const kind of ['rock','bush','spring'] as const)for(const season of seasons){const r=syntheticResource(kind),full=resourceMarks(r,season)!,empty=resourceMarks({...r,amount:0},season)!;assert.ok(resourceArtSupported(r));assert.notDeepEqual(full,empty);assert.ok(full.length<RESOURCE_MARK_LIMIT&&empty.length<RESOURCE_MARK_LIMIT);assert.ok(full.every(m=>[m.x,m.y,m.width,m.height].every(Number.isInteger)));assert.deepEqual(full,resourceMarks({...r,amount:1},season),'availability motif is not an invented count');}
 const r=syntheticResource('bush');for(const patch of [{kind:'unknown'},{kind:'tree'},{kind:'toString'},{amount:NaN},{amount:-1},{amount:13},{max:undefined},{at:{x:.5,y:2}}])assert.equal(resourceMarks({...r,...patch} as Resource,'spring'),null);
 assert.ok(resourceMarks({...r,amount:0},'summer')!.every(m=>m.color!==materials.berry&&m.color!==materials.berryLight));
});
test('orchard maturity and stock are not inferred from growth, weather, or season',()=>{
 const growing=syntheticOrchard('growing'),mature=syntheticOrchard('mature'),fruit=syntheticOrchard('mature',7);
 for(const season of seasons){assert.notDeepEqual(orchardMarks(growing,season),orchardMarks(mature,season));assert.notDeepEqual(orchardMarks(mature,season),orchardMarks(fruit,season));assert.ok(orchardMarks(fruit,season)!.some(m=>m.color===materials.rootLight));assert.ok(orchardMarks(mature,season)!.every(m=>m.color!==materials.rootLight));assert.ok(orchardMarks(fruit,season)!.length<=RESOURCE_MARK_LIMIT);}
 assert.deepEqual(orchardMarks({...growing,growth:999999},'spring'),orchardMarks(growing,'spring'));
 for(const patch of [{status:'cut'},{status:'future'},{fruit:-1},{fruit:NaN},{growth:NaN},{status:'growing',fruit:1}]){const t={...mature,...patch} as typeof mature;assert.equal(orchardArtSupported(t),false);assert.equal(orchardMarks(t,'spring'),null);}
});
test('new construction uses only recorded begun stages and incorporated materials, never a completed building',()=>{
 const names=['reserved','foundation','frame','roofing'];for(let phase=0;phase<4;phase++){const p=syntheticConstruction(phase);assert.equal(constructionAppearance(p,720),names[phase]);assert.ok(constructionMarks(p,720));for(const status of ['completed','removed','proposed','cancelled'] as const)assert.equal(constructionMarks({...p,status},720),null);for(const mode of ['expansion','conversion','terrain'] as const)assert.equal(constructionMarks({...p,mode},720),null);}
 const p=syntheticConstruction(2);for(const mutate of [(x:typeof p)=>{x.incorporated={};},(x:typeof p)=>{x.stages[0].finishedAt=null;},(x:typeof p)=>{x.stages[1].startedAt=800;},(x:typeof p)=>{x.stage=0;},(x:typeof p)=>{x.stages[2].worked=1;},(x:typeof p)=>{x.stages[1].worked=60;},(x:typeof p)=>{x.reserved=false;}]){const copy=structuredClone(p);mutate(copy);assert.equal(constructionMarks(copy,720),null);}
});
test('the complete synthetic composition selects original IDs from visible pixels at fractional camera zoom',()=>{
 const scene=buildingFixtureScene(),camera={origin:{x:431.25,y:77.4},zoom:1.37};assert.equal(scene.objects.length,23);
 for(const object of scene.objects){let tested=false;for(const mark of [...object.marks].reverse()){const x=mark.x+.5,y=mark.y+.5;const top=[...scene.objects].reverse().find(o=>o.marks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height));if(top!==object)continue;assert.deepEqual(pickIsometricStudy({...scene,camera},{x:x*camera.zoom+camera.origin.x,y:y*camera.zoom+camera.origin.y}),object.subject);tested=true;break;}assert.ok(tested,object.key);}
});
test('footprint depth order handles people beside and behind a nonhome building, independent of input order',()=>{
 const b={key:'building:test',footprint:{x:4,y:4,width:3,height:2}},behind={key:'resident:behind',footprint:{x:5,y:3,width:1,height:1}},front={key:'resident:front',footprint:{x:5,y:6,width:1,height:1}},side={key:'resident:side',footprint:{x:7,y:5,width:1,height:1}};
 for(const input of [[b,behind,front,side],[side,front,behind,b]]){const order=orderIsometricObjects(input).map(o=>o.key);assert.ok(order.indexOf(behind.key)<order.indexOf(b.key));assert.ok(order.indexOf(b.key)<order.indexOf(front.key));assert.ok(order.indexOf(b.key)<order.indexOf(side.key));}
});

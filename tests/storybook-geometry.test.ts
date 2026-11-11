/** CPU-only geometry contracts. Synthetic world factory only; no saved state, scene or browser. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {STORYBOOK_TILE,storybookFacing,storybookFacingFromOffset,projectStorybook,unprojectStorybook,screenToStorybook,pickStorybookTile,storybookBuildingFootprint,placeStorybookFrame,placeStorybookAsset,orderStorybookObjects,type StorybookDepthItem} from '../src/client/storybook-geometry.js';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';

function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
test('four real world directions retain four different diagonal facings',()=>{
 assert.deepEqual(STORYBOOK_TILE,{width:32,height:16});assert.ok(Object.isFrozen(STORYBOOK_TILE));
 for(const [world,delta,facing,pixel] of [
  ['north',{x:0,y:-1},'northeast',{x:16,y:-8}],['east',{x:1,y:0},'southeast',{x:16,y:8}],
  ['south',{x:0,y:1},'southwest',{x:-16,y:8}],['west',{x:-1,y:0},'northwest',{x:-16,y:-8}],
 ] as const){assert.equal(storybookFacing(world),facing);assert.equal(storybookFacingFromOffset(delta),facing);assert.deepEqual(projectStorybook(delta),pixel);}
 assert.equal(storybookFacingFromOffset({x:0,y:0}),null);assert.equal(storybookFacingFromOffset({x:1,y:1}),null);assert.equal(storybookFacingFromOffset({x:.25,y:0}),'southeast');
 assert.throws(()=>storybookFacing('up' as never));assert.throws(()=>storybookFacingFromOffset({x:NaN,y:0}));
});
test('32 by 16 projection roundtrips negative and fractional coordinates with known elevation',()=>{
 for(let x=-15.25;x<=15.25;x+=.25)for(const y of [-31.125,-1,0,.001,1,123.75])for(const elevation of [-12,0,19.5]){
  const actual=unprojectStorybook(projectStorybook({x,y},elevation),elevation);near(actual.x,x);near(actual.y,y);
 }
 for(const point of [{x:NaN,y:0},{x:0,y:Infinity},{x:Number.MAX_VALUE,y:Number.MAX_VALUE}])assert.throws(()=>projectStorybook(point));
 assert.throws(()=>unprojectStorybook({x:0,y:0},NaN));
});
test('camera inverse and half-open tile edges preserve real subcell offsets',()=>{
 const bounds={x:0,y:0,width:9,height:8};
 for(const zoom of [.3,1,2.75]){
  const camera={origin:{x:123.45,y:-81.23},zoom};
  const screen=(x:number,y:number)=>{const p=projectStorybook({x,y});return {x:p.x*zoom+camera.origin.x,y:p.y*zoom+camera.origin.y};};
  for(const [x,y] of [[0,0],[1,2],[8,7]]){assert.deepEqual(pickStorybookTile(screen(x,y),camera,bounds),{x,y});const p=screenToStorybook(screen(x+.5,y+.25),camera)!;near(p.x,x+.5);near(p.y,y+.25);}
  assert.deepEqual(pickStorybookTile(screen(1-1e-7,2),camera,bounds),{x:0,y:2});
  for(const [x,y] of [[9,0],[0,8],[-1e-7,1],[1,-1e-7]])assert.equal(pickStorybookTile(screen(x,y),camera,bounds),null);
 }
 assert.equal(screenToStorybook({x:0,y:0},{origin:{x:0,y:0},zoom:0}),null);
 assert.throws(()=>pickStorybookTile({x:0,y:0},{origin:{x:0,y:0},zoom:1},{...bounds,width:.5}));
});
test('real building footprint is copied, while source-image foot anchors stay independent of art height',()=>{
 const {world}=isometricStudyFixture(),before=structuredClone(world);freeze(world);
 const building=world.buildings[0],footprint=storybookBuildingFootprint(building),anchor={x:building.width/2,y:building.height};
 assert.deepEqual(footprint,{...building.at,width:building.width,height:building.height});
 const short=placeStorybookFrame(footprint,anchor,{rect:{x:0,y:0,width:96,height:64},foot:{x:48,y:60}}),tall=placeStorybookFrame(footprint,anchor,{rect:{x:100,y:0,width:96,height:192},foot:{x:48,y:188}});
 assert.deepEqual(short.position,tall.position);assert.deepEqual(short.worldFoot,tall.worldFoot);assert.equal(short.topLeft.y-tall.topLeft.y,128);
 assert.deepEqual(short.origin,{x:.5,y:60/64});assert.equal(short.topLeft.x+48,short.position.x);assert.equal(short.topLeft.y+60,short.position.y);
 footprint.x++;assert.equal(world.buildings[0].at.x,before.buildings[0].at.x);assert.deepEqual(world,before);
});
test('invalid footprint or anchors fail instead of silently guessing a foot or occupancy',()=>{
 const footprint={x:4,y:5,width:2,height:3},frame={rect:{x:0,y:0,width:64,height:96},foot:{x:32,y:90}};
 assert.throws(()=>placeStorybookFrame({...footprint,width:0},{x:1,y:1},frame));
 assert.throws(()=>placeStorybookFrame(footprint,{x:3,y:1},frame));
 assert.throws(()=>placeStorybookFrame(footprint,{x:1,y:1},{...frame,foot:{x:32,y:97}}));
 assert.throws(()=>storybookBuildingFootprint({at:{x:0,y:0},width:2.5,height:2}));
});
test('parsed synthetic assets match existing world dimensions and require an explicit directional frame',()=>{
 const {world}=isometricStudyFixture(),before=structuredClone(world);freeze(world);
 const building=world.buildings[0],footprint=storybookBuildingFootprint(building),frame={rect:{x:0,y:0,width:96,height:96},foot:{x:48,y:88}};
 const pack=parseStorybookManifest({schemaVersion:1,packId:'synthetic',packVersion:'1.0.0',projection:{tileWidth:32,tileHeight:16},atlas:{path:'assets/storybook/synthetic.png',width:96,height:96,sha256:'0'.repeat(64)},provenance:{source:'Synthetic metadata only, no image file',author:'Test fixture',license:'Test metadata only'},assets:[
  {id:'house',kind:'static',footprint:{width:building.width,height:building.height},groundAnchor:{x:building.width/2,y:building.height},frame},
  {id:'person',kind:'directional',footprint:{width:1,height:1},groundAnchor:{x:.5,y:.5},frames:{northeast:frame,southeast:frame,southwest:frame,northwest:frame}},
 ]},{packId:'synthetic',packVersion:'1.0.0'});
 const house=placeStorybookAsset(footprint,pack.assets[0]);assert.deepEqual(house.worldFoot,{x:building.at.x+building.width/2,y:building.at.y+building.height});
 assert.throws(()=>placeStorybookAsset({...footprint,width:footprint.width+1},pack.assets[0]),/asset_footprint/);
 const person=world.residents[0],personFootprint={...person.at,width:1,height:1};
 assert.throws(()=>placeStorybookAsset(personFootprint,pack.assets[1]),/asset_facing/);
 const placement=placeStorybookAsset(personFootprint,pack.assets[1],storybookFacing('north'));assert.deepEqual(placement.worldFoot,{x:person.at.x+.5,y:person.at.y+.5});
 assert.deepEqual(world,before);
});
const item=(key:string,x:number,y:number,width=1,height=1):StorybookDepthItem=>({key,footprint:{x,y,width,height},worldFoot:{x:x+width/2,y:y+height/2}});
test('large building side constraints beat foot depth, without mutating input',()=>{
 const house=item('house',2,2,5,6),west=item('west',1,6),east=item('east',7,2),north=item('north',5,1),south=item('south',2,8);
 const input=[east,house,south,north,west],before=structuredClone(input);freeze(input);
 const result=orderStorybookObjects(input),keys=result.items.map(v=>v.key);
 for(const key of ['west','north'])assert.ok(keys.indexOf(key)<keys.indexOf('house'));
 for(const key of ['east','south'])assert.ok(keys.indexOf(key)>keys.indexOf('house'));
 assert.deepEqual(result.overlaps,[]);assert.deepEqual(result.cycleBreaks,[]);assert.deepEqual(input,before);
 for(const shuffled of [[...input].reverse(),[house,north,south,west,east]])assert.deepEqual(orderStorybookObjects(shuffled),result);
});
test('overlaps and depth ties are explicit and deterministic, not artwork-size based',()=>{
 const a=item('a',0,0,2,2),b=item('b',0,0,2,2),result=orderStorybookObjects([b,a]);
 assert.deepEqual(result.items.map(v=>v.key),['a','b']);assert.deepEqual(result.overlaps,[['a','b']]);
 assert.deepEqual(orderStorybookObjects([]),{items:[],overlaps:[],cycleBreaks:[]});
 assert.throws(()=>orderStorybookObjects([a,a]));assert.throws(()=>orderStorybookObjects([{...a,worldFoot:{x:99,y:99}}]));
});
test('storybook geometry is not connected to either renderer or any state/transport',()=>{
 const source=readFileSync(new URL('../src/client/storybook-geometry.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b(?:fetch|EventSource|WebSocket|XMLHttpRequest|localStorage|stepWorld|submitPlan)\b|from ['"]phaser|process\.env|projectedFacing/);
 for(const file of ['main.ts','scene.ts','isometric-observer.ts'])assert.doesNotMatch(readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8'),/storybook-/);
});

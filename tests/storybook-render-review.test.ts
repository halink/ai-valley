/** Independent CPU-only review. Synthetic metadata, no image files or scene startup. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseStorybookManifest} from '../src/client/storybook-assets.js';
import {orderStorybookObjects, placeStorybookAsset, projectStorybook, unprojectStorybook, storybookFacing, type StorybookDepthItem} from '../src/client/storybook-geometry.js';

const item=(key:string,x:number,y:number,width:number,height:number):StorybookDepthItem=>({key,footprint:{x,y,width,height},worldFoot:{x:x+width/2,y:y+height/2}});
function permutations<T>(items:T[]):T[][] {return items.length ? items.flatMap((item,i)=>permutations(items.filter((_,j)=>i!==j)).map(rest=>[item,...rest])) : [[]];}
test('review: a real four-object constraint cycle is reported identically for all 24 permutations',()=>{
 const input=[item('a',4,9,3,2),item('b',8,5,3,5),item('c',11,1,3,5),item('d',6,6,7,1)];
 // a left of b; b left of c; c above d; d above a.
 const expected=orderStorybookObjects(input);
 assert.deepEqual(expected.items.map(v=>v.key),['a','b','c','d']);
 assert.deepEqual(expected.cycleBreaks,[{key:'a',predecessors:['d']}]);
 assert.deepEqual(expected.overlaps,[['d','b']]);
 for(const permutation of permutations(input))assert.deepEqual(orderStorybookObjects(permutation),expected);
});
test('review: every violated depth constraint is disclosed and every positive-area overlap is listed',()=>{
 let seed=12345;
 const random=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n);};
 for(let trial=0;trial<150;trial++){
  const input=Array.from({length:7},(_,i)=>item(String(i),random(12)-6,random(12)-6,1+random(8),1+random(8)));
  const output=orderStorybookObjects(input),position=new Map(output.items.map((v,i)=>[v.key,i]));
  assert.deepEqual(orderStorybookObjects([...input].reverse()),output);
  assert.equal(new Set(output.items).size,input.length);
  const disclosed=new Set(output.cycleBreaks.flatMap(v=>v.predecessors.map(p=>`${p}>${v.key}`))),violated=new Set<string>(),overlaps:string[]=[];
  for(let i=0;i<input.length;i++)for(let j=i+1;j<input.length;j++){
   const a=input[i],b=input[j],af=a.footprint,bf=b.footprint;
   const ab=af.x+af.width<=bf.x||af.y+af.height<=bf.y,ba=bf.x+bf.width<=af.x||bf.y+bf.height<=af.y;
   if(ab!==ba){const [first,last]=ab?[a,b]:[b,a];if(position.get(first.key)!>position.get(last.key)!)violated.add(`${first.key}>${last.key}`);}
   if(Math.min(af.x+af.width,bf.x+bf.width)>Math.max(af.x,bf.x)&&Math.min(af.y+af.height,bf.y+bf.height)>Math.max(af.y,bf.y))overlaps.push([a.key,b.key].sort().join(','));
  }
  assert.deepEqual(disclosed,violated);
  assert.deepEqual(output.overlaps.map(pair=>[...pair].sort().join(',')).sort(),overlaps.sort());
 }
});
const pin={packId:'review-fixture',packVersion:'1.0.0'};
function manifest(){return {schemaVersion:1,...pin,projection:{tileWidth:32,tileHeight:16},atlas:{path:'assets/storybook/review.png',width:128,height:64,sha256:'0'.repeat(64)},provenance:{source:'Synthetic metadata',author:'Review fixture',license:'No artwork'},assets:[{id:'resident',kind:'directional',footprint:{width:1,height:1},groundAnchor:{x:.5,y:.75},frames:Object.fromEntries(['northeast','southeast','southwest','northwest'].map((key,i)=>[key,{rect:{x:i*32,y:0,width:32,height:64},foot:{x:8+i,y:60-i}}]))}]};}
test('review: parsed directional placement uses four distinct frames without changing occupancy',()=>{
 const asset=parseStorybookManifest(manifest(),pin).assets[0],footprint=Object.freeze({x:-3,y:7,width:1,height:1});
 for(const [i,direction] of (['north','east','south','west'] as const).entries()){
  const placed=placeStorybookAsset(footprint,asset,storybookFacing(direction));
  assert.equal(placed.frame.rect.x,i*32);
  assert.deepEqual(placed.worldFoot,{x:-2.5,y:7.75});
  assert.deepEqual(placed.position,projectStorybook(placed.worldFoot));
  assert.equal(placed.topLeft.x+placed.frame.foot.x,placed.position.x);
  assert.equal(placed.topLeft.y+placed.frame.foot.y,placed.position.y);
 }
 assert.throws(()=>placeStorybookAsset(footprint,asset),/asset_facing/);
 assert.throws(()=>placeStorybookAsset(footprint,asset,'north' as never),/asset_facing/);
 assert.throws(()=>placeStorybookAsset({...footprint,width:2},asset,'northeast'),/asset_footprint/);
});
test('review: array decorations and nonenumerable/accessor frame members fail without getter execution',()=>{
 let calls=0;
 for(const decorate of [
  (m:ReturnType<typeof manifest>)=>Object.defineProperty(m.assets,'extra',{value:true}),
  (m:ReturnType<typeof manifest>)=>Object.defineProperty(m.assets,Symbol('extra'),{value:true}),
  (m:ReturnType<typeof manifest>)=>Object.defineProperty(m.assets[0].frames.northeast,'foot',{value:{x:1,y:1},enumerable:false}),
  (m:ReturnType<typeof manifest>)=>Object.defineProperty(m.assets[0].frames,'northeast',{enumerable:true,get(){calls++;return null;}}),
 ]){const input=manifest();decorate(input);assert.throws(()=>parseStorybookManifest(input,pin),/invalid_storybook_manifest/);}
 assert.equal(calls,0);
});
test('review: symmetric fractional projection preserves negative coordinates and known elevation',()=>{
 for(let x=-30;x<=30;x++)for(let y=-30;y<=30;y++){
  const point={x:x/8,y:y/8};
  assert.deepEqual(unprojectStorybook(projectStorybook(point,17.5),17.5),point);
 }
});

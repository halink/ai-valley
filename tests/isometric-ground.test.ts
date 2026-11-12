import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {planIsometricGround,paintIsometricGround} from '../src/client/isometric-ground.js';
import {IsometricViewport,fitWorldCamera} from '../src/client/isometric-viewport.js';
import type {Snapshot} from '../src/shared/types.js';
const fixture=()=>{const {world}=isometricStudyFixture();world.map.width=3;world.map.height=3;world.map.tiles=Array(9).fill('grass');return world;};
test('only real map neighbors generate banks; map edge and bridge remain open',()=>{
 const w=fixture();w.map.tiles[0]='water';w.map.tiles[1]='bridge';
 const p=planIsometricGround(w,{x:0,y:0,width:1,height:1},'spring');assert.equal(p.tiles,1);assert.equal(p.banks.length,1);
 w.map.tiles[3]='water';assert.equal(planIsometricGround(w,{x:0,y:0,width:1,height:1},'spring').banks.length,0);
});
test('chunk split retains coast continuity and bounded world coordinates',()=>{
 const w=fixture();w.map.tiles[4]='water';const b={x:0,y:0,width:3,height:3};
 const all=planIsometricGround(w,b,'spring'),left=planIsometricGround(w,{...b,width:1},'spring'),right=planIsometricGround(w,{...b,x:1,width:2},'spring');
 assert.deepEqual([...left.banks,...right.banks],all.banks);assert.equal(all.banks.length,4);
 const tiny=planIsometricGround(w,{x:-2,y:-2,width:4,height:4},'spring');assert.equal(tiny.tiles,4);
 assert.throws(()=>planIsometricGround(w,{...b,width:41},'spring'),/ground_bounds/);
});
test('plan is deterministic and never mutates world or creates selectable objects',()=>{
 const w=fixture(),before=structuredClone(w),b={x:0,y:0,width:3,height:3};
 const a=planIsometricGround(w,b,'spring');assert.deepEqual(planIsometricGround(w,b,'spring'),a);assert.deepEqual(w,before);assert.equal(a.base.length,9);assert.equal(a.banks.length,0);assert.equal(a.details.length,0);
 assert.notEqual(planIsometricGround(w,b,'winter').base[0].color,a.base[0].color);
});
test('batched painter uses camera-space floats and matched daylight rather than pixel resampling',()=>{
 const w=fixture(),p=planIsometricGround(w,{x:0,y:0,width:3,height:3},'spring');let fills=0,paths=0,moves=0;
 const ctx={fillStyle:'',beginPath(){paths++;},moveTo(){moves++;},lineTo(){},closePath(){},fill(){fills++;}};
 paintIsometricGround(ctx as unknown as CanvasRenderingContext2D,p,.5);assert.equal(paths,1);assert.equal(fills,1);assert.equal(moves,9);assert.equal(ctx.fillStyle,'#585c46');
});
test('real observer viewport carries the plan through animation without changing snapshot identities',()=>{
 const {world}=isometricStudyFixture();world.minute=720;const before=structuredClone(world),viewport=new IsometricViewport();
 viewport.accept({world,version:'synthetic-test',serverTime:'test',capabilities:{active:[],pending:[]}} as Snapshot);
 const scene=viewport.render(fitWorldCamera(world,{x:6,y:6},640,480),640,480),next=viewport.animate(scene,480);
 assert.ok(scene.groundPlan!.tiles>0);assert.ok(scene.groundPlan!.tiles<=1600);assert.equal(next.groundPlan,scene.groundPlan);assert.deepEqual(world,before);assert.deepEqual(next.objects.map(o=>o.key),scene.objects.map(o=>o.key));
});

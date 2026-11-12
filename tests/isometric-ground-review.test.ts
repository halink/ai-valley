/** Independent geometry/render-boundary review. No browser or model acceptance. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isometricStudyFixture} from '../scripts/isometric-study-fixture.js';
import {planIsometricGround,paintIsometricGround} from '../src/client/isometric-ground.js';
import {unprojectIsometric} from '../src/client/isometric-projection.js';
import {IsometricViewport,fitWorldCamera} from '../src/client/isometric-viewport.js';
import type {Snapshot} from '../src/shared/types.js';
function small(){const {world}=isometricStudyFixture();world.map.width=3;world.map.height=3;world.map.tiles=Array(9).fill('grass');world.map.tiles[4]='water';return world;}
test('review: banks remain inside the actual water tile and a crop edge never becomes a coastline',()=>{
 const w=small(),p=planIsometricGround(w,{x:1,y:1,width:1,height:1},'spring');assert.equal(p.banks.length,4);
 for(const bank of p.banks)for(const v of bank.points){const q=unprojectIsometric(v);assert.ok(q.x>=1&&q.x<=2&&q.y>=1&&q.y<=2);}
 w.map.tiles.fill('water');assert.equal(planIsometricGround(w,{x:1,y:1,width:1,height:1},'spring').banks.length,0);
 assert.equal(planIsometricGround(w,{x:0,y:0,width:3,height:3},'spring').banks.length,0);
});
test('review: bridges are not banks and every recorded land neighbor is a bank, not a synthetic obstacle',()=>{
 const w=small();w.map.tiles[1]='bridge';const before=structuredClone(w);
 const p=planIsometricGround(w,{x:1,y:1,width:1,height:1},'winter');assert.equal(p.banks.length,3);assert.deepEqual(w,before);
});
test('review: pure ground drawing batches color, dims all layers and never changes camera transform',()=>{
 const w=small();w.map.tiles.fill('grass');const p=planIsometricGround(w,{x:0,y:0,width:3,height:3},'spring');
 let fills=0,moves=0,closures=0;const colors:string[]=[];
 const ctx={fillStyle:'',beginPath(){},moveTo(){moves++;},lineTo(){},closePath(){closures++;},fill(){fills++;colors.push(this.fillStyle);}};
 paintIsometricGround(ctx as unknown as CanvasRenderingContext2D,p,.5);
 assert.equal(fills,1);assert.equal(moves,9);assert.equal(closures,9);assert.deepEqual(colors,['#585c46']);
});
test('review: world-backed ground survives display animation without world writes or re-planning',()=>{
 const {world}=isometricStudyFixture();world.minute=720;const before=structuredClone(world);
 const snap:Snapshot={world,serverTime:'2026-11-12T00:00:00Z',version:'synthetic-ground-review',capabilities:{active:[],pending:[]}};
 const v=new IsometricViewport();v.accept(snap);const s=v.render(fitWorldCamera(world,{x:6,y:6},640,480),640,480);
 const a=v.animate(s,400);assert.equal(a.groundPlan,s.groundPlan);assert.deepEqual(world,before);assert.ok(s.groundPlan!.tiles<=1600);
 assert.equal(s.groundPlan!.tiles,s.bounds.width*s.bounds.height);assert.equal(a.objects.length,s.objects.length);
});
test('review: invalid or unbounded plans fail explicitly and out-of-map crops create no extra terrain',()=>{
 const w=small();for(const width of [41,NaN,Infinity,-1,.5])assert.throws(()=>planIsometricGround(w,{x:0,y:0,width,height:3},'spring'),/ground_bounds/);
 assert.equal(planIsometricGround(w,{x:-2,y:-2,width:5,height:5},'spring').tiles,9);
 assert.equal(planIsometricGround(w,{x:100,y:100,width:3,height:3},'spring').tiles,0);
});
test('review: every cardinal direction and tile kind obeys real adjacency, without diagonal banks',()=>{
 for(const index of [1,3,5,7])for(const kind of ['grass','path','water','sand','cliff','soil','bridge','road'] as const){
  const w=small();w.map.tiles.fill('water');w.map.tiles[index]=kind;
  const p=planIsometricGround(w,{x:1,y:1,width:1,height:1},'summer');
  assert.equal(p.banks.length,kind==='water'||kind==='bridge'?0:1,`${index}:${kind}`);
  for(const shape of [...p.banks,...p.details])for(const point of shape.points){const v=unprojectIsometric(point);assert.ok(v.x>=1&&v.x<=2&&v.y>=1&&v.y<=2);}
 }
 const w=small();w.map.tiles.fill('water');for(const i of [0,2,6,8])w.map.tiles[i]='cliff';
 assert.equal(planIsometricGround(w,{x:1,y:1,width:1,height:1},'summer').banks.length,0);
});
test('review: maximum alternating shore is bounded and still batches constant paint calls',()=>{
 const w=small();w.map.width=40;w.map.height=40;w.map.tiles=Array.from({length:1600},(_,i)=>(Math.floor(i/40)+i%40)%2?'water':'grass');
 const p=planIsometricGround(w,{x:0,y:0,width:40,height:40},'spring');assert.equal(p.tiles,1600);assert.equal(p.banks.length,3120);
 assert.ok(p.base.length+p.banks.length+p.details.length<=16000);
 let fills=0;const ctx={fillStyle:'',beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){fills++;}};
 paintIsometricGround(ctx as unknown as CanvasRenderingContext2D,p,0);assert.ok(fills<=5);
});
test('review: replacement snapshot regenerates actual ground rather than retaining an animated stale plan',()=>{
 const {world}=isometricStudyFixture(),v=new IsometricViewport();v.accept({world});
 const camera=fitWorldCamera(world,{x:6,y:6},640,480),a=v.render(camera,640,480),replacement=structuredClone(world);
 replacement.map.tiles.fill('water');replacement.minute+=1440*120;replacement.revision++;
 v.accept({world:replacement});const b=v.render(camera,640,480);
 assert.notEqual(b.groundPlan,a.groundPlan);assert.equal(b.groundPlan!.banks.length,0);assert.equal(new Set(b.groundPlan!.base.map(s=>s.color)).size,1);
 assert.equal(v.animate(a,800),a,'stale scene must not be rebound to the replacement snapshot');
});

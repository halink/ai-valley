import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {safeWildlifeBank,localWildlifeHabitat} from '../src/world/wildlife-population.js';
import type {FrontierDisaster} from '../src/shared/frontier-hazards.js';
import type {Vec} from '../src/shared/types.js';

function fixture(){
 const w=createFrontierWorld(5403);
 w.map={...w.map,width:8,height:8,tiles:Array(64).fill('grass')};
 w.resources=[];w.buildings=[];w.plots=[];w.graves=[];
 const s=w.frontierHazards!;s.disasters=[];s.shore={x:3,y:3};
 const b=s.beasts.find(b=>b.species==='deer')!;b.at={x:2,y:3};
 return {w,s,b,shore:s.shore};
}
function hazard(at:Vec,phase:FrontierDisaster['phase']='active'):FrontierDisaster{
 return {id:'bank-review',kind:'flashFlood',at,radius:0,phase,warningAt:0,startsAt:0,endsAt:1e9,intensity:1,warned:[],exposure:{}};
}

test('review: map edges cannot wrap into a different row as a water contact',()=>{
 const {w}=fixture();w.map.tiles[15]='water';
 assert.equal(safeWildlifeBank(w,{x:0,y:2}),false,'x=-1 must not alias index 15');
 w.map.tiles[16]='water';
 assert.equal(safeWildlifeBank(w,{x:7,y:1}),false,'x=8 must not alias index 16');
});

test('review: diagonal water is not a drinking contact',()=>{
 const {w,shore}=fixture();w.map.tiles[4*8+4]='water';
 assert.equal(safeWildlifeBank(w,shore),false);
});

test('review: actual disaster footprint, not distant center, blocks drinking and breeding water',()=>{
 const {w,s,b,shore}=fixture(),water={x:4,y:3};w.map.tiles[3*8+4]='water';
 s.disasters=[{...hazard({x:7,y:7}),footprint:[water]}];
 const before=structuredClone(w);
 assert.equal(safeWildlifeBank(w,shore),false);
 assert.equal(localWildlifeHabitat(w,b).watered,false);
 assert.deepEqual(w,before,'eligibility queries do not consume or reconstruct resources');
});

for(const phase of ['warning','ended'] as const)test(`review: ${phase} water hazard preserves ordinary bank eligibility`,()=>{
 const {w,s,b,shore}=fixture();w.map.tiles[3*8+4]='water';
 s.disasters=[hazard({x:4,y:3},phase)];
 assert.equal(safeWildlifeBank(w,shore),true);
 assert.equal(localWildlifeHabitat(w,b).watered,true);
});

test('review: an active unsafe bank is rejected despite multiple safe adjacent water cells',()=>{
 const {w,s,b,shore}=fixture();w.map.tiles[3*8+4]='water';w.map.tiles[2*8+3]='water';
 s.disasters=[hazard(shore)];
 assert.equal(safeWildlifeBank(w,shore),false);
 assert.equal(localWildlifeHabitat(w,b).watered,false);
});

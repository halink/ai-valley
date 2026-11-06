import assert from 'node:assert/strict';
import {test} from 'node:test';
import {animalInspector} from '../src/client/animal-observation.js';
import {advanceFishing,fishSchoolView,fishingKey,fishingStockAt,initializeFishing,shoalWithinReach,waterAtShore,wildFishAt} from '../src/world/fishing.js';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {distance} from '../src/world/navigation.js';
import type {World} from '../src/shared/types.js';

function villageSchool(w:World){
 const shore=w.industry!.frontierShore!,water=waterAtShore(w,shore)!;
 const key=fishingKey(water),pool=fishingStockAt(w,shore)!;
 return {shore,key,pool};
}

test('frontier fish are visible near the fishing shore and a wild catch uses the same finite stock',()=>{
 const w=createFrontierWorld(),{shore,key,pool}=villageSchool(w);
 const opening=fishSchoolView(w,key)!;
 assert.ok(distance(opening.at,shore)<=3);
 assert.equal(w.map.tiles[opening.at.y*w.map.width+opening.at.x],'water');
 assert.equal(opening.amount,pool.amount);
 assert.equal(opening.activity,'feeding');
 assert.equal(wildFishAt(w,shore),true);
 assert.equal(fishSchoolView(w,key)?.amount,opening.amount-1);
 assert.match(animalInspector(w,{kind:'fish',id:key}),new RegExp(`${opening.amount-1} / ${opening.capacity}`));
 pool.amount=0;
 assert.equal(wildFishAt(w,shore),false);
 assert.equal(fishSchoolView(w,key)?.amount,0);
});

test('an actual flood moves the shoal and interrupts a reachable cast without changing its population',()=>{
 const w=createFrontierWorld(),{shore,key,pool}=villageSchool(w);
 const before={...pool.shoal!.at},amount=pool.amount;
 assert.ok(shoalWithinReach(w,shore));
 w.frontierHazards!.disasters.push({id:'shore-flood',kind:'flashFlood',at:before,radius:5,phase:'active',
  warningAt:w.minute-1,startsAt:w.minute,endsAt:w.minute+20,intensity:8,warned:[],exposure:{}});
 w.minute++;advanceFishing(w);
 const school=fishSchoolView(w,key)!;
 assert.equal(school.activity,'evadingFlood');
 assert.equal(distance(before,school.at),1);
 assert.equal(w.map.tiles[school.at.y*w.map.width+school.at.x],'water');
 assert.equal(pool.amount,amount);
 assert.equal(shoalWithinReach(w,shore),false);
 assert.equal(wildFishAt(w,shore),false);
 assert.match(animalInspector(w,{kind:'fish',id:key}),/躲避洪流/);
});

test('an older save gains positions without refilling exhausted pools and keeps position across restart',()=>{
 const w=createFrontierWorld(),{key,pool}=villageSchool(w);
 delete pool.shoal;pool.amount=0;pool.progress=.46;
 const old=JSON.parse(JSON.stringify(w)) as World;
 initializeFishing(old);
 assert.equal(old.industry!.fishing[key].amount,0);
 assert.equal(old.industry!.fishing[key].progress,.46);
 assert.ok(fishSchoolView(old,key)?.at);
 const restored=JSON.parse(JSON.stringify(old)) as World;
 initializeFishing(restored);
 assert.deepEqual(fishSchoolView(restored,key),fishSchoolView(old,key));
});

test('a shoal in the same sector across dry land cannot supply a catch',()=>{
 const w=createFrontierWorld(),{shore,pool}=villageSchool(w);
 const water=waterAtShore(w,shore)!,remote={x:water.x+2,y:water.y};
 const tiles=w.map.tiles.slice();
 w.map={...w.map,tiles};
 for(let y=water.y-5;y<=water.y+5;y++)tiles[y*w.map.width+water.x+1]='grass';
 tiles[remote.y*w.map.width+remote.x]='water';
 pool.shoal!.at=remote;
 assert.equal(fishingKey(water),fishingKey(remote));
 assert.equal(shoalWithinReach(w,shore,4),false);
 assert.equal(wildFishAt(w,shore),false);
});

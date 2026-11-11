import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Vec,World} from '../src/shared/types.js';
import {findPath,reachableTilesFrom} from '../src/world/navigation.js';
import {createWorld} from '../src/world/seed.js';
import {initializeIndustry} from '../src/world/industry.js';
import {initializeInfrastructure} from '../src/world/infrastructure.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.map={name:'连通性隔离验收',width:12,height:12,tiles:Array(144).fill('grass'),entrance:{x:0,y:0}};
 w.resources=[];w.buildings=[];w.plots=[];w.graves=[];return w;
}
function matchesPaths(w:World,start:Vec){
 const before=structuredClone(w),reachable=reachableTilesFrom(w,start);
 for(let y=0;y<w.map.height;y++)for(let x=0;x<w.map.width;x++){
  assert.equal(Boolean(reachable[y*w.map.width+x]),findPath(w,start,{x,y})!==null,`from ${start.x},${start.y} to ${x},${y}`);
 }
 assert.deepEqual(w,before,'connectivity and path queries remain read-only');
}

test('actor-origin connectivity matches real paths through terrain, resources and occupied starting cells',()=>{
 const w=fixture();for(let y=0;y<12;y++)w.map.tiles[y*12+6]=y===5?'road':'water';
 for(let x=0;x<6;x++)w.map.tiles[3*12+x]='cliff';
 w.resources=[{id:'tree',kind:'tree',at:{x:5,y:5},amount:2,max:2,regrowthDays:0,lastHarvest:0}];
 for(const start of [{x:2,y:2},{x:5,y:5},{x:7,y:5}])matchesPaths(w,start);
 assert.equal(reachableTilesFrom(w,{x:-1,y:0}).some(Boolean),false);
});

test('actor-origin connectivity matches flood exit, overlapping footprints and no reentry',()=>{
 const w=fixture();w.frontierHazards={beasts:[],disasters:[],shore:null,woodland:{x:1,y:1},nextDisasterAt:1000,nextSerial:1,foodPatches:[],nextBeastSerial:1,totals:{injuries:0,accidentalDeaths:0,damagedBuildings:0,damagedPlots:0,repairs:0,livestockAttacks:0,livestockKilled:0,wildlifeDeaths:0,hunted:0}};
 const footprint=[{x:3,y:1},{x:3,y:2},{x:3,y:3},{x:4,y:3},{x:5,y:3},{x:5,y:2},{x:5,y:1}];
 const first={id:'u-flood',kind:'flashFlood' as const,at:{x:4,y:2},radius:4,phase:'active' as const,warningAt:0,startsAt:0,endsAt:1000,intensity:10,warned:[],exposure:{},footprint};
 w.frontierHazards!.disasters=[first,{...first,id:'overlap',footprint:[{x:5,y:2},{x:6,y:2},{x:6,y:3},{x:5,y:3}]}];
 for(const start of [{x:3,y:1},{x:5,y:3},{x:1,y:1}])matchesPaths(w,start);
});

test('actor-origin connectivity follows pasture gates and damaged bridge exit rules',()=>{
 const w=fixture();initializeIndustry(w);initializeInfrastructure(w);
 const tiles=Array.from({length:9},(_,i)=>({x:3+i%3,y:3+Math.floor(i/3)}));
 w.industry!.pastures=[{id:'fenced',barnId:'barn',tiles,forage:10,capacity:10,lastMinute:0,fenced:true,gate:{inside:{x:4,y:5},outside:{x:4,y:6}}}];
 for(let y=0;y<12;y++)w.map.tiles[y*12+8]=y===5?'bridge':'water';
 w.infrastructure!.assets=[{id:'damaged-bridge',name:'原桥',projectId:'original',kind:'bridge',definition:'bridge-test',at:{x:8,y:5},width:1,height:1,access:{x:7,y:5},anchors:[{x:7,y:5},{x:9,y:5}],tiles:[{at:{x:8,y:5},before:'water',after:'bridge'}],graveIds:[],condition:0,lastDay:0,createdAt:0,retiredAt:null,cost:{},minutes:0}];
 for(const start of [{x:4,y:4},{x:8,y:5},{x:10,y:5}])matchesPaths(w,start);
 w.map.tiles[6*12+4]='cliff';matchesPaths(w,{x:4,y:4});
});

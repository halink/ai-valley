import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceWildlife} from '../src/world/frontier-wildlife.js';
const threats={warn:()=>{},injure:()=>{},notify:()=>{}};
function fixture(){
 const w=createFrontierWorld(5404),s=w.frontierHazards!,b=s.beasts.find(b=>b.species==='deer')!;
 w.minute=19*60;w.weather='sun';w.resources=[];w.residents=[];w.buildings=[];w.plots=[];w.industry!.animals=[];
 w.map={...w.map,width:20,height:20,tiles:Array(400).fill('grass')};
 s.disasters=[];s.shore=null;s.beasts=[b];s.lastWildlifeAt=w.minute;
 s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[]};
 Object.assign(b,{at:{x:3,y:8},den:{x:10,y:8},energy:70,hunger:20,thirst:20,nextMoveAt:w.minute,cooldownUntil:1e12,activity:{kind:'roam',reason:'review fixture'}});
 delete b.path;delete b.alert;delete b.migration;
 return {w,b};
}
function tick(w:ReturnType<typeof createFrontierWorld>){w.minute++;advanceWildlife(w,1,threats);}

test('review: a healthy diurnal deer returning at night cannot earn sleep while walking',()=>{
 const {w,b}=fixture();tick(w);assert.equal(b.activity?.kind,'roam');assert.equal(b.at.x,4);
 const energy=b.energy!,hunger=b.hunger;tick(w);
 assert.ok(Math.abs(b.energy!-(energy-.03))<1e-9);
 assert.ok(Math.abs(b.hunger-(hunger+1/55))<1e-9);
});

test('review: a blocked return route can still choose legitimate rest at the present place',()=>{
 const {w,b}=fixture();for(let y=0;y<20;y++)w.map.tiles[y*20+6]='water';
 tick(w);assert.equal(b.activity?.kind,'rest');assert.deepEqual(b.activity?.target,b.at);
 const energy=b.energy!,at={...b.at};tick(w);assert.deepEqual(b.at,at);assert.ok(Math.abs(b.energy!-(energy+.12))<1e-9);
});

test('review: old saved rest activity pointing at a distant den earns no sleep before the next movement is due',()=>{
 const {w,b}=fixture();b.activity={kind:'rest',reason:'回到藏身处休息',target:{...b.den}};b.nextMoveAt=w.minute+14;
 const at={...b.at},energy=b.energy!,hunger=b.hunger;tick(w);
 assert.deepEqual(b.at,at);assert.ok(Math.abs(b.energy!-(energy-.03))<1e-9);
 assert.ok(Math.abs(b.hunger-(hunger+1/55))<1e-9);
});

for(const offset of [null,0,2] as const)test(`review: legacy stationary rest target offset ${offset} preserves sleep recovery`,()=>{
 const {w,b}=fixture();b.activity={kind:'rest',reason:'legacy rest',...(offset===null?{}:{target:{x:b.at.x+offset,y:b.at.y}})};b.nextMoveAt=w.minute+14;
 const energy=b.energy!,hunger=b.hunger;tick(w);
 assert.ok(Math.abs(b.energy!-(energy+.12))<1e-9);
 assert.ok(Math.abs(b.hunger-(hunger+.66/55))<1e-9);
});

test('review: the first rest target just outside the two-cell tolerance cannot earn sleep',()=>{
 const {w,b}=fixture();b.activity={kind:'rest',reason:'legacy return',target:{x:b.at.x+3,y:b.at.y}};b.nextMoveAt=w.minute+14;
 const energy=b.energy!;tick(w);assert.ok(Math.abs(b.energy!-(energy-.03))<1e-9);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {advanceWildlife,createWildBeast} from '../src/world/frontier-wildlife.js';
import {WorldStore} from '../src/server/store.js';
import type {Resource} from '../src/shared/types.js';
import {disasterContains,type FrontierDisaster} from '../src/shared/frontier-hazards.js';
import {distance,walkable} from '../src/world/navigation.js';

const threats={warn:()=>{},injure:()=>{},notify:()=>{}};
function fixture(){
 const w=createFrontierWorld(5401),s=w.frontierHazards!;
 w.map={...w.map,width:20,height:20,tiles:Array(400).fill('grass')};w.minute=600;w.weather='sun';
 w.residents=[];w.buildings=[];w.plots=[];w.industry!.animals=[];w.industry!.mines=[];w.industry!.pastures=[];w.industry!.pastureProjects=[];
 if(w.construction)w.construction.projects=[];if(w.infrastructure)w.infrastructure.assets=[];
 const spring:Resource={id:'review-water',kind:'spring',at:{x:10,y:5},amount:2,max:2,regrowthDays:10,lastHarvest:0};w.resources=[spring];
 const b=createWildBeast(w,'deer','review-deer',{x:5,y:5});Object.assign(b,{thirst:80,hunger:20,energy:10,nextMoveAt:0});
 s.beasts=[b];s.disasters=[];s.shore=null;s.foodPatches=[];s.nextDisasterAt=1e12;
 s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[]};
 return {w,s,b,spring};
}
function tick(f:ReturnType<typeof fixture>){f.w.minute++;f.b.nextMoveAt=f.w.minute;advanceWildlife(f.w,1,threats);}
function storm(x:number,y:number):FrontierDisaster{return {id:'review-storm',kind:'windstorm',at:{x,y},radius:0,phase:'active',warningAt:0,startsAt:0,endsAt:1e12,intensity:20,warned:[],exposure:{}};}
function fence(f:ReturnType<typeof fixture>){f.w.industry!.pastures=[{id:'review-fence',barnId:'none',tiles:[{x:7,y:5}],forage:0,capacity:1,lastMinute:600,fenced:true,status:'open',gate:{inside:{x:7,y:5},outside:{x:7,y:6}}}];}

test('review: dynamic fence invalidates a later cached edge before crossing it',()=>{
 const f=fixture();tick(f);assert.deepEqual(f.b.at,{x:6,y:5});fence(f);tick(f);
 assert.notDeepEqual(f.b.at,{x:7,y:5});let from=f.b.at;
 for(const at of f.b.path!.steps){assert.equal(distance(from,at),1);assert.ok(walkable(f.w,at,from));from=at;}
 assert.equal(f.spring.amount,2);
});

test('review: adjacent spring across fence requires actual gate approach',()=>{
 const f=fixture();f.spring.at={x:7,y:5};f.b.at={x:6,y:5};fence(f);tick(f);
 assert.equal(f.spring.amount,2);assert.ok(f.b.thirst!>80);assert.notDeepEqual(f.b.at,f.spring.at);
 for(let i=0;i<10&&f.spring.amount===2;i++)tick(f);
 assert.equal(f.spring.amount,1);assert.deepEqual(f.b.at,{x:7,y:6});
});

test('review: active disaster on animal origin retains priority escape, never adjacent drinking',()=>{
 const f=fixture();f.spring.at={x:6,y:5};f.s.disasters=[storm(5,5)];tick(f);
 assert.equal(f.b.activity?.kind,'flee');assert.equal(f.spring.amount,2);assert.ok(f.b.thirst!>80);
});

test('review: failed nearest source falls through to a finite safe source',()=>{
 const f=fixture();f.spring.at={x:7,y:5};f.w.map.tiles[5*20+7]='cliff';
 const other={...f.spring,id:'review-alternative',at:{x:5,y:8}};f.w.resources.push(other);tick(f);
 assert.equal(f.b.activity?.targetId,other.id);assert.equal(f.spring.amount,2);assert.equal(other.amount,2);
 for(let i=0;i<10&&other.amount===2;i++)tick(f);
 assert.equal(other.amount,1);assert.equal(f.spring.amount,2);
});

test('review: disappeared source abandons stale drinking cache without inventing water',()=>{
 const f=fixture();tick(f);f.spring.amount=0;const thirst=f.b.thirst!;tick(f);
 assert.notEqual(f.b.activity?.kind,'drink');assert.notDeepEqual(f.b.path?.to,f.spring.at);
 assert.equal(f.spring.amount,0);assert.ok(f.b.thirst!>thirst);
});

test('review: non-thirsty return-to-den movement keeps original hazard semantics',()=>{
 const f=fixture();f.b.thirst=20;f.b.den={x:10,y:5};f.s.disasters=[storm(6,5)];tick(f);
 // Return travel retains its original path, but is no longer labelled sleep.
 assert.equal(f.b.activity?.kind,'roam');assert.deepEqual(f.b.at,{x:6,y:5});assert.equal(f.spring.amount,2);
});

test('review: SQLite restored stale path revalidates both fence and disaster',()=>{
 const f=fixture();tick(f);fence(f);f.s.disasters=[storm(8,5)];const store=new WorldStore(':memory:');
 try{
  store.commit(f.w,null);const w=store.loadForRuntime()!,s=w.frontierHazards!,b=s.beasts[0];
  tick({w,s,b,spring:w.resources[0]});assert.notDeepEqual(b.at,{x:7,y:5});let from=b.at;
  for(const at of b.path!.steps){assert.ok(walkable(w,at,from));assert.ok(!disasterContains(s.disasters[0],at));from=at;}
  assert.equal(w.resources[0].amount,2);
 }finally{store.close();}
});

test('review: invalid nonadjacent cached step cannot teleport a thirsty animal',()=>{
 const f=fixture();f.b.path={to:{...f.spring.at},steps:[{x:6,y:5},{x:9,y:5},{x:10,y:5}]};tick(f);
 let from=f.b.at;assert.equal(distance({x:5,y:5},from),1);
 for(const at of f.b.path!.steps){assert.equal(distance(from,at),1);from=at;}
 assert.equal(f.spring.amount,2);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createFrontierWorld} from '../src/world/formal-seed.js';
import {stepWorld} from '../src/world/engine.js';
import {distance} from '../src/world/navigation.js';
import {WorldStore} from '../src/server/store.js';
import type {World} from '../src/shared/types.js';

function fixture(){
 const w=createFrontierWorld(5402),s=w.frontierHazards!,beast=s.beasts.find(b=>b.species==='deer')!;
 w.clock.paused=false;w.minute=540;w.weather='sun';w.residents=[];w.buildings=[];w.plots=[];w.resources=[];
 w.industry!.animals=[];w.industry!.mines=[];if(w.infrastructure)w.infrastructure.assets=[];if(w.construction)w.construction.projects=[];
 w.map={name:'synthetic tired animal',width:32,height:24,entrance:{x:1,y:1},tiles:Array(768).fill('grass')};
 s.disasters=[];s.nextDisasterAt=1e12;s.shore=null;s.beasts=[beast];s.predatorEcology={version:1,registeredAt:w.minute,lastReviewAt:w.minute,habitats:[]};
 Object.assign(beast,{at:{x:5,y:10},den:{x:13,y:10},energy:20,hunger:20,thirst:20,health:100,nextMoveAt:w.minute,cooldownUntil:1e12,activity:{kind:'roam',reason:'synthetic tired fixture'}});
 delete beast.path;delete beast.alert;delete beast.migration;
 return {w,beast};
}
function continueJourney(w:World){
 const b=w.frontierHazards!.beasts[0];let left=100;
 while(b.activity?.kind!=='rest'){
  assert.ok(left-->0);const before={at:{...b.at},energy:b.energy!,hunger:b.hunger};stepWorld(w,1);
  assert.ok(distance(before.at,b.at)<=1,'no teleport');
  assert.ok(Math.abs(b.energy!-(before.energy-.03))<1e-8,'travelling toward rest is ordinary movement, not sleeping');
  assert.ok(Math.abs(b.hunger-(before.hunger+1/55))<1e-8,'no sleeping hunger discount while travelling');
 }
 assert.ok(distance(b.at,b.den)<=2,'rest begins only after returning within original den tolerance');
 const at={...b.at},energy=b.energy!,hunger=b.hunger;stepWorld(w,1);
 assert.deepEqual(b.at,at);assert.ok(Math.abs(b.energy!-(energy+.12))<1e-8);
 assert.ok(Math.abs(b.hunger-(hunger+.66/55))<1e-8);
 return b;
}

test('a tired deer physically returns before sleep can restore energy',()=>{
 const {w}=fixture();continueJourney(w);assert.equal(w.metrics.requests,0);
});

test('a returning animal resumes the same movement and rest after a durable SQLite restart',()=>{
 const {w}=fixture();stepWorld(w,9);assert.notEqual(w.frontierHazards!.beasts[0].activity?.kind,'rest');
 mkdirSync('output',{recursive:true});const dir=mkdtempSync('output/wildlife-rest-'),file=join(dir,'synthetic.sqlite');let store=new WorldStore(file);
 try{store.commit(w,null);store.close();store=new WorldStore(file);const loaded=store.loadForRuntime()!;
  const expected=continueJourney(w),actual=continueJourney(loaded);assert.deepEqual(actual,expected);assert.equal(loaded.minute,w.minute);assert.equal(loaded.metrics.requests,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

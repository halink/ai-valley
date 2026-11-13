import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMvpSession,createMvpWorld} from '../src/server/godot-mvp.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {enableCompletedMovement,completedMovementSnapshot,forkCompletedMovement,MOVEMENT_LIMIT} from '../src/world/completed-movement.js';
function setup(){
 const w=createMvpWorld();w.residents=w.residents.slice(0,1);const r=w.residents[0];r.at={x:10,y:14};
 enableCompletedMovement(w);
 const result=submitPlan(w,{id:'synthetic-move',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'Synthetic movement evidence',actions:[{type:'move',to:{x:15,y:17}}]});
 assert.equal(result.ok,true);return {w,r};
}
test('records only settled engine cells, not pending plans; preserves corners',()=>{
 const {w,r}=setup();assert.equal(completedMovementSnapshot(w)!.steps.length,0);
 const expected=[];for(let n=0;n<10;n++){
  const from={...r.at};stepWorld(w,1);
  if(from.x!==r.at.x||from.y!==r.at.y)expected.push({from,to:{...r.at}});
 }
 const actual=completedMovementSnapshot(w)!;
 assert.ok(expected.length>=8);assert.deepEqual(actual.steps.map(({from,to})=>({from,to})),expected);
 assert.ok(actual.steps.some(s=>s.from.x!==s.to.x));assert.ok(actual.steps.some(s=>s.from.y!==s.to.y));
 assert.deepEqual(actual.steps.map(s=>s.seq),expected.map((_,i)=>i+1));
 assert.equal(w.events.some(e=>e.text.includes('Synthetic movement evidence')),false);
});
test('blocked path emits no fictitious completed step',()=>{
 const {w,r}=setup();stepWorld(w,1);const next=r.activity!.path[0];w.map.tiles[next.y*w.map.width+next.x]='cliff';
 const before=completedMovementSnapshot(w)!.lastSeq,at={...r.at};stepWorld(w,1);
 assert.equal(completedMovementSnapshot(w)!.lastSeq,before);assert.deepEqual(r.at,at);assert.ok(r.lastFailure);
});
test('observer is not serialized and does not alter simulation outcomes',()=>{
 const {w}=setup();const copy=structuredClone(w);assert.equal(completedMovementSnapshot(copy),undefined);
 for(let i=0;i<12;i++){stepWorld(w,1);stepWorld(copy,1);}
 assert.deepEqual(w,copy);assert.ok(completedMovementSnapshot(w)!.steps.length>0);
 const restored=structuredClone(w);enableCompletedMovement(restored);
 assert.notEqual(completedMovementSnapshot(restored)!.epoch,completedMovementSnapshot(w)!.epoch);
 assert.equal(completedMovementSnapshot(restored)!.lastSeq,0);
});
test('bounded snapshots detach buffers; world replacement and rewind reset epoch',()=>{
 const {w,r}=setup();
 for(let n=0;n<40;n++){
  while(r.activity||r.plan)stepWorld(w,1);
  r.hunger=0;r.energy=100;
  assert.equal(submitPlan(w,{id:`route-${n}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'synthetic',actions:[{type:'move',to:{x:n%2?15:5,y:17}}]}).ok,true);
 }
 const s=completedMovementSnapshot(w)!;assert.ok(s.lastSeq>MOVEMENT_LIMIT);assert.equal(s.steps.length,MOVEMENT_LIMIT);
 assert.equal(s.firstSeq,s.lastSeq-MOVEMENT_LIMIT+1);
 s.steps[0].from.x=-999;assert.notEqual(completedMovementSnapshot(w)!.steps[0].from.x,-999);
 const epoch=s.epoch;w.id+='-new';assert.notEqual(completedMovementSnapshot(w)!.epoch,epoch);
 const epoch2=completedMovementSnapshot(w)!.epoch;w.minute--;
 assert.notEqual(completedMovementSnapshot(w)!.epoch,epoch2);
});
test('draft observations are isolated and discontinuities clear history',()=>{
 const {w}=setup();const before=completedMovementSnapshot(w)!;
 const draft=structuredClone(w);forkCompletedMovement(w,draft);stepWorld(draft,1);
 assert.ok(completedMovementSnapshot(draft)!.lastSeq>0);
 assert.deepEqual(completedMovementSnapshot(w),before,'aborted draft leaks nothing');
 const d=completedMovementSnapshot(draft)!;draft.residents[0].at={x:2,y:2};
 assert.notEqual(completedMovementSnapshot(draft)!.epoch,d.epoch);
 const rewind=completedMovementSnapshot(draft)!.epoch;draft.revision--;
 assert.notEqual(completedMovementSnapshot(draft)!.epoch,rewind);
 const e=completedMovementSnapshot(draft)!.epoch;draft.map.tiles[0]='grass';
 assert.notEqual(completedMovementSnapshot(draft)!.epoch,e);
 draft.residents[0].inside='mvp-home';const indoor=completedMovementSnapshot(draft)!;
 assert.equal(indoor.steps.length,0);
 draft.map.tiles=Array(4097).fill('grass');assert.equal(completedMovementSnapshot(draft),undefined);
});

test('a fast road tick records every settled cell rather than a guessed shortcut',()=>{
 const {w,r}=setup();stepWorld(w,1);for(const p of r.activity!.path)w.map.tiles[p.y*w.map.width+p.x]='road';
 completedMovementSnapshot(w);let multi=false;
 for(let i=0;i<6;i++){
  const before=completedMovementSnapshot(w)!.lastSeq;stepWorld(w,1);
  const s=completedMovementSnapshot(w)!;multi ||= s.lastSeq-before>1;
  for(const e of s.steps)assert.equal(Math.abs(e.from.x-e.to.x)+Math.abs(e.from.y-e.to.y),1);
 }
 assert.ok(multi);const old=completedMovementSnapshot(w)!;w.clock.paused=true;stepWorld(w,1);
 assert.deepEqual(completedMovementSnapshot(w),old);
});

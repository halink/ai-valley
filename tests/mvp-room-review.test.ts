/** Independent short, synthetic room regressions. No models or real saves. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMvpWorld} from '../src/server/godot-mvp.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
import {roomLayout} from '../src/shared/rooms.js';
import {WorldStore} from '../src/server/store.js';
function setup(){const w=createMvpWorld(),[r,other]=w.residents,b=w.buildings[0];r.at={...b.door};r.energy=20;r.hunger=10;
 assert.ok(submitPlan(w,{id:'independent-sleep',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'合成自选休息',actions:[{type:'sleep',minutes:30}]}).ok);
 stepWorld(w,1);return {w,r,other,b};}
function arrive(f:ReturnType<typeof setup>){let n=40;while(f.r.activity?.room?.path.length){assert.ok(n-->0);stepWorld(f.w,1);}assert.ok(f.r.activity);}
for(const restart of [false,true])test('review: a blocked occupied bed stops sleep in place'+(restart?' after reload':''),()=>{
 let f=setup();arrive(f);const at=structuredClone(f.r.roomAt),energy=f.r.energy;
 Object.assign(f.other,{status:'dead',inside:f.b.id,roomAt:{...at!},body:{reservedBy:null,carriedBy:null,storedAt:f.b.id,storageSlot:0}});
 if(restart){const store=new WorldStore(':memory:');try{store.commit(f.w,null);const w=store.loadForRuntime()!;f={w,r:w.residents[0],other:w.residents[1],b:w.buildings[0]};}finally{store.close();}}
 stepWorld(f.w,1);assert.match(f.r.lastFailure!,/阻断/);assert.deepEqual(f.r.roomAt,at);assert.ok(f.r.energy<=energy);assert.equal(f.r.activity,null);
});
test('review: assigned bed changes during route do not redirect or recover',()=>{
 const {w,r,other,b}=setup(),at=structuredClone(r.roomAt),energy=r.energy;
 w.rooms!.beds[b.id]={[r.id]:1,[other.id]:0};stepWorld(w,1);
 assert.match(r.lastFailure!,/床位已经改变/);assert.deepEqual(r.roomAt,at);assert.ok(r.energy<=energy);assert.equal(r.activity,null);
});
test('review: withdrawing home membership stops at actual indoor point',()=>{
 const {w,r,b}=setup(),at=structuredClone(r.roomAt),energy=r.energy;b.residents=b.residents.filter(id=>id!==r.id);
 stepWorld(w,1);assert.match(r.lastFailure!,/使用权/);assert.deepEqual(r.roomAt,at);assert.equal(r.inside,b.id);assert.ok(r.energy<=energy);assert.equal(r.activity,null);
});
test('review: asleep resident may finish even if entry later blocks, but cannot exit through it',()=>{
 const f=setup();arrive(f);const at=structuredClone(f.r.roomAt),entry=roomLayout(f.w,f.b).entry;
 Object.assign(f.other,{status:'dead',inside:f.b.id,roomAt:{...entry},body:{reservedBy:null,carriedBy:null,storedAt:f.b.id,storageSlot:0}});
 let n=40;while(f.r.activity){assert.ok(n-->0);stepWorld(f.w,1);}assert.equal(f.r.lastFailure,null);assert.deepEqual(f.r.roomAt,at);
 assert.ok(submitPlan(f.w,{id:'leave',actorId:f.r.id,actorRevision:f.r.revision,createdAt:f.w.minute,definition:f.w.activeDefinitions['action/routine'],intention:'合成自选出门',actions:[{type:'move',to:{x:f.b.door.x,y:f.b.door.y+1}}]}).ok);
 stepWorld(f.w,1);assert.match(f.r.lastFailure!,/出口|路线/);assert.deepEqual(f.r.roomAt,at);assert.equal(f.r.inside,f.b.id);
});

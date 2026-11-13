import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createMvpWorld} from '../src/server/godot-mvp.js';
import {startPersistentMvp} from '../src/server/godot-mvp-persistent.js';
import {WorldStore} from '../src/server/store.js';
import {adoptMvpRooms,validateMvpRooms,mvpSleepProblem} from '../src/world/mvp-rooms.js';
import {roomLayout} from '../src/shared/rooms.js';
import {submitPlan,stepWorld} from '../src/world/engine.js';
function database(t:any){mkdirSync('output',{recursive:true});const dir=mkdtempSync('output/mvp-room-migration-');t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'synthetic.sqlite');}
function save(file:string,w:ReturnType<typeof createMvpWorld>){const s=new WorldStore(file);try{s.commit(w,null);}finally{s.close();}}
function legacy(){const w=createMvpWorld();delete w.mvpRooms;delete w.rooms;return w;}

test('unambiguous outdoor legacy save adopts rooms once, paused, without fabricated history',async t=>{
 const file=database(t),w=legacy();save(file,w);
 const run=await startPersistentMvp({database:file,port:0,env:{}});
 assert.deepEqual(run.runtime.world.mvpRooms,{version:1,adoptedAt:w.minute});assert.deepEqual(run.runtime.world.residents.map(r=>r.at),w.residents.map(r=>r.at));assert.equal(run.runtime.world.clock.paused,true);
 const adoption=structuredClone(run.runtime.world.mvpRooms);await run.close();
 const next=await startPersistentMvp({database:file,port:0,env:{}});assert.deepEqual(next.runtime.world.mvpRooms,adoption);await next.close();
});
for(const kind of ['inside','old-sleep','future-version','missing-position','null-version'] as const)test('unsafe save rejected unchanged: '+kind,async t=>{
 const file=database(t),w=kind==='inside'||kind==='old-sleep'?legacy():createMvpWorld(),r=w.residents[0];
 if(kind==='inside'){r.inside=w.buildings[0].id;r.roomAt=null;}
 if(kind==='old-sleep'){r.activity={planId:'old',action:{type:'sleep',minutes:10},startedAt:w.minute,remaining:10,path:[],target:{...w.buildings[0].door},definition:w.activeDefinitions['action/routine']};}
 if(kind==='future-version')(w.mvpRooms as any).version=2;
 if(kind==='null-version')(w as any).mvpRooms=null;
 if(kind==='missing-position'){r.inside=w.buildings[0].id;r.at={...w.buildings[0].door};r.roomAt=null;}
 save(file,w);await assert.rejects(startPersistentMvp({database:file,port:0,env:{}}),/godot_mvp_save_mismatch/);
 const read=new WorldStore(file);try{assert.deepEqual(read.load(),w);}finally{read.close();}
});
test('formal mode never opts into MVP protection or adoption',()=>{
 const w=createMvpWorld();w.mode='formal';const before=structuredClone(w);adoptMvpRooms(w);assert.deepEqual(w,before);assert.equal(mvpSleepProblem(w,w.residents[0]),null);
});
for(const point of ['bed','entry'] as const)test('blocked '+point+' stops before recovering sleep energy',()=>{
 const w=createMvpWorld(),[r,obstacle]=w.residents,b=w.buildings[0],l=roomLayout(w,b);r.at={...b.door};r.energy=30;
 const at=point==='bed'?l.slots.find(s=>s.key==='bed:0')!.at:l.entry;
 Object.assign(obstacle,{status:'dead',inside:b.id,roomAt:{...at},body:{reservedBy:null,carriedBy:null,storedAt:b.id,storageSlot:0}});
 assert.equal(submitPlan(w,{id:'sleep',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'合成',actions:[{type:'sleep',minutes:10}]}).ok,true);
 stepWorld(w,1);assert.match(r.lastFailure!,/阻断/);assert.equal(r.inside,null);assert.ok(r.energy<=30);
});
test('explicit room version rejects missing room state',()=>{const w=createMvpWorld();delete w.rooms;assert.throws(()=>validateMvpRooms(w),/invalid_room_state/);});
test('corrupt room assignment records reject before runtime can dereference them',()=>{
 for(const value of [null,[],{ 'mvp-home':null },{ 'mvp-home':{person:-1} }]){
  const w=createMvpWorld();(w.rooms as any).beds=value;assert.throws(()=>validateMvpRooms(w),/invalid_room_state/);
 }
});
test('persistent service reopens an in-flight indoor route without adopting a new position',async t=>{
 const file=database(t),w=createMvpWorld(),r=w.residents[0];r.at={...w.buildings[0].door};
 assert.ok(submitPlan(w,{id:'saved-sleep',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'合成',actions:[{type:'sleep',minutes:10}]}).ok);
 stepWorld(w,2.5);assert.ok(r.activity?.room?.path.length);save(file,w);
 const run=await startPersistentMvp({database:file,port:0,env:{}});
 try{assert.deepEqual(run.runtime.world.residents[0].roomAt,r.roomAt);assert.deepEqual(run.runtime.world.residents[0].activity,r.activity);assert.deepEqual(run.runtime.world.rooms,w.rooms);assert.equal(run.runtime.world.clock.paused,true);}finally{await run.close();}
});

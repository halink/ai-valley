/** Short synthetic MVP room regressions. No real saves, models or longevity run. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createMvpWorld} from '../src/server/godot-mvp.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {roomLayout} from '../src/shared/rooms.js';
import {WorldStore} from '../src/server/store.js';
import type {Action,Resident,World} from '../src/shared/types.js';
function fixture(){
 const w=createMvpWorld(),home=w.buildings[0];assert.ok(w.rooms);assert.equal(w.mvpRooms?.version,1);
 for(const r of w.residents){r.at={...home.door};r.hunger=10;r.energy=30;r.activity=null;r.plan=null;}
 return {w,home,r:w.residents[0],other:w.residents[1]};
}
function plan(w:World,r:Resident,action:Action){
 assert.equal(submitPlan(w,{id:`probe:${r.id}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'合成复用探针：本人选择',actions:[action]}).ok,true);
}
function finish(w:World,r:Resident){let bound=100;while(r.plan||r.activity){assert.ok(bound-->0);stepWorld(w,1);}}
function reachBed(w:World,r:Resident){let bound=50;do{assert.ok(bound-->0);stepWorld(w,1);}while(r.activity?.path.length||r.activity?.room?.path.length);assert.ok(r.activity);}

test('room reuse probe: two MVP residents walk to distinct beds before recovering, then exit physically',()=>{
 const {w,home,r,other}=fixture();
 for(const p of [r,other])plan(w,p,{type:'sleep',minutes:10});
 stepWorld(w,1);
 assert.ok(r.activity?.room?.path.length);assert.ok(other.activity?.room?.path.length);
 assert.ok(r.energy<30&&other.energy<30);
 assert.notEqual(w.rooms!.beds[home.id][r.id],w.rooms!.beds[home.id][other.id]);
 finish(w,r);finish(w,other);
 for(const p of [r,other]){
  assert.equal(p.lastFailure,null);assert.ok(p.energy>30);assert.equal(p.inside,home.id);
  const bed=w.rooms!.beds[home.id][p.id];assert.deepEqual(p.roomAt,roomLayout(w,home).slots.find(s=>s.key==='bed:'+bed)!.at);
 }
 const target={x:home.door.x,y:home.door.y+1};plan(w,r,{type:'move',to:target});stepWorld(w,1);
 assert.equal(r.activity?.room?.mode,'exit');assert.deepEqual(r.at,home.door);
 finish(w,r);assert.equal(r.inside,null);assert.equal(r.roomAt,null);assert.deepEqual(r.at,target);
 assert.equal(w.mode,'validation');assert.equal(w.metrics.requests,0);
 assert.equal(w.industry,undefined);assert.equal(w.health,undefined);
});

test('room reuse probe: real SQLite reopen preserves route, beds and final result',()=>{
 const {w,r,other}=fixture();for(const p of [r,other])plan(w,p,{type:'sleep',minutes:10});stepWorld(w,2.5);
 mkdirSync('output',{recursive:true});const dir=mkdtempSync('output/mvp-rooms-'),file=join(dir,'synthetic.sqlite');let store=new WorldStore(file);
 try{
  store.commit(w,null);store.close();store=new WorldStore(file);const loaded=store.loadForRuntime()!;
  assert.deepEqual(loaded.rooms,w.rooms);assert.deepEqual(loaded.residents[0].activity,r.activity);assert.deepEqual(loaded.residents[0].roomAt,r.roomAt);
  finish(w,r);finish(loaded,loaded.residents[0]);
  assert.deepEqual(loaded.residents.map(p=>({room:p.roomAt,energy:p.energy,activity:p.activity})),w.residents.map(p=>({room:p.roomAt,energy:p.energy,activity:p.activity})));
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('room reuse probe: no initial bed fails without inventing a bed or restoring energy',()=>{
 const {w,home,r}=fixture();home.capacity=0;plan(w,r,{type:'sleep',minutes:10});stepWorld(w,1);
 assert.match(r.lastFailure!,/床位缺口/);assert.equal(r.inside,null);assert.equal(r.roomAt,null);assert.ok(r.energy<=30);
});

test('room reuse probe: a dynamically blocked cached path stops at the real position',()=>{
 const {w,home,r,other}=fixture();plan(w,r,{type:'sleep',minutes:10});stepWorld(w,.25);
 const bay=roomLayout(w,home).slots.find(s=>s.key==='bodyBay:0')!.at;
 assert.ok(r.activity?.room?.path.some(p=>p.x===bay.x&&p.y===bay.y));
 // Isolated fixture obstruction, not an MVP corpse/animal feature.
 Object.assign(other,{status:'dead',inside:home.id,roomAt:{...bay},body:{reservedBy:null,carriedBy:null,storedAt:home.id,storageSlot:0}});
 finish(w,r);assert.match(r.lastFailure!,/阻断/);assert.notDeepEqual(r.roomAt,bay);assert.ok(r.energy<30);
 const at=structuredClone(r.roomAt);stepWorld(w,1);assert.deepEqual(r.roomAt,at);
});

test('withdrawing a bed during sleep stops in place without recovery or automatic exit',()=>{
 const {w,home,r}=fixture();plan(w,r,{type:'sleep',minutes:10});reachBed(w,r);
 home.capacity=0;const at=structuredClone(r.roomAt),before=r.energy;stepWorld(w,1);
 assert.match(r.lastFailure!,/床位/);assert.ok(r.energy<=before);assert.equal(r.inside,home.id);assert.deepEqual(r.roomAt,at);assert.equal(r.activity,null);
 stepWorld(w,2);assert.deepEqual(r.roomAt,at);
});

test('an idle physical occupant prevents use of a reassigned bed',()=>{
 const {w,home,r,other}=fixture();plan(w,r,{type:'sleep',minutes:1});finish(w,r);
 const occupied=structuredClone(r.roomAt);home.residents=[other.id];home.capacity=1;
 plan(w,other,{type:'sleep',minutes:10});const before=other.energy;stepWorld(w,1);
 assert.match(other.lastFailure!,/占用/);assert.ok(other.energy<=before);assert.equal(other.inside,null);assert.deepEqual(r.roomAt,occupied);
});

test('missing indoor position fails rather than inventing an entrance',()=>{
 const {w,home,r}=fixture();r.inside=home.id;r.roomAt=null;plan(w,r,{type:'sleep',minutes:10});stepWorld(w,1);
 assert.match(r.lastFailure!,/补造入口/);assert.equal(r.roomAt,null);assert.equal(r.activity,null);
});
test('an active sleeper physically blocks a reassigned bed without either actor teleporting',()=>{
 const {w,home,r,other}=fixture();plan(w,r,{type:'sleep',minutes:20});reachBed(w,r);
 const occupied=structuredClone(r.roomAt);home.residents=[other.id];home.capacity=1;
 plan(w,other,{type:'sleep',minutes:10});stepWorld(w,1);
 assert.ok(r.lastFailure);assert.match(other.lastFailure!,/占用/);assert.deepEqual(r.roomAt,occupied);assert.equal(other.inside,null);
});

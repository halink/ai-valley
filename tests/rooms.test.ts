import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorld} from '../src/world/seed.js';import {stepWorld,submitPlan} from '../src/world/engine.js';
import {initializeRooms} from '../src/world/rooms.js';import {roomLayout,roomPath} from '../src/shared/rooms.js';
import type {Action,Resident,World} from '../src/shared/types.js';import {WorldStore} from '../src/server/store.js';
function fixture(){const w=createWorld();w.mode='formal';w.clock.paused=false;initializeRooms(w);const [r,other]=w.residents,home=w.buildings.find(b=>b.id===r.homeId)!;for(const p of w.residents){p.at={...home.door};p.inside=null;p.roomAt=null;p.inventory={turnip:20,water:20,wood:20,stone:20};p.hunger=20;p.health=100;p.energy=70;}home.residents=[r.id,other.id];other.homeId=home.id;return {w,r,other,home};}
function plan(w:World,r:Resident,action:Action){assert.ok(submitPlan(w,{id:`room:${r.id}:${w.revision}:${w.minute}`,actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'本人选择真实工位',actions:[action]}).ok);}
test('interior travel consumes real time before cooking, and persisted furniture corresponds to the route',()=>{
 const {w,r,home}=fixture();const layout=roomLayout(w,home),target=layout.slots.find(s=>s.key==='kitchen')!.at,path=roomPath(layout,layout.entry,target)!;assert.ok(path.length>0);
 plan(w,r,{type:'cook',quantity:1});stepWorld(w,path.length);assert.equal(r.inventory.meal,undefined);assert.equal(r.activity!.remaining,20);assert.deepEqual(r.roomAt,target);stepWorld(w,20);assert.equal(r.inventory.meal,1);assert.equal(r.inside,home.id);assert.deepEqual(r.roomAt,target);
});
test('a person walks to their bed before rest can restore energy',()=>{
 const {w,r,home}=fixture();const energy=r.energy;plan(w,r,{type:'sleep',minutes:10});stepWorld(w,1);assert.ok(r.activity?.room?.path.length);assert.ok(r.energy<energy);assert.equal(r.recentActions,undefined);const atStart=w.minute;let guard=200;while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.ok(w.minute-atStart>10);assert.ok(r.energy>energy);assert.ok(w.rooms!.beds[home.id][r.id]>=0);
 assert.deepEqual(r.recentActions,[{type:'sleep',at:w.minute,minutes:10,energy:Math.round(r.energy)}]);
 for(let i=0;i<4;i++){plan(w,r,{type:'wait',minutes:1});stepWorld(w,1);}
 const store=new WorldStore(':memory:');
 try{
  store.commit(w,null);
  assert.deepEqual(store.load()!.residents[0].recentActions?.map(a=>a.type),['wait','wait','wait','wait']);
 }finally{store.close();}
});
test('an indoor actor physically returns to the door before taking an outdoor step',()=>{
 const {w,r,home}=fixture();const l=roomLayout(w,home),point=l.slots.find(s=>s.key==='kitchen')!.at;r.inside=home.id;r.roomAt={...point};const next={x:home.door.x,y:home.door.y+1};plan(w,r,{type:'move',to:next});stepWorld(w,1);assert.deepEqual(r.at,home.door);assert.equal(r.inside,home.id);assert.equal(r.activity?.room?.mode,'exit');let guard=200;while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.deepEqual(r.at,next);assert.equal(r.inside,null);assert.equal(r.roomAt,null);
});
test('the last productive tick still occupies the workstation and cannot be counted twice by another actor',()=>{
 const {w,r,other,home}=fixture();const l=roomLayout(w,home),target=l.slots.find(s=>s.key==='kitchen')!.at;
 for(const p of [r,other]){p.inside=home.id;p.roomAt={...target};}
 r.activity={planId:'ongoing-cook',action:{type:'cook',quantity:1},startedAt:w.minute-19,remaining:1,path:[],target:{...home.door},definition:'recipe/meal@1'};
 plan(w,other,{type:'cook',quantity:1});stepWorld(w,1);assert.equal(r.inventory.meal,1);assert.equal(other.inventory.meal,undefined);assert.match(other.lastFailure!,/占用/);assert.equal(other.inside,home.id,'failed work never teleports the person out of the room');
});
test('room route and fractional movement survive a saved restart without crediting unperformed work',()=>{
 const {w,r}=fixture();plan(w,r,{type:'cook',quantity:1});stepWorld(w,2.5);const store=new WorldStore(':memory:');store.commit(w,null);const restored=store.load()!;store.close();const person=restored.residents.find(p=>p.id===r.id)!;assert.deepEqual(person.activity?.room,r.activity?.room);assert.deepEqual(person.roomAt,r.roomAt);assert.equal(person.inventory.meal,undefined);
 let guard=200;while(person.plan||person.activity){assert.ok(guard--);stepWorld(restored,.5);}assert.equal(person.inventory.meal,1);
});
test('new sleepers reserve distinct real beds before walking and an overcrowded house never fabricates another bed',()=>{
 const {w,r,other,home}=fixture();home.capacity=2;plan(w,r,{type:'sleep',minutes:10});plan(w,other,{type:'sleep',minutes:10});stepWorld(w,1);assert.notEqual(w.rooms!.beds[home.id][r.id],w.rooms!.beds[home.id][other.id]);const third=w.residents[2];home.residents.push(third.id);third.homeId=home.id;third.at={...home.door};third.inside=null;plan(w,third,{type:'sleep',minutes:10});stepWorld(w,1);assert.match(third.lastFailure!,/床位缺口/);assert.equal(third.inside,null);assert.equal(home.capacity,2);
});
test('sharing an outdoor doorway does not complete indoor social interaction across the room',()=>{
 const {w,r,other,home}=fixture();const l=roomLayout(w,home);for(const p of [r,other]){p.inside=home.id;p.knownPeople.push(r.id,other.id);}r.roomAt={...l.entry};other.roomAt={...l.slots.find(s=>s.key==='bed:0')!.at};plan(w,r,{type:'talk',targetId:other.id,text:'我走过来和你说话',tone:'neutral'});const before=w.events.filter(e=>e.kind==='conversation').length;stepWorld(w,1);assert.equal(w.events.filter(e=>e.kind==='conversation').length,before);assert.ok(r.activity?.room?.path.length);let guard=200;while(r.activity||r.plan){assert.ok(guard--);stepWorld(w,1);}assert.equal(r.lastFailure,null);assert.equal(w.events.filter(e=>e.kind==='conversation').length,before+1);
});

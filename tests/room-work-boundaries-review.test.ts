import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorld} from '../src/world/seed.js';
import {stepWorld,submitPlan} from '../src/world/engine.js';
import {moveInRoom} from '../src/world/rooms.js';
import {roomLayout} from '../src/shared/rooms.js';

function fixture(){
 const w=createWorld();w.mode='formal';w.clock.paused=false;
 const r=w.residents[0],home=w.buildings.find(b=>b.id===r.homeId)!;
 home.kind='lodge';home.residents=[r.id];home.capacity=2;
 for(const p of w.residents){p.at={...home.door};p.inside=null;p.roomAt=null;p.plan=null;p.activity=null;p.hunger=20;p.energy=50;p.health=100;}
 assert.equal(submitPlan(w,{id:'review-sleep',actorId:r.id,actorRevision:r.revision,createdAt:w.minute,definition:w.activeDefinitions['action/routine'],intention:'independent room review',actions:[{type:'sleep',minutes:10}]}).ok,true);
 stepWorld(w,.25);assert.ok(r.activity?.room?.path.length);return {w,r,home};
}

test('review: ordinary unobstructed sleeping still reaches the actual bed and restores energy',()=>{
 const {w,r,home}=fixture();let left=400;
 while(r.activity||r.plan){assert.ok(left-->0);stepWorld(w,.25);}
 assert.equal(r.lastFailure,null);assert.equal(r.inside,home.id);
 assert.deepEqual(r.roomAt,roomLayout(w,home).slots.find(s=>s.key==='bed:0')!.at);
 assert.ok(r.energy>50);
});

test('review: a saved work journey cannot jump a nonadjacent room step',()=>{
 const {w,r}=fixture(),from={...r.roomAt!};
 r.activity!.room!.path[0]={x:from.x+2,y:from.y};
 const result=moveInRoom(w,r,2);
 assert.ok(result.error);assert.deepEqual(r.roomAt,from);
});

test('review: a work journey with mismatched outdoor doorway coordinates cannot move indoors',()=>{
 const {w,r}=fixture(),from={...r.roomAt!};r.at.x++;
 const result=moveInRoom(w,r,2);
 assert.ok(result.error);assert.deepEqual(r.roomAt,from);
});

test('review: a persisted work journey cannot leave a blocked current room cell',()=>{
 const {w,r,home}=fixture(),from={...r.roomAt!},body=w.residents[1];
 Object.assign(body,{status:'dead',inside:home.id,roomAt:{...from},body:{reservedBy:null,carriedBy:null,storedAt:home.id,storageSlot:0}});
 const result=moveInRoom(w,r,2);
 assert.ok(result.error);assert.deepEqual(r.roomAt,from);
});
